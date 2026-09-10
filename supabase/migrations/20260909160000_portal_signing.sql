-- ============================================================================
-- SIGNING FROM THE PORTAL
-- ============================================================================
-- WHAT WAS MISSING
-- ----------------
-- A client could sign a document only from the emailed link. The Document
-- Centre in their portal showed `esign_status` — "pending" — and gave them no
-- way to act on it. So a customer who deleted the email, or never got it
-- because it went to spam, had a document waiting for them, could SEE that it
-- was waiting, and had no route to it except ringing the office.
--
-- `esign_signers` is staff-only by policy (20260731090000), and correctly so:
-- it holds every signer's one-time token, and a client who could read that
-- table could read everybody's. So the portal cannot simply query it.
--
-- WHAT THIS ADDS
-- --------------
-- One function that returns the caller's OWN pending signatures, and nothing
-- else. It is SECURITY DEFINER because it has to see past that policy, and
-- every line of it exists to make sure it sees no further than it should.
--
-- ---------------------------------------------------------------------------
-- WHY THE EMAIL IS NOT A PARAMETER
--
-- The obvious signature is `my_pending_signatures(p_email text)`. That
-- function would hand any authenticated user the signing token of any email
-- address they cared to type — which is every unsigned document on the
-- platform, and with it the ability to sign as somebody else.
--
-- So the address is read from the SESSION, never from an argument. The
-- function takes no parameters at all, which is the only shape that cannot be
-- asked the wrong question.
--
-- ---------------------------------------------------------------------------
-- RETURNING THE TOKEN IS THE POINT, AND IS SAFE
--
-- The token is what /sign/:token consumes. Handing it to the authenticated
-- owner of the address it was issued to is exactly equivalent to their reading
-- the email it was sent in — same person, same secret, better delivery. It is
-- returned only for rows still awaiting that person's signature, and only
-- while the token is unexpired.
--
-- Idempotent -- safe to re-run.
-- ============================================================================

begin;

create or replace function public.my_pending_signatures()
returns table (
  signer_id      uuid,
  document_id    uuid,
  document_name  text,
  token          text,
  status         text,
  expires_at     timestamptz,
  requested_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
begin
  -- From the session. Never from an argument -- see the header.
  select lower(btrim(u.email)) into v_email
    from auth.users u where u.id = auth.uid();

  if v_email is null or v_email = '' then
    return;                              -- not signed in: nothing to show
  end if;

  return query
  select s.id,
         s.esign_document_id,
         coalesce(d.name, 'Document'),
         s.token,
         s.status,
         s.token_expires_at,
         s.created_at
    from public.esign_signers s
    left join public.esign_documents d on d.id = s.esign_document_id
   where lower(btrim(s.email)) = v_email
     -- Only what is still waiting on THIS person. A signed row's token is
     -- spent, and returning it would invite a second submission.
     and coalesce(s.status, 'pending') in ('pending', 'viewed')
     and s.token is not null
     and (s.token_expires_at is null or s.token_expires_at > now())
   order by s.created_at desc
   limit 50;
end;
$$;

revoke execute on function public.my_pending_signatures() from public, anon;
grant  execute on function public.my_pending_signatures() to authenticated;

comment on function public.my_pending_signatures() is
  'The caller''s own unsigned documents, with the token /sign/:token needs. Takes no arguments on purpose: the address comes from the session, so the function cannot be asked about anybody else.';

notify pgrst, 'reload schema';

commit;

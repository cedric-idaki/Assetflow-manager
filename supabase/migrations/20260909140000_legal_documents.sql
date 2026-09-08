-- ============================================================================
-- TERMS AND CONDITIONS — VERSIONED, PUBLISHED, AND ACCEPTED ON THE RECORD
-- ============================================================================
-- WHAT WAS THERE
-- --------------
-- One hardcoded Google Drive URL in src/components/TermsModal.jsx:
--
--     export const TERMS_DOC_URL = 'https://drive.google.com/file/d/1t8f…/preview';
--
-- Which means: updating the terms is a code change and a redeploy; there is no
-- record of what the terms SAID on the day somebody accepted them; and the
-- registration checkbox records agreement to a document that can be swapped
-- underneath it without anybody knowing.
--
-- The last of those is the one that matters. A signed-up user's acceptance is
-- only worth something if you can produce the exact text they accepted. A URL
-- to a mutable Drive file cannot do that.
--
-- WHAT THIS ADDS
-- --------------
--   legal_documents    Every version ever published, immutable once live.
--                      One row is active per kind at a time.
--   legal_acceptances  Who accepted WHICH VERSION, when, and from where.
--
-- WHY THE DOCUMENT IS IMMUTABLE ONCE PUBLISHED
-- --------------------------------------------
-- Editing a live version would rewrite what past acceptances refer to, which
-- is the exact failure the Drive link had. Correcting the terms means
-- publishing a NEW version; the old one stays, inactive, because people are
-- still bound by it. A trigger enforces this rather than a convention.
--
-- WHY ANONYMOUS CAN READ IT
-- -------------------------
-- The terms are shown DURING registration, before there is a session. A policy
-- that required auth would show a blank modal to exactly the people who have
-- to read it. So the active version is world-readable — it is a public
-- document by nature — while the acceptance records are not.
--
-- Idempotent -- safe to re-run.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. THE DOCUMENTS
-- ---------------------------------------------------------------------------
create table if not exists public.legal_documents (
  id             uuid primary key default gen_random_uuid(),
  doc_kind       text not null default 'terms',
  version        text not null,
  title          text not null,
  summary        text,

  -- Either a hosted file or inline text. Both are supported because the first
  -- version of these terms is a PDF and later ones may not be, and forcing a
  -- PDF upload to change one clause is how documents stop being maintained.
  file_path      text,
  file_name      text,
  body_html      text,
  external_url   text,

  is_active      boolean not null default false,
  effective_from date not null default current_date,
  published_by   uuid,
  published_at   timestamptz,
  created_at     timestamptz not null default now(),

  constraint legal_documents_kind_chk check (doc_kind in ('terms', 'privacy', 'sacco_bylaws', 'other')),
  constraint legal_documents_version_uq unique (doc_kind, version),
  -- A document with nowhere to read it is not a document.
  constraint legal_documents_has_content_chk
    check (file_path is not null or body_html is not null or external_url is not null)
);

-- One active version per kind. A partial unique index rather than a trigger:
-- the database refuses the second activation outright instead of racing.
create unique index if not exists uq_legal_documents_active
  on public.legal_documents (doc_kind) where is_active;

create index if not exists idx_legal_documents_kind on public.legal_documents (doc_kind, effective_from desc);

comment on table public.legal_documents is
  'Every published version of the terms, privacy policy and by-laws. Immutable once active — correcting the terms means publishing a new version, because past acceptances refer to the old one.';

-- ---------------------------------------------------------------------------
-- 2. WHO ACCEPTED WHAT
-- ---------------------------------------------------------------------------
create table if not exists public.legal_acceptances (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.legal_documents(id) on delete restrict,
  user_id      uuid,
  -- Registration accepts BEFORE the auth user exists, so the email is what
  -- ties an acceptance to a person until the account is created.
  email        text,
  full_name    text,
  accepted_at  timestamptz not null default now(),
  ip_address   text,
  user_agent   text,

  constraint legal_acceptances_who_chk check (user_id is not null or email is not null)
);

create index if not exists idx_legal_acceptances_user  on public.legal_acceptances (user_id);
create index if not exists idx_legal_acceptances_email on public.legal_acceptances (lower(email));
create index if not exists idx_legal_acceptances_doc   on public.legal_acceptances (document_id);

comment on table public.legal_acceptances is
  'One row per person per version accepted. `document_id` is ON DELETE RESTRICT: a version somebody accepted can never be deleted out from under the record of their accepting it.';

-- ---------------------------------------------------------------------------
-- 3. IMMUTABILITY
--
--    A live version's content is frozen. Everything else about it — the
--    active flag, a corrected summary — can still move.
-- ---------------------------------------------------------------------------
create or replace function public.legal_documents_freeze_published()
returns trigger
language plpgsql
as $$
begin
  if old.published_at is not null and (
       new.body_html    is distinct from old.body_html
    or new.file_path    is distinct from old.file_path
    or new.external_url is distinct from old.external_url
    or new.version      is distinct from old.version)
  then
    raise exception
      'Version % of the % has been published and cannot be edited. Publish a new version instead — people have accepted this one.',
      old.version, old.doc_kind
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_legal_documents_freeze on public.legal_documents;
create trigger trg_legal_documents_freeze
  before update on public.legal_documents
  for each row execute function public.legal_documents_freeze_published();

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
alter table public.legal_documents   enable row level security;
alter table public.legal_acceptances enable row level security;

drop policy if exists legal_documents_public_read on public.legal_documents;
drop policy if exists legal_acceptances_own_read  on public.legal_acceptances;

-- The active version is readable by ANYONE, signed in or not — it is shown
-- during registration, before a session exists.
create policy legal_documents_public_read on public.legal_documents
  for select to anon, authenticated
  using (is_active or public.is_global_viewer());

-- An acceptance is the accepter's own business, and the platform owner's.
create policy legal_acceptances_own_read on public.legal_acceptances
  for select to authenticated
  using (user_id = auth.uid() or public.is_global_viewer());

revoke all on public.legal_documents   from anon, authenticated;
revoke all on public.legal_acceptances from anon, authenticated;
grant select on public.legal_documents   to anon, authenticated;
grant select on public.legal_acceptances to authenticated;

-- ---------------------------------------------------------------------------
-- 5. PUBLISH
--
--    Activating a version deactivates the previous one in the same statement.
--    Doing it in two would leave a window with none active, and the modal
--    would show nothing to whoever registered during it.
-- ---------------------------------------------------------------------------
create or replace function public.publish_legal_document(
  p_doc_kind     text,
  p_version      text,
  p_title        text,
  p_summary      text default null,
  p_file_path    text default null,
  p_file_name    text default null,
  p_body_html    text default null,
  p_external_url text default null,
  p_activate     boolean default true,
  p_effective    date default null
)
returns public.legal_documents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.legal_documents%rowtype;
begin
  -- Platform-wide documents, so platform owner only. A tenant admin publishing
  -- terms for everybody is not a thing that should be possible.
  if not public.is_global_viewer() then
    raise exception 'Only the platform owner may publish legal documents.' using errcode = '42501';
  end if;

  if coalesce(btrim(p_version), '') = '' then
    raise exception 'A published document needs a version.' using errcode = 'P0001';
  end if;
  if p_file_path is null and p_body_html is null and p_external_url is null then
    raise exception 'Upload a file, paste the text, or give a link — a document needs content.'
      using errcode = 'P0001';
  end if;

  if p_activate then
    update public.legal_documents
       set is_active = false
     where doc_kind = p_doc_kind and is_active;
  end if;

  insert into public.legal_documents
    (doc_kind, version, title, summary, file_path, file_name, body_html,
     external_url, is_active, effective_from, published_by, published_at)
  values
    (p_doc_kind, btrim(p_version), p_title, nullif(btrim(coalesce(p_summary, '')), ''),
     p_file_path, p_file_name, p_body_html, p_external_url,
     coalesce(p_activate, true), coalesce(p_effective, current_date),
     auth.uid(), now())
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.publish_legal_document(text, text, text, text, text, text, text, text, boolean, date) from public, anon;
grant  execute on function public.publish_legal_document(text, text, text, text, text, text, text, text, boolean, date) to authenticated;

-- Switch back to an earlier version, without republishing it.
create or replace function public.activate_legal_document(p_id uuid)
returns public.legal_documents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.legal_documents%rowtype;
begin
  if not public.is_global_viewer() then
    raise exception 'Only the platform owner may activate a legal document.' using errcode = '42501';
  end if;

  select * into v_row from public.legal_documents where id = p_id;
  if v_row.id is null then
    raise exception 'Document not found.' using errcode = 'P0002';
  end if;

  update public.legal_documents set is_active = false
   where doc_kind = v_row.doc_kind and is_active and id <> p_id;
  update public.legal_documents set is_active = true where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.activate_legal_document(uuid) from public, anon;
grant  execute on function public.activate_legal_document(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. ACCEPT
--
--    Callable by anon: the tick happens during registration, before the
--    account exists. It records the ACTIVE version's id, resolved server-side
--    — a client that named its own document_id could record agreement to a
--    version it never showed.
-- ---------------------------------------------------------------------------
create or replace function public.record_legal_acceptance(
  p_doc_kind  text default 'terms',
  p_email     text default null,
  p_full_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doc uuid;
  v_id  uuid;
begin
  select id into v_doc from public.legal_documents
   where doc_kind = p_doc_kind and is_active limit 1;

  if v_doc is null then
    -- No active version is a configuration problem, not a reason to block a
    -- signup. Nothing to record, so record nothing and say so by returning
    -- NULL; the caller decides whether that is acceptable.
    return null;
  end if;

  insert into public.legal_acceptances (document_id, user_id, email, full_name)
  values (v_doc, auth.uid(), nullif(btrim(coalesce(p_email, '')), ''),
          nullif(btrim(coalesce(p_full_name, '')), ''))
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.record_legal_acceptance(text, text, text) from public;
grant  execute on function public.record_legal_acceptance(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. THE BUCKET
--     Public: these documents are meant to be read by people who have not
--     signed in yet. Nothing private is ever stored here.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('legal-documents', 'legal-documents', true, 10485760,
        array['application/pdf', 'text/html', 'text/plain'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "legal_documents_read"  on storage.objects;
drop policy if exists "legal_documents_write" on storage.objects;

create policy "legal_documents_read"
on storage.objects for select to anon, authenticated
using (bucket_id = 'legal-documents');

create policy "legal_documents_write"
on storage.objects for insert to authenticated
with check (bucket_id = 'legal-documents' and public.is_global_viewer());

-- ---------------------------------------------------------------------------
-- 8. CARRY THE CURRENT TERMS ACROSS
--
--     The Drive link becomes version 1.0 so nothing is lost and the modal has
--     something to show the moment this lands. It is recorded as an
--     external_url, which is exactly what it is — and the reason to replace it.
-- ---------------------------------------------------------------------------
insert into public.legal_documents
  (doc_kind, version, title, summary, external_url, is_active, effective_from, published_at)
select 'terms', '1.0', 'Terms & Conditions and Privacy Policy',
       'Migrated from the hardcoded Google Drive link. Replace with an uploaded copy so the text can be produced as it stood on any given date.',
       'https://drive.google.com/file/d/1t8fTwvCcbiYa-iDAPZ9mQv8SOd-Ly6IA/preview',
       true, current_date, now()
where not exists (select 1 from public.legal_documents where doc_kind = 'terms');

notify pgrst, 'reload schema';

commit;

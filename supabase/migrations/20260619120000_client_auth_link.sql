-- Migration: link each client-portal login to its clients row reliably.
--
-- PROBLEM
--   A logged-in client was resolved to their clients row purely by EMAIL
--   (get_my_client_profile + the clients self-read RLS policy). When more than
--   one clients row shares the same email — common while testing with a single
--   inbox — the resolver returned `order by created_at limit 1`, i.e. the OLDEST
--   matching row. So a client logging in as "Deffy Dofido" saw another client's
--   ("Maureen Koikai") name, account number and balance on the dashboard, even
--   though the sidebar (which reads user_profiles by auth uid) was correct.
--
-- FIX
--   Add clients.client_auth_id — a hard FK to the auth user that owns the portal
--   login — backfill it for already-provisioned clients, and make the resolver
--   prefer it, falling back to email only when the link is not yet set.
--
-- Idempotent: safe to re-run.

-- ── 1. Link column ──────────────────────────────────────────────────────────────
alter table public.clients
  add column if not exists client_auth_id uuid references auth.users(id) on delete set null;

-- ── 2. Backfill from each client's portal user_profiles row ──────────────────────
-- Match on email AND full_name so duplicate-email rows still resolve to the right
-- person. Keep the link 1:1 (newest client row wins for a given auth user).
with ranked as (
  select c.id  as client_id,
         up.id as auth_id,
         row_number() over (partition by up.id order by c.created_at desc) as rn
  from public.clients c
  join public.user_profiles up
    on up.role = 'client'
   and lower(btrim(c.email))     = lower(btrim(up.email))
   and lower(btrim(c.full_name)) = lower(btrim(up.full_name))
  where c.client_auth_id is null
    and c.email is not null
)
update public.clients c
   set client_auth_id = r.auth_id
  from ranked r
 where c.id = r.client_id
   and r.rn = 1;

-- One auth user maps to at most one client row.
create unique index if not exists clients_client_auth_id_key
  on public.clients(client_auth_id)
  where client_auth_id is not null;

-- ── 3. Resolver: prefer the hard link, fall back to email ───────────────────────
create or replace function public.get_my_client_profile()
returns setof public.clients
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uemail text;
begin
  -- Primary: the auth user explicitly linked to this clients row.
  return query
    select * from public.clients
    where client_auth_id = auth.uid()
    limit 1;
  if found then
    return;
  end if;

  -- Fallback: legacy clients not yet linked — resolve by email.
  select email into uemail from auth.users where id = auth.uid();
  return query
    select * from public.clients
    where lower(email) = lower(coalesce(uemail, auth.email()))
    order by created_at
    limit 1;
end;
$$;

grant execute on function public.get_my_client_profile() to authenticated;

-- ── 4. KYC helper: resolve the caller's client id by link first, then email ─────
create or replace function public.get_client_id_for_user()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select id from public.clients where client_auth_id = auth.uid() limit 1),
    (select id from public.clients where email = auth.email() order by created_at limit 1)
  );
$$;

-- ── 5. Self-read RLS by the hard link (keep the email policy as a fallback) ──────
drop policy if exists "clients_read_own_by_auth_id" on public.clients;
create policy "clients_read_own_by_auth_id"
on public.clients for select
to authenticated
using (client_auth_id = auth.uid());

-- ── 6. Refresh the PostgREST schema cache so the new column is visible ───────────
notify pgrst, 'reload schema';

-- ===========================================================================
-- user_profiles privilege lockdown
--
-- Closes two INDEPENDENT privilege-escalation paths found on 2026-08-02:
--
--   1. Policy `authenticated_full_access` (ALL, USING(true) WITH CHECK(true),
--      role `authenticated`) let ANY logged-in user run
--          update user_profiles set role = 'super_admin' where id = auth.uid();
--      Since current_admin_id() / is_staff_member() / is_global_viewer() all
--      read this table, that collapsed the entire tenancy model.
--
--   2. handle_new_user() copied raw_user_meta_data->>'role' verbatim into the
--      new profile. supabase.auth.signUp({ options: { data: { role } } }) is
--      fully client-controlled, so anyone could self-register as super_admin.
--      That trigger is SECURITY DEFINER, so no RLS policy could ever stop it.
--
-- user_profiles is ALSO the HR employee table (basic_salary, national_id,
-- kra_pin, nssf_number, bank_account, date_of_birth, next_of_kin_*), so the
-- blanket `USING(true)` SELECT policy was leaking payroll and identity data
-- across every tenant. The read policy below is scoped to the caller's tenant.
--
-- Note on design: an RLS WITH CHECK clause cannot reference OLD, so it cannot
-- express "you may edit your row but not your own role". The BEFORE UPDATE
-- trigger is therefore the actual fix; the policies scope *which rows* are
-- reachable, and the trigger scopes *which columns* may change.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Column guard: role / admin_id may only change on an authority's say-so.
-- ---------------------------------------------------------------------------
create or replace function public.guard_user_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller      uuid := auth.uid();
  caller_role public.user_role;
begin
  -- No JWT ⇒ service_role (edge functions, SQL editor, cron). Trusted authority:
  -- create-staff-user has already enforced its own CAN_CREATE matrix by here.
  if caller is null then
    return new;
  end if;

  -- Nothing privileged changed — ordinary profile edit.
  if new.role is not distinct from old.role
     and new.admin_id is not distinct from old.admin_id then
    return new;
  end if;

  select up.role into caller_role
  from public.user_profiles up
  where up.id = caller;

  -- Platform authority.
  if caller_role = 'super_admin'::public.user_role then
    return new;
  end if;

  -- A tenant owner may set roles on staff they own, but may never mint a
  -- platform-level role, nor another tenant owner, nor move a row to a
  -- different tenant.
  if caller_role in ('admin'::public.user_role, 'sacco_admin'::public.user_role)
     and old.admin_id = caller
     and new.admin_id = caller
     and new.role not in ('super_admin'::public.user_role,
                          'director'::public.user_role,
                          'admin'::public.user_role,
                          'sacco_admin'::public.user_role)
  then
    return new;
  end if;

  raise exception
    'user_profiles: not authorised to change role or admin_id (caller=%, caller_role=%)',
    caller, coalesce(caller_role::text, 'none')
    using errcode = '42501';
end;
$$;

-- Not callable directly; see supabase-function-grants-gotcha — REVOKE FROM
-- PUBLIC alone leaves anon/authenticated holding EXECUTE via default privileges.
revoke execute on function public.guard_user_profile_privileges() from public, anon, authenticated;

drop trigger if exists guard_user_profile_privileges on public.user_profiles;
create trigger guard_user_profile_privileges
  before update on public.user_profiles
  for each row execute function public.guard_user_profile_privileges();

-- ---------------------------------------------------------------------------
-- 2. Clamp the self-asserted signup role.
--    'admin' / 'sacco_admin' stay allowed — that IS the self-serve product
--    signup (src/pages/admin-registration), and both are tenant-scoped.
--    'super_admin' / 'director' are the global viewers (is_global_viewer) and
--    can never originate from client-supplied metadata. Accounts made by
--    create-staff-user are corrected immediately afterwards by its service-role
--    upsert, which bypasses both RLS and the guard trigger above.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requested text := coalesce(new.raw_user_meta_data->>'role', 'operations');
  safe_role public.user_role;
begin
  if requested in ('super_admin', 'director') then
    requested := 'operations';
  end if;

  begin
    safe_role := requested::public.user_role;
  exception when invalid_text_representation then
    safe_role := 'operations'::public.user_role;
  end;

  insert into public.user_profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'avatar_url', ''),
    safe_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Replace the blanket policies with tenant-scoped ones.
--    `profiles_access` (self + own staff) goes too: it is subsumed by the four
--    below, and on its own it still permitted self-service role changes.
-- ---------------------------------------------------------------------------
drop policy if exists "authenticated_full_access"                   on public.user_profiles;
drop policy if exists "Allow authenticated users to read profiles"  on public.user_profiles;
drop policy if exists "profiles_access"                             on public.user_profiles;

-- Readable: myself; staff I own; my own parent admin (the staff dashboard and
-- the agent portal both resolve their admin by id); colleagues in my tenant
-- (staff only — a client or sacco_member never enumerates staff); everything,
-- for super_admin / director.
create policy user_profiles_select on public.user_profiles
for select to authenticated
using (
  id = auth.uid()
  or admin_id = auth.uid()
  or id = public.current_admin_id()
  or (public.is_staff_member() and admin_id = public.current_admin_id())
  or public.is_global_viewer()
);

create policy user_profiles_insert on public.user_profiles
for insert to authenticated
with check (
  id = auth.uid()
  or admin_id = auth.uid()
  or (public.is_staff_member() and admin_id = public.current_admin_id())
  or public.is_global_viewer()
);

create policy user_profiles_update on public.user_profiles
for update to authenticated
using (
  id = auth.uid()
  or admin_id = auth.uid()
  or (public.is_staff_member() and admin_id = public.current_admin_id())
  or public.is_global_viewer()
)
with check (
  id = auth.uid()
  or admin_id = auth.uid()
  or (public.is_staff_member() and admin_id = public.current_admin_id())
  or public.is_global_viewer()
);

-- Deliberately NOT self-deletable: a user who removes their own row comes back
-- with role = null, which RoleGuard.jsx treats as "allow through".
create policy user_profiles_delete on public.user_profiles
for delete to authenticated
using (
  admin_id = auth.uid()
  or public.is_global_viewer()
);

-- ---------------------------------------------------------------------------
-- 4. Strip grants that RLS was the only thing standing in front of.
--    anon held SELECT/INSERT/UPDATE/DELETE here; TRUNCATE is not filtered by
--    RLS at all, so no end-user role should ever hold it.
-- ---------------------------------------------------------------------------
revoke all on public.user_profiles from anon;
revoke truncate, references, trigger on public.user_profiles from authenticated;

commit;

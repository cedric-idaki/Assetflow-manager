-- ===========================================================================
-- PER-USER / PER-TENANT DATA ISOLATION
--
-- Symptom this closes: a newly registered admin logs in and sees an EXISTING
-- admin's data (names, staff list, assets, payments, dashboard totals).
--
-- Three independent causes, all fixed here:
--
--   1. `assets` and `payments` have NO tenant column in the live database, so
--      the tenant policies 20260628120000_tenant_isolation.sql intended for
--      them were never created. What still governs those two tables is
--      `staff_manage_all_assets` / `staff_manage_all_payments` from
--      20260305230000_add_missing_roles.sql:
--
--          USING (EXISTS (SELECT 1 FROM user_profiles up
--                          WHERE up.id = auth.uid()
--                            AND up.role IN ('admin','director',...)))
--
--      That is a ROLE test, not an OWNERSHIP test: every admin of every tenant
--      matches it, so every admin reads and writes every other admin's assets
--      and payments. Same class of bug for the older `authenticated_manage_*`
--      policies (USING (true)).
--
--   2. `user_profiles` may still carry `users_view_all_profiles USING (true)`
--      from the original schema. user_profiles is also the HR/employee table,
--      so that policy shows a brand-new admin every other admin's name, phone,
--      salary and identity fields. 20260802130000 fixed this but is not
--      recorded as applied in supabase_migrations.schema_migrations, and the
--      live history disagrees with the live schema in both directions, so this
--      migration re-asserts the correct end state rather than assuming it.
--
--   3. `is_global_viewer()` treated `director` as a PLATFORM role. Directors
--      are tenant staff — create-staff-user lets any admin/sacco_admin mint one
--      — so any tenant could hand itself a cross-tenant reader. Global view is
--      now super_admin only.
--
-- Everything here is idempotent and transactional: it can be run more than
-- once, and it either lands whole or not at all.
--
-- EXISTING DATA: no row is deleted and no ownership is guessed. Backfill uses
-- only signals already stored on the row (registered_by / processed_by /
-- client_id). Rows that cannot be resolved keep admin_id = NULL and are
-- reported by the NOTICE at the end of this file and by
-- supabase/checks/verify_tenant_isolation.sql. A NULL-owner row is visible to
-- super_admin only — decide its owner manually, do not bulk-assign it.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. OWNERSHIP HELPERS
--    SECURITY DEFINER so policies that call them do not recurse through RLS.
-- ---------------------------------------------------------------------------

-- The tenant that owns a given auth user: an admin owns itself, everyone else
-- is owned by their admin_id. This is the house rule already used by
-- client_can_browse_asset() and current_admin_id().
create or replace function public.tenant_of_user(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_user is null then null
    else (select coalesce(up.admin_id, up.id)
            from public.user_profiles up
           where up.id = p_user)
  end;
$$;

revoke execute on function public.tenant_of_user(uuid) from public, anon;
grant  execute on function public.tenant_of_user(uuid) to authenticated;

-- Re-assert (unchanged) so the tenancy model is present even if
-- 20260628120000 never landed on this database.
create or replace function public.current_admin_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select up.admin_id from public.user_profiles up where up.id = auth.uid()),
    auth.uid()
  );
$$;

-- Keeps 20260708130000's correction: sacco_member is excluded as well as
-- client. Both are end users of a tenant, not staff of it — a member whose
-- admin_id points at the sacco admin would otherwise inherit manage rights
-- over every tenant table.
create or replace function public.is_staff_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_profiles up
     where up.id = auth.uid()
       and up.role not in ('client'::public.user_role,
                           'sacco_member'::public.user_role)
  );
$$;

-- CHANGED: super_admin only. `director` is a tenant role (an admin can create
-- one), so leaving it here let any tenant grant itself a platform-wide reader.
-- A director now sees their own tenant, through the same policies as the rest
-- of that tenant's staff.
create or replace function public.is_global_viewer()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_profiles up
     where up.id = auth.uid()
       and up.role = 'super_admin'::public.user_role
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. ASSETS — add the missing tenant column, backfill, auto-stamp, re-policy
-- ---------------------------------------------------------------------------
alter table public.assets add column if not exists admin_id uuid;
create index if not exists idx_assets_admin_id on public.assets (admin_id);

-- Backfill from the owner signals the row already carries. tenant_of_user()
-- maps a staff member's id to the admin that owns them, so an asset registered
-- by staff lands in the right tenant instead of becoming its own island.
update public.assets a
   set admin_id = public.tenant_of_user(a.registered_by)
 where a.admin_id is null
   and a.registered_by is not null
   and public.tenant_of_user(a.registered_by) is not null;

update public.assets a
   set admin_id = c.admin_id
  from public.clients c
 where a.admin_id is null
   and a.linked_client_id = c.id
   and c.admin_id is not null;

-- Stamp new rows server-side. Deriving the tenant here rather than trusting a
-- client-supplied admin_id is what makes the WITH CHECK below meaningful.
-- The fallbacks matter for service-role writers (ingest-assets), where
-- auth.uid() is NULL and current_admin_id() therefore resolves to NULL.
create or replace function public.set_assets_admin_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.admin_id is null then
    new.admin_id := coalesce(
      public.current_admin_id(),
      public.tenant_of_user(new.registered_by),
      (select c.admin_id from public.clients c where c.id = new.linked_client_id)
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.set_assets_admin_id() from public, anon, authenticated;

drop trigger if exists set_admin_id_assets on public.assets;
create trigger set_admin_id_assets
  before insert on public.assets
  for each row execute function public.set_assets_admin_id();

alter table public.assets enable row level security;

-- Every historical policy on this table, dropped by name. The two role-based
-- ones are the actual leak; the rest are dropped so the surviving set is
-- exactly what is created below (PERMISSIVE policies OR together — one stale
-- open policy would defeat all of this).
drop policy if exists "authenticated_manage_assets"          on public.assets;
drop policy if exists "staff_manage_all_assets"              on public.assets;
drop policy if exists "tenant_manage_assets"                 on public.assets;
drop policy if exists "assets_tenant_staff"                  on public.assets;
drop policy if exists "clients_read_own_assets"              on public.assets;
drop policy if exists "clients_browse_company_market_assets" on public.assets;

-- Tenant staff: full control over their own tenant's assets only.
create policy "assets_tenant_staff"
on public.assets for all to authenticated
using      ((admin_id = public.current_admin_id() and public.is_staff_member())
            or public.is_global_viewer())
with check ((admin_id = public.current_admin_id() and public.is_staff_member())
            or public.is_global_viewer());

-- Client portal: the assets that are theirs…
create policy "clients_read_own_assets"
on public.assets for select to authenticated
using (linked_client_id = public.get_client_id_for_user());

-- …and the ones their own company currently has on the market. Scoped by
-- admin_id now that the column exists (registered_by only ever named the
-- individual who keyed the row in).
create policy "clients_browse_company_market_assets"
on public.assets for select to authenticated
using (
  asset_status = 'available'
  and admin_id is not null
  and admin_id = public.get_client_admin_id_for_user()
);

-- ---------------------------------------------------------------------------
-- 3. PAYMENTS — same treatment
--    NOTE: supabase/functions/_shared/mpesa-settle.ts already inserts
--    payments.admin_id. Because the column does not exist, every M-Pesa
--    collection insert has been failing (it logs "UNRECORDED M-PESA PAYMENT").
--    Adding the column fixes that path as well as the isolation hole.
-- ---------------------------------------------------------------------------
alter table public.payments add column if not exists admin_id uuid;
create index if not exists idx_payments_admin_id on public.payments (admin_id);

update public.payments p
   set admin_id = c.admin_id
  from public.clients c
 where p.admin_id is null
   and p.client_id = c.id
   and c.admin_id is not null;

update public.payments p
   set admin_id = public.tenant_of_user(p.processed_by)
 where p.admin_id is null
   and p.processed_by is not null
   and public.tenant_of_user(p.processed_by) is not null;

create or replace function public.set_payments_admin_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.admin_id is null then
    -- Client first: a payment belongs to the tenant that owns the client it
    -- settles. If that disagrees with the caller's tenant the WITH CHECK below
    -- rejects the insert, which is the outcome we want.
    new.admin_id := coalesce(
      (select c.admin_id from public.clients c where c.id = new.client_id),
      public.current_admin_id(),
      public.tenant_of_user(new.processed_by)
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.set_payments_admin_id() from public, anon, authenticated;

drop trigger if exists set_admin_id_payments on public.payments;
create trigger set_admin_id_payments
  before insert on public.payments
  for each row execute function public.set_payments_admin_id();

alter table public.payments enable row level security;

drop policy if exists "authenticated_manage_payments" on public.payments;
drop policy if exists "staff_manage_all_payments"     on public.payments;
drop policy if exists "tenant_manage_payments"        on public.payments;
drop policy if exists "payments_tenant_staff"         on public.payments;
drop policy if exists "clients_read_own_payments"     on public.payments;

create policy "payments_tenant_staff"
on public.payments for all to authenticated
using      ((admin_id = public.current_admin_id() and public.is_staff_member())
            or public.is_global_viewer())
with check ((admin_id = public.current_admin_id() and public.is_staff_member())
            or public.is_global_viewer());

create policy "clients_read_own_payments"
on public.payments for select to authenticated
using (client_id = public.get_client_id_for_user());

-- ---------------------------------------------------------------------------
-- 4. CLIENTS / AGENTS / AUDIT_LOGS — re-assert the tenant policies
--    These tables already carry admin_id, but the open policies they were
--    meant to replace may still be live (the ledger cannot tell us).
-- ---------------------------------------------------------------------------
alter table public.clients    enable row level security;
alter table public.agents     enable row level security;
alter table public.audit_logs enable row level security;

-- Re-asserted here because this database may not have 20260628120000.
create or replace function public.set_admin_id_default()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.admin_id is null then
    new.admin_id := public.current_admin_id();
  end if;
  return new;
end;
$$;

revoke execute on function public.set_admin_id_default() from public, anon, authenticated;

drop trigger if exists set_admin_id_clients on public.clients;
create trigger set_admin_id_clients
  before insert on public.clients
  for each row execute function public.set_admin_id_default();

drop trigger if exists set_admin_id_agents on public.agents;
create trigger set_admin_id_agents
  before insert on public.agents
  for each row execute function public.set_admin_id_default();

drop trigger if exists set_admin_id_audit_logs on public.audit_logs;
create trigger set_admin_id_audit_logs
  before insert on public.audit_logs
  for each row execute function public.set_admin_id_default();

-- clients
drop policy if exists "authenticated_manage_clients" on public.clients;
drop policy if exists "staff_read_all_clients"       on public.clients;
drop policy if exists "staff_manage_all_clients"     on public.clients;
drop policy if exists "tenant_manage_clients"        on public.clients;
drop policy if exists "clients_tenant_manage"        on public.clients;
drop policy if exists "clients_read_own_row"         on public.clients;
drop policy if exists "clients_self_update"          on public.clients;

create policy "tenant_manage_clients"
on public.clients for all to authenticated
using      ((admin_id = public.current_admin_id() and public.is_staff_member())
            or public.is_global_viewer())
with check ((admin_id = public.current_admin_id() and public.is_staff_member())
            or public.is_global_viewer());

-- The client-portal login reads its own row. client_auth_id is the hard link;
-- email is the fallback for accounts provisioned before that column existed.
create policy "clients_read_own_row"
on public.clients for select to authenticated
using (
  (client_auth_id is not null and client_auth_id = auth.uid())
  or (client_auth_id is null and email is not null
      and lower(email) = lower(coalesce(auth.email(), '')))
);

-- The portal's KYC tab writes back to the client's own row.
create policy "clients_self_update"
on public.clients for update to authenticated
using (
  (client_auth_id is not null and client_auth_id = auth.uid())
  or (client_auth_id is null and email is not null
      and lower(email) = lower(coalesce(auth.email(), '')))
)
with check (
  (client_auth_id is not null and client_auth_id = auth.uid())
  or (client_auth_id is null and email is not null
      and lower(email) = lower(coalesce(auth.email(), '')))
);

-- …but a client may not re-parent themselves. RLS can express "your own row";
-- it cannot express "you may not change THIS column", so the guard is a
-- trigger. Without it, a portal user could move their record into another
-- tenant by updating admin_id, taking their assets and payments with them.
create or replace function public.guard_client_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then           -- service_role: trusted caller
    return new;
  end if;
  if new.admin_id is distinct from old.admin_id and not public.is_staff_member() then
    raise exception 'clients: not authorised to change the owning tenant'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_client_owner() from public, anon, authenticated;

drop trigger if exists guard_client_owner on public.clients;
create trigger guard_client_owner
  before update on public.clients
  for each row execute function public.guard_client_owner();

-- agents
drop policy if exists "authenticated_manage_agents" on public.agents;
drop policy if exists "staff_manage_all_agents"     on public.agents;
drop policy if exists "tenant_manage_agents"        on public.agents;
drop policy if exists "agents_read_own_row"         on public.agents;

create policy "tenant_manage_agents"
on public.agents for all to authenticated
using      ((admin_id = public.current_admin_id() and public.is_staff_member())
            or public.is_global_viewer())
with check ((admin_id = public.current_admin_id() and public.is_staff_member())
            or public.is_global_viewer());

create policy "agents_read_own_row"
on public.agents for select to authenticated
using (user_id = auth.uid());

-- audit_logs
drop policy if exists "authenticated_view_audit_logs"   on public.audit_logs;
drop policy if exists "authenticated_insert_audit_logs" on public.audit_logs;
drop policy if exists "tenant_view_audit_logs"          on public.audit_logs;
drop policy if exists "tenant_insert_audit_logs"        on public.audit_logs;

-- Self-scoped roles (client, sales agent, sacco member) read the rows that
-- name them; tenant staff read their tenant's trail. Header.jsx already filters
-- this way — the policy is what makes the filter enforceable.
create policy "tenant_view_audit_logs"
on public.audit_logs for select to authenticated
using (
  (admin_id = public.current_admin_id() and public.is_staff_member())
  or user_id = auth.uid()
  or client_id = public.get_client_id_for_user()
  or public.is_global_viewer()
);

-- Append-only; the BEFORE INSERT trigger stamps the tenant.
create policy "tenant_insert_audit_logs"
on public.audit_logs for insert to authenticated
with check (true);

-- ---------------------------------------------------------------------------
-- 5. USER_PROFILES — re-assert the privilege lockdown (20260802130000)
--    This is the table that leaks another admin's NAME, phone, salary and
--    identity fields into a new admin's HR / user-management screens.
-- ---------------------------------------------------------------------------
alter table public.user_profiles enable row level security;

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
  -- No JWT ⇒ service_role (edge functions, SQL editor, cron): trusted, and
  -- create-staff-user has already run its own authorisation matrix by here.
  if caller is null then
    return new;
  end if;

  if new.role is not distinct from old.role
     and new.admin_id is not distinct from old.admin_id then
    return new;
  end if;

  select up.role into caller_role
    from public.user_profiles up
   where up.id = caller;

  if caller_role = 'super_admin'::public.user_role then
    return new;
  end if;

  -- A tenant owner may set roles on staff it owns, but may never mint a
  -- platform role, another tenant owner, or move a row into another tenant.
  -- 'director' is no longer on this list: it stopped being a platform role
  -- when is_global_viewer() narrowed to super_admin, so it is now an ordinary
  -- tenant role an admin is allowed to grant.
  if caller_role in ('admin'::public.user_role, 'sacco_admin'::public.user_role)
     and old.admin_id = caller
     and new.admin_id = caller
     and new.role not in ('super_admin'::public.user_role,
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

revoke execute on function public.guard_user_profile_privileges() from public, anon, authenticated;

drop trigger if exists guard_user_profile_privileges on public.user_profiles;
create trigger guard_user_profile_privileges
  before update on public.user_profiles
  for each row execute function public.guard_user_profile_privileges();

-- Signup metadata is client-controlled, so the role it asks for is clamped.
-- 'admin' / 'sacco_admin' stay allowed — that is the self-serve product signup
-- (src/pages/admin-registration) and both are tenant-scoped. The profile is
-- created for NEW.id with that user's own values only; nothing is copied from
-- any other row.
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

drop policy if exists "authenticated_full_access"                  on public.user_profiles;
drop policy if exists "Allow authenticated users to read profiles" on public.user_profiles;
drop policy if exists "users_view_all_profiles"                    on public.user_profiles;
drop policy if exists "users_update_own_profile"                   on public.user_profiles;
drop policy if exists "profiles_access"                            on public.user_profiles;
drop policy if exists "user_profiles_select"                       on public.user_profiles;
drop policy if exists "user_profiles_insert"                       on public.user_profiles;
drop policy if exists "user_profiles_update"                       on public.user_profiles;
drop policy if exists "user_profiles_delete"                       on public.user_profiles;

create policy user_profiles_select on public.user_profiles
for select to authenticated
using (
  id = auth.uid()                                                  -- myself
  or admin_id = auth.uid()                                         -- staff I own
  or id = public.current_admin_id()                                -- my own admin
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

-- Deliberately not self-deletable: a user who deletes their own row comes back
-- with role = null, which every guard has to treat as "no access".
create policy user_profiles_delete on public.user_profiles
for delete to authenticated
using (admin_id = auth.uid() or public.is_global_viewer());

-- ---------------------------------------------------------------------------
-- 5b. SWEEP — drop any policy on these tables that this migration did not just
--     create.
--
--     This is the step that makes the fix hold. PERMISSIVE policies OR
--     together, so ONE forgotten open policy re-opens the whole table no
--     matter how correct the others are — and this database's migration
--     ledger does not match its schema, so the surviving set cannot be
--     predicted from the files in this repo. Rather than guess at names, drop
--     everything that is not in the intended set, which is fully recreated
--     above.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  keep text[] := array[
    -- assets
    'assets_tenant_staff', 'clients_read_own_assets', 'clients_browse_company_market_assets',
    -- payments
    'payments_tenant_staff', 'clients_read_own_payments',
    -- clients
    'tenant_manage_clients', 'clients_read_own_row', 'clients_self_update',
    -- agents
    'tenant_manage_agents', 'agents_read_own_row',
    -- audit_logs
    'tenant_view_audit_logs', 'tenant_insert_audit_logs',
    -- user_profiles
    'user_profiles_select', 'user_profiles_insert', 'user_profiles_update', 'user_profiles_delete'
  ];
begin
  for r in
    select policyname, tablename
      from pg_policies
     where schemaname = 'public'
       and tablename in ('assets','payments','clients','agents','audit_logs','user_profiles')
       and not (policyname = any (keep))
  loop
    raise notice 'Dropping superseded policy %.% — not part of the tenant model',
      r.tablename, r.policyname;
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. GRANT-LEVEL BACKSTOP
--    RLS filters rows for anon, but TRUNCATE is not filtered by RLS at all and
--    no end-user role should hold it.
-- ---------------------------------------------------------------------------
revoke all on public.user_profiles from anon;
revoke all on public.assets       from anon;
revoke all on public.payments     from anon;
revoke truncate, references, trigger on
  public.user_profiles, public.assets, public.payments,
  public.clients, public.agents, public.audit_logs
  from authenticated;

-- ---------------------------------------------------------------------------
-- 7. OPTIONAL FKs — only where every value already resolves to a real auth
--    user. Skipped with a NOTICE otherwise: an orphaned admin_id is a data
--    question for a human, not a reason to fail the migration.
-- ---------------------------------------------------------------------------
do $$
declare
  orphans bigint;
begin
  select count(*) into orphans
    from public.assets a
   where a.admin_id is not null
     and not exists (select 1 from auth.users u where u.id = a.admin_id);

  if orphans = 0 then
    if not exists (select 1 from pg_constraint where conname = 'assets_admin_id_fkey') then
      -- Referencing auth.users needs REFERENCES on a table this role may not
      -- own. The FK is a nicety; isolation does not depend on it, so a refusal
      -- must not take the rest of the migration down with it.
      begin
        alter table public.assets
          add constraint assets_admin_id_fkey
          foreign key (admin_id) references auth.users (id) on delete set null;
      exception when insufficient_privilege or undefined_table then
        raise notice 'assets.admin_id: FK to auth.users skipped (%).', sqlerrm;
      end;
    end if;
  else
    raise notice 'assets.admin_id: % row(s) point at a missing auth user — FK not added', orphans;
  end if;

  select count(*) into orphans
    from public.payments p
   where p.admin_id is not null
     and not exists (select 1 from auth.users u where u.id = p.admin_id);

  if orphans = 0 then
    if not exists (select 1 from pg_constraint where conname = 'payments_admin_id_fkey') then
      begin
        alter table public.payments
          add constraint payments_admin_id_fkey
          foreign key (admin_id) references auth.users (id) on delete set null;
      exception when insufficient_privilege or undefined_table then
        raise notice 'payments.admin_id: FK to auth.users skipped (%).', sqlerrm;
      end;
    end if;
  else
    raise notice 'payments.admin_id: % row(s) point at a missing auth user — FK not added', orphans;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. REPORT — rows this migration could not attribute to a tenant.
--    They are NOT deleted and NOT guessed at; they are simply invisible to
--    everyone except super_admin until someone sets their owner deliberately.
-- ---------------------------------------------------------------------------
do $$
declare
  a_null bigint;
  p_null bigint;
  c_null bigint;
  g_null bigint;
begin
  select count(*) into a_null from public.assets     where admin_id is null;
  select count(*) into p_null from public.payments   where admin_id is null;
  select count(*) into c_null from public.clients    where admin_id is null;
  select count(*) into g_null from public.agents     where admin_id is null;

  raise notice 'UNOWNED ROWS AFTER BACKFILL — assets: %, payments: %, clients: %, agents: %',
    a_null, p_null, c_null, g_null;
  raise notice 'Run supabase/checks/verify_tenant_isolation.sql to list them.';
end;
$$;

commit;

-- ===========================================================================
-- COMPANY CONTRACTS: CLOSE THE CROSS-TENANT READ/WRITE PATH
--
-- Found by supabase/checks/verify_tenant_isolation.sql on 2026-08-22, section 1.
--
-- What was wrong
-- --------------
-- company_contracts carried FOUR permissive policies. Postgres combines
-- permissive policies with OR, so the table is as open as its LOOSEST policy —
-- a correct policy sitting next to a loose one buys nothing.
--
--   scoped_company_contracts_access  ALL   admin_id = auth.uid() OR super_admin
--   staff_manage_company_contracts   ALL   up.role IN (super_admin, admin,
--                                          director, accountant, collections,
--                                          sales, operations, manager, finance)
--
-- The second is a ROLE test with no ownership term. ORed against the first it
-- swallows it whole: any staff member at those nine roles, in ANY tenant, could
-- read and write EVERY tenant's contracts — commercial terms and counterparty
-- data. This is the same class of bug 20260817120000 removed from `assets` and
-- `payments` (staff_manage_all_assets / staff_manage_all_payments); that
-- migration simply did not cover this table.
--
-- Why the scoped policy could not just be left on its own
-- ------------------------------------------------------
-- scoped_company_contracts_access tests `admin_id = auth.uid()`. That is true
-- for a tenant ADMIN (whose own uid is the tenant root) but false for every
-- member of that admin's STAFF, whose auth.uid() is their own id and whose
-- tenant root is user_profiles.admin_id. Dropping the role policy without
-- fixing this one would have closed the leak by locking accountants,
-- collections, sales and operations out of their own tenant's contracts.
--
-- So the scoped policy is re-asserted using the canonical tenant predicate
-- already in force on assets and payments:
--
--     ((admin_id = current_admin_id()) and is_staff_member()) or is_global_viewer()
--
--   current_admin_id()  coalesce(user_profiles.admin_id, auth.uid()) — the
--                       caller's tenant root: themselves for an admin, their
--                       admin for staff.
--   is_staff_member()   any role except client / sacco_member, so the portal
--                       roles cannot ride the staff branch.
--   is_global_viewer()  super_admin only (narrowed by 20260817120000).
--
-- Untouched, because both are already ownership tests and serve the portals:
--   clients_read_own_company_contracts  SELECT  client_id = get_client_id_for_user()
--   member_read_own_contracts           SELECT  member_id = current_sacco_member_id()
--
-- Idempotent and transactional: safe to re-run, lands whole or not at all.
-- No row is read, written or deleted — this changes policy only.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Remove the role-based grant. This is the leak.
-- ---------------------------------------------------------------------------
drop policy if exists staff_manage_company_contracts on public.company_contracts;

-- Older names for the same idea, dropped defensively: the live policy set and
-- the migration ledger disagree in this project, so a name that is absent here
-- may still exist on another database built from the same history.
drop policy if exists authenticated_manage_company_contracts on public.company_contracts;
drop policy if exists company_contracts_staff_all           on public.company_contracts;

-- ---------------------------------------------------------------------------
-- 2. Re-assert tenant scope so staff keep their OWN tenant's contracts.
-- ---------------------------------------------------------------------------
drop policy if exists scoped_company_contracts_access on public.company_contracts;

create policy scoped_company_contracts_access
  on public.company_contracts
  for all
  to authenticated
  using (
    ((admin_id = public.current_admin_id()) and public.is_staff_member())
    or public.is_global_viewer()
  )
  with check (
    ((admin_id = public.current_admin_id()) and public.is_staff_member())
    or public.is_global_viewer()
  );

-- ---------------------------------------------------------------------------
-- 3. RLS must actually be on for any of the above to matter.
-- ---------------------------------------------------------------------------
alter table public.company_contracts enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Report rows that no tenant can now reach, without guessing an owner.
--    A NULL admin_id row is visible to super_admin only. Assign it by hand;
--    do NOT bulk-assign, for the reasons given in 20260817120000.
-- ---------------------------------------------------------------------------
do $$
declare orphaned bigint;
begin
  select count(*) into orphaned
    from public.company_contracts where admin_id is null;
  if orphaned > 0 then
    raise notice 'company_contracts: % row(s) have admin_id IS NULL and are now super_admin-only. Assign an owner manually.', orphaned;
  else
    raise notice 'company_contracts: every row has an owner.';
  end if;
end $$;

commit;

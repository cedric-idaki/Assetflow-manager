-- ===========================================================================
-- READ-ONLY preflight for 20260822150000_tenant_module_entitlements.sql
--
-- Nothing here writes, drops or locks anything. Paste the whole file into the
-- Supabase SQL editor and read the results before applying the migration.
--
-- WHY THIS EXISTS
-- `supabase db push --dry-run` cannot answer this question on this project.
-- The remote migration history lists 58 local files as unapplied that are in
-- fact live (checked 2026-08-22), so push refuses, and --include-all would
-- replay all 58 against a schema that already has them. The migration is
-- therefore applied by hand in the SQL editor — which means the things push
-- would normally catch have to be checked here instead.
--
-- WHAT WOULD ACTUALLY BREAK
-- Section 1 is the one that matters. public.module_enabled() is a LANGUAGE SQL
-- function that calls current_admin_id(); my_tenant_modules() calls it too, and
-- enforce_module_write() calls is_global_viewer(). Postgres validates SQL
-- function bodies at CREATE time, so if any of those three is missing the
-- migration aborts on section 3 — before it has created anything. That is a
-- clean failure, not a half-applied one, but it is better known in advance.
-- ===========================================================================

-- ── 1. PREREQUISITE FUNCTIONS ───────────────────────────────────────────────
-- All three must say PRESENT. Any MISSING row means the migration that defines
-- it has to land first:
--   current_admin_id  / tenant_of_user / is_global_viewer
--     → 20260817120000_per_user_data_isolation.sql
select
  f.name                                                as required_function,
  case when p.oid is null then 'MISSING — apply 20260817120000 first'
       else 'PRESENT' end                               as status,
  pg_get_function_identity_arguments(p.oid)             as signature
from (values
  ('current_admin_id'),
  ('tenant_of_user'),
  ('is_global_viewer')
) as f(name)
left join pg_proc p
       on p.proname = f.name
      and p.pronamespace = 'public'::regnamespace
order by 1;

-- ── 2. IS IT ALREADY THERE? ─────────────────────────────────────────────────
-- The migration is idempotent, so a partial earlier run is safe to re-apply.
-- This just tells you which state you are starting from.
select
  'tenant_modules table'                                as object,
  case when to_regclass('public.tenant_modules') is null
       then 'not present — first run'
       else 'already present — re-run is safe (idempotent)' end as status
union all
select
  'module_catalogue()',
  case when exists (select 1 from pg_proc
                     where proname = 'module_catalogue'
                       and pronamespace = 'public'::regnamespace)
       then 'already present' else 'not present — first run' end
union all
select
  'existing tenant_modules rows',
  case when to_regclass('public.tenant_modules') is null then '0 (table absent)'
       else (select count(*)::text from public.tenant_modules) end;

-- ── 3. TRIGGER TARGETS ──────────────────────────────────────────────────────
-- The migration attaches trg_module_gate to each of these and SKIPS any that
-- is absent (with a NOTICE). Rows marked ABSENT are modules that lose
-- database-level enforcement — the sidebar and route guard still hide them,
-- but a direct Supabase call could still write.
--
-- Checked against the live database 2026-08-22: 27 of 28 present. The only
-- absentee is `employee_private_data`, because the employee PII encryption
-- rollout (20260813180000) has not been applied. See the note on the `hr`
-- module in the migration header for what that costs.
select
  t.tbl                                                 as target_table,
  t.module_key,
  case when to_regclass('public.' || t.tbl) is null
       then 'ABSENT — trigger skipped, UI-only enforcement'
       else 'present — will be gated' end               as status
from (values
  ('assets','assets'),
  ('installment_plans','hire_purchase'),
  ('kyc_documents','kyc'),
  ('esign_documents','esign'),
  ('esign_templates','esign'),
  ('company_contracts','contracts'),
  ('crm_interactions','crm'),
  ('leads','crm'),
  ('follow_ups','crm'),
  ('employee_private_data','hr'),
  ('payroll_records','payroll'),
  ('company_invoices','accounting'),
  ('sacco_journal_entries','accounting'),
  ('sacco_members','members'),
  ('sacco_contributions','contributions'),
  ('sacco_contribution_types','contributions'),
  ('sacco_loans','loans'),
  ('sacco_loan_products','loans'),
  ('sacco_shares','shares'),
  ('sacco_share_transactions','shares'),
  ('sacco_share_listings','shares'),
  ('sacco_elections','voting'),
  ('sacco_votes','voting'),
  ('sacco_motions','voting'),
  ('sacco_welfare_claims','welfare'),
  ('sacco_mgr_contributions','mgr'),
  ('sacco_mgr_cycles','mgr'),
  ('mpesa_tenant_credentials','mpesa')
) as t(tbl, module_key)
order by status desc, module_key, target_table;

-- ── 4. NAME COLLISIONS ──────────────────────────────────────────────────────
-- The migration drops and recreates a trigger called trg_module_gate. If any
-- row comes back here that this migration did not create, something else owns
-- that name and would be destroyed. Expect zero rows on a first run.
select
  c.relname   as table_name,
  tg.tgname   as trigger_name,
  'would be dropped and recreated' as effect
from pg_trigger tg
join pg_class c on c.oid = tg.tgrelid
where tg.tgname = 'trg_module_gate'
  and not tg.tgisinternal
order by 1;

-- ── 5. BACKFILL SIZE ────────────────────────────────────────────────────────
-- Every existing tenant is seeded with ALL modules ENABLED, so nothing about
-- any current portal changes on the day this runs. This is how many rows that
-- writes: one per tenant per module (21 modules).
select
  count(*)                                              as tenants_to_backfill,
  count(*) * 21                                         as rows_to_insert
from public.user_profiles
where role::text in ('admin', 'sacco_admin');

-- Which tenants those are, so the count above can be sanity-checked against
-- what you know is really live.
select
  up.id,
  up.email,
  up.role::text                                         as role,
  coalesce(cp.company_name, s.name, '(no tenant record)') as organisation
from public.user_profiles up
left join public.company_profiles cp on cp.admin_id = up.id
left join public.saccos           s  on s.admin_id  = up.id
where up.role::text in ('admin', 'sacco_admin')
order by up.role, organisation;

-- ── 6. AFTER APPLYING — confirm ─────────────────────────────────────────────
-- Re-run sections 2 and 3 above. Then this should return one row per module
-- for the signed-in tenant, all 'enabled':
--
--   select * from public.my_tenant_modules() order by module_key;
--
-- And record the migration so the history stops drifting further:
--
--   npx supabase migration repair --status applied 20260822150000
-- ===========================================================================

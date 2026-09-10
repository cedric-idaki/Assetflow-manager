-- ===========================================================================
-- PREFLIGHT for 20260830140000_lead_deal_value.sql
--
-- Read-only. Run with:
--   npx supabase db query --linked -f supabase/checks/preflight_lead_deal_value.sql
--
-- This project's migration history has drifted from the live schema in BOTH
-- directions, and `db push --dry-run` refuses outright, so probing is the only
-- preflight that works. Same pattern as preflight_tenant_modules.sql.
--
-- What each section is actually checking for:
--
--   1. The target table exists, and HOW BIG it is — the two new indexes are
--      built over it, and a partial index on a small table is free while one on
--      a large table is a lock worth knowing about in advance.
--   2. Whether the three columns are already there. The migration is
--      idempotent, but drift on this project means a column can exist live
--      while appearing in no local migration (see the clients.nok_* case), and
--      a pre-existing `deal_value` of a different TYPE would make the whole
--      apply fail rather than no-op.
--   3. The lead_stage enum still has 'closed'. Both index predicates cast to
--      it, so a renamed or missing label aborts the apply.
--   4. Name collisions on the constraints and indexes being created.
--   5. Whether the version is already stamped in the history table.
-- ===========================================================================

-- 1. Target table and its size ---------------------------------------------
select
  'leads table' as check,
  to_regclass('public.leads')::text as found,
  (select count(*) from public.leads) as row_count,
  (select count(*) from public.leads where stage <> 'closed'::public.lead_stage) as open_rows,
  (select count(*) from public.leads where budget_range is not null
     and btrim(budget_range) <> '') as with_budget_note;

-- 2. Do the columns already exist, and as what? -----------------------------
--    An empty result is the expected, healthy answer.
select
  'existing target columns' as check,
  column_name, data_type, numeric_precision, numeric_scale, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'leads'
  and column_name in ('deal_value', 'expected_close_date', 'win_probability');

-- 2b. Anything else money-shaped already on the table, added out of band?
--     Drift on this project hides dashboard-added columns from the repo
--     entirely, so grep is not a way to learn what leads actually has.
select
  'all leads columns' as check,
  string_agg(column_name, ', ' order by ordinal_position) as columns
from information_schema.columns
where table_schema = 'public' and table_name = 'leads';

-- 3. The enum the index predicates cast to ----------------------------------
select
  'lead_stage labels' as check,
  string_agg(enumlabel, ', ' order by enumsortorder) as labels
from pg_enum
where enumtypid = 'public.lead_stage'::regtype;

-- 4. Name collisions --------------------------------------------------------
select 'constraint collisions' as check, conname
from pg_constraint
where conrelid = 'public.leads'::regclass
  and conname in ('leads_deal_value_check', 'leads_win_probability_check');

select 'index collisions' as check, indexname
from pg_indexes
where schemaname = 'public'
  and indexname in ('idx_leads_agent_expected_close', 'idx_leads_agent_deal_value');

-- 5. Is this version already recorded? --------------------------------------
select 'history row' as check, version, name
from supabase_migrations.schema_migrations
where version = '20260830140000';

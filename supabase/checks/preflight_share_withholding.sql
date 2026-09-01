-- ===========================================================================
-- READ-ONLY preflight for 20260901120000_sacco_share_withholding.sql
--
-- Nothing here writes, drops or locks anything. Paste the whole file into the
-- Supabase SQL editor and read the results before applying the migration.
--
-- WHY THIS EXISTS
-- `supabase db push` cannot be trusted on this project: the remote migration
-- history disagrees with the live schema in both directions, so the file is
-- applied by hand in the SQL editor. That means the things push would normally
-- catch have to be checked here instead.
--
-- WHAT WOULD ACTUALLY BREAK
-- Section 1 is the one that matters. The migration's RPCs call seven existing
-- share-engine helpers by name inside plpgsql bodies — which Postgres does NOT
-- validate at CREATE time, so a missing helper does not fail the migration, it
-- fails the first time a treasurer clicks Withhold. Check them here instead.
--
-- Section 4 is the one to read twice. This migration adds a BEFORE UPDATE
-- trigger to public.sacco_shares — the busiest table in the share stack. It
-- returns immediately when withheld_shares is 0, which on a database with no
-- withholdings yet is every row, so the cost is one integer comparison per
-- update. But it does mean every existing write path now runs it.
-- ===========================================================================

-- ── 1. PREREQUISITE FUNCTIONS ───────────────────────────────────────────────
-- All seven must say PRESENT. Any MISSING row means the migration that defines
-- it has to land first:
--   sacco_active_sacco_id / sacco_share_require_staff / sacco_share_holding /
--   sacco_share_log / sacco_share_settings_row / sacco_share_cancel_order
--     → 20260801200000_sacco_share_engine.sql
--   set_admin_id_default
--     → 20260817120000_per_user_data_isolation.sql
select
  f.name                                                as required_function,
  case when p.oid is null then 'MISSING — the migration will apply but its RPCs will fail at runtime'
       else 'PRESENT' end                               as status,
  pg_get_function_identity_arguments(p.oid)             as signature
from (values
  ('sacco_active_sacco_id'),
  ('sacco_share_require_staff'),
  ('sacco_share_holding'),
  ('sacco_share_log'),
  ('sacco_share_settings_row'),
  ('sacco_share_cancel_order'),
  ('set_admin_id_default')
) as f(name)
left join pg_proc p
       on p.proname = f.name
      and p.pronamespace = 'public'::regnamespace
order by 1;

-- ── 2. PREREQUISITE COLUMNS ─────────────────────────────────────────────────
-- The triggers read these by name. sacco_share_listings.withholding_id is the
-- one column this migration ADDS; everything else must already be there.
--   filled_shares / side / cancel_reason  → 20260801200000
--   price_per_share / seller_fee / reversed_of / settled_at → 20260801200000
select
  c.tbl || '.' || c.col                                 as required_column,
  case when a.attname is null then 'MISSING — apply 20260801200000 first'
       else 'PRESENT' end                               as status
from (values
  ('sacco_shares','locked_shares'),
  ('sacco_shares','is_frozen'),
  ('sacco_share_listings','side'),
  ('sacco_share_listings','filled_shares'),
  ('sacco_share_listings','cancel_reason'),
  ('sacco_share_transfers','price_per_share'),
  ('sacco_share_transfers','seller_fee'),
  ('sacco_share_transfers','reversed_of')
) as c(tbl, col)
left join pg_attribute a
       on a.attrelid = ('public.' || c.tbl)::regclass
      and a.attname  = c.col
      and a.attnum > 0 and not a.attisdropped
order by 1;

-- ── 3. IS IT ALREADY THERE? ─────────────────────────────────────────────────
-- The migration is idempotent, so a partial earlier run is safe to re-apply.
-- The one thing that is NOT reset on a re-run is sacco_share_withholding_seq —
-- deliberately, so a WH- number can never be handed out twice.
select 'sacco_share_withholdings table'          as object,
       case when to_regclass('public.sacco_share_withholdings') is null
            then 'not present — first run'
            else 'already present — re-run is safe (idempotent)' end as status
union all
select 'sacco_share_withholding_events table',
       case when to_regclass('public.sacco_share_withholding_events') is null
            then 'not present — first run' else 'already present' end
union all
select 'sacco_shares.withheld_shares column',
       case when exists (select 1 from pg_attribute
                          where attrelid = 'public.sacco_shares'::regclass
                            and attname = 'withheld_shares' and attnum > 0 and not attisdropped)
            then 'already present' else 'not present — first run' end
union all
select 'sacco_share_listings.withholding_id column',
       case when exists (select 1 from pg_attribute
                          where attrelid = 'public.sacco_share_listings'::regclass
                            and attname = 'withholding_id' and attnum > 0 and not attisdropped)
            then 'already present' else 'not present — first run' end
union all
select 'existing withholding records',
       case when to_regclass('public.sacco_share_withholdings') is null then '0 (table absent)'
            else (select count(*)::text from public.sacco_share_withholdings) end;

-- ── 4. WHAT THE NEW TRIGGERS WILL SIT ON ────────────────────────────────────
-- Three triggers are added. The sacco_shares one runs on EVERY update to the
-- holdings table; the row count below is what it will be exercised against.
-- The other two only do work when a listing or transfer carries a withholding.
--
-- Note any trigger already listed here whose name collides — the migration
-- DROPs its own by name first, so a collision would mean somebody else's
-- trigger of the same name is about to disappear.
select
  t.tgname                                              as existing_trigger,
  c.relname                                             as on_table,
  case when t.tgname in ('sacco_shares_withholding_guard',
                         'sacco_share_withholding_unlist',
                         'sacco_share_withholding_settle')
       then 'COLLISION — this migration will replace it'
       else 'unrelated — untouched' end                 as note
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal
  and c.relname in ('sacco_shares', 'sacco_share_listings', 'sacco_share_transfers')
order by 2, 1;

select 'sacco_shares rows the guard trigger will run against' as scope,
       count(*)::text                                          as value
  from public.sacco_shares
union all
select 'sacco_shares rows with escrow already locked',
       count(*)::text from public.sacco_shares where coalesce(locked_shares, 0) > 0
union all
select 'open sell orders that would need re-escrowing',
       count(*)::text from public.sacco_share_listings
 where status = 'open' and coalesce(side, 'sell') = 'sell';

-- ── 5. IS THE REGISTER READY TO CARRY THE INVARIANT? ────────────────────────
-- The migration asserts shares_held >= locked_shares + withheld_shares from
-- here on. withheld_shares starts at 0 everywhere, so the only way that can be
-- violated on day one is if locked_shares ALREADY exceeds shares_held on some
-- row — pre-existing escrow drift, which the guard would then surface as a
-- confusing "shares are withheld" error on the next trade for that member.
--
-- Expect zero rows. Any row here should be reconciled BEFORE applying, by
-- cancelling that member's stale orders (which releases the escrow).
select
  sh.member_id,
  m.member_no,
  m.full_name,
  sh.shares_held,
  sh.locked_shares,
  sh.shares_held - sh.locked_shares                     as free_shares,
  'escrow exceeds the holding — reconcile before applying' as problem
from public.sacco_shares sh
left join public.sacco_members m on m.id = sh.member_id
where coalesce(sh.locked_shares, 0) > coalesce(sh.shares_held, 0)
order by 3;

-- ── 6. VALUATION SOURCE ─────────────────────────────────────────────────────
-- sacco_share_unit_value() prices a withholding as market value, falling back
-- to par. A sacco with neither cannot place withheld shares for sale without
-- naming a price by hand — which the RPC says plainly, but it is better known
-- in advance.
select
  s.name                                                as sacco,
  (select sp.market_value from public.sacco_share_prices sp
    where sp.sacco_id = s.id order by sp.effective_date desc limit 1) as market_value,
  (select ss.par_value from public.sacco_share_settings ss
    where ss.sacco_id = s.id)                           as par_value,
  case when coalesce((select nullif(sp.market_value, 0) from public.sacco_share_prices sp
                       where sp.sacco_id = s.id order by sp.effective_date desc limit 1),
                     (select nullif(ss.par_value, 0) from public.sacco_share_settings ss
                       where ss.sacco_id = s.id)) is null
       then 'NO VALUE — withheld shares will show KES 0 until a price is published'
       else 'ok' end                                    as status
from public.saccos s
order by 1;

-- ── 7. REALTIME PUBLICATION ─────────────────────────────────────────────────
-- The migration adds both new tables to supabase_realtime, swallowing
-- duplicate_object and undefined_object. If the publication does not exist on
-- this project the register still works, it just will not live-update.
select
  case when exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       then 'PRESENT — the register will live-update'
       else 'ABSENT — the register will need a manual refresh (harmless)' end
  as supabase_realtime;

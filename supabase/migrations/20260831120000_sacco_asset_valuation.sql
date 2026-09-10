-- ===========================================================================
-- SACCO ASSET VALUATION
--
-- The register (20260830200000) can already say what the SACCO owns and what
-- each individual thing is worth. What it cannot do is answer the question a
-- treasurer is actually asked at a board meeting:
--
--   "What are our assets worth, and how do we know?"
--
-- sacco_asset_register_summary() gets close — it carries total_cost,
-- total_book_value and total_current_value — but its by_category breakdown
-- holds only { count, cost, value }. There is no per-category book value, no
-- per-category depreciation, and nowhere at all does the system say how much
-- of the headline "current value" is a REAL valuation and how much is book
-- value standing in for one. A report built on that number without the split
-- is a report that presents an accountant's residual as a market opinion.
--
-- This migration adds the two functions a valuation report needs, and adds
-- nothing to the tables — every figure below is derived from columns the
-- register already stores.
--
-- THE THREE NUMBERS, AGAIN, BECAUSE THE REPORT TURNS ON THEM:
--
--   cost           what was paid. Never changes.
--   book_value     cost − accumulated depreciation. GENERATED; the ledger owns
--                  it, and it is the figure the Balance Sheet defends.
--   current_value  a valuation somebody recorded, with a date and a basis.
--                  OPTIONAL, and usually absent on most of the register.
--
--   reported value = coalesce(current_value, book_value)
--
-- The reported value is what the register has always shown per row, and both
-- functions below total it the same way so the report and the register cannot
-- disagree. But the report ALSO gets valued_current_value and valued_book_value
-- — the same two numbers restricted to the assets that carry a real valuation
-- — so it can state the revaluation surplus or deficit over a denominator that
-- means something, and say plainly how much of the book is unvalued.
--
--   revaluation_delta = valued_current_value − valued_book_value
--
-- Restricted to VALUED assets on purpose. Computing it across the whole book
-- would net every unvalued asset's (book − book) = 0 into the total, which is
-- arithmetically harmless and editorially dishonest: it would let a register
-- with four valued assets out of four hundred report a surplus as though the
-- whole book had been to a valuer.
--
-- HELD ASSETS ONLY. Both functions exclude anything disposed, written off or
-- lost, matching sacco_asset_register_summary() — a valuation report that
-- includes the value of a vehicle sold in 2019 is a report of what the SACCO
-- used to own. Disposals stay in the register and are reported by the register
-- tab; they are not part of what the SACCO is worth today.
--
-- NEITHER FUNCTION POSTS ANYTHING. A revaluation surplus is an equity movement
-- under IAS 16 and needs a treasurer's journal. This reports the gap; it does
-- not book it. Same rule as revalueAsset() in src/hooks/useAssetRegister.js.
--
-- SECURITY INVOKER throughout, so the caller's RLS decides which rows are
-- visible and neither function can become a way to read another tenant's
-- register — same pattern as sacco_dashboard_stats() and the register summary.
--
-- Idempotent and wrapped in a transaction: safe to re-run, lands whole or not
-- at all.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. VALUATION BY CATEGORY
--
-- One row per category that has at least one held asset. The report's table
-- reads this; nothing is summed in the browser.
--
-- `stale_count` uses the same 365-day threshold as VALUATION_STALE_DAYS in
-- src/config/assetRegister.js. Changing one means changing the other — a
-- valuation the report calls current while the drawer calls it stale is worse
-- than either answer alone.
-- ---------------------------------------------------------------------------

create or replace function public.sacco_asset_valuation_by_category()
returns table (
  category              text,
  asset_count           bigint,
  valued_count          bigint,
  stale_count           bigint,
  total_cost            numeric,
  total_depreciation    numeric,
  total_book_value      numeric,
  total_current_value   numeric,
  valued_current_value  numeric,
  valued_book_value     numeric,
  revaluation_delta     numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  with held as (
    select a.category,
           coalesce(a.cost, 0)                     as cost,
           coalesce(a.accumulated_depreciation, 0) as depreciation,
           coalesce(a.book_value, 0)               as book_value,
           a.current_value,
           a.valuation_date
      from public.sacco_fixed_assets a
     -- `is not true`, not a bare NOT: is_disposed is nullable on the original
     -- 2026-07 table and `not null` is null, so a row with a null flag would be
     -- counted neither as held nor as disposed and would vanish from the book.
     -- Written this way rather than as not coalesce(...) so it matches the
     -- partial index in §3 exactly — the planner cannot prove the two forms
     -- equivalent, and the coalesce spelling would leave the index unused.
     where a.is_disposed is not true
  )
  select
    h.category,
    count(*)::bigint,
    count(*) filter (where h.current_value is not null)::bigint,
    count(*) filter (
      where h.current_value is not null
        and (h.valuation_date is null or h.valuation_date < current_date - 365)
    )::bigint,
    coalesce(sum(h.cost), 0)::numeric,
    coalesce(sum(h.depreciation), 0)::numeric,
    coalesce(sum(h.book_value), 0)::numeric,
    coalesce(sum(coalesce(h.current_value, h.book_value)), 0)::numeric,
    coalesce(sum(h.current_value) filter (where h.current_value is not null), 0)::numeric,
    coalesce(sum(h.book_value)    filter (where h.current_value is not null), 0)::numeric,
    coalesce(sum(h.current_value - h.book_value) filter (where h.current_value is not null), 0)::numeric
  from held h
  group by h.category
  -- Biggest slice of the book first: the report is read top-down, and the
  -- category holding most of the value is the one worth arguing about.
  order by coalesce(sum(coalesce(h.current_value, h.book_value)), 0) desc, h.category;
$fn$;

revoke all on function public.sacco_asset_valuation_by_category() from public;
revoke all on function public.sacco_asset_valuation_by_category() from anon;
grant execute on function public.sacco_asset_valuation_by_category() to authenticated;

comment on function public.sacco_asset_valuation_by_category() is
  'Held SACCO assets valued by category: cost, depreciation, book value, reported '
  'value and the revaluation gap over the assets that actually carry a valuation. '
  'SECURITY INVOKER — RLS decides which rows are visible.';

-- ---------------------------------------------------------------------------
-- 2. WHOLE-BOOK VALUATION TOTALS
--
-- Deliberately self-contained rather than "the category rows, added up". The
-- report's header must be true even if the category call fails, and the
-- Overview tile wants the total without paying for the breakdown.
--
-- `by_basis` is the part that keeps the headline honest. "KES 63.5M" means one
-- thing when it rests on professional valuations and quite another when it
-- rests on internal estimates, and a report that does not say which is inviting
-- a board to treat a guess as a fact.
-- ---------------------------------------------------------------------------

create or replace function public.sacco_asset_valuation_totals()
returns table (
  held_assets           bigint,
  valued_assets         bigint,
  unvalued_assets       bigint,
  stale_valuations      bigint,
  total_cost            numeric,
  total_depreciation    numeric,
  total_book_value      numeric,
  total_current_value   numeric,
  valued_current_value  numeric,
  valued_book_value     numeric,
  unvalued_book_value   numeric,
  revaluation_delta     numeric,
  by_basis              jsonb,
  last_valued_on        date
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  with held as (
    select coalesce(a.cost, 0)                     as cost,
           coalesce(a.accumulated_depreciation, 0) as depreciation,
           coalesce(a.book_value, 0)               as book_value,
           a.current_value,
           a.valuation_date,
           -- A recorded valuation with no basis is an internal estimate: that
           -- is what the form defaults to, and leaving it out of the breakdown
           -- would make the basis figures add up to less than the total.
           coalesce(nullif(trim(a.valuation_basis), ''), 'internal') as basis
      from public.sacco_fixed_assets a
     where a.is_disposed is not true
  )
  select
    count(*)::bigint,
    count(*) filter (where current_value is not null)::bigint,
    count(*) filter (where current_value is null)::bigint,
    count(*) filter (
      where current_value is not null
        and (valuation_date is null or valuation_date < current_date - 365)
    )::bigint,
    coalesce(sum(cost), 0)::numeric,
    coalesce(sum(depreciation), 0)::numeric,
    coalesce(sum(book_value), 0)::numeric,
    coalesce(sum(coalesce(current_value, book_value)), 0)::numeric,
    coalesce(sum(current_value) filter (where current_value is not null), 0)::numeric,
    coalesce(sum(book_value)    filter (where current_value is not null), 0)::numeric,
    coalesce(sum(book_value)    filter (where current_value is null), 0)::numeric,
    coalesce(sum(current_value - book_value) filter (where current_value is not null), 0)::numeric,
    coalesce(
      (select jsonb_object_agg(t.basis, t.agg)
         from (
           select basis,
                  jsonb_build_object(
                    'count', count(*),
                    'value', coalesce(sum(current_value), 0)
                  ) as agg
             from held
            where current_value is not null
            group by basis
         ) t),
      '{}'::jsonb),
    max(valuation_date) filter (where current_value is not null)
  from held;
$fn$;

revoke all on function public.sacco_asset_valuation_totals() from public;
revoke all on function public.sacco_asset_valuation_totals() from anon;
grant execute on function public.sacco_asset_valuation_totals() to authenticated;

comment on function public.sacco_asset_valuation_totals() is
  'Whole-book valuation of the SACCO assets still held: cost, depreciation, net '
  'book value, reported current value, and how much of that rests on a recorded '
  'valuation rather than on book value. SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- 3. THE INDEX THE REPORT LEANS ON
--
-- Both functions scan a tenant's held assets and group them. The register
-- already indexes (admin_id, category) and (admin_id, status); neither helps a
-- scan filtered on is_disposed. This one covers the report's exact predicate
-- and keeps a large register's valuation a single index scan.
-- ---------------------------------------------------------------------------

create index if not exists idx_sacco_fixed_assets_held
  on public.sacco_fixed_assets (admin_id, category)
  where is_disposed is not true;

commit;

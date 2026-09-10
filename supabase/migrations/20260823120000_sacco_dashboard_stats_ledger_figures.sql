-- ===========================================================================
-- SACCO DASHBOARD STATS — ADD THE LEDGER-TAB FIGURES
--
-- The problem
-- -----------
-- 20260822140000 moved the DASHBOARD's headline numbers into Postgres so the
-- list fetches could be capped without making the totals wrong. It did not
-- cover the figures the Contributions and Loans TABS compute for themselves,
-- and those kept reducing over the same capped arrays:
--
--     ContributionsTab: totalPaid, thisMonth, totalPenalty, entry counts
--     LoansTab:         outstanding principal, pending count, total count
--
-- So a sacco past LIST_CAP contributions was shown a "Total collected" and a
-- "Penalties" figure computed from its newest 500 rows only — money figures,
-- silently understated, with nothing on screen to say so. The same held for
-- disbursed principal once a sacco passed 500 loans.
--
-- The fix
-- -------
-- Same shape as before: aggregate over the whole book in one round trip, so
-- the tabs can page their tables freely without touching their numbers.
--
-- 'this month' is evaluated in Africa/Nairobi, matching the sacco's own day
-- boundary rather than UTC's — at 01:00 Nairobi on the 1st, UTC is still in
-- last month, which would drop that day's collections from the figure.
-- It keys off period_month (the month the contribution is FOR) and falls back
-- to paid_date, exactly as the JS it replaces did.
--
-- Why SECURITY INVOKER: unchanged and load-bearing — scope comes from RLS on
-- the underlying tables, never from an argument. See 20260822140000 for the
-- full reasoning.
--
-- The return signature changes, which CREATE OR REPLACE cannot do, so the old
-- function is dropped first. Idempotent and transactional.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- The date a contribution "happened" for filtering purposes.
--
-- The ledger tab has always ranked paid_date over due_date over created_at
-- when deciding whether a row falls in a date range. That worked while the
-- filtering ran in JavaScript over an array. Pushing the filter to Postgres
-- needs it as something PostgREST can compare and an index can cover, so the
-- precedence becomes a column instead of a rule three places re-implement.
--
-- created_at is converted at a FIXED zone: ::date on a timestamptz depends on
-- the session TimeZone and so is only STABLE, which a generated column may not
-- use. Africa/Nairobi is the sacco's own day boundary and matches how the rest
-- of this file treats "which day is it".
-- ---------------------------------------------------------------------------
alter table public.sacco_contributions
  add column if not exists effective_date date
  generated always as (
    coalesce(paid_date, due_date, (created_at at time zone 'Africa/Nairobi')::date)
  ) stored;

create index if not exists sacco_contributions_effective_date_idx
  on public.sacco_contributions (admin_id, effective_date desc);

drop function if exists public.sacco_dashboard_stats();

create function public.sacco_dashboard_stats()
returns table (
  total_members             bigint,
  active_members            bigint,
  total_savings             numeric,
  pending_contributions     bigint,
  active_loans              bigint,
  total_share_value         numeric,
  total_shares_held         bigint,
  open_motions              bigint,
  active_elections          bigint,
  pending_candidates        bigint,
  -- Added by this migration.
  total_contributions       bigint,
  settled_contributions     bigint,
  contributions_this_month  numeric,
  pending_contrib_amount    numeric,
  total_penalties           numeric,
  total_loans               bigint,
  pending_loans             bigint,
  active_loan_principal     numeric
)
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
  select
    (select count(*) from public.sacco_members)                                  as total_members,
    (select count(*) from public.sacco_members
      where status::text = 'active')                                             as active_members,
    (select coalesce(sum(amount), 0) from public.sacco_contributions
      where status::text in ('completed', 'paid'))                               as total_savings,
    (select count(*) from public.sacco_contributions
      where status::text = 'pending')                                            as pending_contributions,
    (select count(*) from public.sacco_loans
      where status::text = 'active')                                             as active_loans,
    (select coalesce(sum(coalesce(shares_held, 0) * coalesce(par_value, 0)), 0)
       from public.sacco_shares)                                                 as total_share_value,
    (select coalesce(sum(coalesce(shares_held, 0)), 0)
       from public.sacco_shares)                                                 as total_shares_held,
    (select count(*) from public.sacco_motions
      where status::text = 'open')                                               as open_motions,
    (select count(*) from public.sacco_elections
      where status::text in ('nominations_open', 'voting_open'))                 as active_elections,
    (select count(*) from public.sacco_election_candidates
      where status::text = 'pending')                                            as pending_candidates,

    (select count(*) from public.sacco_contributions)                            as total_contributions,
    (select count(*) from public.sacco_contributions
      where status::text in ('completed', 'paid'))                               as settled_contributions,
    (select coalesce(sum(amount), 0) from public.sacco_contributions
      where status::text in ('completed', 'paid')
        and date_trunc('month', coalesce(period_month, paid_date)::date)
            = date_trunc('month', (now() at time zone 'Africa/Nairobi')::date))  as contributions_this_month,
    (select coalesce(sum(amount), 0) from public.sacco_contributions
      where status::text = 'pending')                                            as pending_contrib_amount,
    (select coalesce(sum(coalesce(penalty_amount, 0)), 0)
       from public.sacco_contributions)                                          as total_penalties,
    (select count(*) from public.sacco_loans)                                    as total_loans,
    (select count(*) from public.sacco_loans
      where status::text = 'pending')                                            as pending_loans,
    (select coalesce(sum(coalesce(principal, 0)), 0) from public.sacco_loans
      where status::text = 'active')                                             as active_loan_principal;
$$;

comment on function public.sacco_dashboard_stats() is
  'Tenant dashboard and ledger-tab aggregates over the full book. SECURITY INVOKER: scope comes from RLS on the underlying tables, never from an argument.';

revoke all on function public.sacco_dashboard_stats() from public;
grant execute on function public.sacco_dashboard_stats() to authenticated;


-- ---------------------------------------------------------------------------
-- Summary for the ledger's CURRENT filter set.
--
-- The ledger tab shows "Showing <amount> settled across <n> entries" for
-- whatever filters are applied. Once the table itself is paged, neither number
-- can come from the rows on screen. The count rides along on the page request
-- as an exact count; this supplies the money.
--
-- The filter arguments deliberately mirror the ones the table sends to
-- PostgREST, including which columns the free-text search covers, so the
-- summary can never describe a different set of rows than the table shows.
-- p_search arrives pre-escaped by the client for LIKE metacharacters; the
-- default backslash escape means '\%' matches a literal percent here exactly
-- as it does through PostgREST.
--
-- SECURITY INVOKER, and note there is still no tenant argument: the filters
-- narrow within what RLS already allows, they cannot widen past it.
-- ---------------------------------------------------------------------------
create or replace function public.sacco_contributions_filtered_summary(
  p_search text    default null,
  p_member uuid    default null,
  p_method text    default null,
  p_status text    default null,
  p_from   date    default null,
  p_to     date    default null,
  p_min    numeric default null,
  p_max    numeric default null
)
returns table (entry_count bigint, settled_amount numeric)
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
  select
    count(*)::bigint as entry_count,
    coalesce(sum(amount) filter (where status::text in ('completed', 'paid')), 0) as settled_amount
  from public.sacco_contributions c
  where (p_member is null or c.member_id = p_member)
    and (p_method is null or coalesce(c.payment_method, '') = p_method)
    and (p_status is null or c.status::text = p_status)
    and (p_min    is null or c.amount >= p_min)
    and (p_max    is null or c.amount <= p_max)
    -- effective_date carries the paid → due → created precedence, so this and
    -- the table's own filter can never disagree about what "in March" means.
    and (p_from   is null or c.effective_date >= p_from)
    and (p_to     is null or c.effective_date <= p_to)
    and (
      p_search is null or p_search = '' or
      c.txn_no            ilike '%' || p_search || '%' or
      c.reference         ilike '%' || p_search || '%' or
      c.notes             ilike '%' || p_search || '%' or
      c.contribution_type ilike '%' || p_search || '%' or
      c.received_by_name  ilike '%' || p_search || '%'
    );
$$;

comment on function public.sacco_contributions_filtered_summary is
  'Entry count and settled amount for the contributions ledger under the tab''s current filters. SECURITY INVOKER: filters narrow within RLS, never past it.';

revoke all on function public.sacco_contributions_filtered_summary from public;
grant execute on function public.sacco_contributions_filtered_summary to authenticated;


-- ---------------------------------------------------------------------------
-- Settled contributions broken down by type, over the whole book.
--
-- The Reports panel built this in the browser from the same capped array, so
-- "what each purse actually collected" was only ever the newest rows' worth.
-- Distinct members per type is counted here too — a Set of member ids over a
-- truncated array undercounts in a way nobody can see.
-- ---------------------------------------------------------------------------
create or replace function public.sacco_contributions_by_type()
returns table (
  contribution_type text,
  entry_count       bigint,
  total             numeric,
  member_count      bigint
)
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
  select
    coalesce(nullif(c.contribution_type, ''), 'other') as contribution_type,
    count(*)::bigint                                   as entry_count,
    coalesce(sum(c.amount), 0)                         as total,
    count(distinct c.member_id)::bigint                as member_count
  from public.sacco_contributions c
  where c.status::text in ('completed', 'paid')
  group by 1
  order by 3 desc;
$$;

comment on function public.sacco_contributions_by_type is
  'Settled contributions grouped by type across the whole book. SECURITY INVOKER: scope comes from RLS.';

revoke all on function public.sacco_contributions_by_type from public;
grant execute on function public.sacco_contributions_by_type to authenticated;


-- ---------------------------------------------------------------------------
-- Settled-to-date per member.
--
-- The Reports panel showed this beside every member by filtering the capped
-- contributions array per row — so a member whose contributions fell outside
-- the newest rows was shown a total lower than what they had actually saved,
-- next to their own name. One grouped scan replaces N filters over a partial
-- array, and is right regardless of how long the member has been contributing.
-- ---------------------------------------------------------------------------
create or replace function public.sacco_contributions_by_member()
returns table (member_id uuid, entry_count bigint, settled_total numeric)
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
  select
    c.member_id,
    count(*)::bigint           as entry_count,
    coalesce(sum(c.amount), 0) as settled_total
  from public.sacco_contributions c
  where c.status::text in ('completed', 'paid')
    and c.member_id is not null
  group by c.member_id;
$$;

comment on function public.sacco_contributions_by_member is
  'Settled contribution total per member across the whole book. SECURITY INVOKER: scope comes from RLS.';

revoke all on function public.sacco_contributions_by_member from public;
grant execute on function public.sacco_contributions_by_member to authenticated;

commit;

-- ===========================================================================
-- SACCO DASHBOARD STATS — AGGREGATE IN POSTGRES, NOT IN THE BROWSER
--
-- The problem
-- -----------
-- SaccoDashboardContext computed every headline number by pulling whole tables
-- into the browser and reducing over the arrays:
--
--     totalSavings = contributions.filter(settled).reduce(+amount)
--     activeLoans  = loans.filter(status==='active').length
--     totalShareValue = shares.reduce(shares_held * par_value)
--
-- That makes the cost of rendering a dashboard proportional to the size of the
-- tenant's whole book. A sacco with 20k contributions shipped 20k rows to every
-- open dashboard, on mount AND again on every realtime event. It is also why
-- those fetches could not simply be capped with .limit(): a cap would silently
-- make every total on the screen WRONG, which is worse than slow.
--
-- The fix
-- -------
-- One round trip that returns the aggregates computed over ALL rows, so the
-- list fetches are free to be capped for display without touching the numbers.
--
-- Why SECURITY INVOKER
-- --------------------
-- This function deliberately does NOT run as definer and takes NO tenant
-- argument. It runs with the caller's rights, so the same RLS policies that
-- gate the underlying tables gate the aggregate: a sacco_admin sums their own
-- book because those are the only rows they can see, and there is no admin_id
-- parameter for a caller to tamper with. A definer version of this function
-- would have to re-implement tenant scoping by hand and would become a leak
-- the moment that hand-rolled check drifted from the policies.
--
-- Enum-typed status columns are cast to text so the value lists here read the
-- same as the JS they replace. 'paid' is the pre-20260801 spelling of
-- 'completed'; both count as settled, matching the previous client behaviour.
--
-- Idempotent and transactional: safe to re-run, lands whole or not at all.
-- ===========================================================================

begin;

create or replace function public.sacco_dashboard_stats()
returns table (
  total_members         bigint,
  active_members        bigint,
  total_savings         numeric,
  pending_contributions bigint,
  active_loans          bigint,
  total_share_value     numeric,
  total_shares_held     bigint,
  open_motions          bigint,
  active_elections      bigint,
  pending_candidates    bigint
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
      where status::text = 'pending')                                            as pending_candidates;
$$;

comment on function public.sacco_dashboard_stats() is
  'Tenant dashboard aggregates over the full book. SECURITY INVOKER: scope comes from RLS on the underlying tables, never from an argument.';

revoke all on function public.sacco_dashboard_stats() from public;
grant execute on function public.sacco_dashboard_stats() to authenticated;

commit;

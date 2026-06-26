-- Migration: scheduled plan changes for company (admin) subscriptions.
--
-- The admin profile lets a company admin upgrade/downgrade their licensed user
-- seats. The change must only take effect once the CURRENT subscription period
-- has ended, so we stash the requested change on the current
-- company_subscriptions row. When the period ends the app applies it (creates
-- the next-period row) and clears these columns.
--
--   pending_max_users      — the seat count the admin scheduled
--   pending_plan_name      — the tier that seat count falls into (silver/bronze/gold)
--   pending_price          — next-period monthly price (seats × per-user, no install fee)
--   pending_effective_date — when it activates (= current end_date)
--
-- Additive + idempotent: safe to re-run, does not touch existing data or the
-- registration / seat-enforcement queries.

alter table public.company_subscriptions add column if not exists pending_max_users      integer;
alter table public.company_subscriptions add column if not exists pending_plan_name      text;
alter table public.company_subscriptions add column if not exists pending_price          numeric;
alter table public.company_subscriptions add column if not exists pending_effective_date date;

-- Refresh the PostgREST schema cache so the new columns are immediately visible.
notify pgrst, 'reload schema';

-- ===========================================================================
-- REGULATORY BILLING  --  record WHICH tax regime priced each platform invoice
--
-- WHY
-- 20260831160000_system_billing_breakdown.sql froze the tax FIGURES onto each
-- row -- vat_rate, vat_amount, subtotal -- so a later price change could not
-- rewrite a paid invoice. That fixed the money. It did not record the AUTHORITY:
-- a row saying "16" answers "how much" but not "under what", and those are
-- different questions when a rate has moved.
--
-- Kenya's standard rate has moved twice in recent memory -- cut to 14% by
-- LN 35/2020 with effect from 1 April 2020, restored to 16% by LN 206/2020 from
-- 1 January 2021 -- and it will move again. src/config/taxRegulations.js now
-- versions the rate by the date its instrument came into force, and
-- buildSystemInvoice() resolves the regime from the BILLING DATE rather than
-- from today. This column stores which one it resolved to.
--
-- WHAT IT BUYS
--   * An invoice can cite the instrument it was raised under, not just a
--     percentage.
--   * A rate that is later found to have been applied wrongly can be found:
--     the affected rows are the ones whose tax_regime disagrees with the regime
--     their own billing date resolves to.
--   * Re-rendering an old row no longer has to INFER the rate from its date --
--     it is on the row.
--
-- WHAT IT DOES NOT DO
-- It changes no figure. tax_regime is descriptive: every amount on every row is
-- exactly what it was before this ran.
--
-- BACKFILL
-- Existing rows are stamped with the regime their own billing date resolves to,
-- which is what the frontend was already deriving for them. Rows whose date
-- predates the schedule, and rows with no date at all, are left null rather
-- than being stamped with a guess -- null here means "not known", and the
-- renderer falls back to resolving by date exactly as it does today.
--
-- Idempotent and transactional -- safe to re-run, lands whole or not at all.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. THE COLUMN
--
-- The regime's version string, which is its effective date ('2021-01-01').
-- Kept as text rather than a date: it is an identifier that happens to look
-- like a date, and a future regime could need a suffix to disambiguate two
-- instruments in force from the same day.
-- ---------------------------------------------------------------------------
alter table public.company_subscriptions
  add column if not exists tax_regime text;

alter table public.sacco_invoices
  add column if not exists tax_regime text;

comment on column public.company_subscriptions.tax_regime is
  'Version of the tax regime this invoice was priced under. Matches a TAX_REGIMES entry in src/config/taxRegulations.js and its mirror in supabase/functions/_shared/plans.ts. Null on rows raised before this column existed, or dated before the schedule starts.';

comment on column public.sacco_invoices.tax_regime is
  'Version of the tax regime this invoice was priced under. See company_subscriptions.tax_regime.';

-- ---------------------------------------------------------------------------
-- 2. THE SCHEDULE, IN SQL
--
-- A mirror of TAX_REGIMES, used only to backfill. It is deliberately a local
-- CTE and not a table: the app resolves rates from its own config, and a
-- second authority that the app never reads is a copy that drifts silently.
-- Anything that needs the schedule at runtime should read it from the app.
-- ---------------------------------------------------------------------------
with regimes (version, effective_from) as (
  values
    ('2013-09-02', date '2013-09-02'),
    ('2020-04-01', date '2020-04-01'),
    ('2021-01-01', date '2021-01-01')
),

-- ---------------------------------------------------------------------------
-- 3. BACKFILL -- company_subscriptions
--
-- A subscription is billed from its start date; created_at stands in when
-- start_date is null. The regime is the LAST one that had come into force by
-- then -- the same rule resolveTaxRegime() applies.
-- ---------------------------------------------------------------------------
company_dates as (
  select id, coalesce(start_date::date, created_at::date) as billed_on
  from public.company_subscriptions
  where tax_regime is null
),
company_match as (
  select d.id,
         (select r.version
            from regimes r
           where r.effective_from <= d.billed_on
           order by r.effective_from desc
           limit 1) as version
    from company_dates d
   where d.billed_on is not null
)
update public.company_subscriptions s
   set tax_regime = m.version
  from company_match m
 where s.id = m.id
   and m.version is not null;

-- ---------------------------------------------------------------------------
-- 4. BACKFILL -- sacco_invoices
--
-- A sacco invoice belongs to its period, and a bill for a period falls due at
-- the END of it, so a rate that arrived mid-month governs that month. period
-- is stored as a date at the start of the month, so the month end is derived
-- rather than assumed.
-- ---------------------------------------------------------------------------
with regimes (version, effective_from) as (
  values
    ('2013-09-02', date '2013-09-02'),
    ('2020-04-01', date '2020-04-01'),
    ('2021-01-01', date '2021-01-01')
),
sacco_dates as (
  select id,
         case
           when period is not null
             then (date_trunc('month', period::date) + interval '1 month - 1 day')::date
           else created_at::date
         end as billed_on
    from public.sacco_invoices
   where tax_regime is null
),
sacco_match as (
  select d.id,
         (select r.version
            from regimes r
           where r.effective_from <= d.billed_on
           order by r.effective_from desc
           limit 1) as version
    from sacco_dates d
   where d.billed_on is not null
)
update public.sacco_invoices i
   set tax_regime = m.version
  from sacco_match m
 where i.id = m.id
   and m.version is not null;

commit;

-- ===========================================================================
-- ROLLBACK
--
--   alter table public.company_subscriptions drop column if exists tax_regime;
--   alter table public.sacco_invoices        drop column if exists tax_regime;
--
-- Safe: the column is descriptive and nothing computes from it.
-- ===========================================================================

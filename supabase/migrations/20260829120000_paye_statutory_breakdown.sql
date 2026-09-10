-- ===========================================================================
-- PAYE: store the working, not just the answer
--
-- THE GAP
--
-- payroll_records kept four numbers — paye, nssf, shif, net_salary — and threw
-- away everything that produced them. Three consequences, all of them bad:
--
--   1. HOUSING LEVY WAS NEVER RECORDED. The employee form has shown a 1.5% AHL
--      figure since it was built, the payslip printed a line for it, and no
--      payroll run ever wrote it to a column. The levy is a real deduction and
--      a real employer liability; it existed only as a number re-derived at
--      print time from whatever the rates happened to be that day.
--
--   2. TAXABLE PAY WAS UNRECOVERABLE. PAYE is charged on gross LESS the
--      allowable deductions, so the tax on a payslip cannot be checked against
--      anything unless the base it was charged on is stored beside it. A KRA
--      query on a past month had no answer in this database.
--
--   3. OLD RECORDS SILENTLY RE-PRICED. The payslip printer recomputed missing
--      figures with today's rates, so reprinting a January payslip in August
--      produced numbers that were never paid to anyone.
--
-- WHY rate_version
--
-- Statutory rates move — NSSF limits step up on a schedule, the Tax Laws
-- (Amendment) Act 2024 changed what is deductible partway through a tax year.
-- Storing which rate table produced a row is what lets a figure be traced and
-- reproduced years later, and what lets a re-run of an old month be told apart
-- from a stale one. Values match RATE_SCHEDULES[].version in
-- src/utils/kenyaPayroll.js.
--
-- The user_profiles columns are the per-employee statutory profile: figures
-- that are stable month to month and belong on the person, not re-keyed into
-- every payroll run. They sit next to basic_salary / housing_allowance /
-- transport_allowance, which are already there — staff are user_profiles rows
-- in this schema, there is no separate employees table. All default to 0 /
-- false, so every existing row keeps the behaviour it has today, and the
-- privilege lockdown (20260802130000) grants at table level, so the new
-- columns inherit its policies without further work.
--
-- Idempotent and transactional: safe to re-run, lands whole or not at all.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. PAYROLL RECORDS — the statutory working behind each payslip
-- ---------------------------------------------------------------------------

alter table public.payroll_records
  add column if not exists taxable_pay          numeric(14,2) not null default 0,
  add column if not exists housing_levy         numeric(14,2) not null default 0,
  add column if not exists personal_relief      numeric(14,2) not null default 0,
  add column if not exists insurance_relief     numeric(14,2) not null default 0,
  add column if not exists pension_contribution numeric(14,2) not null default 0,
  add column if not exists non_cash_benefits    numeric(14,2) not null default 0,
  add column if not exists rate_version         text;

comment on column public.payroll_records.taxable_pay is
  'Gross pay less allowable deductions (NSSF, SHIF, AHL, pension, mortgage interest, post-retirement medical). The base PAYE was actually charged on.';
comment on column public.payroll_records.housing_levy is
  'Affordable Housing Levy withheld from the employee. The employer owes a matching amount separately.';
comment on column public.payroll_records.personal_relief is
  'Personal relief set off against the banded tax for this month.';
comment on column public.payroll_records.rate_version is
  'Which statutory rate schedule produced this row. Matches RATE_SCHEDULES[].version in src/utils/kenyaPayroll.js.';

-- Rows written before this migration have no working stored. Leaving
-- rate_version NULL is the honest state: it marks them as "computed by the old
-- engine, basis unknown" rather than back-dating them into a schedule that may
-- not have produced them. Consumers render NULL as unknown, not as current.

-- ---------------------------------------------------------------------------
-- 2. USER PROFILES — the per-employee statutory profile
-- ---------------------------------------------------------------------------

alter table public.user_profiles
  add column if not exists pension_contribution     numeric(14,2) not null default 0,
  add column if not exists mortgage_interest        numeric(14,2) not null default 0,
  add column if not exists post_retirement_medical  numeric(14,2) not null default 0,
  add column if not exists insurance_premiums       numeric(14,2) not null default 0,
  add column if not exists has_disability_exemption boolean       not null default false;

comment on column public.user_profiles.pension_contribution is
  'Monthly employee contribution to a registered occupational or individual pension scheme. Deductible before PAYE, sharing one ceiling with NSSF.';
comment on column public.user_profiles.mortgage_interest is
  'Monthly interest on an owner-occupier mortgage. Reduces taxable pay only — it is paid to the lender, never withheld from salary.';
comment on column public.user_profiles.insurance_premiums is
  'Monthly life / health / education premiums qualifying for insurance relief at 15%.';
comment on column public.user_profiles.has_disability_exemption is
  'Holder of a current KRA disability exemption certificate. Exempts the first tranche of monthly pay from tax.';

-- ---------------------------------------------------------------------------
-- 3. SANITY CONSTRAINTS
--
-- A negative statutory figure is always a bug upstream, never a valid payroll
-- state. Cheap to enforce here, and it keeps a bad engine from quietly
-- poisoning the tax returns these rows are filed from.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payroll_records_statutory_non_negative'
  ) then
    alter table public.payroll_records
      add constraint payroll_records_statutory_non_negative
      check (
        coalesce(paye, 0)              >= 0 and
        coalesce(nssf, 0)              >= 0 and
        coalesce(shif, 0)              >= 0 and
        coalesce(housing_levy, 0)      >= 0 and
        coalesce(taxable_pay, 0)       >= 0 and
        coalesce(personal_relief, 0)   >= 0 and
        coalesce(insurance_relief, 0)  >= 0
      )
      not valid;   -- NOT VALID: applies to new writes without failing the
                   -- migration on legacy rows written by the old engine.
  end if;
end $$;

commit;

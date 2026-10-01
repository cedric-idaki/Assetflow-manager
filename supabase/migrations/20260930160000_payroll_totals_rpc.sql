-- ===========================================================================
-- PAYROLL TOTALS, AGGREGATED IN POSTGRES
--
-- The Payroll tab in HR Management totalled its summary cards by reducing over
-- the payroll_records it had loaded -- and it loads at most 200 of them, newest
-- month first. For a single month of a small tenant that is harmless. Across a
-- date range, or with no month picked, the oldest payslips fell off the end and
-- Total Gross / PAYE / NSSF / SHIF came out short with nothing on screen to say
-- so. A capped read that feeds a total is a silent correctness bug (see the
-- dashboard stats RPCs of 20260822140000); this is the same fix for payroll.
--
-- SECURITY INVOKER, and the tenant is NOT an argument that widens anything.
-- Row-level security on payroll_records and user_profiles supplies the scope,
-- exactly as it does for the list the page already shows. p_admin_id can only
-- NARROW the rows (the page passes it for the same reason its list query adds
-- .eq('admin_id', ...)), so a caller naming someone else's tenant gets zeros,
-- not their payroll.
--
-- The filters mirror filteredPayroll in src/pages/hr-management/index.jsx one
-- for one, so the cards, the totals row and the list underneath always describe
-- the same payslips:
--   month / from / to  -- pay_month is YYYY-MM text, so string compare is
--                         chronological
--   status             -- a null status counts as 'pending', as on screen
--   department / role  -- read from the employee's profile; an employee the
--                         viewer cannot see compares as '', as it does there
--   search             -- case-insensitive substring of name, email, national ID
--
-- Money comes back as numeric, which PostgREST serialises as a STRING. The
-- caller must Number() every field or the totals concatenate.
--
-- Idempotent: create or replace, and the grants are re-stated.
-- ===========================================================================

begin;

create or replace function public.payroll_totals(
  p_admin_id   uuid default null,
  p_month      text default null,
  p_from       text default null,
  p_to         text default null,
  p_status     text default null,
  p_department text default null,
  p_role       text default null,
  p_search     text default null
)
returns table (
  records          integer,
  employees        integer,
  months           integer,
  basic            numeric,
  allowances       numeric,
  additions        numeric,
  gross            numeric,
  taxable_pay      numeric,
  paye             numeric,
  nssf             numeric,
  shif             numeric,
  housing_levy     numeric,
  other_deductions numeric,
  net              numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    count(*)::integer                                                   as records,
    count(distinct pr.employee_id)::integer                             as employees,
    count(distinct pr.pay_month)::integer                               as months,
    coalesce(sum(coalesce(pr.basic_salary, 0)), 0)                      as basic,
    coalesce(sum(coalesce(pr.housing_allowance, 0)
               + coalesce(pr.transport_allowance, 0)), 0)               as allowances,
    coalesce(sum(coalesce(pr.meal_allowance, 0)
               + coalesce(pr.bonus, 0)
               + coalesce(pr.gift, 0)), 0)                              as additions,
    coalesce(sum(pr.gross_salary), 0)                                   as gross,
    coalesce(sum(pr.taxable_pay), 0)                                    as taxable_pay,
    coalesce(sum(pr.paye), 0)                                           as paye,
    coalesce(sum(pr.nssf), 0)                                           as nssf,
    coalesce(sum(pr.shif), 0)                                           as shif,
    -- Legacy rows carry no housing levy. They add nothing rather than being
    -- back-filled with a rate that may not have applied when they were run.
    coalesce(sum(pr.housing_levy), 0)                                   as housing_levy,
    coalesce(sum(coalesce(pr.loan_deduction, 0)
               + coalesce(pr.advance_deduction, 0)), 0)                 as other_deductions,
    coalesce(sum(pr.net_salary), 0)                                     as net
  from public.payroll_records pr
  left join public.user_profiles up on up.id = pr.employee_id
  where (p_admin_id   is null or pr.admin_id = p_admin_id)
    and (p_month      is null or pr.pay_month = p_month)
    and (p_from       is null or pr.pay_month >= p_from)
    and (p_to         is null or pr.pay_month <= p_to)
    and (p_status     is null or coalesce(pr.status, 'pending') = p_status)
    and (p_department is null or coalesce(up.department, '') = p_department)
    and (p_role       is null or coalesce(up.role::text, '') = p_role)
    and (p_search     is null
         or position(lower(p_search)
                     in lower(concat_ws(' ', up.full_name, up.email, up.national_id))) > 0);
$$;

comment on function public.payroll_totals(uuid, text, text, text, text, text, text, text) is
  'Totals behind the HR Payroll tab summary cards and totals row, over EVERY matching payslip rather than the 200 the page lists. SECURITY INVOKER: RLS supplies the tenant scope; p_admin_id only narrows it.';

revoke all on function public.payroll_totals(uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.payroll_totals(uuid, text, text, text, text, text, text, text) to authenticated;

commit;

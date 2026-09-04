-- ===========================================================================
-- STATUTORY RETURN REMINDERS -- KNOW A DEADLINE BEFORE IT PASSES
--
-- THE GAP
--
-- This platform computes every figure a Kenyan employer has to remit. PAYE,
-- NSSF, SHIF and the housing levy come out of src/utils/kenyaPayroll.js and are
-- stored on payroll_records; VAT comes out of the ledger. What it has never
-- held is the DATE any of it is due. The only deadline anywhere in the codebase
-- was the string "By the 9th of next month" typed under a KPI card in the HR
-- payroll tab -- not stored, not tracked, and not attached to any particular
-- month's return.
--
-- So a tenant who ran payroll and then forgot to file found out from KRA. The
-- bill for finding out that way:
--
--   PAYE   25% of the tax due or KES 10,000, whichever is higher
--          (Tax Procedures Act 2015, s.83(1))
--   VAT    5% of the tax due or KES 10,000, whichever is higher (s.83(2))
--   both   a further 5% of the unpaid tax, and 1% interest per month (s.38)
--   NSSF   5% of the unpaid contribution per month (NSSF Act 2013, s.21)
--   AHL    3% of the unpaid levy per month (Affordable Housing Act 2024, s.4(5))
--
-- WHAT THIS MIGRATION ADDS
--
--   1. statutory_return_filings   -- one row per (tenant, return, period): the
--                                    tenant's own record that a return was
--                                    filed, with the acknowledgement number.
--   2. statutory_reminder_logs    -- which reminder went to whom, so the same
--                                    one is never sent twice.
--   3. statutory_reminder_settings-- per-tenant opt-out and extra recipients.
--   4. statutory_payroll_periods()-- the panel's figures, one query.
--   5. statutory_reminder_workload() -- the scheduler's cross-tenant sweep.
--
-- WHAT IT DELIBERATELY DOES NOT ADD
--
--   No deadline table. Due dates are DERIVED from the period by the schedule in
--   src/config/statutoryReturns.js -- 9th calendar day for PAYE/NSSF/SHIF, 9th
--   WORKING day for the housing levy, 20th for VAT -- and that schedule is
--   versioned by the date each instrument came into force. Materialising the
--   dates here would be a second copy that has to be regenerated every time an
--   Act changes, and would silently re-date closed periods when it was. The
--   due_date column below records what the deadline WAS for a filing that was
--   actually made; nothing reads it to decide what is due next.
--
--   No filing. Nothing here talks to iTax, eSlip, eCitizen or the NSSF portal.
--   A row in statutory_return_filings is a note that a human filed a return --
--   not evidence that anyone received it. That distinction is the same one the
--   P10 exporter makes in src/utils/payeReturns.js, and it is why the column is
--   called filed_at and not accepted_at.
--
--   No enum for return_key. TEXT with a CHECK, for the reason
--   tenant_modules.module_key is: adding an obligation should be one line here
--   and one entry in the config, not an ALTER TYPE.
--
-- Idempotent throughout and wrapped in a transaction: safe to re-run, lands
-- whole or not at all.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. THE FILING RECORD
--
--    period is 'YYYY-MM' TEXT rather than a date, because that is what it is:
--    a return covers a month, not a day. It also matches payroll_records.
--    pay_month exactly, so the two join without a cast.
-- ---------------------------------------------------------------------------
create table if not exists public.statutory_return_filings (
  id           uuid primary key default gen_random_uuid(),

  admin_id     uuid not null,

  -- Mirrors STATUTORY_RETURNS[].key in src/config/statutoryReturns.js.
  return_key   text not null,

  -- The month the return COVERS, not the month it is filed in.
  period       text not null,

  -- What the deadline was, as computed by the client from the schedule version
  -- in force for this period. Stored so the record of a past filing carries the
  -- date it was actually judged against, even after an Act moves the rule.
  -- Nothing derives a future deadline from this column.
  due_date     date,

  -- The figure filed, for reconciliation against the payroll it came from.
  amount       numeric(14,2),

  -- NULL means outstanding. A row can exist un-filed: marking a return "not
  -- applicable this month" is a real answer, and notes says why.
  filed_at     timestamptz,
  filed_by     uuid,

  -- The KRA acknowledgement number / e-slip / SHA receipt. Free text: four
  -- authorities, four formats, and none of them ours to validate.
  reference    text,

  notes        text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

do $$
begin
  alter table public.statutory_return_filings
    add constraint statutory_return_filings_key_chk
    check (return_key in ('paye', 'nssf', 'shif', 'housing_levy', 'vat'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.statutory_return_filings
    add constraint statutory_return_filings_period_chk
    check (period ~ '^\d{4}-(0[1-9]|1[0-2])$');
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.statutory_return_filings
    add constraint statutory_return_filings_admin_fk
    foreign key (admin_id) references public.user_profiles(id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- filed_by is ON DELETE SET NULL, not CASCADE: a bookkeeper leaving the company
-- must not delete the record of the returns they filed.
do $$
begin
  alter table public.statutory_return_filings
    add constraint statutory_return_filings_filed_by_fk
    foreign key (filed_by) references public.user_profiles(id) on delete set null;
exception when duplicate_object then null;
end $$;

-- One filing per return per period per tenant. This is what makes "mark as
-- filed" idempotent and what the reminder sweep anti-joins against.
create unique index if not exists uq_statutory_filings_tenant_return_period
  on public.statutory_return_filings (admin_id, return_key, period);

create index if not exists idx_statutory_filings_outstanding
  on public.statutory_return_filings (admin_id, period)
  where filed_at is null;

comment on table public.statutory_return_filings is
  'A tenant''s own record that a statutory return was filed. NOT evidence of receipt by KRA/NSSF/SHA -- nothing in this system files anything.';
comment on column public.statutory_return_filings.due_date is
  'The deadline this filing was judged against, as it stood for this period. Historical record only; upcoming deadlines are derived from src/config/statutoryReturns.js.';
comment on column public.statutory_return_filings.filed_at is
  'When a human recorded the return as filed. NULL means still outstanding.';

-- ---------------------------------------------------------------------------
-- 2. REMINDER LOG
--
--    WHY A UNIQUE INDEX RATHER THAN A LOOKUP
--
--    kyc_renewal_reminders dedupes by SELECTing before each send. That is one
--    round trip per candidate and it races: two overlapping scheduler runs both
--    read "not sent", and both send. Here the (tenant, return, period, lead,
--    channel) tuple is UNIQUE for successful sends, so the insert itself is the
--    lock -- a duplicate is a constraint violation, not a duplicate email.
--
--    Partial, on status = 'sent', so a failed send does not block the retry.
-- ---------------------------------------------------------------------------
create table if not exists public.statutory_reminder_logs (
  id            uuid primary key default gen_random_uuid(),

  admin_id      uuid not null,
  return_key    text not null,
  period        text not null,
  due_date      date not null,

  -- Days before the deadline this reminder was for: 7, 3, 1, 0, and NEGATIVE
  -- once overdue (-1, -2 ...). One integer identifies the reminder uniquely,
  -- which is what makes the unique index below work.
  lead_days     integer not null,

  channel       text not null,
  recipient     text not null,
  status        text not null,
  error_message text,

  sent_at       timestamptz not null default now()
);

do $$
begin
  alter table public.statutory_reminder_logs
    add constraint statutory_reminder_logs_status_chk
    check (status in ('sent', 'failed', 'skipped'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.statutory_reminder_logs
    add constraint statutory_reminder_logs_channel_chk
    check (channel in ('email', 'sms', 'in_app'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.statutory_reminder_logs
    add constraint statutory_reminder_logs_admin_fk
    foreign key (admin_id) references public.user_profiles(id) on delete cascade;
exception when duplicate_object then null;
end $$;

create unique index if not exists uq_statutory_reminder_once
  on public.statutory_reminder_logs (admin_id, return_key, period, lead_days, channel, recipient)
  where status = 'sent';

create index if not exists idx_statutory_reminder_logs_tenant
  on public.statutory_reminder_logs (admin_id, sent_at desc);

comment on index public.uq_statutory_reminder_once is
  'One successful reminder per tenant/return/period/lead/channel/recipient. The insert IS the dedupe -- a second scheduler run collides here instead of sending a second email.';
comment on column public.statutory_reminder_logs.lead_days is
  'Days before the deadline. Negative once overdue, so every reminder in a period has a distinct identity. Matches reminderDueToday() in src/utils/statutoryCalendar.js.';

-- ---------------------------------------------------------------------------
-- 3. PER-TENANT SETTINGS
--
--    A separate table rather than columns on company_profiles, because a SACCO
--    is a tenant too and has no company_profiles row -- it has a saccos row.
--    Keying on admin_id covers both without either table having to exist.
--
--    DEFAULTS ARE ON. A tenant that never opens this screen still gets its
--    deadlines, which is the entire point; the opt-out is for the tenant whose
--    accountant already handles it.
-- ---------------------------------------------------------------------------
create table if not exists public.statutory_reminder_settings (
  admin_id          uuid primary key,

  enabled           boolean not null default true,

  -- VAT is the one obligation the platform cannot infer. A registered business
  -- owes a NIL return in a month it sold nothing, and this system cannot tell
  -- that business apart from one that is not registered at all -- so it stays
  -- quiet about VAT until a tenant says otherwise, rather than nagging every
  -- tenant about a return most of them do not file.
  vat_registered    boolean not null default false,

  -- Who else hears about it, besides the tenant owner. The finance manager and
  -- the external accountant are the two that matter and neither necessarily
  -- has a login.
  extra_recipients  text[] not null default '{}',

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

do $$
begin
  alter table public.statutory_reminder_settings
    add constraint statutory_reminder_settings_admin_fk
    foreign key (admin_id) references public.user_profiles(id) on delete cascade;
exception when duplicate_object then null;
end $$;

comment on table public.statutory_reminder_settings is
  'Per-tenant statutory reminder preferences. A tenant with no row here gets the defaults: reminders on, VAT off.';

-- ---------------------------------------------------------------------------
-- 4. updated_at TRIGGERS
-- ---------------------------------------------------------------------------
create or replace function public.touch_statutory_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_statutory_filings_updated_at on public.statutory_return_filings;
create trigger set_statutory_filings_updated_at
  before update on public.statutory_return_filings
  for each row execute function public.touch_statutory_updated_at();

drop trigger if exists set_statutory_settings_updated_at on public.statutory_reminder_settings;
create trigger set_statutory_settings_updated_at
  before update on public.statutory_reminder_settings
  for each row execute function public.touch_statutory_updated_at();

-- ---------------------------------------------------------------------------
-- 5. STAMP THE TENANT AND THE FILER
--
--    admin_id and filed_by come from the session, never from the client. A
--    tenant that could name its own admin_id could file a return against
--    somebody else's books.
--
--    current_admin_id() coalesces a missing admin_id to the caller's own id, so
--    a tenant owner stamps themselves and their staff stamp the owner.
-- ---------------------------------------------------------------------------
create or replace function public.stamp_statutory_filing()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.admin_id := coalesce(public.current_admin_id(), new.admin_id);
  else
    -- An UPDATE may never move a row between tenants.
    new.admin_id := old.admin_id;
  end if;

  -- Whoever set filed_at is the filer. Re-stamped when an outstanding row is
  -- later marked filed, and cleared if a filing is un-marked, so the two
  -- columns cannot disagree about whether it was filed and by whom.
  if new.filed_at is not null and (tg_op = 'INSERT' or old.filed_at is null or old.filed_at is distinct from new.filed_at) then
    new.filed_by := coalesce(auth.uid(), new.filed_by);
  elsif new.filed_at is null then
    new.filed_by := null;
  end if;

  return new;
end;
$$;

drop trigger if exists stamp_statutory_filing_tr on public.statutory_return_filings;
create trigger stamp_statutory_filing_tr
  before insert or update on public.statutory_return_filings
  for each row execute function public.stamp_statutory_filing();

create or replace function public.stamp_statutory_settings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.admin_id := coalesce(public.current_admin_id(), new.admin_id);
  else
    new.admin_id := old.admin_id;
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_statutory_settings_tr on public.statutory_reminder_settings;
create trigger stamp_statutory_settings_tr
  before insert or update on public.statutory_reminder_settings
  for each row execute function public.stamp_statutory_settings();

-- ---------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY
--
--    A tenant's statutory position is its own business. Staff of the tenant
--    read and write it; the platform owner can see it for support; nobody else
--    sees anything.
--
--    The reminder LOG is read-only to the tenant: it is a record of what the
--    system sent, and a tenant that could edit it could hide a reminder it
--    ignored. Only the service role writes there.
-- ---------------------------------------------------------------------------
alter table public.statutory_return_filings    enable row level security;
alter table public.statutory_reminder_logs     enable row level security;
alter table public.statutory_reminder_settings enable row level security;

drop policy if exists statutory_filings_read on public.statutory_return_filings;
create policy statutory_filings_read
on public.statutory_return_filings for select to authenticated
using (
  public.is_global_viewer()
  or (admin_id = public.current_admin_id() and public.is_staff_member())
);

drop policy if exists statutory_filings_insert on public.statutory_return_filings;
create policy statutory_filings_insert
on public.statutory_return_filings for insert to authenticated
with check (admin_id = public.current_admin_id() and public.is_staff_member());

drop policy if exists statutory_filings_update on public.statutory_return_filings;
create policy statutory_filings_update
on public.statutory_return_filings for update to authenticated
using (admin_id = public.current_admin_id() and public.is_staff_member())
with check (admin_id = public.current_admin_id() and public.is_staff_member());

-- Un-filing is an UPDATE that clears filed_at, not a DELETE, so the row (and
-- its trail) survives. No delete policy is granted at all: a filing record is
-- evidence of what the business believed it had done, and deleting it is never
-- the right correction.

drop policy if exists statutory_logs_read on public.statutory_reminder_logs;
create policy statutory_logs_read
on public.statutory_reminder_logs for select to authenticated
using (
  public.is_global_viewer()
  or (admin_id = public.current_admin_id() and public.is_staff_member())
);

drop policy if exists statutory_settings_read on public.statutory_reminder_settings;
create policy statutory_settings_read
on public.statutory_reminder_settings for select to authenticated
using (
  public.is_global_viewer()
  or (admin_id = public.current_admin_id() and public.is_staff_member())
);

drop policy if exists statutory_settings_insert on public.statutory_reminder_settings;
create policy statutory_settings_insert
on public.statutory_reminder_settings for insert to authenticated
with check (admin_id = public.current_admin_id() and public.is_staff_member());

drop policy if exists statutory_settings_update on public.statutory_reminder_settings;
create policy statutory_settings_update
on public.statutory_reminder_settings for update to authenticated
using (admin_id = public.current_admin_id() and public.is_staff_member())
with check (admin_id = public.current_admin_id() and public.is_staff_member());

-- ---------------------------------------------------------------------------
-- 7. GRANTS
--    RLS decides which rows; these decide who may ask at all. anon never may.
-- ---------------------------------------------------------------------------
revoke all on public.statutory_return_filings    from public, anon;
revoke all on public.statutory_reminder_logs     from public, anon;
revoke all on public.statutory_reminder_settings from public, anon;

grant select, insert, update on public.statutory_return_filings    to authenticated;
grant select                 on public.statutory_reminder_logs     to authenticated;
grant select, insert, update on public.statutory_reminder_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 8. THE PANEL'S FIGURES
--
--    One row per pay month, with the statutory columns already summed. The
--    alternative -- pulling payroll rows into the browser and reducing over
--    them -- is capped by whatever limit the query carries, so a tenant with
--    two hundred staff would silently under-report the PAYE it owes. That is
--    the same defect the dashboard aggregate RPCs were written to fix.
--
--    SECURITY INVOKER: the caller's own RLS on payroll_records decides what is
--    counted. A definer here would hand any authenticated user every tenant's
--    payroll totals.
--
--    p_admin_id NARROWS TO ONE TENANT, and RLS is not enough on its own here.
--    A super_admin passes is_global_viewer(), so without this filter their
--    payroll read spans every tenant on the platform -- and these are SUMS.
--    The panel would show one merged "PAYE for August" totalling every
--    company's liability, attributed to none of them, and offer to mark it
--    filed. A liability is owed by a particular business to KRA under a
--    particular PIN; there is no such thing as the platform's PAYE.
--
--    NSSF and the levy are returned as the EMPLOYEE half, exactly as stored.
--    The employer match is applied by statutoryAmountsFor() in
--    src/utils/statutoryCalendar.js, in one place, so the doubling rule cannot
--    be applied twice or forgotten on one surface.
-- ---------------------------------------------------------------------------
create or replace function public.statutory_payroll_periods(
  p_since    text default null,
  p_admin_id uuid default null
)
returns table (
  period       text,
  employees    integer,
  gross        numeric,
  paye         numeric,
  nssf         numeric,
  shif         numeric,
  housing_levy numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    pr.pay_month                                as period,
    count(*)::integer                           as employees,
    coalesce(sum(pr.gross_salary), 0)::numeric  as gross,
    coalesce(sum(pr.paye), 0)::numeric          as paye,
    coalesce(sum(pr.nssf), 0)::numeric          as nssf,
    coalesce(sum(pr.shif), 0)::numeric          as shif,
    coalesce(sum(pr.housing_levy), 0)::numeric  as housing_levy
  from public.payroll_records pr
  where pr.pay_month is not null
    and (p_since is null or pr.pay_month >= p_since)
    and (p_admin_id is null or pr.admin_id = p_admin_id)
  group by pr.pay_month
  order by pr.pay_month desc;
$$;

comment on function public.statutory_payroll_periods(text, uuid) is
  'Statutory totals per pay month for ONE tenant. SECURITY INVOKER -- RLS on payroll_records is the access check; p_admin_id is the scoping one, and matters because a global viewer would otherwise sum every tenant into a single meaningless liability. NSSF and housing_levy are the employee half only; the employer match is applied client-side in statutoryAmountsFor().';

revoke all on function public.statutory_payroll_periods(text, uuid) from public, anon;
grant execute on function public.statutory_payroll_periods(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. THE SCHEDULER'S SWEEP
--
--    Every tenant that owes something for a period, in ONE query, with the
--    recipient and the settings attached. The reminder function then does date
--    arithmetic in Deno and sends -- it never queries per tenant.
--
--    SECURITY DEFINER and granted to service_role ONLY. It reads across every
--    tenant by design, which is exactly why no authenticated role may call it.
--
--    Already-filed returns are excluded here rather than in the function: an
--    anti-join in Postgres is free, and a return that is filed should not even
--    appear in the workload.
-- ---------------------------------------------------------------------------
create or replace function public.statutory_reminder_workload(p_since text)
returns table (
  admin_id       uuid,
  tenant_name    text,
  recipient      text,
  extra_recipients text[],
  vat_registered boolean,
  period         text,
  employees      integer,
  gross          numeric,
  paye           numeric,
  nssf           numeric,
  shif           numeric,
  housing_levy   numeric,
  has_vat_activity boolean,
  filed_keys     text[]
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with payroll as (
    select
      pr.admin_id,
      pr.pay_month                                as period,
      count(*)::integer                           as employees,
      coalesce(sum(pr.gross_salary), 0)::numeric  as gross,
      coalesce(sum(pr.paye), 0)::numeric          as paye,
      coalesce(sum(pr.nssf), 0)::numeric          as nssf,
      coalesce(sum(pr.shif), 0)::numeric          as shif,
      coalesce(sum(pr.housing_levy), 0)::numeric  as housing_levy
    from public.payroll_records pr
    where pr.admin_id is not null
      and pr.pay_month is not null
      and pr.pay_month >= p_since
    group by pr.admin_id, pr.pay_month
  ),
  -- Did the tenant post ANY VAT in the period? A boolean, not a figure:
  -- classifying an account as input or output VAT is done by
  -- classifyVatAccount() in src/utils/vatLedger.js, against a chart of accounts
  -- that is tenant-defined free text. Reimplementing that classifier in SQL
  -- would be a second copy of a subtle rule, and the two would drift. So this
  -- answers only "is there a VAT return to file", and the reminder carries the
  -- deadline without asserting an amount.
  vat as (
    select
      je.admin_id,
      substring(je.entry_date::text, 1, 7) as period,
      true                                 as has_vat_activity
    from public.journal_entries je
    where je.admin_id is not null
      and je.status = 'posted'
      and je.entry_date is not null
      and substring(je.entry_date::text, 1, 7) >= p_since
      and (je.debit_account ~* '(^|[^a-z])vat([^a-z]|$)|value[[:space:]-]*added[[:space:]-]*tax'
        or je.credit_account ~* '(^|[^a-z])vat([^a-z]|$)|value[[:space:]-]*added[[:space:]-]*tax')
    group by je.admin_id, substring(je.entry_date::text, 1, 7)
  ),
  -- Every (tenant, period) either side has something to say about.
  --
  -- EVERY column reference in this function is table-qualified, including the
  -- two here. The function's RETURNS TABLE names (admin_id, period, paye, ...)
  -- are in scope throughout the body, so a bare `select admin_id from payroll`
  -- is not merely untidy -- Postgres refuses it outright with "column reference
  -- is ambiguous", and the whole migration fails to create the function.
  base as (
    select p.admin_id, p.period from payroll p
    union
    select v.admin_id, v.period from vat v
  )
  select
    b.admin_id,
    coalesce(up.full_name, up.email, 'Tenant')          as tenant_name,
    up.email                                            as recipient,
    coalesce(s.extra_recipients, '{}'::text[])                as extra_recipients,
    coalesce(s.vat_registered, false)                   as vat_registered,
    b.period,
    coalesce(p.employees, 0)                            as employees,
    coalesce(p.gross, 0)                                as gross,
    coalesce(p.paye, 0)                                 as paye,
    coalesce(p.nssf, 0)                                 as nssf,
    coalesce(p.shif, 0)                                 as shif,
    coalesce(p.housing_levy, 0)                         as housing_levy,
    coalesce(v.has_vat_activity, false)                 as has_vat_activity,
    coalesce(
      (select array_agg(f.return_key)
         from public.statutory_return_filings f
        where f.admin_id = b.admin_id
          and f.period   = b.period
          and f.filed_at is not null),
      '{}'::text[]
    )                                                   as filed_keys
  from base b
  join public.user_profiles up on up.id = b.admin_id
  left join payroll p on p.admin_id = b.admin_id and p.period = b.period
  left join vat     v on v.admin_id = b.admin_id and v.period = b.period
  left join public.statutory_reminder_settings s on s.admin_id = b.admin_id
  -- An explicit opt-out is the only thing that silences a tenant. No row means
  -- the defaults, which are on.
  where coalesce(s.enabled, true)
  order by b.admin_id, b.period;
$$;

comment on function public.statutory_reminder_workload(text) is
  'Cross-tenant sweep for the statutory-return reminder scheduler: who owes what for which period, with recipients and already-filed returns attached. SECURITY DEFINER, service_role only -- it reads every tenant by design.';

revoke all on function public.statutory_reminder_workload(text) from public, anon, authenticated;
grant execute on function public.statutory_reminder_workload(text) to service_role;

-- The reminder function writes its own log rows with the service key. RLS does
-- not apply to service_role, but the table grant does.
grant insert on public.statutory_reminder_logs to service_role;

-- ---------------------------------------------------------------------------
-- 10. INDEXES THE SWEEP NEEDS
--
--     Without these the monthly sweep is a sequential scan of every payroll row
--     and every journal entry on the platform.
-- ---------------------------------------------------------------------------
create index if not exists idx_payroll_records_admin_month
  on public.payroll_records (admin_id, pay_month);

create index if not exists idx_journal_entries_admin_date
  on public.journal_entries (admin_id, entry_date)
  where status = 'posted';

commit;

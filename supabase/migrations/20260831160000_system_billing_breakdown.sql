-- ===========================================================================
-- SYSTEM BILLING BREAKDOWN  --  itemise the platform invoice, and tax it
--
-- WHY
-- A platform invoice used to be one number. company_subscriptions carried
-- price_paid and nothing else, so the invoice on the profile page printed a
-- single line -- "Silver plan subscription, KES 5,525" -- for a figure that on
-- a first registration silently contained the KES 4,000 installation fee. The
-- subscription looked 4,000 more expensive than it was and no line said why.
-- sacco_invoices itemised base / per-member / storage but had no installation
-- column at all, and NEITHER table has ever held a VAT figure, which a Kenyan
-- tax invoice must show.
--
-- WHAT THIS ADDS
-- The five components src/config/systemBilling.js prices, stored per row:
--
--     base_fee          flat monthly platform fee for the tier
--     user_fee          seats x per-user   (company; sacco already has
--                       per_member_fee_total for the member equivalent)
--     module_fee        modules enabled beyond what the plan bundles
--     installation_fee  one-time, first invoice only
--     subtotal          the four above, VAT-exclusive
--     vat_rate/vat_amount, and total
--
-- WHY STORE IT RATHER THAN RECOMPUTE IT
-- An invoice must print what was charged, not what the price list says today.
-- Recomputing from the catalogue means a price change silently rewrites every
-- historical invoice; a tenant who paid the old rate would download a document
-- that disagrees with their bank statement. So the breakdown is frozen onto
-- the row when it is raised, and the renderers fall back to computing it only
-- for rows raised before this migration.
--
-- MONEY IS NOT MOVED
-- Prices are VAT-inclusive (systemBilling.VAT_INCLUSIVE_PRICES), so the tax is
-- backed OUT of the existing figures: total stays exactly price_paid, and
-- subtotal + vat_amount = total. Not one row's total changes. Switching to
-- VAT-exclusive pricing is a commercial decision made in the app config, not
-- here.
--
-- Idempotent and transactional -- safe to re-run, lands whole or not at all.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. COMPANY SUBSCRIPTIONS -- the corporate platform invoice
-- ---------------------------------------------------------------------------
alter table public.company_subscriptions
  add column if not exists base_fee         decimal(15,2) not null default 0,
  add column if not exists user_fee         decimal(15,2) not null default 0,
  add column if not exists module_fee       decimal(15,2) not null default 0,
  add column if not exists installation_fee decimal(15,2) not null default 0,
  add column if not exists subtotal         decimal(15,2) not null default 0,
  add column if not exists vat_rate         decimal(5,2)  not null default 16,
  add column if not exists vat_amount       decimal(15,2) not null default 0;

-- ---------------------------------------------------------------------------
-- 2. SACCO INVOICES -- the sacco platform invoice
--    base_fee, per_member_fee_total, storage_fee and total already exist.
-- ---------------------------------------------------------------------------
alter table public.sacco_invoices
  add column if not exists module_fee       decimal(15,2) not null default 0,
  add column if not exists installation_fee decimal(15,2) not null default 0,
  add column if not exists subtotal         decimal(15,2) not null default 0,
  add column if not exists vat_rate         decimal(5,2)  not null default 16,
  add column if not exists vat_amount       decimal(15,2) not null default 0;

-- ---------------------------------------------------------------------------
-- 3. BACKFILL -- company_subscriptions
--
-- price_paid is the gross the tenant actually paid, so it becomes the total and
-- everything else is derived backwards from it.
--
-- The installation fee is charged on a tenant's FIRST subscription row only
-- (admin-registration adds it; the scheduled-change rollover in
-- useAdminSubscription does not). So: earliest row per admin, and only when
-- price_paid actually exceeds the fee -- a cheaper first row means the fee was
-- never in there and guessing otherwise would invent a negative user_fee.
-- ---------------------------------------------------------------------------
with first_row as (
  select distinct on (admin_id) id
  from public.company_subscriptions
  where admin_id is not null
  order by admin_id, created_at, id
)
update public.company_subscriptions s
set installation_fee = case
      when s.id in (select id from first_row) and coalesce(s.price_paid, 0) > 4000 then 4000
      else 0
    end
where s.subtotal = 0
  and s.vat_amount = 0;

-- The remainder after installation is the recurring charge. The corporate line
-- prices entirely per-seat today (companyPlans baseFee = 0), so all of it is
-- user_fee; base_fee and module_fee stay 0 until those are priced.
update public.company_subscriptions
set user_fee = greatest(coalesce(price_paid, 0) - installation_fee, 0)
where subtotal = 0
  and vat_amount = 0;

-- Back the tax out of the gross: subtotal + vat_amount = price_paid, exactly.
update public.company_subscriptions
set subtotal   = round(coalesce(price_paid, 0) / (1 + vat_rate / 100), 2),
    vat_amount = coalesce(price_paid, 0) - round(coalesce(price_paid, 0) / (1 + vat_rate / 100), 2)
where subtotal = 0
  and vat_amount = 0;

-- ---------------------------------------------------------------------------
-- 4. BACKFILL -- sacco_invoices
--
-- These rows are monthly billing runs, never a first registration, so the
-- installation fee stays 0. total is the gross; tax comes back out of it.
-- ---------------------------------------------------------------------------
update public.sacco_invoices
set subtotal   = round(coalesce(total, 0) / (1 + vat_rate / 100), 2),
    vat_amount = coalesce(total, 0) - round(coalesce(total, 0) / (1 + vat_rate / 100), 2)
where subtotal = 0
  and vat_amount = 0;

-- ---------------------------------------------------------------------------
-- 5. INVARIANT
--    Whatever raises an invoice from here on, the printed arithmetic has to
--    hold. NOT VALID so the constraint binds new and updated rows without
--    re-checking history that predates the breakdown columns -- validate it
--    once the backfill above has been eyeballed on the live data:
--        alter table public.company_subscriptions
--          validate constraint company_subscriptions_vat_adds_up;
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'company_subscriptions_vat_adds_up'
      and conrelid = 'public.company_subscriptions'::regclass
  ) then
    alter table public.company_subscriptions
      add constraint company_subscriptions_vat_adds_up
      check (abs(coalesce(subtotal, 0) + coalesce(vat_amount, 0) - coalesce(price_paid, 0)) <= 0.02)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'sacco_invoices_vat_adds_up'
      and conrelid = 'public.sacco_invoices'::regclass
  ) then
    alter table public.sacco_invoices
      add constraint sacco_invoices_vat_adds_up
      check (abs(coalesce(subtotal, 0) + coalesce(vat_amount, 0) - coalesce(total, 0)) <= 0.02)
      not valid;
  end if;
end $$;

comment on column public.company_subscriptions.subtotal is
  'VAT-exclusive sum of base_fee + user_fee + module_fee + installation_fee. subtotal + vat_amount = price_paid.';
comment on column public.sacco_invoices.subtotal is
  'VAT-exclusive sum of base_fee + per_member_fee_total + storage_fee + module_fee + installation_fee. subtotal + vat_amount = total.';

commit;

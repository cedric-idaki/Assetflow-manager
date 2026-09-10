-- ===========================================================================
-- KRA eTIMS INTEGRATION — OPTIONAL, PER TENANT
--
-- WHAT THIS IS
--
-- KRA's electronic Tax Invoice Management System requires a registered
-- taxpayer to transmit every sales invoice to KRA and to print the control-unit
-- data KRA returns — a receipt signature and an internal-data block — on the
-- customer's copy. A receipt without them is not a valid tax invoice, and a
-- purchase evidenced by one is not deductible for the buyer.
--
-- Not every tenant on this platform needs it. A chama does not issue tax
-- invoices; a business below the VAT threshold has no eTIMS obligation. So this
-- is a MODULE, off unless chosen, and this migration is additive in the
-- strictest sense: no existing table gains a NOT NULL column, no existing
-- policy changes, and a tenant who never enables it sees no behavioural
-- difference of any kind.
--
-- ── THE ONE DESIGN DECISION EVERYTHING ELSE FOLLOWS FROM ───────────────────
--
-- TRANSMITTING MUST NEVER BE ABLE TO FAIL A SALE.
--
-- KRA's service is not reliable enough to sit in the path of taking money. It
-- has multi-hour outages. If a POS sale could not complete because KRA was
-- down, a shop would be unable to trade — a far worse outcome than an invoice
-- filed twenty minutes late, which is what the law actually contemplates
-- (offline transmission is provided for precisely because the service goes
-- down).
--
-- So nothing here calls KRA. A sale ENQUEUES a row and commits. A separate
-- edge function drains the queue. Every consequence below follows from that:
--
--   * the enqueue is a trigger, not application code, so a sale cannot escape
--     it if the browser crashes between writing the sale and posting to a
--     function;
--   * the trigger does no work beyond one insert, so it cannot slow the till;
--   * the trigger is wrapped so that a fault in it can never abort the sale
--     (see §6 — the whole point is that eTIMS is subordinate to trading);
--   * the queue carries its own retry state, because "try again later" is the
--     normal case rather than the exception.
--
-- ── WHY THE MODULE IS OFF FOR EXISTING TENANTS ─────────────────────────────
--
-- Every previous module migration in this repo backfilled existing tenants with
-- the new module ENABLED, so that nothing about their portal narrowed on the
-- day it ran (see 20260830200000_sacco_asset_register.sql §7). This one does
-- the opposite, deliberately.
--
-- Enabling eTIMS for a tenant who has not registered a device with KRA would
-- start enqueuing documents that can never transmit, and hand every one of them
-- a compliance screen full of red. Worse, a tenant who HAS a KRA PIN but has
-- not chosen this system as their eTIMS channel could end up double-filing
-- against their own invoicing software. Filing tax documents on somebody's
-- behalf is not a default anyone should acquire by upgrade.
--
-- So existing tenants get the row 'frozen' / 'not_selected', which is the same
-- state a registrant who did not tick the box lands in, and which they can lift
-- for themselves from the Modules tab.
--
-- Idempotent and transactional throughout.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. CREDENTIALS — one row per tenant, and the device sequence lives here
--
-- eTIMS does not use OAuth. A device is initialised once against KRA with the
-- taxpayer's PIN, branch and the serial number KRA issued, and KRA returns a
-- communication key that authenticates every later call. That key is the
-- credential.
--
-- It is AES-256-GCM ciphertext produced by the edge function under
-- ETIMS_CRED_ENC_KEY, which lives only in Supabase function secrets — the same
-- treatment as tenant Daraja secrets and SignNow credentials
-- (supabase/functions/_shared/crypto.ts). The database never holds the key, so
-- a database compromise alone does not let anyone file documents in a tenant's
-- name.
--
-- Held apart from the M-Pesa and SignNow keys because it authorises something
-- different in kind: this key files tax returns. One leaked key must not open
-- all three.
-- ---------------------------------------------------------------------------
create table if not exists public.etims_credentials (
  id               uuid primary key default gen_random_uuid(),
  admin_id         uuid not null unique,

  -- Non-secret and shown back to the operator: these are printed on every
  -- receipt the business issues, so confirming them is how a tenant checks they
  -- configured the right taxpayer.
  kra_pin          text not null,
  branch_id        text not null default '00',
  device_serial    text not null,
  environment      text not null default 'sandbox'
                     check (environment in ('sandbox', 'production')),

  -- The communication key. Never returned to any client, ever.
  cmc_key_enc      text,

  -- What KRA told us about the device at initialisation.
  control_unit_id  text,
  initialised_at   timestamptz,

  -- Only a successful device initialisation sets this. The transmit function
  -- skips inactive rows, so a tenant who typed a wrong PIN queues nothing
  -- rather than queuing documents that can never be filed.
  is_active        boolean not null default false,
  verified_at      timestamptz,
  last_error       text,

  -- ── THE DEVICE SEQUENCE ──────────────────────────────────────────────────
  -- KRA requires invcNo to be an integer that only ever increases for a given
  -- PIN + branch. It is NOT this system's invoice_number string, and it must
  -- not be derived from a timestamp or a row count: both repeat, and a repeated
  -- number is either rejected as a duplicate or files a second document
  -- against the first one's number.
  --
  -- So it is a counter, allocated under a row lock by
  -- etims_next_invoice_number() in §3, and it lives on this row because the
  -- device it counts for is this row.
  last_invoice_number bigint not null default 0,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.etims_credentials is
  'One eTIMS device per tenant. cmc_key_enc is AES-GCM ciphertext under ETIMS_CRED_ENC_KEY and is readable only by the edge functions.';
comment on column public.etims_credentials.last_invoice_number is
  'The device invoice sequence KRA requires to increase monotonically. Allocated only by etims_next_invoice_number().';

-- RLS ON, ZERO POLICIES. Nothing in the browser reads or writes this table;
-- the etims-credentials edge function is the only door and it runs under the
-- service role, which bypasses RLS. This is the same shape as
-- mpesa_tenant_credentials — a table holding a key that authorises actions in
-- a tenant's legal name should not be one policy bug away from readable.
alter table public.etims_credentials enable row level security;

-- ---------------------------------------------------------------------------
-- 2. ITEM CLASSIFICATION — the thing that cannot be guessed
--
-- A sale in this system carries a boolean: `vatApplicable`
-- (src/pages/pos-module/index.jsx). KRA wants a tax TYPE per line, and the
-- "off" position of that boolean is three different types:
--
--     A  Exempt      outside VAT by law; input tax NOT reclaimable
--     C  Zero rated  taxable at 0%; input tax IS reclaimable
--     D  Non-VAT     not a VAT supply at all
--
-- All three charge the customer nothing, which is how one toggle could stand in
-- for them at the till. They are different lines of a VAT return, and filing
-- one as another misstates it. Nothing in this feature guesses between them:
-- an item with no row here stops its invoice and is named on the compliance
-- screen until somebody classifies it.
--
-- KRA also requires an itemClsCd — a classification code from a published list
-- of several thousand — and refuses a sales line for an item it was never told
-- about, which is why registered_at exists.
-- ---------------------------------------------------------------------------
create table if not exists public.etims_item_classifications (
  id                  uuid primary key default gen_random_uuid(),
  admin_id            uuid not null,

  -- Either an asset in this system, or a free-text code for something sold
  -- that is not in the asset register (a service line, a delivery charge).
  asset_id            uuid,
  item_code           text not null,
  item_name           text,

  -- KRA's own classification code for the item.
  classification_code text,

  -- One of A / B / C / D / E. Not defaulted — see the header of
  -- src/config/etimsCodes.js.
  tax_code            text check (tax_code in ('A', 'B', 'C', 'D', 'E')),

  quantity_unit       text not null default 'U',
  packaging_unit      text not null default 'NT',
  item_type           text not null default '2',
  origin_country      text not null default 'KE',

  -- Stamped when KRA accepted saveItem for this code. A line for an
  -- unregistered item is rejected, so the transmit function registers first.
  registered_at       timestamptz,
  last_error          text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists etims_item_cls_admin_code_idx
  on public.etims_item_classifications (admin_id, item_code);
-- Partial, because most rows are keyed by code rather than by an asset.
create unique index if not exists etims_item_cls_admin_asset_idx
  on public.etims_item_classifications (admin_id, asset_id)
  where asset_id is not null;

comment on table public.etims_item_classifications is
  'Per-tenant KRA classification for everything it sells. An item with no row here cannot be filed; the builder refuses rather than assuming a tax code.';

alter table public.etims_item_classifications enable row level security;

drop policy if exists etims_item_cls_tenant_read on public.etims_item_classifications;
create policy etims_item_cls_tenant_read
  on public.etims_item_classifications for select
  using (admin_id = public.current_admin_id() or public.is_global_viewer());

drop policy if exists etims_item_cls_tenant_write on public.etims_item_classifications;
create policy etims_item_cls_tenant_write
  on public.etims_item_classifications for all
  using (admin_id = public.current_admin_id())
  with check (admin_id = public.current_admin_id());

-- ---------------------------------------------------------------------------
-- 3. THE TRANSMISSION LEDGER
--
-- One row per document KRA should receive. It is a queue, an audit trail and
-- the source of the block printed on the customer's receipt, all at once —
-- because those are the same facts and splitting them would let them disagree.
--
-- STATUSES, and what each one means for the tenant:
--
--   pending     Not yet accepted. next_attempt_at says when to try again.
--   sent        Filed. receipt_signature is set and the receipt can print it.
--               Terminal — nothing re-sends a document in this state.
--   rejected    KRA read it and refused it. Deterministic, so it does NOT
--               retry on a timer: it waits for the fault to be fixed and for
--               somebody to release it. Retrying a malformed document forty
--               times is how a real outage gets buried in the log.
--   uncertain   The request timed out or the gateway failed mid-flight. THE
--               DOCUMENT MAY OR MAY NOT BE FILED. Re-sending risks a duplicate
--               filing; not re-sending risks an unfiled sale. Neither is safe
--               to choose automatically, so a human decides. This status is the
--               single most important thing in this table.
--   cancelled   Superseded — the sale was voided before it ever transmitted.
--
-- WHAT IS STORED AND WHY IT IS STORED AT ENQUEUE TIME
--
--   prices_include_tax   Whether the figures on the source document already
--                        contain the tax. The POS is tax-EXCLUSIVE
--                        (`totalAmount = priceAfterDiscount + vatAmount`);
--                        platform billing is inclusive. Reading one as the
--                        other misstates every line, so it is recorded as a
--                        FACT ABOUT THIS DOCUMENT when the document is created
--                        rather than read from a setting that could later be
--                        flipped and retroactively change what a queued
--                        invoice means. Same lesson as sales.vat_percent in
--                        migration 20260902140000.
--
--   environment          Stamped per row. A tenant who tested in sandbox and
--                        then went live must never be shown a sandbox-filed
--                        document as though it were filed for real.
--
--   payload              Exactly what was sent. Kept because KRA's rejection
--                        messages are frequently unintelligible without it.
-- ---------------------------------------------------------------------------
create table if not exists public.etims_invoices (
  id                  uuid primary key default gen_random_uuid(),
  admin_id            uuid not null,

  -- What this document is for. sale_id is nullable because a credit note or a
  -- Finance Hub invoice is not a POS sale.
  sale_id             uuid,
  source              text not null default 'pos'
                        check (source in ('pos', 'invoice', 'manual')),
  doc_type            text not null default 'sale'
                        check (doc_type in ('sale', 'credit_note')),
  -- The document a credit note reverses.
  reverses_id         uuid references public.etims_invoices (id),

  -- The device sequence, allocated on the FIRST transmit attempt and reused on
  -- every retry of the same document. Not allocated at enqueue: a document that
  -- never transmits should not burn a number out of a sequence KRA expects to
  -- be dense.
  invoice_number      bigint,

  status              text not null default 'pending'
                        check (status in ('pending', 'sent', 'rejected', 'uncertain', 'cancelled')),

  attempts            integer not null default 0,
  next_attempt_at     timestamptz not null default now(),
  last_error          text,
  last_result_code    text,

  prices_include_tax  boolean not null default false,
  environment         text not null default 'sandbox',

  -- A snapshot of the figures, so the compliance screen can total a period
  -- without reopening every payload.
  total_taxable       numeric(14,2),
  total_tax           numeric(14,2),
  total_amount        numeric(14,2),

  payload             jsonb,

  -- ── What KRA returned. This is what the receipt prints. ─────────────────
  receipt_signature   text,
  internal_data       text,
  kra_invoice_number  bigint,
  control_unit_id     text,
  control_unit_at     text,
  qr_url              text,
  transmitted_at      timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One live document per sale per type. Partial on 'cancelled' so a voided
-- attempt can be superseded by a fresh one, and on a null sale_id so manual
-- documents are not constrained against each other.
create unique index if not exists etims_invoices_sale_doc_idx
  on public.etims_invoices (sale_id, doc_type)
  where sale_id is not null and status <> 'cancelled';

-- The queue drain: due work for one tenant, oldest first.
create index if not exists etims_invoices_due_idx
  on public.etims_invoices (status, next_attempt_at)
  where status = 'pending';

-- The compliance screen: one tenant's documents, newest first.
create index if not exists etims_invoices_admin_created_idx
  on public.etims_invoices (admin_id, created_at desc);

comment on table public.etims_invoices is
  'The eTIMS transmission queue and audit trail. status=uncertain means the document may or may not be filed at KRA and needs a human decision — never retried automatically.';
comment on column public.etims_invoices.prices_include_tax is
  'Recorded when the document was created, not read from a setting, so a later change cannot retroactively alter what a queued invoice means.';

alter table public.etims_invoices enable row level security;

-- A tenant reads its own filing history — it is their tax record, and the
-- compliance screen is the whole point. Writes go through the edge function
-- under the service role: nothing in a browser may alter a transmission result,
-- because those are the figures a receipt asserts to a customer.
drop policy if exists etims_invoices_tenant_read on public.etims_invoices;
create policy etims_invoices_tenant_read
  on public.etims_invoices for select
  using (admin_id = public.current_admin_id() or public.is_global_viewer());

-- ---------------------------------------------------------------------------
-- 4. THE DEVICE SEQUENCE
--
-- SECURITY DEFINER because etims_credentials has no policies and the caller is
-- the edge function's service role anyway; defined as a function so the row
-- lock is not something a caller can forget.
--
-- `for update` serialises two concurrent tills: without it both read the same
-- last number and both file under it, and KRA keeps whichever arrived first.
-- ---------------------------------------------------------------------------
create or replace function public.etims_next_invoice_number(p_admin uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_next bigint;
begin
  update public.etims_credentials
     set last_invoice_number = last_invoice_number + 1,
         updated_at          = now()
   where admin_id = p_admin
  returning last_invoice_number into v_next;

  if v_next is null then
    raise exception 'eTIMS is not configured for this account' using errcode = '22023';
  end if;

  return v_next;
end;
$fn$;

-- Service role ONLY. Allocating a device sequence number is not something a
-- browser may do: a caller who could burn numbers could push the sequence past
-- what KRA has seen, and every later filing would be refused as out of order.
-- The revoke strips the default grant to PUBLIC (which service_role inherits),
-- so the grant that follows is what actually lets etims-transmit call it.
revoke execute on function public.etims_next_invoice_number(uuid) from public, anon, authenticated;
grant  execute on function public.etims_next_invoice_number(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. MODULE CATALOGUE
--
-- Mirrored in src/config/modules.js — the database owns the key list, that file
-- owns the label, icon and which preset offers it. Change one, change both.
--
-- `requires` is empty: eTIMS files documents from the POS today and from the
-- Finance Hub invoice book as that is wired up, so it is not dependent on
-- either one being enabled.
-- ---------------------------------------------------------------------------
create or replace function public.module_catalogue()
returns table (module_key text, requires text[])
language sql
immutable
as $fn$
  select * from (values
    -- key              requires (must be enabled for this module to work)
    ('assets',          '{}'::text[]),
    ('clients',         '{}'::text[]),
    ('pos',             array['assets']),
    ('hire_purchase',   array['clients']),
    ('payments',        '{}'::text[]),
    ('mpesa',           array['payments']),
    ('kyc',             array['clients']),
    ('esign',           '{}'::text[]),
    ('contracts',       '{}'::text[]),
    ('crm',             array['clients']),
    ('hr',              '{}'::text[]),
    ('payroll',         array['hr']),
    ('reports',         '{}'::text[]),
    ('accounting',      '{}'::text[]),
    -- sacco / chama
    ('members',         '{}'::text[]),
    ('contributions',   array['members']),
    ('loans',           array['members']),
    ('shares',          array['members']),
    ('voting',          array['members']),
    ('welfare',         array['members']),
    ('mgr',             array['members']),
    ('fixed_assets',    '{}'::text[]),
    -- compliance
    ('etims',           '{}'::text[])
  ) as t(module_key, requires);
$fn$;

-- The write gate is attached to the CLASSIFICATION table only. It is
-- deliberately NOT attached to etims_invoices: that table is written by the
-- enqueue trigger below, inside the transaction that records a sale, and a
-- guard that raised there would abort the sale itself. eTIMS must never be able
-- to stop a shop trading — see the header.
drop trigger if exists trg_module_gate on public.etims_item_classifications;
create trigger trg_module_gate
  before insert or update or delete on public.etims_item_classifications
  for each row execute function public.enforce_module_write('etims');

-- ---------------------------------------------------------------------------
-- 6. THE ENQUEUE TRIGGER
--
-- WHY A TRIGGER AND NOT APPLICATION CODE
-- A sale that is recorded but never queued is an unfiled tax document that
-- nobody knows about. The browser cannot be the thing that guarantees the
-- enqueue: it can be closed, refreshed or lose its connection in the moment
-- between writing the sale and calling a function. In the database, the queue
-- row and the sale commit together or neither does.
--
-- WHY THE WHOLE BODY IS WRAPPED IN AN EXCEPTION HANDLER
-- This trigger runs inside the transaction that takes a customer's money. Any
-- error it raises — a constraint added later, a type change, anything — would
-- roll the SALE back. That trade is never worth making: an unqueued document
-- can be filed late, where a till that cannot take payment costs the tenant
-- their day's trade. So it catches everything, warns, and lets the sale
-- through. The compliance screen shows sales with no queue row, so the failure
-- is visible rather than silent.
--
-- WHAT IT DOES NOT DO
-- No HTTP. No KRA call. Nothing that can block. One insert, guarded by two
-- cheap lookups.
-- ---------------------------------------------------------------------------
create or replace function public.etims_enqueue_sale()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_creds public.etims_credentials;
begin
  -- Only tenants who have switched the module on and connected a device.
  -- Note this is module_enabled(_, admin_id) with an explicit tenant rather
  -- than the caller's: a sale can be recorded by a service-role process where
  -- current_admin_id() is null.
  if new.admin_id is null then
    return new;
  end if;

  if not public.module_enabled('etims', new.admin_id) then
    return new;
  end if;

  select * into v_creds
    from public.etims_credentials
   where admin_id = new.admin_id and is_active;

  if not found then
    return new;
  end if;

  insert into public.etims_invoices
    (admin_id, sale_id, source, doc_type, status,
     -- The POS computes `totalAmount = priceAfterDiscount + vatAmount`, so its
     -- captured prices are NET and the tax is added on top. Recorded here as a
     -- fact about this document rather than read later from a setting.
     prices_include_tax,
     environment, total_amount)
  values
    (new.admin_id, new.id, 'pos', 'sale', 'pending',
     false,
     v_creds.environment, new.total_amount)
  on conflict do nothing;

  return new;

exception when others then
  -- Deliberately swallowed. See the header of this section: a sale must not
  -- fail because a tax document could not be queued.
  raise warning 'eTIMS enqueue skipped for sale %: %', new.id, sqlerrm;
  return new;
end;
$fn$;

do $do$
begin
  if to_regclass('public.sales') is not null then
    drop trigger if exists trg_etims_enqueue on public.sales;
    create trigger trg_etims_enqueue
      after insert on public.sales
      for each row execute function public.etims_enqueue_sale();
  else
    raise notice 'public.sales not present; eTIMS enqueue trigger not attached.';
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- 7. WHAT THE COMPLIANCE SCREEN READS
--
-- Aggregates come from an RPC rather than from counting a capped array in the
-- browser — a page that fetches 100 rows and totals them reports the total of
-- 100 rows, not of the tenant's filing history. Same rule as the dashboard
-- stats RPCs (20260822140000).
--
-- SECURITY INVOKER: the caller's own RLS decides which rows they can see, so
-- this cannot become a way to read another tenant's tax position.
-- ---------------------------------------------------------------------------
create or replace function public.etims_queue_summary(p_since timestamptz default null)
returns table (
  pending    bigint,
  sent       bigint,
  rejected   bigint,
  uncertain  bigint,
  cancelled  bigint,
  due_now    bigint,
  tax_filed  numeric,
  oldest_pending timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  select
    count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'sent'),
    count(*) filter (where status = 'rejected'),
    count(*) filter (where status = 'uncertain'),
    count(*) filter (where status = 'cancelled'),
    count(*) filter (where status = 'pending' and next_attempt_at <= now()),
    coalesce(sum(total_tax) filter (where status = 'sent'), 0),
    min(created_at) filter (where status = 'pending')
  from public.etims_invoices
  where (p_since is null or created_at >= p_since);
$fn$;

revoke execute on function public.etims_queue_summary(timestamptz) from public, anon;
grant  execute on function public.etims_queue_summary(timestamptz) to authenticated;

/**
 * Sales this tenant has made that eTIMS cannot file, and why.
 *
 * The compliance screen's whole job. An unclassified item is not an error the
 * tenant caused, it is work they have not done yet, so it is reported as a
 * to-do list keyed by item rather than as a list of failed invoices.
 */
create or replace function public.etims_unclassified_items()
returns table (
  asset_id     uuid,
  item_code    text,
  item_name    text,
  sale_count   bigint,
  missing      text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  select
    a.id,
    coalesce(a.asset_code, a.id::text),
    a.description,
    count(s.id),
    case
      when c.id is null                    then 'unclassified'
      when c.tax_code is null              then 'no tax code'
      when c.classification_code is null   then 'no classification code'
      when c.registered_at is null         then 'not registered with KRA'
      else 'ok'
    end
  from public.sales s
  join public.assets a on a.id = s.asset_id
  left join public.etims_item_classifications c
         on c.admin_id = s.admin_id
        and (c.asset_id = a.id or c.item_code = a.asset_code)
  where s.admin_id = public.current_admin_id()
    and (
      c.id is null
      or c.tax_code is null
      or c.classification_code is null
      or c.registered_at is null
    )
  group by a.id, a.asset_code, a.description, c.id, c.tax_code, c.classification_code, c.registered_at;
$fn$;

revoke execute on function public.etims_unclassified_items() from public, anon;
grant  execute on function public.etims_unclassified_items() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. SEEDING — off for everyone who already exists
--
-- The opposite of every previous module backfill in this repo, on purpose. See
-- the header: filing tax documents on a tenant's behalf is not a default that
-- should be acquired by an upgrade. 'not_selected' is the same state a
-- registrant who did not tick the box lands in, and the tenant can lift it
-- themselves from the Modules tab without asking anyone.
-- ---------------------------------------------------------------------------
insert into public.tenant_modules
  (admin_id, module_key, status, frozen_reason, frozen_at, changed_by)
select up.id, 'etims', 'frozen', 'not_selected', now(), null
  from public.user_profiles up
 where up.role::text in ('admin', 'sacco_admin')
on conflict (admin_id, module_key) do nothing;

commit;

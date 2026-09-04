-- ===========================================================================
-- eTIMS PURCHASES — PULLED FROM KRA, NOT TYPED IN
--
-- WHY THERE IS NO SUPPLIER BOOK HERE
--
-- KRA matches a purchase to the SUPPLIER'S OWN FILED SALE. insertTrnsPurchase
-- wants spplrTin, spplrBhfId and spplrInvcNo — the counterparty's PIN, branch
-- and invoice number — because the whole point is to reconcile the two sides of
-- one transaction. This system records none of that: there is no purchases
-- table, no suppliers table, and assets.purchase_price is a cost figure with no
-- counterparty attached to it.
--
-- Building a supplier book to type all of it in would be the wrong answer even
-- if the data existed. The supplier has already filed the sale; KRA already
-- holds it. selectTrnsPurchaseSalesList hands it back keyed to the buyer's PIN,
-- so the tenant's job is to REVIEW what is already there and accept or reject
-- it — which is the workflow eTIMS is designed around, and which needs no data
-- entry at all.
--
-- SO NOTHING IN THIS FEATURE COMPUTES A PURCHASE FIGURE.
--
-- Every amount stored below came from KRA. The raw record is kept verbatim in
-- `source` and the columns beside it are a flattening of that record for the
-- screen to read, not a recalculation of it. When an accepted purchase is filed
-- back, it is KRA's own numbers going home again. A system that recomputed them
-- could disagree with the supplier's filing, and a disagreement here is a
-- reconciliation failure on somebody's VAT return.
--
-- WHAT A TENANT ACTUALLY DECIDES
--
-- Accept  -- yes, we bought this; it belongs in our input VAT.
-- Reject  -- we did not buy this, or not on these terms. Filed as rejected so
--            KRA and the supplier both see the dispute.
--
-- Neither is guessable, so neither is defaulted, and nothing is auto-accepted.
--
-- Idempotent and transactional.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. THE PURCHASE
-- ---------------------------------------------------------------------------
create table if not exists public.etims_purchases (
  id                  uuid primary key default gen_random_uuid(),
  admin_id            uuid not null,

  -- ── The counterparty, exactly as KRA reported it ────────────────────────
  supplier_pin        text not null,
  supplier_name       text,
  supplier_branch     text,
  supplier_invoice_no bigint not null,

  -- KRA's own control data for the supplier's document.
  supplier_sdc_id     text,
  supplier_mrc_no     text,
  receipt_type        text,
  payment_type        text,

  purchase_date       date,
  confirmed_at        timestamptz,

  -- A flattening of `source` for the list to read. Never recomputed.
  total_taxable       numeric(14,2),
  total_tax           numeric(14,2),
  total_amount        numeric(14,2),

  -- KRA's record, verbatim. The source of truth for everything above.
  source              jsonb not null,

  -- ── The tenant's decision ───────────────────────────────────────────────
  -- 'new' until a human looks at it. Nothing is auto-accepted: accepting a
  -- purchase claims input VAT, and claiming tax on a supply that never
  -- happened is the tenant's liability, not this system's to assume.
  decision            text not null default 'new'
                        check (decision in ('new', 'accepted', 'rejected')),
  decided_at          timestamptz,
  decided_by          uuid,
  decision_note       text,

  -- ── Filing the decision back ────────────────────────────────────────────
  -- Only an accepted or rejected purchase is transmitted. 'none' is the resting
  -- state of something nobody has ruled on yet.
  status              text not null default 'none'
                        check (status in ('none', 'pending', 'sent', 'rejected', 'uncertain', 'cancelled')),
  attempts            integer not null default 0,
  next_attempt_at     timestamptz not null default now(),
  last_error          text,
  last_result_code    text,
  environment         text not null default 'sandbox',
  transmitted_at      timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One row per supplier document. The pull is re-run on a schedule and must be
-- able to see the same purchase repeatedly without duplicating it.
create unique index if not exists etims_purchases_supplier_doc_idx
  on public.etims_purchases (admin_id, supplier_pin, supplier_invoice_no);

create index if not exists etims_purchases_due_idx
  on public.etims_purchases (status, next_attempt_at)
  where status = 'pending';

create index if not exists etims_purchases_admin_idx
  on public.etims_purchases (admin_id, decision, purchase_date desc);

comment on table public.etims_purchases is
  'Purchases KRA reports against this tenant PIN, pulled by selectTrnsPurchaseSalesList. Every figure comes from KRA; nothing here is computed.';

alter table public.etims_purchases enable row level security;

drop policy if exists etims_purchases_tenant_read on public.etims_purchases;
create policy etims_purchases_tenant_read
  on public.etims_purchases for select
  using (admin_id = public.current_admin_id() or public.is_global_viewer());

-- ---------------------------------------------------------------------------
-- 2. ITS LINES
--
-- Stored as rows rather than left inside `source` because the review screen has
-- to show a tenant what they are accepting, line by line — "do you recognise
-- this?" is not a question you can ask against a JSON blob.
-- ---------------------------------------------------------------------------
create table if not exists public.etims_purchase_items (
  id                  uuid primary key default gen_random_uuid(),
  purchase_id         uuid not null references public.etims_purchases (id) on delete cascade,

  item_seq            integer,
  item_code           text,
  classification_code text,
  item_name           text,

  quantity            numeric(14,2),
  quantity_unit       text,
  packaging_unit      text,
  unit_price          numeric(14,2),
  supply_amount       numeric(14,2),
  discount_amount     numeric(14,2),

  tax_code            text,
  taxable_amount      numeric(14,2),
  tax_amount          numeric(14,2),
  total_amount        numeric(14,2),

  created_at          timestamptz not null default now()
);

create unique index if not exists etims_purchase_items_seq_idx
  on public.etims_purchase_items (purchase_id, item_seq);

alter table public.etims_purchase_items enable row level security;

-- A line is visible to whoever can see its purchase. Expressed as a join rather
-- than a copied admin_id so the two can never disagree about who owns them.
drop policy if exists etims_purchase_items_tenant_read on public.etims_purchase_items;
create policy etims_purchase_items_tenant_read
  on public.etims_purchase_items for select
  using (
    exists (
      select 1 from public.etims_purchases p
       where p.id = etims_purchase_items.purchase_id
         and (p.admin_id = public.current_admin_id() or public.is_global_viewer())
    )
  );

-- ---------------------------------------------------------------------------
-- 3. RULING ON ONE
--
-- SECURITY DEFINER because both tables are read-only to a tenant. What the
-- caller supplies is a verdict and a note — never an amount, for the reason in
-- the header.
--
-- Setting the decision also queues the filing (status 'pending'), so a tenant
-- cannot end up having decided something that never reached KRA.
-- ---------------------------------------------------------------------------
create or replace function public.etims_decide_purchase(
  p_purchase uuid,
  p_decision text,
  p_note     text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_admin uuid := public.current_admin_id();
  v_row   public.etims_purchases;
begin
  if v_admin is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if not public.module_enabled('etims', v_admin) then
    raise exception 'The KRA eTIMS module is not enabled for this account.'
      using errcode = 'P0001';
  end if;

  if p_decision not in ('accepted', 'rejected') then
    raise exception 'A purchase is either accepted or rejected.' using errcode = 'P0001';
  end if;

  select * into v_row
    from public.etims_purchases
   where id = p_purchase and admin_id = v_admin;

  if not found then
    raise exception 'That purchase does not exist.' using errcode = 'P0002';
  end if;

  -- A decision already filed is not re-openable from here. Changing what KRA
  -- was told about a purchase after the fact is a correction, not an edit, and
  -- there is no eTIMS call that quietly overwrites one.
  if v_row.status = 'sent' then
    raise exception 'This purchase has already been filed with KRA and cannot be changed here.'
      using errcode = 'P0001';
  end if;

  update public.etims_purchases
     set decision        = p_decision,
         decision_note   = nullif(btrim(coalesce(p_note, '')), ''),
         decided_at      = now(),
         decided_by      = auth.uid(),
         status          = 'pending',
         attempts        = 0,
         next_attempt_at = now(),
         last_error      = null,
         updated_at      = now()
   where id = p_purchase;
end;
$fn$;

revoke execute on function public.etims_decide_purchase(uuid, text, text) from public, anon;
grant  execute on function public.etims_decide_purchase(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. WHAT THE SCREEN READS
-- ---------------------------------------------------------------------------
create or replace function public.etims_purchase_summary()
returns table (
  awaiting  bigint,
  accepted  bigint,
  rejected  bigint,
  unfiled   bigint,
  input_tax numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  select
    count(*) filter (where decision = 'new'),
    count(*) filter (where decision = 'accepted'),
    count(*) filter (where decision = 'rejected'),
    count(*) filter (where status in ('pending', 'rejected', 'uncertain')),
    -- Input tax the tenant has actually accepted. Deliberately not the total of
    -- everything pulled: tax on a purchase nobody has agreed to is not
    -- reclaimable, and showing it as though it were invites a wrong return.
    coalesce(sum(total_tax) filter (where decision = 'accepted'), 0)
  from public.etims_purchases
  where admin_id = public.current_admin_id();
$fn$;

revoke execute on function public.etims_purchase_summary() from public, anon;
grant  execute on function public.etims_purchase_summary() to authenticated;

commit;

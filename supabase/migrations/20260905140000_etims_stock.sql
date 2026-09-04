-- ===========================================================================
-- eTIMS STOCK
--
-- KRA expects two different things about stock, and conflating them is the
-- usual way this goes wrong:
--
--   insertStockIO    a MOVEMENT. "two of item X left the premises, as a sale,
--                    on this date." Sequenced per device, like an invoice.
--   saveStockMaster  a BALANCE. "there are now nine of item X." Not a
--                    movement; it is the declared closing quantity.
--
-- WHAT THIS SYSTEM CAN HONESTLY SAY
--
-- The balance is exact: assets.quantity_available is the live figure the POS
-- itself decrements, so declaring it needs no inference at all.
--
-- The movements are where care is required. A POS sale is unambiguous — one
-- unit of one asset left, because that is what a sale in this system is
-- (etims-transmit builds every sale line with quantity 1). Everything else that
-- changes quantity_available is NOT self-describing: an edit that drops the
-- count from 9 to 4 could be a write-off, breakage, a stock transfer or a
-- correction of a miscount, and each is a different sarTyCd on a tax filing.
--
-- SO THIS DOES NOT TRIGGER ON assets.
--
-- The tempting design is a trigger on assets.quantity_available that turns
-- every change into a movement. It was rejected: it would have to GUESS the
-- movement type, and a guess here is a fabricated statement about stock in a
-- tax record. Defaulting every decrement to "sale" would file write-offs as
-- sales and overstate revenue against the tenant's own returns.
--
-- Movements therefore come from exactly two places, both of which know what
-- they are:
--
--   1. a POS sale          -> trigger, direction 'out', code 11
--   2. a tenant saying so  -> etims_record_stock_adjustment(), where they
--                             choose the reason
--
-- and the BALANCE is declared from assets.quantity_available regardless, which
-- is what actually keeps KRA's stock position correct even if a tenant never
-- records a single manual adjustment.
--
-- Idempotent and transactional.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. THE STOCK SEQUENCE
--
-- KRA sequences stock movements per device with sarNo, exactly as it sequences
-- invoices with invcNo, and with the same rule: monotonic, never reused. It is
-- a SEPARATE counter from the invoice one — sharing a counter between the two
-- would leave gaps in both, and KRA expects each to be dense.
-- ---------------------------------------------------------------------------
alter table public.etims_credentials
  add column if not exists last_sar_number bigint not null default 0;

comment on column public.etims_credentials.last_sar_number is
  'The device stock-movement sequence (sarNo). Allocated only by etims_next_sar_number().';

create or replace function public.etims_next_sar_number(p_admin uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_next bigint;
begin
  update public.etims_credentials
     set last_sar_number = last_sar_number + 1,
         updated_at      = now()
   where admin_id = p_admin
  returning last_sar_number into v_next;

  if v_next is null then
    raise exception 'eTIMS is not configured for this account' using errcode = '22023';
  end if;

  return v_next;
end;
$fn$;

-- Service role only, for the same reason as the invoice sequence: a caller who
-- could burn numbers could push the sequence past what KRA has seen.
revoke execute on function public.etims_next_sar_number(uuid) from public, anon, authenticated;
grant  execute on function public.etims_next_sar_number(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. THE MOVEMENT QUEUE
--
-- Same shape as etims_invoices and for the same reasons: a movement is queued
-- and drained rather than sent inline, so KRA being down cannot fail a sale.
-- ---------------------------------------------------------------------------
create table if not exists public.etims_stock_movements (
  id               uuid primary key default gen_random_uuid(),
  admin_id         uuid not null,

  -- What moved. item_code is resolved and frozen at enqueue rather than joined
  -- at transmit: renaming an asset later must not rewrite what was filed.
  asset_id         uuid,
  item_code        text not null,

  direction        text not null check (direction in ('in', 'out')),
  quantity         numeric(14,2) not null check (quantity > 0),

  -- KRA's sarTyCd. NULL means "use the default for this direction", which the
  -- shared builder applies (11 out / 02 in). Nullable and overridable because
  -- the authoritative list comes from selectCodeList, which nothing fetches
  -- yet — the same honesty as the credit-note reason code.
  movement_code    text check (movement_code is null or movement_code ~ '^[0-9]{2}$'),

  -- Set when the movement came from a sale, so a filing can be traced back to
  -- the document that caused it.
  sale_id          uuid,
  note             text,

  sar_number       bigint,
  status           text not null default 'pending'
                     check (status in ('pending', 'sent', 'rejected', 'uncertain', 'cancelled')),
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  last_error       text,
  last_result_code text,
  environment      text not null default 'sandbox',
  payload          jsonb,
  occurred_at      timestamptz not null default now(),
  transmitted_at   timestamptz,
  raised_by        uuid,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- One movement per sale. A sale is one unit of one asset, so a second row for
-- the same sale is a double count of stock leaving.
create unique index if not exists etims_stock_sale_idx
  on public.etims_stock_movements (sale_id)
  where sale_id is not null and status <> 'cancelled';

create index if not exists etims_stock_due_idx
  on public.etims_stock_movements (status, next_attempt_at)
  where status = 'pending';

create index if not exists etims_stock_admin_created_idx
  on public.etims_stock_movements (admin_id, created_at desc);

comment on table public.etims_stock_movements is
  'Queued KRA stock movements (insertStockIO). Written by the sales trigger and by etims_record_stock_adjustment; results are written only by the edge function.';

alter table public.etims_stock_movements enable row level security;

-- Read-only to the tenant, for the same reason as etims_invoices: a movement's
-- transmitted state is a tax record, and nothing in a browser may set it.
drop policy if exists etims_stock_tenant_read on public.etims_stock_movements;
create policy etims_stock_tenant_read
  on public.etims_stock_movements for select
  using (admin_id = public.current_admin_id() or public.is_global_viewer());

-- ---------------------------------------------------------------------------
-- 3. STOCK LEAVING ON A SALE
--
-- A second trigger on sales rather than more work inside etims_enqueue_sale():
-- the two are independent filings, and a fault in one must not cost the other.
-- Both swallow their own errors — see 20260902160000 §6. A shop must keep
-- trading through anything that happens here.
-- ---------------------------------------------------------------------------
create or replace function public.etims_enqueue_stock_out()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_creds public.etims_credentials;
  v_code  text;
begin
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

  select coalesce(a.asset_code, a.id::text) into v_code
    from public.assets a
   where a.id = new.asset_id;

  if v_code is null then
    return new;
  end if;

  insert into public.etims_stock_movements
    (admin_id, asset_id, item_code, direction, quantity, movement_code,
     sale_id, environment, occurred_at)
  values
    (new.admin_id, new.asset_id, v_code, 'out', 1, '11',
     new.id, v_creds.environment,
     coalesce(new.sale_date::timestamptz, new.created_at, now()))
  on conflict do nothing;

  return new;

exception when others then
  raise warning 'eTIMS stock enqueue skipped for sale %: %', new.id, sqlerrm;
  return new;
end;
$fn$;

do $do$
begin
  if to_regclass('public.sales') is not null then
    drop trigger if exists trg_etims_stock_enqueue on public.sales;
    create trigger trg_etims_stock_enqueue
      after insert on public.sales
      for each row execute function public.etims_enqueue_stock_out();
  else
    raise notice 'public.sales not present; eTIMS stock trigger not attached.';
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- 4. A MOVEMENT THE TENANT DECLARES
--
-- Stock received, written off, broken, transferred. The tenant supplies the
-- reason because only they know it — see the header.
--
-- Note this does NOT change assets.quantity_available. It records what to tell
-- KRA about a change the tenant has already made (or is about to make) in the
-- asset register. Making this the writer of stock levels would put a tax
-- integration in charge of the tenant's own inventory, which is backwards.
-- ---------------------------------------------------------------------------
create or replace function public.etims_record_stock_adjustment(
  p_asset         uuid,
  p_direction     text,
  p_quantity      numeric,
  p_movement_code text default null,
  p_note          text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_admin uuid := public.current_admin_id();
  v_creds public.etims_credentials;
  v_code  text;
  v_new   uuid;
begin
  if v_admin is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  if not public.module_enabled('etims', v_admin) then
    raise exception 'The KRA eTIMS module is not enabled for this account.'
      using errcode = 'P0001';
  end if;

  if p_direction not in ('in', 'out') then
    raise exception 'A stock movement is either in or out.' using errcode = 'P0001';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'A stock movement needs a quantity greater than zero.'
      using errcode = 'P0001';
  end if;

  if p_movement_code is not null and p_movement_code !~ '^[0-9]{2}$' then
    raise exception 'A KRA stock movement code is two digits.' using errcode = 'P0001';
  end if;

  select * into v_creds
    from public.etims_credentials
   where admin_id = v_admin and is_active;

  if not found then
    raise exception 'No active KRA device is registered for this account.'
      using errcode = 'P0001';
  end if;

  select coalesce(a.asset_code, a.id::text) into v_code
    from public.assets a
   where a.id = p_asset and a.admin_id = v_admin;

  if v_code is null then
    raise exception 'That item does not belong to this account.' using errcode = 'P0002';
  end if;

  insert into public.etims_stock_movements
    (admin_id, asset_id, item_code, direction, quantity, movement_code,
     note, environment, raised_by)
  values
    (v_admin, p_asset, v_code, p_direction, p_quantity,
     nullif(btrim(coalesce(p_movement_code, '')), ''),
     nullif(btrim(coalesce(p_note, '')), ''),
     v_creds.environment, auth.uid())
  returning id into v_new;

  return v_new;
end;
$fn$;

revoke execute on function public.etims_record_stock_adjustment(uuid, text, numeric, text, text)
  from public, anon;
grant  execute on function public.etims_record_stock_adjustment(uuid, text, numeric, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. WHAT THE SCREEN READS
--
-- SECURITY INVOKER, so the caller's own RLS decides the rows — the same rule as
-- etims_queue_summary.
-- ---------------------------------------------------------------------------
create or replace function public.etims_stock_summary()
returns table (
  pending   bigint,
  sent      bigint,
  rejected  bigint,
  uncertain bigint
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
    count(*) filter (where status = 'uncertain')
  from public.etims_stock_movements
  where admin_id = public.current_admin_id();
$fn$;

revoke execute on function public.etims_stock_summary() from public, anon;
grant  execute on function public.etims_stock_summary() to authenticated;

commit;

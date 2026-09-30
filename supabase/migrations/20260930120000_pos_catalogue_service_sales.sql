-- ===========================================================================
-- POS -- SELL FROM THE SERVICES CATALOGUE
--
-- WHY THIS EXISTS
--
-- A firm registers what it offers in Inventory & Clients -> Services
-- (20260925160000: consultancy_services + consultancy_cost_structures), then
-- goes to the till to take payment for it -- and the till cannot see it. The
-- POS only lists `assets`, and a sale must name one: sales.asset_id is
-- NOT NULL. The catalogue's own header says it "leaves [the POS] alone", which
-- meant a service had to be registered twice, once as a catalogue entry and
-- again as an Inventory item of type 'services' (20260925120000), before it
-- could be sold. Nobody expects that, and the two copies drift.
--
-- So a sale can now name what it sold in one of two ways:
--
--   asset_id                          an Inventory item (stock, or an
--                                     Inventory-type service), as before
--   consultancy_service_id            a catalogue service, and
--   consultancy_cost_structure_id     the price option it was rung up on
--
-- and at least one of the two must be present.
--
--   item_description   What the receipt said was sold, e.g.
--                      "Tax Advisory — Per-hour cost (3 hours @ KES 5,000)".
--                      A snapshot, like buyer_kra_pin: renaming the service or
--                      editing its price list next year must not rewrite a
--                      receipt already handed over. Written for catalogue
--                      sales; NULL for Inventory sales, whose reprint reads
--                      the asset as it always has.
--
-- DELETION
--
-- A sold service cannot be deleted (RESTRICT), matching sales.asset_id and
-- the catalogue's own rule for mapped clients: retire it instead. A price
-- option is different -- save_consultancy_service() deletes options that are
-- dropped from the list on every save -- so that link is SET NULL, and
-- item_description keeps what the option said.
--
-- WHAT A SERVICE SALE IS ALLOWED
--
-- Paid in full, like every service sale since 20260925120000. The gate below
-- extends that rule to catalogue services, and also refuses a service or
-- price option that belongs to another tenant: the foreign keys alone do not
-- check tenancy, because FK checks bypass RLS.
--
-- THE LEDGER
--
-- journal_on_cash_sale() posted an estimated cost of goods (60% of the price)
-- from Inventory Asset (1300) on EVERY cash sale. A service consumes no
-- stock, so for a service that entry drained inventory that never existed. It
-- is now skipped for catalogue services and for Inventory items of type
-- 'services'. Revenue still posts to Asset Sales Revenue (6100): no tenant
-- chart has a separate service-revenue account, and the statements engine
-- reads 6100.
--
-- eTIMS
--
-- etims_enqueue_stock_out() queued a stock-out movement for Inventory-type
-- services; a service has no stock to report to KRA, so it is skipped. A
-- catalogue sale has no asset and was already skipped. Filing the SALE of a
-- catalogue service to eTIMS needs a KRA classification for it, which the
-- catalogue does not carry yet: etims-transmit refuses such a sale with its
-- "not classified" message rather than filing it wrong. The module is off for
-- every tenant today.
--
-- Idempotent -- safe to re-run.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. WHAT A SALE SOLD
-- ---------------------------------------------------------------------------
alter table public.sales
  add column if not exists consultancy_service_id uuid,
  add column if not exists consultancy_cost_structure_id uuid,
  add column if not exists item_description text;

do $$ begin
  alter table public.sales
    add constraint sales_consultancy_service_id_fkey
    foreign key (consultancy_service_id)
    references public.consultancy_services(id) on delete restrict;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.sales
    add constraint sales_consultancy_cost_structure_id_fkey
    foreign key (consultancy_cost_structure_id)
    references public.consultancy_cost_structures(id) on delete set null;
exception when duplicate_object then null; end $$;

alter table public.sales alter column asset_id drop not null;

-- Every row on record has an asset_id, so this validates immediately.
do $$ begin
  alter table public.sales
    add constraint sales_item_present_chk
    check (asset_id is not null or consultancy_service_id is not null);
exception when duplicate_object then null; end $$;

create index if not exists idx_sales_consultancy_service
  on public.sales (consultancy_service_id)
  where consultancy_service_id is not null;

comment on column public.sales.asset_id is
  'The Inventory item sold, or NULL when the sale is of a Services-catalogue entry (consultancy_service_id).';
comment on column public.sales.consultancy_service_id is
  'The Services-catalogue entry sold at the POS, when the sale is not of an Inventory item. A sold service is retired, never deleted.';
comment on column public.sales.consultancy_cost_structure_id is
  'The price option the service was rung up on. SET NULL when the option is removed; item_description keeps what it said.';
comment on column public.sales.item_description is
  'What the receipt said was sold, as printed. A snapshot for catalogue-service sales; NULL for Inventory sales.';

-- ---------------------------------------------------------------------------
-- 2. THE GATE, EXTENDED AGAIN
--
-- Same function as 20260925120000_pos_direct_sale.sql, plus the catalogue:
-- a catalogue service must be the seller's own, its price option must be one
-- of that service's, and it is sold for cash.
-- ---------------------------------------------------------------------------
create or replace function public.sales_customer_type_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type          public.customer_type;
  v_name          text;
  v_asset_type    text;
  v_service_admin uuid;
begin
  if new.consultancy_service_id is not null then
    select s.admin_id into v_service_admin
      from public.consultancy_services s where s.id = new.consultancy_service_id;
    if v_service_admin is distinct from new.admin_id then
      raise exception 'That service belongs to another account.' using errcode = '42501';
    end if;

    if new.consultancy_cost_structure_id is not null and not exists (
         select 1 from public.consultancy_cost_structures cs
          where cs.id = new.consultancy_cost_structure_id
            and cs.service_id = new.consultancy_service_id) then
      raise exception 'That price option belongs to a different service.' using errcode = '23503';
    end if;
  end if;

  if coalesce(new.pricing_model, 'cash') <> 'cash' then
    if new.client_id is null then
      raise exception
        'A sale without customer details must be paid in full; % is not allowed.', new.pricing_model
        using errcode = 'P0001';
    end if;

    if new.consultancy_service_id is not null then
      v_asset_type := 'services';
    else
      select a.asset_type::text into v_asset_type
        from public.assets a where a.id = new.asset_id;
    end if;
    if v_asset_type in ('service', 'services') then
      raise exception
        'Services must be paid in full at point of sale; % is not allowed.', new.pricing_model
        using errcode = 'P0001';
    end if;
  end if;

  if new.client_id is null then
    return new;
  end if;

  select c.customer_type, c.full_name into v_type, v_name
    from public.clients c where c.id = new.client_id;

  if v_type is null then
    return new;                      -- client gone; not this trigger's business
  end if;

  -- Snapshot on insert only. A correction to a posted sale must not silently
  -- re-stamp what kind of customer it was.
  if tg_op = 'INSERT' then
    new.customer_type := v_type;
  end if;

  if v_type = 'cash' and coalesce(new.pricing_model, 'cash') <> 'cash' then
    raise exception
      '% is a cash customer and cannot be sold to on %. Convert them to an account customer first.',
      coalesce(v_name, 'This customer'), new.pricing_model
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.sales_customer_type_gate() from public, anon, authenticated;

drop trigger if exists sales_customer_type_gate on public.sales;
create trigger sales_customer_type_gate
  before insert or update of client_id, pricing_model, asset_id,
                             consultancy_service_id, consultancy_cost_structure_id
  on public.sales
  for each row execute function public.sales_customer_type_gate();

-- ---------------------------------------------------------------------------
-- 3. NO COST OF GOODS ON A SERVICE
--
-- The live definition (read 2026-09-30), unchanged except for the service
-- test around entry 3.
-- ---------------------------------------------------------------------------
create or replace function public.journal_on_cash_sale()
returns trigger
language plpgsql
as $function$
declare
  net_revenue  numeric;
  vat_amount   numeric;
  cogs_amount  numeric;
  is_service   boolean;
begin
  -- Only fire on cash sales that are newly active
  if NEW.pricing_model = 'cash' and NEW.status = 'active'
     and (OLD.status is null or OLD.status != 'active') then

    vat_amount  := coalesce(NEW.vat_amount, 0);
    net_revenue := NEW.total_amount - vat_amount;
    cogs_amount := coalesce(NEW.total_amount * 0.6, 0); -- estimated COGS at 60%

    -- A service consumes no stock: a catalogue entry, or an Inventory item
    -- registered as type 'services'.
    is_service := NEW.consultancy_service_id is not null
      or exists (select 1 from public.assets a
                  where a.id = NEW.asset_id
                    and a.asset_type::text in ('service', 'services'));

    -- Entry 1: Cash received (full amount)
    perform post_journal_entry(
      NEW.admin_id,
      'Cash sale — ' || NEW.invoice_number || ' — ' || coalesce(NEW.total_amount::text, '0'),
      'Cash & Bank (1100)',
      'Asset Sales Revenue (6100)',
      net_revenue,
      'revenue',
      'cash_sale_completed',
      NEW.id,
      'sales',
      NEW.invoice_number
    );

    -- Entry 2: VAT payable (if applicable)
    if vat_amount > 0 then
      perform post_journal_entry(
        NEW.admin_id,
        'VAT on sale — ' || NEW.invoice_number,
        'Cash & Bank (1100)',
        'VAT Payable (3200)',
        vat_amount,
        'revenue',
        'vat_on_cash_sale',
        NEW.id,
        'sales',
        NEW.invoice_number
      );
    end if;

    -- Entry 3: Cost of Goods Sold -- goods only
    if cogs_amount > 0 and not is_service then
      perform post_journal_entry(
        NEW.admin_id,
        'COGS — asset sold — ' || NEW.invoice_number,
        'Cost of Goods Sold (7100)',
        'Inventory Asset (1300)',
        cogs_amount,
        'cost_of_sales',
        'cogs_on_sale',
        NEW.id,
        'sales',
        NEW.invoice_number
      );
    end if;

  end if;
  return NEW;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. NO eTIMS STOCK-OUT FOR A SERVICE
--
-- The live definition (read 2026-09-30); only the lookup now ignores
-- Inventory items of type 'services'.
-- ---------------------------------------------------------------------------
create or replace function public.etims_enqueue_stock_out()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
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
   where a.id = new.asset_id
     and a.asset_type::text not in ('service', 'services');

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
$function$;

notify pgrst, 'reload schema';

commit;

-- ===========================================================================
-- POS DIRECT-TO-SALE -- SELL FROM INVENTORY OR SERVICES WITHOUT A CUSTOMER
--
-- WHY THIS EXISTS
--
-- A business owner at the till wants to take payment for an item on the shelf
-- (or a service) and hand over a receipt -- no customer record, no invoice
-- step first. The POS now offers "Direct sale -- no customer details", which
-- submits a sale and payment with client_id NULL. Two things in the live
-- schema refused that:
--
--   sales.client_id   NOT NULL (the table predates the migration history, so
--                     the constraint was never visible in this folder). Every
--                     walk-in sale failed with 23502. payments.client_id was
--                     already nullable.
--
--   asset_type enum   Had no 'services' value, so a service offering could not
--                     be registered in Inventory at all (22P02), and without a
--                     row in assets there is nothing for the POS to sell.
--
-- WHAT A NULL CLIENT MEANS, AND WHAT IT IS ALLOWED
--
-- A sale with no client has nobody to collect an instalment from and nobody to
-- sign a contract, so it must be paid in full. The same holds for services:
-- they are sold as a one-off and are never hire-purchased. Both rules are
-- enforced in the app, and again here, because the app is not the only writer.
--
-- The other triggers on sales/payments were checked against a NULL client
-- (2026-09-25): commission, cash/instalment journals and both eTIMS enqueues
-- key on admin_id/asset_id, not the client. set_payments_admin_id falls back
-- to current_admin_id(), and payments_tenant_staff admits the row on admin_id.
-- journal_on_payment skips a payment it cannot attribute to a client; the
-- cash-sale journal still books the revenue.
-- ===========================================================================

-- 'services' is compared as text below, so it is safe to add the value in the
-- same transaction that defines the function.
alter type public.asset_type add value if not exists 'services';

alter table public.sales alter column client_id drop not null;

comment on column public.sales.client_id is
  'The customer, or NULL for a direct (walk-in) POS sale recorded without customer details. A NULL-client sale is always a cash sale.';

-- ---------------------------------------------------------------------------
-- THE GATE, EXTENDED
--
-- Same function as 20260908180000_customer_types.sql, with two rules added
-- ahead of the customer-type check: no credit without a customer, and no
-- credit for a service.
-- ---------------------------------------------------------------------------
create or replace function public.sales_customer_type_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type       public.customer_type;
  v_name       text;
  v_asset_type text;
begin
  if coalesce(new.pricing_model, 'cash') <> 'cash' then
    if new.client_id is null then
      raise exception
        'A sale without customer details must be paid in full; % is not allowed.', new.pricing_model
        using errcode = 'P0001';
    end if;

    select a.asset_type::text into v_asset_type
      from public.assets a where a.id = new.asset_id;
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
  before insert or update of client_id, pricing_model, asset_id on public.sales
  for each row execute function public.sales_customer_type_gate();

-- ============================================================================
-- ACCOUNT CUSTOMERS AND CASH CUSTOMERS
-- ============================================================================
-- WHAT WAS MISSING
-- ----------------
-- There was one kind of customer, and the till treated every sale as though it
-- might become a hire-purchase: a walk-in paying cash for a cooker had to be
-- registered, KYC-verified and approved before the operator could ring it up.
-- In practice that means either a queue nobody will stand in, or a shop that
-- creates a fake "verified" record to get past the gate — and the second one
-- destroys the meaning of KYC for the customers it actually exists for.
--
-- WHAT THIS ADDS
-- --------------
--   'account'  A registered customer. Has a profile, a payment history and an
--              outstanding balance; may be sold to on hire-purchase, enrolled
--              in a subscription, and invoiced on terms. KYC applies.
--
--   'cash'     A quick-sale customer, created at the counter in seconds. Can be
--              invoiced, take a receipt and pay — and CANNOT be enrolled into
--              hire-purchase. Nothing is being lent, so nothing needs verifying.
--
-- Every existing client becomes 'account'. That is the safe direction: it keeps
-- the KYC gate exactly where it is for everybody already on file, and the new,
-- looser type is opt-in per customer.
--
-- ---------------------------------------------------------------------------
-- THE HIRE-PURCHASE GATE IS A TRIGGER, NOT A SCREEN
--
-- If it lived in the POS wizard, the rule would hold until the day somebody
-- posts a sale from anywhere else — the API, an import, a second till. What
-- makes 'cash' mean anything is that Postgres refuses a non-cash `sales` row
-- against a cash customer. The screen only decides whether to offer the
-- option.
--
-- ---------------------------------------------------------------------------
-- THE TYPE IS SNAPSHOT ONTO THE SALE, for the same reason buyer_kra_pin is: a
-- customer upgraded from cash to account next year must not make last year's
-- walk-in receipt read as an account sale.
--
-- Idempotent -- safe to re-run.
-- ============================================================================

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'customer_type') then
    create type public.customer_type as enum ('account', 'cash');
  end if;
end
$$;

alter table public.clients
  add column if not exists customer_type public.customer_type not null default 'account';

alter table public.sales
  add column if not exists customer_type public.customer_type;

comment on column public.clients.customer_type is
  'account = registered, KYC-verified, may take hire-purchase and subscriptions. cash = quick-sale walk-in, invoice/receipt/payment only, never hire-purchase.';
comment on column public.sales.customer_type is
  'The customer type AS AT this sale. A snapshot: upgrading a walk-in to an account customer next year must not rewrite last year''s receipt.';

create index if not exists idx_clients_customer_type on public.clients (customer_type);

-- ---------------------------------------------------------------------------
-- THE GATE
--
-- Refuses any credit sale to a cash customer, and stamps the type onto every
-- sale. Both in one trigger because they are the same question asked twice —
-- what kind of customer is this, and what does that permit.
-- ---------------------------------------------------------------------------
create or replace function public.sales_customer_type_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type public.customer_type;
  v_name text;
begin
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
  before insert or update of client_id, pricing_model on public.sales
  for each row execute function public.sales_customer_type_gate();

-- ---------------------------------------------------------------------------
-- QUICK CREATION AT THE COUNTER
--
-- One call, the minimum a receipt needs: a name. Everything else is optional
-- because the point of this type is that it takes seconds, and a required
-- field is a field somebody will type "x" into.
--
-- The account number is generated here rather than by the caller: it is UNIQUE
-- across the table, and letting two tills invent one is how you get a 23505 in
-- front of a customer.
-- ---------------------------------------------------------------------------
create or replace function public.create_cash_customer(
  p_full_name text,
  p_phone     text default null,
  p_email     text default null,
  p_kra_pin   text default null
)
returns public.clients
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := public.current_admin_id();
  v_row   public.clients%rowtype;
  v_acct  text;
begin
  if not public.is_staff_member() then
    raise exception 'Only staff may register a customer.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_full_name, '')), '') is null then
    raise exception 'A customer needs a name.' using errcode = 'P0001';
  end if;

  for i in 1..5 loop
    v_acct := 'CASH-' || to_char(now(), 'YYMM') || '-' ||
              upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6));
    begin
      insert into public.clients
        (account_number, full_name, phone, email, kra_pin, admin_id,
         customer_type, client_status, created_by)
      values
        (v_acct, btrim(p_full_name),
         nullif(btrim(coalesce(p_phone, '')), ''),
         nullif(btrim(coalesce(p_email, '')), ''),
         nullif(btrim(coalesce(p_kra_pin, '')), ''),
         v_admin, 'cash', 'active'::public.client_status, auth.uid())
      returning * into v_row;
      return v_row;
    exception when unique_violation then
      -- Collided on the generated account number. Try again.
      null;
    end;
  end loop;

  raise exception 'Could not allocate an account number — please try again.' using errcode = 'P0001';
end;
$$;

revoke execute on function public.create_cash_customer(text, text, text, text) from public, anon;
grant  execute on function public.create_cash_customer(text, text, text, text) to authenticated;

comment on function public.create_cash_customer(text, text, text, text) is
  'Register a walk-in at the counter. Name only; no KYC, because nothing is being lent. The sales gate keeps them off hire-purchase.';

-- ---------------------------------------------------------------------------
-- PROMOTION
--
-- A walk-in who comes back and wants terms becomes an account customer. One
-- direction only: demoting an account customer would strip the KYC requirement
-- from somebody who may already be halfway through a hire-purchase.
-- ---------------------------------------------------------------------------
create or replace function public.promote_to_account_customer(p_client_id uuid)
returns public.clients
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_row public.clients%rowtype;
begin
  if not public.is_staff_member() then
    raise exception 'Only staff may change a customer type.' using errcode = '42501';
  end if;

  update public.clients
     set customer_type = 'account', updated_at = now()
   where id = p_client_id and customer_type = 'cash'
  returning * into v_row;

  if v_row.id is null then
    -- Either it does not exist, RLS refused it, or it is already an account
    -- customer. Say so rather than reporting a success that changed nothing.
    raise exception 'That customer could not be promoted — they may already be an account customer.'
      using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;

revoke execute on function public.promote_to_account_customer(uuid) from public, anon;
grant  execute on function public.promote_to_account_customer(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;

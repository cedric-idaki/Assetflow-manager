-- ===========================================================================
-- CONSULTANCY SERVICES -- THE SERVICE CATALOGUE, ITS PRICING, AND WHO BUYS IT
--
-- WHY THIS EXISTS
--
-- A consultancy's inventory is not stock. It sells time, expertise and
-- outcomes, and it prices one service several ways at once: an hourly rate, a
-- block of hours sold as a package, a monthly retainer, a fixed fee for a
-- defined project, a flat consultant fee, a price per deliverable, and a share
-- of what the work achieves. `assets` cannot hold any of that -- it carries one
-- selling_price and a stock status per row -- so the Services tab of
-- Inventory & Clients gets three tables of its own:
--
--   consultancy_services         the maintained list of what the firm offers
--   consultancy_cost_structures  its price list: one row per way a service is sold
--   consultancy_engagements      a client mapped to a service, on agreed terms
--
-- Inventory items of type 'services' (20260925120000) are a different thing --
-- a one-price item the POS can ring up -- and this catalogue leaves them alone.
--
-- THE SEVEN PRICING MODELS, and the terms each one uses
--
--   unit            amount = price per unit; unit_label names the unit
--   hourly          amount = rate per hour
--   consultant_fee  amount = one flat fee for the consultant
--   hourly_package  amount = price of a block of included_hours, sold once or
--                   every billing_period; overage_rate prices hours beyond it
--   retainer        amount = fee every billing_period (never one-off);
--                   optionally covers included_hours, overage_rate beyond
--   fixed_fee       amount = the whole project; deposit_pct due up front
--   success_fee     success_pct of the outcome named in success_basis, and/or
--                   amount as a fixed bonus on success; minimum_fee / fee_cap
--
-- Terms a model does not use are cleared on write, so a price option switched
-- from "retainer" to "hourly" cannot keep a stale billing period that some
-- later report would read. The vocabulary and every rule below are mirrored in
-- src/config/consultancyPricing.js; consultancyPricing.sync.test.js fails if
-- the two drift.
--
-- WHY AN ENGAGEMENT COPIES ITS TERMS
--
-- A mapping records what THIS client agreed to pay. The terms are copied from
-- a cost structure when the client is mapped, and may be negotiated from
-- there. Raising the list price next year must not silently re-price every
-- client already signed at the old rate, and deleting a price option must not
-- leave a client with no terms at all -- so cost_structure_id records where the
-- terms came from, not what they are.
--
-- TENANCY
--
-- admin_id is stamped server-side. The two child tables take it from their
-- service, never from the request, and a mapping must name a client of the
-- same tenant: the foreign key alone does not check that, because FK checks
-- bypass RLS. Policies are the canonical tenant-staff predicate. Writes are
-- gated by the 'assets' module (Inventory & Assets), which is where the
-- Services tab lives -- freezing Inventory freezes this with it.
--
-- Idempotent -- safe to re-run.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. THE CATALOGUE
-- ---------------------------------------------------------------------------
create sequence if not exists public.consultancy_service_code_seq;

create table if not exists public.consultancy_services (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid,
  service_code  text,
  name          text not null,
  category      text,
  description   text,
  -- Retired, not deleted: a service clients are mapped to cannot be deleted
  -- (see consultancy_engagements.service_id), and a firm that stops offering
  -- something still needs to see who bought it.
  is_active     boolean not null default true,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint consultancy_services_name_chk check (btrim(name) <> '')
);

create unique index if not exists consultancy_services_code_uniq
  on public.consultancy_services (admin_id, service_code);
-- "A maintained list" -- the same service twice under one tenant is a typo, and
-- two price lists for it would be worse.
create unique index if not exists consultancy_services_name_uniq
  on public.consultancy_services (admin_id, lower(btrim(name)));
create index if not exists idx_consultancy_services_admin
  on public.consultancy_services (admin_id, is_active);

comment on table public.consultancy_services is
  'The consultancy service catalogue: what a firm offers. Priced by consultancy_cost_structures; sold to clients through consultancy_engagements.';

-- ---------------------------------------------------------------------------
-- 2. THE PRICE LIST -- one row per way a service is sold
-- ---------------------------------------------------------------------------
create table if not exists public.consultancy_cost_structures (
  id              uuid primary key default gen_random_uuid(),
  admin_id        uuid,
  service_id      uuid not null references public.consultancy_services(id) on delete cascade,
  pricing_model   text not null,
  label           text,

  -- THE TERMS. Same columns, same meaning, on consultancy_engagements.
  amount          numeric(14,2),
  unit_label      text,
  included_hours  numeric(10,2),
  overage_rate    numeric(14,2),
  billing_period  text,
  success_pct     numeric(6,3),
  success_basis   text,
  minimum_fee     numeric(14,2),
  fee_cap         numeric(14,2),
  deposit_pct     numeric(6,3),

  -- The option a new mapping starts from. At most one per service.
  is_default      boolean not null default false,
  sort_order      integer not null default 0,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint consultancy_cost_structures_model_chk check (pricing_model in (
    'unit', 'hourly', 'consultant_fee', 'hourly_package', 'retainer', 'fixed_fee', 'success_fee')),
  constraint consultancy_cost_structures_period_chk check (billing_period is null or billing_period in (
    'one_off', 'weekly', 'monthly', 'quarterly', 'annually'))
);

create unique index if not exists consultancy_cost_structures_one_default
  on public.consultancy_cost_structures (service_id) where is_default;
create index if not exists idx_consultancy_cost_structures_service
  on public.consultancy_cost_structures (service_id, sort_order);
create index if not exists idx_consultancy_cost_structures_admin
  on public.consultancy_cost_structures (admin_id);

comment on table public.consultancy_cost_structures is
  'How a consultancy service is priced. One row per option: unit, hourly, consultant_fee, hourly_package, retainer, fixed_fee or success_fee.';

-- ---------------------------------------------------------------------------
-- 3. CLIENTS MAPPED TO A SERVICE
-- ---------------------------------------------------------------------------
create table if not exists public.consultancy_engagements (
  id                 uuid primary key default gen_random_uuid(),
  admin_id           uuid,
  -- RESTRICT: a service with clients on it is retired, not deleted.
  service_id         uuid not null references public.consultancy_services(id) on delete restrict,
  -- CASCADE: a mapping means nothing once its client record is gone.
  client_id          uuid not null references public.clients(id) on delete cascade,
  -- Where the terms were copied from. SET NULL: the terms below survive it.
  cost_structure_id  uuid references public.consultancy_cost_structures(id) on delete set null,

  -- THE AGREED TERMS -- copied, then negotiable. See the header.
  pricing_model      text not null,
  amount             numeric(14,2),
  unit_label         text,
  included_hours     numeric(10,2),
  overage_rate       numeric(14,2),
  billing_period     text,
  success_pct        numeric(6,3),
  success_basis      text,
  minimum_fee        numeric(14,2),
  fee_cap            numeric(14,2),
  deposit_pct        numeric(6,3),

  status             text not null default 'active',
  -- The Kenyan date, not the UTC one: a mapping made at 01:00 EAT starts today.
  start_date         date default ((now() at time zone 'Africa/Nairobi')::date),
  end_date           date,
  notes              text,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint consultancy_engagements_model_chk check (pricing_model in (
    'unit', 'hourly', 'consultant_fee', 'hourly_package', 'retainer', 'fixed_fee', 'success_fee')),
  constraint consultancy_engagements_period_chk check (billing_period is null or billing_period in (
    'one_off', 'weekly', 'monthly', 'quarterly', 'annually')),
  constraint consultancy_engagements_status_chk check (status in (
    'proposed', 'active', 'on_hold', 'completed', 'cancelled')),
  constraint consultancy_engagements_dates_chk check (
    end_date is null or start_date is null or end_date >= start_date)
);

create index if not exists idx_consultancy_engagements_admin
  on public.consultancy_engagements (admin_id, status);
create index if not exists idx_consultancy_engagements_service
  on public.consultancy_engagements (service_id);
create index if not exists idx_consultancy_engagements_client
  on public.consultancy_engagements (client_id);
create index if not exists idx_consultancy_engagements_cost_structure
  on public.consultancy_engagements (cost_structure_id);

comment on table public.consultancy_engagements is
  'A client mapped to a consultancy service, on the terms that client agreed. Terms are copied from a cost structure and may be negotiated; cost_structure_id records their origin.';
comment on column public.consultancy_engagements.cost_structure_id is
  'The price option these terms were copied from. Editing or deleting it never re-prices this engagement.';

-- ---------------------------------------------------------------------------
-- 4. THE TERMS RULES -- one function, both tables
--
--    Returns NULL when the terms are sound, otherwise the sentence to show the
--    person who entered them. Mirrors validateTerms() in
--    src/config/consultancyPricing.js word for word.
-- ---------------------------------------------------------------------------
create or replace function public.consultancy_terms_problem(
  p_model          text,
  p_amount         numeric,
  p_included_hours numeric,
  p_overage_rate   numeric,
  p_billing_period text,
  p_success_pct    numeric,
  p_minimum_fee    numeric,
  p_fee_cap        numeric,
  p_deposit_pct    numeric
)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_model is null or p_model not in (
       'unit', 'hourly', 'consultant_fee', 'hourly_package', 'retainer', 'fixed_fee', 'success_fee') then
    return 'Choose how this option is priced.';
  end if;

  if p_amount < 0 or p_overage_rate < 0 or p_minimum_fee < 0 or p_fee_cap < 0 then
    return 'Amounts cannot be negative.';
  end if;

  if p_model in ('unit', 'hourly', 'consultant_fee', 'hourly_package', 'retainer', 'fixed_fee')
     and coalesce(p_amount, 0) <= 0 then
    return case p_model
      when 'unit'           then 'Enter the price per unit.'
      when 'hourly'         then 'Enter the rate per hour.'
      when 'consultant_fee' then 'Enter the consultant fee.'
      when 'hourly_package' then 'Enter the package price.'
      when 'retainer'       then 'Enter the retainer fee.'
      else                       'Enter the project fee.'
    end;
  end if;

  if p_model = 'hourly_package' then
    if coalesce(p_included_hours, 0) <= 0 then
      return 'Enter how many hours the package includes.';
    end if;
    if p_billing_period is null then
      return 'Choose how often the package is billed.';
    end if;
  end if;

  if p_model = 'retainer' then
    if p_billing_period is null or p_billing_period = 'one_off' then
      return 'A retainer recurs — choose weekly, monthly, quarterly or annually.';
    end if;
    if p_included_hours is not null and p_included_hours <= 0 then
      return 'Hours covered by the retainer must be more than zero.';
    end if;
  end if;

  if p_model = 'fixed_fee' and p_deposit_pct is not null
     and (p_deposit_pct <= 0 or p_deposit_pct > 100) then
    return 'A deposit must be more than 0 and at most 100 percent.';
  end if;

  if p_model = 'success_fee' then
    if p_success_pct is not null and (p_success_pct <= 0 or p_success_pct > 100) then
      return 'A success percentage must be more than 0 and at most 100.';
    end if;
    if p_success_pct is null and coalesce(p_amount, 0) <= 0 then
      return 'Enter a success percentage, a fixed success bonus, or both.';
    end if;
    if p_minimum_fee is not null and p_fee_cap is not null and p_fee_cap < p_minimum_fee then
      return 'The fee cap cannot be lower than the minimum fee.';
    end if;
  end if;

  return null;
end;
$$;

grant execute on function public.consultancy_terms_problem(text, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric)
  to authenticated;

-- Clear what the model does not use, then refuse what does not make sense.
-- Shared by both tables: their term columns have the same names.
create or replace function public.consultancy_terms_normalise()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_problem text;
begin
  new.unit_label    := nullif(btrim(coalesce(new.unit_label, '')), '');
  new.success_basis := nullif(btrim(coalesce(new.success_basis, '')), '');

  if new.pricing_model <> 'unit' then
    new.unit_label := null;
  end if;
  if new.pricing_model not in ('hourly_package', 'retainer') then
    new.included_hours := null;
    new.overage_rate   := null;
    new.billing_period := null;
  end if;
  if new.pricing_model <> 'fixed_fee' then
    new.deposit_pct := null;
  end if;
  if new.pricing_model <> 'success_fee' then
    new.success_pct   := null;
    new.success_basis := null;
    new.minimum_fee   := null;
    new.fee_cap       := null;
  end if;

  v_problem := public.consultancy_terms_problem(
    new.pricing_model, new.amount, new.included_hours, new.overage_rate,
    new.billing_period, new.success_pct, new.minimum_fee, new.fee_cap, new.deposit_pct);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function public.consultancy_terms_normalise() from public, anon, authenticated;

drop trigger if exists consultancy_cost_structures_terms on public.consultancy_cost_structures;
create trigger consultancy_cost_structures_terms
  before insert or update on public.consultancy_cost_structures
  for each row execute function public.consultancy_terms_normalise();

drop trigger if exists consultancy_engagements_terms on public.consultancy_engagements;
create trigger consultancy_engagements_terms
  before insert or update on public.consultancy_engagements
  for each row execute function public.consultancy_terms_normalise();

-- ---------------------------------------------------------------------------
-- 5. TENANT STAMPS
--
--    SECURITY DEFINER so the lookups see the parent row whatever the caller
--    may read: the stamp must be the parent's TRUE tenant, which is what lets
--    the RLS WITH CHECK refuse a cross-tenant write instead of it failing as a
--    confusing "not found".
-- ---------------------------------------------------------------------------
create or replace function public.consultancy_services_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.admin_id is null then
      new.admin_id := public.current_admin_id();
    end if;
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    -- A service never changes tenant: its price list and mappings take their
    -- admin_id from it, and would be stranded under the old one.
    new.admin_id   := old.admin_id;
    new.created_by := old.created_by;
  end if;

  new.name         := btrim(new.name);
  new.category     := nullif(btrim(coalesce(new.category, '')), '');
  new.description  := nullif(btrim(coalesce(new.description, '')), '');
  new.service_code := upper(nullif(btrim(coalesce(new.service_code, '')), ''));
  if new.service_code is null then
    new.service_code := 'SVC-' || lpad(nextval('public.consultancy_service_code_seq')::text, 5, '0');
  end if;

  return new;
end;
$$;

revoke execute on function public.consultancy_services_stamp() from public, anon, authenticated;

drop trigger if exists consultancy_services_stamp on public.consultancy_services;
create trigger consultancy_services_stamp
  before insert or update on public.consultancy_services
  for each row execute function public.consultancy_services_stamp();

create or replace function public.consultancy_cost_structures_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  select s.admin_id into new.admin_id
    from public.consultancy_services s
   where s.id = new.service_id;
  if not found then
    raise exception 'That service no longer exists.' using errcode = '23503';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
  end if;
  new.label := nullif(btrim(coalesce(new.label, '')), '');
  return new;
end;
$$;

revoke execute on function public.consultancy_cost_structures_stamp() from public, anon, authenticated;

drop trigger if exists consultancy_cost_structures_stamp on public.consultancy_cost_structures;
create trigger consultancy_cost_structures_stamp
  before insert or update on public.consultancy_cost_structures
  for each row execute function public.consultancy_cost_structures_stamp();

create or replace function public.consultancy_engagements_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client_admin uuid;
begin
  select s.admin_id into new.admin_id
    from public.consultancy_services s
   where s.id = new.service_id;
  if not found then
    raise exception 'That service no longer exists.' using errcode = '23503';
  end if;

  select c.admin_id into v_client_admin
    from public.clients c
   where c.id = new.client_id;
  if not found then
    raise exception 'That client no longer exists.' using errcode = '23503';
  end if;
  if v_client_admin is distinct from new.admin_id then
    raise exception 'That client belongs to another account.' using errcode = '42501';
  end if;

  if new.cost_structure_id is not null and not exists (
       select 1 from public.consultancy_cost_structures cs
        where cs.id = new.cost_structure_id
          and cs.service_id = new.service_id) then
    raise exception 'That price option belongs to a different service.' using errcode = '23503';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
  end if;
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  return new;
end;
$$;

revoke execute on function public.consultancy_engagements_stamp() from public, anon, authenticated;

drop trigger if exists consultancy_engagements_stamp on public.consultancy_engagements;
create trigger consultancy_engagements_stamp
  before insert or update on public.consultancy_engagements
  for each row execute function public.consultancy_engagements_stamp();

-- updated_at, with the helper every other table uses (20260731190000).
drop trigger if exists touch_consultancy_services on public.consultancy_services;
create trigger touch_consultancy_services
  before update on public.consultancy_services
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_consultancy_cost_structures on public.consultancy_cost_structures;
create trigger touch_consultancy_cost_structures
  before update on public.consultancy_cost_structures
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_consultancy_engagements on public.consultancy_engagements;
create trigger touch_consultancy_engagements
  before update on public.consultancy_engagements
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 6. RLS -- tenant staff, and the platform operator
-- ---------------------------------------------------------------------------
alter table public.consultancy_services         enable row level security;
alter table public.consultancy_cost_structures  enable row level security;
alter table public.consultancy_engagements      enable row level security;

drop policy if exists consultancy_services_tenant_staff on public.consultancy_services;
create policy consultancy_services_tenant_staff on public.consultancy_services
  for all to authenticated
  using      ((admin_id = public.current_admin_id() and public.is_staff_member())
              or public.is_global_viewer())
  with check ((admin_id = public.current_admin_id() and public.is_staff_member())
              or public.is_global_viewer());

drop policy if exists consultancy_cost_structures_tenant_staff on public.consultancy_cost_structures;
create policy consultancy_cost_structures_tenant_staff on public.consultancy_cost_structures
  for all to authenticated
  using      ((admin_id = public.current_admin_id() and public.is_staff_member())
              or public.is_global_viewer())
  with check ((admin_id = public.current_admin_id() and public.is_staff_member())
              or public.is_global_viewer());

drop policy if exists consultancy_engagements_tenant_staff on public.consultancy_engagements;
create policy consultancy_engagements_tenant_staff on public.consultancy_engagements
  for all to authenticated
  using      ((admin_id = public.current_admin_id() and public.is_staff_member())
              or public.is_global_viewer())
  with check ((admin_id = public.current_admin_id() and public.is_staff_member())
              or public.is_global_viewer());

revoke all on public.consultancy_services        from anon;
revoke all on public.consultancy_cost_structures from anon;
revoke all on public.consultancy_engagements     from anon;
grant select, insert, update, delete on public.consultancy_services        to authenticated;
grant select, insert, update, delete on public.consultancy_cost_structures to authenticated;
grant select, insert, update, delete on public.consultancy_engagements     to authenticated;

-- Only the stamp trigger draws codes, and it runs as the owner.
revoke all on sequence public.consultancy_service_code_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. MODULE GATE -- these live inside Inventory & Assets
-- ---------------------------------------------------------------------------
drop trigger if exists trg_module_gate on public.consultancy_services;
create trigger trg_module_gate
  before insert or update or delete on public.consultancy_services
  for each row execute function public.enforce_module_write('assets');

drop trigger if exists trg_module_gate on public.consultancy_cost_structures;
create trigger trg_module_gate
  before insert or update or delete on public.consultancy_cost_structures
  for each row execute function public.enforce_module_write('assets');

drop trigger if exists trg_module_gate on public.consultancy_engagements;
create trigger trg_module_gate
  before insert or update or delete on public.consultancy_engagements
  for each row execute function public.enforce_module_write('assets');

-- ---------------------------------------------------------------------------
-- 8. SAVING A SERVICE AND ITS PRICE LIST TOGETHER
--
--    One transaction, so a price option the rules refuse leaves the service
--    exactly as it was, instead of saved with half its price list.
--
--    SECURITY INVOKER: RLS, the module gate and the stamps all apply to the
--    caller exactly as they would to direct writes. An UPDATE that RLS hides
--    matches no row, and that is raised -- never reported as a save.
--
--    p_cost_structures is the COMPLETE list: rows with an id are updated, rows
--    without one are added, and options missing from it are removed (a client
--    mapped to a removed option keeps its copied terms). The first option
--    flagged is_default wins; none flagged makes the first one the default.
-- ---------------------------------------------------------------------------
create or replace function public.save_consultancy_service(
  p_service         jsonb,
  p_cost_structures jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id           uuid := nullif(p_service->>'id', '')::uuid;
  v_list         jsonb := coalesce(p_cost_structures, '[]'::jsonb);
  v_row          jsonb;
  v_cs_id        uuid;
  v_keep         uuid[] := '{}';
  v_default_id   uuid;
  v_position     integer := 0;
begin
  if jsonb_typeof(v_list) <> 'array' then
    raise exception 'Cost structures must be sent as a list.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_service->>'name', '')), '') is null then
    raise exception 'Give the service a name.' using errcode = '23514';
  end if;

  if v_id is null then
    insert into public.consultancy_services (service_code, name, category, description, is_active)
    values (p_service->>'service_code',
            p_service->>'name',
            p_service->>'category',
            p_service->>'description',
            coalesce((p_service->>'is_active')::boolean, true))
    returning id into v_id;
  else
    update public.consultancy_services
       set service_code = coalesce(nullif(btrim(coalesce(p_service->>'service_code', '')), ''), service_code),
           name         = p_service->>'name',
           category     = p_service->>'category',
           description  = p_service->>'description',
           is_active    = coalesce((p_service->>'is_active')::boolean, is_active)
     where id = v_id;
    if not found then
      raise exception 'That service no longer exists, or you cannot edit it.' using errcode = '42501';
    end if;
  end if;

  -- Cleared first so the one-default index cannot trip while rows are swapped.
  update public.consultancy_cost_structures
     set is_default = false
   where service_id = v_id and is_default;

  for v_row in select value from jsonb_array_elements(v_list) loop
    v_position := v_position + 1;
    v_cs_id := nullif(v_row->>'id', '')::uuid;

    if v_cs_id is not null then
      update public.consultancy_cost_structures
         set pricing_model  = v_row->>'pricing_model',
             label          = v_row->>'label',
             amount         = (v_row->>'amount')::numeric,
             unit_label     = v_row->>'unit_label',
             included_hours = (v_row->>'included_hours')::numeric,
             overage_rate   = (v_row->>'overage_rate')::numeric,
             billing_period = v_row->>'billing_period',
             success_pct    = (v_row->>'success_pct')::numeric,
             success_basis  = v_row->>'success_basis',
             minimum_fee    = (v_row->>'minimum_fee')::numeric,
             fee_cap        = (v_row->>'fee_cap')::numeric,
             deposit_pct    = (v_row->>'deposit_pct')::numeric,
             sort_order     = v_position
       where id = v_cs_id and service_id = v_id;
      if not found then
        raise exception 'A price option on this service was removed by someone else. Reload and try again.'
          using errcode = 'P0002';
      end if;
    else
      insert into public.consultancy_cost_structures
        (service_id, pricing_model, label, amount, unit_label, included_hours, overage_rate,
         billing_period, success_pct, success_basis, minimum_fee, fee_cap, deposit_pct, sort_order)
      values
        (v_id, v_row->>'pricing_model', v_row->>'label', (v_row->>'amount')::numeric,
         v_row->>'unit_label', (v_row->>'included_hours')::numeric, (v_row->>'overage_rate')::numeric,
         v_row->>'billing_period', (v_row->>'success_pct')::numeric, v_row->>'success_basis',
         (v_row->>'minimum_fee')::numeric, (v_row->>'fee_cap')::numeric,
         (v_row->>'deposit_pct')::numeric, v_position)
      returning id into v_cs_id;
    end if;

    v_keep := v_keep || v_cs_id;
    if v_default_id is null and coalesce((v_row->>'is_default')::boolean, false) then
      v_default_id := v_cs_id;
    end if;
  end loop;

  delete from public.consultancy_cost_structures
   where service_id = v_id
     and not (id = any (v_keep));

  update public.consultancy_cost_structures
     set is_default = true
   where id = coalesce(v_default_id, v_keep[1]);

  return v_id;
end;
$$;

revoke execute on function public.save_consultancy_service(jsonb, jsonb) from public, anon;
grant  execute on function public.save_consultancy_service(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. REALTIME -- a colleague's change shows without a refresh. RLS still
--    decides which rows each subscriber is sent.
-- ---------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.consultancy_services;
exception when duplicate_object or undefined_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.consultancy_cost_structures;
exception when duplicate_object or undefined_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.consultancy_engagements;
exception when duplicate_object or undefined_object then null; end $$;

notify pgrst, 'reload schema';

commit;

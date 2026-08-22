-- ===========================================================================
-- TENANT MODULE ENTITLEMENTS  --  "freeze / unfreeze" a portal module
--
-- WHY
-- Different clients buy different parts of this system. Until now the only
-- signal captured at registration was `company_profiles.business_type`, a free
-- text field most registrants fill in as "Other", and every tenant then got
-- every module in the sidebar whether they used it or not.
--
-- MODEL
-- Every tenant gets ONE ROW PER MODULE at registration -- no exceptions. What
-- registration chooses is not which rows exist, it is each row's STATUS:
--
--     enabled  -> visible in the portal, readable, writable
--     frozen   -> hidden from navigation, routes refuse, MANUAL WRITES BLOCKED,
--                 every existing row of data left exactly where it is
--
-- Unfreezing is therefore a single status flip. There is no provisioning step,
-- nothing to migrate back, and nothing to restore: a module switched off for
-- eight months comes back with its data intact because the data was never
-- touched. `frozen_reason` records WHO switched it off, which is what decides
-- whether the tenant may switch it back on by themselves:
--
--     not_selected -> not chosen at registration      -> tenant may enable
--     self         -> the tenant switched it off      -> tenant may enable
--     plan         -> outside their subscription tier -> super admin only
--     admin        -> suspended by the platform       -> super admin only
--
-- WHAT FREEZING DOES NOT DO
-- It does not block writes that arrive WITHOUT an authenticated user -- M-Pesa
-- callbacks, reconciliation, cron, anything running as the service role. If a
-- payment lands for a frozen module it still posts. Freezing a module must
-- never lose money or leave the ledger unreconcilable when it is switched back
-- on. It also does not block SELECT: the tenant's data stays readable to their
-- own tenant (reports, exports, audit) exactly as before.
--
-- FAIL-OPEN, DELIBERATELY
-- module_enabled() returns TRUE when a tenant has no row for a module. This is
-- a commercial/UX gate, NOT a security boundary -- tenant isolation (admin_id
-- + RLS) is what protects data, and none of that is weakened here. A tenant
-- that somehow has no rows must keep the system they are paying for rather
-- than find every module dark. The backfill below seeds every EXISTING tenant
-- with all modules `enabled`, so nothing in production changes the day this
-- runs.
--
-- IDEMPOTENT and transactional: safe to run more than once, lands whole or not
-- at all. Trigger attachment skips tables that are not present on this
-- database (the live schema and the migration history disagree in both
-- directions) and raises a NOTICE naming what it skipped.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. THE TABLE
--    module_key is TEXT, not an enum, on purpose: adding a fourteenth module
--    should be a line in src/config/modules.js and a seed row, not a migration
--    that rewrites a type every tenant's rows depend on.
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_modules (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid not null,
  module_key    text not null,
  status        text not null default 'frozen'
                check (status in ('enabled', 'frozen')),
  frozen_reason text
                check (frozen_reason in ('not_selected', 'self', 'plan', 'admin')),
  frozen_at     timestamptz,
  enabled_at    timestamptz,
  changed_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists idx_tenant_modules_admin_key
  on public.tenant_modules (admin_id, module_key);
create index if not exists idx_tenant_modules_admin
  on public.tenant_modules (admin_id);

-- ---------------------------------------------------------------------------
-- 2. THE CATALOGUE
--    Kept in SQL as well as in src/config/modules.js because the seed function
--    and the dependency check below both need it, and because a tenant must
--    not be able to invent a module key by passing one to the RPC.
--    ANY CHANGE HERE MUST BE MIRRORED IN src/config/modules.js (and vice
--    versa). src/config/modules.js owns presentation -- label, icon, routes,
--    which preset it belongs to. This owns the keys and the dependencies.
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
    ('mgr',             array['members'])
  ) as t(module_key, requires);
$fn$;

-- ---------------------------------------------------------------------------
-- 3. THE GATE
--    SECURITY DEFINER so triggers and policies calling it do not recurse
--    through tenant_modules' own RLS.
-- ---------------------------------------------------------------------------
create or replace function public.module_enabled(p_module text, p_admin uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce(
    (select tm.status = 'enabled'
       from public.tenant_modules tm
      where tm.admin_id   = coalesce(p_admin, public.current_admin_id())
        and tm.module_key = p_module),
    true  -- no row provisioned = enabled. See FAIL-OPEN in the header.
  );
$fn$;

revoke execute on function public.module_enabled(text, uuid) from public, anon;
grant  execute on function public.module_enabled(text, uuid) to authenticated;

-- Every module status for the calling tenant in one round trip. This is what
-- the browser loads once per session -- src/contexts/TenantModulesContext.jsx.
-- Modules with no row report as 'enabled', matching module_enabled().
create or replace function public.my_tenant_modules()
returns table (module_key text, status text, frozen_reason text, frozen_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select c.module_key,
         coalesce(tm.status, 'enabled')::text,
         tm.frozen_reason,
         tm.frozen_at
    from public.module_catalogue() c
    left join public.tenant_modules tm
           on tm.module_key = c.module_key
          and tm.admin_id   = public.current_admin_id()
   where auth.uid() is not null;
$fn$;

revoke execute on function public.my_tenant_modules() from public, anon;
grant  execute on function public.my_tenant_modules() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. SEEDING
--    Called once, by the registrant, at the end of registration. Always writes
--    a row for EVERY module in the catalogue: the ones picked as 'enabled',
--    the rest as frozen/'not_selected' so the portal can offer them later
--    without the tenant having to ask anyone.
--
--    The tenant is auth.uid(), never a parameter -- a caller cannot seed
--    somebody else's tenant. ON CONFLICT DO NOTHING makes a retried
--    registration harmless and stops this being a way to reset a frozen
--    module: rows that already exist are left exactly as they are.
-- ---------------------------------------------------------------------------
create or replace function public.seed_tenant_modules(p_enabled text[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_admin    uuid := auth.uid();
  v_inserted integer;
begin
  if v_admin is null then
    raise exception 'seed_tenant_modules must be called by a signed-in user'
      using errcode = '42501';
  end if;

  insert into public.tenant_modules
    (admin_id, module_key, status, frozen_reason, frozen_at, enabled_at, changed_by)
  select v_admin,
         c.module_key,
         case when c.module_key = any (coalesce(p_enabled, '{}')) then 'enabled' else 'frozen' end,
         case when c.module_key = any (coalesce(p_enabled, '{}')) then null else 'not_selected' end,
         case when c.module_key = any (coalesce(p_enabled, '{}')) then null else now() end,
         case when c.module_key = any (coalesce(p_enabled, '{}')) then now() else null end,
         v_admin
    from public.module_catalogue() c
  on conflict (admin_id, module_key) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$fn$;

revoke execute on function public.seed_tenant_modules(text[]) from public, anon;
grant  execute on function public.seed_tenant_modules(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. THE SWITCH -- tenant self-service
--    An admin / sacco_admin flipping their own module from the Modules tab.
--
--    Refuses to ENABLE nothing: a module frozen with reason 'plan' or 'admin'
--    was frozen by the platform, not by the tenant, and only a super admin
--    lifts that (section 6). Refuses to FREEZE a module another ENABLED module
--    depends on, which is what stops a tenant freezing `assets` underneath a
--    live POS and then finding every sale rejected by the trigger in section 8.
-- ---------------------------------------------------------------------------
create or replace function public.set_tenant_module(p_module text, p_status text)
returns public.tenant_modules
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_admin    uuid := public.current_admin_id();
  v_role     text;
  v_current  public.tenant_modules;
  v_blockers text[];
  v_row      public.tenant_modules;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select up.role::text into v_role
    from public.user_profiles up where up.id = auth.uid();

  -- Only the owner of a tenant runs its switchboard. Staff, agents, clients
  -- and members inherit whatever their admin decided.
  if v_role not in ('admin', 'sacco_admin', 'super_admin') then
    raise exception 'Only an administrator can switch modules on or off'
      using errcode = '42501';
  end if;

  if p_status not in ('enabled', 'frozen') then
    raise exception 'status must be enabled or frozen' using errcode = '22023';
  end if;

  if not exists (select 1 from public.module_catalogue() c where c.module_key = p_module) then
    raise exception 'Unknown module: %', p_module using errcode = '22023';
  end if;

  select * into v_current
    from public.tenant_modules
   where admin_id = v_admin and module_key = p_module;

  if p_status = 'enabled' then
    -- Platform-imposed freezes are not the tenant's to lift.
    if v_current.frozen_reason in ('plan', 'admin') and v_role <> 'super_admin' then
      raise exception
        'This module is not included in your subscription. Contact support to add it.'
        using errcode = '42501';
    end if;

    -- Turning a module on turns on what it needs, so a tenant can never enable
    -- a module into a broken state.
    perform public.set_tenant_module(dep, 'enabled')
       from unnest(
         (select c.requires from public.module_catalogue() c where c.module_key = p_module)
       ) as dep
      where not public.module_enabled(dep, v_admin);
  else
    -- Freezing: refuse while an enabled module still depends on this one.
    select array_agg(c.module_key) into v_blockers
      from public.module_catalogue() c
     where p_module = any (c.requires)
       and public.module_enabled(c.module_key, v_admin);

    if v_blockers is not null and array_length(v_blockers, 1) > 0 then
      raise exception
        'Switch off % first -- it depends on this module.',
        array_to_string(v_blockers, ', ')
        using errcode = '23514';
    end if;
  end if;

  insert into public.tenant_modules
    (admin_id, module_key, status, frozen_reason, frozen_at, enabled_at, changed_by, updated_at)
  values
    (v_admin, p_module, p_status,
     case when p_status = 'frozen' then 'self' else null end,
     case when p_status = 'frozen' then now()  else null end,
     case when p_status = 'enabled' then now() else null end,
     auth.uid(), now())
  on conflict (admin_id, module_key) do update
    set status        = excluded.status,
        frozen_reason = excluded.frozen_reason,
        frozen_at     = case when excluded.status = 'frozen'  then now() else null end,
        enabled_at    = case when excluded.status = 'enabled' then now() else tenant_modules.enabled_at end,
        changed_by    = excluded.changed_by,
        updated_at    = now()
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke execute on function public.set_tenant_module(text, text) from public, anon;
grant  execute on function public.set_tenant_module(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. THE SWITCH -- platform override
--    Super admin only. This is the one that can write frozen_reason 'plan' or
--    'admin', i.e. a freeze the tenant cannot lift for themselves, and the one
--    that can lift it again.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_tenant_module(
  p_admin_id uuid,
  p_module   text,
  p_status   text,
  p_reason   text default 'admin'
)
returns public.tenant_modules
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_row public.tenant_modules;
begin
  if not public.is_global_viewer() then
    raise exception 'Super admin only' using errcode = '42501';
  end if;
  if p_status not in ('enabled', 'frozen') then
    raise exception 'status must be enabled or frozen' using errcode = '22023';
  end if;
  if p_status = 'frozen' and p_reason not in ('not_selected', 'self', 'plan', 'admin') then
    raise exception 'invalid frozen_reason' using errcode = '22023';
  end if;
  if not exists (select 1 from public.module_catalogue() c where c.module_key = p_module) then
    raise exception 'Unknown module: %', p_module using errcode = '22023';
  end if;

  insert into public.tenant_modules
    (admin_id, module_key, status, frozen_reason, frozen_at, enabled_at, changed_by, updated_at)
  values
    (p_admin_id, p_module, p_status,
     case when p_status = 'frozen' then p_reason else null end,
     case when p_status = 'frozen' then now()    else null end,
     case when p_status = 'enabled' then now()   else null end,
     auth.uid(), now())
  on conflict (admin_id, module_key) do update
    set status        = excluded.status,
        frozen_reason = excluded.frozen_reason,
        frozen_at     = case when excluded.status = 'frozen'  then now() else null end,
        enabled_at    = case when excluded.status = 'enabled' then now() else tenant_modules.enabled_at end,
        changed_by    = excluded.changed_by,
        updated_at    = now()
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke execute on function public.admin_set_tenant_module(uuid, text, text, text) from public, anon;
grant  execute on function public.admin_set_tenant_module(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. RLS
--    Read your own tenant's switchboard. Every WRITE goes through the
--    SECURITY DEFINER functions above -- there is deliberately no insert /
--    update / delete policy, so a tenant cannot unfreeze a plan-gated module
--    with a direct table write from the browser.
-- ---------------------------------------------------------------------------
alter table public.tenant_modules enable row level security;

drop policy if exists "tenant_reads_own_modules" on public.tenant_modules;
create policy "tenant_reads_own_modules"
on public.tenant_modules for select to authenticated
using (admin_id = public.current_admin_id() or public.is_global_viewer());

revoke all on public.tenant_modules from public, anon;
grant select on public.tenant_modules to authenticated;

-- ---------------------------------------------------------------------------
-- 8. ENFORCEMENT -- manual writes into a frozen module
--    Hiding a module in the sidebar is not switching it off: the Supabase
--    client is still there and the tables are still writable. This trigger is
--    what makes a freeze real.
--
--    It refuses INSERT / UPDATE / DELETE from an AUTHENTICATED session only.
--    auth.uid() IS NULL means the service role is writing -- an M-Pesa
--    callback, reconciliation, an edge function, a cron job -- and those must
--    keep working into a frozen module (see the header). SELECT is untouched.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_module_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_module text := tg_argv[0];
begin
  -- Service role / edge functions: never blocked.
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  -- The platform operator is never locked out of a tenant's data.
  if public.is_global_viewer() then
    return coalesce(new, old);
  end if;
  if public.module_enabled(v_module) then
    return coalesce(new, old);
  end if;

  raise exception
    'The % module is switched off for this account.', v_module
    using errcode = '42501',
          hint    = 'Switch it back on under Staff & System -> Modules. Your existing data is untouched.';
end;
$fn$;

-- Attach to the tables a module unambiguously owns.
--
-- NOT attached, on purpose:
--   payments, mpesa_transactions, installment_charges, payment_schedules
--     -- money in flight. A frozen module must not bounce a payment.
--   clients, user_profiles
--     -- the shared identity spine; several modules write them.
--   audit_logs, maker_checker_queue
--     -- audit and approval must record what happened regardless.
--   generated_contracts
--     -- written by POS during a sale; gating it would break sales for a
--        tenant who merely switched the contracts *page* off.
--
-- KNOWN GAP -- the `hr` module (verified against the live database 2026-08-22):
-- its only target here is employee_private_data, which does not exist yet (the
-- PII encryption rollout, 20260813180000, has not been applied). Employee
-- records themselves live in user_profiles, which is deliberately never gated.
-- So freezing `hr` today hides the page and, because `payroll` requires `hr`,
-- forces payroll off and blocks payroll_records writes -- but a direct
-- Supabase call could still write an employee row. Applying 20260813180000
-- closes this without touching this migration: the trigger loop is re-runnable
-- and will pick the table up.
do $do$
declare
  m record;
begin
  for m in
    select * from (values
      ('assets',                    'assets'),
      ('installment_plans',         'hire_purchase'),
      ('kyc_documents',             'kyc'),
      ('esign_documents',           'esign'),
      ('esign_templates',           'esign'),
      ('company_contracts',         'contracts'),
      ('crm_interactions',          'crm'),
      ('leads',                     'crm'),
      ('follow_ups',                'crm'),
      ('employee_private_data',     'hr'),
      ('payroll_records',           'payroll'),
      ('company_invoices',          'accounting'),
      ('sacco_journal_entries',     'accounting'),
      ('sacco_members',             'members'),
      ('sacco_contributions',       'contributions'),
      ('sacco_contribution_types',  'contributions'),
      ('sacco_loans',               'loans'),
      ('sacco_loan_products',       'loans'),
      ('sacco_shares',              'shares'),
      ('sacco_share_transactions',  'shares'),
      ('sacco_share_listings',      'shares'),
      ('sacco_elections',           'voting'),
      ('sacco_votes',               'voting'),
      ('sacco_motions',             'voting'),
      ('sacco_welfare_claims',      'welfare'),
      ('sacco_mgr_contributions',   'mgr'),
      ('sacco_mgr_cycles',          'mgr'),
      ('mpesa_tenant_credentials',  'mpesa')
    ) as t(tbl, module_key)
  loop
    if to_regclass('public.' || m.tbl) is null then
      raise notice 'tenant_modules: skipping % -- table not present on this database', m.tbl;
      continue;
    end if;

    execute format('drop trigger if exists trg_module_gate on public.%I', m.tbl);
    execute format(
      'create trigger trg_module_gate
         before insert or update or delete on public.%I
         for each row execute function public.enforce_module_write(%L)',
      m.tbl, m.module_key
    );
  end loop;
end
$do$;

-- ---------------------------------------------------------------------------
-- 9. BACKFILL -- every tenant that already exists keeps everything
--    Existing customers did not choose modules, so they get all of them
--    enabled. Nothing about their portal changes on the day this runs; the
--    Modules tab simply becomes available to them.
-- ---------------------------------------------------------------------------
insert into public.tenant_modules
  (admin_id, module_key, status, enabled_at, changed_by)
select t.admin_id, c.module_key, 'enabled', now(), null
  from (
    select up.id as admin_id
      from public.user_profiles up
     where up.role::text in ('admin', 'sacco_admin')
  ) t
  cross join public.module_catalogue() c
on conflict (admin_id, module_key) do nothing;

do $do$
declare
  v_tenants integer;
  v_rows    integer;
begin
  select count(distinct admin_id), count(*) into v_tenants, v_rows
    from public.tenant_modules;
  raise notice 'tenant_modules: % module rows across % tenants', v_rows, v_tenants;
end
$do$;

commit;

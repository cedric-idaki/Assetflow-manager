-- ===========================================================================
-- READ-ONLY isolation audit. Nothing here writes, drops or locks anything —
-- paste the whole file into the Supabase SQL editor and read the results.
--
-- Run it BEFORE applying 20260817120000_per_user_data_isolation.sql to see the
-- current state, and AFTER to confirm the intended state. Section 1 is the one
-- that answers "can another admin see my data".
-- ===========================================================================

-- ── 1. Policies that grant by ROLE or unconditionally, rather than by owner ──
-- Anything listed here is a cross-tenant read/write path: it matches on who
-- you are (or on nothing at all) instead of on which tenant owns the row.
select
  p.schemaname,
  p.tablename,
  p.policyname,
  p.cmd,
  case
    when coalesce(p.qual, '') = 'true'                     then 'OPEN — USING (true)'
    when p.qual ilike '%up.role%' and p.qual not ilike '%admin_id%'
                                                           then 'ROLE-BASED — not ownership'
    when coalesce(p.qual, '') = '' and coalesce(p.with_check,'') = 'true'
                                                           then 'OPEN — WITH CHECK (true)'
    else 'review'
  end as problem,
  p.qual   as using_expression,
  p.with_check
from pg_policies p
where p.schemaname = 'public'
  and (
    coalesce(p.qual, '') = 'true'
    or (p.qual ilike '%up.role%' and p.qual not ilike '%admin_id%'
        and p.qual not ilike '%is_global_viewer%')
    or (coalesce(p.qual, '') = '' and coalesce(p.with_check, '') = 'true')
  )
order by p.tablename, p.policyname;

-- ── 2. Tables that hold tenant data but have RLS switched off ───────────────
-- RLS off means the table is readable by any authenticated user that holds the
-- table grant, regardless of any policy written for it.
select
  c.relname                        as table_name,
  c.relrowsecurity                 as rls_enabled,
  c.relforcerowsecurity            as rls_forced,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and (c.relrowsecurity = false
       or not exists (select 1 from pg_policies p
                       where p.schemaname = 'public' and p.tablename = c.relname))
order by c.relname;

-- ── 3. Which tenant columns actually exist ─────────────────────────────────
-- The isolation model is admin_id everywhere; a NULL here means that table is
-- scoped through a parent (clients.admin_id, agents.admin_id) or not at all.
select
  t.table_name,
  max(case when c.column_name = 'admin_id'  then 'admin_id'  end)  as admin_id,
  max(case when c.column_name = 'user_id'   then 'user_id'   end)  as user_id,
  max(case when c.column_name = 'client_id' then 'client_id' end)  as client_id,
  max(case when c.column_name = 'agent_id'  then 'agent_id'  end)  as agent_id,
  max(case when c.column_name = 'sacco_id'  then 'sacco_id'  end)  as sacco_id
from information_schema.tables t
left join information_schema.columns c
       on c.table_schema = t.table_schema and c.table_name = t.table_name
where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
group by t.table_name
having max(case when c.column_name = 'admin_id' then 1 else 0 end) = 0
order by t.table_name;

-- ── 4. Rows with no owner ──────────────────────────────────────────────────
-- These are invisible to every tenant (super_admin only) once the tenant
-- policies are in force. Do NOT bulk-assign them — identify each owner from
-- the row's own history first.
select 'assets'   as table_name, count(*) as unowned from public.assets   where admin_id is null
union all
select 'payments',  count(*) from public.payments  where admin_id is null
union all
select 'clients',   count(*) from public.clients   where admin_id is null
union all
select 'agents',    count(*) from public.agents    where admin_id is null
union all
select 'audit_logs',count(*) from public.audit_logs where admin_id is null
union all
select 'user_profiles (no admin_id, non-owner role)', count(*)
  from public.user_profiles
 where admin_id is null
   and role not in ('super_admin','admin','sacco_admin');

-- ── 4b. The unowned rows themselves, so an owner can be identified by hand ──
select id, asset_code, description, registered_by, linked_client_id, created_at
  from public.assets
 where admin_id is null
 order by created_at
 limit 200;

select id, transaction_id, client_id, processed_by, amount, payment_date
  from public.payments
 where admin_id is null
 order by payment_date
 limit 200;

-- ── 5. Tenant map — who owns what ──────────────────────────────────────────
-- One row per tenant owner. In a healthy multi-tenant database each tenant's
-- counts stand on their own, and a brand-new admin shows zeros everywhere.
select
  up.id                                   as tenant_admin,
  up.email,
  up.role,
  (select count(*) from public.user_profiles s where s.admin_id = up.id) as staff,
  (select count(*) from public.clients   c where c.admin_id = up.id)     as clients,
  (select count(*) from public.assets    a where a.admin_id = up.id)     as assets,
  (select count(*) from public.payments  p where p.admin_id = up.id)     as payments,
  (select count(*) from public.agents    g where g.admin_id = up.id)     as agents
from public.user_profiles up
where up.role in ('admin','sacco_admin','super_admin')
order by up.created_at;

-- ── 6. Accounts that can read across every tenant ──────────────────────────
-- Expect ONLY genuine platform operators here. Any tenant-created account in
-- this list is a cross-tenant leak.
select id, email, full_name, role, admin_id, created_at
  from public.user_profiles
 where role in ('super_admin','director')
 order by role, created_at;

-- ── 7. Profiles whose auth user no longer exists (orphans) ─────────────────
select up.id, up.email, up.role
  from public.user_profiles up
 where not exists (select 1 from auth.users u where u.id = up.id);

-- ── 8. The policy set on the tables this fix touches, for the record ───────
select tablename, policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename in ('assets','payments','clients','agents','audit_logs','user_profiles')
 order by tablename, policyname;

-- ===========================================================================
-- SALES MANAGER -> SALES AGENT HIERARCHY
--
-- Until now the sales force has been FLAT. `public.agents` is a single list per
-- tenant with no relationship between the rows, so the only two answers the
-- database could give about a book of business were "this agent's" and "the
-- whole tenant's". There was no middle: no way to say that six agents belong to
-- Grace, that Grace answers for their pipeline, or that a lead written by one
-- of them is Grace's to see and Grace's to be judged on.
--
-- This migration adds that middle layer.
--
-- ---------------------------------------------------------------------------
-- WHAT A MANAGER IS -- AND WHY IT IS NOT A NEW TABLE
--
-- A sales manager is an `agents` row with `agent_role = 'manager'`. Not a new
-- table, and not a `user_profiles.role`, for reasons worth stating because both
-- alternatives look tempting:
--
--   * A separate `sales_managers` table would fork every join in the product.
--     `leads.agent_id`, `clients.agent_id`, `payments.agent_id`,
--     `crm_interactions.agent_id`, `follow_ups.agent_id`, `agent_wallets`,
--     `sales_expenses` and `agent_tickets` all point at `agents(id)`. A manager
--     who sells -- and they do; a sales manager carries a number -- would need
--     every one of those to accept two kinds of id. One table, one id space.
--
--   * `user_profiles.role = 'manager'` already exists and means something
--     DIFFERENT: it is an office-side supervisory role, and is_crm_supervisor()
--     grants it read of the ENTIRE tenant's CRM. A sales manager is the
--     opposite shape -- a member of the sales force who sees their own team and
--     no further. Overloading the existing role would silently hand every sales
--     manager the whole tenant's pipeline. They keep `sales_agent` as their
--     login role and reach their team through the policies below.
--
-- ---------------------------------------------------------------------------
-- ONE MANAGER, UNLESS AUTHORISED
--
-- The reporting line lives in `agent_manager_assignments`, not in a column, and
-- that is what makes "unless authorised otherwise" expressible:
--
--   * is_primary = true   -- the agent's ONE reporting line. A partial unique
--                            index allows exactly one active primary per agent.
--   * is_primary = false  -- an ADDITIONAL manager, which a CHECK constraint
--                            refuses to store without `authorized_by`. The
--                            exception cannot be created by accident; somebody
--                            has to sign for it.
--
-- Rows are never edited into the past. Deactivating and reassigning close the
-- old row (is_active = false, ended_at, ended_by) and open a new one, so the
-- table is also the history of who managed whom and when -- which is the only
-- way to answer "who was this agent reporting to in August" after a September
-- reassignment.
--
-- `agents.manager_id` is a PROJECTION of the active primary row, maintained by
-- trigger. It exists so the hundred places that already `select *` from agents
-- get the reporting line for free. It is not a second source of truth: a guard
-- trigger refuses any direct write to it.
--
-- ---------------------------------------------------------------------------
-- TWO LEVELS, ON PURPOSE
--
-- A manager may not report to a manager. The validation trigger requires the
-- superior to be `agent_role = 'manager'` and the subordinate to be
-- `agent_role = 'agent'`. That is the hierarchy that was asked for, and it also
-- makes a CYCLE structurally impossible -- no recursive CTE, no depth limit, no
-- "A reports to B reports to A" wedging every policy on the table into an
-- infinite loop. A deeper org chart is a later migration and a deliberate
-- decision, not something that happens because nobody checked.
--
-- ---------------------------------------------------------------------------
-- WHO MAY CHANGE A REPORTING LINE
--
-- Super admins and administrators. NOT managers -- a manager who could reassign
-- their own team could hand themselves another manager's book, or drop the
-- agent whose numbers are dragging their average down. NOT directors: `director`
-- is a tenant role an admin can mint (which is exactly why 20260817120000 took
-- it out of is_global_viewer), so leaving it here would let a tenant grant
-- itself the power to rewrite its own org chart from a role it created.
--
-- The enforcement is NOT RLS. `tenant_manage_agents` is `for all` to every
-- staff member, and is_staff_member() is true for sales_agent -- so an agent can
-- already UPDATE any agent row in their tenant. RLS can express "which rows"; it
-- cannot express "which COLUMN of this row", which is what is needed here. So
-- the reporting line moves only through two SECURITY DEFINER functions,
-- assign_agent_to_manager() and set_agent_manager_link_active(); the assignment
-- table has no write policy at all; and a guard trigger on `agents` refuses
-- hand-edits to manager_id and agent_role.
--
-- ---------------------------------------------------------------------------
-- LINKING THE WORK TO THE MANAGER -- AND THE ONE REAL AMBIGUITY
--
-- `manager_id` is stamped onto leads, clients and payments at write time from
-- the agent's manager AT THAT MOMENT. The stamp is CREDIT: it answers "whose
-- team earned this", and it does not move when the agent is later reassigned,
-- because a sale closed under Grace in August was not closed under David in
-- September and a commission report that says otherwise is wrong.
--
-- VISIBILITY is a different question and gets a different answer: the RLS
-- policies below scope a manager to their team as it stands TODAY, so a manager
-- who inherits an agent inherits that agent's live book -- plus anything still
-- stamped to them, so the manager who earned it can still open it.
--
-- Where the two genuinely conflict -- a restructure where the new manager is
-- meant to take the history too -- assign_agent_to_manager() takes
-- `p_transfer_history`, which re-stamps that agent's rows to the new manager.
-- It is an explicit argument because it is an explicit decision.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES NOT WIDEN
--
-- clients, payments and assets are ALREADY tenant-wide readable by every staff
-- member, sales agents included (tenant_manage_clients, payments_tenant_staff).
-- The manager policies added here are therefore only on the AGENT-SCOPED
-- tables, where a manager genuinely could not see their team's work: leads,
-- crm_interactions, follow_ups, sales_expenses and agent_wallets. Every one is
-- SELECT only. A manager watches their team's book; they do not write in it --
-- the same boundary 20260820120000 drew for supervisors, for the same reason.
--
-- Idempotent throughout and wrapped in a transaction: safe to re-run, lands
-- whole or not at all.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. AGENTS -- WHAT ROLE, AND UNDER WHOM
-- ---------------------------------------------------------------------------

alter table public.agents add column if not exists agent_role text default 'agent';

-- Written as a backfill + SET NOT NULL rather than trusting ADD COLUMN's
-- default: if a previous partial run left the column nullable, ADD COLUMN IF
-- NOT EXISTS is a no-op and the NOT NULL would never arrive.
update public.agents set agent_role = 'agent' where agent_role is null;
alter table public.agents alter column agent_role set default 'agent';
alter table public.agents alter column agent_role set not null;

alter table public.agents drop constraint if exists agents_agent_role_valid;
alter table public.agents add constraint agents_agent_role_valid
  check (agent_role in ('agent', 'manager'));

alter table public.agents add column if not exists manager_id uuid
  references public.agents(id) on delete set null;

comment on column public.agents.agent_role is
  'agent | manager. A manager is an ordinary agents row that other agents report to -- it still sells, still holds a code, a target and a wallet. Only an administrator may set it (agents_guard_hierarchy).';
comment on column public.agents.manager_id is
  'The active PRIMARY manager, projected from agent_manager_assignments by trigger so existing `select *` reads carry the reporting line. Never written by hand -- agents_guard_hierarchy refuses that.';

create index if not exists idx_agents_manager_id on public.agents(manager_id)
  where manager_id is not null;
create index if not exists idx_agents_role on public.agents(admin_id, agent_role);

-- ---------------------------------------------------------------------------
-- 2. THE REPORTING LINES
-- ---------------------------------------------------------------------------

create table if not exists public.agent_manager_assignments (
  id                 uuid primary key default gen_random_uuid(),
  agent_id           uuid not null references public.agents(id) on delete cascade,
  manager_id         uuid not null references public.agents(id) on delete cascade,
  admin_id           uuid,
  is_primary         boolean not null default true,
  is_active          boolean not null default true,
  authorized_by      uuid references public.user_profiles(id) on delete set null,
  authorization_note text,
  assigned_by        uuid references public.user_profiles(id) on delete set null,
  assigned_at        timestamptz not null default now(),
  ended_by           uuid references public.user_profiles(id) on delete set null,
  ended_at           timestamptz,
  end_reason         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.agent_manager_assignments is
  'Who reports to whom on the sales floor, and the history of it. One active primary line per agent; additional lines exist only with an administrator authorisation on the row. Mutated only through assign_agent_to_manager() and set_agent_manager_link_active().';
comment on column public.agent_manager_assignments.is_primary is
  'The agent ONE reporting line. Exactly one may be active per agent (uq_agent_one_active_primary). A false row is the authorised exception.';
comment on column public.agent_manager_assignments.authorized_by is
  'The administrator who signed off a second manager for this agent. Required for every non-primary row -- that requirement IS the "unless authorised otherwise" rule.';
comment on column public.agent_manager_assignments.is_active is
  'Live reporting line. Deactivating never deletes: the closed row stays as the record of who managed this agent, and when.';

-- An agent cannot manage themselves. Cheap to state, and it is the degenerate
-- case every cycle check would otherwise have to handle.
alter table public.agent_manager_assignments drop constraint if exists agent_manager_no_self;
alter table public.agent_manager_assignments add constraint agent_manager_no_self
  check (agent_id <> manager_id);

-- "…unless authorised otherwise", as a constraint. An additional manager with
-- nobody's name against it cannot be stored at all.
alter table public.agent_manager_assignments drop constraint if exists agent_manager_secondary_authorized;
alter table public.agent_manager_assignments add constraint agent_manager_secondary_authorized
  check (is_primary or authorized_by is not null);

-- A closed row must say when it closed; an open one must not pretend it did.
alter table public.agent_manager_assignments drop constraint if exists agent_manager_end_consistent;
alter table public.agent_manager_assignments add constraint agent_manager_end_consistent
  check ((is_active and ended_at is null) or (not is_active and ended_at is not null));

-- THE rule: one manager per agent. Partial on is_active so the history rows do
-- not fight over it.
create unique index if not exists uq_agent_one_active_primary
  on public.agent_manager_assignments (agent_id)
  where is_active and is_primary;

-- The same manager twice over is a duplicate, not a second relationship.
create unique index if not exists uq_agent_manager_active_pair
  on public.agent_manager_assignments (agent_id, manager_id)
  where is_active;

create index if not exists idx_ama_manager_active
  on public.agent_manager_assignments (manager_id)
  where is_active;
create index if not exists idx_ama_agent
  on public.agent_manager_assignments (agent_id, created_at desc);
create index if not exists idx_ama_tenant
  on public.agent_manager_assignments (admin_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. HELPERS
--
--    SECURITY DEFINER with a pinned search_path, so the policies that call them
--    do not recurse through the RLS of the tables they read.
-- ---------------------------------------------------------------------------

-- Who may draw the org chart.
--
-- sacco_admin is included because it IS the administrator of a sacco tenant --
-- the same office `admin` holds for a company, and sacco-side agents
-- (agents.agent_type = 'sacco') are its sales force. director and manager are
-- excluded; see the header.
create or replace function public.is_hierarchy_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_profiles up
     where up.id = auth.uid()
       and up.role in ('super_admin'::public.user_role,
                       'admin'::public.user_role,
                       'sacco_admin'::public.user_role)
  );
$$;

revoke execute on function public.is_hierarchy_admin() from public, anon;
grant  execute on function public.is_hierarchy_admin() to authenticated;

comment on function public.is_hierarchy_admin() is
  'True for the roles that may create, reassign, activate or deactivate a reporting line. Excludes director and manager by design -- a manager must not be able to pick their own team.';

-- The caller's own agents row.
--
-- get_agent_id_for_user() has done this since 20260305210000, but it is
-- SECURITY DEFINER with NO search_path pinned. Rather than change a function
-- five live policies depend on, new code uses this one.
create or replace function public.current_agent_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id from public.agents a where a.user_id = auth.uid() limit 1;
$$;

revoke execute on function public.current_agent_id() from public, anon;
grant  execute on function public.current_agent_id() to authenticated;

comment on function public.current_agent_id() is
  'The agents row belonging to the caller, or NULL. Hardened replacement for get_agent_id_for_user(auth.uid()), which pins no search_path.';

-- Is the caller a sales manager?
create or replace function public.is_sales_manager()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.agents a
     where a.user_id = auth.uid()
       and a.agent_role = 'manager'
  );
$$;

revoke execute on function public.is_sales_manager() from public, anon;
grant  execute on function public.is_sales_manager() to authenticated;

comment on function public.is_sales_manager() is
  'True when the caller agents row is a sales manager. Deliberately does not test agent_status: a manager on leave still answers for their team book, and suspending their oversight would hide the work rather than stop it.';

-- The agents the caller manages, as a set.
--
-- Set-returning rather than scalar-per-row, for the same reason
-- tenant_agent_ids() is: written `agent_id in (select managed_agent_ids())` the
-- planner evaluates it once per query instead of once per lead.
--
-- Both the primary line and any authorised additional line count -- an
-- authorised second manager who could not see the agent's work would be an
-- authorisation for nothing.
create or replace function public.managed_agent_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.agent_id
    from public.agent_manager_assignments m
    join public.agents mgr on mgr.id = m.manager_id
   where m.is_active
     and mgr.user_id = auth.uid();
$$;

revoke execute on function public.managed_agent_ids() from public, anon;
grant  execute on function public.managed_agent_ids() to authenticated;

comment on function public.managed_agent_ids() is
  'Agent ids reporting to the caller on a live line, primary or authorised. Excludes the caller own agent id -- their own book already reaches them through the agents_*_own_* policies.';

-- Every manager a given agent answers to.
create or replace function public.managers_of_agent(p_agent_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.manager_id
    from public.agent_manager_assignments m
   where m.is_active
     and m.agent_id = p_agent_id;
$$;

revoke execute on function public.managers_of_agent(uuid) from public, anon;
grant  execute on function public.managers_of_agent(uuid) to authenticated;

comment on function public.managers_of_agent(uuid) is
  'The live managers of one agent -- the primary line plus any authorised additional ones.';

-- ---------------------------------------------------------------------------
-- 4. VALIDATION AND PROJECTION
-- ---------------------------------------------------------------------------

-- Everything that must be true of a reporting line, checked where it cannot be
-- routed around. The RPCs below check the same things and report them in words;
-- this is the backstop for the service_role and for any future writer.
create or replace function public.agent_manager_assignment_validate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a_admin uuid;
  a_role  text;
  m_admin uuid;
  m_role  text;
begin
  select admin_id, agent_role into a_admin, a_role
    from public.agents where id = new.agent_id;
  if not found then
    raise exception 'agent_manager_assignments: agent % does not exist', new.agent_id
      using errcode = '23503';
  end if;

  select admin_id, agent_role into m_admin, m_role
    from public.agents where id = new.manager_id;
  if not found then
    raise exception 'agent_manager_assignments: manager % does not exist', new.manager_id
      using errcode = '23503';
  end if;

  -- The shape rules bind LIVE lines only.
  --
  -- Not a nicety: agents_close_lines_on_demotion() closes a demoted manager's
  -- lines, and it runs AFTER the demotion has already landed on the agents row.
  -- Re-checking "the manager must be a manager" while closing those rows would
  -- raise on the way to tidying them up, and the demotion could never complete.
  -- A closed row is history; history is not required to still be legal.
  if new.is_active then
    -- A reporting line that crosses tenants would hand one company's pipeline
    -- to another company's manager. NULL admin_id is the unowned-agent drift
    -- 20260820140000 documented; those cannot be put in a hierarchy at all,
    -- because there is no tenant to scope the resulting visibility to.
    if a_admin is null or m_admin is null or a_admin is distinct from m_admin then
      raise exception 'agent_manager_assignments: agent and manager must belong to the same tenant'
        using errcode = '42501';
    end if;

    if m_role <> 'manager' then
      raise exception 'agent_manager_assignments: % is not a sales manager', new.manager_id
        using errcode = '23514';
    end if;

    -- Two levels. See the header: this is what makes a cycle impossible.
    if a_role <> 'agent' then
      raise exception 'agent_manager_assignments: a sales manager cannot report to another manager'
        using errcode = '23514';
    end if;
  end if;

  new.admin_id   := coalesce(a_admin, new.admin_id);
  new.updated_at := now();

  if tg_op = 'INSERT' then
    new.assigned_by := coalesce(new.assigned_by, auth.uid());
  end if;

  return new;
end;
$$;

revoke execute on function public.agent_manager_assignment_validate() from public, anon, authenticated;

drop trigger if exists trg_ama_validate on public.agent_manager_assignments;
create trigger trg_ama_validate
  before insert or update on public.agent_manager_assignments
  for each row execute function public.agent_manager_assignment_validate();

-- Keep agents.manager_id equal to the active primary line.
--
-- Recomputed from the table rather than copied from the row that changed, for
-- the reason recompute_agent_sales() gives: a recompute is idempotent, it
-- self-heals a projection that has drifted, and it is the only shape that can
-- move the value back to NULL when the last line closes.
--
-- The flag is how the guard trigger below tells this write apart from a hand
-- edit. set_config(..., true) is transaction-local, so it cannot leak into
-- another statement on a pooled connection.
create or replace function public.agent_manager_sync_primary()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target uuid;
  live   uuid;
begin
  -- Picked with IF rather than coalesce(new..., old...) or a CASE: on DELETE
  -- there is no NEW record at all, and one expression naming both records has
  -- to resolve both. Reading a field off the absent one is an error, not a NULL.
  if tg_op = 'DELETE' then
    target := old.agent_id;
  else
    target := new.agent_id;
  end if;

  select m.manager_id into live
    from public.agent_manager_assignments m
   where m.agent_id = target and m.is_active and m.is_primary
   limit 1;

  perform set_config('app.sales_hierarchy_sync', 'on', true);
  update public.agents set manager_id = live, updated_at = now()
   where id = target and manager_id is distinct from live;
  perform set_config('app.sales_hierarchy_sync', '', true);

  return null;
end;
$$;

revoke execute on function public.agent_manager_sync_primary() from public, anon, authenticated;

drop trigger if exists trg_ama_sync_primary on public.agent_manager_assignments;
create trigger trg_ama_sync_primary
  after insert or update or delete on public.agent_manager_assignments
  for each row execute function public.agent_manager_sync_primary();

-- The column guard.
--
-- tenant_manage_agents is `for all` to every staff member and sales_agent is a
-- staff member, so without this an agent could simply UPDATE their own row and
-- name themselves a manager, or move themselves under a different one. RLS
-- cannot express a per-column rule; a trigger can.
create or replace function public.agents_guard_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then      -- service_role / migrations: trusted caller
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.agent_role is distinct from 'agent' and not public.is_hierarchy_admin() then
      raise exception 'agents: only an administrator may create a sales manager'
        using errcode = '42501';
    end if;
    if new.manager_id is not null then
      raise exception 'agents.manager_id is derived -- draw the reporting line with assign_agent_to_manager()'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.agent_role is distinct from old.agent_role and not public.is_hierarchy_admin() then
    raise exception 'agents.agent_role: only an administrator may promote or demote a sales manager'
      using errcode = '42501';
  end if;

  -- Even an administrator writes this through the assignment table: two places
  -- to change a reporting line is two places for them to disagree.
  if new.manager_id is distinct from old.manager_id
     and coalesce(current_setting('app.sales_hierarchy_sync', true), '') <> 'on' then
    raise exception 'agents.manager_id is derived from agent_manager_assignments -- use assign_agent_to_manager()'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.agents_guard_hierarchy() from public, anon, authenticated;

drop trigger if exists guard_agent_hierarchy on public.agents;
create trigger guard_agent_hierarchy
  before insert or update on public.agents
  for each row execute function public.agents_guard_hierarchy();

-- Keep the chart legal when somebody's ROLE changes.
--
-- Both directions leave an illegal state behind if nothing tidies up, and both
-- are silent rather than loud, because the validate trigger only fires on
-- writes to the assignment table -- not on the agents row that just invalidated
-- one:
--
--   DEMOTION   a manager stops being a manager while a team still reports to
--              them. Their lines would stay live, so managed_agent_ids() would
--              keep handing somebody else's pipeline to an ordinary agent.
--
--   PROMOTION  an agent who reports to somebody becomes a manager. That is a
--              manager reporting to a manager -- exactly the two-level rule the
--              validate trigger enforces on insert, arrived at by the back
--              door, and the shape that makes cycles possible.
--
-- Both are closed here, keeping the unique indexes and the projection honest
-- without asking every caller to remember. Rows are CLOSED, never deleted: who
-- managed whom last month is still true.
create or replace function public.agents_sync_lines_on_role_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.agent_role = new.agent_role then
    return null;
  end if;

  if new.agent_role <> 'manager' then
    -- No longer a manager: release the team.
    update public.agent_manager_assignments
       set is_active  = false,
           ended_at   = now(),
           ended_by   = auth.uid(),
           end_reason = coalesce(end_reason, 'Manager role removed'),
           updated_at = now()
     where manager_id = new.id and is_active;
  else
    -- Now a manager: they answer to nobody on this floor.
    update public.agent_manager_assignments
       set is_active  = false,
           ended_at   = now(),
           ended_by   = auth.uid(),
           end_reason = coalesce(end_reason, 'Promoted to sales manager'),
           updated_at = now()
     where agent_id = new.id and is_active;
  end if;

  return null;
end;
$$;

revoke execute on function public.agents_sync_lines_on_role_change() from public, anon, authenticated;

drop trigger if exists trg_agents_sync_lines on public.agents;
create trigger trg_agents_sync_lines
  after update of agent_role on public.agents
  for each row execute function public.agents_sync_lines_on_role_change();

-- Take an agent out of the chart BEFORE the row goes.
--
-- Without this, DELETING A SALES MANAGER CAN FAIL, and the reason is subtle
-- enough to be worth writing down. Two foreign keys point at the row being
-- deleted:
--
--   agent_manager_assignments.manager_id  ON DELETE CASCADE
--   agents.manager_id (self-reference)    ON DELETE SET NULL
--
-- Postgres does not promise an order between them. If the SET NULL runs first
-- it issues `update agents set manager_id = null` on every subordinate, the
-- guard trigger above sees manager_id changing with no sync flag set, and it
-- raises — so whether the delete succeeds depends on which referential action
-- the planner happens to run first.
--
-- Removing the lines here makes it deterministic: the projection is already
-- NULL by the time either FK acts, so the SET NULL matches no rows and the
-- guard never sees a change. Deleting the lines rather than closing them is
-- correct for a row that is about to cease to exist — the history would point
-- at a manager who is no longer in the table, and CASCADE was always going to
-- remove them anyway.
create or replace function public.agents_clear_lines_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.agent_manager_assignments
   where manager_id = old.id or agent_id = old.id;
  return old;
end;
$$;

revoke execute on function public.agents_clear_lines_on_delete() from public, anon, authenticated;

drop trigger if exists trg_agents_clear_lines_predelete on public.agents;
create trigger trg_agents_clear_lines_predelete
  before delete on public.agents
  for each row execute function public.agents_clear_lines_on_delete();

-- ---------------------------------------------------------------------------
-- 5. THE WORK, LINKED TO THE MANAGER
--
--    See the header for why the stamp is CREDIT (fixed at write time) while
--    visibility follows the live team.
-- ---------------------------------------------------------------------------

alter table public.leads    add column if not exists manager_id uuid references public.agents(id) on delete set null;
alter table public.clients  add column if not exists manager_id uuid references public.agents(id) on delete set null;
alter table public.payments add column if not exists manager_id uuid references public.agents(id) on delete set null;

comment on column public.leads.manager_id is
  'The manager the owning agent reported to when this lead was written. Credit, not visibility -- it does not move when the agent is reassigned unless the reassignment explicitly transfers history.';
comment on column public.clients.manager_id is
  'The manager the registering agent reported to at registration. NULL for a client no agent brought in.';
comment on column public.payments.manager_id is
  'The manager credited with this sale. Stamped from the agent reporting line at write time so a commission report survives a later reassignment.';

create index if not exists idx_leads_manager    on public.leads(manager_id, created_at desc)      where manager_id is not null;
create index if not exists idx_clients_manager  on public.clients(manager_id, created_at desc)    where manager_id is not null;
create index if not exists idx_payments_manager on public.payments(manager_id, payment_date desc) where manager_id is not null;

-- One stamp for all three tables.
--
-- IT NEVER RAISES. This trigger fires on the payments insert path, which
-- includes the M-Pesa callback and the POS till, and 20260828120000 already
-- settled the principle for that table: an attribution column is derived, and
-- no derived number is worth refusing a customer's money over. A failure leaves
-- manager_id NULL, logs a warning, and the row lands. NULL is also self-healing
-- -- the next update of the row re-derives it.
create or replace function public.stamp_manager_from_agent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.agent_id is null then
    new.manager_id := null;
    return new;
  end if;

  -- The OLD comparison lives in its own branch on purpose: OLD does not exist
  -- on INSERT, and a single condition naming it would have to resolve it there.
  if tg_op = 'INSERT' then
    select a.manager_id into new.manager_id
      from public.agents a where a.id = new.agent_id;
  elsif new.manager_id is null or new.agent_id is distinct from old.agent_id then
    select a.manager_id into new.manager_id
      from public.agents a where a.id = new.agent_id;
  end if;

  return new;
exception
  when others then
    raise warning 'stamp_manager_from_agent failed on %.% (agent %): % -- row kept, manager_id left unstamped',
                  tg_table_schema, tg_table_name, new.agent_id, sqlerrm;
    return new;
end;
$$;

revoke execute on function public.stamp_manager_from_agent() from public, anon, authenticated;

comment on function public.stamp_manager_from_agent() is
  'Copies the owning agent current manager onto a lead, client or payment at write time. Re-derives only when the agent changes or the stamp is missing, so a later reassignment does not rewrite history.';

drop trigger if exists trg_leads_stamp_manager on public.leads;
create trigger trg_leads_stamp_manager
  before insert or update on public.leads
  for each row execute function public.stamp_manager_from_agent();

drop trigger if exists trg_clients_stamp_manager on public.clients;
create trigger trg_clients_stamp_manager
  before insert or update on public.clients
  for each row execute function public.stamp_manager_from_agent();

drop trigger if exists trg_payments_stamp_manager on public.payments;
create trigger trg_payments_stamp_manager
  before insert or update on public.payments
  for each row execute function public.stamp_manager_from_agent();

-- ---------------------------------------------------------------------------
-- 6. RLS
--
--    SELECT only, and only on the agent-scoped tables. clients, payments and
--    assets are already tenant-wide readable by every staff member, so there is
--    nothing to add there -- and nothing added here takes anything away.
-- ---------------------------------------------------------------------------

alter table public.agent_manager_assignments enable row level security;

-- Read: the administrators who manage the org chart and the supervisors who
-- watch it, the manager on the line, and the agent whose line it is. An agent
-- is entitled to know who they report to.
drop policy if exists "hierarchy_read_assignments" on public.agent_manager_assignments;
create policy "hierarchy_read_assignments"
on public.agent_manager_assignments for select to authenticated
using (
  (admin_id is not null and admin_id = public.current_admin_id()
   and (public.is_hierarchy_admin() or public.is_crm_supervisor()))
  or agent_id   = public.current_agent_id()
  or manager_id = public.current_agent_id()
);

-- There is deliberately NO insert/update/delete policy. Reporting lines move
-- only through the two SECURITY DEFINER functions below, which is what makes
-- "administrators only" enforceable at all -- see the header.

-- ---- leads ----
drop policy if exists "managers_read_team_leads" on public.leads;
create policy "managers_read_team_leads"
on public.leads for select to authenticated
using (
  agent_id in (select public.managed_agent_ids())
  or (manager_id is not null and manager_id = public.current_agent_id())
);

-- ---- crm_interactions ----
drop policy if exists "managers_read_team_interactions" on public.crm_interactions;
create policy "managers_read_team_interactions"
on public.crm_interactions for select to authenticated
using (agent_id in (select public.managed_agent_ids()));

-- ---- follow_ups ----
drop policy if exists "managers_read_team_followups" on public.follow_ups;
create policy "managers_read_team_followups"
on public.follow_ups for select to authenticated
using (agent_id in (select public.managed_agent_ids()));

-- ---- sales_expenses ----
--
-- A manager signs off the team's cost of sale; a team spend they cannot see is
-- a budget they cannot hold.
drop policy if exists "managers_read_team_expenses" on public.sales_expenses;
create policy "managers_read_team_expenses"
on public.sales_expenses for select to authenticated
using (agent_id in (select public.managed_agent_ids()));

-- ---- agent_wallets ----
--
-- Read only, and only the team's. This is the commission ledger -- the other
-- half of the performance picture: what the team sold and what it earned.
-- Withdrawals stay an admin action; nothing here grants a write.
drop policy if exists "managers_read_team_wallets" on public.agent_wallets;
create policy "managers_read_team_wallets"
on public.agent_wallets for select to authenticated
using (agent_id in (select public.managed_agent_ids()));

-- ---------------------------------------------------------------------------
-- 7. THE TWO WRITE PATHS
-- ---------------------------------------------------------------------------

-- Create or move a reporting line.
--
-- One function is "assign" AND "reassign", because they are the same operation
-- seen from either end: assigning a primary manager to an agent who already has
-- one IS the reassignment. Doing it in a single statement is what keeps
-- uq_agent_one_active_primary satisfiable -- close-then-open over two round
-- trips leaves a window with no manager at all, and a failure halfway leaves
-- the agent orphaned.
create or replace function public.assign_agent_to_manager(
  p_agent_id         uuid,
  p_manager_id       uuid,
  p_is_primary       boolean default true,
  p_note             text    default null,
  p_transfer_history boolean default false
)
returns public.agent_manager_assignments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller     uuid := auth.uid();
  tenant     uuid;
  a_row      public.agents%rowtype;
  m_row      public.agents%rowtype;
  existing   public.agent_manager_assignments%rowtype;
  had_pair   boolean := false;
  result     public.agent_manager_assignments%rowtype;
begin
  if caller is null then
    raise exception 'Sign in to change a reporting line' using errcode = '42501';
  end if;
  if not public.is_hierarchy_admin() then
    raise exception 'Only an administrator may assign a sales agent to a manager'
      using errcode = '42501';
  end if;

  tenant := public.current_admin_id();

  select * into a_row from public.agents where id = p_agent_id;
  if not found then
    raise exception 'That sales agent no longer exists' using errcode = '23503';
  end if;
  select * into m_row from public.agents where id = p_manager_id;
  if not found then
    raise exception 'That sales manager no longer exists' using errcode = '23503';
  end if;

  -- Both ends must be in the caller's own tenant. Checked here as well as in
  -- the trigger so the message names the problem instead of a constraint.
  if a_row.admin_id is distinct from tenant or m_row.admin_id is distinct from tenant then
    raise exception 'A reporting line can only be drawn between two agents of your own organisation'
      using errcode = '42501';
  end if;
  if p_agent_id = p_manager_id then
    raise exception 'An agent cannot report to themselves' using errcode = '23514';
  end if;
  if m_row.agent_role <> 'manager' then
    raise exception '% is not a sales manager -- promote them first', m_row.full_name
      using errcode = '23514';
  end if;
  if a_row.agent_role <> 'agent' then
    raise exception 'A sales manager cannot be assigned under another manager'
      using errcode = '23514';
  end if;

  -- "…unless authorised otherwise." A second manager is an exception somebody
  -- has to sign for, and a signature with no reason on it is not much of one.
  if not coalesce(p_is_primary, true) and coalesce(btrim(p_note), '') = '' then
    raise exception 'An additional manager needs a written authorisation -- say why this agent reports to two managers'
      using errcode = '23514';
  end if;

  select * into existing
    from public.agent_manager_assignments
   where agent_id = p_agent_id and manager_id = p_manager_id and is_active;
  had_pair := found;

  -- Already exactly what was asked for: return it rather than churning the
  -- history with an identical row.
  if had_pair and existing.is_primary = coalesce(p_is_primary, true) then
    return existing;
  end if;

  -- Adding an "additional" manager who is already the agent's primary would
  -- close the primary line to reopen it as a secondary, leaving the agent
  -- reporting to nobody in particular. That is never what the caller meant.
  if had_pair and existing.is_primary and not coalesce(p_is_primary, true) then
    raise exception '% already manages % as their primary manager', m_row.full_name, a_row.full_name
      using errcode = '23514';
  end if;

  -- The reassignment: close the line the agent is on before opening the new
  -- one. Any additional authorised managers are left alone -- reassigning the
  -- primary line says nothing about them.
  if coalesce(p_is_primary, true) then
    update public.agent_manager_assignments
       set is_active  = false,
           ended_at   = now(),
           ended_by   = caller,
           end_reason = coalesce(nullif(btrim(p_note), ''), 'Reassigned to another manager'),
           updated_at = now()
     where agent_id = p_agent_id and is_active and is_primary;
  end if;

  -- An existing line for this pair whose primacy is changing is closed too, so
  -- the pair index cannot collide with the row about to be inserted.
  if had_pair then
    update public.agent_manager_assignments
       set is_active  = false,
           ended_at   = now(),
           ended_by   = caller,
           end_reason = coalesce(end_reason, 'Reporting line changed'),
           updated_at = now()
     where id = existing.id and is_active;
  end if;

  insert into public.agent_manager_assignments (
    agent_id, manager_id, admin_id, is_primary, is_active,
    authorized_by, authorization_note, assigned_by, assigned_at
  ) values (
    p_agent_id, p_manager_id, tenant, coalesce(p_is_primary, true), true,
    case when coalesce(p_is_primary, true) then null else caller end,
    nullif(btrim(p_note), ''),
    caller, now()
  )
  returning * into result;

  -- The restructure case: the new manager takes the book as well as the agent.
  -- Off by default -- see the header on credit versus visibility.
  if coalesce(p_transfer_history, false) and coalesce(p_is_primary, true) then
    update public.leads    set manager_id = p_manager_id where agent_id = p_agent_id;
    update public.clients  set manager_id = p_manager_id where agent_id = p_agent_id;
    update public.payments set manager_id = p_manager_id where agent_id = p_agent_id;
  end if;

  insert into public.audit_logs (user_id, action, table_name, record_id, new_values, description, severity, admin_id)
  values (
    caller, 'update'::public.audit_action, 'agent_manager_assignments', result.id,
    jsonb_build_object(
      'agent_id',   p_agent_id,   'agent',   a_row.full_name,
      'manager_id', p_manager_id, 'manager', m_row.full_name,
      'is_primary', coalesce(p_is_primary, true),
      'transferred_history', coalesce(p_transfer_history, false)
    ),
    format('%s now reports to %s%s', a_row.full_name, m_row.full_name,
           case when coalesce(p_is_primary, true) then '' else ' (additional manager, authorised)' end),
    'info', tenant
  );

  return result;
end;
$$;

revoke execute on function public.assign_agent_to_manager(uuid, uuid, boolean, text, boolean) from public, anon;
grant  execute on function public.assign_agent_to_manager(uuid, uuid, boolean, text, boolean) to authenticated;

comment on function public.assign_agent_to_manager(uuid, uuid, boolean, text, boolean) is
  'Assign or reassign a sales agent primary manager, or add an authorised second manager. Administrators only. Closes the previous line in the same statement, so the agent is never left without one.';

-- Activate or deactivate an existing line.
create or replace function public.set_agent_manager_link_active(
  p_assignment_id uuid,
  p_active        boolean,
  p_note          text default null
)
returns public.agent_manager_assignments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  tenant uuid;
  link   public.agent_manager_assignments%rowtype;
  clash  uuid;
  result public.agent_manager_assignments%rowtype;
begin
  if caller is null then
    raise exception 'Sign in to change a reporting line' using errcode = '42501';
  end if;
  if not public.is_hierarchy_admin() then
    raise exception 'Only an administrator may activate or deactivate a reporting line'
      using errcode = '42501';
  end if;

  tenant := public.current_admin_id();

  select * into link from public.agent_manager_assignments where id = p_assignment_id;
  if not found then
    raise exception 'That reporting line no longer exists' using errcode = '23503';
  end if;
  if link.admin_id is distinct from tenant then
    raise exception 'That reporting line belongs to another organisation' using errcode = '42501';
  end if;
  if link.is_active = p_active then
    return link;                              -- already there; nothing to log
  end if;

  -- Reactivating a primary line for an agent who has since been given another
  -- manager would violate uq_agent_one_active_primary. Say so in words rather
  -- than letting a unique violation surface as "duplicate key".
  if p_active and link.is_primary then
    select manager_id into clash
      from public.agent_manager_assignments
     where agent_id = link.agent_id and is_active and is_primary
     limit 1;
    if clash is not null then
      raise exception 'That agent already reports to another manager -- reassign them instead of reactivating this line'
        using errcode = '23505';
    end if;
  end if;

  update public.agent_manager_assignments
     set is_active   = p_active,
         ended_at    = case when p_active then null   else now()      end,
         ended_by    = case when p_active then null   else caller     end,
         end_reason  = case when p_active then null   else nullif(btrim(p_note), '') end,
         assigned_at = case when p_active then now()  else assigned_at end,
         assigned_by = case when p_active then caller else assigned_by end,
         updated_at  = now()
   where id = p_assignment_id
  returning * into result;

  insert into public.audit_logs (user_id, action, table_name, record_id, new_values, description, severity, admin_id)
  values (
    caller, 'update'::public.audit_action, 'agent_manager_assignments', result.id,
    jsonb_build_object('is_active', p_active, 'note', nullif(btrim(p_note), '')),
    case when p_active then 'Reporting line reactivated' else 'Reporting line deactivated' end,
    'info', tenant
  );

  return result;
end;
$$;

revoke execute on function public.set_agent_manager_link_active(uuid, boolean, text) from public, anon;
grant  execute on function public.set_agent_manager_link_active(uuid, boolean, text) to authenticated;

comment on function public.set_agent_manager_link_active(uuid, boolean, text) is
  'Activate or deactivate one reporting line. Administrators only. Deactivating keeps the row as history rather than deleting it.';

-- ---------------------------------------------------------------------------
-- 8. THE TEAM'S NUMBERS
--
--    SECURITY INVOKER on purpose: the caller sees exactly the rows their own
--    policies allow, so this one RPC serves an administrator and a manager
--    without either seeing the other's scope. Aggregating in SQL rather than in
--    the client follows the rule 20260822140000 set for the sacco dashboard --
--    a total reduced over a paginated array is a total of the page, not of the
--    team.
-- ---------------------------------------------------------------------------
create or replace function public.sales_team_stats(p_manager_id uuid default null)
returns table (
  manager_id       uuid,
  agent_id         uuid,
  agent_code       text,
  full_name        text,
  email            text,
  phone            text,
  region           text,
  agent_status     public.agent_status,
  is_primary       boolean,
  assignment_id    uuid,
  assigned_at      timestamptz,
  leads_total      bigint,
  leads_open       bigint,
  leads_won        bigint,
  leads_lost       bigint,
  pipeline_value   numeric,
  clients_total    bigint,
  sales_total      numeric,
  commission_total numeric,
  target_amount    numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with team as (
    select m.manager_id, m.agent_id, m.is_primary, m.id as assignment_id, m.assigned_at
      from public.agent_manager_assignments m
     where m.is_active
       and (p_manager_id is null or m.manager_id = p_manager_id)
  )
  select
    t.manager_id,
    a.id,
    a.agent_code,
    a.full_name,
    a.email,
    a.phone,
    a.region,
    a.agent_status,
    t.is_primary,
    t.assignment_id,
    t.assigned_at,
    coalesce(l.total, 0),
    coalesce(l.open_leads, 0),
    coalesce(l.won, 0),
    coalesce(l.lost, 0),
    coalesce(l.pipeline, 0),
    coalesce(c.total, 0),
    coalesce(a.total_sales, 0),
    coalesce(a.total_commission, 0),
    coalesce(a.target_amount, 0)
  from team t
  join public.agents a on a.id = t.agent_id
  left join lateral (
    select count(*)                                                        as total,
           count(*) filter (where ld.stage <> 'closed'::public.lead_stage) as open_leads,
           count(*) filter (where ld.stage =  'closed'::public.lead_stage
                              and ld.lost_reason is null)                  as won,
           count(*) filter (where ld.lost_reason is not null)              as lost,
           coalesce(sum(ld.deal_value) filter (
             where ld.stage <> 'closed'::public.lead_stage and ld.lost_reason is null
           ), 0)                                                           as pipeline
      from public.leads ld where ld.agent_id = a.id
  ) l on true
  left join lateral (
    select count(*) as total from public.clients cl where cl.agent_id = a.id
  ) c on true;
$$;

revoke execute on function public.sales_team_stats(uuid) from public, anon;
grant  execute on function public.sales_team_stats(uuid) to authenticated;

comment on function public.sales_team_stats(uuid) is
  'Per-agent roll-up for one manager team, or for every team the caller can see. SECURITY INVOKER, so RLS decides the scope: an administrator gets their tenant, a manager gets their own team.';

-- ---------------------------------------------------------------------------
-- 9. BACKFILL AND REALTIME
--
--    There are no reporting lines yet, so the backfill is a no-op on a fresh
--    database -- it exists so a re-run after rows have appeared repairs the
--    projection and any stamp the trigger could not complete.
-- ---------------------------------------------------------------------------

do $$
begin
  perform set_config('app.sales_hierarchy_sync', 'on', true);

  update public.agents a
     set manager_id = m.manager_id
    from public.agent_manager_assignments m
   where m.agent_id = a.id and m.is_active and m.is_primary
     and a.manager_id is distinct from m.manager_id;

  update public.agents a
     set manager_id = null
   where a.manager_id is not null
     and not exists (
       select 1 from public.agent_manager_assignments m
        where m.agent_id = a.id and m.is_active and m.is_primary
     );

  perform set_config('app.sales_hierarchy_sync', '', true);
end;
$$;

update public.leads l    set manager_id = a.manager_id
  from public.agents a where a.id = l.agent_id
   and l.manager_id is null and a.manager_id is not null;
update public.clients c  set manager_id = a.manager_id
  from public.agents a where a.id = c.agent_id
   and c.manager_id is null and a.manager_id is not null;
update public.payments p set manager_id = a.manager_id
  from public.agents a where a.id = p.agent_id
   and p.manager_id is null and a.manager_id is not null;

do $$ begin
  alter publication supabase_realtime add table public.agent_manager_assignments;
exception when duplicate_object then null; end $$;

alter table public.agent_manager_assignments replica identity default;

-- Read-only at the GRANT level as well as through RLS.
--
-- Supabase's default privileges hand `authenticated` full DML on every new
-- public table. RLS already refuses the writes -- there is no write policy --
-- but a table whose only legitimate writers are two SECURITY DEFINER functions
-- should not be carrying an INSERT grant that happens to be unreachable.
-- Belt and braces, because the thing being protected is who can see whose
-- pipeline. TRUNCATE in particular is not filtered by RLS at all.
grant select on public.agent_manager_assignments to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.agent_manager_assignments from authenticated;
revoke all on public.agent_manager_assignments from anon;

notify pgrst, 'reload schema';

commit;

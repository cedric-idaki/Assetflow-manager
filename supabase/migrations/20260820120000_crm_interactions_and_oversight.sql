-- ===========================================================================
-- CRM: INTERACTION HISTORY + ADMIN / SUPER-ADMIN OVERSIGHT
--
-- What the portal already had was a pipeline (leads.stage), a diary
-- (follow_ups) and a client book (useAgentClients). What it did not have is
-- the thing that makes a CRM a CRM: a RECORD OF CONTACT. "Called her Tuesday,
-- she wants the Westlands unit but not before her loan clears" had exactly one
-- place to live -- leads.notes, a single text column the next edit overwrites.
-- So nobody could answer "when did we last speak to this person, and what was
-- said".
--
-- Second gap, and the reason this migration exists at all: leads and follow_ups
-- carry FOUR policies each, every one of them
--
--     agent_id = public.get_agent_id_for_user(auth.uid())
--
-- which means AN ADMIN CANNOT READ A SINGLE LEAD OF THEIR OWN AGENTS. Not one
-- row. The admin dashboard's "Sales Agents" tab shows commission totals because
-- those live on public.agents; the pipeline behind them was invisible. There
-- was nothing to fix in the UI -- the rows never arrived.
--
-- This migration adds:
--
--   1. public.crm_interactions -- one row per touch (call, meeting, email, ...),
--      owned by the agent, tenant-keyed by admin_id like every other table.
--   2. Oversight SELECT policies on crm_interactions, leads and follow_ups so a
--      tenant's supervisors (admin / director / manager / sacco_admin) read
--      their own agents' CRM, and super_admin reads all of it.
--   3. Denormalised contact counters on leads, so a pipeline card can say
--      "last contacted 9 days ago" without a per-row join.
--
-- Oversight is READ-ONLY on purpose. An admin watching a pipeline is not the
-- same permission as an admin editing an agent's lead behind their back; if
-- reassignment is wanted later it should be its own explicit, audited action.
--
-- Everything is IF NOT EXISTS / OR REPLACE and wrapped in a transaction: safe
-- to re-run, lands whole or not at all.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. TYPES
-- ---------------------------------------------------------------------------

-- CREATE TYPE has no IF NOT EXISTS, and DROP TYPE ... CASCADE would take the
-- column with it on a re-run, so each is created only when absent.
do $$
begin
  if not exists (select 1 from pg_type t
                   join pg_namespace n on n.oid = t.typnamespace
                  where t.typname = 'crm_interaction_type' and n.nspname = 'public') then
    create type public.crm_interaction_type as enum (
      'call', 'whatsapp', 'sms', 'email', 'meeting', 'site_visit',
      'proposal', 'note', 'other'
    );
  end if;

  if not exists (select 1 from pg_type t
                   join pg_namespace n on n.oid = t.typnamespace
                  where t.typname = 'crm_interaction_direction' and n.nspname = 'public') then
    create type public.crm_interaction_direction as enum ('outbound', 'inbound');
  end if;
end$$;

comment on type public.crm_interaction_type is
  'How the contact happened. site_visit and proposal are separate from meeting because both are pipeline milestones an admin reports on.';

-- ---------------------------------------------------------------------------
-- 2. TABLE
-- ---------------------------------------------------------------------------

create table if not exists public.crm_interactions (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.agents(id)  on delete cascade,
  -- Tenant key, set by trigger from the agent. Never trusted from the client.
  admin_id      uuid,
  -- A touch is against a lead OR a converted client (or, rarely, neither -- a
  -- walk-in logged before the lead row exists). Both are nullable and both are
  -- kept: a lead that converts keeps its history AND gains a client_id.
  lead_id       uuid references public.leads(id)   on delete cascade,
  client_id     uuid references public.clients(id) on delete set null,
  -- Denormalised so the timeline still reads correctly after a lead is deleted,
  -- and for contacts that were never a lead row.
  contact_name  text,
  interaction_type public.crm_interaction_type      not null default 'call',
  direction        public.crm_interaction_direction not null default 'outbound',
  subject       text,
  summary       text,
  -- Controlled vocabulary rather than free text: the oversight dashboard counts
  -- these, and free text cannot be counted.
  outcome       text,
  duration_minutes integer,
  occurred_at   timestamptz not null default now(),
  -- What the agent committed to next. Scheduling a real follow_up is a separate
  -- action; this is the sentence they wrote while it was still fresh.
  next_step     text,
  logged_by     uuid references public.user_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.crm_interactions drop constraint if exists crm_interactions_outcome_check;
alter table public.crm_interactions add constraint crm_interactions_outcome_check
  check (outcome is null or outcome in (
    'connected', 'no_answer', 'interested', 'needs_info',
    'not_interested', 'rescheduled', 'deal_agreed', 'lost'
  ));

alter table public.crm_interactions drop constraint if exists crm_interactions_duration_check;
alter table public.crm_interactions add constraint crm_interactions_duration_check
  check (duration_minutes is null or (duration_minutes >= 0 and duration_minutes <= 1440));

-- A touch has to be about somebody. Without this, a row with all three subject
-- columns NULL is legal and lands in no timeline at all.
alter table public.crm_interactions drop constraint if exists crm_interactions_subject_present;
alter table public.crm_interactions add constraint crm_interactions_subject_present
  check (
    lead_id is not null
    or client_id is not null
    or nullif(btrim(coalesce(contact_name, '')), '') is not null
  );

comment on table public.crm_interactions is
  'Chronological record of every contact between a sales agent and a lead or client. Agents own and may correct their own rows; supervisors read but never write.';
comment on column public.crm_interactions.outcome is
  'Controlled vocabulary -- the oversight dashboard aggregates on it. NULL means the agent did not say.';
comment on column public.crm_interactions.occurred_at is
  'When the contact happened, which is NOT created_at: an agent logs Tuesday call on Thursday.';

create index if not exists idx_crm_interactions_agent_time
  on public.crm_interactions (agent_id, occurred_at desc);
create index if not exists idx_crm_interactions_admin_time
  on public.crm_interactions (admin_id, occurred_at desc);
create index if not exists idx_crm_interactions_lead
  on public.crm_interactions (lead_id, occurred_at desc) where lead_id is not null;
create index if not exists idx_crm_interactions_client
  on public.crm_interactions (client_id, occurred_at desc) where client_id is not null;

-- ---------------------------------------------------------------------------
-- 3. LEADS: contact counters
--    So "last contacted 9 days ago" costs no join on a 5-column pipeline board.
-- ---------------------------------------------------------------------------

alter table public.leads add column if not exists interaction_count     integer not null default 0;
alter table public.leads add column if not exists last_interaction_type text;

comment on column public.leads.interaction_count is
  'Kept current by trg_crm_interactions_sync_lead. leads.last_contact_at is bumped by the same trigger.';

-- ---------------------------------------------------------------------------
-- 4. HELPERS
--    SECURITY DEFINER so policies calling them do not recurse through the RLS
--    of the tables they read (agents, user_profiles).
-- ---------------------------------------------------------------------------

-- Who may WATCH a tenant's CRM without owning the rows.
--
-- Deliberately NOT is_staff_member(): that returns true for sales_agent too
-- (it excludes only client and sacco_member), so reusing it here would let
-- every agent in a tenant read every other agent's pipeline and call notes.
-- An agent sees their own book, full stop.
create or replace function public.is_crm_supervisor()
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
                       'director'::public.user_role,
                       'manager'::public.user_role,
                       'sacco_admin'::public.user_role)
  );
$$;

revoke execute on function public.is_crm_supervisor() from public, anon;
grant  execute on function public.is_crm_supervisor() to authenticated;

comment on function public.is_crm_supervisor() is
  'True for the roles allowed to read (never write) their tenant agents CRM. Excludes sales_agent by design.';

-- Every agent belonging to the caller's tenant, as a set.
--
-- Set-returning rather than a scalar per-row lookup: written as
-- `agent_id in (select public.tenant_agent_ids())` the planner evaluates it
-- once per query instead of once per lead.
create or replace function public.tenant_agent_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id
    from public.agents a
   where a.admin_id is not null
     and a.admin_id = public.current_admin_id();
$$;

revoke execute on function public.tenant_agent_ids() from public, anon;
grant  execute on function public.tenant_agent_ids() to authenticated;

comment on function public.tenant_agent_ids() is
  'Agent ids owned by the caller tenant. NULL admin_id is excluded: an unowned agent belongs to nobody and stays super_admin-only.';

-- ---------------------------------------------------------------------------
-- 5. TRIGGERS
-- ---------------------------------------------------------------------------

-- Stamp the tenant and the author from the session, and keep the denormalised
-- contact fields on the lead honest. A client that supplied its own admin_id
-- would be choosing which tenant to write into, so it is overwritten here.
create or replace function public.crm_interactions_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  select a.admin_id into new.admin_id
    from public.agents a
   where a.id = new.agent_id;

  if tg_op = 'INSERT' then
    new.logged_by := coalesce(new.logged_by, auth.uid());
  end if;

  -- A lead-linked touch inherits the lead's name when the caller did not give
  -- one, so the timeline is readable even after the lead row is gone.
  if new.contact_name is null and new.lead_id is not null then
    select l.full_name into new.contact_name from public.leads l where l.id = new.lead_id;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_crm_interactions_stamp on public.crm_interactions;
create trigger trg_crm_interactions_stamp
  before insert or update on public.crm_interactions
  for each row execute function public.crm_interactions_stamp();

-- Recompute the lead's contact counters from the interactions that actually
-- exist, rather than incrementing: a deleted or back-dated row has to be able
-- to move last_contact_at BACKWARDS, which += cannot do.
create or replace function public.crm_interactions_sync_lead()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_lead uuid;
  old_lead uuid;
  target   uuid;
begin
  -- NEW is unassigned on DELETE and OLD on INSERT, so each is read only under
  -- the branch where it exists.
  if tg_op <> 'DELETE' then new_lead := new.lead_id; end if;
  if tg_op <> 'INSERT' then old_lead := old.lead_id; end if;

  -- An UPDATE can move a touch between leads; refresh both sides. DISTINCT
  -- because the common case is that both sides are the same lead.
  for target in select distinct t from unnest(array[new_lead, old_lead]) t
                 where t is not null
  loop

    update public.leads l
       set interaction_count     = sub.n,
           last_interaction_type = sub.last_type,
           -- Never move last_contact_at backwards past a contact recorded by
           -- some other route (the portal stamps it on stage changes too).
           -- greatest() ignores NULLs, so deleting the last interaction leaves
           -- the existing timestamp alone instead of erasing it.
           last_contact_at       = greatest(l.last_contact_at, sub.last_at),
           updated_at            = now()
      from (
        select count(*)                                              as n,
               max(i.occurred_at)                                    as last_at,
               (select i2.interaction_type::text
                  from public.crm_interactions i2
                 where i2.lead_id = target
                 order by i2.occurred_at desc, i2.created_at desc
                 limit 1)                                            as last_type
          from public.crm_interactions i
         where i.lead_id = target
      ) sub
     where l.id = target;
  end loop;

  return null;
end;
$$;

drop trigger if exists trg_crm_interactions_sync_lead on public.crm_interactions;
create trigger trg_crm_interactions_sync_lead
  after insert or update or delete on public.crm_interactions
  for each row execute function public.crm_interactions_sync_lead();

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------

alter table public.crm_interactions enable row level security;

-- ---- crm_interactions: the agent owns their own book ----

drop policy if exists "agents_select_own_interactions" on public.crm_interactions;
create policy "agents_select_own_interactions"
on public.crm_interactions for select to authenticated
using (agent_id = public.get_agent_id_for_user(auth.uid()));

drop policy if exists "agents_insert_own_interactions" on public.crm_interactions;
create policy "agents_insert_own_interactions"
on public.crm_interactions for insert to authenticated
with check (agent_id = public.get_agent_id_for_user(auth.uid()));

drop policy if exists "agents_update_own_interactions" on public.crm_interactions;
create policy "agents_update_own_interactions"
on public.crm_interactions for update to authenticated
using      (agent_id = public.get_agent_id_for_user(auth.uid()))
with check (agent_id = public.get_agent_id_for_user(auth.uid()));

drop policy if exists "agents_delete_own_interactions" on public.crm_interactions;
create policy "agents_delete_own_interactions"
on public.crm_interactions for delete to authenticated
using (agent_id = public.get_agent_id_for_user(auth.uid()));

-- ---- crm_interactions: supervisors read ----

drop policy if exists "supervisors_read_tenant_interactions" on public.crm_interactions;
create policy "supervisors_read_tenant_interactions"
on public.crm_interactions for select to authenticated
using (
  public.is_global_viewer()
  or (
    public.is_crm_supervisor()
    and agent_id in (select public.tenant_agent_ids())
  )
);

-- ---- leads: supervisors read ----
-- Additive. The four agents_*_own_leads policies are untouched, and policies
-- are OR'd, so an agent's own access is exactly what it was.

drop policy if exists "supervisors_read_tenant_leads" on public.leads;
create policy "supervisors_read_tenant_leads"
on public.leads for select to authenticated
using (
  public.is_global_viewer()
  or (
    public.is_crm_supervisor()
    and agent_id in (select public.tenant_agent_ids())
  )
);

-- ---- follow_ups: supervisors read ----
-- Without this the oversight dashboard can show a pipeline but not whether
-- anybody is actually being called back, which is the number that matters.

drop policy if exists "supervisors_read_tenant_followups" on public.follow_ups;
create policy "supervisors_read_tenant_followups"
on public.follow_ups for select to authenticated
using (
  public.is_global_viewer()
  or (
    public.is_crm_supervisor()
    and agent_id in (select public.tenant_agent_ids())
  )
);

-- ---------------------------------------------------------------------------
-- 7. GRANTS
--    RLS decides the rows; these decide who may ask at all. anon never may.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.crm_interactions to authenticated;
revoke all on public.crm_interactions from anon;

-- ---------------------------------------------------------------------------
-- 8. BACKFILL
--    Every lead already carries last_contact_at from before interactions
--    existed; interaction_count starts honest at 0 and needs no backfill. The
--    only thing worth priming is that the column defaults landed on old rows.
-- ---------------------------------------------------------------------------

update public.leads set interaction_count = 0 where interaction_count is null;

-- ---------------------------------------------------------------------------
-- 9. REALTIME
--    The publication on this project is per-table, so a table left out of it
--    simply never emits. Both the agent portal and the supervisor dashboard
--    subscribe: a call logged on a phone should appear on the laptop, and on
--    the admin's screen, without either of them refreshing.
--
--    `leads` is added here too — it was never published, so the oversight
--    dashboard's pipeline would have sat frozen until a manual refresh.
-- ---------------------------------------------------------------------------

do $$ begin
  alter publication supabase_realtime add table public.crm_interactions;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.leads;
exception when duplicate_object then null; end $$;

-- Make the new table, columns and helpers visible to PostgREST immediately
-- rather than after its next cache cycle.
notify pgrst, 'reload schema';

commit;

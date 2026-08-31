-- ===========================================================================
-- LEADS AND OPPORTUNITIES A SUPERVISOR OWNS
--
-- 20260830180000 gave administrators a CRM, and drew one boundary on purpose:
--
--     "The admin's book is the tenant's CLIENTS, not its leads. A lead belongs
--      to the agent working it and oversight over those stays read-only."
--
-- That boundary was right about AGENTS' leads and it is untouched here. What it
-- left with nowhere to go is the supervisor's OWN pipeline -- the prospect the
-- super administrator is courting themselves, the company that emailed asking
-- about the platform, the deal that never belonged to an agent because no agent
-- was ever involved. `leads.agent_id` is NOT NULL, so those simply could not be
-- written down. A super administrator could watch every pipeline in the
-- business and keep none of their own.
--
-- This closes that, using exactly the shape 20260830180000 established for
-- crm_interactions and follow_ups, because a third spelling of "who owns this
-- row" is a third set of policies to get subtly wrong:
--
--     an agent's row      -- agent_id = the agent,  admin_id from the agent
--     a supervisor's row  -- agent_id IS NULL,      admin_id = current_admin_id()
--
-- OPPORTUNITIES need no table of their own. 20260830140000 put deal_value,
-- expected_close_date and win_probability on `leads`, and
-- src/config/crmVocabulary.js marks which stages count as an opportunity: the
-- stage IS the opportunity. A supervisor who can own a lead can therefore own
-- an opportunity, price it and forecast it, with no further schema.
--
-- Five parts:
--
--   1. leads -- agent_id becomes optional; admin_id and created_by added.
--   2. Ownership constraint + the stamp trigger that fills those columns.
--   3. Indexes for the tenant's own book (every existing lead index leads on
--      agent_id, so a supervisor's query matches none of them).
--   4. RLS -- supervisors write their OWN leads, read their tenant's.
--   5. Schema reload.
--
-- Idempotent throughout and wrapped in a transaction: safe to re-run, lands
-- whole or not at all.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. COLUMNS
-- ---------------------------------------------------------------------------

alter table public.leads alter column agent_id drop not null;

alter table public.leads add column if not exists admin_id   uuid;
alter table public.leads add column if not exists created_by uuid references public.user_profiles(id) on delete set null;

comment on column public.leads.agent_id is
  'The agent working this lead, or NULL when the tenant itself owns it (an admin, director, manager or the super administrator). NULL is what makes a row the tenant own record -- the supervisor write policies key on it.';
comment on column public.leads.admin_id is
  'Tenant key, stamped by trg_leads_stamp from the agent or from the caller session. Never trusted from the client -- a supplied value would be choosing which tenant to write into.';
comment on column public.leads.created_by is
  'Who first wrote the lead down. A tenant-owned pipeline is shared between that tenant supervisors, so the author is the only record of which of them it was.';

-- Backfill the tenant from the agent that owns each existing row, BEFORE the
-- constraint below can see them.
update public.leads l
   set admin_id = a.admin_id
  from public.agents a
 where a.id = l.agent_id
   and l.admin_id is distinct from a.admin_id;

-- ---------------------------------------------------------------------------
-- 2. OWNERSHIP
--
--    Same constraint crm_interactions and follow_ups carry: a lead owned by
--    neither an agent nor a tenant is readable by nobody, counted in nothing
--    and impossible to delete through RLS. Agent rows whose agent has a NULL
--    admin_id (the drift noted in 20260820140000) still satisfy it through
--    agent_id, so the backfill above cannot lock anybody out.
-- ---------------------------------------------------------------------------

alter table public.leads drop constraint if exists leads_owner_present;
alter table public.leads add constraint leads_owner_present
  check (agent_id is not null or admin_id is not null);

-- Stamp the tenant and the author from the session.
--
-- The auth.uid() guard keeps service_role paths working: with no session
-- current_admin_id() is NULL, and blindly assigning it would erase an admin_id
-- a trusted backend supplied on purpose. register_lead_from_share_link
-- (20260813140000) inserts agent-owned leads and is unaffected either way --
-- it goes down the agent branch and gets the same admin_id it always had.
--
-- Postgres fires same-timing triggers in name order, so this runs before
-- trg_leads_stamp_lost (20260828140000). The two share no column.
create or replace function public.leads_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.agent_id is not null then
    select a.admin_id into new.admin_id
      from public.agents a
     where a.id = new.agent_id;
  elsif auth.uid() is not null then
    new.admin_id := public.current_admin_id();
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_leads_stamp on public.leads;
create trigger trg_leads_stamp
  before insert or update on public.leads
  for each row execute function public.leads_stamp();

comment on function public.leads_stamp() is
  'Derives leads.admin_id from the agent, or from the caller session for a tenant-owned lead. The ownership columns are never the client to choose.';

-- ---------------------------------------------------------------------------
-- 3. INDEXES
--
--    Every existing lead index is partial on or leading with agent_id
--    (idx_leads_agent_id, idx_leads_agent_expected_close,
--    idx_leads_agent_deal_value, idx_leads_lost_reason), so a supervisor's
--    "my own book" query matches none of them. These mirror that set for the
--    rows with no agent at all.
-- ---------------------------------------------------------------------------

create index if not exists idx_leads_tenant_own
  on public.leads (admin_id, created_at desc)
  where agent_id is null;

create index if not exists idx_leads_admin_expected_close
  on public.leads (admin_id, expected_close_date)
  where agent_id is null and stage <> 'closed'::public.lead_stage;

create index if not exists idx_leads_admin_deal_value
  on public.leads (admin_id, deal_value desc)
  where agent_id is null and deal_value is not null and stage <> 'closed'::public.lead_stage;

-- ---------------------------------------------------------------------------
-- 4. RLS
--
--    READ widens by exactly one disjunct: the tenant's own rows, which have no
--    agent to match on. The four agents_*_own_leads policies stay untouched and
--    policies are OR'd, so an agent's access to their own leads is unchanged.
--
--    WRITE is new, and every policy carries `agent_id is null`. That single
--    clause preserves 20260820120000's boundary: a supervisor creates, works
--    and removes the TENANT'S OWN leads and still cannot touch a row an agent
--    wrote. It is the same clause the interaction and follow-up policies use,
--    deliberately -- one rule, three tables.
--
--    The tenant's pipeline is shared between that tenant's supervisors rather
--    than private per author, matching the shared diary in 20260830180000: a
--    manager must be able to pick up the prospect the admin logged, and
--    created_by keeps the trail of who started it. is_crm_supervisor() excludes
--    sales_agent by design, so this grants an agent nothing.
-- ---------------------------------------------------------------------------

drop policy if exists "supervisors_read_tenant_leads" on public.leads;
create policy "supervisors_read_tenant_leads"
on public.leads for select to authenticated
using (
  public.is_crm_supervisor()
  and (
    agent_id in (select public.tenant_agent_ids())
    or (agent_id is null and admin_id is not null and admin_id = public.current_admin_id())
  )
);

drop policy if exists "supervisors_insert_own_leads" on public.leads;
create policy "supervisors_insert_own_leads"
on public.leads for insert to authenticated
with check (
  public.is_crm_supervisor()
  and agent_id is null
  and admin_id is not null
  and admin_id = public.current_admin_id()
);

drop policy if exists "supervisors_update_own_leads" on public.leads;
create policy "supervisors_update_own_leads"
on public.leads for update to authenticated
using (
  public.is_crm_supervisor()
  and agent_id is null
  and admin_id is not null
  and admin_id = public.current_admin_id()
)
with check (
  public.is_crm_supervisor()
  and agent_id is null
  and admin_id is not null
  and admin_id = public.current_admin_id()
);

drop policy if exists "supervisors_delete_own_leads" on public.leads;
create policy "supervisors_delete_own_leads"
on public.leads for delete to authenticated
using (
  public.is_crm_supervisor()
  and agent_id is null
  and admin_id is not null
  and admin_id = public.current_admin_id()
);

-- ---------------------------------------------------------------------------
-- 5. REALTIME
--
--    leads is already in supabase_realtime (20260820120000), so a lead created
--    on a phone reaches the laptop without a manual refresh. created_by is
--    filled only going forward: nobody recorded who wrote the historical rows,
--    and the agent that owns them is already the answer for those.
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';

commit;

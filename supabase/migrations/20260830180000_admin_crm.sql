-- ===========================================================================
-- CRM FOR ADMINISTRATORS
--
-- The CRM this project has is an AGENT'S CRM that an admin may watch. Every
-- write policy on crm_interactions and follow_ups reads
--
--     agent_id = public.get_agent_id_for_user(auth.uid())
--
-- and an admin has no row in public.agents, so get_agent_id_for_user returns
-- NULL and every comparison collapses to NULL -- false. An administrator can
-- therefore READ their agents' pipeline (20260820120000) and cannot record a
-- single thing themselves. That is the gap this closes.
--
-- It matters because the admin is not a spectator on the customer
-- relationship. They are the one who takes the escalation call, who chases the
-- client whose instalment is late, who visits the account nobody has spoken to
-- in two months. Today all of that lands in clients.notes -- one text column
-- the next edit overwrites -- which is exactly the hole crm_interactions was
-- created to fill for agents.
--
-- WHAT AN ADMIN'S CRM IS ABOUT: `clients`, not `leads`.
--
--   A lead belongs to the agent working it, and 20260820120000 was deliberate
--   that oversight is read-only -- an admin does not edit an agent's lead out
--   from under them. That boundary is UNCHANGED here. The admin's own book is
--   the tenant's CLIENTS, which they already own outright
--   (tenant_manage_clients, 20260817120000), plus contacts who are not yet a
--   row anywhere (crm_interactions.contact_name has always allowed that).
--
-- HOW AN ADMIN-OWNED ROW IS SPELLED: agent_id IS NULL, admin_id = the tenant.
--
--   Rather than invent an owner_type column, ownership is read off the two
--   columns already there. `agent_id IS NULL` means nobody's agent wrote it, so
--   it is the tenant's own -- and the write policies below are scoped to
--   exactly that shape. An agent's row is never writable by a supervisor,
--   because every supervisor write policy carries `agent_id is null`.
--
-- Five parts:
--
--   1. crm_interactions -- agent_id becomes optional; the stamp trigger learns
--      to tag an admin-authored row with the caller's tenant.
--   2. follow_ups -- the same, plus client_id (the diary could only ever point
--      at a lead) and admin_id / created_by.
--   3. clients -- the contact counters `leads` has had since 20260820120000, so
--      "last spoken to 40 days ago" costs no join on a client list.
--   4. RLS -- supervisors write their OWN rows, read everything in their tenant.
--   5. Realtime + backfill.
--
-- Idempotent throughout and wrapped in a transaction: safe to re-run, lands
-- whole or not at all.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. crm_interactions: a contact does not have to come from an agent
-- ---------------------------------------------------------------------------

alter table public.crm_interactions alter column agent_id drop not null;

-- ...but it does have to belong to SOMEBODY. Without this, a row with both
-- owner columns NULL is legal and belongs to no tenant at all -- readable by
-- nobody, counted in nothing, and impossible to delete through RLS.
--
-- admin_id is set by the stamp trigger below, which is BEFORE INSERT, so it is
-- populated by the time this constraint is checked.
alter table public.crm_interactions drop constraint if exists crm_interactions_owner_present;
alter table public.crm_interactions add constraint crm_interactions_owner_present
  check (agent_id is not null or admin_id is not null);

comment on column public.crm_interactions.agent_id is
  'The agent who made contact, or NULL when the tenant itself did (an admin, director or manager). NULL is what makes a row the tenant own record -- the supervisor write policies key on it.';

-- Stamp the tenant and the author from the session.
--
-- Unchanged for agent rows: admin_id is taken from the agent, never from the
-- caller, because a client that supplied its own admin_id would be choosing
-- which tenant to write into. Admin-authored rows get the same treatment from
-- the other direction -- current_admin_id() is derived from the session, so it
-- cannot be forged either.
--
-- The auth.uid() guard keeps service_role imports working: with no session
-- current_admin_id() is NULL, and blindly assigning it would erase an admin_id
-- a trusted backend supplied on purpose.
create or replace function public.crm_interactions_stamp()
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
    new.logged_by := coalesce(new.logged_by, auth.uid());
  end if;

  -- A linked touch inherits the name it is about when the caller did not give
  -- one, so the timeline is readable even after the lead or client row is gone.
  if new.contact_name is null and new.lead_id is not null then
    select l.full_name into new.contact_name from public.leads l where l.id = new.lead_id;
  end if;

  if new.contact_name is null and new.client_id is not null then
    select c.full_name into new.contact_name from public.clients c where c.id = new.client_id;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- The admin's own timeline is read by tenant, not by agent, so it needs an
-- index that is selective on the rows which have no agent at all.
create index if not exists idx_crm_interactions_tenant_own
  on public.crm_interactions (admin_id, occurred_at desc)
  where agent_id is null;

-- ---------------------------------------------------------------------------
-- 2. follow_ups: a diary the tenant can also write in
--
--    Two gaps, not one. The table could not be written by an admin (agent_id
--    NOT NULL), and it could not point at a CLIENT even for an agent -- only
--    lead_id existed. So "ring Mrs Otieno about her arrears" had nowhere to go:
--    she stopped being a lead the day she converted.
-- ---------------------------------------------------------------------------

alter table public.follow_ups alter column agent_id drop not null;

alter table public.follow_ups add column if not exists admin_id   uuid;
alter table public.follow_ups add column if not exists client_id  uuid references public.clients(id) on delete set null;
alter table public.follow_ups add column if not exists created_by uuid references public.user_profiles(id) on delete set null;

comment on column public.follow_ups.admin_id is
  'Tenant key, stamped by trg_follow_ups_stamp from the agent or from the caller session. Never trusted from the client.';
comment on column public.follow_ups.client_id is
  'The client this appointment is about. Separate from lead_id because a converted customer is no longer a lead but is still somebody you ring.';
comment on column public.follow_ups.created_by is
  'Who booked it. An agent row is authored by the agent; a tenant row can be booked by the admin, a director or a manager, and the diary is shared between them.';

-- Backfill the tenant onto every row that already exists, from the agent that
-- owns it. Done before the constraint so nothing existing can violate it.
update public.follow_ups f
   set admin_id = a.admin_id
  from public.agents a
 where a.id = f.agent_id
   and f.admin_id is distinct from a.admin_id;

-- Same reasoning as crm_interactions_owner_present: an appointment owned by
-- neither an agent nor a tenant is unreachable. Agent rows whose agent has a
-- NULL admin_id (the drift noted in 20260820140000) still satisfy this through
-- their agent_id, so the backfill above cannot lock anybody out.
alter table public.follow_ups drop constraint if exists follow_ups_owner_present;
alter table public.follow_ups add constraint follow_ups_owner_present
  check (agent_id is not null or admin_id is not null);

-- Stamping is a SEPARATE trigger from follow_ups_normalize rather than an edit
-- to it, for two reasons: normalize is plain plpgsql with no search_path and
-- reading public.agents from it would run under the caller's RLS; and keeping
-- them apart means the reminder defaults and the ownership rules can be
-- re-deployed independently. Postgres fires same-timing triggers in name
-- order, so trg_follow_ups_normalize runs first; the two touch no common
-- column.
create or replace function public.follow_ups_stamp()
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

  -- lead_name is the denormalised label the reminder email reads. It has always
  -- been filled from the lead; a client-linked appointment fills it the same
  -- way so the email can say who it is about.
  if nullif(btrim(coalesce(new.lead_name, '')), '') is null then
    if new.lead_id is not null then
      select l.full_name into new.lead_name from public.leads l where l.id = new.lead_id;
    elsif new.client_id is not null then
      select c.full_name into new.lead_name from public.clients c where c.id = new.client_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_follow_ups_stamp on public.follow_ups;
create trigger trg_follow_ups_stamp
  before insert or update on public.follow_ups
  for each row execute function public.follow_ups_stamp();

create index if not exists idx_follow_ups_admin_due
  on public.follow_ups (admin_id, scheduled_at)
  where agent_id is null;

create index if not exists idx_follow_ups_client
  on public.follow_ups (client_id, scheduled_at desc)
  where client_id is not null;

-- ---------------------------------------------------------------------------
-- 3. clients: the contact counters leads has had since 20260820120000
--
--    "Nobody has spoken to this customer since March" is the single most
--    useful thing an admin's client list can say, and answering it per row
--    meant a correlated subquery over crm_interactions. These three columns are
--    kept honest by a trigger, exactly like the ones on leads.
-- ---------------------------------------------------------------------------

alter table public.clients add column if not exists interaction_count     integer not null default 0;
alter table public.clients add column if not exists last_contact_at       timestamptz;
alter table public.clients add column if not exists last_interaction_type text;

comment on column public.clients.last_contact_at is
  'When this customer was last contacted, from crm_interactions. Kept current by trg_crm_interactions_sync_client. NULL means never -- which is the number an admin most needs to see.';

-- Recomputed from the rows that exist rather than incremented, for the same
-- reason the leads version is: a deleted or back-dated touch has to be able to
-- move last_contact_at BACKWARDS, and += cannot do that.
--
-- Unlike the leads sync this assigns last_contact_at outright instead of
-- greatest()-ing it: on leads the column predates interactions and is also
-- written by stage changes, so it carries history a recompute would erase. On
-- clients the column is introduced here and crm_interactions is its only
-- writer, so the interactions ARE the truth.
create or replace function public.crm_interactions_sync_client()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_client uuid;
  old_client uuid;
  target     uuid;
begin
  if tg_op <> 'DELETE' then new_client := new.client_id; end if;
  if tg_op <> 'INSERT' then old_client := old.client_id; end if;

  for target in select distinct t from unnest(array[new_client, old_client]) t
                 where t is not null
  loop
    update public.clients c
       set interaction_count     = sub.n,
           last_contact_at       = sub.last_at,
           last_interaction_type = sub.last_type,
           updated_at            = now()
      from (
        select count(*)            as n,
               max(i.occurred_at)  as last_at,
               (select i2.interaction_type::text
                  from public.crm_interactions i2
                 where i2.client_id = target
                 order by i2.occurred_at desc, i2.created_at desc
                 limit 1)          as last_type
          from public.crm_interactions i
         where i.client_id = target
      ) sub
     where c.id = target;
  end loop;

  return null;
end;
$$;

drop trigger if exists trg_crm_interactions_sync_client on public.crm_interactions;
create trigger trg_crm_interactions_sync_client
  after insert or update or delete on public.crm_interactions
  for each row execute function public.crm_interactions_sync_client();

-- ---------------------------------------------------------------------------
-- 4. RLS
--
--    READ is unchanged in spirit and widened only to include the tenant's own
--    rows -- a supervisor already saw every agent row in their tenant, and an
--    admin-authored row has no agent to match on.
--
--    WRITE is new, and every policy carries `agent_id is null`. That single
--    clause is what preserves 20260820120000's boundary: a supervisor can
--    create, correct and remove the TENANT'S OWN records and can still not
--    touch a single row an agent wrote.
--
--    The tenant's book is shared between that tenant's supervisors (admin,
--    director, manager, sacco_admin) rather than private per author. A shared
--    diary is the point -- a manager must be able to complete the appointment
--    the admin booked -- and logged_by / created_by keep the trail of who did
--    what. These are people the admin appointed; agents are not among them
--    (is_crm_supervisor excludes sales_agent by design).
-- ---------------------------------------------------------------------------

-- ---- crm_interactions ----

drop policy if exists "supervisors_read_tenant_interactions" on public.crm_interactions;
create policy "supervisors_read_tenant_interactions"
on public.crm_interactions for select to authenticated
using (
  public.is_crm_supervisor()
  and (
    agent_id in (select public.tenant_agent_ids())
    or (agent_id is null and admin_id is not null and admin_id = public.current_admin_id())
  )
);

drop policy if exists "supervisors_insert_own_interactions" on public.crm_interactions;
create policy "supervisors_insert_own_interactions"
on public.crm_interactions for insert to authenticated
with check (
  public.is_crm_supervisor()
  and agent_id is null
  and admin_id is not null
  and admin_id = public.current_admin_id()
);

drop policy if exists "supervisors_update_own_interactions" on public.crm_interactions;
create policy "supervisors_update_own_interactions"
on public.crm_interactions for update to authenticated
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

drop policy if exists "supervisors_delete_own_interactions" on public.crm_interactions;
create policy "supervisors_delete_own_interactions"
on public.crm_interactions for delete to authenticated
using (
  public.is_crm_supervisor()
  and agent_id is null
  and admin_id is not null
  and admin_id = public.current_admin_id()
);

-- ---- follow_ups ----

drop policy if exists "supervisors_read_tenant_followups" on public.follow_ups;
create policy "supervisors_read_tenant_followups"
on public.follow_ups for select to authenticated
using (
  public.is_crm_supervisor()
  and (
    agent_id in (select public.tenant_agent_ids())
    or (agent_id is null and admin_id is not null and admin_id = public.current_admin_id())
  )
);

drop policy if exists "supervisors_insert_own_followups" on public.follow_ups;
create policy "supervisors_insert_own_followups"
on public.follow_ups for insert to authenticated
with check (
  public.is_crm_supervisor()
  and agent_id is null
  and admin_id is not null
  and admin_id = public.current_admin_id()
);

drop policy if exists "supervisors_update_own_followups" on public.follow_ups;
create policy "supervisors_update_own_followups"
on public.follow_ups for update to authenticated
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

drop policy if exists "supervisors_delete_own_followups" on public.follow_ups;
create policy "supervisors_delete_own_followups"
on public.follow_ups for delete to authenticated
using (
  public.is_crm_supervisor()
  and agent_id is null
  and admin_id is not null
  and admin_id = public.current_admin_id()
);

-- ---------------------------------------------------------------------------
-- 5. BACKFILL + REALTIME
-- ---------------------------------------------------------------------------

-- Clients that agents have already been logging contact against get their
-- counters primed, so the new columns do not read as "never contacted" for
-- customers with years of history behind them.
update public.clients c
   set interaction_count     = sub.n,
       last_contact_at       = sub.last_at,
       last_interaction_type = sub.last_type
  from (
    select i.client_id,
           count(*)           as n,
           max(i.occurred_at) as last_at,
           (array_agg(i.interaction_type::text order by i.occurred_at desc, i.created_at desc))[1] as last_type
      from public.crm_interactions i
     where i.client_id is not null
     group by i.client_id
  ) sub
 where c.id = sub.client_id
   and c.interaction_count is distinct from sub.n;

-- follow_ups was never published, so the admin's diary would have sat frozen
-- until a manual refresh -- and an appointment completed on a phone should
-- disappear from the laptop. crm_interactions and clients are already in the
-- publication (20260820120000 / the base schema).
do $$ begin
  alter publication supabase_realtime add table public.follow_ups;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';

commit;

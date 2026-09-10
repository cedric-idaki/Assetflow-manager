-- ===========================================================================
-- CLIENT INSTALLATION & ONBOARDING TRACKING
--
-- WHY THIS EXISTS
--
-- Every tenant that signs up is charged a one-time "Installation & onboarding"
-- fee -- KES 4,000, line 5 of buildSystemInvoice() in src/config/systemBilling.js
-- and INSTALLATION_FEE in both plan catalogues. It is the only line on the
-- platform's invoice that bills for WORK RATHER THAN ACCESS, and it was the one
-- line nothing in this system could account for. There was no record that an
-- installation had been scheduled, no record of who was doing it, no date it
-- happened on, and no moment at which anybody declared it finished. The money
-- was taken at registration and the delivery lived in somebody's head.
--
-- So a tenant sitting half-configured for three weeks looked exactly like a
-- tenant that was up and running: both are a `user_profiles` row with
-- `is_active = true` and a paid subscription. This migration makes the
-- difference a fact in the database.
--
-- WHAT IS TRACKED
--
--   1. client_onboardings       -- ONE ROW PER TENANT, no exceptions. Carries
--                                  the four things asked of it: installation
--                                  status, the responsible person, the
--                                  installation date, and completion.
--   2. client_onboarding_steps  -- the process itself, as a checklist. "Done"
--                                  is not a single switch somebody flips; it is
--                                  eleven steps that each have an owner, a
--                                  date and a note. This is what turns
--                                  "completion status" into something a
--                                  handover dispute can be settled with.
--
-- ONE ROW PER TENANT, SEEDED BY THE DATABASE
--
--   The row is created by a trigger on user_profiles, not by the registration
--   screen. Registration is a multi-step client-side flow that can fail at any
--   of them (see admin-registration/index.jsx: the auth user is created first
--   and the subscription last), and a tenant whose browser died at step 4 is
--   PRECISELY the tenant an installer needs to see. Seeding from the trigger
--   also means the backfill below and every future signup take the same path.
--
--   entity_type is deliberately NOT stored. At the instant the trigger fires,
--   the company_profiles / saccos row does not exist yet -- the registration
--   flow writes user_profiles at step 2 and the tenant record at step 3 -- so
--   anything captured here would be a guess. client_onboarding_board() resolves
--   the name and the type by joining, every time it is called.
--
-- WHO SEES IT
--
--   Writing is the platform's job: is_global_viewer() (super_admin) only.
--   Reading is also the TENANT'S right -- a client who paid for an installation
--   may see its status and who is handling it -- so the SELECT policy admits
--   the tenant's own staff. They get no write of any kind: an onboarding a
--   client can mark complete is not evidence of anything.
--
-- WHAT THIS DOES NOT DO
--
--   It does not touch billing. Nothing here refunds, prorates or gates the
--   installation fee, and no invoice reads these tables. Whether an unfinished
--   installation should suspend a tenant is a commercial decision, and the
--   fail-open reasoning of tenant_modules (20260822150000) applies with more
--   force here: a client already paying must never lose their portal because a
--   checklist row was never ticked.
--
--   It keeps no separate history table. The step rows carry their own trail
--   (who ticked what, when, with what note) and audit_logs carries the rest.
--
-- Idempotent throughout and wrapped in a transaction: safe to re-run, lands
-- whole or not at all.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. THE ONBOARDING RECORD
--
--    status is TEXT with a CHECK, not an enum, for the same reason
--    tenant_modules.module_key is: adding a seventh state should be one line
--    here and one line in src/config/clientOnboarding.js, not an ALTER TYPE
--    that every dependent row has to be rewritten for.
-- ---------------------------------------------------------------------------
create table if not exists public.client_onboardings (
  id                uuid primary key default gen_random_uuid(),

  -- The tenant this onboarding is for: a user_profiles row with role
  -- 'admin' or 'sacco_admin'. UNIQUE -- an account is onboarded once.
  admin_id          uuid not null,

  -- not_started | scheduled | in_progress | on_hold | completed | cancelled
  status            text not null default 'not_started',

  -- WHO IS RESPONSIBLE. Nullable on purpose: an unassigned installation is a
  -- real and important state, and the board surfaces those rather than hiding
  -- them behind a placeholder name.
  assigned_to       uuid,
  assigned_at       timestamptz,
  assigned_by       uuid,

  -- THE DATES. Two of them, because they answer different questions:
  --   scheduled_date    -- what the client was promised
  --   installation_date -- what actually happened
  -- Collapsing them loses every slipped booking, which is the number an ops
  -- lead actually wants.
  scheduled_date    date,
  installation_date date,

  started_at        timestamptz,
  completed_at      timestamptz,
  completed_by      uuid,

  on_hold_reason    text,
  notes             text,

  -- Maintained by trigger from client_onboarding_steps, so a list of two
  -- hundred tenants costs one query instead of two hundred and one.
  steps_total       integer not null default 0,
  steps_done        integer not null default 0,
  -- ROUNDED, not truncated, and in numeric rather than integer arithmetic:
  -- progressOf() in src/config/clientOnboarding.js computes the same fraction
  -- with Math.round, and integer division here would put the two one percent
  -- apart on six elevenths of the possible checklists.
  progress_pct      integer generated always as (
                      case when steps_total > 0
                           then round((steps_done::numeric * 100) / steps_total)::integer
                           else 0 end
                    ) stored,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

do $$
begin
  alter table public.client_onboardings
    add constraint client_onboardings_status_chk
    check (status in ('not_started', 'scheduled', 'in_progress',
                      'on_hold', 'completed', 'cancelled'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.client_onboardings
    add constraint client_onboardings_admin_fk
    foreign key (admin_id) references public.user_profiles(id) on delete cascade;
exception when duplicate_object then null;
end $$;

-- assigned_to is ON DELETE SET NULL, not CASCADE: a staff member leaving must
-- not delete the record of the installation they were responsible for.
do $$
begin
  alter table public.client_onboardings
    add constraint client_onboardings_assigned_fk
    foreign key (assigned_to) references public.user_profiles(id) on delete set null;
exception when duplicate_object then null;
end $$;

create unique index if not exists uq_client_onboardings_admin
  on public.client_onboardings (admin_id);
create index if not exists idx_client_onboardings_status
  on public.client_onboardings (status);
create index if not exists idx_client_onboardings_assigned
  on public.client_onboardings (assigned_to) where assigned_to is not null;
create index if not exists idx_client_onboardings_install_date
  on public.client_onboardings (installation_date desc nulls last);
create index if not exists idx_client_onboardings_scheduled
  on public.client_onboardings (scheduled_date) where scheduled_date is not null;

comment on table public.client_onboardings is
  'One row per tenant: the installation and onboarding the platform owes them. Written by super admins, readable by the tenant.';

-- ---------------------------------------------------------------------------
-- 2. THE PROCESS, AS STEPS
--
--    label is stored on the row rather than looked up from a catalogue so that
--    renaming a step next year does not silently rewrite what a completed
--    onboarding says was delivered last year.
-- ---------------------------------------------------------------------------
create table if not exists public.client_onboarding_steps (
  id             uuid primary key default gen_random_uuid(),
  onboarding_id  uuid not null references public.client_onboardings(id) on delete cascade,

  step_key       text not null,
  label          text not null,
  phase          text,                     -- prepare | install | enable | close
  sort_order     integer not null default 0,

  -- pending | in_progress | done | skipped | blocked
  status         text not null default 'pending',

  owner_id       uuid,                     -- who is doing THIS step, when it is
                                           -- not the person who owns the job
  due_date       date,
  completed_at   timestamptz,
  completed_by   uuid,
  notes          text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

do $$
begin
  alter table public.client_onboarding_steps
    add constraint client_onboarding_steps_status_chk
    check (status in ('pending', 'in_progress', 'done', 'skipped', 'blocked'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.client_onboarding_steps
    add constraint client_onboarding_steps_owner_fk
    foreign key (owner_id) references public.user_profiles(id) on delete set null;
exception when duplicate_object then null;
end $$;

create unique index if not exists uq_client_onboarding_step
  on public.client_onboarding_steps (onboarding_id, step_key);
create index if not exists idx_client_onboarding_steps_parent
  on public.client_onboarding_steps (onboarding_id, sort_order);
create index if not exists idx_client_onboarding_steps_owner
  on public.client_onboarding_steps (owner_id) where owner_id is not null;

comment on table public.client_onboarding_steps is
  'The installation/onboarding checklist for one tenant. Labels are copied, not referenced, so a completed record keeps saying what was delivered.';

-- ---------------------------------------------------------------------------
-- 3. THE DEFAULT CHECKLIST
--
--    Mirrored by ONBOARDING_STEPS in src/config/clientOnboarding.js, which is
--    what the UI groups and labels by. Change one, change the other -- the keys
--    are the join between them.
--
--    'installation' is the step the invoice line is named after; it is not the
--    whole job, which is exactly why the rest are listed beside it.
-- ---------------------------------------------------------------------------
create or replace function public.client_onboarding_default_steps()
returns table (step_key text, label text, phase text, sort_order integer)
language sql
immutable
as $$
  select * from (values
    ('kickoff_call',    'Kickoff call with the client',              'prepare', 10),
    ('requirements',    'Requirements and opening data collected',   'prepare', 20),
    ('account_setup',   'Portal account and modules configured',     'install', 30),
    ('branding',        'Company branding and documents uploaded',   'install', 40),
    ('data_migration',  'Opening balances and records imported',     'install', 50),
    ('payment_channel', 'Payment channel (M-Pesa) configured',       'install', 60),
    ('installation',    'System installed and verified on site',     'install', 70),
    ('user_accounts',   'Staff user accounts created',               'enable',  80),
    ('training',        'Staff training delivered',                  'enable',  90),
    ('acceptance',      'Client acceptance walkthrough signed off',  'close',  100),
    ('handover',        'Handover pack and support contacts issued', 'close',  110)
  ) as t(step_key, label, phase, sort_order);
$$;

comment on function public.client_onboarding_default_steps() is
  'The shipped installation/onboarding checklist. Keys match ONBOARDING_STEPS in src/config/clientOnboarding.js.';

-- ---------------------------------------------------------------------------
-- 4. SEED ONE TENANT
--
--    Idempotent in both halves: the record is created once, and the steps are
--    topped up rather than replaced. Adding a twelfth step to the catalogue
--    above and re-running this hands every in-flight onboarding the new step
--    without disturbing what is already ticked.
--
--    Internal: no role holds EXECUTE. It runs from the trigger and the backfill.
-- ---------------------------------------------------------------------------
create or replace function public.client_onboarding_ensure(p_admin_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_admin_id is null then
    return null;
  end if;

  insert into public.client_onboardings (admin_id)
  values (p_admin_id)
  on conflict (admin_id) do nothing;

  select id into v_id from public.client_onboardings where admin_id = p_admin_id;
  if v_id is null then
    return null;
  end if;

  insert into public.client_onboarding_steps (onboarding_id, step_key, label, phase, sort_order)
  select v_id, d.step_key, d.label, d.phase, d.sort_order
    from public.client_onboarding_default_steps() d
  on conflict (onboarding_id, step_key) do nothing;

  return v_id;
end;
$$;

revoke all on function public.client_onboarding_ensure(uuid) from public, anon, authenticated;

comment on function public.client_onboarding_ensure(uuid) is
  'Idempotently create a tenant onboarding record and top up its checklist. Internal: called by the seeding trigger and the backfill.';

-- ---------------------------------------------------------------------------
-- 5. SEED EVERY TENANT, FOREVER
--
--    Fires on the profile, not on registration, so an account created by any
--    route -- the registration screen, an agent's CreateCompanyModal, a support
--    fix applied by hand -- gets a record.
--
--    A tenant is a profile whose role owns a tenancy and which belongs to no
--    other tenant. `admin_id = id` is admitted alongside NULL because
--    current_admin_id() coalesces a missing admin_id to the user's own id, and
--    some rows have been written the second way (the admin_id drift the staff
--    activity report exposed).
-- ---------------------------------------------------------------------------
create or replace function public.client_onboarding_seed_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role in ('admin'::public.user_role, 'sacco_admin'::public.user_role)
     and (new.admin_id is null or new.admin_id = new.id) then
    perform public.client_onboarding_ensure(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists client_onboarding_seed_tenant on public.user_profiles;
create trigger client_onboarding_seed_tenant
  after insert or update of role, admin_id on public.user_profiles
  for each row execute function public.client_onboarding_seed_tenant();

-- ---------------------------------------------------------------------------
-- 6. BACKFILL THE TENANTS ALREADY HERE
--
--    Every one of them was charged for an installation. They start
--    'not_started' with an untouched checklist rather than being assumed
--    complete: a record that claims work was done when nobody knows is worse
--    than an honest blank, and marking a live tenant complete is one click.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select p.id
      from public.user_profiles p
     where p.role in ('admin'::public.user_role, 'sacco_admin'::public.user_role)
       and (p.admin_id is null or p.admin_id = p.id)
  loop
    perform public.client_onboarding_ensure(r.id);
    n := n + 1;
  end loop;
  raise notice 'client onboarding: ensured records for % tenant(s)', n;
end $$;

-- ---------------------------------------------------------------------------
-- 7. KEEP THE DERIVED FACTS HONEST
--
--    Everything below exists so that no writer -- this app, a support script,
--    a future screen -- can leave the record saying something untrue.
-- ---------------------------------------------------------------------------

-- 7a. Assignment and completion stamps.
--
--     A status of 'completed' with no completed_at is the failure mode this
--     guards: without it the completion date is optional in every form that
--     ever touches the row, and forms lose optional fields. Moving the status
--     BACK off completed clears the stamp, for the same reason lost_at is
--     cleared when a lead stops being lost -- a stale completion date is a lie
--     that survives the correction.
create or replace function public.client_onboarding_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();

  -- Responsible person changed -> record when, and by whom.
  if tg_op = 'INSERT' then
    if new.assigned_to is not null then
      new.assigned_at := coalesce(new.assigned_at, now());
      new.assigned_by := coalesce(new.assigned_by, auth.uid());
    end if;
  elsif new.assigned_to is distinct from old.assigned_to then
    if new.assigned_to is null then
      new.assigned_at := null;
      new.assigned_by := null;
    else
      new.assigned_at := now();
      new.assigned_by := auth.uid();
    end if;
  end if;

  -- Work has begun.
  if new.status in ('in_progress', 'completed') then
    new.started_at := coalesce(new.started_at, now());
  end if;

  -- Completion. The OLD read sits inside its own IF rather than beside a
  -- `tg_op = 'UPDATE'` conjunct: PostgreSQL does not promise to evaluate AND
  -- left to right, and OLD on an INSERT is an unassigned record, not a null.
  if new.status = 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
    new.completed_by := coalesce(new.completed_by, auth.uid());
    -- An installation that is complete happened on a day. Prefer the day it
    -- was booked for over today: sign-off is routinely a few days late, and
    -- the booked date is the one the client's paperwork carries.
    new.installation_date := coalesce(new.installation_date, new.scheduled_date, current_date);
  elsif tg_op = 'UPDATE' then
    if old.status = 'completed' then
      new.completed_at := null;
      new.completed_by := null;
    end if;
  end if;

  -- A reason only means anything while the job is actually held.
  if new.status <> 'on_hold' then
    new.on_hold_reason := null;
  end if;

  return new;
end;
$$;

drop trigger if exists client_onboarding_stamp on public.client_onboardings;
create trigger client_onboarding_stamp
  before insert or update on public.client_onboardings
  for each row execute function public.client_onboarding_stamp();

-- 7b. Step stamps.
create or replace function public.client_onboarding_step_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();

  if new.status = 'done' then
    new.completed_at := coalesce(new.completed_at, now());
    new.completed_by := coalesce(new.completed_by, auth.uid());
  elsif tg_op = 'UPDATE' then
    -- Un-ticking a step drops its completion stamp with it, so a re-opened
    -- step cannot keep reporting a date the work was not finished on.
    if old.status = 'done' then
      new.completed_at := null;
      new.completed_by := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists client_onboarding_step_stamp on public.client_onboarding_steps;
create trigger client_onboarding_step_stamp
  before insert or update on public.client_onboarding_steps
  for each row execute function public.client_onboarding_step_stamp();

-- 7c. The parent's counters.
--
--     'skipped' counts as settled, not as done: a step that does not apply to
--     this client must not hold the progress bar below 100%, and must not be
--     reported as work performed either. steps_total therefore counts the
--     APPLICABLE steps, and a skipped one drops out of both sides.
create or replace function public.client_onboarding_recount()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent uuid;
  v_total  integer;
  v_done   integer;
begin
  -- Branched, not coalesce(new.x, old.x): on a DELETE, NEW is an unassigned
  -- record and reading a field of it raises rather than returning null.
  if tg_op = 'DELETE' then
    v_parent := old.onboarding_id;
  else
    v_parent := new.onboarding_id;
  end if;

  select count(*) filter (where s.status <> 'skipped'),
         count(*) filter (where s.status = 'done')
    into v_total, v_done
    from public.client_onboarding_steps s
   where s.onboarding_id = v_parent;

  update public.client_onboardings o
     set steps_total = coalesce(v_total, 0),
         steps_done  = coalesce(v_done, 0),
         -- Ticking the first step on a record still claiming 'not_started' is
         -- the commonest way this table would go stale. Nothing else is
         -- inferred: completion stays a deliberate act by a human.
         status = case when o.status = 'not_started' and coalesce(v_done, 0) > 0
                       then 'in_progress' else o.status end
   where o.id = v_parent;

  return null;
end;
$$;

drop trigger if exists client_onboarding_recount on public.client_onboarding_steps;
create trigger client_onboarding_recount
  after insert or delete or update of status on public.client_onboarding_steps
  for each row execute function public.client_onboarding_recount();

-- Bring the counters up to date for the rows the backfill just created.
update public.client_onboardings o
   set steps_total = c.total,
       steps_done  = c.done
  from (
    select s.onboarding_id,
           count(*) filter (where s.status <> 'skipped') as total,
           count(*) filter (where s.status = 'done')     as done
      from public.client_onboarding_steps s
     group by s.onboarding_id
  ) c
 where c.onboarding_id = o.id
   and (o.steps_total, o.steps_done) is distinct from (c.total, c.done);

-- ---------------------------------------------------------------------------
-- 8. RLS AND GRANTS
--
--    The platform writes; the tenant reads its own. Grants are revoked before
--    being handed back because Supabase's default privileges give every new
--    table in `public` ALL to anon and authenticated -- a bare GRANT SELECT
--    would only add to a grant of everything, and RLS would then be the only
--    thing standing between a client and their own completion date.
-- ---------------------------------------------------------------------------
alter table public.client_onboardings      enable row level security;
alter table public.client_onboarding_steps enable row level security;

drop policy if exists "onboarding_read" on public.client_onboardings;
create policy "onboarding_read"
on public.client_onboardings for select to authenticated
using (
  public.is_global_viewer()
  or (admin_id = public.current_admin_id() and public.is_staff_member())
);

drop policy if exists "onboarding_platform_insert" on public.client_onboardings;
create policy "onboarding_platform_insert"
on public.client_onboardings for insert to authenticated
with check (public.is_global_viewer());

drop policy if exists "onboarding_platform_update" on public.client_onboardings;
create policy "onboarding_platform_update"
on public.client_onboardings for update to authenticated
using (public.is_global_viewer())
with check (public.is_global_viewer());

drop policy if exists "onboarding_steps_read" on public.client_onboarding_steps;
create policy "onboarding_steps_read"
on public.client_onboarding_steps for select to authenticated
using (
  public.is_global_viewer()
  or exists (
    select 1 from public.client_onboardings o
     where o.id = onboarding_id
       and o.admin_id = public.current_admin_id()
       and public.is_staff_member()
  )
);

drop policy if exists "onboarding_steps_platform_write" on public.client_onboarding_steps;
create policy "onboarding_steps_platform_write"
on public.client_onboarding_steps for insert to authenticated
with check (public.is_global_viewer());

drop policy if exists "onboarding_steps_platform_update" on public.client_onboarding_steps;
create policy "onboarding_steps_platform_update"
on public.client_onboarding_steps for update to authenticated
using (public.is_global_viewer())
with check (public.is_global_viewer());

-- A bespoke step added for one client can be removed again. The shipped
-- eleven come back on the next client_onboarding_ensure(), which is the
-- correct behaviour: they are what the platform sells.
drop policy if exists "onboarding_steps_platform_delete" on public.client_onboarding_steps;
create policy "onboarding_steps_platform_delete"
on public.client_onboarding_steps for delete to authenticated
using (public.is_global_viewer());

revoke all on public.client_onboardings      from anon, authenticated;
revoke all on public.client_onboarding_steps from anon, authenticated;

-- No DELETE on the parent by anyone: every tenant keeps a record. Removing a
-- tenant removes it, through the ON DELETE CASCADE above.
grant select, insert, update         on public.client_onboardings      to authenticated;
grant select, insert, update, delete on public.client_onboarding_steps to authenticated;

-- ---------------------------------------------------------------------------
-- 9. THE BOARD
--
--    One call returns the whole picture: the record, who the client is, who is
--    responsible, and how far along it is.
--
--    SECURITY DEFINER with an explicit scope test rather than SECURITY INVOKER,
--    which is what sacco_dashboard_stats() uses. The difference is what is
--    being joined: this reaches into user_profiles, company_profiles and
--    saccos purely to resolve a display name, and those three tables carry
--    policies written for other purposes on a database whose migration history
--    disagrees with its schema. Deriving visibility from them would make the
--    board's contents depend on which of those policies happened to be present.
--    The rule is stated here instead, once: a super admin sees every tenant, a
--    tenant sees itself, everyone else sees nothing.
-- ---------------------------------------------------------------------------
create or replace function public.client_onboarding_board(
  p_status text default null,
  p_assigned_to uuid default null,
  p_search text default null,
  p_limit integer default 200,
  p_offset integer default 0
)
returns table (
  id                uuid,
  admin_id          uuid,
  client_name       text,
  entity_type       text,
  contact_email     text,
  contact_phone     text,
  account_active    boolean,
  registered_at     timestamptz,
  status            text,
  assigned_to       uuid,
  assigned_to_name  text,
  assigned_at       timestamptz,
  scheduled_date    date,
  installation_date date,
  started_at        timestamptz,
  completed_at      timestamptz,
  completed_by_name text,
  on_hold_reason    text,
  notes             text,
  steps_total       integer,
  steps_done        integer,
  progress_pct      integer,
  updated_at        timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_global boolean := public.is_global_viewer();
  v_tenant uuid     := public.current_admin_id();
  v_staff  boolean  := public.is_staff_member();
  v_search text     := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not v_global and not (v_staff and v_tenant is not null) then
    return;
  end if;

  return query
  select
    o.id,
    o.admin_id,
    coalesce(nullif(btrim(s.name), ''),
             nullif(btrim(cp.company_name), ''),
             nullif(btrim(up.full_name), ''),
             split_part(coalesce(up.email, ''), '@', 1))::text as client_name,
    case when s.id is not null then 'sacco' else 'company' end::text as entity_type,
    coalesce(cp.email, s.email, up.email)::text as contact_email,
    coalesce(cp.phone, s.phone, up.phone)::text as contact_phone,
    coalesce(up.is_active, false) as account_active,
    up.created_at as registered_at,
    o.status,
    o.assigned_to,
    who.full_name::text as assigned_to_name,
    o.assigned_at,
    o.scheduled_date,
    o.installation_date,
    o.started_at,
    o.completed_at,
    fin.full_name::text as completed_by_name,
    o.on_hold_reason,
    o.notes,
    o.steps_total,
    o.steps_done,
    o.progress_pct,
    o.updated_at
  from public.client_onboardings o
  join public.user_profiles up          on up.id = o.admin_id
  left join public.company_profiles cp  on cp.admin_id = o.admin_id
  left join public.saccos s             on s.admin_id  = o.admin_id
  left join public.user_profiles who    on who.id = o.assigned_to
  left join public.user_profiles fin    on fin.id = o.completed_by
  where (v_global or o.admin_id = v_tenant)
    and (p_status is null or o.status = p_status)
    and (p_assigned_to is null or o.assigned_to = p_assigned_to)
    and (
      v_search is null
      or coalesce(s.name, '')          ilike '%' || v_search || '%'
      or coalesce(cp.company_name, '') ilike '%' || v_search || '%'
      or coalesce(up.full_name, '')    ilike '%' || v_search || '%'
      or coalesce(up.email, '')        ilike '%' || v_search || '%'
    )
  -- Unfinished work first, and within it the soonest booking. A completed
  -- onboarding is history; the point of this screen is what is still owed.
  order by
    (o.status = 'completed' or o.status = 'cancelled'),
    o.scheduled_date nulls last,
    up.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 500))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

comment on function public.client_onboarding_board(text, uuid, text, integer, integer) is
  'The installation and onboarding board. Super admins see every tenant; a tenant sees only itself.';

revoke all on function public.client_onboarding_board(text, uuid, text, integer, integer) from public, anon;
grant execute on function public.client_onboarding_board(text, uuid, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. THE KPI ROW
--
--     Aggregated in Postgres over the WHOLE book, never by reducing over the
--     page the board returned -- the same rule sacco_dashboard_stats() follows,
--     and for the same reason: a total of one page is the one number an
--     operations lead must never be shown.
-- ---------------------------------------------------------------------------
create or replace function public.client_onboarding_summary()
returns table (
  total          bigint,
  not_started    bigint,
  scheduled      bigint,
  in_progress    bigint,
  on_hold        bigint,
  completed      bigint,
  cancelled      bigint,
  unassigned     bigint,
  overdue        bigint,
  due_this_week  bigint,
  avg_days_to_complete numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_global boolean := public.is_global_viewer();
  v_tenant uuid    := public.current_admin_id();
  v_staff  boolean := public.is_staff_member();
begin
  if not v_global and not (v_staff and v_tenant is not null) then
    return;
  end if;

  return query
  select
    count(*)                                                              as total,
    count(*) filter (where o.status = 'not_started')                      as not_started,
    count(*) filter (where o.status = 'scheduled')                        as scheduled,
    count(*) filter (where o.status = 'in_progress')                      as in_progress,
    count(*) filter (where o.status = 'on_hold')                          as on_hold,
    count(*) filter (where o.status = 'completed')                        as completed,
    count(*) filter (where o.status = 'cancelled')                        as cancelled,
    -- Nobody is doing this one. Cancelled jobs are excluded; a completed one
    -- cannot be unassigned work whatever its assigned_to says.
    count(*) filter (where o.assigned_to is null
                       and o.status not in ('completed', 'cancelled'))    as unassigned,
    -- Booked for a day that has passed and still not finished.
    count(*) filter (where o.scheduled_date is not null
                       and o.scheduled_date < current_date
                       and o.status not in ('completed', 'cancelled'))    as overdue,
    count(*) filter (where o.scheduled_date is not null
                       and o.scheduled_date >= current_date
                       and o.scheduled_date < current_date + 7
                       and o.status not in ('completed', 'cancelled'))    as due_this_week,
    -- How long the platform actually takes, from the day the account was
    -- created to the day somebody signed the installation off. Cast to numeric
    -- because round(double precision, integer) does not exist, and EXTRACT
    -- returns double precision before PG 14.
    round((avg(extract(epoch from (o.completed_at - up.created_at)) / 86400.0)
           filter (where o.status = 'completed' and o.completed_at is not null)
          )::numeric, 1)                                                  as avg_days_to_complete
  from public.client_onboardings o
  join public.user_profiles up on up.id = o.admin_id
  where v_global or o.admin_id = v_tenant;
end;
$$;

comment on function public.client_onboarding_summary() is
  'Installation/onboarding aggregates over the whole book. Super admins see the platform; a tenant sees only itself.';

revoke all on function public.client_onboarding_summary() from public, anon;
grant execute on function public.client_onboarding_summary() to authenticated;

commit;

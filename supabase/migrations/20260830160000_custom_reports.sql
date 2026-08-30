-- ===========================================================================
-- SAVED CUSTOM REPORTS
--
-- WHAT THIS STORES
--
-- A report DEFINITION, never report data. One row is "payments, these six
-- columns, completed only, over KES 50,000, this month, grouped by method" —
-- the question, not any answer to it. Running it is an ordinary query against
-- the source table under the caller's own JWT, so every row that comes back is
-- governed by that table's existing policies and nothing here widens them.
--
-- WHY THE DEFINITION IS NOT A SECURITY BOUNDARY
--
-- This table is deliberately dumb about what a definition contains. It does not
-- parse the JSON, and it must never be the thing that decides what a report may
-- read, because a jsonb column is exactly the wrong place to enforce anything:
-- the row can be edited, imported or hand-written. Two other layers do that job
-- properly and are unaffected by whatever ends up in here:
--
--   1. The client validates every definition against the catalogue before it
--      builds a query (src/config/reportSchema.js, validateDefinition). A
--      column the catalogue does not list is dropped, not queried.
--   2. RLS on the SOURCE table decides what comes back. A definition naming a
--      table the caller cannot read returns nothing, exactly as a hand-written
--      query would.
--
-- So the worst a tampered definition can do is name columns the builder then
-- refuses to select. That is the design, not an oversight.
--
-- WHY admin_id AND created_by ARE STAMPED BY TRIGGER
--
-- Same rule as crm_interactions: a client that could supply its own admin_id
-- would be choosing which tenant to write into. Both come from the session and
-- overwrite whatever was sent.
--
-- SHARING
--
-- A report is private to its author until it is shared, at which point the
-- whole tenant can run it. Sharing shares the QUESTION, not the rows: two
-- people running the same shared report see what their own policies let them
-- see, which is the only sane meaning for a shared report in a system where
-- an HR manager and a collections officer read different tables.
--
-- Idempotent and transactional: safe to re-run, lands whole or not at all.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. TABLE
-- ---------------------------------------------------------------------------

create table if not exists public.custom_reports (
  id          uuid primary key default gen_random_uuid(),
  -- Tenant key, stamped by trigger from the session. Never trusted from the client.
  admin_id    uuid not null,
  created_by  uuid not null references public.user_profiles(id) on delete cascade,
  name        text not null,
  description text,
  -- The catalogue key (REPORT_SOURCES[].key), kept as its own column so the
  -- list can be filtered and counted without unpacking the jsonb. It is a
  -- label, not a permission: what the report may read is settled by RLS on
  -- whatever table the definition names.
  source_key  text not null,
  definition  jsonb not null default '{}'::jsonb,
  is_shared   boolean not null default false,
  -- So the list can lead with what people actually run, rather than with
  -- whatever was created most recently and abandoned.
  last_run_at timestamptz,
  run_count   integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.custom_reports is
  'Saved report definitions for the report builder. Stores the question, never the answer. See src/config/reportSchema.js.';
comment on column public.custom_reports.definition is
  'Fields, filters, period preset, sort, grouping and aggregates. Validated client-side against the catalogue on every load; never trusted as a permission.';
comment on column public.custom_reports.is_shared is
  'Shared reports are runnable by the whole tenant. Sharing shares the question — each runner still sees only the rows their own policies allow.';

-- A name has to survive being read in a list of forty. Empty and 200-character
-- names both make that list useless, so the constraint is on the data rather
-- than on the one form that happens to write it today.
alter table public.custom_reports drop constraint if exists custom_reports_name_check;
alter table public.custom_reports add constraint custom_reports_name_check
  check (char_length(btrim(name)) between 1 and 120);

alter table public.custom_reports drop constraint if exists custom_reports_definition_check;
alter table public.custom_reports add constraint custom_reports_definition_check
  check (jsonb_typeof(definition) = 'object');

-- Two reports called "Monthly collections" in one tenant is a support ticket
-- waiting to happen. Scoped per author, because two people independently
-- naming their own private report the same thing is not a conflict.
create unique index if not exists idx_custom_reports_unique_name
  on public.custom_reports (created_by, lower(btrim(name)));

create index if not exists idx_custom_reports_tenant
  on public.custom_reports (admin_id, updated_at desc);

-- Partial: the "shared with me" list reads only the shared minority.
create index if not exists idx_custom_reports_shared
  on public.custom_reports (admin_id, updated_at desc) where is_shared;

-- ---------------------------------------------------------------------------
-- 2. HELPER
--    SECURITY DEFINER so the policies below do not recurse through
--    user_profiles' own RLS.
-- ---------------------------------------------------------------------------

-- Who may unshare, rename or delete a report they did not write.
--
-- Deliberately NOT is_staff_member(): that is true for every sales_agent, and
-- an agent tidying up the finance director's saved reports is not a feature.
-- The tenant owner and their directors administer the shared shelf.
create or replace function public.is_report_admin()
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
                       'sacco_admin'::public.user_role,
                       'director'::public.user_role)
  );
$$;

revoke execute on function public.is_report_admin() from public, anon;
grant  execute on function public.is_report_admin() to authenticated;

comment on function public.is_report_admin() is
  'True for the roles that administer the tenant shared report shelf. Excludes sales_agent by design.';

-- May this caller save a report at all?
--
-- The server-side echo of REPORT_BUILDER_ROLES in src/config/reportSchema.js.
-- Clients and members have portals, not a query tool; agents are the subject of
-- these reports rather than readers of them. Keeping the two lists in step
-- matters — a role removed from the UI list but left here can still persist
-- rows through the API.
create or replace function public.can_build_reports()
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
                       'sacco_admin'::public.user_role,
                       'director'::public.user_role,
                       'manager'::public.user_role,
                       'finance'::public.user_role,
                       'accountant'::public.user_role,
                       'operations'::public.user_role,
                       'hr'::public.user_role)
  );
$$;

revoke execute on function public.can_build_reports() from public, anon;
grant  execute on function public.can_build_reports() to authenticated;

comment on function public.can_build_reports() is
  'Roles allowed to SAVE a report definition. Mirrors REPORT_BUILDER_ROLES in src/config/reportSchema.js — keep the two in step.';

-- ---------------------------------------------------------------------------
-- 3. STAMP THE OWNER FROM THE SESSION
-- ---------------------------------------------------------------------------

create or replace function public.custom_reports_stamp()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.admin_id   := public.current_admin_id();
  else
    -- Neither may be reassigned by an update. Moving a report between tenants
    -- or authors is not an edit, it is a way around the read policy.
    new.created_by := old.created_by;
    new.admin_id   := old.admin_id;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_custom_reports_stamp on public.custom_reports;
create trigger trg_custom_reports_stamp
  before insert or update on public.custom_reports
  for each row execute function public.custom_reports_stamp();

comment on function public.custom_reports_stamp() is
  'Owner and tenant come from the session on insert and are immutable thereafter.';

-- Recording a run must not need UPDATE on the whole row — a shared report is
-- run by people who may not edit it, and granting them UPDATE to bump a
-- counter would let them rewrite the definition under everyone else.
create or replace function public.custom_report_ran(p_report uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.custom_reports
     set last_run_at = now(),
         run_count   = run_count + 1
   where id = p_report
     and admin_id = public.current_admin_id()
     and (is_shared or created_by = auth.uid());
end;
$$;

revoke execute on function public.custom_report_ran(uuid) from public, anon;
grant  execute on function public.custom_report_ran(uuid) to authenticated;

comment on function public.custom_report_ran(uuid) is
  'Bumps the run counter for a report the caller can already read. Exists so running a shared report needs no UPDATE right on it.';

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------

alter table public.custom_reports enable row level security;

-- ---- read: your own, plus whatever the tenant has shared ----
drop policy if exists custom_reports_read on public.custom_reports;
create policy custom_reports_read
on public.custom_reports for select to authenticated
using (
  admin_id = public.current_admin_id()
  and (created_by = auth.uid() or is_shared)
);

-- ---- write: your own, and only if your role may build reports ----
-- created_by and admin_id are stamped by the trigger, so the WITH CHECK here
-- is a second assertion of what the trigger just did rather than a test of
-- what the client sent.
drop policy if exists custom_reports_insert on public.custom_reports;
create policy custom_reports_insert
on public.custom_reports for insert to authenticated
with check (
  public.can_build_reports()
  and created_by = auth.uid()
  and admin_id = public.current_admin_id()
);

drop policy if exists custom_reports_update on public.custom_reports;
create policy custom_reports_update
on public.custom_reports for update to authenticated
using (
  admin_id = public.current_admin_id()
  and (created_by = auth.uid() or public.is_report_admin())
)
with check (
  admin_id = public.current_admin_id()
  and (created_by = auth.uid() or public.is_report_admin())
);

drop policy if exists custom_reports_delete on public.custom_reports;
create policy custom_reports_delete
on public.custom_reports for delete to authenticated
using (
  admin_id = public.current_admin_id()
  and (created_by = auth.uid() or public.is_report_admin())
);

-- ---------------------------------------------------------------------------
-- 5. GRANTS
--    RLS decides the rows; these decide who may ask at all. anon never may.
-- ---------------------------------------------------------------------------

revoke all on public.custom_reports from public, anon;
grant select, insert, update, delete on public.custom_reports to authenticated;

notify pgrst, 'reload schema';

commit;

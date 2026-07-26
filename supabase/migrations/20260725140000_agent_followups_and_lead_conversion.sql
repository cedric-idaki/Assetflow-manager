-- Sales agent follow-ups / appointments + lead conversion tracking.
--
-- Two gaps this closes:
--
-- 1. FOLLOW-UPS. public.follow_ups has existed since 20260305210000 but nothing
--    ever wrote to it — the portal only rendered seeded rows. An agent who is
--    told "check me next week" had nowhere to put that. The columns below turn
--    the table into a real reminder queue: remind_at is when the agent should be
--    nudged, reminder_sent_at is the idempotency stamp the scheduled worker
--    (functions/agent-followup-reminders) writes so a reminder goes out once.
--
-- 2. LEAD CONVERSION. Nothing on leads recorded that a lead became a paying
--    account, so a converted lead looked identical to a stale one and could be
--    registered twice. converted_at / converted_entity / converted_ref_id make
--    the conversion a fact on the row.
--
-- Every statement is IF NOT EXISTS / OR REPLACE — safe to re-run.

-- ==================== follow_ups: reminder columns ====================

alter table public.follow_ups add column if not exists remind_at        timestamptz;
alter table public.follow_ups add column if not exists reminder_sent_at timestamptz;
alter table public.follow_ups add column if not exists completed_at     timestamptz;
alter table public.follow_ups add column if not exists outcome          text;

comment on column public.follow_ups.remind_at is
  'When the agent should be reminded. Defaults to 1 hour before scheduled_at (see the default_remind_at trigger).';
comment on column public.follow_ups.reminder_sent_at is
  'Set by agent-followup-reminders once the email goes out. NULL = still queued.';
comment on column public.follow_ups.outcome is
  'Free text the agent records when completing: what the lead said, next step.';

-- Backfill: existing rows get the same default a new row would.
update public.follow_ups
   set remind_at = scheduled_at - interval '1 hour'
 where remind_at is null;

-- Default remind_at to an hour before the appointment when the caller does not
-- pick a reminder time, and keep completed_at honest with is_completed.
create or replace function public.follow_ups_normalize()
returns trigger
language plpgsql
as $$
begin
  if new.remind_at is null then
    new.remind_at := new.scheduled_at - interval '1 hour';
  end if;

  -- Moving an appointment re-arms its reminder.
  if tg_op = 'UPDATE' and new.scheduled_at is distinct from old.scheduled_at then
    new.reminder_sent_at := null;
    if new.remind_at = old.remind_at then
      new.remind_at := new.scheduled_at - interval '1 hour';
    end if;
  end if;

  if new.is_completed and new.completed_at is null then
    new.completed_at := now();
  elsif not new.is_completed then
    new.completed_at := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_follow_ups_normalize on public.follow_ups;
create trigger trg_follow_ups_normalize
  before insert or update on public.follow_ups
  for each row execute function public.follow_ups_normalize();

-- The worker scans for open reminders that have come due.
create index if not exists idx_follow_ups_due
  on public.follow_ups (remind_at)
  where is_completed = false and reminder_sent_at is null;

-- The portal lists an agent's open follow-ups oldest-due first.
create index if not exists idx_follow_ups_agent_open
  on public.follow_ups (agent_id, scheduled_at)
  where is_completed = false;

-- Agents may delete an appointment they created (the original migration granted
-- select/insert/update only, so a mis-typed appointment was permanent).
drop policy if exists "agents_delete_own_followups" on public.follow_ups;
create policy "agents_delete_own_followups"
on public.follow_ups for delete to authenticated
using (agent_id = public.get_agent_id_for_user(auth.uid()));

-- ==================== leads: next follow-up + conversion ====================

alter table public.leads add column if not exists next_follow_up_at timestamptz;
alter table public.leads add column if not exists converted_at      timestamptz;
alter table public.leads add column if not exists converted_entity  text;
alter table public.leads add column if not exists converted_ref_id  uuid;

comment on column public.leads.next_follow_up_at is
  'Denormalised soonest open follow_ups.scheduled_at, kept current by the sync trigger so the pipeline card can show a due badge without a join.';
comment on column public.leads.converted_entity is
  'What the lead became: client | company | sacco. NULL until converted.';
comment on column public.leads.converted_ref_id is
  'PK of the created clients / user_profiles / saccos row. Not a FK — the target table depends on converted_entity.';

alter table public.leads drop constraint if exists leads_converted_entity_check;
alter table public.leads add constraint leads_converted_entity_check
  check (converted_entity is null or converted_entity in ('client', 'company', 'sacco'));

create index if not exists idx_leads_next_follow_up
  on public.leads (agent_id, next_follow_up_at)
  where next_follow_up_at is not null;

-- Keep leads.next_follow_up_at pointing at the soonest OPEN follow-up.
create or replace function public.leads_sync_next_follow_up()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- NEW is unassigned on DELETE and OLD on INSERT, so each is read only under
  -- the branch where it exists — touching the other raises at runtime.
  new_lead uuid;
  old_lead uuid;
begin
  if tg_op <> 'DELETE' then new_lead := new.lead_id; end if;
  if tg_op <> 'INSERT' then old_lead := old.lead_id; end if;

  update public.leads l
     set next_follow_up_at = (
           select min(f.scheduled_at)
             from public.follow_ups f
            where f.lead_id = l.id
              and f.is_completed = false
         )
   -- An UPDATE can move a follow-up between leads; refresh both sides.
   where l.id in (new_lead, old_lead);

  return null;
end;
$$;

drop trigger if exists trg_leads_sync_next_follow_up on public.follow_ups;
create trigger trg_leads_sync_next_follow_up
  after insert or update or delete on public.follow_ups
  for each row execute function public.leads_sync_next_follow_up();

-- Prime the column for rows that already have open follow-ups.
update public.leads l
   set next_follow_up_at = sub.next_at
  from (
    select lead_id, min(scheduled_at) as next_at
      from public.follow_ups
     where is_completed = false and lead_id is not null
     group by lead_id
  ) sub
 where l.id = sub.lead_id;

-- Leads closed before this migration existed are converted by definition; stamp
-- them so the portal does not offer to register them a second time.
update public.leads
   set converted_at = coalesce(converted_at, updated_at, created_at)
 where stage = 'closed' and converted_at is null;

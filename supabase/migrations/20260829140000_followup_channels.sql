-- ===========================================================================
-- FOLLOW-UPS: WHICH CHANNEL, AND THE NEXT DATE
--
-- The CRM had two vocabularies for the same four things.
--
--   crm_interactions.interaction_type  call | whatsapp | sms | email |
--                                      meeting | site_visit | proposal |
--                                      note | other          (the PAST)
--   follow_ups.appointment_type        follow_up | phone_call |
--                                      office_meeting | site_visit  (the FUTURE)
--
-- `phone_call` and `call` are the same act. So are `office_meeting` and
-- `meeting`. Worse, the scheduler's list had NO EMAIL, no WhatsApp and no SMS,
-- so "I'll email her the payment plan on Friday" could only be filed as a
-- generic follow-up -- the row could not say how, the reminder email could not
-- say how, and no report could count it. An agent who works mostly by email and
-- WhatsApp had a diary that described none of their actual work.
--
-- This migration makes appointment_type a real channel, drawn from the same set
-- as interaction_type, so "we have emailed this lead four times and the next
-- two touches are also emails" becomes one question over two tables instead of
-- two questions that cannot be joined.
--
-- Three parts:
--
--   1. BACKFILL the legacy values onto the shared set.
--   2. NORMALISE on write, in the trigger that already runs there. This is the
--      part that matters for deployment: the constraint below would otherwise
--      start rejecting `phone_call` from any browser tab still running the old
--      bundle, and this project ships migrations before the frontend. A tab
--      open across the deploy now writes `phone_call` and gets `call` stored,
--      instead of an error the agent cannot act on.
--   3. CONSTRAIN, once nothing can violate it.
--
-- Plus follow_ups.source_interaction_id, so a follow-up booked from the "log a
-- contact" form remembers the conversation that produced it. That is what turns
-- crm_interactions.next_step -- a sentence nobody is ever reminded about -- into
-- a dated commitment with a trail back to why it was made.
--
-- Idempotent throughout; wrapped in a transaction, so it lands whole or not at
-- all.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. BACKFILL
--    Existing rows only ever carry one of the four legacy values (nothing else
--    ever wrote this column), but the catch-all below is kept anyway: a value
--    outside the set would make step 4 fail and take the whole migration with
--    it, and the appointment itself is worth more than the label on it.
-- ---------------------------------------------------------------------------

update public.follow_ups set appointment_type = 'call'
 where lower(btrim(coalesce(appointment_type, ''))) in ('phone_call', 'phonecall');

update public.follow_ups set appointment_type = 'meeting'
 where lower(btrim(coalesce(appointment_type, ''))) = 'office_meeting';

update public.follow_ups set appointment_type = 'site_visit'
 where lower(btrim(coalesce(appointment_type, ''))) = 'visit';

-- A missing channel becomes 'follow_up' -- the historical default, and honestly
-- what an unlabelled appointment is: a chase with the method undecided.
update public.follow_ups set appointment_type = 'follow_up'
 where appointment_type is null
    or btrim(appointment_type) = ''
    or lower(btrim(appointment_type)) in ('follow-up', 'followup');

-- Anything still unrecognised keeps its row but loses its claim to be a
-- specific channel.
update public.follow_ups set appointment_type = 'other'
 where appointment_type not in (
   'follow_up', 'call', 'whatsapp', 'sms', 'email',
   'meeting', 'site_visit', 'proposal', 'other'
 );

-- ---------------------------------------------------------------------------
-- 2. LINK BACK TO THE CONVERSATION THAT CAUSED IT
-- ---------------------------------------------------------------------------

alter table public.follow_ups
  add column if not exists source_interaction_id uuid
  references public.crm_interactions(id) on delete set null;

comment on column public.follow_ups.source_interaction_id is
  'The logged contact this follow-up was booked from, when both were written in one action. NULL for one scheduled on its own. ON DELETE SET NULL: correcting a call log must not silently cancel the appointment it produced.';

comment on column public.follow_ups.appointment_type is
  'How the next contact will happen, from the same vocabulary as crm_interactions.interaction_type. Normalised on write by follow_ups_normalize(); the one shared list lives in src/config/crmVocabulary.js.';

create index if not exists idx_follow_ups_source_interaction
  on public.follow_ups (source_interaction_id)
  where source_interaction_id is not null;

-- ---------------------------------------------------------------------------
-- 3. NORMALISE ON WRITE
--    Extends the existing BEFORE trigger (20260725140000) rather than adding a
--    second one: remind_at defaulting, reminder re-arming and completed_at all
--    still happen here exactly as before, unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.follow_ups_normalize()
returns trigger
language plpgsql
as $fn$
declare
  channel text;
begin
  -- ---- channel ----------------------------------------------------------
  -- Fold the two old vocabularies onto the shared one. Doing this here rather
  -- than trusting the caller means an out-of-date client keeps working, and the
  -- CHECK below can never be the thing an agent hits.
  channel := lower(btrim(coalesce(new.appointment_type, '')));

  channel := case channel
    when ''               then 'follow_up'
    when 'follow-up'      then 'follow_up'
    when 'followup'       then 'follow_up'
    when 'phone_call'     then 'call'
    when 'phonecall'      then 'call'
    when 'office_meeting' then 'meeting'
    when 'whats_app'      then 'whatsapp'
    when 'text'           then 'sms'
    when 'visit'          then 'site_visit'
    else channel
  end;

  if channel not in ('follow_up', 'call', 'whatsapp', 'sms', 'email',
                     'meeting', 'site_visit', 'proposal', 'other') then
    channel := 'other';
  end if;

  new.appointment_type := channel;

  -- ---- reminder timing (unchanged from 20260725140000) -------------------
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
$fn$;

drop trigger if exists trg_follow_ups_normalize on public.follow_ups;
create trigger trg_follow_ups_normalize
  before insert or update on public.follow_ups
  for each row execute function public.follow_ups_normalize();

-- ---------------------------------------------------------------------------
-- 4. CONSTRAIN
--    Safe only because of steps 1 and 3: nothing on disk violates it, and
--    nothing arriving can. Its job is to stop a future writer inventing a tenth
--    channel that the reports would then silently under-count.
-- ---------------------------------------------------------------------------

alter table public.follow_ups drop constraint if exists follow_ups_appointment_type_check;
alter table public.follow_ups add constraint follow_ups_appointment_type_check
  check (appointment_type in (
    'follow_up', 'call', 'whatsapp', 'sms', 'email',
    'meeting', 'site_visit', 'proposal', 'other'
  ));

-- ---------------------------------------------------------------------------
-- 5. Channel-aware due list
--    The panel groups the open diary by channel ("3 emails to write, 2 calls to
--    make"), which is a different sort order from idx_follow_ups_agent_open.
-- ---------------------------------------------------------------------------

create index if not exists idx_follow_ups_agent_channel_open
  on public.follow_ups (agent_id, appointment_type, scheduled_at)
  where is_completed = false;

-- Make the new column and constraint visible to PostgREST immediately rather
-- than after its next cache cycle.
notify pgrst, 'reload schema';

commit;

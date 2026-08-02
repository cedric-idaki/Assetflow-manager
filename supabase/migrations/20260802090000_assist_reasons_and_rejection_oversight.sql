-- Migration: give an assist a REASON on the way in and on the way out, and let
-- the super admin read the refusals.
--
-- Three gaps this closes:
--
--   1. "What do you need help with?" was a free-text box. Two agents describing
--      the same job wrote it two different ways, so nothing could be counted:
--      the platform could not say how much of its assist volume was sales help
--      versus installation and training. help_type fixes the shape of the answer
--      while keeping the note for the specifics.
--
--   2. A gold agent could decline with no reason at all — decline_reason was
--      nullable and the UI never required it. The bronze agent was told "no" and
--      nothing else, which is the same dead end the assist inbox was built to
--      remove. Declining now requires a reason, enforced in the guard trigger
--      rather than only in the form, so it holds for any client.
--
--   3. Refusals were invisible above the two agents involved. RLS let only the
--      bronze and gold agent read the row, so the super admin — the one person
--      who can act on a gold agent who turns everything down — could not see a
--      single rejection. A platform-wide read policy fixes that; is_global_viewer()
--      is already the project's definition of super_admin/director.
--
-- Every statement is IF NOT EXISTS / OR REPLACE — safe to re-run.

-- ==================== 1. Reason columns ====================

alter table public.agent_assists add column if not exists help_type           text;
alter table public.agent_assists add column if not exists decline_reason_code text;

comment on column public.agent_assists.help_type is
  'Why the bronze agent asked: sales_assist | installation_training | other. Free-text detail stays in note.';
comment on column public.agent_assists.decline_reason_code is
  'Why the gold agent refused. Paired with decline_reason, which carries their own words.';

-- Legacy rows predate the picker and their notes are prose — "other" is the
-- honest label for them, not a guess at which bucket they belonged in.
update public.agent_assists
   set help_type = 'other'
 where help_type is null;

alter table public.agent_assists drop constraint if exists agent_assists_help_type_check;
alter table public.agent_assists add constraint agent_assists_help_type_check
  check (help_type is null or help_type in ('sales_assist', 'installation_training', 'other'));

alter table public.agent_assists drop constraint if exists agent_assists_decline_reason_code_check;
alter table public.agent_assists add constraint agent_assists_decline_reason_code_check
  check (decline_reason_code is null or decline_reason_code in (
    'unavailable', 'out_of_region', 'not_my_expertise',
    'insufficient_info', 'client_not_ready', 'duplicate', 'other'
  ));

-- The super admin's rejections view reads "declines by this gold agent, newest
-- first" — one index serves both the per-agent list and the count beside it.
create index if not exists idx_agent_assists_declined
  on public.agent_assists (gold_agent_id, responded_at desc)
  where status = 'declined';

-- ==================== 2. A decline must say why ====================
-- Rebuilt from 20260725160000 with one addition: the transition into 'declined'
-- now carries a reason. Everything else in the guard is unchanged.

create or replace function public.agent_assists_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := public.get_agent_id_for_user(auth.uid());
begin
  if tg_op = 'INSERT' then
    -- A request always starts at the beginning, whatever the client posted.
    new.status       := 'requested';
    new.responded_at := null;
    new.completed_at := null;
    new.paid_at      := null;
    new.updated_at   := now();

    if new.bronze_agent_id = new.gold_agent_id then
      raise exception 'An agent cannot request an assist from themselves';
    end if;
    return new;
  end if;

  -- The parties and the money are fixed once the request exists.
  if new.bronze_agent_id is distinct from old.bronze_agent_id
     or new.gold_agent_id is distinct from old.gold_agent_id then
    raise exception 'The agents on an assist cannot be changed';
  end if;
  if actor is not null and new.amount is distinct from old.amount then
    raise exception 'The assist commission cannot be changed';
  end if;

  if new.status is distinct from old.status then
    if actor = old.gold_agent_id then
      -- The gold agent works the request.
      if not (
        (old.status = 'requested' and new.status in ('accepted', 'declined'))
        or (old.status = 'accepted' and new.status in ('completed', 'declined'))
      ) then
        raise exception 'A gold agent cannot move an assist from % to %', old.status, new.status;
      end if;
    elsif actor = old.bronze_agent_id then
      -- The bronze agent may only withdraw a request that is not yet finished.
      if not (old.status in ('requested', 'accepted') and new.status = 'cancelled') then
        raise exception 'A bronze agent can only cancel an open assist (tried % to %)', old.status, new.status;
      end if;
    elsif actor is not null then
      raise exception 'Only the agents involved can update this assist';
    end if;

    -- Saying no is allowed; saying nothing is not. The bronze agent has to know
    -- whether to ask someone else or to fix something and come back.
    if new.status = 'declined'
       and coalesce(nullif(btrim(new.decline_reason_code), ''), nullif(btrim(new.decline_reason), '')) is null then
      raise exception 'A declined assist must carry a reason';
    end if;

    if new.status in ('accepted', 'declined') and new.responded_at is null then
      new.responded_at := now();
    end if;
    if new.status = 'completed' and new.completed_at is null then
      new.completed_at := now();
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_agent_assists_guard on public.agent_assists;
create trigger trg_agent_assists_guard
  before insert or update on public.agent_assists
  for each row execute function public.agent_assists_guard();

-- ==================== 3. Platform oversight ====================
-- Read-only, and deliberately separate from assists_select_involved so revoking
-- it later cannot take the two agents' own view down with it. No matching
-- update/delete policy: the super admin watches these rows, they do not work them.

drop policy if exists "assists_select_platform" on public.agent_assists;
create policy "assists_select_platform"
on public.agent_assists for select to authenticated
using (public.is_global_viewer());

-- Refresh the PostgREST schema cache so the new columns are immediately visible.
notify pgrst, 'reload schema';

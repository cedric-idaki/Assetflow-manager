-- Migration: turn agent assists into REQUESTS the gold agent can see and act on.
--
-- What was wrong with the original design (20260626130000_agent_assists.sql):
--
--   1. The gold agent had no inbox. The row was only ever written, never read
--      back by the app, so the only trace a gold agent saw was a KES 1000 wallet
--      credit appearing out of nowhere. They found out they had been given work
--      by noticing they had been paid for it.
--   2. It was an assignment, not a request — no accept, no decline.
--   3. status was written 'assigned' and never changed again, so nothing could
--      record that the onboarding actually happened.
--   4. The commission was paid on INSERT, i.e. before any work was done, and
--      the bronze agent could pay any gold agent by inserting a row.
--
-- The lifecycle is now:
--
--   requested ──accept──> accepted ──complete──> completed   (gold is paid here)
--       │                     │
--       ├──decline──> declined┘
--       │
--       └──cancel───> cancelled                              (bronze withdraws)
--
-- Every statement is IF NOT EXISTS / OR REPLACE — safe to re-run.

-- ==================== 1. Retire the pay-on-insert trigger ====================
-- Dropped before the backfill so re-stamping legacy rows cannot re-pay anyone.

drop trigger  if exists trg_credit_gold_assist on public.agent_assists;
drop function if exists public.credit_gold_assist();

-- ==================== 2. Lifecycle columns ====================

alter table public.agent_assists add column if not exists note           text;
alter table public.agent_assists add column if not exists decline_reason text;
alter table public.agent_assists add column if not exists outcome        text;
alter table public.agent_assists add column if not exists responded_at   timestamptz;
alter table public.agent_assists add column if not exists completed_at   timestamptz;
alter table public.agent_assists add column if not exists paid_at        timestamptz;
alter table public.agent_assists add column if not exists updated_at     timestamptz default now();

comment on column public.agent_assists.note is
  'What the bronze agent needs help with — the whole point of the request, shown first in the gold agent''s inbox.';
comment on column public.agent_assists.outcome is
  'What the gold agent recorded when marking the assist complete.';
comment on column public.agent_assists.paid_at is
  'Idempotency stamp for the commission payout. NULL = the gold agent has not been credited for this assist.';

alter table public.agent_assists alter column status set default 'requested';

-- ==================== 3. Backfill legacy rows ====================
-- Rows created under the old design were credited the moment they were inserted
-- and the work is long since done or abandoned. Stamp them completed AND paid so
-- the new payout trigger (added below) can never pay them a second time.

update public.agent_assists
   set status       = 'completed',
       completed_at = coalesce(completed_at, created_at),
       paid_at      = coalesce(paid_at, created_at),
       responded_at = coalesce(responded_at, created_at)
 where status = 'assigned' or status is null;

alter table public.agent_assists drop constraint if exists agent_assists_status_check;
alter table public.agent_assists add constraint agent_assists_status_check
  check (status in ('requested', 'accepted', 'declined', 'completed', 'cancelled'));

-- The gold agent's inbox reads pending-first; the bronze agent tracks their own.
create index if not exists idx_agent_assists_gold_status
  on public.agent_assists (gold_agent_id, status, created_at desc);
create index if not exists idx_agent_assists_bronze_status
  on public.agent_assists (bronze_agent_id, status, created_at desc);

-- ==================== 4. Transition guard ====================
-- RLS can say WHO may touch a row; it cannot say which transitions each side is
-- allowed to make. This trigger is where "the gold agent accepts, the bronze
-- agent cancels, nobody edits the money" is actually enforced.
--
-- auth.uid() is NULL for service_role and for migrations — those skip the checks
-- deliberately, so support can still fix a stuck row.

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

-- ==================== 5. Payout on completion ====================
-- Crediting the GOLD agent's wallet crosses agent ownership, which the
-- agent_wallets RLS forbids client-side — hence SECURITY DEFINER. paid_at makes
-- it exactly-once: a row that somehow re-enters 'completed' is not paid twice.
--
-- Runs after the guard (trigger order is alphabetical: ..._guard before ..._pay).

create or replace function public.agent_assists_pay_on_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed'
     and new.paid_at is null
     and new.gold_agent_id is not null
     and coalesce(new.amount, 0) > 0 then

    insert into public.agent_wallets
      (agent_id, total_earned, total_withdrawn, available_balance, tx_type, description)
    values
      (new.gold_agent_id, new.amount, 0, new.amount, 'credit',
       'Assist commission — onboarded admin ' || coalesce(nullif(new.admin_name, ''), '(unspecified)'));

    update public.agents
       set total_commission = coalesce(total_commission, 0) + new.amount
     where id = new.gold_agent_id;

    new.paid_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_agent_assists_pay on public.agent_assists;
create trigger trg_agent_assists_pay
  before update on public.agent_assists
  for each row execute function public.agent_assists_pay_on_complete();

-- ==================== 6. RLS ====================
-- Select already allowed either side (assists_select_involved). Update is new —
-- without it the gold agent could read a request but never answer it.

drop policy if exists "assists_update_involved" on public.agent_assists;
create policy "assists_update_involved"
on public.agent_assists for update to authenticated
using (
  bronze_agent_id = public.get_agent_id_for_user(auth.uid())
  or gold_agent_id = public.get_agent_id_for_user(auth.uid())
)
with check (
  bronze_agent_id = public.get_agent_id_for_user(auth.uid())
  or gold_agent_id = public.get_agent_id_for_user(auth.uid())
);

-- ==================== 7. Realtime ====================
-- The publication is per-table on this project. Publish assists so a request
-- lands in the gold agent's portal without a refresh — the whole fix is that
-- they find out at the time, not at payday.

do $$ begin
  alter publication supabase_realtime add table public.agent_assists;
exception when duplicate_object then null; end $$;

-- Refresh the PostgREST schema cache so the new columns are immediately visible.
notify pgrst, 'reload schema';

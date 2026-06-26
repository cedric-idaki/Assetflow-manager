-- Migration: agent assists (bronze agent → gold agent onboarding help).
--
-- A bronze sales agent (super-admin tier) can ask a gold sales agent to take an
-- admin they registered through the system. On assignment the gold agent earns
-- a fixed KES 1000 commission.
--
-- The bronze agent can only insert their own assist row (RLS). Crediting the
-- GOLD agent's wallet crosses agent ownership, which the agent_wallets RLS
-- forbids client-side, so a SECURITY DEFINER trigger performs the payout.

create table if not exists public.agent_assists (
  id              uuid primary key default gen_random_uuid(),
  bronze_agent_id uuid not null references public.agents(id) on delete cascade,
  gold_agent_id   uuid not null references public.agents(id) on delete cascade,
  admin_id        uuid,            -- optional: the admin/company auth user being assisted
  admin_name      text,           -- label shown to both agents
  amount          numeric not null default 1000,
  status          text not null default 'assigned',
  created_at      timestamptz default now()
);

create index if not exists idx_agent_assists_bronze on public.agent_assists(bronze_agent_id);
create index if not exists idx_agent_assists_gold   on public.agent_assists(gold_agent_id);

alter table public.agent_assists enable row level security;

-- Either agent involved can read the assist.
drop policy if exists "assists_select_involved" on public.agent_assists;
create policy "assists_select_involved"
on public.agent_assists for select to authenticated
using (
  bronze_agent_id = public.get_agent_id_for_user(auth.uid())
  or gold_agent_id = public.get_agent_id_for_user(auth.uid())
);

-- The acting agent may only create assists as the bronze (requesting) side.
drop policy if exists "assists_insert_own" on public.agent_assists;
create policy "assists_insert_own"
on public.agent_assists for insert to authenticated
with check (bronze_agent_id = public.get_agent_id_for_user(auth.uid()));

-- ── Payout: credit the gold agent KES <amount> on assignment ────────────────────
-- SECURITY DEFINER so it can write the gold agent's wallet despite the
-- self-only insert policy on agent_wallets.
create or replace function public.credit_gold_assist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.gold_agent_id is not null and coalesce(new.amount, 0) > 0 then
    insert into public.agent_wallets
      (agent_id, total_earned, total_withdrawn, available_balance, tx_type, description)
    values
      (new.gold_agent_id, new.amount, 0, new.amount, 'credit',
       'Assist commission — onboarded admin ' || coalesce(nullif(new.admin_name, ''), '(unspecified)'));

    update public.agents
       set total_commission = coalesce(total_commission, 0) + new.amount
     where id = new.gold_agent_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_credit_gold_assist on public.agent_assists;
create trigger trg_credit_gold_assist
  after insert on public.agent_assists
  for each row execute function public.credit_gold_assist();

-- Refresh the PostgREST schema cache so the new table is immediately visible.
notify pgrst, 'reload schema';

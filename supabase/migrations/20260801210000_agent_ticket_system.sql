-- Migration: agent tickets — the conversation channel between bronze and gold
-- sales agents.
--
-- Until now the only thing that travelled between two agents was an assist
-- request: one note, written once, with no way to answer it. Everything after
-- that happened on WhatsApp and phone calls, so nothing about how an admin was
-- onboarded — what was asked, what was promised, what actually got done — was
-- in the system.
--
-- A ticket is a subject plus a thread. Either side can keep writing until the
-- matter is settled, and the whole exchange stays attached to the ticket.
--
--   open ──first reply from the assignee──> in_progress ──> resolved ──> closed
--     │                                          │              │
--     └───────── waiting (ball in the ─────────┘              └── a reply
--                other party's court)                              reopens it
--
-- Direction is deliberately not fixed: a bronze agent asks a gold agent for
-- help, and a gold agent chases a bronze agent for the details they need. An
-- unassigned ticket is the help desk — every gold agent sees it until one of
-- them claims it, so "nobody answered" cannot happen quietly.
--
-- Every statement is IF NOT EXISTS / OR REPLACE — safe to re-run.

-- ==================== 1. Tables ====================

create sequence if not exists public.agent_ticket_no_seq;

create table if not exists public.agent_tickets (
  id                 uuid primary key default gen_random_uuid(),
  ticket_no          text unique,
  -- Who started the conversation, and who owes an answer. assigned_agent_id is
  -- null while the ticket is sitting in the gold-agent pool unclaimed.
  opened_by_agent_id uuid not null references public.agents(id) on delete cascade,
  assigned_agent_id  uuid          references public.agents(id) on delete set null,
  subject            text not null,
  category           text not null default 'other',
  priority           text not null default 'normal',
  status             text not null default 'open',
  -- Optional context: the assist this conversation is about.
  assist_id          uuid references public.agent_assists(id) on delete set null,
  admin_name         text,
  -- Denormalised so the list can sort and badge without reading every message.
  last_message_at    timestamptz default now(),
  message_count      integer     default 0,
  first_response_at  timestamptz,
  claimed_at         timestamptz,
  resolved_at        timestamptz,
  closed_at          timestamptz,
  closed_by_agent_id uuid references public.agents(id) on delete set null,
  resolution         text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

comment on table public.agent_tickets is
  'Threaded conversations between sales agents (bronze ↔ gold). The ticket holds the subject and state; the words live in agent_ticket_messages.';
comment on column public.agent_tickets.assigned_agent_id is
  'The agent who owes an answer. NULL means the ticket is in the gold-agent pool and any gold agent may claim it.';
comment on column public.agent_tickets.message_count is
  'Maintained by trigger. Denormalised so the ticket list never has to count messages.';

alter table public.agent_tickets drop constraint if exists agent_tickets_status_check;
alter table public.agent_tickets add constraint agent_tickets_status_check
  check (status in ('open', 'in_progress', 'waiting', 'resolved', 'closed'));

alter table public.agent_tickets drop constraint if exists agent_tickets_priority_check;
alter table public.agent_tickets add constraint agent_tickets_priority_check
  check (priority in ('low', 'normal', 'high', 'urgent'));

alter table public.agent_tickets drop constraint if exists agent_tickets_category_check;
alter table public.agent_tickets add constraint agent_tickets_category_check
  check (category in ('onboarding', 'lead_support', 'commission', 'training', 'system', 'other'));

create table if not exists public.agent_ticket_messages (
  id              uuid primary key default gen_random_uuid(),
  ticket_id       uuid not null references public.agent_tickets(id) on delete cascade,
  sender_agent_id uuid          references public.agents(id) on delete set null,
  body            text not null,
  -- Status changes are written into the thread as system lines so the history
  -- reads in one column instead of "the dates say something happened here".
  is_system       boolean not null default false,
  created_at      timestamptz default now()
);

comment on column public.agent_ticket_messages.is_system is
  'A status change written into the thread (claimed / resolved / reopened), not something an agent typed.';

-- Per-agent read stamp. A ticket is unread when last_message_at is newer than
-- the reader's last_read_at — which also works for pool tickets, where the set
-- of readers is not known up front.
create table if not exists public.agent_ticket_reads (
  ticket_id    uuid not null references public.agent_tickets(id) on delete cascade,
  agent_id     uuid not null references public.agents(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (ticket_id, agent_id)
);

create index if not exists idx_agent_tickets_assigned
  on public.agent_tickets (assigned_agent_id, status, last_message_at desc);
create index if not exists idx_agent_tickets_opened_by
  on public.agent_tickets (opened_by_agent_id, status, last_message_at desc);
create index if not exists idx_agent_tickets_pool
  on public.agent_tickets (created_at desc) where assigned_agent_id is null;
create index if not exists idx_agent_ticket_messages_ticket
  on public.agent_ticket_messages (ticket_id, created_at);
create index if not exists idx_agent_ticket_reads_agent
  on public.agent_ticket_reads (agent_id);

-- ==================== 2. Helpers ====================
-- Both take no caller-supplied identity: they answer only about auth.uid(), so
-- an agent cannot use them to probe anyone else's tier or inbox.

create or replace function public.current_agent_is_gold()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select agent_plan = 'gold' from public.agents where user_id = auth.uid() limit 1),
    false
  );
$$;

-- The single definition of "may this agent see this ticket", used by every
-- policy below. SECURITY DEFINER so the messages policies can consult
-- agent_tickets without tripping over its own RLS.
create or replace function public.can_view_agent_ticket(p_ticket uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.agent_tickets t
     where t.id = p_ticket
       and (
         t.opened_by_agent_id = public.get_agent_id_for_user(auth.uid())
         or t.assigned_agent_id = public.get_agent_id_for_user(auth.uid())
         -- The pool: unclaimed tickets are visible to every gold agent.
         or (t.assigned_agent_id is null and public.current_agent_is_gold())
       )
  );
$$;

-- A closed ticket is a record, not a conversation — nothing more may be posted
-- to it until someone reopens it.
create or replace function public.agent_ticket_accepts_messages(p_ticket uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.agent_tickets t
     where t.id = p_ticket and t.status <> 'closed'
  );
$$;

-- ==================== 3. Ticket guard ====================
-- RLS decides who may touch a row. This decides what they may do to it: who
-- owns the ticket never changes, an unclaimed ticket is claimed by exactly one
-- gold agent, and the counters are the trigger's business, not the client's.
--
-- auth.uid() is NULL for service_role and during migrations — those skip the
-- actor checks deliberately, so support can still unstick a ticket.

create or replace function public.agent_tickets_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := public.get_agent_id_for_user(auth.uid());
begin
  if tg_op = 'INSERT' then
    new.ticket_no       := coalesce(nullif(new.ticket_no, ''),
                                    'TKT-' || lpad(nextval('public.agent_ticket_no_seq')::text, 5, '0'));
    -- A ticket always starts at the beginning, whatever the client posted.
    new.status            := 'open';
    new.message_count     := 0;
    new.last_message_at   := now();
    new.first_response_at := null;
    new.resolved_at       := null;
    new.closed_at         := null;
    new.created_at        := now();
    new.updated_at        := now();

    if new.assigned_agent_id is not null then
      if new.assigned_agent_id = new.opened_by_agent_id then
        raise exception 'An agent cannot open a ticket against themselves';
      end if;
      new.claimed_at := now();
    elsif actor is not null and public.current_agent_is_gold() then
      -- The pool is the bronze agent's route to "any gold agent". A gold agent
      -- has no such pool to post into, so they must name the agent they mean —
      -- otherwise the ticket would be visible to every gold agent and to none
      -- of the bronze agents, including the one it was meant for.
      raise exception 'Choose the agent this ticket is for';
    end if;

    if coalesce(trim(new.subject), '') = '' then
      raise exception 'A ticket needs a subject';
    end if;
    return new;
  end if;

  -- Identity and history are fixed once the ticket exists.
  if new.id is distinct from old.id
     or new.ticket_no is distinct from old.ticket_no
     or new.opened_by_agent_id is distinct from old.opened_by_agent_id
     or new.created_at is distinct from old.created_at then
    raise exception 'A ticket''s identity cannot be changed';
  end if;

  if new.assigned_agent_id is distinct from old.assigned_agent_id then
    if old.assigned_agent_id is not null then
      raise exception 'This ticket is already assigned to another agent';
    end if;
    -- Claiming: only the claiming gold agent may put their own name on it.
    if actor is not null then
      if new.assigned_agent_id is distinct from actor then
        raise exception 'A ticket can only be claimed by the agent taking it on';
      end if;
      if not public.current_agent_is_gold() then
        raise exception 'Only a gold agent can claim a ticket from the pool';
      end if;
      if actor = old.opened_by_agent_id then
        raise exception 'You cannot claim your own ticket';
      end if;
    end if;
    new.claimed_at := coalesce(new.claimed_at, now());
  end if;

  -- What the ticket is about belongs to the agent who raised it. A gold agent
  -- can reach an unclaimed ticket (they have to, to claim it) — that is not a
  -- licence to rewrite the subject of a request someone else made.
  if actor is not null
     and actor is distinct from old.opened_by_agent_id
     and (new.subject    is distinct from old.subject
       or new.category   is distinct from old.category
       or new.assist_id  is distinct from old.assist_id
       or new.admin_name is distinct from old.admin_name) then
    raise exception 'Only the agent who opened this ticket can edit its details';
  end if;

  if new.status is distinct from old.status or new.priority is distinct from old.priority then
    if actor is not null
       and actor is distinct from old.opened_by_agent_id
       and actor is distinct from coalesce(new.assigned_agent_id, old.assigned_agent_id) then
      raise exception 'Only the agents on this ticket can work it';
    end if;
  end if;

  if new.status is distinct from old.status then

    if new.status = 'resolved' then
      new.resolved_at := now();
    elsif new.status = 'closed' then
      new.closed_at          := now();
      new.closed_by_agent_id := coalesce(new.closed_by_agent_id, actor);
    elsif old.status in ('resolved', 'closed') then
      -- Reopened: clear the stamps so "resolved 3d ago" cannot outlive the fact.
      new.resolved_at        := null;
      new.closed_at          := null;
      new.closed_by_agent_id := null;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_agent_tickets_guard on public.agent_tickets;
create trigger trg_agent_tickets_guard
  before insert or update on public.agent_tickets
  for each row execute function public.agent_tickets_guard();

-- ==================== 4. Message side effects ====================
-- Posting is the only thing an agent does often, so everything the list needs
-- is maintained here rather than asked for later: the ordering stamp, the
-- count, the "who answered first" clock, and the sender's own read stamp
-- (nobody should come back to their own message marked unread).
--
-- SECURITY DEFINER because the ticket UPDATE crosses the update policy for a
-- gold agent replying in the pool, and because the read stamp is written on
-- behalf of the sender.

create or replace function public.agent_ticket_messages_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.agent_tickets%rowtype;
begin
  select * into t from public.agent_tickets where id = new.ticket_id;
  if not found then
    return new;
  end if;

  update public.agent_tickets
     set last_message_at   = new.created_at,
         message_count     = coalesce(message_count, 0) + 1,
         -- The clock that says how long the other agent waited, stopped by the
         -- first reply from anyone other than the person who opened it.
         first_response_at = case
           when first_response_at is null
                and new.is_system = false
                and new.sender_agent_id is distinct from t.opened_by_agent_id
             then new.created_at
           else first_response_at
         end,
         -- A real reply moves the ticket on: an answered ticket is in progress,
         -- and answering a resolved one reopens it. A brand new ticket stays
         -- 'open' — the opener's own first message is the request, not a reply.
         -- 'closed' is left alone: the insert policy already refused to post.
         status = case
           when new.is_system then status
           when status = 'open'
             then case when new.sender_agent_id is distinct from t.opened_by_agent_id
                       then 'in_progress' else status end
           when status in ('waiting', 'resolved') then 'in_progress'
           else status
         end,
         updated_at = now()
   where id = new.ticket_id;

  if new.sender_agent_id is not null then
    insert into public.agent_ticket_reads (ticket_id, agent_id, last_read_at)
    values (new.ticket_id, new.sender_agent_id, new.created_at)
    on conflict (ticket_id, agent_id)
      do update set last_read_at = greatest(public.agent_ticket_reads.last_read_at, excluded.last_read_at);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_agent_ticket_messages_after_insert on public.agent_ticket_messages;
create trigger trg_agent_ticket_messages_after_insert
  after insert on public.agent_ticket_messages
  for each row execute function public.agent_ticket_messages_after_insert();

-- ==================== 5. Opening a ticket ====================
-- A ticket and its first message are one act. Two round trips from the browser
-- can leave a subject with nothing under it, which reads as an agent who asked
-- for help and said nothing — so both rows are written here, in one statement.
-- SECURITY INVOKER: the caller's own RLS still decides whether they may.

create or replace function public.open_agent_ticket(
  p_subject   text,
  p_body      text,
  p_assigned  uuid    default null,
  p_category  text    default 'other',
  p_priority  text    default 'normal',
  p_assist_id uuid    default null,
  p_admin_name text   default null
)
returns public.agent_tickets
language plpgsql
security invoker
set search_path = public
as $$
declare
  me     uuid := public.get_agent_id_for_user(auth.uid());
  ticket public.agent_tickets;
begin
  if me is null then
    raise exception 'Only a sales agent can open a ticket';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'Say what you need in the first message';
  end if;

  insert into public.agent_tickets
    (opened_by_agent_id, assigned_agent_id, subject, category, priority, assist_id, admin_name)
  values
    (me, p_assigned, trim(p_subject), coalesce(p_category, 'other'),
     coalesce(p_priority, 'normal'), p_assist_id, nullif(trim(coalesce(p_admin_name, '')), ''))
  returning * into ticket;

  insert into public.agent_ticket_messages (ticket_id, sender_agent_id, body)
  values (ticket.id, me, trim(p_body));

  -- Re-read: the message trigger has just moved the counters on.
  select * into ticket from public.agent_tickets where id = ticket.id;
  return ticket;
end;
$$;

-- ==================== 6. Claiming from the pool ====================
-- Two gold agents opening the same pool ticket both press Claim. The row lock
-- makes the second one lose cleanly with a message they can act on, instead of
-- silently overwriting the first.

create or replace function public.claim_agent_ticket(p_ticket uuid)
returns public.agent_tickets
language plpgsql
security invoker
set search_path = public
as $$
declare
  me     uuid := public.get_agent_id_for_user(auth.uid());
  ticket public.agent_tickets;
begin
  select * into ticket from public.agent_tickets where id = p_ticket for update;
  if not found then
    -- The row may well exist — claiming it a moment ago took it out of this
    -- agent's pool, and RLS then hides it. "Not found" would read as a bug, so
    -- say the thing that is true either way.
    raise exception 'That ticket is no longer waiting to be claimed — another gold agent may have taken it';
  end if;
  if ticket.assigned_agent_id is not null then
    if ticket.assigned_agent_id = me then
      return ticket;
    end if;
    raise exception 'Another gold agent has already taken this ticket';
  end if;

  update public.agent_tickets
     set assigned_agent_id = me
   where id = p_ticket
  returning * into ticket;

  insert into public.agent_ticket_messages (ticket_id, sender_agent_id, body, is_system)
  values (p_ticket, me, 'took this ticket', true);

  select * into ticket from public.agent_tickets where id = p_ticket;
  return ticket;
end;
$$;

-- ==================== 7. RLS ====================

alter table public.agent_tickets         enable row level security;
alter table public.agent_ticket_messages enable row level security;
alter table public.agent_ticket_reads    enable row level security;

-- Tickets ---------------------------------------------------------------------

drop policy if exists "tickets_select_involved" on public.agent_tickets;
create policy "tickets_select_involved"
on public.agent_tickets for select to authenticated
using (
  opened_by_agent_id = public.get_agent_id_for_user(auth.uid())
  or assigned_agent_id = public.get_agent_id_for_user(auth.uid())
  or (assigned_agent_id is null and public.current_agent_is_gold())
);

-- An agent opens tickets as themselves and nobody else.
drop policy if exists "tickets_insert_own" on public.agent_tickets;
create policy "tickets_insert_own"
on public.agent_tickets for insert to authenticated
with check (opened_by_agent_id = public.get_agent_id_for_user(auth.uid()));

-- Both parties may work the ticket; a gold agent may reach an unclaimed one in
-- order to claim it. What they may actually change is the guard's business.
drop policy if exists "tickets_update_involved" on public.agent_tickets;
create policy "tickets_update_involved"
on public.agent_tickets for update to authenticated
using (
  opened_by_agent_id = public.get_agent_id_for_user(auth.uid())
  or assigned_agent_id = public.get_agent_id_for_user(auth.uid())
  or (assigned_agent_id is null and public.current_agent_is_gold())
)
with check (
  opened_by_agent_id = public.get_agent_id_for_user(auth.uid())
  or assigned_agent_id = public.get_agent_id_for_user(auth.uid())
);

-- No delete policy: a ticket is the record of what was said. Closing is the
-- end of a ticket, not deletion.

-- Messages --------------------------------------------------------------------

drop policy if exists "ticket_messages_select_involved" on public.agent_ticket_messages;
create policy "ticket_messages_select_involved"
on public.agent_ticket_messages for select to authenticated
using (public.can_view_agent_ticket(ticket_id));

drop policy if exists "ticket_messages_insert_involved" on public.agent_ticket_messages;
create policy "ticket_messages_insert_involved"
on public.agent_ticket_messages for insert to authenticated
with check (
  sender_agent_id = public.get_agent_id_for_user(auth.uid())
  and public.can_view_agent_ticket(ticket_id)
  and public.agent_ticket_accepts_messages(ticket_id)
);

-- Messages are neither edited nor deleted: "they never told me that" has to be
-- answerable, which needs the thread to be exactly what was sent.

-- Read stamps -----------------------------------------------------------------

drop policy if exists "ticket_reads_own" on public.agent_ticket_reads;
create policy "ticket_reads_own"
on public.agent_ticket_reads for all to authenticated
using (agent_id = public.get_agent_id_for_user(auth.uid()))
with check (
  agent_id = public.get_agent_id_for_user(auth.uid())
  and public.can_view_agent_ticket(ticket_id)
);

-- ==================== 8. Realtime ====================
-- The publication is per-table on this project. Without these a reply only
-- appears on refresh, and a ticket system nobody notices in time is a slower
-- version of the phone call it replaced.

do $$ begin
  alter publication supabase_realtime add table public.agent_tickets;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.agent_ticket_messages;
exception when duplicate_object then null; end $$;

-- Refresh the PostgREST schema cache so the new tables and RPCs are
-- immediately visible.
notify pgrst, 'reload schema';

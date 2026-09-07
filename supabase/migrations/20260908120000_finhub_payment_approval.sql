-- ============================================================================
-- THE FINHUB PAYMENT APPROVAL PIPELINE
-- ============================================================================
-- WHAT WAS MISSING
-- ----------------
-- Releasing money to a sales agent was a two-click, single-signature act. An
-- agent inserted a row into `agent_wallets` with tx_type='withdrawal'; a super
-- admin flipped `status` to 'approved'. Nothing validated the claim, nobody
-- countersigned it, no document was ever attached to it, no execution step
-- existed, nothing was reconciled against the bank, and the only record left
-- behind was one free-text audit_logs line.
--
-- src/pages/super-admin-dashboard/paymentApprovalWorkflow.test.jsx says this
-- in its own header and pins the behaviour. Read that file before changing
-- anything here -- it is the description of what this migration replaces.
--
-- WHAT THIS ADDS
-- --------------
-- One request, carried through the whole specified pipeline:
--
--   Agent Portal   ->  finhub_submit_payment_request
--        v
--   FinHub         ->  finhub_validate_payment_request       (client, invoice,
--        v                                                    amount, balance,
--        v                                                    documents, dupes)
--   Super Admin    ->  finhub_decide_payment_request         YES / NO / WAIT
--        v                                                    + reason
--   Verification   ->  finhub_verify_payment_decision        second step
--        v
--   FinHub         ->  finhub_execute_payment_request        money moves here
--        v
--   Confirmation   ->  finhub_confirm_payment_request        bank says credited
--        v
--   Reconciliation ->  finhub_reconcile_payment_request      matched -> complete
--
-- Every one of those writes an immutable row in payment_request_events.
--
-- WHY THE DECISION IS TWO STATEMENTS AND NOT ONE
-- ----------------------------------------------
-- A super admin who mis-clicks Approve on a KES 400,000 request has released
-- the money. The guarantee flow (20260904160000) already settled how this app
-- handles an irreversible click: render the exact terms, hash them, and refuse
-- the second call unless it carries back the same digest computed from the
-- request AS IT STANDS NOW. That is not decoration. It means a request edited,
-- revalidated or already settled between the two steps produces a different
-- digest, and the confirmation is refused rather than applied to a thing the
-- approver never actually read. Same mechanism here, same reason.
--
-- Between the two steps the row sits at `pending_approval` carrying a
-- `pending_decision`. The status DOES NOT MOVE until the second step lands, so
-- a decision abandoned halfway is a decision that never happened.
--
-- WHY THE WALLET GATE IS A TRIGGER
-- --------------------------------
-- `agents_insert_own_wallet` lets an agent insert their own wallet rows and
-- checks only agent_id. Leave it alone and every gate above is theatre: the
-- agent posts the withdrawal row directly and the pipeline is bypassed by one
-- PATCH. Section 8 refuses any withdrawal insert that does not carry a
-- reference_id pointing at a payment_request THIS FILE has already walked to
-- 'processing' -- a status only finhub_execute_payment_request can set, and
-- only after two-step approval. The wallet row becomes an OUTPUT of the
-- pipeline rather than its input.
--
-- Existing rows are left where they are. Section 9 lifts the ones still
-- pending into payment_requests so the queue is not silently emptied, but it
-- does not rewrite history on settled ones.
--
-- WHY THERE IS NO UPDATE POLICY ANYWHERE BELOW
-- --------------------------------------------
-- Every transition is a SECURITY DEFINER function that checks the caller's
-- role, checks the transition is legal, and writes the event. A table-level
-- UPDATE policy would let a client PATCH `status` straight to 'executed' and
-- skip all three. So `authenticated` gets SELECT on these tables and nothing
-- else, and the RPCs are the only writers.
--
-- Idempotent -- safe to re-run.
-- ============================================================================

begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. VOCABULARY
--
--    The thirteen statuses are the specified set, in pipeline order. Two of
--    them ('draft', 'cancelled') are the requester's own; the rest belong to
--    FinHub or the approver.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_request_status') then
    create type public.payment_request_status as enum (
      'draft',                    -- being written, nobody else can see it move
      'submitted',                -- the agent has sent it
      'under_validation',         -- FinHub is checking it
      'pending_approval',         -- validated, waiting on the super admin
      'approved',                 -- YES, and the second step confirmed it
      'rejected',                 -- NO, confirmed
      'on_hold',                  -- WAIT, confirmed, with a reason
      'processing',               -- FinHub is paying it out
      'executed',                 -- paid, reference captured
      'failed',                   -- execution or bank confirmation failed
      'cancelled',                -- withdrawn by the requester
      'reconciliation_required',  -- executed, not yet matched to bank
      'completed'                 -- matched. terminal, and the only happy end
    );
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_request_decision') then
    -- YES / NO / WAIT, as the brief names them.
    create type public.payment_request_decision as enum ('approve', 'reject', 'hold');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_request_kind') then
    create type public.payment_request_kind as enum (
      'agent_commission',   -- the path that used to be a bare agent_wallets row
      'staff_payment',
      'supplier_payment',
      'client_refund',
      'expense_reimbursement',
      'other'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. THE REQUEST
--
--    One row is the whole life of one payment. It is deliberately wide: the
--    audit requirement is that a single record can answer who asked, what
--    FinHub found, who decided, who verified, what was paid, and whether the
--    bank agreed -- without joining seven tables at the moment somebody is
--    disputing a payout.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_requests (
  id                       uuid primary key default gen_random_uuid(),
  admin_id                 uuid,                       -- tenant. set by trigger.
  request_no               text unique,                -- human handle, set by trigger

  request_type             public.payment_request_kind not null default 'agent_commission',
  status                   public.payment_request_status not null default 'draft',

  -- WHO IT IS FOR ---------------------------------------------------------
  agent_id                 uuid references public.agents(id)  on delete set null,
  manager_id               uuid references public.agents(id)  on delete set null,
  client_id                uuid references public.clients(id) on delete set null,
  invoice_id               uuid,                       -- company_invoices.id, soft FK
  invoice_ref              text,                       -- snapshot of invoice_no

  -- WHAT IS BEING PAID ----------------------------------------------------
  amount                   numeric(15,2) not null check (amount > 0),
  currency                 text not null default 'KES',
  payment_method           text,
  payee_name               text,
  payee_account            text,
  payee_phone              text,
  narrative                text,

  -- SUBMISSION ------------------------------------------------------------
  submitted_by             uuid references public.user_profiles(id) on delete set null,
  submitted_at             timestamptz,

  -- FINHUB VALIDATION -----------------------------------------------------
  validation_passed        boolean,
  validation_result        jsonb  not null default '{}'::jsonb,
  validated_by             uuid references public.user_profiles(id) on delete set null,
  validated_at             timestamptz,

  -- DECISION, STEP ONE ----------------------------------------------------
  pending_decision         public.payment_request_decision,
  pending_reason           text,
  pending_decided_by       uuid references public.user_profiles(id) on delete set null,
  pending_decided_at       timestamptz,
  pending_terms_hash       text,
  bulk_batch_id            uuid,                       -- set when decided in bulk

  -- DECISION, STEP TWO (this is what makes it real) ------------------------
  decision                 public.payment_request_decision,
  decision_reason          text,
  decided_by               uuid references public.user_profiles(id) on delete set null,
  decided_at               timestamptz,
  verified_by              uuid references public.user_profiles(id) on delete set null,
  verified_at              timestamptz,

  -- EXECUTION -------------------------------------------------------------
  executed_by              uuid references public.user_profiles(id) on delete set null,
  executed_at              timestamptz,
  payment_reference        text,
  failure_reason           text,
  wallet_entry_id          uuid,                       -- the agent_wallets row it produced

  -- BANK CONFIRMATION + RECONCILIATION ------------------------------------
  bank_confirmed           boolean,
  bank_confirmed_at        timestamptz,
  bank_reference           text,
  reconciled_by            uuid references public.user_profiles(id) on delete set null,
  reconciled_at            timestamptz,
  reconciliation_note      text,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_payreq_admin      on public.payment_requests (admin_id);
create index if not exists idx_payreq_status     on public.payment_requests (status);
create index if not exists idx_payreq_agent      on public.payment_requests (agent_id);
create index if not exists idx_payreq_manager    on public.payment_requests (manager_id);
create index if not exists idx_payreq_client     on public.payment_requests (client_id);
create index if not exists idx_payreq_invoice    on public.payment_requests (invoice_id);
create index if not exists idx_payreq_created    on public.payment_requests (created_at desc);
create index if not exists idx_payreq_batch      on public.payment_requests (bulk_batch_id)
  where bulk_batch_id is not null;

-- Duplicate detection leans on this: same agent, same amount, same invoice,
-- still alive. Partial so settled rows do not bloat it.
create index if not exists idx_payreq_dupe_probe
  on public.payment_requests (agent_id, invoice_id, amount)
  where status in ('draft','submitted','under_validation','pending_approval',
                   'on_hold','approved','processing');

-- ---------------------------------------------------------------------------
-- 3. SUPPORTING DOCUMENTS
--
--    The files live in the private `payment-request-documents` bucket, pathed
--    <admin_id>/<request_id>/<file>. This table is the index over them, and it
--    is what the validator counts when it asks "is this documented?".
-- ---------------------------------------------------------------------------
create table if not exists public.payment_request_documents (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.payment_requests(id) on delete cascade,
  admin_id      uuid,
  document_type text not null default 'other'
                check (document_type in ('invoice','contract','purchase_agreement',
                                         'delivery_evidence','receipt','id_document','other')),
  file_name     text not null,
  file_path     text not null,                 -- storage object name, not a URL
  mime_type     text,
  file_size     bigint,
  uploaded_by   uuid references public.user_profiles(id) on delete set null,
  uploaded_at   timestamptz not null default now()
);

create index if not exists idx_payreq_docs_request on public.payment_request_documents (request_id);
create index if not exists idx_payreq_docs_admin   on public.payment_request_documents (admin_id);

-- ---------------------------------------------------------------------------
-- 4. THE AUDIT TRAIL
--
--    Append-only, and enforced as such in section 7: `authenticated` is granted
--    SELECT and INSERT is denied at policy level, so the only writer is a
--    SECURITY DEFINER function. A trigger additionally refuses UPDATE and
--    DELETE outright, so not even a future migration can quietly edit one
--    without noticing what it is doing.
--
--    Every row carries the money and the actor, denormalised on purpose. An
--    audit line that has to join `agents` to say who was paid stops being
--    readable the day that agent row is deleted.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_request_events (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references public.payment_requests(id) on delete cascade,
  admin_id       uuid,
  seq            bigserial,

  event_type     text not null,               -- submitted | validated | decided | verified | ...
  from_status    public.payment_request_status,
  to_status      public.payment_request_status,

  actor_id       uuid,
  actor_name     text,
  actor_role     text,
  reason         text,
  detail         jsonb not null default '{}'::jsonb,

  amount         numeric(15,2),
  occurred_at    timestamptz not null default now()
);

create index if not exists idx_payreq_events_request on public.payment_request_events (request_id, seq);
create index if not exists idx_payreq_events_admin   on public.payment_request_events (admin_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- 5. HOUSEKEEPING TRIGGERS
--    Tenant stamping, the request number, updated_at.
-- ---------------------------------------------------------------------------
create or replace function public.set_payment_request_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agent_admin uuid;
begin
  if new.admin_id is null then
    -- `agents` carries no admin_id of its own -- the tenancy work in
    -- 20260817120000 stamped assets, payments and clients but left the agent
    -- roster alone. So the tenant is resolved through the agent's LOGIN, which
    -- is the same route tenant_of_user() takes everywhere else. Falling back to
    -- the caller's tenant covers a request raised by an administrator on an
    -- agent's behalf; the client's tenant is the last resort.
    select public.tenant_of_user(a.user_id) into v_agent_admin
      from public.agents a
     where a.id = new.agent_id;

    new.admin_id := coalesce(
      v_agent_admin,
      public.current_admin_id(),
      (select c.admin_id from public.clients c where c.id = new.client_id)
    );
  end if;

  if new.request_no is null then
    -- PR-<yymm>-<6 random>. Short enough to read down a phone, unique enough
    -- that two tenants submitting in the same minute do not collide.
    new.request_no := 'PR-' || to_char(now(), 'YYMM') || '-' ||
                      upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6));
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.set_payment_request_defaults() from public, anon, authenticated;

drop trigger if exists trg_payment_requests_defaults on public.payment_requests;
create trigger trg_payment_requests_defaults
  before insert on public.payment_requests
  for each row execute function public.set_payment_request_defaults();

create or replace function public.touch_payment_request()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_payment_requests_touch on public.payment_requests;
create trigger trg_payment_requests_touch
  before update on public.payment_requests
  for each row execute function public.touch_payment_request();

-- ---------------------------------------------------------------------------
-- 6. THE STATUS MACHINE
--
--    Declared once, here, rather than re-checked inside each RPC. Every RPC
--    below calls payment_request_move(), so a transition that is not in this
--    table cannot happen however the RPC is written -- including by a future
--    RPC nobody has written yet.
-- ---------------------------------------------------------------------------
create or replace function public.payment_request_transition_ok(
  p_from public.payment_request_status,
  p_to   public.payment_request_status
)
returns boolean
language sql
immutable
as $$
  select (p_from, p_to) in (
    ('draft',                   'submitted'),
    ('draft',                   'cancelled'),
    ('submitted',               'under_validation'),
    ('submitted',               'cancelled'),
    ('under_validation',        'pending_approval'),
    ('under_validation',        'cancelled'),
    ('pending_approval',        'approved'),
    ('pending_approval',        'rejected'),
    ('pending_approval',        'on_hold'),
    ('pending_approval',        'cancelled'),
    -- A held request can be picked up again, settled, or dropped.
    ('on_hold',                 'pending_approval'),
    ('on_hold',                 'approved'),
    ('on_hold',                 'rejected'),
    ('on_hold',                 'cancelled'),
    ('approved',                'processing'),
    ('approved',                'cancelled'),
    ('processing',              'executed'),
    ('processing',              'failed'),
    ('executed',                'reconciliation_required'),
    ('executed',                'failed'),
    ('reconciliation_required', 'completed'),
    ('reconciliation_required', 'failed'),
    -- A failure is recoverable: it goes back in front of the approver rather
    -- than being retried silently by whoever noticed.
    ('failed',                  'pending_approval'),
    ('failed',                  'cancelled')
  );
$$;

comment on function public.payment_request_transition_ok(public.payment_request_status, public.payment_request_status) is
  'The whole status machine. rejected, completed and cancelled are terminal -- they appear only on the right.';

-- Move a request and record the move. The single writer of `status`.
create or replace function public.payment_request_move(
  p_id         uuid,
  p_to         public.payment_request_status,
  p_event      text,
  p_reason     text default null,
  p_detail     jsonb default '{}'::jsonb
)
returns public.payment_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row    public.payment_requests;
  v_from   public.payment_request_status;
  v_actor  uuid := auth.uid();
  v_name   text;
  v_role   text;
begin
  select * into v_row from public.payment_requests where id = p_id for update;
  if not found then
    raise exception 'Payment request not found.' using errcode = 'P0002';
  end if;

  v_from := v_row.status;

  if v_from is distinct from p_to and not public.payment_request_transition_ok(v_from, p_to) then
    raise exception 'A % request cannot move to %.', v_from, p_to using errcode = 'P0001';
  end if;

  select up.full_name, up.role::text into v_name, v_role
    from public.user_profiles up where up.id = v_actor;

  update public.payment_requests
     set status = p_to
   where id = p_id
  returning * into v_row;

  insert into public.payment_request_events
    (request_id, admin_id, event_type, from_status, to_status,
     actor_id, actor_name, actor_role, reason, detail, amount)
  values
    (p_id, v_row.admin_id, p_event, v_from, p_to,
     v_actor, v_name, v_role, p_reason, coalesce(p_detail, '{}'::jsonb), v_row.amount);

  return v_row;
end;
$$;

revoke execute on function public.payment_request_move(uuid, public.payment_request_status, text, text, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. RLS
--
--    SELECT only. Everything that writes is a SECURITY DEFINER function whose
--    own body checks the caller.
--
--    Visibility mirrors the rule the rest of the app already enforces: an
--    agent sees their own, a manager sees their team's, an administrator sees
--    their tenant's, a super admin sees everything.
-- ---------------------------------------------------------------------------
alter table public.payment_requests          enable row level security;
alter table public.payment_request_documents enable row level security;
alter table public.payment_request_events    enable row level security;

-- Is this request mine, my team's, or my tenant's?
create or replace function public.can_see_payment_request(p_admin_id uuid, p_agent_id uuid, p_manager_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid;
begin
  if public.is_global_viewer() then
    return true;
  end if;

  v_me := public.get_agent_id_for_user(auth.uid());

  -- The agent who raised it.
  if v_me is not null and v_me = p_agent_id then
    return true;
  end if;

  -- The manager it was stamped to. Guarded because the hierarchy table only
  -- exists once 20260903120000 is applied, and this file must not depend on
  -- the order those two land in.
  if v_me is not null and v_me = p_manager_id then
    return true;
  end if;

  -- Anyone administering the tenant it belongs to.
  if public.is_hierarchy_admin() and p_admin_id is not null
     and p_admin_id = public.current_admin_id() then
    return true;
  end if;

  return false;
end;
$$;

revoke execute on function public.can_see_payment_request(uuid, uuid, uuid) from public, anon;
grant  execute on function public.can_see_payment_request(uuid, uuid, uuid) to authenticated;

drop policy if exists payreq_select      on public.payment_requests;
drop policy if exists payreq_docs_select on public.payment_request_documents;
drop policy if exists payreq_events_select on public.payment_request_events;

create policy payreq_select on public.payment_requests
  for select to authenticated
  using (public.can_see_payment_request(admin_id, agent_id, manager_id));

create policy payreq_docs_select on public.payment_request_documents
  for select to authenticated
  using (exists (
    select 1 from public.payment_requests r
     where r.id = payment_request_documents.request_id
       and public.can_see_payment_request(r.admin_id, r.agent_id, r.manager_id)
  ));

create policy payreq_events_select on public.payment_request_events
  for select to authenticated
  using (exists (
    select 1 from public.payment_requests r
     where r.id = payment_request_events.request_id
       and public.can_see_payment_request(r.admin_id, r.agent_id, r.manager_id)
  ));

revoke all on public.payment_requests          from anon;
revoke all on public.payment_request_documents from anon;
revoke all on public.payment_request_events    from anon;

grant select on public.payment_requests          to authenticated;
grant select on public.payment_request_documents to authenticated;
grant select on public.payment_request_events    to authenticated;

-- The trail is append-only, and this is the part that means it.
create or replace function public.payment_request_events_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'payment_request_events is append-only; % is not permitted.', tg_op
    using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_payreq_events_no_update on public.payment_request_events;
create trigger trg_payreq_events_no_update
  before update or delete on public.payment_request_events
  for each row execute function public.payment_request_events_immutable();

-- ---------------------------------------------------------------------------
-- 8. THE WALLET GATE
--
--    See the header. Without this everything above is optional.
-- ---------------------------------------------------------------------------
create or replace function public.agent_wallet_withdrawal_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.payment_request_status;
begin
  if new.tx_type is distinct from 'withdrawal'::public.wallet_tx_type then
    return new;
  end if;

  if new.reference_id is null then
    raise exception
      'Withdrawals are raised through FinHub, not written directly. Submit a payment request instead.'
      using errcode = 'P0001';
  end if;

  select r.status into v_status
    from public.payment_requests r
   where r.id = new.reference_id;

  if v_status is null then
    raise exception 'That withdrawal does not reference a payment request.'
      using errcode = 'P0001';
  end if;

  -- 'processing' is the only status the executor sets before writing the
  -- wallet row, and only two-step approval can reach it.
  if v_status <> 'processing' then
    raise exception
      'Payment request % is %, not an approved payment being executed. Nothing has been paid.',
      new.reference_id, v_status
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke execute on function public.agent_wallet_withdrawal_gate() from public, anon, authenticated;

drop trigger if exists trg_agent_wallet_withdrawal_gate on public.agent_wallets;
create trigger trg_agent_wallet_withdrawal_gate
  before insert on public.agent_wallets
  for each row execute function public.agent_wallet_withdrawal_gate();

-- ---------------------------------------------------------------------------
-- 9. LIFT THE PENDING QUEUE ACROSS
--
--    Withdrawals still awaiting a decision become payment requests at
--    'pending_approval' with an explicit validation note saying they predate
--    validation. Settled rows are left alone: rewriting a decision that was
--    already taken would put words in the approver's mouth.
-- ---------------------------------------------------------------------------
insert into public.payment_requests
  (agent_id, amount, request_type, status, narrative,
   submitted_at, validation_passed, validation_result, created_at)
select
  w.agent_id,
  w.total_withdrawn,
  'agent_commission',
  'pending_approval',
  coalesce(w.description, 'Commission withdrawal request'),
  w.created_at,
  null,
  jsonb_build_object(
    'migrated_from', 'agent_wallets',
    'source_row',    w.id,
    'note',          'Raised before the FinHub pipeline existed. Never validated.'),
  w.created_at
  from public.agent_wallets w
 where w.tx_type = 'withdrawal'::public.wallet_tx_type
   and coalesce(w.status, 'pending') = 'pending'
   and not exists (
     select 1 from public.payment_requests r
      where r.validation_result->>'source_row' = w.id::text
   );

-- ---------------------------------------------------------------------------
-- 10. SUBMIT
-- ---------------------------------------------------------------------------
create or replace function public.finhub_submit_payment_request(
  p_amount         numeric,
  p_request_type   public.payment_request_kind default 'agent_commission',
  p_narrative      text default null,
  p_client_id      uuid default null,
  p_invoice_id     uuid default null,
  p_payment_method text default null,
  p_payee_name     text default null,
  p_payee_account  text default null,
  p_payee_phone    text default null,
  p_submit_now     boolean default true
)
returns public.payment_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row       public.payment_requests;
  v_agent     uuid := public.get_agent_id_for_user(auth.uid());
  v_manager   uuid;
  v_inv_ref   text;
begin
  if not public.is_staff_member() then
    raise exception 'Only staff may raise a payment request.' using errcode = '42501';
  end if;

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'A payment request needs an amount greater than zero.' using errcode = 'P0001';
  end if;

  -- The reporting line at the moment of asking, so a later reassignment does
  -- not move an old request onto a manager who never saw it. Same stance as
  -- 20260903120000's stamping.
  if v_agent is not null and to_regclass('public.agent_manager_assignments') is not null then
    execute
      'select manager_agent_id from public.agent_manager_assignments
        where agent_id = $1 and is_active and is_primary limit 1'
      into v_manager using v_agent;
  end if;

  if p_invoice_id is not null then
    select invoice_no into v_inv_ref from public.company_invoices where id = p_invoice_id;
  end if;

  insert into public.payment_requests
    (request_type, status, agent_id, manager_id, client_id, invoice_id, invoice_ref,
     amount, payment_method, payee_name, payee_account, payee_phone, narrative,
     submitted_by, submitted_at)
  values
    (p_request_type, 'draft', v_agent, v_manager, p_client_id, p_invoice_id, v_inv_ref,
     round(p_amount, 2), p_payment_method, p_payee_name, p_payee_account, p_payee_phone,
     nullif(btrim(coalesce(p_narrative, '')), ''),
     auth.uid(), case when p_submit_now then now() else null end)
  returning * into v_row;

  insert into public.payment_request_events
    (request_id, admin_id, event_type, to_status, actor_id, actor_name, actor_role, amount, detail)
  select v_row.id, v_row.admin_id, 'created', 'draft', auth.uid(), up.full_name, up.role::text, v_row.amount,
         jsonb_build_object('request_no', v_row.request_no)
    from public.user_profiles up where up.id = auth.uid();

  if p_submit_now then
    v_row := public.payment_request_move(v_row.id, 'submitted', 'submitted', null,
               jsonb_build_object('request_no', v_row.request_no));
  end if;

  return v_row;
end;
$$;

revoke execute on function public.finhub_submit_payment_request(numeric, public.payment_request_kind, text, uuid, uuid, text, text, text, text, boolean) from public, anon;
grant  execute on function public.finhub_submit_payment_request(numeric, public.payment_request_kind, text, uuid, uuid, text, text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. VALIDATE
--
--     Six checks, and the RESULT IS ADVISORY, not a gate. A failed validation
--     still reaches the super admin -- carrying every reason it failed --
--     because "FinHub thinks this is a duplicate" is exactly the kind of thing
--     a human should overrule knowingly rather than have silently bounced.
-- ---------------------------------------------------------------------------
create or replace function public.finhub_validate_payment_request(p_id uuid)
returns public.payment_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row       public.payment_requests;
  v_checks    jsonb := '[]'::jsonb;
  v_passed    boolean := true;
  v_docs      integer;
  v_dupes     integer;
  v_balance   numeric;
  v_inv_total numeric;
  v_inv_status text;
begin
  if not public.is_hierarchy_admin() then
    raise exception 'Only FinHub staff may validate a payment request.' using errcode = '42501';
  end if;

  select * into v_row from public.payment_requests where id = p_id;
  if not found then
    raise exception 'Payment request not found.' using errcode = 'P0002';
  end if;

  if v_row.status not in ('submitted', 'under_validation') then
    raise exception 'Only a submitted request can be validated; this one is %.', v_row.status
      using errcode = 'P0001';
  end if;

  if v_row.status = 'submitted' then
    v_row := public.payment_request_move(p_id, 'under_validation', 'validation_started');
  end if;

  -- 1. CLIENT ------------------------------------------------------------
  if v_row.client_id is null then
    v_checks := v_checks || jsonb_build_object(
      'check', 'client', 'ok', true, 'severity', 'info',
      'note', 'No client attached — not required for this request type.');
  elsif exists (select 1 from public.clients c where c.id = v_row.client_id) then
    v_checks := v_checks || jsonb_build_object('check', 'client', 'ok', true, 'note', 'Client on file.');
  else
    v_passed := false;
    v_checks := v_checks || jsonb_build_object(
      'check', 'client', 'ok', false, 'severity', 'error',
      'note', 'The client on this request no longer exists.');
  end if;

  -- 2. INVOICE -----------------------------------------------------------
  if v_row.invoice_id is null then
    v_checks := v_checks || jsonb_build_object(
      'check', 'invoice', 'ok', true, 'severity', 'info',
      'note', 'No invoice reference supplied.');
  else
    select total, status into v_inv_total, v_inv_status
      from public.company_invoices where id = v_row.invoice_id;

    if v_inv_total is null then
      v_passed := false;
      v_checks := v_checks || jsonb_build_object(
        'check', 'invoice', 'ok', false, 'severity', 'error',
        'note', 'The referenced invoice does not exist.');
    elsif v_inv_status = 'cancelled' then
      v_passed := false;
      v_checks := v_checks || jsonb_build_object(
        'check', 'invoice', 'ok', false, 'severity', 'error',
        'note', 'The referenced invoice is cancelled.');
    else
      v_checks := v_checks || jsonb_build_object(
        'check', 'invoice', 'ok', true,
        'note', format('Invoice %s, %s, total %s.', v_row.invoice_ref, v_inv_status, v_inv_total));
    end if;
  end if;

  -- 3. AMOUNT AGAINST THE INVOICE ----------------------------------------
  if v_inv_total is not null and v_row.amount > v_inv_total then
    v_passed := false;
    v_checks := v_checks || jsonb_build_object(
      'check', 'amount', 'ok', false, 'severity', 'error',
      'note', format('Requested %s exceeds the invoice total of %s.', v_row.amount, v_inv_total));
  else
    v_checks := v_checks || jsonb_build_object('check', 'amount', 'ok', true, 'note', 'Amount is within range.');
  end if;

  -- 4. WALLET BALANCE ----------------------------------------------------
  --    Only credits count towards what an agent may draw, and only
  --    withdrawals that were not rejected count against it. The old
  --    walletBalance subtracted every withdrawal row regardless of outcome;
  --    doing that here would under-state the balance and block good requests.
  if v_row.agent_id is not null then
    select coalesce(sum(
             case
               when w.tx_type = 'credit'::public.wallet_tx_type then w.total_earned
               when w.tx_type = 'withdrawal'::public.wallet_tx_type
                    and coalesce(w.status, 'pending') <> 'rejected' then -w.total_withdrawn
               else 0
             end), 0)
      into v_balance
      from public.agent_wallets w
     where w.agent_id = v_row.agent_id;

    if v_row.amount > v_balance then
      v_passed := false;
      v_checks := v_checks || jsonb_build_object(
        'check', 'balance', 'ok', false, 'severity', 'error',
        'note', format('Requested %s against an available balance of %s.', v_row.amount, v_balance),
        'available', v_balance);
    else
      v_checks := v_checks || jsonb_build_object(
        'check', 'balance', 'ok', true,
        'note', format('Available balance %s.', v_balance),
        'available', v_balance);
    end if;
  end if;

  -- 5. DOCUMENTATION -----------------------------------------------------
  select count(*) into v_docs
    from public.payment_request_documents d where d.request_id = p_id;

  if v_docs = 0 then
    v_passed := false;
    v_checks := v_checks || jsonb_build_object(
      'check', 'documents', 'ok', false, 'severity', 'warning',
      'note', 'No supporting document attached.', 'count', 0);
  else
    v_checks := v_checks || jsonb_build_object(
      'check', 'documents', 'ok', true,
      'note', format('%s supporting document(s) attached.', v_docs), 'count', v_docs);
  end if;

  -- 6. DUPLICATE RISK ----------------------------------------------------
  --    Same agent, same amount, still alive, raised within seven days. The
  --    invoice is compared only when both carry one.
  select count(*) into v_dupes
    from public.payment_requests r
   where r.id <> p_id
     and r.agent_id is not distinct from v_row.agent_id
     and r.amount = v_row.amount
     and r.created_at > now() - interval '7 days'
     and r.status in ('draft','submitted','under_validation','pending_approval',
                      'on_hold','approved','processing','executed',
                      'reconciliation_required','completed')
     and (v_row.invoice_id is null or r.invoice_id is not distinct from v_row.invoice_id);

  if v_dupes > 0 then
    v_passed := false;
    v_checks := v_checks || jsonb_build_object(
      'check', 'duplicate', 'ok', false, 'severity', 'warning',
      'note', format('%s similar request(s) in the last 7 days.', v_dupes), 'count', v_dupes);
  else
    v_checks := v_checks || jsonb_build_object(
      'check', 'duplicate', 'ok', true, 'note', 'No similar recent request.', 'count', 0);
  end if;

  update public.payment_requests
     set validation_passed = v_passed,
         validation_result = jsonb_build_object(
           'passed',     v_passed,
           'checked_at', now(),
           'checks',     v_checks),
         validated_by = auth.uid(),
         validated_at = now()
   where id = p_id
  returning * into v_row;

  v_row := public.payment_request_move(
    p_id, 'pending_approval', 'validated',
    case when v_passed then 'All checks passed.' else 'Validation raised exceptions.' end,
    jsonb_build_object('passed', v_passed, 'checks', v_checks));

  return v_row;
end;
$$;

revoke execute on function public.finhub_validate_payment_request(uuid) from public, anon;
grant  execute on function public.finhub_validate_payment_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. THE TERMS THE APPROVER IS CONFIRMING
--
--     Rendered from the request as it stands NOW and hashed. Change anything
--     material -- amount, payee, validation verdict, the pending decision --
--     and the digest changes, so a confirmation issued against the old text is
--     refused. Mirrors sacco_loan_guarantee_terms().
-- ---------------------------------------------------------------------------
create or replace function public.payment_request_decision_terms(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row   public.payment_requests;
  v_canon text;
  v_lines text[];
begin
  select * into v_row from public.payment_requests where id = p_id;
  if not found then
    raise exception 'Payment request not found.' using errcode = 'P0002';
  end if;

  if not public.can_see_payment_request(v_row.admin_id, v_row.agent_id, v_row.manager_id) then
    raise exception 'Not your payment request.' using errcode = '42501';
  end if;

  v_lines := array[
    format('Request %s', coalesce(v_row.request_no, v_row.id::text)),
    format('Type: %s', v_row.request_type),
    format('Amount: %s %s', v_row.currency, to_char(v_row.amount, 'FM999,999,999,990.00')),
    format('Payee: %s', coalesce(v_row.payee_name, '(not stated)')),
    format('Invoice: %s', coalesce(v_row.invoice_ref, '(none)')),
    format('FinHub validation: %s',
           case when v_row.validation_passed is null then 'not run'
                when v_row.validation_passed then 'passed'
                else 'raised exceptions' end),
    format('Decision: %s', coalesce(v_row.pending_decision::text, '(none)')),
    format('Reason: %s', coalesce(v_row.pending_reason, '(none)'))
  ];

  -- Canonical form: the same request always renders the same string.
  v_canon := array_to_string(v_lines, E'\n');

  return jsonb_build_object(
    'request_id', v_row.id,
    'request_no', v_row.request_no,
    'amount',     v_row.amount,
    'currency',   v_row.currency,
    'lines',      to_jsonb(v_lines),
    'hash',       encode(extensions.digest(v_canon, 'sha256'), 'hex'));
end;
$$;

revoke execute on function public.payment_request_decision_terms(uuid) from public, anon;
grant  execute on function public.payment_request_decision_terms(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. DECIDE — STEP ONE
--
--     Records YES / NO / WAIT and a reason. THE STATUS DOES NOT MOVE. What
--     comes back is the hash the caller must present to step two.
-- ---------------------------------------------------------------------------
create or replace function public.finhub_decide_payment_request(
  p_id       uuid,
  p_decision public.payment_request_decision,
  p_reason   text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row   public.payment_requests;
  v_terms jsonb;
begin
  if not public.is_global_viewer() then
    raise exception 'Only a super admin may decide a payment request.' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Every decision needs a reason.' using errcode = 'P0001';
  end if;

  select * into v_row from public.payment_requests where id = p_id for update;
  if not found then
    raise exception 'Payment request not found.' using errcode = 'P0002';
  end if;

  if v_row.status not in ('pending_approval', 'on_hold') then
    raise exception 'A % request is not awaiting a decision.', v_row.status using errcode = 'P0001';
  end if;

  update public.payment_requests
     set pending_decision   = p_decision,
         pending_reason     = btrim(p_reason),
         pending_decided_by = auth.uid(),
         pending_decided_at = now(),
         bulk_batch_id      = null
   where id = p_id
  returning * into v_row;

  v_terms := public.payment_request_decision_terms(p_id);

  update public.payment_requests
     set pending_terms_hash = v_terms->>'hash'
   where id = p_id;

  insert into public.payment_request_events
    (request_id, admin_id, event_type, from_status, to_status,
     actor_id, actor_name, actor_role, reason, amount, detail)
  select p_id, v_row.admin_id, 'decision_recorded', v_row.status, v_row.status,
         auth.uid(), up.full_name, up.role::text, btrim(p_reason), v_row.amount,
         jsonb_build_object('decision', p_decision, 'awaiting_verification', true)
    from public.user_profiles up where up.id = auth.uid();

  return v_terms;
end;
$$;

revoke execute on function public.finhub_decide_payment_request(uuid, public.payment_request_decision, text) from public, anon;
grant  execute on function public.finhub_decide_payment_request(uuid, public.payment_request_decision, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 14. DECIDE — STEP TWO
--
--     The decision becomes real here and nowhere else.
-- ---------------------------------------------------------------------------
create or replace function public.finhub_verify_payment_decision(
  p_id   uuid,
  p_hash text
)
returns public.payment_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row  public.payment_requests;
  v_now  jsonb;
  v_to   public.payment_request_status;
begin
  if not public.is_global_viewer() then
    raise exception 'Only a super admin may verify a payment decision.' using errcode = '42501';
  end if;

  select * into v_row from public.payment_requests where id = p_id for update;
  if not found then
    raise exception 'Payment request not found.' using errcode = 'P0002';
  end if;

  if v_row.pending_decision is null then
    raise exception 'There is no decision awaiting verification on this request.' using errcode = 'P0001';
  end if;

  v_now := public.payment_request_decision_terms(p_id);

  if p_hash is distinct from (v_now->>'hash') then
    raise exception
      'This request has changed since the decision was reviewed. Read it again before confirming.'
      using errcode = 'P0001';
  end if;

  v_to := case v_row.pending_decision
            when 'approve' then 'approved'
            when 'reject'  then 'rejected'
            when 'hold'    then 'on_hold'
          end::public.payment_request_status;

  update public.payment_requests
     set decision        = v_row.pending_decision,
         decision_reason = v_row.pending_reason,
         decided_by      = v_row.pending_decided_by,
         decided_at      = v_row.pending_decided_at,
         verified_by     = auth.uid(),
         verified_at     = now(),
         pending_decision   = null,
         pending_reason     = null,
         pending_terms_hash = null
   where id = p_id;

  return public.payment_request_move(
    p_id, v_to, 'decision_verified', v_row.pending_reason,
    jsonb_build_object(
      'decision',    v_row.pending_decision,
      'decided_by',  v_row.pending_decided_by,
      'verified_by', auth.uid(),
      'batch',       v_row.bulk_batch_id));
end;
$$;

revoke execute on function public.finhub_verify_payment_decision(uuid, text) from public, anon;
grant  execute on function public.finhub_verify_payment_decision(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 15. BULK
--
--     Same two steps, one batch id, one shared reason. Step one returns a
--     digest over EVERY request in the batch, so a batch that changed between
--     review and confirmation is refused whole rather than half-applied.
-- ---------------------------------------------------------------------------
create or replace function public.finhub_bulk_decide_payment_requests(
  p_ids      uuid[],
  p_decision public.payment_request_decision,
  p_reason   text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch   uuid := gen_random_uuid();
  v_id      uuid;
  v_hashes  text[] := '{}';
  v_terms   jsonb;
  v_count   integer := 0;
  v_canon   text;
begin
  if not public.is_global_viewer() then
    raise exception 'Only a super admin may decide payment requests.' using errcode = '42501';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'No requests selected.' using errcode = 'P0001';
  end if;

  foreach v_id in array p_ids loop
    v_terms  := public.finhub_decide_payment_request(v_id, p_decision, p_reason);
    v_hashes := v_hashes || (v_terms->>'hash');
    v_count  := v_count + 1;

    update public.payment_requests set bulk_batch_id = v_batch where id = v_id;
  end loop;

  -- Order-independent so the same selection always hashes the same way.
  select string_agg(h, '|' order by h) into v_canon from unnest(v_hashes) as h;

  return jsonb_build_object(
    'batch_id', v_batch,
    'count',    v_count,
    'decision', p_decision,
    'reason',   p_reason,
    'hash',     encode(extensions.digest(v_canon, 'sha256'), 'hex'));
end;
$$;

revoke execute on function public.finhub_bulk_decide_payment_requests(uuid[], public.payment_request_decision, text) from public, anon;
grant  execute on function public.finhub_bulk_decide_payment_requests(uuid[], public.payment_request_decision, text) to authenticated;

create or replace function public.finhub_verify_bulk_decision(
  p_batch_id uuid,
  p_hash     text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id     uuid;
  v_hashes text[] := '{}';
  v_canon  text;
  v_count  integer := 0;
begin
  if not public.is_global_viewer() then
    raise exception 'Only a super admin may verify a payment decision.' using errcode = '42501';
  end if;

  for v_id in
    select id from public.payment_requests
     where bulk_batch_id = p_batch_id and pending_decision is not null
     order by id
  loop
    v_hashes := v_hashes || (public.payment_request_decision_terms(v_id)->>'hash');
  end loop;

  if array_length(v_hashes, 1) is null then
    raise exception 'That batch has nothing awaiting verification.' using errcode = 'P0001';
  end if;

  select string_agg(h, '|' order by h) into v_canon from unnest(v_hashes) as h;

  if p_hash is distinct from encode(extensions.digest(v_canon, 'sha256'), 'hex') then
    raise exception
      'One or more requests in this batch changed since they were reviewed. Nothing has been applied.'
      using errcode = 'P0001';
  end if;

  for v_id in
    select id from public.payment_requests
     where bulk_batch_id = p_batch_id and pending_decision is not null
     order by id
  loop
    perform public.finhub_verify_payment_decision(
      v_id, public.payment_request_decision_terms(v_id)->>'hash');
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.finhub_verify_bulk_decision(uuid, text) from public, anon;
grant  execute on function public.finhub_verify_bulk_decision(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 16. EXECUTE
--
--     approved -> processing -> executed, and the agent_wallets row is written
--     in between, which is the only window section 8's gate leaves open.
-- ---------------------------------------------------------------------------
create or replace function public.finhub_execute_payment_request(
  p_id        uuid,
  p_reference text
)
returns public.payment_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row    public.payment_requests;
  v_wallet uuid;
begin
  if not public.is_hierarchy_admin() then
    raise exception 'Only FinHub staff may execute a payment.' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_reference, '')), '') is null then
    raise exception 'An executed payment needs a reference.' using errcode = 'P0001';
  end if;

  select * into v_row from public.payment_requests where id = p_id for update;
  if not found then
    raise exception 'Payment request not found.' using errcode = 'P0002';
  end if;

  if v_row.status <> 'approved' then
    raise exception 'Only an approved request can be executed; this one is %.', v_row.status
      using errcode = 'P0001';
  end if;

  v_row := public.payment_request_move(p_id, 'processing', 'execution_started');

  -- The wallet entry. Only reachable while the request is 'processing'.
  if v_row.agent_id is not null and v_row.request_type = 'agent_commission' then
    insert into public.agent_wallets
      (agent_id, total_earned, total_withdrawn, available_balance,
       tx_type, description, reference_id, status, reviewed_at, reviewed_by)
    values
      (v_row.agent_id, 0, v_row.amount, -v_row.amount,
       'withdrawal'::public.wallet_tx_type,
       coalesce(v_row.narrative, 'Commission withdrawal') || ' [' || v_row.request_no || ']',
       v_row.id, 'approved', now(), coalesce(v_row.verified_by::text, 'finhub'))
    returning id into v_wallet;
  end if;

  update public.payment_requests
     set executed_by       = auth.uid(),
         executed_at       = now(),
         payment_reference = btrim(p_reference),
         wallet_entry_id   = v_wallet
   where id = p_id;

  return public.payment_request_move(
    p_id, 'executed', 'executed', null,
    jsonb_build_object('payment_reference', btrim(p_reference), 'wallet_entry_id', v_wallet));
end;
$$;

revoke execute on function public.finhub_execute_payment_request(uuid, text) from public, anon;
grant  execute on function public.finhub_execute_payment_request(uuid, text) to authenticated;

create or replace function public.finhub_fail_payment_request(p_id uuid, p_reason text)
returns public.payment_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_hierarchy_admin() then
    raise exception 'Only FinHub staff may fail a payment.' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A failed payment needs a reason.' using errcode = 'P0001';
  end if;

  update public.payment_requests set failure_reason = btrim(p_reason) where id = p_id;
  return public.payment_request_move(p_id, 'failed', 'failed', btrim(p_reason));
end;
$$;

revoke execute on function public.finhub_fail_payment_request(uuid, text) from public, anon;
grant  execute on function public.finhub_fail_payment_request(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 17. BANK CONFIRMATION AND RECONCILIATION
--
--     "Executed" means this system sent the instruction. It does not mean the
--     money arrived, and the two are recorded separately on purpose: a payment
--     marked complete because a form was submitted is exactly the failure this
--     step exists to prevent.
-- ---------------------------------------------------------------------------
create or replace function public.finhub_confirm_payment_request(
  p_id             uuid,
  p_bank_reference text,
  p_credited       boolean default true
)
returns public.payment_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.payment_requests;
begin
  if not public.is_hierarchy_admin() then
    raise exception 'Only FinHub staff may confirm a bank credit.' using errcode = '42501';
  end if;

  select * into v_row from public.payment_requests where id = p_id for update;
  if not found then
    raise exception 'Payment request not found.' using errcode = 'P0002';
  end if;

  if v_row.status <> 'executed' then
    raise exception 'Only an executed payment can be confirmed; this one is %.', v_row.status
      using errcode = 'P0001';
  end if;

  update public.payment_requests
     set bank_confirmed    = p_credited,
         bank_confirmed_at = now(),
         bank_reference    = nullif(btrim(coalesce(p_bank_reference, '')), ''),
         failure_reason    = case when p_credited then failure_reason
                                  else 'Bank did not confirm the credit.' end
   where id = p_id;

  if not p_credited then
    return public.payment_request_move(
      p_id, 'failed', 'bank_confirmation_failed', 'The bank did not confirm the credit.');
  end if;

  return public.payment_request_move(
    p_id, 'reconciliation_required', 'bank_confirmed', null,
    jsonb_build_object('bank_reference', btrim(coalesce(p_bank_reference, ''))));
end;
$$;

revoke execute on function public.finhub_confirm_payment_request(uuid, text, boolean) from public, anon;
grant  execute on function public.finhub_confirm_payment_request(uuid, text, boolean) to authenticated;

create or replace function public.finhub_reconcile_payment_request(
  p_id      uuid,
  p_matched boolean,
  p_note    text default null
)
returns public.payment_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_hierarchy_admin() then
    raise exception 'Only FinHub staff may reconcile a payment.' using errcode = '42501';
  end if;

  update public.payment_requests
     set reconciled_by       = auth.uid(),
         reconciled_at       = now(),
         reconciliation_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;

  if p_matched then
    return public.payment_request_move(p_id, 'completed', 'reconciled', p_note);
  end if;

  return public.payment_request_move(
    p_id, 'failed', 'reconciliation_failed',
    coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Could not be matched to a bank transaction.'));
end;
$$;

revoke execute on function public.finhub_reconcile_payment_request(uuid, boolean, text) from public, anon;
grant  execute on function public.finhub_reconcile_payment_request(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 18. CANCEL, RESUME, AND ATTACH A DOCUMENT
-- ---------------------------------------------------------------------------
create or replace function public.finhub_cancel_payment_request(p_id uuid, p_reason text)
returns public.payment_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.payment_requests;
begin
  select * into v_row from public.payment_requests where id = p_id;
  if not found then
    raise exception 'Payment request not found.' using errcode = 'P0002';
  end if;

  -- The requester may withdraw their own; an administrator may cancel any in
  -- their tenant. Nobody may cancel one that is already being paid.
  if not (v_row.submitted_by = auth.uid() or public.is_hierarchy_admin()) then
    raise exception 'Not your payment request.' using errcode = '42501';
  end if;

  return public.payment_request_move(p_id, 'cancelled', 'cancelled', p_reason);
end;
$$;

revoke execute on function public.finhub_cancel_payment_request(uuid, text) from public, anon;
grant  execute on function public.finhub_cancel_payment_request(uuid, text) to authenticated;

-- Put a request back in the queue.
--
-- This is the ONLY way back from 'failed', and deliberately so. A payment that
-- has already gone wrong must not be re-decided where it lies: 'failed' is not
-- a state awaiting a decision, so finhub_decide_payment_request refuses it, and
-- somebody has to reopen it on the record before it can be approved a second
-- time. It also serves the ordinary case of lifting a hold.
create or replace function public.finhub_resume_payment_request(p_id uuid, p_reason text default null)
returns public.payment_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_global_viewer() then
    raise exception 'Only a super admin may reopen a payment request.' using errcode = '42501';
  end if;
  return public.payment_request_move(p_id, 'pending_approval', 'resumed', p_reason);
end;
$$;

revoke execute on function public.finhub_resume_payment_request(uuid, text) from public, anon;
grant  execute on function public.finhub_resume_payment_request(uuid, text) to authenticated;

create or replace function public.finhub_attach_payment_document(
  p_request_id    uuid,
  p_document_type text,
  p_file_name     text,
  p_file_path     text,
  p_mime_type     text default null,
  p_file_size     bigint default null
)
returns public.payment_request_documents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.payment_requests;
  v_doc public.payment_request_documents;
begin
  select * into v_row from public.payment_requests where id = p_request_id;
  if not found then
    raise exception 'Payment request not found.' using errcode = 'P0002';
  end if;

  if not (v_row.submitted_by = auth.uid() or public.is_hierarchy_admin()) then
    raise exception 'Not your payment request.' using errcode = '42501';
  end if;

  -- Documents support a DECISION, so they stop being acceptable once one has
  -- been taken. Attaching an invoice to an already-approved payout would make
  -- the trail say the approver saw something they did not.
  if v_row.status not in ('draft','submitted','under_validation','pending_approval','on_hold') then
    raise exception 'A % request no longer accepts documents.', v_row.status using errcode = 'P0001';
  end if;

  insert into public.payment_request_documents
    (request_id, admin_id, document_type, file_name, file_path, mime_type, file_size, uploaded_by)
  values
    (p_request_id, v_row.admin_id, coalesce(nullif(btrim(p_document_type), ''), 'other'),
     p_file_name, p_file_path, p_mime_type, p_file_size, auth.uid())
  returning * into v_doc;

  insert into public.payment_request_events
    (request_id, admin_id, event_type, from_status, to_status,
     actor_id, actor_name, actor_role, amount, detail)
  select p_request_id, v_row.admin_id, 'document_attached', v_row.status, v_row.status,
         auth.uid(), up.full_name, up.role::text, v_row.amount,
         jsonb_build_object('file_name', p_file_name, 'document_type', p_document_type)
    from public.user_profiles up where up.id = auth.uid();

  return v_doc;
end;
$$;

revoke execute on function public.finhub_attach_payment_document(uuid, text, text, text, text, bigint) from public, anon;
grant  execute on function public.finhub_attach_payment_document(uuid, text, text, text, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 19. THE DASHBOARD FIGURES
--
--     SECURITY INVOKER, so one call serves an agent (their own), a manager
--     (their team's) and a super admin (everything) without any of them seeing
--     another's scope. House rule from 20260822140000: totals come from SQL,
--     never from reducing over a capped array.
-- ---------------------------------------------------------------------------
create or replace function public.payment_request_totals()
returns table (
  status         public.payment_request_status,
  request_count  bigint,
  total_amount   numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select r.status, count(*)::bigint, coalesce(sum(r.amount), 0)::numeric
    from public.payment_requests r
   group by r.status;
$$;

revoke execute on function public.payment_request_totals() from public, anon;
grant  execute on function public.payment_request_totals() to authenticated;

-- ---------------------------------------------------------------------------
-- 20. THE DOCUMENT BUCKET
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-request-documents', 'payment-request-documents', false, 26214400,
  array[
    'application/pdf',
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "payreq_docs_tenant_read"   on storage.objects;
drop policy if exists "payreq_docs_tenant_insert" on storage.objects;
drop policy if exists "payreq_docs_tenant_delete" on storage.objects;

create policy "payreq_docs_tenant_read"
on storage.objects for select to authenticated
using (
  bucket_id = 'payment-request-documents'
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
);

create policy "payreq_docs_tenant_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'payment-request-documents'
  and public.is_staff_member()
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
);

create policy "payreq_docs_tenant_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'payment-request-documents'
  and public.is_staff_member()
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
);

-- ---------------------------------------------------------------------------
-- 21. REALTIME
--     The approval dashboard is specified as real-time; publish the table it
--     watches rather than have the screen poll.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.payment_requests;
    exception when duplicate_object then null;
    end;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 22. DOCUMENTATION
-- ---------------------------------------------------------------------------
comment on table public.payment_requests is
  'One payment, from the agent asking for it to the bank confirming it. Written only by the finhub_* RPCs -- authenticated has SELECT and nothing else.';
comment on column public.payment_requests.pending_decision is
  'Step one of the two-step approval. The status does NOT move until finhub_verify_payment_decision lands, so an abandoned decision never happened.';
comment on column public.payment_requests.pending_terms_hash is
  'Digest of the request as the approver read it. The second step is refused unless it still matches -- see payment_request_decision_terms().';
comment on column public.payment_requests.wallet_entry_id is
  'The agent_wallets row this request produced at execution. NULL until executed; the wallet row cannot exist without it (see agent_wallet_withdrawal_gate).';
comment on column public.payment_requests.bank_confirmed is
  'Whether the money was seen arriving. Separate from executed on purpose: executed means the instruction was sent, not that it landed.';
comment on table public.payment_request_documents is
  'Index over the supporting files. The files live in the private payment-request-documents bucket, pathed <admin_id>/<request_id>/<file>. Refused once a decision has been taken.';
comment on table public.payment_request_events is
  'The immutable approval trail. Append-only by trigger; UPDATE and DELETE raise. Every actor, reason and amount is denormalised so a line stays readable after the agent row is gone.';

notify pgrst, 'reload schema';

commit;

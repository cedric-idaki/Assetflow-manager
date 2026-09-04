-- ===========================================================================
-- WITHDRAWAL REVIEW COLUMNS ON agent_wallets
--
-- Fixes a live production failure. `approveWithdrawalRequest` and
-- `rejectWithdrawalRequest` (src/hooks/useSuperAdminDashboard.js:281,308) write
-- `status`, `reviewed_at` and `reviewed_by`. None of the three exist. Probed
-- against the live database on 2026-09-04, `agent_wallets` holds exactly the
-- nine columns the original migration created, and the approve path answers:
--
--     42703  column agent_wallets.status does not exist
--
-- So every approval and every rejection in production throws. It throws
-- silently, too: the tab wires the button as `onClick={() => onApprove?.(id)}`,
-- so the rejected promise is never caught and the super admin sees nothing at
-- all happen. Nothing is audited either -- the throw precedes the
-- auditLogsService.log call.
--
-- ---------------------------------------------------------------------------
-- THE COLUMNS ARE NOT ENOUGH ON THEIR OWN
--
-- Adding three columns would leave the button just as broken, for two separate
-- reasons that only show up once you look at the policies:
--
--   * agent_wallets has NO UPDATE POLICY AT ALL. RLS is enabled and only
--     `agents_select_own_wallet` and `agents_insert_own_wallet` exist, so every
--     UPDATE is denied. Worse than denied: the approve path issues its update
--     without .select(), so PostgREST answers 204 with error = null and the
--     hook reports SUCCESS while changing nothing.
--
--   * agent_wallets has NO SUPER ADMIN SELECT POLICY. The only read policy is
--     `agent_id = get_agent_id_for_user(auth.uid())`, and a super admin has no
--     `agents` row, so that returns NULL and they match nothing. The
--     Withdrawals tab has been showing an empty list -- which is the likeliest
--     reason a completely broken approve button went unnoticed.
--
-- Both are fixed below. Section 5 is the part that actually restores the
-- feature; sections 1-4 are what make it safe to restore.
--
-- ---------------------------------------------------------------------------
-- ADDING `status` OPENS A SELF-APPROVAL HOLE, SO THE TRIGGER IS NOT OPTIONAL
--
-- `agents_insert_own_wallet` lets an agent insert their own wallet rows and
-- checks only `agent_id`. The moment a `status` column exists, an agent can
-- post a withdrawal that arrives already `'approved'` -- they never have to
-- update anything, so no UPDATE policy stands in their way. Section 3 closes
-- that by having a BEFORE INSERT trigger overwrite the review fields outright
-- rather than trusting what the client sent. It is a trigger and not a policy
-- because it has to beat a write the INSERT policy is supposed to allow.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--
--   * It does not stop a settled request being decided again. Approving an
--     already-rejected row is a real defect, but enforcing it HERE would make
--     the app throw on a click it currently allows -- and, per the unhandled
--     promise above, throw invisibly. Fix the hook first, then add the guard.
--
--   * It does not touch the balance arithmetic. A rejected withdrawal still
--     debits the agent, because `walletBalance` subtracts every withdrawal row
--     regardless of status (useSalesAgentPortal.js:515). That is an app-side
--     bug and this column is what finally makes it fixable.
--
--   * `reviewed_by` is TEXT, not a uuid FK, because the hook writes the
--     literal 'super_admin'. Typing it as uuid would swap 42703 for 22P02 and
--     leave production exactly as broken. TEXT accepts a uuid string too, so
--     the follow-up -- writing the approver's real id -- is a one-line change
--     in the hook with no second migration.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. THE COLUMNS
-- ---------------------------------------------------------------------------
alter table public.agent_wallets
  add column if not exists status      text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text;

comment on column public.agent_wallets.status is
  'Review state of a withdrawal request: pending | approved | rejected. NULL on credit and adjustment rows, which are not reviewed.';
comment on column public.agent_wallets.reviewed_at is
  'When the withdrawal was approved or rejected. NULL while pending.';
comment on column public.agent_wallets.reviewed_by is
  'Who settled it. Currently the literal ''super_admin''; intended to hold the approving user id. The audit_logs entry carries the real user_id meanwhile.';

-- ---------------------------------------------------------------------------
-- 2. BACKFILL
--
-- Every withdrawal already in the table predates any possibility of review --
-- nothing has ever been approvable -- so all of them are pending. Credits and
-- adjustments stay NULL: "pending" is not a state they can be in, and giving
-- them one would put them in every future queue query by accident.
-- ---------------------------------------------------------------------------
update public.agent_wallets
   set status = 'pending'
 where tx_type = 'withdrawal'::public.wallet_tx_type
   and status is null;

alter table public.agent_wallets
  drop constraint if exists agent_wallets_status_valid;

-- `status is not null and ...` rather than `status in (...)` alone: a CHECK is
-- satisfied by NULL as well as by TRUE, and `null in ('pending', …)` is NULL,
-- so the shorter form would happily accept a withdrawal with no status at all.
alter table public.agent_wallets
  add constraint agent_wallets_status_valid check (
    case
      when tx_type = 'withdrawal'::public.wallet_tx_type
        then status is not null and status in ('pending', 'approved', 'rejected')
      else status is null
    end
  );

-- ---------------------------------------------------------------------------
-- 3. THE REVIEW FIELDS ARE SERVER-OWNED ON INSERT
--
-- See the header. This overwrites rather than defaults, because a DEFAULT only
-- applies when the client omits the column and the whole point is to beat a
-- client that supplies it.
-- ---------------------------------------------------------------------------
create or replace function public.agent_wallets_init_review()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.tx_type = 'withdrawal'::public.wallet_tx_type then
    new.status := 'pending';
  else
    new.status := null;
  end if;

  -- Unconditional: a row cannot arrive already reviewed by anyone.
  new.reviewed_at := null;
  new.reviewed_by := null;

  return new;
end;
$$;

drop trigger if exists trg_agent_wallets_init_review on public.agent_wallets;
create trigger trg_agent_wallets_init_review
  before insert on public.agent_wallets
  for each row execute function public.agent_wallets_init_review();

-- ---------------------------------------------------------------------------
-- 4. AN APPROVER MAY NOT REWRITE WHAT THEY ARE APPROVING
--
-- Section 5 grants super admins UPDATE on this table. RLS cannot restrict which
-- COLUMNS a policy exposes, so without this the same grant that lets someone
-- approve a KES 15,000 request also lets them change it to KES 150,000 first --
-- and the audit entry would faithfully record the number they approved.
--
-- Safe to add: approve/reject is the ONLY update to agent_wallets anywhere in
-- the codebase. Every other writer, including the commission triggers, inserts.
-- ---------------------------------------------------------------------------
create or replace function public.agent_wallets_freeze_amounts()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.agent_id          is distinct from old.agent_id
  or new.tx_type           is distinct from old.tx_type
  or new.total_earned      is distinct from old.total_earned
  or new.total_withdrawn   is distinct from old.total_withdrawn
  or new.available_balance is distinct from old.available_balance
  or new.reference_id      is distinct from old.reference_id
  or new.created_at        is distinct from old.created_at then
    raise exception
      'agent_wallets: only status, reviewed_at, reviewed_by and description may be updated (row %)', old.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_agent_wallets_freeze_amounts on public.agent_wallets;
create trigger trg_agent_wallets_freeze_amounts
  before update on public.agent_wallets
  for each row execute function public.agent_wallets_freeze_amounts();

-- ---------------------------------------------------------------------------
-- 5. THE POLICIES THAT ACTUALLY RESTORE THE FEATURE
--
-- Scoped to global viewers -- super_admin and director, per is_global_viewer()
-- -- because releasing agent money is a platform-owner action. Agents keep
-- their existing self-only SELECT and INSERT and gain nothing here: there is
-- deliberately no agent UPDATE policy, so an agent cannot settle their own
-- request even for their own row.
-- ---------------------------------------------------------------------------

-- Read: without this the queue is empty and there is nothing to approve.
drop policy if exists "super_admin_reads_all_wallets" on public.agent_wallets;
create policy "super_admin_reads_all_wallets"
on public.agent_wallets for select to authenticated
using (public.is_global_viewer());

-- Write: withdrawal rows only. A credit is a ledger entry, not a decision, and
-- nothing in the product has any reason to update one.
drop policy if exists "super_admin_reviews_withdrawals" on public.agent_wallets;
create policy "super_admin_reviews_withdrawals"
on public.agent_wallets for update to authenticated
using      (public.is_global_viewer() and tx_type = 'withdrawal'::public.wallet_tx_type)
with check (public.is_global_viewer() and tx_type = 'withdrawal'::public.wallet_tx_type);

-- ---------------------------------------------------------------------------
-- 6. THE QUEUE QUERY
--
-- Partial, because the queue only ever asks for withdrawals and the table is
-- overwhelmingly commission credits. This also gives the app a cheap way to
-- stop counting settled requests in the nav badge, which currently counts every
-- withdrawal ever made.
-- ---------------------------------------------------------------------------
create index if not exists idx_agent_wallets_withdrawal_status
  on public.agent_wallets (status, created_at desc)
  where tx_type = 'withdrawal'::public.wallet_tx_type;

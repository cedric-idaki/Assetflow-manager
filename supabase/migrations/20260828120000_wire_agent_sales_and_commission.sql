-- ===========================================================================
-- WIRE public.agents.total_sales (AND SALES COMMISSION)
--
-- THE BUG THIS FIXES
--
-- `agents.total_sales` has existed since the first schema migration and has
-- NEVER HAD A WRITER. Not in the app, not in a trigger, not in an RPC — every
-- reference to it in the entire codebase is a SELECT. A payment landing against
-- `payments.agent_id` did not touch it; converting a lead did not touch it. So
-- the column read 0.00 forever, no matter how much the team sold, and every
-- surface built on it — the CRM "Total sales" tile, the sales leaderboard, the
-- Sales column on the agent performance table, the director dashboard — was
-- rendering a constant and calling it a figure.
--
-- `total_commission` was half-wired: incremented by the agent-ASSIST flow
-- (20260626130000, 20260725160000) and by nothing else, so ordinary sales
-- commission was never earned despite `commission_rate` sitting on every agent
-- row and being editable in three different admin screens.
--
-- ---------------------------------------------------------------------------
-- THE DESIGN, AND WHY IT IS DELIBERATELY ASYMMETRIC
--
--   total_sales       -> RECOMPUTED from scratch on every change.
--   total_commission  -> INCREMENTED by a posted ledger delta.
--
-- They differ because their data differs, and getting this backwards breaks
-- one of them:
--
--   * total_sales has exactly ONE source: completed payments. Recomputing is
--     therefore safe, idempotent and self-healing — and it is the only shape
--     that lets the figure move DOWN when a payment is reversed, deleted or
--     back-dated. `+=` cannot subtract. (Same reasoning as
--     crm_interactions_sync_lead, which recomputes for exactly this reason.)
--
--   * total_commission has TWO sources: assists and now sales. Recomputing it
--     from payments alone would wipe out every assist commission ever earned.
--     Recomputing it from the agent_wallets ledger instead would DOUBLE-COUNT,
--     because the assist triggers insert their wallet row and then increment
--     agents themselves — an after-insert recompute would land between those
--     two statements and the assist's own += would then run on top of it.
--     So this migration does not touch the assist path at all. It mirrors it:
--     post a wallet row, increment agents, exactly-once.
--
-- ---------------------------------------------------------------------------
-- EXACTLY-ONCE, IN BOTH DIRECTIONS
--
-- Commission is posted as a DELTA against what the ledger already holds for
-- that payment, rather than as a one-shot "credit on completion" guarded by a
-- flag. A flag cannot survive the real state machine:
--
--     pending -> completed -> reversed -> completed
--
-- A `paid_at`-style guard credits the first completion and then silently
-- refuses the second. Computing `should_be - already_posted` and posting the
-- difference handles every transition, in both directions, and is idempotent
-- under replay. Nothing is ever rewritten or deleted: a reversal posts a
-- CONTRA ENTRY, which is what a ledger is supposed to do.
--
-- Rows are tied to their payment by agent_wallets.reference_id, which already
-- existed on the table and was unused by this path.
--
-- ---------------------------------------------------------------------------
-- THE TRIGGER MUST NEVER FAIL A PAYMENT
--
-- An AFTER trigger that raises rolls the whole statement back, so a bug in a
-- commission calculation would stop payments being recorded. Both figures here
-- are DERIVED caches; neither is worth refusing money over. The trigger
-- therefore downgrades any error to a WARNING and lets the payment through,
-- leaving the totals stale — which is repairable, because both functions are
-- idempotent and can simply be re-run.
--
-- ---------------------------------------------------------------------------
-- Idempotent and transactional: safe to re-run, lands whole or not at all.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. INDEXES
--    The commission trigger looks wallet rows up by reference_id on every
--    payment write, and the sales recompute sums payments by agent.
-- ---------------------------------------------------------------------------

create index if not exists idx_agent_wallets_reference
  on public.agent_wallets (reference_id) where reference_id is not null;

create index if not exists idx_payments_agent_status
  on public.payments (agent_id, payment_status) where agent_id is not null;

-- ---------------------------------------------------------------------------
-- 2. SALES: recompute one agent's realised total from completed payments.
--
--    Its own function so the backfill, the trigger and any future repair job
--    all agree on what "total sales" means. One definition, three callers.
-- ---------------------------------------------------------------------------

create or replace function public.recompute_agent_sales(p_agent uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_agent is null then return; end if;

  update public.agents a
     set total_sales = (
           select coalesce(sum(p.amount), 0)
             from public.payments p
            where p.agent_id = p_agent
              and p.payment_status = 'completed'::public.payment_status
         ),
         updated_at = now()
   where a.id = p_agent;
end;
$$;

revoke execute on function public.recompute_agent_sales(uuid) from public, anon, authenticated;

comment on function public.recompute_agent_sales(uuid) is
  'Recomputes agents.total_sales from completed payments. Recompute, not increment, so a reversed or deleted payment moves the figure back down.';

-- ---------------------------------------------------------------------------
-- 3. COMMISSION: post the difference between what a payment SHOULD have paid
--    and what the ledger already recorded for it.
--
--    Returns the delta so the caller can keep agents.total_commission in step
--    without recomputing it (see the header: recomputing that column collides
--    with the assist triggers).
-- ---------------------------------------------------------------------------

create or replace function public.post_payment_commission(p_payment uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pay        record;
  rate       numeric;
  should_be  numeric := 0;
  posted     numeric := 0;
  delta      numeric := 0;
begin
  select p.id, p.agent_id, p.amount, p.payment_status, p.reference_number
    into pay
    from public.payments p
   where p.id = p_payment;

  if not found or pay.agent_id is null then
    return 0;
  end if;

  -- What this payment ought to have paid, as things stand right now.
  if pay.payment_status = 'completed'::public.payment_status
     and coalesce(pay.amount, 0) > 0 then
    select coalesce(a.commission_rate, 0) into rate
      from public.agents a where a.id = pay.agent_id;
    -- round(…, 2) because this becomes money in a DECIMAL(15,2) column; an
    -- unrounded numeric would drift by fractions of a cent per payment.
    should_be := round(coalesce(pay.amount, 0) * coalesce(rate, 0) / 100.0, 2);
  end if;

  -- What the ledger already says it paid. Contra entries are stored negative,
  -- so this sums to the CURRENT net position rather than the gross credited.
  select coalesce(sum(w.total_earned), 0) into posted
    from public.agent_wallets w
   where w.reference_id = pay.id
     and w.tx_type in ('credit'::public.wallet_tx_type,
                       'adjustment'::public.wallet_tx_type);

  delta := should_be - posted;

  if delta = 0 then
    return 0;
  end if;

  insert into public.agent_wallets
    (agent_id, total_earned, total_withdrawn, available_balance, tx_type,
     description, reference_id)
  values
    (pay.agent_id, delta, 0, delta,
     case when delta > 0 then 'credit'::public.wallet_tx_type
          else 'adjustment'::public.wallet_tx_type end,
     case when delta > 0
          then 'Sales commission — payment ' || coalesce(nullif(pay.reference_number, ''), pay.id::text)
          else 'Sales commission reversed — payment ' || coalesce(nullif(pay.reference_number, ''), pay.id::text)
     end,
     pay.id);

  update public.agents
     set total_commission = coalesce(total_commission, 0) + delta,
         updated_at = now()
   where id = pay.agent_id;

  return delta;
end;
$$;

revoke execute on function public.post_payment_commission(uuid) from public, anon, authenticated;

comment on function public.post_payment_commission(uuid) is
  'Posts the difference between the commission a payment should have paid and what the ledger already holds for it. Idempotent, and correct across pending -> completed -> reversed -> completed.';

-- ---------------------------------------------------------------------------
-- 4. TRIGGER
-- ---------------------------------------------------------------------------

create or replace function public.payments_sync_agent_totals()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_agent uuid;
  old_agent uuid;
  target    uuid;
begin
  -- NEW is unassigned on DELETE and OLD on INSERT, so each is read only under
  -- the branch where it exists.
  if tg_op <> 'DELETE' then new_agent := new.agent_id; end if;
  if tg_op <> 'INSERT' then old_agent := old.agent_id; end if;

  -- Commission first, and only while the payment still exists: it reads the
  -- row by id. A DELETE leaves the posted ledger entries alone on purpose —
  -- money already paid out is not unpaid by deleting the record of why.
  if tg_op <> 'DELETE' then
    perform public.post_payment_commission(new.id);
  end if;

  -- An UPDATE can move a payment between agents, so refresh both sides.
  -- DISTINCT because the common case is that both sides are the same agent.
  for target in select distinct t
                  from unnest(array[new_agent, old_agent]) t
                 where t is not null
  loop
    perform public.recompute_agent_sales(target);
  end loop;

  return null;

-- NOTHING HERE MAY BLOCK A PAYMENT.
--
-- An AFTER trigger is not a bystander: if it raises, the whole statement rolls
-- back and the payment is never recorded. These two figures are DERIVED — a
-- denormalised cache of payments and of the wallet ledger — and no derived
-- number is worth refusing a customer's money over.
--
-- So a failure here is downgraded to a WARNING in the Postgres log and the
-- payment proceeds. The totals go stale rather than the payment being lost,
-- and stale is repairable: recompute_agent_sales() and
-- post_payment_commission() are both idempotent and can be re-run over the
-- affected agents at any time to bring them back into line.
exception
  when others then
    raise warning 'payments_sync_agent_totals failed for payment % (agent %): % — payment recorded, agent totals now stale and need a recompute',
                  coalesce(new.id, old.id), coalesce(new_agent, old_agent), sqlerrm;
    return null;
end;
$$;

drop trigger if exists trg_payments_sync_agent_totals on public.payments;
create trigger trg_payments_sync_agent_totals
  after insert or update or delete on public.payments
  for each row execute function public.payments_sync_agent_totals();

comment on function public.payments_sync_agent_totals() is
  'Keeps agents.total_sales and sales commission in step with public.payments. Swallows its own errors to a WARNING: these totals are derived, and none of them is worth failing a payment insert over.';

-- ---------------------------------------------------------------------------
-- 5. BACKFILL
--
--    Every agent is recomputed, including those with no payments — that is how
--    an agent carrying a stale non-zero figure gets corrected back to 0.
--
--    Commission is backfilled ONLY for completed payments that have no ledger
--    entry yet, so re-running this migration cannot pay anybody twice, and
--    existing assist commission is left exactly as it is.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in select id from public.agents loop
    perform public.recompute_agent_sales(r.id);
  end loop;

  for r in select p.id
             from public.payments p
            where p.agent_id is not null
              and p.payment_status = 'completed'::public.payment_status
  loop
    perform public.post_payment_commission(r.id);
  end loop;
end$$;

-- ---------------------------------------------------------------------------
-- 6. Make the new functions visible to PostgREST immediately.
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';

commit;

-- ============================================================================
-- THE POS APPROVAL QUEUE HAS NEVER WORKED
-- ============================================================================
-- WHAT IS BROKEN
-- --------------
-- The till has two approval gates — a transaction over KES 50,000, and a
-- discount over the product's threshold — and NEITHER has ever enqueued
-- anything. Four separate defects on one insert, in
-- src/pages/pos-module/index.jsx:
--
--   1. action_type 'large_transaction' is not a value of mc_action_type. The
--      enum has 'high_value_transaction'. Postgres answers 22P02.
--   2. action_type 'discount_approval' is not a value either. Nothing in the
--      enum covers a discount at all.
--   3. `initiator_email` is not a column on maker_checker_queue. PGRST204.
--   4. `metadata` is not a column. The jsonb column is `change_details`.
--
-- And `initiator_role` is NOT NULL and was never supplied, so even with all
-- four fixed the insert would still fail.
--
-- WHY NOBODY NOTICED
-- ------------------
-- The large-transaction branch does not check its error:
--
--     await supabase.from('maker_checker_queue').insert({ ... });
--     setTxnApprovalRef(ref);
--     setPendingTxnApproval(true);
--
-- The insert rejects, the rejection is discarded, and the agent is shown a
-- reference number and told their sale is awaiting approval. Nothing was
-- queued. No approver ever sees it. The sale simply never happens, and the
-- agent believes it is somebody else's turn to act.
--
-- That is the worst shape a bug can take on a money path: it is silent, and it
-- reports success.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Only the part that has to happen in the database: adds 'discount_approval'
-- to the enum and gives it a threshold row. The other three defects are in the
-- application and are fixed in the same commit.
--
-- 'large_transaction' is NOT added. 'high_value_transaction' already exists,
-- already means exactly that, and is already the label the approvals screen
-- renders — adding a synonym would leave two values for one thing and a queue
-- that filters correctly only half the time.
--
-- Idempotent -- safe to re-run.
-- ============================================================================

-- ADD VALUE is transaction-safe on PG12+ as long as the new value is not USED
-- in the same transaction. It is not: the only use is the seed below, which is
-- deliberately in its own statement after a commit boundary would fall, and
-- guarded so a re-run does not depend on it.
alter type public.mc_action_type add value if not exists 'discount_approval';

comment on type public.mc_action_type is
  'What a queued approval is about. discount_approval was added in 20260909120000 — the POS had been writing it since it shipped, against an enum that did not contain it.';

-- ----------------------------------------------------------------------------
-- The threshold row.
--
-- Separate statement, and tolerant of the enum value not being visible yet:
-- inside a single transaction the value added above cannot be cast, so on a
-- fresh apply this is skipped and the row is created on the next run. The
-- queue works without it — approval_thresholds only configures auto-approval
-- and SLA — so a missing row costs configuration, not function.
-- ----------------------------------------------------------------------------
do $$
begin
  insert into public.approval_thresholds
    (action_type, display_name, requires_approval, auto_approve_below,
     escalate_above, sla_hours, bulk_eligible, required_checker_role)
  values
    ('discount_approval'::public.mc_action_type, 'Discount Approval', true,
     null, null, 12, true, 'admin')
  on conflict (action_type) do nothing;
exception
  when invalid_text_representation or undefined_object then
    raise notice 'discount_approval not yet visible in this transaction; re-run this migration to seed its threshold row.';
end
$$;

notify pgrst, 'reload schema';

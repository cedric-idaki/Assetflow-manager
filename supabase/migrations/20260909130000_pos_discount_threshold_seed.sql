-- ============================================================================
-- SEED THE DISCOUNT APPROVAL THRESHOLD
-- ============================================================================
-- Split out of 20260909120000, which adds 'discount_approval' to
-- mc_action_type. Postgres will not let a value added by ALTER TYPE ... ADD
-- VALUE be used in the same transaction (55P04, "unsafe use of new value"), and
-- the migration runner gives each file its own transaction — so the cast has to
-- wait for a file boundary. This is that file.
--
-- What the row does: approval_thresholds drives auto-approval, escalation and
-- the SLA clock for a queued action. Without it a discount approval still
-- queues and is still decided by a person; it just carries no configured limits.
--
-- Idempotent -- safe to re-run.
-- ============================================================================

insert into public.approval_thresholds
  (action_type, display_name, requires_approval, auto_approve_below,
   escalate_above, sla_hours, bulk_eligible, required_checker_role)
values
  ('discount_approval'::public.mc_action_type, 'Discount Approval', true,
   null, null, 12, true, 'admin')
on conflict (action_type) do nothing;

notify pgrst, 'reload schema';

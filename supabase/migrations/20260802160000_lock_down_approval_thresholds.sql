-- ============================================================================
-- Lock down public.approval_thresholds
--
-- WHY
-- ---
-- `authenticated_manage_approval_thresholds` was FOR ALL TO authenticated
-- USING (true) WITH CHECK (true) — the only policy on the table. Combined with
-- the full DML grant `authenticated` holds, ANY logged-in user of ANY role
-- (a client, a sacco_member, an agent from another tenant) could UPDATE or
-- DELETE the maker-checker control rows: set requires_approval = false, raise
-- auto_approve_below, or empty the table outright. That disables dual control
-- platform-wide for high_value_transaction, debt_adjustment, payment_refund,
-- role_change, asset_deletion and system_config.
--
-- Unlike the tenant tables this one has NO tenant column — the 10 rows are
-- global platform configuration. So there is nothing to scope by admin_id, and
-- we lock it down completely instead (the same call made for
-- payment_alert_configs in 20260802150000): staff read, super_admin writes.
--
-- Grants cannot express "super_admin only" because every logged-in user shares
-- the `authenticated` role, so the write restriction has to live in RLS.
-- ============================================================================

BEGIN;

ALTER TABLE public.approval_thresholds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_manage_approval_thresholds ON public.approval_thresholds;

-- Read: any internal staff member. The app needs the thresholds in order to
-- enforce them, and they carry no tenant or personal data.
CREATE POLICY approval_thresholds_staff_read
  ON public.approval_thresholds
  FOR SELECT
  TO authenticated
  USING (public.is_staff_member());

-- Write: super_admin only. Deliberately NOT is_global_viewer() — that also
-- matches `director`, and directors are read-only overseers. This mirrors the
-- table's own `required_checker_role = 'super_admin'` for system_config.
CREATE POLICY approval_thresholds_super_admin_write
  ON public.approval_thresholds
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role = 'super_admin'::public.user_role
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.role = 'super_admin'::public.user_role
    )
  );

-- Defence in depth: anon has no policy here so RLS already returns nothing,
-- but a grant-level denial is provable without reasoning about policies.
REVOKE ALL ON public.approval_thresholds FROM anon;

COMMIT;

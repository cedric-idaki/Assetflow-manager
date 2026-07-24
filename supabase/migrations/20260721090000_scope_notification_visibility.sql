-- ============================================================================
-- SCOPE NOTIFICATION (audit_logs) VISIBILITY TO THE RECIPIENT
-- ----------------------------------------------------------------------------
-- Bug: opening a CLIENT account showed the notification bell filled with the
-- admin's own activity — e.g. "staff user deleted" — which concerns only the
-- admin. Same leak for a sacco member against their sacco admin's trail.
--
-- Cause: audit_logs is the one tenant table whose SELECT policy never got the
-- is_staff_member() guard that clients/assets/agents/payments all carry
-- (20260628120000_tenant_isolation.sql). It read:
--
--     USING (admin_id = current_admin_id() OR is_global_viewer())
--
-- current_admin_id() resolves to the OWNING admin for a client or sacco_member,
-- so every portal user matched their whole company's/sacco's audit trail. The
-- bell in src/components/ui/Header.jsx then rendered it verbatim.
--
-- Fix: gate the tenant-wide view behind is_staff_member(), and give portal
-- users a narrow self-scoped policy so they still get the events that are
-- genuinely about them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Re-assert is_staff_member() (idempotent).
--    20260708130000_sacco_member_portal.sql widened the exclusion list from
--    {client} to {client, sacco_member}. Re-declared here so this migration is
--    self-contained and correct even on an environment that is behind.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_staff_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role NOT IN ('client'::public.user_role,
                          'sacco_member'::public.user_role)
  );
$$;

-- ----------------------------------------------------------------------------
-- 1. Tenant-wide audit view — staff only.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "tenant_view_audit_logs" ON public.audit_logs;

CREATE POLICY "tenant_view_audit_logs"
ON public.audit_logs FOR SELECT TO authenticated
USING (
  (admin_id = public.current_admin_id() AND public.is_staff_member())
  OR public.is_global_viewer()
);

-- ----------------------------------------------------------------------------
-- 2. Portal users — only what concerns them.
--    A client sees rows tagged with THEIR client record (KYC decisions,
--    payments, contract events) plus actions they performed themselves.
--
--    get_client_id_for_user() returns NULL for staff and for sacco members, and
--    `client_id = NULL` evaluates to NULL (never true), so this policy widens
--    nothing for anyone else. audit_logs carries no sacco linkage at all, so a
--    sacco member matches only their own user_id rows.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "portal_view_own_audit_logs" ON public.audit_logs;

CREATE POLICY "portal_view_own_audit_logs"
ON public.audit_logs FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR client_id = public.get_client_id_for_user()
);

COMMENT ON POLICY "portal_view_own_audit_logs" ON public.audit_logs IS
  'Portal scope (client/sacco_member): only audit rows about the caller. The tenant-wide view is staff-only via tenant_view_audit_logs.';

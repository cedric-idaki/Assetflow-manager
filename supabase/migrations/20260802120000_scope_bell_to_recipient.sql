-- ============================================================================
-- NOTIFICATION BELL: SHOW ONLY WHAT CONCERNS THE SIGNED-IN USER
-- ----------------------------------------------------------------------------
-- Bug: a bronze sales agent (and a sacco member) opened the bell in
-- src/components/ui/Header.jsx and saw the WHOLE tenant's activity trail —
-- every client another agent registered, every payment another user posted,
-- every staff account the admin created. None of it concerns them.
--
-- Cause: audit_logs had accumulated FIVE permissive SELECT policies. Postgres
-- ORs permissive policies together, so the widest one wins, and three legacy
-- hand-made policies were never dropped when 20260628120000_tenant_isolation
-- and 20260721090000_scope_notification_visibility introduced the scoped ones:
--
--   audit_logs_agent_self : user_id = auth.uid()
--                           OR admin_id = auth.uid()
--                           OR admin_id IN (SELECT admin_id FROM user_profiles
--                                           WHERE id = auth.uid())   <-- LEAK
--   audit_logs_select     : admin_id = auth.uid() OR user_id = auth.uid()
--   audit_select          : (identical duplicate of audit_logs_select)
--
-- That third clause of audit_logs_agent_self hands the entire tenant trail to
-- ANY user carrying an admin_id — which on this project is every sales agent,
-- every client and every sacco member. It silently undid the 20260721090000
-- fix for portal users and never covered agents at all.
--
-- Second cause: is_staff_member() only excludes {client, sacco_member}, so a
-- sales_agent counts as "staff" and matched tenant_view_audit_logs anyway.
-- is_staff_member() is load-bearing for clients/assets/agents/payments (an
-- agent legitimately needs those), so it is NOT touched here. This migration
-- adds a separate, audit-feed-only predicate instead.
--
-- Result after this migration — one policy per audience, no overlap:
--   super_admin / director .......... every tenant  (is_global_viewer)
--   admin / sacco_admin / staff ..... own tenant    (tenant_view_audit_logs)
--   sales_agent / sales ............. own rows only (self_view_own_audit_logs)
--   client / sacco_member ........... own rows only (self_view_own_audit_logs)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Drop the legacy duplicates that OR-override every scoped policy.
--    Their useful halves survive: `user_id = auth.uid()` is self_view_own_...
--    and `admin_id = auth.uid()` is covered by tenant_view_audit_logs, because
--    current_admin_id() falls back to the caller's own id for a tenant owner.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "audit_logs_agent_self" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_select"     ON public.audit_logs;
DROP POLICY IF EXISTS "audit_select"          ON public.audit_logs;

-- ----------------------------------------------------------------------------
-- 2. Who gets the tenant-wide activity feed?
--    Internal staff only. A sales agent works a tenant's leads but is not an
--    observer of it, so agents join clients and sacco members on the outside.
--
--    Deliberately separate from is_staff_member(): that one gates row access to
--    clients/assets/agents/payments, which agents DO need. Widening its
--    exclusion list would lock agents out of their own book of business.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sees_tenant_activity_feed()
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
                          'sacco_member'::public.user_role,
                          'sales_agent'::public.user_role,
                          'sales'::public.user_role)
  );
$$;

COMMENT ON FUNCTION public.sees_tenant_activity_feed() IS
  'TRUE for roles whose job is to observe the tenant (admin, sacco_admin, internal staff). FALSE for the self-service segments: client, sacco_member, sales_agent, sales. Audit-feed scoping only — use is_staff_member() for row access to business tables.';

-- ----------------------------------------------------------------------------
-- 3. Tenant-wide view — now gated on the new predicate.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "tenant_view_audit_logs" ON public.audit_logs;

CREATE POLICY "tenant_view_audit_logs"
ON public.audit_logs FOR SELECT TO authenticated
USING (
  (admin_id = public.current_admin_id() AND public.sees_tenant_activity_feed())
  OR public.is_global_viewer()
);

COMMENT ON POLICY "tenant_view_audit_logs" ON public.audit_logs IS
  'Tenant activity trail for observers of the tenant. Self-service segments (agent/client/member) are excluded here and read self_view_own_audit_logs instead.';

-- ----------------------------------------------------------------------------
-- 4. Self scope — everyone, not just "portal" roles.
--    Renamed from portal_view_own_audit_logs: it now also carries sales agents,
--    and the old name reads like it stops at client/sacco_member.
--
--    Rows that concern the caller:
--      user_id   — something they did, or a system notice addressed to them
--                  (agent-followup-reminders writes user_id = the agent);
--      client_id — a decision on their own client record (KYC, contract,
--                  payment). get_client_id_for_user() returns NULL for everyone
--                  else, and `client_id = NULL` is NULL, never true, so this
--                  widens nothing.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "portal_view_own_audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "self_view_own_audit_logs"   ON public.audit_logs;

CREATE POLICY "self_view_own_audit_logs"
ON public.audit_logs FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR client_id = public.get_client_id_for_user()
);

COMMENT ON POLICY "self_view_own_audit_logs" ON public.audit_logs IS
  'Every user can read the audit rows that name them — their own actions, system notices addressed to them, and decisions on their own client record. This is the ONLY audit read a sales agent, client or sacco member gets.';

-- ----------------------------------------------------------------------------
-- 5. Index for the self-scoped read. idx_audit_logs_user exists on user_id
--    alone; the bell always orders by created_at desc, so pair them.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
  ON public.audit_logs(user_id, created_at DESC);

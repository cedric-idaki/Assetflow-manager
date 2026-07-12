-- ============================================================================
-- TENANT-ISOLATE THE 4 REMAINING OPEN TABLES  (clients, assets, payments, agents)
-- ============================================================================
-- These four tables had Row-Level Security DISABLED, so every authenticated
-- user — including a brand-new sacco_admin or sacco_member — could read the
-- entire table across all tenants. That is why a freshly registered sacco did
-- NOT get a clean portal: the shared modules (Finance Hub, Reports) surfaced
-- other tenants' clients/assets/payments.
--
-- This migration replaces the old, inconsistent policies (one of which was
-- self-referential on clients and would cause infinite-recursion once RLS was
-- switched on; another let ANY admin read ALL assets) with the standard tenant
-- model used everywhere else in the app:
--     (admin_id = current_admin_id() AND is_staff_member()) OR is_global_viewer()
-- plus the relevant self-service branch for client logins.
--
-- Verified by dry-run (transaction + rollback) before applying:
--   • company admin sees ONLY their own rows (Vincent: 34 clients, not 57)
--   • sacco_admin / sacco_member see ZERO of these tables (clean portal)
--   • super_admin / director keep the global view
--
-- Rows with a NULL tenant key (23 clients, 8 assets, 14 agents) are legacy /
-- orphaned records: after this change they are visible only to global viewers
-- (super_admin/director), which is the desired "clean" behaviour. A global
-- viewer can reassign them if any turn out to be real.
--
-- Idempotent — safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- CLIENTS  (tenant key = admin_id; self = client_auth_id / email)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "admins_manage_own_clients"   ON public.clients;
DROP POLICY IF EXISTS "admins can insert clients"   ON public.clients;
DROP POLICY IF EXISTS "admins can select clients"   ON public.clients;
DROP POLICY IF EXISTS "admins can update clients"   ON public.clients;
DROP POLICY IF EXISTS "client_reads_own_row"        ON public.clients;
DROP POLICY IF EXISTS "clients_read_own_row"        ON public.clients;
DROP POLICY IF EXISTS "clients_read_own_by_auth_id" ON public.clients;
DROP POLICY IF EXISTS "client_updates_own_row"      ON public.clients;

CREATE POLICY clients_tenant_manage ON public.clients FOR ALL TO authenticated
  USING      ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer())
  WITH CHECK ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer());

CREATE POLICY clients_self_read ON public.clients FOR SELECT TO authenticated
  USING (client_auth_id = auth.uid() OR lower(email) = lower(coalesce(auth.email(),'')));

CREATE POLICY clients_self_update ON public.clients FOR UPDATE TO authenticated
  USING      (client_auth_id = auth.uid() OR lower(email) = lower(coalesce(auth.email(),'')))
  WITH CHECK (client_auth_id = auth.uid() OR lower(email) = lower(coalesce(auth.email(),'')));

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- ASSETS  (tenant key = registered_by; resolve tenant via the registrant)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "admins_manage_own_assets"        ON public.assets;
DROP POLICY IF EXISTS "Admin and staff can update assets" ON public.assets;

CREATE POLICY assets_tenant_manage ON public.assets FOR ALL TO authenticated
  USING (
    registered_by = auth.uid()
    OR public.is_global_viewer()
    OR (public.is_staff_member() AND EXISTS (
          SELECT 1 FROM public.user_profiles rp
          WHERE rp.id = assets.registered_by
            AND COALESCE(rp.admin_id, rp.id) = public.current_admin_id()))
  )
  WITH CHECK (registered_by = auth.uid() OR public.is_global_viewer());

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- PAYMENTS  (tenant key = client_id -> clients.admin_id; self via client)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "scoped_payments_access" ON public.payments;

CREATE POLICY payments_tenant_manage ON public.payments FOR ALL TO authenticated
  USING (
    public.is_global_viewer()
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = payments.client_id
        AND ( (c.admin_id = public.current_admin_id() AND public.is_staff_member())
              OR c.client_auth_id = auth.uid()
              OR lower(c.email) = lower(coalesce(auth.email(),'')) ))
  )
  WITH CHECK (
    public.is_global_viewer()
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = payments.client_id
        AND c.admin_id = public.current_admin_id() AND public.is_staff_member())
  );

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- AGENTS  (tenant key = admin_id; self = the agent's own user_id)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "all_authenticated_manage_agents" ON public.agents;
DROP POLICY IF EXISTS "agents_self_access"              ON public.agents;
DROP POLICY IF EXISTS "super_admin_all_agents"          ON public.agents;

CREATE POLICY agents_tenant_manage ON public.agents FOR ALL TO authenticated
  USING      ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR user_id = auth.uid() OR public.is_global_viewer())
  WITH CHECK ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer());

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

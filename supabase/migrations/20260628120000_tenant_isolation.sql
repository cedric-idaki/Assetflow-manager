-- ============================================================================
-- TENANT ISOLATION
-- ----------------------------------------------------------------------------
-- Goal: a newly registered admin gets a completely clean account. Each admin
-- (company) can only see/manage its OWN clients, assets, agents and payments.
-- Until now RLS gave every admin/staff role open access to ALL rows
-- (authenticated_manage_* USING(true) + staff_*_all_*), so new admins inherited
-- other companies' data and the seed/demo data.
--
-- Model: the "tenant owner" of a row is an admin's auth user id.
--   * admin account            -> its own id      (user_profiles.admin_id IS NULL)
--   * staff / agent / client   -> user_profiles.admin_id (the owning admin)
-- This mirrors the app helper resolveAdminId()
-- (src/pages/reports-analytics-center/index.jsx).
--
-- super_admin and director keep a global cross-tenant view (platform analytics).
-- Client-portal users keep their existing narrow self-access.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. HELPER FUNCTIONS  (SECURITY DEFINER bypasses RLS -> no policy recursion)
-- ----------------------------------------------------------------------------

-- The tenant (owning admin) for the current auth user.
CREATE OR REPLACE FUNCTION public.current_admin_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT up.admin_id FROM public.user_profiles up WHERE up.id = auth.uid()),
    auth.uid()
  );
$$;

-- True for platform-wide roles that may read across all tenants.
CREATE OR REPLACE FUNCTION public.is_global_viewer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role IN ('super_admin'::public.user_role, 'director'::public.user_role)
  );
$$;

-- True for any non-client account (admin + all staff/agent roles). Used to keep
-- client-portal users OUT of the company-wide tenant policy (they only ever see
-- their own linked rows via the client_* policies further down).
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
      AND up.role <> 'client'::public.user_role
  );
$$;

-- ----------------------------------------------------------------------------
-- 2. TENANT COLUMNS  (idempotent — may already exist in the live DB)
-- ----------------------------------------------------------------------------
ALTER TABLE public.clients    ADD COLUMN IF NOT EXISTS admin_id uuid;
ALTER TABLE public.assets     ADD COLUMN IF NOT EXISTS admin_id uuid;
ALTER TABLE public.agents     ADD COLUMN IF NOT EXISTS admin_id uuid;
ALTER TABLE public.payments   ADD COLUMN IF NOT EXISTS admin_id uuid;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS admin_id uuid;

CREATE INDEX IF NOT EXISTS idx_clients_admin_id    ON public.clients(admin_id);
CREATE INDEX IF NOT EXISTS idx_assets_admin_id     ON public.assets(admin_id);
CREATE INDEX IF NOT EXISTS idx_agents_admin_id     ON public.agents(admin_id);
CREATE INDEX IF NOT EXISTS idx_payments_admin_id   ON public.payments(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_id ON public.audit_logs(admin_id);

-- ----------------------------------------------------------------------------
-- 3. BACKFILL existing rows from the best available owner signal.
--    Seed/demo rows get assigned to their original admin, so new admins won't
--    see them.
-- ----------------------------------------------------------------------------
UPDATE public.assets     SET admin_id = registered_by WHERE admin_id IS NULL AND registered_by IS NOT NULL;
UPDATE public.payments   SET admin_id = processed_by  WHERE admin_id IS NULL AND processed_by  IS NOT NULL;
UPDATE public.clients    SET admin_id = created_by    WHERE admin_id IS NULL AND created_by    IS NOT NULL;
UPDATE public.audit_logs SET admin_id = user_id       WHERE admin_id IS NULL AND user_id       IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. AUTO-TAG new rows with the current tenant when the app omits admin_id.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_admin_id_default()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.admin_id IS NULL THEN
    NEW.admin_id := public.current_admin_id();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_admin_id_clients    ON public.clients;
CREATE TRIGGER set_admin_id_clients    BEFORE INSERT ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.set_admin_id_default();

DROP TRIGGER IF EXISTS set_admin_id_assets     ON public.assets;
CREATE TRIGGER set_admin_id_assets     BEFORE INSERT ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.set_admin_id_default();

DROP TRIGGER IF EXISTS set_admin_id_agents     ON public.agents;
CREATE TRIGGER set_admin_id_agents     BEFORE INSERT ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.set_admin_id_default();

DROP TRIGGER IF EXISTS set_admin_id_payments   ON public.payments;
CREATE TRIGGER set_admin_id_payments   BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_admin_id_default();

DROP TRIGGER IF EXISTS set_admin_id_audit_logs ON public.audit_logs;
CREATE TRIGGER set_admin_id_audit_logs BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_admin_id_default();

-- ----------------------------------------------------------------------------
-- 5. REPLACE THE OPEN RLS POLICIES WITH PER-TENANT ONES
-- ----------------------------------------------------------------------------
ALTER TABLE public.clients    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- --- clients --------------------------------------------------------------
DROP POLICY IF EXISTS "authenticated_manage_clients" ON public.clients;
DROP POLICY IF EXISTS "staff_read_all_clients"        ON public.clients;
DROP POLICY IF EXISTS "clients_read_own_row"          ON public.clients;
DROP POLICY IF EXISTS "tenant_manage_clients"         ON public.clients;

CREATE POLICY "tenant_manage_clients"
ON public.clients FOR ALL TO authenticated
USING      ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer())
WITH CHECK ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer());

-- Client-portal user can read only their own client row (matched by email).
CREATE POLICY "clients_read_own_row"
ON public.clients FOR SELECT TO authenticated
USING (email = auth.email());

-- --- assets ---------------------------------------------------------------
DROP POLICY IF EXISTS "authenticated_manage_assets" ON public.assets;
DROP POLICY IF EXISTS "staff_manage_all_assets"     ON public.assets;
DROP POLICY IF EXISTS "clients_read_own_assets"     ON public.assets;
DROP POLICY IF EXISTS "tenant_manage_assets"        ON public.assets;

CREATE POLICY "tenant_manage_assets"
ON public.assets FOR ALL TO authenticated
USING      ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer())
WITH CHECK ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer());

-- Client-portal user can read only assets linked to them.
CREATE POLICY "clients_read_own_assets"
ON public.assets FOR SELECT TO authenticated
USING (linked_client_id = public.get_client_id_for_user());

-- --- agents ---------------------------------------------------------------
DROP POLICY IF EXISTS "authenticated_manage_agents" ON public.agents;
DROP POLICY IF EXISTS "tenant_manage_agents"        ON public.agents;
DROP POLICY IF EXISTS "agents_read_own_row"         ON public.agents;

CREATE POLICY "tenant_manage_agents"
ON public.agents FOR ALL TO authenticated
USING      ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer())
WITH CHECK ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer());

-- A sales agent can read their own agent row (sales-agent portal).
CREATE POLICY "agents_read_own_row"
ON public.agents FOR SELECT TO authenticated
USING (user_id = auth.uid());

-- --- payments -------------------------------------------------------------
DROP POLICY IF EXISTS "authenticated_manage_payments" ON public.payments;
DROP POLICY IF EXISTS "staff_manage_all_payments"     ON public.payments;
DROP POLICY IF EXISTS "clients_read_own_payments"     ON public.payments;
DROP POLICY IF EXISTS "tenant_manage_payments"        ON public.payments;

CREATE POLICY "tenant_manage_payments"
ON public.payments FOR ALL TO authenticated
USING      ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer())
WITH CHECK ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer());

-- Client-portal user can read only their own payments.
CREATE POLICY "clients_read_own_payments"
ON public.payments FOR SELECT TO authenticated
USING (client_id = public.get_client_id_for_user());

-- --- audit_logs -----------------------------------------------------------
DROP POLICY IF EXISTS "authenticated_view_audit_logs"   ON public.audit_logs;
DROP POLICY IF EXISTS "authenticated_insert_audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "tenant_view_audit_logs"          ON public.audit_logs;
DROP POLICY IF EXISTS "tenant_insert_audit_logs"        ON public.audit_logs;

CREATE POLICY "tenant_view_audit_logs"
ON public.audit_logs FOR SELECT TO authenticated
USING (admin_id = public.current_admin_id() OR public.is_global_viewer());

-- Append-only: any authenticated user may write a log; the BEFORE INSERT trigger
-- stamps admin_id = current_admin_id() so it lands in the correct tenant.
CREATE POLICY "tenant_insert_audit_logs"
ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK (true);

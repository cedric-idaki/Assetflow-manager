-- ----------------------------------------------------------------------------
-- Custom contribution types.
-- A sacco_admin can define extra contributions ("Building fund", "Holiday
-- savings", "Land project", …) beyond the built-in monthly/weekly/project/other
-- categories. Active types feed the Record-contribution form's Type dropdown;
-- contribution rows keep storing the type name in
-- sacco_contributions.contribution_type (plain TEXT, no constraint change).
-- Members may read their sacco's types so the member portal can surface them.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sacco_contribution_types (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id          UUID,
  sacco_id          UUID REFERENCES public.saccos(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT,
  suggested_amount  DECIMAL(15,2) DEFAULT 0,
  frequency         TEXT DEFAULT 'one-off',        -- one-off | weekly | monthly
  due_date          DATE,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sacco_contribution_types_admin
  ON public.sacco_contribution_types(admin_id);

-- Same admin_id default as every other sacco_* table.
DROP TRIGGER IF EXISTS set_admin_id_sacco_contribution_types ON public.sacco_contribution_types;
CREATE TRIGGER set_admin_id_sacco_contribution_types
  BEFORE INSERT ON public.sacco_contribution_types
  FOR EACH ROW EXECUTE FUNCTION public.set_admin_id_default();

ALTER TABLE public.sacco_contribution_types ENABLE ROW LEVEL SECURITY;

-- Tenant policy (mirrors tenant_manage_* on the other sacco tables).
DROP POLICY IF EXISTS "tenant_manage_sacco_contribution_types" ON public.sacco_contribution_types;
CREATE POLICY "tenant_manage_sacco_contribution_types" ON public.sacco_contribution_types
  FOR ALL TO authenticated
  USING      ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer())
  WITH CHECK ((admin_id = public.current_admin_id() AND public.is_staff_member()) OR public.is_global_viewer());

-- Members read their sacco's types (portal display, mirrors member_read_loan_products).
DROP POLICY IF EXISTS "member_read_contribution_types" ON public.sacco_contribution_types;
CREATE POLICY "member_read_contribution_types" ON public.sacco_contribution_types
  FOR SELECT TO authenticated
  USING (sacco_id = public.current_member_sacco_id());

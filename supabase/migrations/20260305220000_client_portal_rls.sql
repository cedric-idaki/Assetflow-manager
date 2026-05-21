-- Client Portal RLS Migration
-- Adds RLS policies so clients can only SELECT their own data
-- Matched by email address in the clients table

-- ============================================================
-- HELPER FUNCTION: get_client_id_for_user()
-- Returns the client.id for the currently authenticated user
-- by matching auth.email() against clients.email
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_client_id_for_user()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT id
  FROM public.clients
  WHERE email = auth.email()
  LIMIT 1;
$$;

-- ============================================================
-- clients table: client can only read their own row
-- ============================================================
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clients_read_own_row" ON public.clients;
CREATE POLICY "clients_read_own_row"
ON public.clients
FOR SELECT
TO authenticated
USING (email = auth.email());

-- Staff/admin can still read all clients (for admin dashboards)
DROP POLICY IF EXISTS "staff_read_all_clients" ON public.clients;
CREATE POLICY "staff_read_all_clients"
ON public.clients
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN ('super_admin', 'admin', 'director', 'accountant', 'collections', 'sales', 'operations', 'manager', 'finance')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN ('super_admin', 'admin', 'director', 'accountant', 'collections', 'sales', 'operations', 'manager', 'finance')
  )
);

-- ============================================================
-- assets table: client can only read assets linked to them
-- ============================================================
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clients_read_own_assets" ON public.assets;
CREATE POLICY "clients_read_own_assets"
ON public.assets
FOR SELECT
TO authenticated
USING (linked_client_id = public.get_client_id_for_user());

DROP POLICY IF EXISTS "staff_manage_all_assets" ON public.assets;
CREATE POLICY "staff_manage_all_assets"
ON public.assets
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN ('super_admin', 'admin', 'director', 'accountant', 'collections', 'sales', 'operations', 'manager', 'finance')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN ('super_admin', 'admin', 'director', 'accountant', 'collections', 'sales', 'operations', 'manager', 'finance')
  )
);

-- ============================================================
-- payments table: client can only read their own payments
-- ============================================================
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clients_read_own_payments" ON public.payments;
CREATE POLICY "clients_read_own_payments"
ON public.payments
FOR SELECT
TO authenticated
USING (client_id = public.get_client_id_for_user());

DROP POLICY IF EXISTS "staff_manage_all_payments" ON public.payments;
CREATE POLICY "staff_manage_all_payments"
ON public.payments
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN ('super_admin', 'admin', 'director', 'accountant', 'collections', 'sales', 'operations', 'manager', 'finance')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN ('super_admin', 'admin', 'director', 'accountant', 'collections', 'sales', 'operations', 'manager', 'finance')
  )
);

-- ============================================================
-- installment_plans table
-- ============================================================
ALTER TABLE public.installment_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clients_read_own_installment_plans" ON public.installment_plans;
CREATE POLICY "clients_read_own_installment_plans"
ON public.installment_plans
FOR SELECT
TO authenticated
USING (client_id = public.get_client_id_for_user());

DROP POLICY IF EXISTS "staff_manage_all_installment_plans" ON public.installment_plans;
CREATE POLICY "staff_manage_all_installment_plans"
ON public.installment_plans
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN ('super_admin', 'admin', 'director', 'accountant', 'collections', 'sales', 'operations', 'manager', 'finance')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN ('super_admin', 'admin', 'director', 'accountant', 'collections', 'sales', 'operations', 'manager', 'finance')
  )
);

-- ============================================================
-- installment_charges table
-- ============================================================
ALTER TABLE public.installment_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clients_read_own_installment_charges" ON public.installment_charges;
CREATE POLICY "clients_read_own_installment_charges"
ON public.installment_charges
FOR SELECT
TO authenticated
USING (client_id = public.get_client_id_for_user());

DROP POLICY IF EXISTS "staff_manage_all_installment_charges" ON public.installment_charges;
CREATE POLICY "staff_manage_all_installment_charges"
ON public.installment_charges
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN ('super_admin', 'admin', 'director', 'accountant', 'collections', 'sales', 'operations', 'manager', 'finance')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN ('super_admin', 'admin', 'director', 'accountant', 'collections', 'sales', 'operations', 'manager', 'finance')
  )
);

-- ============================================================
-- kyc_documents table
-- ============================================================
ALTER TABLE public.kyc_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clients_read_own_kyc_documents" ON public.kyc_documents;
CREATE POLICY "clients_read_own_kyc_documents"
ON public.kyc_documents
FOR SELECT
TO authenticated
USING (client_id = public.get_client_id_for_user());

DROP POLICY IF EXISTS "staff_manage_all_kyc_documents" ON public.kyc_documents;
CREATE POLICY "staff_manage_all_kyc_documents"
ON public.kyc_documents
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN ('super_admin', 'admin', 'director', 'accountant', 'collections', 'sales', 'operations', 'manager', 'finance')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN ('super_admin', 'admin', 'director', 'accountant', 'collections', 'sales', 'operations', 'manager', 'finance')
  )
);

-- ============================================================
-- Indexes for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_clients_email ON public.clients(email);
CREATE INDEX IF NOT EXISTS idx_installment_charges_client_id ON public.installment_charges(client_id);
CREATE INDEX IF NOT EXISTS idx_installment_charges_plan_id ON public.installment_charges(plan_id);
CREATE INDEX IF NOT EXISTS idx_installment_plans_client_id ON public.installment_plans(client_id);
CREATE INDEX IF NOT EXISTS idx_kyc_documents_client_id ON public.kyc_documents(client_id);

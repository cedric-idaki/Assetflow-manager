-- Migration: Add missing role values to user_role enum
-- Fixes: ERROR 22P02: invalid input value for enum user_role: "director"
-- The original enum only had: super_admin, admin, manager, finance, collections, sales, operations
-- The application also needs: director, accountant, collections_officer, sales_agent, client

-- ============================================================
-- ADD MISSING ENUM VALUES TO user_role
-- ALTER TYPE ... ADD VALUE is safe and idempotent via DO block
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'director'
    AND enumtypid = 'public.user_role'::regtype
  ) THEN
    ALTER TYPE public.user_role ADD VALUE 'director';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'accountant'
    AND enumtypid = 'public.user_role'::regtype
  ) THEN
    ALTER TYPE public.user_role ADD VALUE 'accountant';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'collections_officer'
    AND enumtypid = 'public.user_role'::regtype
  ) THEN
    ALTER TYPE public.user_role ADD VALUE 'collections_officer';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'sales_agent'
    AND enumtypid = 'public.user_role'::regtype
  ) THEN
    ALTER TYPE public.user_role ADD VALUE 'sales_agent';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'client'
    AND enumtypid = 'public.user_role'::regtype
  ) THEN
    ALTER TYPE public.user_role ADD VALUE 'client';
  END IF;
END;
$$;

-- ============================================================
-- RE-CREATE RLS POLICIES using the now-valid enum values
-- These replace the policies in 20260305220000_client_portal_rls.sql
-- that were failing due to invalid enum values
-- ============================================================

-- clients table: staff policy with valid enum values
DROP POLICY IF EXISTS "staff_read_all_clients" ON public.clients;
CREATE POLICY "staff_read_all_clients"
ON public.clients
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN (
      'super_admin'::public.user_role,
      'admin'::public.user_role,
      'director'::public.user_role,
      'accountant'::public.user_role,
      'collections_officer'::public.user_role,
      'manager'::public.user_role,
      'finance'::public.user_role,
      'collections'::public.user_role,
      'sales'::public.user_role,
      'operations'::public.user_role
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN (
      'super_admin'::public.user_role,
      'admin'::public.user_role,
      'director'::public.user_role,
      'accountant'::public.user_role,
      'collections_officer'::public.user_role,
      'manager'::public.user_role,
      'finance'::public.user_role,
      'collections'::public.user_role,
      'sales'::public.user_role,
      'operations'::public.user_role
    )
  )
);

-- assets table: staff policy with valid enum values
DROP POLICY IF EXISTS "staff_manage_all_assets" ON public.assets;
CREATE POLICY "staff_manage_all_assets"
ON public.assets
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN (
      'super_admin'::public.user_role,
      'admin'::public.user_role,
      'director'::public.user_role,
      'accountant'::public.user_role,
      'collections_officer'::public.user_role,
      'manager'::public.user_role,
      'finance'::public.user_role,
      'collections'::public.user_role,
      'sales'::public.user_role,
      'operations'::public.user_role
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN (
      'super_admin'::public.user_role,
      'admin'::public.user_role,
      'director'::public.user_role,
      'accountant'::public.user_role,
      'collections_officer'::public.user_role,
      'manager'::public.user_role,
      'finance'::public.user_role,
      'collections'::public.user_role,
      'sales'::public.user_role,
      'operations'::public.user_role
    )
  )
);

-- payments table: staff policy with valid enum values
DROP POLICY IF EXISTS "staff_manage_all_payments" ON public.payments;
CREATE POLICY "staff_manage_all_payments"
ON public.payments
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN (
      'super_admin'::public.user_role,
      'admin'::public.user_role,
      'director'::public.user_role,
      'accountant'::public.user_role,
      'collections_officer'::public.user_role,
      'manager'::public.user_role,
      'finance'::public.user_role,
      'collections'::public.user_role,
      'sales'::public.user_role,
      'operations'::public.user_role
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN (
      'super_admin'::public.user_role,
      'admin'::public.user_role,
      'director'::public.user_role,
      'accountant'::public.user_role,
      'collections_officer'::public.user_role,
      'manager'::public.user_role,
      'finance'::public.user_role,
      'collections'::public.user_role,
      'sales'::public.user_role,
      'operations'::public.user_role
    )
  )
);

-- installment_plans table: staff policy with valid enum values
DROP POLICY IF EXISTS "staff_manage_all_installment_plans" ON public.installment_plans;
CREATE POLICY "staff_manage_all_installment_plans"
ON public.installment_plans
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN (
      'super_admin'::public.user_role,
      'admin'::public.user_role,
      'director'::public.user_role,
      'accountant'::public.user_role,
      'collections_officer'::public.user_role,
      'manager'::public.user_role,
      'finance'::public.user_role,
      'collections'::public.user_role,
      'sales'::public.user_role,
      'operations'::public.user_role
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN (
      'super_admin'::public.user_role,
      'admin'::public.user_role,
      'director'::public.user_role,
      'accountant'::public.user_role,
      'collections_officer'::public.user_role,
      'manager'::public.user_role,
      'finance'::public.user_role,
      'collections'::public.user_role,
      'sales'::public.user_role,
      'operations'::public.user_role
    )
  )
);

-- installment_charges table: staff policy with valid enum values
DROP POLICY IF EXISTS "staff_manage_all_installment_charges" ON public.installment_charges;
CREATE POLICY "staff_manage_all_installment_charges"
ON public.installment_charges
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN (
      'super_admin'::public.user_role,
      'admin'::public.user_role,
      'director'::public.user_role,
      'accountant'::public.user_role,
      'collections_officer'::public.user_role,
      'manager'::public.user_role,
      'finance'::public.user_role,
      'collections'::public.user_role,
      'sales'::public.user_role,
      'operations'::public.user_role
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN (
      'super_admin'::public.user_role,
      'admin'::public.user_role,
      'director'::public.user_role,
      'accountant'::public.user_role,
      'collections_officer'::public.user_role,
      'manager'::public.user_role,
      'finance'::public.user_role,
      'collections'::public.user_role,
      'sales'::public.user_role,
      'operations'::public.user_role
    )
  )
);

-- kyc_documents table: staff policy with valid enum values
DROP POLICY IF EXISTS "staff_manage_all_kyc_documents" ON public.kyc_documents;
CREATE POLICY "staff_manage_all_kyc_documents"
ON public.kyc_documents
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN (
      'super_admin'::public.user_role,
      'admin'::public.user_role,
      'director'::public.user_role,
      'accountant'::public.user_role,
      'collections_officer'::public.user_role,
      'manager'::public.user_role,
      'finance'::public.user_role,
      'collections'::public.user_role,
      'sales'::public.user_role,
      'operations'::public.user_role
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
    AND up.role IN (
      'super_admin'::public.user_role,
      'admin'::public.user_role,
      'director'::public.user_role,
      'accountant'::public.user_role,
      'collections_officer'::public.user_role,
      'manager'::public.user_role,
      'finance'::public.user_role,
      'collections'::public.user_role,
      'sales'::public.user_role,
      'operations'::public.user_role
    )
  )
);

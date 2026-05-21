-- Recurring Installment Billing Schema
-- Adds installment_plans and installment_charges tables
-- Extends payments with installment_plan_id

-- 1. ENUM types
DROP TYPE IF EXISTS public.installment_plan_status CASCADE;
CREATE TYPE public.installment_plan_status AS ENUM ('active', 'paused', 'completed', 'cancelled', 'failed');

DROP TYPE IF EXISTS public.installment_charge_status CASCADE;
CREATE TYPE public.installment_charge_status AS ENUM ('scheduled', 'processing', 'succeeded', 'failed', 'retrying', 'cancelled');

DROP TYPE IF EXISTS public.billing_frequency CASCADE;
CREATE TYPE public.billing_frequency AS ENUM ('weekly', 'biweekly', 'monthly', 'quarterly');

-- 2. installment_plans table
CREATE TABLE IF NOT EXISTS public.installment_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES public.assets(id) ON DELETE SET NULL,
    plan_name TEXT NOT NULL,
    total_amount NUMERIC NOT NULL DEFAULT 0,
    installment_amount NUMERIC NOT NULL DEFAULT 0,
    total_installments INTEGER NOT NULL DEFAULT 1,
    installments_paid INTEGER NOT NULL DEFAULT 0,
    frequency public.billing_frequency NOT NULL DEFAULT 'monthly'::public.billing_frequency,
    start_date DATE NOT NULL,
    next_charge_date DATE,
    end_date DATE,
    stripe_customer_id TEXT,
    stripe_payment_method_id TEXT,
    plan_status public.installment_plan_status NOT NULL DEFAULT 'active'::public.installment_plan_status,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    retry_interval_days INTEGER NOT NULL DEFAULT 3,
    currency TEXT NOT NULL DEFAULT 'usd',
    notes TEXT,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. installment_charges table (individual charge attempts)
CREATE TABLE IF NOT EXISTS public.installment_charges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES public.installment_plans(id) ON DELETE CASCADE,
    client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
    installment_number INTEGER NOT NULL,
    amount NUMERIC NOT NULL DEFAULT 0,
    scheduled_date DATE NOT NULL,
    charged_at TIMESTAMPTZ,
    charge_status public.installment_charge_status NOT NULL DEFAULT 'scheduled'::public.installment_charge_status,
    payment_intent_id TEXT,
    stripe_charge_id TEXT,
    payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
    retry_attempt INTEGER NOT NULL DEFAULT 0,
    failure_reason TEXT,
    next_retry_date DATE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4. Extend payments table with installment_plan_id
ALTER TABLE public.payments
ADD COLUMN IF NOT EXISTS installment_plan_id UUID REFERENCES public.installment_plans(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS installment_number INTEGER;

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_installment_plans_client_id ON public.installment_plans(client_id);
CREATE INDEX IF NOT EXISTS idx_installment_plans_status ON public.installment_plans(plan_status);
CREATE INDEX IF NOT EXISTS idx_installment_plans_next_charge ON public.installment_plans(next_charge_date) WHERE plan_status = 'active';
CREATE INDEX IF NOT EXISTS idx_installment_charges_plan_id ON public.installment_charges(plan_id);
CREATE INDEX IF NOT EXISTS idx_installment_charges_status ON public.installment_charges(charge_status);
CREATE INDEX IF NOT EXISTS idx_installment_charges_scheduled_date ON public.installment_charges(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_payments_installment_plan_id ON public.payments(installment_plan_id);

-- 6. Updated_at trigger function (reuse if exists)
CREATE OR REPLACE FUNCTION public.update_installment_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

-- 7. Enable RLS
ALTER TABLE public.installment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installment_charges ENABLE ROW LEVEL SECURITY;

-- 8. RLS Policies
DROP POLICY IF EXISTS "authenticated_manage_installment_plans" ON public.installment_plans;
CREATE POLICY "authenticated_manage_installment_plans"
ON public.installment_plans
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_manage_installment_charges" ON public.installment_charges;
CREATE POLICY "authenticated_manage_installment_charges"
ON public.installment_charges
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- 9. Triggers
DROP TRIGGER IF EXISTS update_installment_plans_updated_at ON public.installment_plans;
CREATE TRIGGER update_installment_plans_updated_at
    BEFORE UPDATE ON public.installment_plans
    FOR EACH ROW
    EXECUTE FUNCTION public.update_installment_updated_at();

DROP TRIGGER IF EXISTS update_installment_charges_updated_at ON public.installment_charges;
CREATE TRIGGER update_installment_charges_updated_at
    BEFORE UPDATE ON public.installment_charges
    FOR EACH ROW
    EXECUTE FUNCTION public.update_installment_updated_at();

-- 10. Seed demo installment plans
DO $$
DECLARE
    existing_client_id UUID;
    existing_asset_id UUID;
    existing_user_id UUID;
    plan1_id UUID := gen_random_uuid();
    plan2_id UUID := gen_random_uuid();
BEGIN
    SELECT id INTO existing_client_id FROM public.clients LIMIT 1;
    SELECT id INTO existing_asset_id FROM public.assets LIMIT 1;
    SELECT id INTO existing_user_id FROM public.user_profiles LIMIT 1;

    IF existing_client_id IS NOT NULL THEN
        INSERT INTO public.installment_plans (
            id, client_id, asset_id, plan_name, total_amount, installment_amount,
            total_installments, installments_paid, frequency, start_date,
            next_charge_date, end_date, plan_status, currency, created_by
        ) VALUES
        (
            plan1_id, existing_client_id, existing_asset_id,
            'Monthly Vehicle Installment Plan',
            120000, 10000, 12, 2,
            'monthly'::public.billing_frequency,
            CURRENT_DATE - INTERVAL '2 months',
            CURRENT_DATE + INTERVAL '1 month',
            CURRENT_DATE + INTERVAL '10 months',
            'active'::public.installment_plan_status,
            'usd', existing_user_id
        ),
        (
            plan2_id, existing_client_id, existing_asset_id,
            'Quarterly Property Payment Plan',
            500000, 125000, 4, 1,
            'quarterly'::public.billing_frequency,
            CURRENT_DATE - INTERVAL '3 months',
            CURRENT_DATE + INTERVAL '3 months',
            CURRENT_DATE + INTERVAL '9 months',
            'active'::public.installment_plan_status,
            'usd', existing_user_id
        )
        ON CONFLICT (id) DO NOTHING;

        -- Seed installment charges for plan1
        INSERT INTO public.installment_charges (
            plan_id, client_id, installment_number, amount, scheduled_date, charge_status
        ) VALUES
        (plan1_id, existing_client_id, 1, 10000, CURRENT_DATE - INTERVAL '2 months', 'succeeded'::public.installment_charge_status),
        (plan1_id, existing_client_id, 2, 10000, CURRENT_DATE - INTERVAL '1 month', 'succeeded'::public.installment_charge_status),
        (plan1_id, existing_client_id, 3, 10000, CURRENT_DATE + INTERVAL '1 month', 'scheduled'::public.installment_charge_status),
        (plan1_id, existing_client_id, 4, 10000, CURRENT_DATE + INTERVAL '2 months', 'scheduled'::public.installment_charge_status),
        (plan1_id, existing_client_id, 5, 10000, CURRENT_DATE + INTERVAL '3 months', 'scheduled'::public.installment_charge_status)
        ON CONFLICT (id) DO NOTHING;

        -- Seed installment charges for plan2
        INSERT INTO public.installment_charges (
            plan_id, client_id, installment_number, amount, scheduled_date, charge_status
        ) VALUES
        (plan2_id, existing_client_id, 1, 125000, CURRENT_DATE - INTERVAL '3 months', 'succeeded'::public.installment_charge_status),
        (plan2_id, existing_client_id, 2, 125000, CURRENT_DATE + INTERVAL '3 months', 'scheduled'::public.installment_charge_status),
        (plan2_id, existing_client_id, 3, 125000, CURRENT_DATE + INTERVAL '6 months', 'scheduled'::public.installment_charge_status),
        (plan2_id, existing_client_id, 4, 125000, CURRENT_DATE + INTERVAL '9 months', 'scheduled'::public.installment_charge_status)
        ON CONFLICT (id) DO NOTHING;
    ELSE
        RAISE NOTICE 'No clients found. Skipping installment plan seed data.';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Installment billing seed failed: %', SQLERRM;
END $$;

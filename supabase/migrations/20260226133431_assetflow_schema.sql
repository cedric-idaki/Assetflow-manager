-- AssetFlow Complete Schema Migration
-- Tables: user_profiles, clients, assets, payments, agents, audit_logs

-- 1. TYPES
DROP TYPE IF EXISTS public.user_role CASCADE;
CREATE TYPE public.user_role AS ENUM ('super_admin', 'admin', 'manager', 'finance', 'collections', 'sales', 'operations');

DROP TYPE IF EXISTS public.asset_type CASCADE;
CREATE TYPE public.asset_type AS ENUM ('property', 'vehicle', 'equipment', 'other');

DROP TYPE IF EXISTS public.asset_status CASCADE;
CREATE TYPE public.asset_status AS ENUM ('available', 'reserved', 'sold', 'under_maintenance');

DROP TYPE IF EXISTS public.client_status CASCADE;
CREATE TYPE public.client_status AS ENUM ('active', 'inactive', 'suspended', 'pending');

DROP TYPE IF EXISTS public.payment_status CASCADE;
CREATE TYPE public.payment_status AS ENUM ('pending', 'completed', 'failed', 'reversed');

DROP TYPE IF EXISTS public.payment_method CASCADE;
CREATE TYPE public.payment_method AS ENUM ('cash', 'bank_transfer', 'mpesa', 'cheque', 'card');

DROP TYPE IF EXISTS public.agent_status CASCADE;
CREATE TYPE public.agent_status AS ENUM ('active', 'inactive', 'on_leave', 'terminated');

DROP TYPE IF EXISTS public.audit_action CASCADE;
CREATE TYPE public.audit_action AS ENUM ('create', 'update', 'delete', 'login', 'logout', 'approve', 'reject', 'view');

-- 2. CORE TABLES

-- User Profiles (linked to auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    role public.user_role DEFAULT 'operations'::public.user_role,
    department TEXT,
    phone TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Clients
CREATE TABLE IF NOT EXISTS public.clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_number TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    national_id TEXT,
    address TEXT,
    city TEXT,
    country TEXT DEFAULT 'Kenya',
    client_status public.client_status DEFAULT 'active'::public.client_status,
    credit_score INTEGER DEFAULT 0,
    total_assets INTEGER DEFAULT 0,
    outstanding_balance DECIMAL(15,2) DEFAULT 0,
    notes TEXT,
    created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Assets
CREATE TABLE IF NOT EXISTS public.assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_code TEXT UNIQUE NOT NULL,
    asset_type public.asset_type DEFAULT 'other'::public.asset_type,
    description TEXT NOT NULL,
    purchase_price DECIMAL(15,2) DEFAULT 0,
    selling_price DECIMAL(15,2) DEFAULT 0,
    current_value DECIMAL(15,2) DEFAULT 0,
    asset_status public.asset_status DEFAULT 'available'::public.asset_status,
    location TEXT,
    serial_number TEXT,
    make TEXT,
    model TEXT,
    year INTEGER,
    color TEXT,
    plate_number TEXT,
    chassis_number TEXT,
    property_type TEXT,
    property_size TEXT,
    linked_client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    registered_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Agents (Sales Agents)
CREATE TABLE IF NOT EXISTS public.agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    agent_code TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    agent_status public.agent_status DEFAULT 'active'::public.agent_status,
    commission_rate DECIMAL(5,2) DEFAULT 5.00,
    total_sales DECIMAL(15,2) DEFAULT 0,
    total_commission DECIMAL(15,2) DEFAULT 0,
    target_amount DECIMAL(15,2) DEFAULT 0,
    region TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Payments
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id TEXT UNIQUE NOT NULL,
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    asset_id UUID REFERENCES public.assets(id) ON DELETE SET NULL,
    agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    amount DECIMAL(15,2) NOT NULL,
    payment_method public.payment_method DEFAULT 'cash'::public.payment_method,
    payment_status public.payment_status DEFAULT 'pending'::public.payment_status,
    reference_number TEXT,
    notes TEXT,
    processed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    payment_date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    action public.audit_action NOT NULL,
    table_name TEXT,
    record_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address TEXT,
    user_agent TEXT,
    description TEXT,
    severity TEXT DEFAULT 'info',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. INDEXES
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON public.user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_clients_account_number ON public.clients(account_number);
CREATE INDEX IF NOT EXISTS idx_clients_status ON public.clients(client_status);
CREATE INDEX IF NOT EXISTS idx_assets_code ON public.assets(asset_code);
CREATE INDEX IF NOT EXISTS idx_assets_status ON public.assets(asset_status);
CREATE INDEX IF NOT EXISTS idx_assets_client ON public.assets(linked_client_id);
CREATE INDEX IF NOT EXISTS idx_payments_client ON public.payments(client_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(payment_status);
CREATE INDEX IF NOT EXISTS idx_payments_date ON public.payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_agents_user ON public.agents(user_id);

-- 4. FUNCTIONS

-- Handle new user registration
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, full_name, avatar_url, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'avatar_url', ''),
        COALESCE(NEW.raw_user_meta_data->>'role', 'operations')::public.user_role
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

-- Check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
SELECT EXISTS (
    SELECT 1 FROM auth.users au
    WHERE au.id = auth.uid()
    AND (
        au.raw_user_meta_data->>'role' IN ('super_admin', 'admin', 'manager')
        OR au.raw_app_meta_data->>'role' IN ('super_admin', 'admin', 'manager')
    )
)
$$;

-- 5. ENABLE RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 6. RLS POLICIES

-- user_profiles: own profile
DROP POLICY IF EXISTS "users_manage_own_profile" ON public.user_profiles;
CREATE POLICY "users_manage_own_profile"
ON public.user_profiles FOR ALL TO authenticated
USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "users_view_all_profiles" ON public.user_profiles;
CREATE POLICY "users_view_all_profiles"
ON public.user_profiles FOR SELECT TO authenticated
USING (true);

-- clients: authenticated users can manage
DROP POLICY IF EXISTS "authenticated_manage_clients" ON public.clients;
CREATE POLICY "authenticated_manage_clients"
ON public.clients FOR ALL TO authenticated
USING (true) WITH CHECK (true);

-- assets: authenticated users can manage
DROP POLICY IF EXISTS "authenticated_manage_assets" ON public.assets;
CREATE POLICY "authenticated_manage_assets"
ON public.assets FOR ALL TO authenticated
USING (true) WITH CHECK (true);

-- agents: authenticated users can manage
DROP POLICY IF EXISTS "authenticated_manage_agents" ON public.agents;
CREATE POLICY "authenticated_manage_agents"
ON public.agents FOR ALL TO authenticated
USING (true) WITH CHECK (true);

-- payments: authenticated users can manage
DROP POLICY IF EXISTS "authenticated_manage_payments" ON public.payments;
CREATE POLICY "authenticated_manage_payments"
ON public.payments FOR ALL TO authenticated
USING (true) WITH CHECK (true);

-- audit_logs: authenticated users can view, insert only
DROP POLICY IF EXISTS "authenticated_view_audit_logs" ON public.audit_logs;
CREATE POLICY "authenticated_view_audit_logs"
ON public.audit_logs FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "authenticated_insert_audit_logs" ON public.audit_logs;
CREATE POLICY "authenticated_insert_audit_logs"
ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK (true);

-- 7. TRIGGERS

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON public.user_profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_clients_updated_at ON public.clients;
CREATE TRIGGER update_clients_updated_at
    BEFORE UPDATE ON public.clients
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_assets_updated_at ON public.assets;
CREATE TRIGGER update_assets_updated_at
    BEFORE UPDATE ON public.assets
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_payments_updated_at ON public.payments;
CREATE TRIGGER update_payments_updated_at
    BEFORE UPDATE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_agents_updated_at ON public.agents;
CREATE TRIGGER update_agents_updated_at
    BEFORE UPDATE ON public.agents
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 8. MOCK DATA
DO $$
DECLARE
    admin_uuid UUID := gen_random_uuid();
    manager_uuid UUID := gen_random_uuid();
    sales_uuid UUID := gen_random_uuid();
    client1_uuid UUID := gen_random_uuid();
    client2_uuid UUID := gen_random_uuid();
    client3_uuid UUID := gen_random_uuid();
    asset1_uuid UUID := gen_random_uuid();
    asset2_uuid UUID := gen_random_uuid();
    asset3_uuid UUID := gen_random_uuid();
    agent1_uuid UUID := gen_random_uuid();
    payment1_uuid UUID := gen_random_uuid();
BEGIN
    -- Create auth users (trigger creates user_profiles automatically)
    INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_user_meta_data, raw_app_meta_data,
        is_sso_user, is_anonymous, confirmation_token, confirmation_sent_at,
        recovery_token, recovery_sent_at, email_change_token_new, email_change,
        email_change_sent_at, email_change_token_current, email_change_confirm_status,
        reauthentication_token, reauthentication_sent_at, phone, phone_change,
        phone_change_token, phone_change_sent_at
    ) VALUES
        (admin_uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'admin@assetflow.com', crypt('admin123', gen_salt('bf', 10)), now(), now(), now(),
         jsonb_build_object('full_name', 'System Administrator', 'role', 'admin'),
         jsonb_build_object('provider', 'email', 'providers', ARRAY['email']::TEXT[]),
         false, false, '', null, '', null, '', '', null, '', 0, '', null, null, '', '', null),
        (manager_uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'manager@assetflow.com', crypt('manager123', gen_salt('bf', 10)), now(), now(), now(),
         jsonb_build_object('full_name', 'Sarah Mitchell', 'role', 'manager'),
         jsonb_build_object('provider', 'email', 'providers', ARRAY['email']::TEXT[]),
         false, false, '', null, '', null, '', '', null, '', 0, '', null, null, '', '', null),
        (sales_uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'sales@assetflow.com', crypt('sales123', gen_salt('bf', 10)), now(), now(), now(),
         jsonb_build_object('full_name', 'James Odhiambo', 'role', 'sales'),
         jsonb_build_object('provider', 'email', 'providers', ARRAY['email']::TEXT[]),
         false, false, '', null, '', null, '', '', null, '', 0, '', null, null, '', '', null)
    ON CONFLICT (id) DO NOTHING;

    -- Clients
    INSERT INTO public.clients (id, account_number, full_name, email, phone, national_id, city, client_status, credit_score, outstanding_balance, created_by)
    VALUES
        (client1_uuid, 'ACC-2024-001', 'John Anderson', 'john.anderson@email.com', '+254712345678', 'ID-12345678', 'Nairobi', 'active'::public.client_status, 750, 28500.00, admin_uuid),
        (client2_uuid, 'ACC-2024-002', 'Sarah Mitchell', 'sarah.m@email.com', '+254723456789', 'ID-23456789', 'Mombasa', 'active'::public.client_status, 680, 42000.00, admin_uuid),
        (client3_uuid, 'ACC-2024-003', 'Michael Chen', 'michael.c@email.com', '+254734567890', 'ID-34567890', 'Kisumu', 'active'::public.client_status, 720, 15000.00, admin_uuid)
    ON CONFLICT (id) DO NOTHING;

    -- Assets
    INSERT INTO public.assets (id, asset_code, asset_type, description, purchase_price, selling_price, current_value, asset_status, location, make, model, year, color, plate_number, linked_client_id, registered_by)
    VALUES
        (asset1_uuid, 'AST-2024-001', 'property'::public.asset_type, 'Luxury 3-Bedroom Apartment - Westlands', 250000.00, 320000.00, 310000.00, 'available'::public.asset_status, 'Westlands, Nairobi', null, null, null, null, null, null, admin_uuid),
        (asset2_uuid, 'AST-2024-002', 'vehicle'::public.asset_type, '2022 Toyota Land Cruiser', 65000.00, 85000.00, 80000.00, 'reserved'::public.asset_status, 'Nairobi Showroom', 'Toyota', 'Land Cruiser', 2022, 'White', 'KCA 123A', client1_uuid, admin_uuid),
        (asset3_uuid, 'AST-2024-003', 'property'::public.asset_type, 'Commercial Land Plot - Thika Road', 180000.00, 225000.00, 220000.00, 'available'::public.asset_status, 'Thika Road, Nairobi', null, null, null, null, null, null, admin_uuid)
    ON CONFLICT (id) DO NOTHING;

    -- Agents
    INSERT INTO public.agents (id, user_id, agent_code, full_name, email, phone, agent_status, commission_rate, total_sales, total_commission, target_amount, region)
    VALUES
        (agent1_uuid, sales_uuid, 'AGT-001', 'James Odhiambo', 'sales@assetflow.com', '+254745678901', 'active'::public.agent_status, 5.00, 450000.00, 22500.00, 500000.00, 'Nairobi')
    ON CONFLICT (id) DO NOTHING;

    -- Payments
    INSERT INTO public.payments (id, transaction_id, client_id, asset_id, agent_id, amount, payment_method, payment_status, reference_number, processed_by, payment_date)
    VALUES
        (payment1_uuid, 'TXN-2024-0001', client1_uuid, asset2_uuid, agent1_uuid, 5000.00, 'mpesa'::public.payment_method, 'completed'::public.payment_status, 'MPESA-REF-001', admin_uuid, now() - interval '2 days')
    ON CONFLICT (id) DO NOTHING;

    -- Audit Logs
    INSERT INTO public.audit_logs (user_id, action, table_name, description, severity)
    VALUES
        (admin_uuid, 'login'::public.audit_action, null, 'Admin user logged in successfully', 'info'),
        (admin_uuid, 'create'::public.audit_action, 'clients', 'Created client John Anderson', 'info'),
        (admin_uuid, 'create'::public.audit_action, 'assets', 'Registered asset AST-2024-001', 'info')
    ON CONFLICT (id) DO NOTHING;

EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Mock data insertion failed: %', SQLERRM;
END $$;

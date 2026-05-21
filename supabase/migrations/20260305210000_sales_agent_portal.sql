-- Sales Agent Portal: leads, agent_wallets, sales_expenses, follow_ups
-- Timestamp: 20260305210000 (higher than existing 20260304200000)

-- ==================== TYPES ====================
DROP TYPE IF EXISTS public.lead_stage CASCADE;
CREATE TYPE public.lead_stage AS ENUM ('new_lead', 'contacted', 'qualified', 'proposal_sent', 'closed');

DROP TYPE IF EXISTS public.lead_priority CASCADE;
CREATE TYPE public.lead_priority AS ENUM ('low', 'medium', 'high');

DROP TYPE IF EXISTS public.expense_category CASCADE;
CREATE TYPE public.expense_category AS ENUM ('transport', 'meetings', 'marketing', 'other');

DROP TYPE IF EXISTS public.wallet_tx_type CASCADE;
CREATE TYPE public.wallet_tx_type AS ENUM ('credit', 'withdrawal', 'adjustment');

-- ==================== TABLES ====================

-- Leads table
CREATE TABLE IF NOT EXISTS public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    asset_interest TEXT,
    budget_range TEXT,
    priority public.lead_priority DEFAULT 'medium'::public.lead_priority,
    stage public.lead_stage DEFAULT 'new_lead'::public.lead_stage,
    source TEXT,
    notes TEXT,
    last_contact_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Agent wallets table
CREATE TABLE IF NOT EXISTS public.agent_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
    total_earned NUMERIC DEFAULT 0,
    total_withdrawn NUMERIC DEFAULT 0,
    available_balance NUMERIC DEFAULT 0,
    tx_type public.wallet_tx_type DEFAULT 'credit'::public.wallet_tx_type,
    description TEXT,
    reference_id UUID,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Sales expenses table
CREATE TABLE IF NOT EXISTS public.sales_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
    category public.expense_category DEFAULT 'other'::public.expense_category,
    amount NUMERIC NOT NULL DEFAULT 0,
    description TEXT,
    expense_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Follow-ups / appointments table
CREATE TABLE IF NOT EXISTS public.follow_ups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
    lead_name TEXT,
    appointment_type TEXT DEFAULT 'follow_up',
    scheduled_at TIMESTAMPTZ NOT NULL,
    location TEXT,
    notes TEXT,
    is_completed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ==================== INDEXES ====================
CREATE INDEX IF NOT EXISTS idx_leads_agent_id ON public.leads(agent_id);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON public.leads(stage);
CREATE INDEX IF NOT EXISTS idx_agent_wallets_agent_id ON public.agent_wallets(agent_id);
CREATE INDEX IF NOT EXISTS idx_sales_expenses_agent_id ON public.sales_expenses(agent_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_agent_id ON public.follow_ups(agent_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_scheduled_at ON public.follow_ups(scheduled_at);

-- ==================== HELPER FUNCTION ====================
CREATE OR REPLACE FUNCTION public.get_agent_id_for_user(user_uuid UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT id FROM public.agents WHERE user_id = user_uuid LIMIT 1;
$$;

-- ==================== ENABLE RLS ====================
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;

-- ==================== RLS POLICIES: leads ====================
DROP POLICY IF EXISTS "agents_select_own_leads" ON public.leads;
CREATE POLICY "agents_select_own_leads"
ON public.leads FOR SELECT TO authenticated
USING (agent_id = public.get_agent_id_for_user(auth.uid()));

DROP POLICY IF EXISTS "agents_insert_own_leads" ON public.leads;
CREATE POLICY "agents_insert_own_leads"
ON public.leads FOR INSERT TO authenticated
WITH CHECK (agent_id = public.get_agent_id_for_user(auth.uid()));

DROP POLICY IF EXISTS "agents_update_own_leads" ON public.leads;
CREATE POLICY "agents_update_own_leads"
ON public.leads FOR UPDATE TO authenticated
USING (agent_id = public.get_agent_id_for_user(auth.uid()))
WITH CHECK (agent_id = public.get_agent_id_for_user(auth.uid()));

DROP POLICY IF EXISTS "agents_delete_own_leads" ON public.leads;
CREATE POLICY "agents_delete_own_leads"
ON public.leads FOR DELETE TO authenticated
USING (agent_id = public.get_agent_id_for_user(auth.uid()));

-- ==================== RLS POLICIES: agent_wallets ====================
DROP POLICY IF EXISTS "agents_select_own_wallet" ON public.agent_wallets;
CREATE POLICY "agents_select_own_wallet"
ON public.agent_wallets FOR SELECT TO authenticated
USING (agent_id = public.get_agent_id_for_user(auth.uid()));

DROP POLICY IF EXISTS "agents_insert_own_wallet" ON public.agent_wallets;
CREATE POLICY "agents_insert_own_wallet"
ON public.agent_wallets FOR INSERT TO authenticated
WITH CHECK (agent_id = public.get_agent_id_for_user(auth.uid()));

-- ==================== RLS POLICIES: sales_expenses ====================
DROP POLICY IF EXISTS "agents_select_own_expenses" ON public.sales_expenses;
CREATE POLICY "agents_select_own_expenses"
ON public.sales_expenses FOR SELECT TO authenticated
USING (agent_id = public.get_agent_id_for_user(auth.uid()));

DROP POLICY IF EXISTS "agents_insert_own_expenses" ON public.sales_expenses;
CREATE POLICY "agents_insert_own_expenses"
ON public.sales_expenses FOR INSERT TO authenticated
WITH CHECK (agent_id = public.get_agent_id_for_user(auth.uid()));

DROP POLICY IF EXISTS "agents_update_own_expenses" ON public.sales_expenses;
CREATE POLICY "agents_update_own_expenses"
ON public.sales_expenses FOR UPDATE TO authenticated
USING (agent_id = public.get_agent_id_for_user(auth.uid()))
WITH CHECK (agent_id = public.get_agent_id_for_user(auth.uid()));

-- ==================== RLS POLICIES: follow_ups ====================
DROP POLICY IF EXISTS "agents_select_own_followups" ON public.follow_ups;
CREATE POLICY "agents_select_own_followups"
ON public.follow_ups FOR SELECT TO authenticated
USING (agent_id = public.get_agent_id_for_user(auth.uid()));

DROP POLICY IF EXISTS "agents_insert_own_followups" ON public.follow_ups;
CREATE POLICY "agents_insert_own_followups"
ON public.follow_ups FOR INSERT TO authenticated
WITH CHECK (agent_id = public.get_agent_id_for_user(auth.uid()));

DROP POLICY IF EXISTS "agents_update_own_followups" ON public.follow_ups;
CREATE POLICY "agents_update_own_followups"
ON public.follow_ups FOR UPDATE TO authenticated
USING (agent_id = public.get_agent_id_for_user(auth.uid()))
WITH CHECK (agent_id = public.get_agent_id_for_user(auth.uid()));

-- ==================== MOCK DATA ====================
DO $$
DECLARE
    existing_agent_id UUID;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'agents'
    ) THEN
        SELECT id INTO existing_agent_id FROM public.agents LIMIT 1;

        IF existing_agent_id IS NOT NULL THEN
            -- Seed leads
            INSERT INTO public.leads (id, agent_id, full_name, phone, email, asset_interest, budget_range, priority, stage, source, notes)
            VALUES
                (gen_random_uuid(), existing_agent_id, 'Alice Mwangi', '+254712345678', 'alice@example.com', '3-bedroom apartment in Westlands', '5,000,000 - 8,000,000', 'high'::public.lead_priority, 'new_lead'::public.lead_stage, 'referral', 'Interested in off-plan units'),
                (gen_random_uuid(), existing_agent_id, 'Brian Otieno', '+254723456789', 'brian@example.com', 'Toyota Land Cruiser 2022', '4,000,000 - 6,000,000', 'high'::public.lead_priority, 'contacted'::public.lead_stage, 'walk_in', 'Prefers white color'),
                (gen_random_uuid(), existing_agent_id, 'Carol Njeri', '+254734567890', 'carol@example.com', 'Commercial plot in Ruiru', '2,000,000 - 3,500,000', 'medium'::public.lead_priority, 'qualified'::public.lead_stage, 'website', 'Has financing pre-approval'),
                (gen_random_uuid(), existing_agent_id, 'David Kamau', '+254745678901', 'david@example.com', 'Warehouse equipment', '800,000 - 1,200,000', 'medium'::public.lead_priority, 'proposal_sent'::public.lead_stage, 'cold_call', 'Proposal sent on Monday'),
                (gen_random_uuid(), existing_agent_id, 'Eve Wanjiku', '+254756789012', 'eve@example.com', '2-bedroom apartment Kilimani', '3,500,000 - 5,000,000', 'low'::public.lead_priority, 'closed'::public.lead_stage, 'social_media', 'Deal closed successfully')
            ON CONFLICT (id) DO NOTHING;

            -- Seed wallet transactions
            INSERT INTO public.agent_wallets (id, agent_id, total_earned, total_withdrawn, available_balance, tx_type, description)
            VALUES
                (gen_random_uuid(), existing_agent_id, 85000, 30000, 55000, 'credit'::public.wallet_tx_type, 'Commission from Eve Wanjiku deal'),
                (gen_random_uuid(), existing_agent_id, 45000, 0, 45000, 'credit'::public.wallet_tx_type, 'Commission from David Kamau proposal'),
                (gen_random_uuid(), existing_agent_id, 0, 30000, -30000, 'withdrawal'::public.wallet_tx_type, 'Monthly withdrawal request')
            ON CONFLICT (id) DO NOTHING;

            -- Seed sales expenses
            INSERT INTO public.sales_expenses (id, agent_id, category, amount, description, expense_date)
            VALUES
                (gen_random_uuid(), existing_agent_id, 'transport'::public.expense_category, 2500, 'Site visit to Westlands property', CURRENT_DATE - 2),
                (gen_random_uuid(), existing_agent_id, 'meetings'::public.expense_category, 4500, 'Client lunch at Sarova Stanley', CURRENT_DATE - 5),
                (gen_random_uuid(), existing_agent_id, 'marketing'::public.expense_category, 8000, 'Facebook ads for property listings', CURRENT_DATE - 7),
                (gen_random_uuid(), existing_agent_id, 'transport'::public.expense_category, 1800, 'Fuel for client site visits', CURRENT_DATE - 1)
            ON CONFLICT (id) DO NOTHING;

            -- Seed follow-ups
            INSERT INTO public.follow_ups (id, agent_id, lead_name, appointment_type, scheduled_at, location, notes)
            VALUES
                (gen_random_uuid(), existing_agent_id, 'Alice Mwangi', 'site_visit', NOW() + INTERVAL '1 day', 'Westlands Apartments, Block A', 'Show 3-bedroom unit on 4th floor'),
                (gen_random_uuid(), existing_agent_id, 'Brian Otieno', 'office_meeting', NOW() + INTERVAL '2 days', 'Head Office, Upperhill', 'Finalize vehicle purchase agreement'),
                (gen_random_uuid(), existing_agent_id, 'Carol Njeri', 'phone_call', NOW() + INTERVAL '3 days', 'Phone', 'Follow up on financing approval status'),
                (gen_random_uuid(), existing_agent_id, 'David Kamau', 'site_visit', NOW() + INTERVAL '5 days', 'Ruiru Industrial Area', 'Equipment demonstration')
            ON CONFLICT (id) DO NOTHING;
        ELSE
            RAISE NOTICE 'No agents found. Skipping sales portal mock data.';
        END IF;
    ELSE
        RAISE NOTICE 'Agents table does not exist. Skipping mock data.';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Mock data insertion failed: %', SQLERRM;
END $$;

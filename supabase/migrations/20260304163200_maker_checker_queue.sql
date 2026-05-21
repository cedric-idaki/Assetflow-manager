-- Maker-Checker Queue Migration
-- Creates tables for dual approval workflow system

-- 1. Create action_type enum
DROP TYPE IF EXISTS public.mc_action_type CASCADE;
CREATE TYPE public.mc_action_type AS ENUM (
  'payment_split_change',
  'debt_adjustment',
  'commission_override',
  'role_change',
  'high_value_transaction',
  'kyc_approval',
  'user_creation',
  'asset_deletion',
  'payment_refund',
  'system_config'
);

DROP TYPE IF EXISTS public.mc_status CASCADE;
CREATE TYPE public.mc_status AS ENUM ('pending', 'approved', 'rejected', 'escalated', 'expired');

DROP TYPE IF EXISTS public.mc_priority CASCADE;
CREATE TYPE public.mc_priority AS ENUM ('low', 'medium', 'high', 'critical');

-- 2. Create maker_checker_queue table
CREATE TABLE IF NOT EXISTS public.maker_checker_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type public.mc_action_type NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  initiator_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  initiator_name TEXT NOT NULL,
  initiator_role TEXT NOT NULL,
  checker_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  checker_name TEXT,
  checker_role TEXT,
  status public.mc_status DEFAULT 'pending'::public.mc_status,
  priority public.mc_priority DEFAULT 'medium'::public.mc_priority,
  affected_entity TEXT,
  affected_entity_id TEXT,
  change_details JSONB DEFAULT '{}'::jsonb,
  checker_comment TEXT,
  is_bulk_eligible BOOLEAN DEFAULT false,
  escalated_to UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  escalation_reason TEXT,
  escalated_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  notification_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mcq_status ON public.maker_checker_queue(status);
CREATE INDEX IF NOT EXISTS idx_mcq_action_type ON public.maker_checker_queue(action_type);
CREATE INDEX IF NOT EXISTS idx_mcq_initiator_id ON public.maker_checker_queue(initiator_id);
CREATE INDEX IF NOT EXISTS idx_mcq_created_at ON public.maker_checker_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_mcq_priority ON public.maker_checker_queue(priority);

-- 3. Create approval_thresholds table
CREATE TABLE IF NOT EXISTS public.approval_thresholds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type public.mc_action_type NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  requires_approval BOOLEAN DEFAULT true,
  auto_approve_below NUMERIC,
  escalate_above NUMERIC,
  sla_hours INTEGER DEFAULT 24,
  bulk_eligible BOOLEAN DEFAULT false,
  required_checker_role TEXT DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4. Enable RLS
ALTER TABLE public.maker_checker_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_thresholds ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
DROP POLICY IF EXISTS "authenticated_manage_maker_checker_queue" ON public.maker_checker_queue;
CREATE POLICY "authenticated_manage_maker_checker_queue"
  ON public.maker_checker_queue
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_manage_approval_thresholds" ON public.approval_thresholds;
CREATE POLICY "authenticated_manage_approval_thresholds"
  ON public.approval_thresholds
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 6. Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_maker_checker_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mcq_updated_at ON public.maker_checker_queue;
CREATE TRIGGER trg_mcq_updated_at
  BEFORE UPDATE ON public.maker_checker_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_maker_checker_updated_at();

DROP TRIGGER IF EXISTS trg_thresholds_updated_at ON public.approval_thresholds;
CREATE TRIGGER trg_thresholds_updated_at
  BEFORE UPDATE ON public.approval_thresholds
  FOR EACH ROW EXECUTE FUNCTION public.update_maker_checker_updated_at();

-- 7. Seed approval thresholds
INSERT INTO public.approval_thresholds (action_type, display_name, requires_approval, auto_approve_below, escalate_above, sla_hours, bulk_eligible, required_checker_role)
VALUES
  ('payment_split_change', 'Payment Split Change', true, 500, 50000, 24, false, 'admin'),
  ('debt_adjustment', 'Debt Adjustment', true, 1000, 100000, 48, false, 'admin'),
  ('commission_override', 'Commission Override', true, 200, 10000, 24, true, 'admin'),
  ('role_change', 'Role Change', true, NULL, NULL, 24, false, 'super_admin'),
  ('high_value_transaction', 'High Value Transaction', true, 5000, 500000, 12, false, 'admin'),
  ('kyc_approval', 'KYC Approval', true, NULL, NULL, 48, true, 'compliance_officer'),
  ('user_creation', 'User Creation', true, NULL, NULL, 24, true, 'admin'),
  ('asset_deletion', 'Asset Deletion', true, NULL, NULL, 24, false, 'super_admin'),
  ('payment_refund', 'Payment Refund', true, 500, 25000, 24, false, 'admin'),
  ('system_config', 'System Configuration', true, NULL, NULL, 12, false, 'super_admin')
ON CONFLICT (action_type) DO NOTHING;

-- 8. Seed mock maker-checker queue items
DO $$
DECLARE
  initiator_id UUID;
  checker_id UUID;
BEGIN
  SELECT id INTO initiator_id FROM public.user_profiles LIMIT 1;

  IF initiator_id IS NOT NULL THEN
    INSERT INTO public.maker_checker_queue (
      id, action_type, title, description, initiator_id, initiator_name, initiator_role,
      status, priority, affected_entity, affected_entity_id, change_details, bulk_eligible,
      due_at, created_at
    ) VALUES
    (
      gen_random_uuid(), 'payment_split_change', 'Payment Split Adjustment - ACC-2024-1523',
      'Modify principal/interest split ratio from 60/40 to 70/30 for account ACC-2024-1523',
      initiator_id, 'David Thompson', 'Accountant',
      'pending', 'high', 'Account ACC-2024-1523', 'ACC-2024-1523',
      jsonb_build_object('old_split', '60/40', 'new_split', '70/30', 'amount', 45000, 'reason', 'Client hardship restructuring'),
      false, CURRENT_TIMESTAMP + INTERVAL '24 hours', CURRENT_TIMESTAMP - INTERVAL '2 hours'
    ),
    (
      gen_random_uuid(), 'debt_adjustment', 'Debt Write-off - Client Wanjiku Kamau',
      'Write off outstanding balance of KES 12,500 for client Wanjiku Kamau due to verified financial hardship',
      initiator_id, 'Lisa Anderson', 'Collections Officer',
      'pending', 'critical', 'Client: Wanjiku Kamau', 'CLT-0892',
      jsonb_build_object('amount', 12500, 'currency', 'KES', 'reason', 'Financial hardship - verified', 'supporting_docs', 'hardship_cert_2024.pdf'),
      false, CURRENT_TIMESTAMP + INTERVAL '12 hours', CURRENT_TIMESTAMP - INTERVAL '5 hours'
    ),
    (
      gen_random_uuid(), 'commission_override', 'Commission Override - Agent Mwangi',
      'Override standard commission rate from 3% to 5% for Q1 performance bonus for Agent James Mwangi',
      initiator_id, 'Michael Chen', 'Administrator',
      'pending', 'medium', 'Agent: James Mwangi', 'AGT-0045',
      jsonb_build_object('standard_rate', '3%', 'override_rate', '5%', 'period', 'Q1 2026', 'justification', 'Top performer bonus'),
      true, CURRENT_TIMESTAMP + INTERVAL '48 hours', CURRENT_TIMESTAMP - INTERVAL '1 hour'
    ),
    (
      gen_random_uuid(), 'kyc_approval', 'KYC Document Approval - Batch 12',
      'Approve KYC documents for 8 clients in batch 12 - all documents verified by compliance team',
      initiator_id, 'Sarah Mitchell', 'Compliance Officer',
      'pending', 'medium', 'KYC Batch #12', 'KYC-BATCH-12',
      jsonb_build_object('client_count', 8, 'documents_reviewed', 24, 'risk_level', 'low', 'compliance_score', 94),
      true, CURRENT_TIMESTAMP + INTERVAL '48 hours', CURRENT_TIMESTAMP - INTERVAL '3 hours'
    ),
    (
      gen_random_uuid(), 'role_change', 'Role Elevation - Emily Johnson',
      'Promote Emily Johnson from Sales Agent to Senior Sales Agent with expanded permissions',
      initiator_id, 'Michael Chen', 'Administrator',
      'pending', 'medium', 'User: Emily Johnson', 'USR-0234',
      jsonb_build_object('current_role', 'Sales Agent', 'new_role', 'Senior Sales Agent', 'new_permissions', ARRAY['approve_discounts', 'view_all_clients']),
      false, CURRENT_TIMESTAMP + INTERVAL '24 hours', CURRENT_TIMESTAMP - INTERVAL '30 minutes'
    ),
    (
      gen_random_uuid(), 'high_value_transaction', 'High-Value Payment - KES 2.4M',
      'Process high-value payment of KES 2,400,000 from Equity Bank for asset portfolio settlement',
      initiator_id, 'David Thompson', 'Accountant',
      'escalated', 'critical', 'Payment: PAY-2026-0891', 'PAY-2026-0891',
      jsonb_build_object('amount', 2400000, 'currency', 'KES', 'bank', 'Equity Bank', 'reference', 'EQB-TXN-20260304', 'asset_portfolio', 'PORT-0012'),
      false, CURRENT_TIMESTAMP + INTERVAL '6 hours', CURRENT_TIMESTAMP - INTERVAL '8 hours'
    ),
    (
      gen_random_uuid(), 'payment_refund', 'Refund Processing - ACC-2024-0445',
      'Process refund of KES 8,750 for duplicate payment on account ACC-2024-0445',
      initiator_id, 'Lisa Anderson', 'Collections Officer',
      'approved', 'low', 'Account ACC-2024-0445', 'ACC-2024-0445',
      jsonb_build_object('refund_amount', 8750, 'currency', 'KES', 'reason', 'Duplicate payment', 'payment_ref', 'PAY-2026-0788'),
      true, CURRENT_TIMESTAMP + INTERVAL '24 hours', CURRENT_TIMESTAMP - INTERVAL '2 days'
    ),
    (
      gen_random_uuid(), 'user_creation', 'New User Account - Grace Otieno',
      'Create new Collections Officer account for Grace Otieno joining the Nairobi branch',
      initiator_id, 'Michael Chen', 'Administrator',
      'rejected', 'low', 'New User: Grace Otieno', 'USR-NEW-0089',
      jsonb_build_object('name', 'Grace Otieno', 'email', 'g.otieno@finasset.com', 'role', 'Collections Officer', 'branch', 'Nairobi'),
      true, CURRENT_TIMESTAMP + INTERVAL '24 hours', CURRENT_TIMESTAMP - INTERVAL '3 days'
    )
    ON CONFLICT (id) DO NOTHING;
  ELSE
    RAISE NOTICE 'No user_profiles found. Skipping mock data.';
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Mock data insertion failed: %', SQLERRM;
END $$;

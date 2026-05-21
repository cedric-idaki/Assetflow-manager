-- Payment Calculator: Saved Schedules & Reminders
-- Migration: 20260226150000_payment_calculator.sql

-- 1. Create payment_schedules table
CREATE TABLE IF NOT EXISTS public.payment_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES public.assets(id) ON DELETE CASCADE,
  schedule_name TEXT NOT NULL,
  payment_amount NUMERIC NOT NULL DEFAULT 0,
  scheduled_date DATE NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  early_payment BOOLEAN DEFAULT false,
  discount_rate NUMERIC DEFAULT 0,
  discount_amount NUMERIC DEFAULT 0,
  final_amount NUMERIC NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create payment_reminders table
CREATE TABLE IF NOT EXISTS public.payment_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID REFERENCES public.payment_schedules(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL DEFAULT 'email',
  reminder_days_before INTEGER NOT NULL DEFAULT 3,
  email_enabled BOOLEAN DEFAULT true,
  sms_enabled BOOLEAN DEFAULT false,
  email_address TEXT,
  phone_number TEXT,
  is_active BOOLEAN DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_payment_schedules_client_id ON public.payment_schedules(client_id);
CREATE INDEX IF NOT EXISTS idx_payment_schedules_asset_id ON public.payment_schedules(asset_id);
CREATE INDEX IF NOT EXISTS idx_payment_schedules_scheduled_date ON public.payment_schedules(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_payment_schedules_status ON public.payment_schedules(status);
CREATE INDEX IF NOT EXISTS idx_payment_reminders_schedule_id ON public.payment_reminders(schedule_id);
CREATE INDEX IF NOT EXISTS idx_payment_reminders_client_id ON public.payment_reminders(client_id);

-- 4. Enable RLS
ALTER TABLE public.payment_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_reminders ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for payment_schedules
DROP POLICY IF EXISTS "authenticated_manage_payment_schedules" ON public.payment_schedules;
CREATE POLICY "authenticated_manage_payment_schedules"
  ON public.payment_schedules
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 6. RLS Policies for payment_reminders
DROP POLICY IF EXISTS "authenticated_manage_payment_reminders" ON public.payment_reminders;
CREATE POLICY "authenticated_manage_payment_reminders"
  ON public.payment_reminders
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

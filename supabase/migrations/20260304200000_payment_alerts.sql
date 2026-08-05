-- Payment Alerts: alert configs and log tables

-- 1. Alert configs table
CREATE TABLE IF NOT EXISTS public.payment_alert_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  threshold_amount NUMERIC(15,2),
  days_before_due INTEGER,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_alert_configs_type ON public.payment_alert_configs(alert_type);
CREATE INDEX IF NOT EXISTS idx_payment_alert_configs_enabled ON public.payment_alert_configs(enabled);

-- 2. Payment alerts log table
CREATE TABLE IF NOT EXISTS public.payment_alerts_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,
  event_type TEXT NOT NULL,
  recipient_email TEXT,
  recipient_phone TEXT,
  recipient_name TEXT,
  subject TEXT,
  message TEXT,
  amount NUMERIC(15,2),
  transaction_id TEXT,
  payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  email_status TEXT DEFAULT 'not_sent',
  sms_status TEXT DEFAULT 'not_sent',
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  sent_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_alerts_log_alert_type ON public.payment_alerts_log(alert_type);
CREATE INDEX IF NOT EXISTS idx_payment_alerts_log_sent_at ON public.payment_alerts_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_alerts_log_payment_id ON public.payment_alerts_log(payment_id);

-- 3. Enable RLS
ALTER TABLE public.payment_alert_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_alerts_log ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
--
-- SECURITY FIX 2026-08-02: this block used to create
--   FOR ALL TO public USING (true) WITH CHECK (true)
-- on both tables ("open access for app use"). Role `public` includes `anon`, so
-- these tables were readable and writable with NO LOGIN — confirmed live, an
-- anonymous GET returned real rows. Rewritten here so a fresh `db reset` or a
-- new environment cannot recreate the hole; 20260802150000_lock_down_payment_
-- alert_tables.sql applies the same end state to the existing project.
--
-- The only consumer is the payment-alerts Edge Function, which uses the
-- service-role key and therefore bypasses RLS. End users get a super_admin /
-- director read path and nothing more.
DROP POLICY IF EXISTS "open_access_payment_alert_configs" ON public.payment_alert_configs;
DROP POLICY IF EXISTS "open_access_payment_alerts_log" ON public.payment_alerts_log;

DROP POLICY IF EXISTS payment_alert_configs_read ON public.payment_alert_configs;
CREATE POLICY payment_alert_configs_read ON public.payment_alert_configs
  FOR SELECT TO authenticated USING (public.is_global_viewer());

DROP POLICY IF EXISTS payment_alert_configs_update ON public.payment_alert_configs;
CREATE POLICY payment_alert_configs_update ON public.payment_alert_configs
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles up
                 WHERE up.id = auth.uid() AND up.role = 'super_admin'::public.user_role))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles up
                      WHERE up.id = auth.uid() AND up.role = 'super_admin'::public.user_role));

-- Append-only: no INSERT/UPDATE/DELETE policy, service_role is the only writer.
DROP POLICY IF EXISTS payment_alerts_log_read ON public.payment_alerts_log;
CREATE POLICY payment_alerts_log_read ON public.payment_alerts_log
  FOR SELECT TO authenticated USING (public.is_global_viewer());

REVOKE ALL ON public.payment_alert_configs FROM anon;
REVOKE ALL ON public.payment_alerts_log FROM anon;
REVOKE INSERT, DELETE ON public.payment_alert_configs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.payment_alerts_log FROM authenticated;

-- 5. Seed default alert configs
DO $$
BEGIN
  INSERT INTO public.payment_alert_configs (alert_type, enabled, threshold_amount, days_before_due)
  VALUES
    ('payment_success', true, NULL, NULL),
    ('payment_failure', true, NULL, NULL),
    ('due_date_reminder_7', true, NULL, 7),
    ('due_date_reminder_3', true, NULL, 3),
    ('threshold_breach_transaction', true, 50000.00, NULL),
    ('threshold_breach_balance', true, 200000.00, NULL)
  ON CONFLICT (alert_type) DO NOTHING;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Seed failed: %', SQLERRM;
END $$;

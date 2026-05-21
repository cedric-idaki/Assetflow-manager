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

-- 4. RLS Policies - open access for app use
DROP POLICY IF EXISTS "open_access_payment_alert_configs" ON public.payment_alert_configs;
CREATE POLICY "open_access_payment_alert_configs"
  ON public.payment_alert_configs FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "open_access_payment_alerts_log" ON public.payment_alerts_log;
CREATE POLICY "open_access_payment_alerts_log"
  ON public.payment_alerts_log FOR ALL TO public USING (true) WITH CHECK (true);

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

-- KYC Reminder Logs Migration
-- Creates kyc_reminder_logs table to track sent reminders and prevent duplicates
-- Also creates kyc_documents table if it doesn't exist

-- 1. Create kyc_documents table for storing document expiry info
CREATE TABLE IF NOT EXISTS public.kyc_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  document_number TEXT,
  expiry_date DATE,
  issue_date DATE,
  status TEXT DEFAULT 'active',
  file_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kyc_documents_client_id ON public.kyc_documents(client_id);
CREATE INDEX IF NOT EXISTS idx_kyc_documents_expiry_date ON public.kyc_documents(expiry_date);

-- Enable RLS on kyc_documents
ALTER TABLE public.kyc_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated users to manage kyc_documents" ON public.kyc_documents;
CREATE POLICY "Allow authenticated users to manage kyc_documents"
  ON public.kyc_documents
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 2. Add document_expiry column to clients if not exists
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS document_expiry DATE;

-- 3. Create kyc_reminder_logs table
CREATE TABLE IF NOT EXISTS public.kyc_reminder_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  document_id UUID REFERENCES public.kyc_documents(id) ON DELETE SET NULL,
  document_type TEXT NOT NULL,
  expiry_date DATE NOT NULL,
  days_before_expiry INTEGER NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'skipped')),
  error_message TEXT,
  sent_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kyc_reminder_logs_client_id ON public.kyc_reminder_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_kyc_reminder_logs_sent_at ON public.kyc_reminder_logs(sent_at);
CREATE INDEX IF NOT EXISTS idx_kyc_reminder_logs_dedup ON public.kyc_reminder_logs(client_id, document_type, days_before_expiry, channel, expiry_date);

-- Enable RLS on kyc_reminder_logs
ALTER TABLE public.kyc_reminder_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow service role to manage kyc_reminder_logs" ON public.kyc_reminder_logs;
CREATE POLICY "Allow service role to manage kyc_reminder_logs"
  ON public.kyc_reminder_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated users to read kyc_reminder_logs" ON public.kyc_reminder_logs;
CREATE POLICY "Allow authenticated users to read kyc_reminder_logs"
  ON public.kyc_reminder_logs
  FOR SELECT
  TO authenticated
  USING (true);

-- 4. Seed sample kyc_documents for existing clients
DO $$
DECLARE
  client_rec RECORD;
  doc_count INTEGER := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'clients'
  ) THEN
    FOR client_rec IN SELECT id, full_name FROM public.clients LIMIT 3 LOOP
      -- Check if documents already exist for this client
      SELECT COUNT(*) INTO doc_count FROM public.kyc_documents WHERE client_id = client_rec.id;

      IF doc_count = 0 THEN
        INSERT INTO public.kyc_documents (id, client_id, document_type, expiry_date, status)
        VALUES
          (gen_random_uuid(), client_rec.id, 'National ID', CURRENT_DATE + INTERVAL '28 days', 'active'),
          (gen_random_uuid(), client_rec.id, 'KRA PIN Certificate', CURRENT_DATE + INTERVAL '13 days', 'active'),
          (gen_random_uuid(), client_rec.id, 'Passport', CURRENT_DATE + INTERVAL '6 days', 'active')
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'KYC documents seed failed: %', SQLERRM;
END $$;

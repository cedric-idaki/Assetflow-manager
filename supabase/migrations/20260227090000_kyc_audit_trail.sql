-- KYC Audit Trail Migration
-- Extends audit_action enum and adds KYC-specific columns to audit_logs

-- Step 1: Add new enum values to audit_action (PostgreSQL supports ALTER TYPE ADD VALUE)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'kyc_document_upload'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'audit_action')
  ) THEN
    ALTER TYPE public.audit_action ADD VALUE 'kyc_document_upload';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'kyc_status_change'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'audit_action')
  ) THEN
    ALTER TYPE public.audit_action ADD VALUE 'kyc_status_change';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'kyc_renewal'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'audit_action')
  ) THEN
    ALTER TYPE public.audit_action ADD VALUE 'kyc_renewal';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'kyc_verification'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'audit_action')
  ) THEN
    ALTER TYPE public.audit_action ADD VALUE 'kyc_verification';
  END IF;
END $$;

-- Step 2: Add client_id column to audit_logs for KYC client tracking
ALTER TABLE public.audit_logs
ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL;

ALTER TABLE public.audit_logs
ADD COLUMN IF NOT EXISTS client_name TEXT;

ALTER TABLE public.audit_logs
ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Step 3: Index for KYC audit queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_client_id ON public.audit_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);

-- Step 4: Sample KYC audit entries for demonstration
DO $$
DECLARE
  existing_user_id UUID;
  existing_client_id UUID;
  existing_client_name TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_profiles'
  ) THEN
    SELECT id INTO existing_user_id FROM public.user_profiles LIMIT 1;

    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'clients'
    ) THEN
      SELECT id, full_name INTO existing_client_id, existing_client_name
      FROM public.clients LIMIT 1;
    END IF;

    IF existing_user_id IS NOT NULL AND existing_client_id IS NOT NULL THEN
      INSERT INTO public.audit_logs (id, user_id, action, table_name, client_id, client_name, description, severity, metadata, created_at)
      VALUES
        (gen_random_uuid(), existing_user_id, 'kyc_document_upload', 'kyc_documents', existing_client_id, existing_client_name,
         'National ID document uploaded for ' || existing_client_name, 'info',
         jsonb_build_object('document_type', 'National ID', 'file_name', 'national_id_front.jpg', 'file_size', '1.2 MB', 'file_type', 'image/jpeg'),
         NOW() - INTERVAL '2 hours'),
        (gen_random_uuid(), existing_user_id, 'kyc_status_change', 'clients', existing_client_id, existing_client_name,
         'KYC status changed from incomplete to pending for ' || existing_client_name, 'info',
         jsonb_build_object('previous_status', 'incomplete', 'new_status', 'pending', 'reason', 'All documents submitted'),
         NOW() - INTERVAL '1 hour 45 minutes'),
        (gen_random_uuid(), existing_user_id, 'kyc_verification', 'clients', existing_client_id, existing_client_name,
         'KYC verification approved for ' || existing_client_name, 'info',
         jsonb_build_object('previous_status', 'pending', 'new_status', 'verified', 'approver_notes', 'All documents verified and valid'),
         NOW() - INTERVAL '1 hour'),
        (gen_random_uuid(), existing_user_id, 'kyc_document_upload', 'kyc_documents', existing_client_id, existing_client_name,
         'Passport document uploaded for ' || existing_client_name, 'info',
         jsonb_build_object('document_type', 'Passport', 'file_name', 'passport_scan.pdf', 'file_size', '2.4 MB', 'file_type', 'application/pdf'),
         NOW() - INTERVAL '3 hours'),
        (gen_random_uuid(), existing_user_id, 'kyc_renewal', 'kyc_documents', existing_client_id, existing_client_name,
         'KYC document renewal initiated for ' || existing_client_name, 'warning',
         jsonb_build_object('document_type', 'National ID', 'expiry_date', '2026-03-10', 'days_until_expiry', 11, 'renewal_status', 'initiated'),
         NOW() - INTERVAL '30 minutes')
      ON CONFLICT (id) DO NOTHING;
    END IF;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'KYC audit sample data insertion failed: %', SQLERRM;
END $$;

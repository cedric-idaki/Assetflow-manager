-- KYC Payment Status Migration
-- Adds kyc_status column to clients table for payment blocking

-- Add kyc_status column to clients table
ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS kyc_status TEXT DEFAULT 'unverified';

-- Add index for kyc_status queries
CREATE INDEX IF NOT EXISTS idx_clients_kyc_status ON public.clients(kyc_status);

-- Update existing clients with a default kyc_status
DO $$
BEGIN
  UPDATE public.clients
  SET kyc_status = 'unverified'
  WHERE kyc_status IS NULL;

  -- Set some sample clients to verified for demo purposes
  UPDATE public.clients
  SET kyc_status = 'verified'
  WHERE account_number IN ('ACC-2024-001', 'ACC-2024-002')
    AND kyc_status = 'unverified';

  UPDATE public.clients
  SET kyc_status = 'under_review'
  WHERE account_number = 'ACC-2024-003'
    AND kyc_status = 'unverified';

EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'KYC status update failed: %', SQLERRM;
END $$;

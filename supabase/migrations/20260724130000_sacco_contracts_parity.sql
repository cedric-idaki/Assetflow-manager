-- ============================================================================
-- SACCO CONTRACTS TAB — parity with the company Contracts tab
-- ============================================================================
-- The sacco dashboard's Contracts tab reused the company component but had no
-- backing for the two things that make that tab useful:
--
--   1. Auto-generated agreements. The company tab generates a contract per POS
--      sale and records it in generated_contracts (sale_id NOT NULL, FK to
--      sales) — a sacco has no sales, so sacco loan agreements live in
--      company_contracts instead (which already carries member_id, file_url and
--      the esign columns, and is what the member portal's Contracts tab reads).
--      This adds company_contracts.loan_id so a generated agreement is tied to
--      its sacco_loans row, one agreement per loan.
--
--   2. Send for Signature. is_esign_staff() gates esign_signers /
--      esign_audit_events / esign_notifications / esign_documents, and its role
--      list never included sacco_admin — so the sacco admin's "Sign" action
--      failed on RLS. Added here.
--
-- Idempotent — safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. company_contracts.loan_id — links a generated agreement to its sacco loan
-- ----------------------------------------------------------------------------
ALTER TABLE public.company_contracts
  ADD COLUMN IF NOT EXISTS loan_id UUID
  REFERENCES public.sacco_loans(id) ON DELETE SET NULL;

-- One agreement per loan. NULLs are distinct in a Postgres unique index, so the
-- thousands of company (non-loan) contracts are unaffected. A plain unique index
-- (not partial) is required for PostgREST's on_conflict=loan_id upsert.
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_contracts_loan_id
  ON public.company_contracts(loan_id);

CREATE INDEX IF NOT EXISTS idx_company_contracts_member_id
  ON public.company_contracts(member_id);

-- ----------------------------------------------------------------------------
-- 2. is_esign_staff() — admit sacco_admin
--    Re-declared in full (rather than patched) so this migration is
--    self-contained. sacco_member is deliberately excluded: members sign via a
--    one-time external link, they never manage the signer roster.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_esign_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role IN ('super_admin', 'admin', 'director', 'accountant',
                      'collections', 'sales', 'operations', 'manager',
                      'finance', 'hr', 'sacco_admin')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_esign_staff() TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Refresh the PostgREST schema cache so loan_id is visible immediately.
-- ----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

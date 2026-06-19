-- Migration: wire the contract pipeline into the e-signature flow.
--
-- The /e-signature page can already sign generated_contracts, but two gaps stop
-- the module from working with the rest of the system:
--   * generated_contracts had no file_url — the generated PDF was only downloaded
--     to the user's machine, so there was nothing for a signer to review.
--   * company_contracts (the "Upload Contract" action) had no esign columns and
--     was never surfaced for signing at all.
-- It also adds the per-signer columns the external (tokenized link) signing flow
-- needs on esign_signers.
--
-- Builds on 20260612120000_contracts_bucket_and_table.sql (company_contracts +
-- `contracts` bucket) and 20260615120000_esignature_foundation.sql (esign tables
-- + esign-documents bucket). Self-contained and idempotent — safe to re-run.

-- ── 1. generated_contracts: store the generated PDF ─────────────────────────────
alter table public.generated_contracts add column if not exists file_url text;

-- ── 2. company_contracts: esign tracking columns ───────────────────────────────
-- signed_at / file_url / status already exist from the contracts migration.
alter table public.company_contracts add column if not exists esign_status   text default 'pending';
alter table public.company_contracts add column if not exists signature_hash text;
alter table public.company_contracts add column if not exists signature_type text;
alter table public.company_contracts add column if not exists signature_data text;
alter table public.company_contracts add column if not exists expires_at     timestamptz;

-- ── 3. esign_signers: disambiguate source + hold per-signer signature & OTP ─────
-- source_type tells the signing write-path which parent table to update:
--   'generated' → generated_contracts, 'company' → company_contracts,
--   'esign_doc' → esign_documents. company_contracts rows reuse the loose
--   contract_id column (no FK) to point at their parent.
alter table public.esign_signers add column if not exists source_type    text default 'generated';
alter table public.esign_signers add column if not exists signature_type text;
alter table public.esign_signers add column if not exists signature_data text;
alter table public.esign_signers add column if not exists signature_hash text;
alter table public.esign_signers add column if not exists otp_hash       text;
alter table public.esign_signers add column if not exists otp_expires_at timestamptz;

-- Token lookups drive the public /sign/:token page; index for fast resolution.
create index if not exists idx_esign_signers_token on public.esign_signers(token);

-- ── 4. Refresh PostgREST schema cache ──────────────────────────────────────────
notify pgrst, 'reload schema';

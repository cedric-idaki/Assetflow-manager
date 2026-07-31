-- Migration: e-signature hardening — SMS delivery, consent capture, sealed-PDF
-- integrity, enforced sequential signing, auto-reminders, and live status.
--
-- Builds on 20260615120000_esignature_foundation.sql and
-- 20260617120000_esignature_sync.sql. What each block backs:
--   * esign_signers.phone            — SMS OTP + SMS link delivery (Twilio send-sms)
--   * esign_signers.consent_at/text  — "I agree to sign electronically" record
--   * esign_signers.viewed_at        — sent → viewed → signed lifecycle
--   * esign_signers.link_base        — origin the invite was sent from, so the
--                                      reminder cron / next-signer invites can
--                                      rebuild /sign/:token links server-side
--   * esign_signers reminder columns — esign-reminders cron bookkeeping
--   * final_pdf_hash (3 parents)     — SHA-256 of the SEALED PDF bytes (tamper
--                                      evidence; signature_hash only covered the
--                                      signature payload)
--   * realtime publication           — live status flips on the /e-signature page
--   * storage delete lock            — sealed signed_*.pdf files cannot be
--                                      deleted by app users (service role only)
-- Self-contained and idempotent — safe to re-run.

-- ── 1. esign_signers: delivery, consent, lifecycle + reminder bookkeeping ───────
alter table public.esign_signers add column if not exists phone            text;
alter table public.esign_signers add column if not exists otp_channel      text;   -- email | sms
alter table public.esign_signers add column if not exists consent_at       timestamptz;
alter table public.esign_signers add column if not exists consent_text     text;
alter table public.esign_signers add column if not exists viewed_at        timestamptz;
alter table public.esign_signers add column if not exists link_base        text;
alter table public.esign_signers add column if not exists last_reminder_at timestamptz;
alter table public.esign_signers add column if not exists reminder_count   integer default 0;

-- The reminder cron scans pending/viewed signers with a live token.
create index if not exists idx_esign_signers_pending
  on public.esign_signers(status, token_expires_at)
  where token is not null;

-- ── 2. Sealed-PDF integrity hash on every parent ────────────────────────────────
alter table public.generated_contracts add column if not exists final_pdf_hash text;
alter table public.company_contracts   add column if not exists final_pdf_hash text;
alter table public.esign_documents     add column if not exists final_pdf_hash text;

-- ── 3. Realtime: publish esign tables for live dashboard updates ────────────────
-- supabase_realtime is per-table (only election tables were published before).
-- ADD TABLE fails when already present, so guard each with duplicate_object.
do $$ begin
  alter publication supabase_realtime add table public.esign_signers;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.esign_documents;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.esign_notifications;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.esign_audit_events;
exception when duplicate_object then null; end $$;

-- ── 4. Lock sealed PDFs: no app-user deletes of signed_*.pdf ────────────────────
-- Sealed copies live at <admin_id>/signed_<ref>.pdf in both buckets. Upload
-- (insert) and re-seal (update/upsert) stay open to staff; deletion of a sealed
-- record is reserved for the service role. Recreate the two delete policies
-- with the signed_ exclusion.
drop policy if exists "contracts_authenticated_delete" on storage.objects;
create policy "contracts_authenticated_delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'contracts' and name not like '%signed\_%' escape '\');

drop policy if exists "esign_docs_authenticated_delete" on storage.objects;
create policy "esign_docs_authenticated_delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'esign-documents' and name not like '%signed\_%' escape '\');

-- ── 5. Refresh PostgREST schema cache ───────────────────────────────────────────
notify pgrst, 'reload schema';

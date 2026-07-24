-- Migration: placeable signature fields (SignNow-style field placement).
--
-- The /e-signature module could only capture ONE signature and stamp it in a
-- fixed spot. This adds per-signer, positioned fields (signature, initials,
-- date, text, checkbox) placed at exact coordinates on specific pages — the
-- core of a SignNow-style signing experience.
--
-- Scoping mirrors esign_signers exactly: source_type tells which parent table a
-- field belongs to ('generated' → generated_contracts, 'company' →
-- company_contracts via the loose contract_id, 'esign_doc' → esign_documents).
-- Each field points at the signer who must fill it (signer_id → esign_signers).
--
-- Coordinates are stored NORMALIZED (0..1) relative to the page so they are
-- resolution-independent; the renderer and the pdf-lib burn step both map them
-- back to pixels/points at their own scale.
--
-- Builds on 20260615120000_esignature_foundation.sql (esign_signers,
-- esign_documents, is_esign_staff()). Self-contained and idempotent.

-- ── esign_fields ────────────────────────────────────────────────────────────────
create table if not exists public.esign_fields (
  id                uuid primary key default gen_random_uuid(),
  admin_id          uuid,
  source_type       text default 'generated',   -- generated | company | esign_doc
  contract_id       uuid,                        -- generated/company parent (loose ref)
  esign_document_id uuid references public.esign_documents(id) on delete cascade,
  signer_id         uuid references public.esign_signers(id)   on delete cascade,
  field_type        text not null default 'signature', -- signature|initials|date|text|checkbox
  page_index        integer not null default 0,
  pos_x             double precision not null default 0,  -- 0..1 from left
  pos_y             double precision not null default 0,  -- 0..1 from top
  width             double precision not null default 0.2,-- fraction of page width
  height            double precision not null default 0.05,-- fraction of page height
  required          boolean default true,
  placeholder       text,
  value             text,          -- filled content (signature payload / text / date / bool)
  filled_at         timestamptz,
  created_at        timestamptz default now()
);

create index if not exists idx_esign_fields_document on public.esign_fields(esign_document_id);
create index if not exists idx_esign_fields_contract on public.esign_fields(contract_id);
create index if not exists idx_esign_fields_signer   on public.esign_fields(signer_id);
create index if not exists idx_esign_fields_admin    on public.esign_fields(admin_id);

alter table public.esign_fields enable row level security;

-- Staff manage fields (mirrors the esign_signers / esign_documents policies).
-- Unauthenticated external signers never touch this table directly — the
-- esign-public edge function reads/writes it with the service role.
drop policy if exists "staff_manage_esign_fields" on public.esign_fields;
create policy "staff_manage_esign_fields"
on public.esign_fields for all to authenticated
using (public.is_esign_staff()) with check (public.is_esign_staff());

-- ── Refresh PostgREST schema cache ──────────────────────────────────────────────
notify pgrst, 'reload schema';

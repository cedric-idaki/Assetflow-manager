-- Migration: e-signature API & embedded signing.
--
-- Lets client teams drive signing from THEIR OWN apps instead of redirecting to
-- Ararat: a per-tenant API key authenticates the new `esign-api` edge function
-- (create documents + signers + fields programmatically, fetch status, refresh
-- links), each signer gets both a hosted /sign/:token link and an iframe-ready
-- /embed/sign/:token link, and webhooks notify the client app as signatures
-- land. Mirrors the asset_ingest_keys pattern (SHA-256 key hash, x-api-key).
--
-- Builds on 20260615120000_esignature_foundation.sql and
-- 20260727120000_esign_hardening.sql. Self-contained and idempotent.

-- ── 1. esign_api_keys: per-tenant machine credentials ──────────────────────────
create table if not exists public.esign_api_keys (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid not null,
  label        text not null default 'API key',
  key_hash     text not null unique,   -- sha256 hex of the raw key (never stored)
  key_hint     text,                   -- last 4 chars, for display only
  webhook_url  text,                   -- POSTed signer.signed / document.completed events
  active       boolean default true,
  created_by   uuid,
  last_used_at timestamptz,
  created_at   timestamptz default now()
);
create index if not exists idx_esign_api_keys_admin on public.esign_api_keys(admin_id);

alter table public.esign_api_keys enable row level security;

-- Staff manage their own tenant's keys (same staff gate as the other esign
-- tables; the app scopes reads/writes by admin_id).
drop policy if exists "staff_manage_esign_api_keys" on public.esign_api_keys;
create policy "staff_manage_esign_api_keys"
on public.esign_api_keys for all to authenticated
using (public.is_esign_staff()) with check (public.is_esign_staff());

-- ── 2. esign_documents: track API-created documents ────────────────────────────
-- api_key_id ties a document to the key that created it (webhook routing);
-- external_ref is the client app's own id for the envelope (lookups + events).
alter table public.esign_documents add column if not exists api_key_id   uuid;
alter table public.esign_documents add column if not exists external_ref text;
create index if not exists idx_esign_documents_api_key on public.esign_documents(api_key_id);
create index if not exists idx_esign_documents_ext_ref on public.esign_documents(admin_id, external_ref);

-- ── 3. Refresh PostgREST schema cache ──────────────────────────────────────────
notify pgrst, 'reload schema';

-- Migration: e-signature backend foundation.
--
-- The /e-signature page already drives an internal signing flow that writes
-- esign_status / signed_at / signature_hash / signature_type back onto
-- generated_contracts, but:
--   * those columns were never created by a migration (they only worked where
--     someone added them by hand), and
--   * the audit trail, notifications, signers and uploaded documents were all
--     hard-coded mock arrays with no persistence.
--
-- This migration creates the real backing store so internal signing becomes
-- production-grade: esign columns on generated_contracts, plus tables for audit
-- events, in-app notifications, signers, and uploaded-for-signature documents.
-- RLS mirrors the existing company_contracts pattern (staff manage by role).
-- Self-contained and idempotent — safe to re-run.

-- ── 0. generated_contracts: ensure table + esign columns exist ──────────────────
-- generated_contracts was created by hand in existing environments (no prior
-- migration). Create it with the shape the app already uses, then reconcile the
-- esign columns. ADD COLUMN IF NOT EXISTS is a no-op when present.
create table if not exists public.generated_contracts (
  id              uuid primary key default gen_random_uuid(),
  sale_id         uuid,
  invoice_number  text,
  client_id       uuid,
  asset_id        uuid,
  admin_id        uuid,
  generated_at    timestamptz default now(),
  pricing_model   text,
  client_name     text,
  esign_status    text default 'pending',
  signed_at       timestamptz,
  signature_hash  text,
  signature_type  text,
  signature_data  text,
  expires_at      timestamptz,
  created_at      timestamptz default now()
);

alter table public.generated_contracts add column if not exists esign_status   text default 'pending';
alter table public.generated_contracts add column if not exists signed_at      timestamptz;
alter table public.generated_contracts add column if not exists signature_hash text;
alter table public.generated_contracts add column if not exists signature_type text;
alter table public.generated_contracts add column if not exists signature_data text;
alter table public.generated_contracts add column if not exists expires_at     timestamptz;

-- The app upserts on sale_id (onConflict: 'sale_id'); guarantee the constraint
-- exists on fresh databases without failing where it already exists.
do $$ begin
  alter table public.generated_contracts add constraint generated_contracts_sale_id_key unique (sale_id);
exception when duplicate_table then null; when duplicate_object then null; end $$;

-- ── 1. Helper: staff-role check (mirrors company_contracts policy) ──────────────
create or replace function public.is_esign_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles up
    where up.id = auth.uid()
    and up.role in ('super_admin', 'admin', 'director', 'accountant',
                    'collections', 'sales', 'operations', 'manager', 'finance', 'hr')
  );
$$;
grant execute on function public.is_esign_staff() to authenticated;

-- ── 2. esign_audit_events: tamper-evident event log ─────────────────────────────
create table if not exists public.esign_audit_events (
  id              uuid primary key default gen_random_uuid(),
  admin_id        uuid,
  contract_id     uuid,            -- generated_contracts.id (loose ref, no FK)
  document_label  text,           -- invoice no. / doc name for display
  event_type      text not null default 'view',  -- created|sent|viewed|signed|completed|security|revoked|reminder
  actor           text,
  actor_email     text,
  ip              text,
  device          text,
  detail          text,
  hash            text,
  created_at      timestamptz default now()
);
create index if not exists idx_esign_audit_admin    on public.esign_audit_events(admin_id);
create index if not exists idx_esign_audit_contract on public.esign_audit_events(contract_id);

alter table public.esign_audit_events enable row level security;

drop policy if exists "staff_manage_esign_audit" on public.esign_audit_events;
create policy "staff_manage_esign_audit"
on public.esign_audit_events for all to authenticated
using (public.is_esign_staff()) with check (public.is_esign_staff());

-- ── 3. esign_notifications: in-app notification feed + security alerts ───────────
create table if not exists public.esign_notifications (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid,
  user_id      uuid,              -- recipient (nullable = admin-wide)
  type         text not null default 'info',  -- warning|success|info|neutral
  title        text not null,
  detail       text,
  contract_id  uuid,
  read         boolean default false,
  created_at   timestamptz default now()
);
create index if not exists idx_esign_notif_admin on public.esign_notifications(admin_id);
create index if not exists idx_esign_notif_user  on public.esign_notifications(user_id);

alter table public.esign_notifications enable row level security;

-- Recipients read their own; staff manage the tenant feed.
drop policy if exists "read_esign_notifications" on public.esign_notifications;
create policy "read_esign_notifications"
on public.esign_notifications for select to authenticated
using (user_id = auth.uid() or public.is_esign_staff());

drop policy if exists "staff_write_esign_notifications" on public.esign_notifications;
create policy "staff_write_esign_notifications"
on public.esign_notifications for all to authenticated
using (public.is_esign_staff()) with check (public.is_esign_staff());

-- Recipient may mark their own notification read.
drop policy if exists "recipient_update_esign_notifications" on public.esign_notifications;
create policy "recipient_update_esign_notifications"
on public.esign_notifications for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── 4. esign_signers: per-document signer roster (+ external link tokens) ───────
create table if not exists public.esign_signers (
  id                uuid primary key default gen_random_uuid(),
  admin_id          uuid,
  contract_id       uuid,          -- generated_contracts.id (loose ref)
  esign_document_id uuid,          -- esign_documents.id (loose ref)
  name              text,
  email             text,
  role              text default 'Signer',
  signing_order     integer default 0,
  status            text default 'pending',   -- pending|viewed|signed
  token             text unique,              -- one-time external link token
  token_expires_at  timestamptz,
  signed_at         timestamptz,
  ip                text,
  device            text,
  created_at        timestamptz default now()
);
create index if not exists idx_esign_signers_admin    on public.esign_signers(admin_id);
create index if not exists idx_esign_signers_contract on public.esign_signers(contract_id);
create index if not exists idx_esign_signers_document on public.esign_signers(esign_document_id);

alter table public.esign_signers enable row level security;

drop policy if exists "staff_manage_esign_signers" on public.esign_signers;
create policy "staff_manage_esign_signers"
on public.esign_signers for all to authenticated
using (public.is_esign_staff()) with check (public.is_esign_staff());

-- ── 5. esign_documents: ad-hoc files uploaded for signature ─────────────────────
create table if not exists public.esign_documents (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid,
  name          text not null,
  file_url      text,
  file_type     text,
  pages         integer,
  status        text default 'draft',       -- draft|pending|in_review|completed|expired
  signing_order text default 'sequential',  -- sequential|parallel
  message       text,
  expires_at    timestamptz,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists idx_esign_documents_admin on public.esign_documents(admin_id);

alter table public.esign_documents enable row level security;

drop policy if exists "staff_manage_esign_documents" on public.esign_documents;
create policy "staff_manage_esign_documents"
on public.esign_documents for all to authenticated
using (public.is_esign_staff()) with check (public.is_esign_staff());

-- ── 5b. Storage bucket for uploaded-for-signature documents ─────────────────────
-- The app's existing `contracts` bucket is PDF-only / 10MB. The e-signature
-- "Upload & Convert" step accepts PDF, Word and Excel up to 50MB, so it gets its
-- own bucket. Public to match the app's getPublicUrl() usage.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'esign-documents', 'esign-documents', true, 52428800,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.ms-excel'
  ]
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "esign_docs_public_read" on storage.objects;
create policy "esign_docs_public_read"
on storage.objects for select to public
using (bucket_id = 'esign-documents');

drop policy if exists "esign_docs_authenticated_insert" on storage.objects;
create policy "esign_docs_authenticated_insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'esign-documents');

drop policy if exists "esign_docs_authenticated_update" on storage.objects;
create policy "esign_docs_authenticated_update"
on storage.objects for update to authenticated
using      (bucket_id = 'esign-documents')
with check (bucket_id = 'esign-documents');

drop policy if exists "esign_docs_authenticated_delete" on storage.objects;
create policy "esign_docs_authenticated_delete"
on storage.objects for delete to authenticated
using (bucket_id = 'esign-documents');

-- ── 5c. FK so PostgREST can embed signers under a document ──────────────────────
-- esign_documents is created after esign_signers, so the FK is added here. This
-- relationship powers the app's esign_documents.select('*, esign_signers(*)').
do $$ begin
  alter table public.esign_signers
    add constraint esign_signers_document_fk
    foreign key (esign_document_id) references public.esign_documents(id) on delete cascade;
exception when duplicate_object then null; end $$;

-- ── 6. Refresh PostgREST schema cache ───────────────────────────────────────────
notify pgrst, 'reload schema';

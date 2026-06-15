-- Migration: enable admin/super-admin contract uploads.
--
-- The "Upload Contract" action in the admin & super-admin dashboards calls
-- supabase.storage.from('contracts').upload(...) and then inserts into
-- public.company_contracts. Neither the `contracts` storage bucket nor the
-- company_contracts table were ever created by a migration (they only existed
-- by hand in some environments), so the upload failed with "Bucket not found"
-- / a missing-table error. This migration creates both, plus the RLS the app
-- needs. Self-contained and idempotent — safe to re-run.

-- ── 0. Helper: resolve the client.id for the current user ───────────────────────
-- Re-declared so this migration is self-contained (client read policy below
-- depends on it; earlier migrations may not have run on every environment).
create or replace function public.get_client_id_for_user()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.clients where email = auth.email() limit 1;
$$;

-- ── 1. company_contracts table ──────────────────────────────────────────────────
create table if not exists public.company_contracts (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid not null,
  client_id     uuid,
  contract_name text not null,
  contract_type text default 'general',
  file_url      text,
  is_template   boolean default false,
  status        text default 'active',
  signed_at     timestamptz,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Reconcile columns on environments where the table was created by hand with a
-- different/partial shape. ADD COLUMN IF NOT EXISTS is a no-op when present.
alter table public.company_contracts add column if not exists admin_id      uuid;
alter table public.company_contracts add column if not exists client_id     uuid;
alter table public.company_contracts add column if not exists contract_name text;
alter table public.company_contracts add column if not exists contract_type text default 'general';
alter table public.company_contracts add column if not exists file_url      text;
alter table public.company_contracts add column if not exists is_template   boolean default false;
alter table public.company_contracts add column if not exists status        text default 'active';
alter table public.company_contracts add column if not exists signed_at     timestamptz;
alter table public.company_contracts add column if not exists created_at    timestamptz default now();
alter table public.company_contracts add column if not exists updated_at    timestamptz default now();

create index if not exists idx_company_contracts_admin_id  on public.company_contracts(admin_id);
create index if not exists idx_company_contracts_client_id on public.company_contracts(client_id);

-- ── 2. RLS on company_contracts ─────────────────────────────────────────────────
alter table public.company_contracts enable row level security;

-- Staff/admin manage every contract they own (admin_id is the creating user).
drop policy if exists "staff_manage_company_contracts" on public.company_contracts;
create policy "staff_manage_company_contracts"
on public.company_contracts
for all
to authenticated
using (
  exists (
    select 1 from public.user_profiles up
    where up.id = auth.uid()
    and up.role in ('super_admin', 'admin', 'director', 'accountant', 'collections', 'sales', 'operations', 'manager', 'finance')
  )
)
with check (
  exists (
    select 1 from public.user_profiles up
    where up.id = auth.uid()
    and up.role in ('super_admin', 'admin', 'director', 'accountant', 'collections', 'sales', 'operations', 'manager', 'finance')
  )
);

-- A client can read the contracts linked to them (client portal Document Centre).
drop policy if exists "clients_read_own_company_contracts" on public.company_contracts;
create policy "clients_read_own_company_contracts"
on public.company_contracts
for select
to authenticated
using (client_id = public.get_client_id_for_user());

-- ── 3. Storage bucket for contract PDFs ─────────────────────────────────────────
-- Public bucket to match the app's getPublicUrl() usage. 10 MB cap to match the
-- upload modal ("PDF files only, max 10MB").
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contracts', 'contracts', true, 10485760, array['application/pdf'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read via the public URL.
drop policy if exists "contracts_public_read" on storage.objects;
create policy "contracts_public_read"
on storage.objects for select
to public
using (bucket_id = 'contracts');

-- Authenticated upload.
drop policy if exists "contracts_authenticated_insert" on storage.objects;
create policy "contracts_authenticated_insert"
on storage.objects for insert
to authenticated
with check (bucket_id = 'contracts');

-- Authenticated replace (needed for upsert: true).
drop policy if exists "contracts_authenticated_update" on storage.objects;
create policy "contracts_authenticated_update"
on storage.objects for update
to authenticated
using      (bucket_id = 'contracts')
with check (bucket_id = 'contracts');

-- Authenticated delete.
drop policy if exists "contracts_authenticated_delete" on storage.objects;
create policy "contracts_authenticated_delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'contracts');

-- ── 4. Refresh the PostgREST schema cache so the new table/columns are visible ───
notify pgrst, 'reload schema';

-- Migration: enable client-side KYC document uploads from the client portal.
--
-- Before this, a logged-in client could SELECT their kyc_documents but had no
-- policy to INSERT/UPDATE them, the kyc-documents storage bucket was never
-- created, and updating clients.kyc_status was blocked by RLS. This migration
-- closes all three gaps. Idempotent — safe to re-run.

-- ── 0. Helper: resolve the client.id for the current user ───────────────────────
-- Defined here so this migration is self-contained (the original client-portal
-- RLS migration may not have been applied on every environment).
create or replace function public.get_client_id_for_user()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.clients where email = auth.email() limit 1;
$$;

-- ── 0b. Robust client-profile resolver (bypasses RLS, case-insensitive) ─────────
-- The client portal calls this so a logged-in client always resolves to their
-- clients row regardless of RLS policies or email casing differences.
create or replace function public.get_my_client_profile()
returns setof public.clients
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uemail text;
begin
  select email into uemail from auth.users where id = auth.uid();
  return query
    select * from public.clients
    where lower(email) = lower(coalesce(uemail, auth.email()))
    order by created_at
    limit 1;
end;
$$;

grant execute on function public.get_my_client_profile() to authenticated;

-- ── 0c. Ensure kyc_documents has every column the client portal writes/reads ────
-- The deployed table is a bare version; add all columns the upload code uses so
-- inserts/updates succeed. ADD COLUMN IF NOT EXISTS is a no-op when present.
alter table public.kyc_documents add column if not exists document_type  text;
alter table public.kyc_documents add column if not exists file_url       text;
alter table public.kyc_documents add column if not exists file_name      text;
alter table public.kyc_documents add column if not exists status         text default 'pending';
alter table public.kyc_documents add column if not exists uploaded_by    uuid;
alter table public.kyc_documents add column if not exists admin_id       uuid;
alter table public.kyc_documents add column if not exists reviewer_notes text;
alter table public.kyc_documents add column if not exists created_at     timestamptz default now();

-- The expiry/issue/number columns came from the renewal-tracking design and are
-- NOT NULL there, but a plain document upload doesn't supply them. Make optional.
do $$
declare col text;
begin
  foreach col in array array['expiry_date','issue_date','document_number'] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'kyc_documents' and column_name = col
    ) then
      execute format('alter table public.kyc_documents alter column %I drop not null', col);
    end if;
  end loop;
end $$;

-- ── 1. Storage bucket for KYC documents ─────────────────────────────────────────
-- NOTE: public bucket to match the app's existing getPublicUrl() usage. KYC docs
-- are sensitive; a follow-up could switch this to a private bucket + signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kyc-documents', 'kyc-documents', true, 5242880,
        array['image/jpeg','image/jpg','image/png','application/pdf'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "kyc_public_read" on storage.objects;
create policy "kyc_public_read"
on storage.objects for select
to public
using (bucket_id = 'kyc-documents');

drop policy if exists "kyc_authenticated_insert" on storage.objects;
create policy "kyc_authenticated_insert"
on storage.objects for insert
to authenticated
with check (bucket_id = 'kyc-documents');

drop policy if exists "kyc_authenticated_update" on storage.objects;
create policy "kyc_authenticated_update"
on storage.objects for update
to authenticated
using      (bucket_id = 'kyc-documents')
with check (bucket_id = 'kyc-documents');

-- ── 1b. Let a client READ their own clients row + kyc_documents ─────────────────
-- These self-read policies were part of the client-portal RLS migration that was
-- never applied here, which is why clientProfile loaded as null (RLS is enabled
-- and only the staff read policy existed).
drop policy if exists "clients_read_own_row" on public.clients;
create policy "clients_read_own_row"
on public.clients for select
to authenticated
using (email = auth.email());

drop policy if exists "clients_read_own_kyc_documents" on public.kyc_documents;
create policy "clients_read_own_kyc_documents"
on public.kyc_documents for select
to authenticated
using (client_id = public.get_client_id_for_user());

-- ── 2. Let a client write their OWN kyc_documents rows ──────────────────────────
-- (staff_manage_all_kyc_documents already covers admin/staff writes.)
drop policy if exists "clients_insert_own_kyc_documents" on public.kyc_documents;
create policy "clients_insert_own_kyc_documents"
on public.kyc_documents for insert
to authenticated
with check (client_id = public.get_client_id_for_user());

drop policy if exists "clients_update_own_kyc_documents" on public.kyc_documents;
create policy "clients_update_own_kyc_documents"
on public.kyc_documents for update
to authenticated
using      (client_id = public.get_client_id_for_user())
with check (client_id = public.get_client_id_for_user());

-- ── 3. Auto-advance the client's KYC status when they upload ────────────────────
-- Runs as SECURITY DEFINER so the client never needs UPDATE rights on clients.
create or replace function public.kyc_doc_mark_under_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.clients
     set kyc_status = 'under_review'
   where id = NEW.client_id
     and coalesce(kyc_status, '') not in ('verified', 'approved');
  return NEW;
end;
$$;

drop trigger if exists trg_kyc_doc_under_review on public.kyc_documents;
create trigger trg_kyc_doc_under_review
after insert on public.kyc_documents
for each row execute function public.kyc_doc_mark_under_review();

-- ── 4. Refresh the PostgREST schema cache so the new columns are visible ─────────
notify pgrst, 'reload schema';

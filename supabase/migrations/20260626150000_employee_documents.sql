-- Migration: store HR employee documents (ID/passport, CV, photo).
--
-- The "Add / Edit Employee" form now captures three uploaded files per employee,
-- and the new HR "Documents" tab lists them:
--   • id_document_url — scan/photo of National ID or passport
--   • cv_url          — the employee's CV (PDF / Word / image)
--   • photo_url       — a passport-style photo of the employee
-- Stored as plain nullable text URLs so records created before this field
-- existed remain valid. This migration also creates the `employee-documents`
-- storage bucket the upload code writes to. Idempotent — safe to re-run.

-- ── 1. Columns on user_profiles ─────────────────────────────────────────────────
alter table public.user_profiles add column if not exists id_document_url text;
alter table public.user_profiles add column if not exists cv_url          text;
alter table public.user_profiles add column if not exists photo_url       text;

-- ── 2. Storage bucket for employee documents ────────────────────────────────────
-- Public bucket to match the app's existing getPublicUrl() usage (mirrors the
-- contracts / kyc-documents buckets). 10 MB cap; images, PDFs and Word docs are
-- accepted so an ID scan, a photo and a CV all fit.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-documents', 'employee-documents', true, 10485760,
        array[
          'image/jpeg','image/jpg','image/png','image/webp','application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read via the public URL.
drop policy if exists "employee_docs_public_read" on storage.objects;
create policy "employee_docs_public_read"
on storage.objects for select
to public
using (bucket_id = 'employee-documents');

-- Authenticated upload.
drop policy if exists "employee_docs_authenticated_insert" on storage.objects;
create policy "employee_docs_authenticated_insert"
on storage.objects for insert
to authenticated
with check (bucket_id = 'employee-documents');

-- Authenticated replace (needed for upsert: true).
drop policy if exists "employee_docs_authenticated_update" on storage.objects;
create policy "employee_docs_authenticated_update"
on storage.objects for update
to authenticated
using      (bucket_id = 'employee-documents')
with check (bucket_id = 'employee-documents');

-- Authenticated delete.
drop policy if exists "employee_docs_authenticated_delete" on storage.objects;
create policy "employee_docs_authenticated_delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'employee-documents');

-- ── 3. Refresh the PostgREST schema cache so the new columns are visible ─────────
notify pgrst, 'reload schema';

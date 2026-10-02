-- Migration: academic / professional certificates on the employee record.
--
-- The Add / Edit Employee form's Documents section now takes the employee's
-- certificates from the institutions they graduated from (KCSE, diploma,
-- degree, CPA, ...). Unlike id_document_url / cv_url / photo_url an employee
-- usually holds several, so they are one jsonb ARRAY rather than a column per
-- file. Each element is written by src/pages/hr-management/index.jsx as
--   { url, qualification, institution, file_name, uploaded_at }
--
-- The files go in the existing `employee-documents` bucket under the employee's
-- own folder (<user_profiles.id>/...), so the tenant-scoped storage policies
-- from 20260731091000 already cover them — no bucket or policy change here. The
-- bucket is private: `url` is a storage reference the app signs at read time
-- (src/lib/storageUrl.js), never a link that opens on its own.
--
-- Defaults to an empty array so every existing record stays valid, and the
-- check keeps the column an array so the app never has to guess its shape.
-- Idempotent — safe to re-run.

alter table public.user_profiles
  add column if not exists academic_certificates jsonb not null default '[]'::jsonb;

alter table public.user_profiles
  drop constraint if exists user_profiles_academic_certificates_is_array;
alter table public.user_profiles
  add constraint user_profiles_academic_certificates_is_array
  check (jsonb_typeof(academic_certificates) = 'array');

comment on column public.user_profiles.academic_certificates is
  'Academic / professional certificates: array of {url, qualification, institution, file_name, uploaded_at}. Files in the employee-documents bucket, private.';

notify pgrst, 'reload schema';

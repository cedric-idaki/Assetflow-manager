-- Migration: ID document + photo for an employee's next of kin and secondary
-- (emergency) contact.
--
-- The Add / Edit Employee form already captures a name, relationship and phone
-- for both contacts (20260625120000) and the next of kin's ID number, which is
-- encrypted (20260813180000). It now also takes, for EACH contact:
--   • a scan / photo of their National ID or passport
--   • a passport-style photo of the person
--
-- The files go in the existing `employee-documents` bucket under the employee's
-- own folder (<user_profiles.id>/...), so the tenant-scoped storage policies
-- from 20260731091000 already cover them — no bucket or policy change here. The
-- bucket is private: these columns hold a storage reference that the app signs
-- at read time (src/lib/storageUrl.js), never a link that opens on its own.
--
-- Plain nullable text, like id_document_url / cv_url / photo_url, so every
-- existing record stays valid. Idempotent — safe to re-run.

alter table public.user_profiles add column if not exists next_of_kin_id_document_url       text;
alter table public.user_profiles add column if not exists next_of_kin_photo_url             text;
alter table public.user_profiles add column if not exists secondary_contact_id_document_url text;
alter table public.user_profiles add column if not exists secondary_contact_photo_url       text;

comment on column public.user_profiles.next_of_kin_id_document_url       is 'Next of kin National ID / passport scan — employee-documents bucket, private.';
comment on column public.user_profiles.next_of_kin_photo_url             is 'Next of kin photo — employee-documents bucket, private.';
comment on column public.user_profiles.secondary_contact_id_document_url is 'Secondary (emergency) contact National ID / passport scan — employee-documents bucket, private.';
comment on column public.user_profiles.secondary_contact_photo_url       is 'Secondary (emergency) contact photo — employee-documents bucket, private.';

notify pgrst, 'reload schema';

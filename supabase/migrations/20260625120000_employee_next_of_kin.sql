-- Migration: add next-of-kin and secondary-contact details to user_profiles.
--
-- The "Add / Edit Employee" form now captures two emergency-contact blocks for
-- every employee:
--   • Next of Kin       — name, relationship, phone
--   • Secondary Contact — name, relationship, phone
-- These are required in the UI, but stored as plain nullable text so records
-- created before this field existed remain valid.
--
-- ADD COLUMN IF NOT EXISTS is idempotent and safe to re-run.

alter table public.user_profiles add column if not exists next_of_kin_name               text;
alter table public.user_profiles add column if not exists next_of_kin_relationship       text;
alter table public.user_profiles add column if not exists next_of_kin_phone              text;
alter table public.user_profiles add column if not exists secondary_contact_name         text;
alter table public.user_profiles add column if not exists secondary_contact_relationship text;
alter table public.user_profiles add column if not exists secondary_contact_phone        text;

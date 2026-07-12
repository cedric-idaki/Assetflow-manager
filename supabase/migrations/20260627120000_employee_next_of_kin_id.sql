-- Migration: add the next-of-kin ID number to user_profiles.
--
-- The "Add / Edit Employee" form's Next of Kin block now also captures the
-- next of kin's national ID / passport number (alongside name, relationship and
-- phone), so the emergency contact can be positively identified.
--
-- Stored as plain nullable text so records created before this field existed
-- remain valid. ADD COLUMN IF NOT EXISTS is idempotent and safe to re-run.

alter table public.user_profiles add column if not exists next_of_kin_id text;

-- Migration: add gender and date_of_birth to user_profiles.
--
-- HR employees (payroll records) now capture two extra personal-detail fields in
-- the "Add / Edit Employee" form: gender (male/female) and date of birth.
-- Both are optional. gender is constrained to 'male' | 'female' (or NULL) so the
-- value always matches the dropdown the UI offers.
--
-- ADD COLUMN IF NOT EXISTS is idempotent and safe to re-run.

alter table public.user_profiles add column if not exists gender        text;
alter table public.user_profiles add column if not exists date_of_birth date;

-- Constrain gender to the values the form allows (NULL stays valid for records
-- created before this field existed). Guarded so the migration can be re-run.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_profiles_gender_check'
  ) then
    alter table public.user_profiles
      add constraint user_profiles_gender_check
      check (gender is null or gender in ('male', 'female'));
  end if;
end $$;

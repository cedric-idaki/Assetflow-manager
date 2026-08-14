-- ============================================================================
-- DROP THE PLAINTEXT EMPLOYEE PII COLUMNS
-- ----------------------------------------------------------------------------
-- Second half of the change begun in 20260813180000. Sealing the values into
-- employee_private_data accomplishes nothing while the plaintext originals are
-- still sitting in user_profiles — a backup taken today would still contain
-- every bank account number. This removes them.
--
-- APPLY ONLY AFTER THE BACKFILL HAS RUN:
--   1. apply 20260813180000
--   2. deploy the employee-pii function and set PII_ENC_KEY
--   3. POST {"action":"backfill"} to employee-pii as a super_admin
--   4. confirm the reported counts, then apply this
--
-- This is irreversible: once dropped, the only copy of these values is the
-- ciphertext in employee_private_data, which is unreadable without PII_ENC_KEY.
-- BACK UP THAT KEY BEFORE APPLYING. Losing it loses the data.
--
-- The guard below refuses to drop anything while plaintext remains, so applying
-- this early is a clean failure rather than silent data loss. The backfill nulls
-- each plaintext value as it seals it, so a completed backfill leaves none.
--
-- Columns are handled dynamically: bank_account and nssf_number exist in the
-- live database but were never created by a migration, so a fresh environment
-- legitimately does not have them. Naming them directly would break `db reset`.
-- ============================================================================

begin;

do $$
declare
  col          text;
  remaining    bigint;
  unsealed     bigint := 0;
  report       text   := '';
begin
  foreach col in array array['bank_account', 'nssf_number', 'next_of_kin_id'] loop
    -- Absent in a fresh environment; nothing to drop or check.
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name   = 'user_profiles'
        and column_name  = col
    ) then
      continue;
    end if;

    execute format(
      'select count(*) from public.user_profiles where %I is not null and btrim(%I) <> %L',
      col, col, ''
    ) into remaining;

    if remaining > 0 then
      unsealed := unsealed + remaining;
      report := report || format('  user_profiles.%s: %s row(s) still hold plaintext%s', col, remaining, chr(10));
    end if;
  end loop;

  if unsealed > 0 then
    raise exception
      'Refusing to drop plaintext PII: the backfill has not finished.%s%sRun POST {"action":"backfill"} against the employee-pii edge function, confirm the counts, then re-apply this migration.',
      chr(10), report
      using errcode = 'raise_exception';
  end if;
end $$;

alter table public.user_profiles drop column if exists bank_account;
alter table public.user_profiles drop column if exists nssf_number;
alter table public.user_profiles drop column if exists next_of_kin_id;

commit;

notify pgrst, 'reload schema';

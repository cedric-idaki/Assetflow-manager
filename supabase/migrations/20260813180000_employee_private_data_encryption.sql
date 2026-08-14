-- ============================================================================
-- EMPLOYEE PRIVATE DATA — ENCRYPTED AT THE APPLICATION LAYER
-- ----------------------------------------------------------------------------
-- user_profiles doubles as the HR employee table, so it carries fields that are
-- materially worse to leak than the rest of a staff record:
--
--   bank_account    — salary destination account number
--   nssf_number     — statutory social-security identifier
--   next_of_kin_id  — a THIRD PARTY's national ID / passport number, held by a
--                     person who never consented to this system at all
--
-- Until now these sat in plaintext columns readable by any query that could
-- reach the row. Supabase encrypts the disk, which covers a stolen drive, but
-- not the realistic exposure: a leaked service-role key, a logical backup, or a
-- policy regression on a table whose read policy has already had to be fixed
-- once (see 20260802130000_user_profiles_privilege_lockdown).
--
-- They now live here as AES-256-GCM ciphertext, sealed by the employee-pii edge
-- function under PII_ENC_KEY. The key lives ONLY in Supabase function secrets,
-- so the database holds ciphertext and never holds the means to open it.
--
-- WHY A SEPARATE TABLE AND NOT *_enc COLUMNS ON user_profiles
-- ----------------------------------------------------------------------------
-- Restricting columns in Postgres means revoking table-level SELECT and
-- re-granting column by column, because column privileges are additive — a
-- table-level grant already implies every column. That has two problems here:
--   1. `select('*')` breaks the moment a role lacks table-level SELECT, and the
--      app has such calls (useAdminDashboard, reports-analytics-center).
--   2. It requires enumerating every column of user_profiles, on a schema whose
--      migration history is known to disagree with the live database. Any
--      column missed from the re-grant silently becomes unreadable.
--
-- A separate table with RLS enabled and NO policies avoids both: RLS with zero
-- policies denies everything to `authenticated`, and only the service role
-- (which bypasses RLS) can read or write. That is exactly how
-- mpesa_tenant_credentials already protects tenant Daraja secrets.
--
-- ROLLOUT — this migration is deliberately NON-DESTRUCTIVE
-- ----------------------------------------------------------------------------
-- The plaintext columns on user_profiles are left in place. The key lives
-- outside the database, so SQL cannot encrypt anything; the backfill is done by
-- POSTing {action:'backfill'} to the employee-pii function, which reads the
-- plaintext under the service role, seals it here, and nulls the originals.
-- Dropping the now-empty columns is a separate migration, to be applied only
-- after the backfill is confirmed. Order matters: apply this, deploy the
-- function, set PII_ENC_KEY, run the backfill, verify, then drop.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. The vault table. One row per employee, keyed by their profile id.
-- ----------------------------------------------------------------------------
create table if not exists public.employee_private_data (
  user_id             uuid primary key
                        references public.user_profiles(id) on delete cascade,
  -- Denormalised tenant, so the edge function can scope a caller to their own
  -- employees without joining back to a table whose read policy may change.
  admin_id            uuid,
  -- "v1:base64(iv):base64(ciphertext)" — see supabase/functions/_shared/crypto.ts.
  -- Each value is sealed with the employee's id and the field name as GCM
  -- additional authenticated data, so ciphertext cannot be moved between rows
  -- or between fields and still decrypt.
  bank_account_enc    text,
  nssf_number_enc     text,
  next_of_kin_id_enc  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_employee_private_data_admin
  on public.employee_private_data(admin_id);

-- ----------------------------------------------------------------------------
-- 2. Lock it to the service role.
-- ----------------------------------------------------------------------------
alter table public.employee_private_data enable row level security;

-- Intentionally NO policies for anon/authenticated. RLS with zero policies
-- denies everything, so the only way in is the service role via the
-- employee-pii edge function. Do not add a SELECT policy here — it would hand
-- the ciphertext to the browser and make the encryption decorative.
--
-- The grants are revoked as well as the policies. RLS filters rows for a role
-- that holds the privilege; TRUNCATE is not filtered by RLS at all, so a
-- lingering grant would let an authenticated user destroy the table's contents
-- even with no policy permitting a single row.
revoke all on public.employee_private_data from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Non-secret presence flags.
--    The HR form needs to show "on file" versus "not set" without shipping the
--    values to the browser. Booleans only — never a *_enc column.
-- ----------------------------------------------------------------------------
create or replace function public.employee_private_data_status()
returns table (
  user_id           uuid,
  has_bank_account  boolean,
  has_nssf_number   boolean,
  has_next_of_kin_id boolean,
  updated_at        timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.user_id,
         d.bank_account_enc   is not null,
         d.nssf_number_enc    is not null,
         d.next_of_kin_id_enc is not null,
         d.updated_at
  from public.employee_private_data d
  where d.admin_id = public.current_admin_id()
     or public.is_global_viewer();
$$;

-- A SECURITY DEFINER function is PUBLIC-executable by default, and revoking
-- from PUBLIC alone leaves anon/authenticated holding EXECUTE through default
-- privileges — they must be revoked explicitly before re-granting.
revoke all on function public.employee_private_data_status() from public, anon, authenticated;
grant execute on function public.employee_private_data_status() to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Keep updated_at honest. touch_updated_at() is defined in
--    20260731190000_mpesa_integration_foundation.sql.
-- ----------------------------------------------------------------------------
drop trigger if exists touch_employee_private_data on public.employee_private_data;
create trigger touch_employee_private_data before update on public.employee_private_data
  for each row execute function public.touch_updated_at();

commit;

notify pgrst, 'reload schema';

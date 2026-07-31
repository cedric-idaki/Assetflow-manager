-- ═══════════════════════════════════════════════════════════════════════════════
-- E-signature tenant isolation + OTP brute-force protection
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- The esign_* tables shipped with policies of the form
--
--     using (public.is_esign_staff()) with check (public.is_esign_staff())
--
-- which carries NO admin_id predicate. is_esign_staff() is true for ten roles at
-- *any* tenant, so every staff account in the platform could read and write every
-- other tenant's e-signature data straight through PostgREST. Isolation existed
-- only in the React client, which is not a security boundary.
--
-- The worst of it: esign_signers.token is the live bearer token behind
-- /sign/:token, so any staff user anywhere could enumerate every pending signing
-- link in the system; and esign_api_keys was writable cross-tenant, letting an
-- attacker mint a key against someone else's admin_id or repoint a victim's
-- webhook_url at their own server.
--
-- This migration brings all six tables onto the same predicate the rest of the
-- schema already uses (see 20260628120000_tenant_isolation.sql):
--
--     (admin_id = current_admin_id() AND <role gate>) OR is_global_viewer()
--
-- Verified before writing: no esign_* row has a null admin_id, so nothing is
-- orphaned by the tighter predicate.
--
-- Section 2 adds an attempt counter to the signing OTP, which previously had no
-- rate limit of any kind — six digits, a ten-minute window and unlimited
-- parallel guesses.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Tenant-scoped RLS on the esign_* tables ────────────────────────────────

-- 1a. esign_audit_events
drop policy if exists "staff_manage_esign_audit" on public.esign_audit_events;
create policy "staff_manage_esign_audit"
on public.esign_audit_events for all to authenticated
using      ((admin_id = public.current_admin_id() and public.is_esign_staff()) or public.is_global_viewer())
with check ((admin_id = public.current_admin_id() and public.is_esign_staff()) or public.is_global_viewer());

-- 1b. esign_notifications — staff see their own tenant's feed; a recipient still
-- reads and acknowledges their own row regardless of tenant.
drop policy if exists "read_esign_notifications" on public.esign_notifications;
create policy "read_esign_notifications"
on public.esign_notifications for select to authenticated
using (
  user_id = auth.uid()
  or (admin_id = public.current_admin_id() and public.is_esign_staff())
  or public.is_global_viewer()
);

drop policy if exists "staff_write_esign_notifications" on public.esign_notifications;
create policy "staff_write_esign_notifications"
on public.esign_notifications for all to authenticated
using      ((admin_id = public.current_admin_id() and public.is_esign_staff()) or public.is_global_viewer())
with check ((admin_id = public.current_admin_id() and public.is_esign_staff()) or public.is_global_viewer());

-- Unchanged, restated so the file reads as the complete policy set for the table.
drop policy if exists "recipient_update_esign_notifications" on public.esign_notifications;
create policy "recipient_update_esign_notifications"
on public.esign_notifications for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 1c. esign_signers — holds `token`, the /sign/:token bearer credential.
drop policy if exists "staff_manage_esign_signers" on public.esign_signers;
create policy "staff_manage_esign_signers"
on public.esign_signers for all to authenticated
using      ((admin_id = public.current_admin_id() and public.is_esign_staff()) or public.is_global_viewer())
with check ((admin_id = public.current_admin_id() and public.is_esign_staff()) or public.is_global_viewer());

-- 1d. esign_documents
drop policy if exists "staff_manage_esign_documents" on public.esign_documents;
create policy "staff_manage_esign_documents"
on public.esign_documents for all to authenticated
using      ((admin_id = public.current_admin_id() and public.is_esign_staff()) or public.is_global_viewer())
with check ((admin_id = public.current_admin_id() and public.is_esign_staff()) or public.is_global_viewer());

-- 1e. esign_fields
drop policy if exists "staff_manage_esign_fields" on public.esign_fields;
create policy "staff_manage_esign_fields"
on public.esign_fields for all to authenticated
using      ((admin_id = public.current_admin_id() and public.is_esign_staff()) or public.is_global_viewer())
with check ((admin_id = public.current_admin_id() and public.is_esign_staff()) or public.is_global_viewer());

-- 1f. esign_api_keys — machine credentials. Same predicate; the cross-tenant
-- insert that let an attacker mint a key against another admin_id is now
-- rejected by the WITH CHECK.
drop policy if exists "staff_manage_esign_api_keys" on public.esign_api_keys;
create policy "staff_manage_esign_api_keys"
on public.esign_api_keys for all to authenticated
using      ((admin_id = public.current_admin_id() and public.is_esign_staff()) or public.is_global_viewer())
with check ((admin_id = public.current_admin_id() and public.is_esign_staff()) or public.is_global_viewer());

-- ── 2. OTP brute-force protection ─────────────────────────────────────────────

-- otp_attempts caps guesses against the CURRENT code and resets when a new code
-- is issued. otp_sent_count caps how many codes a single signing link may ever
-- request, so an attacker cannot sidestep the per-code cap by cycling resends —
-- the two together bound total guesses per link.
alter table public.esign_signers add column if not exists otp_attempts   integer not null default 0;
alter table public.esign_signers add column if not exists otp_sent_count integer not null default 0;

-- Atomic increment. The edge function registers the attempt BEFORE comparing the
-- code, so concurrent guesses each consume a slot instead of racing on a
-- read-modify-write and slipping past the cap.
create or replace function public.esign_otp_register_attempt(p_signer uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.esign_signers
     set otp_attempts = coalesce(otp_attempts, 0) + 1
   where id = p_signer
  returning otp_attempts into v_count;
  return coalesce(v_count, 0);
end;
$$;

-- Only the edge function (service role) may call this. Revoking from PUBLIC
-- alone is not enough — anon/authenticated hold EXECUTE via default privileges
-- and must be revoked explicitly.
revoke all on function public.esign_otp_register_attempt(uuid) from public;
revoke all on function public.esign_otp_register_attempt(uuid) from anon;
revoke all on function public.esign_otp_register_attempt(uuid) from authenticated;
grant execute on function public.esign_otp_register_attempt(uuid) to service_role;

-- ── 3. Refresh PostgREST schema cache ─────────────────────────────────────────
notify pgrst, 'reload schema';

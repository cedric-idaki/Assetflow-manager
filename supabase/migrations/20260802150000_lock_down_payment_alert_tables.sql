-- ===========================================================================
-- Lock down payment_alert_configs / payment_alerts_log.
--
-- Both carried `FOR ALL TO public USING (true) WITH CHECK (true)` from
-- 20260304200000_payment_alerts.sql ("open access for app use"). Role `public`
-- includes `anon`, so with the anon SELECT grant these were readable with no
-- login at all — verified live: GET /rest/v1/payment_alert_configs returned
-- HTTP 200 with real rows. The write half was already closed by
-- 20260802140000_revoke_anon_write_grants.sql; this closes the read half and
-- removes the policies themselves.
--
-- Neither table has an admin_id, so there is nothing to scope by tenant:
-- payment_alert_configs is global platform config (6 rows, unique per
-- alert_type) and payment_alerts_log is an append-only delivery log holding
-- recipient_email / recipient_phone / recipient_name / subject / message /
-- amount — PII plus financial data, with no tenant column to filter on.
--
-- Safe to close completely because the ONLY consumer is the payment-alerts
-- Edge Function, which builds its client with SUPABASE_SERVICE_ROLE_KEY
-- (functions/payment-alerts/index.ts:239). service_role bypasses RLS, so it is
-- unaffected by everything below. Verified no src/ code reads either table.
--
-- What is left for end users: a super_admin / director read path, so the
-- platform owner can still audit alert delivery, and super_admin toggling of
-- the alert configs. Nothing else.
-- ===========================================================================

begin;

drop policy if exists "open_access_payment_alert_configs" on public.payment_alert_configs;
drop policy if exists "open_access_payment_alerts_log"    on public.payment_alerts_log;

-- payment_alert_configs — platform config. Global viewers read; super_admin edits.
create policy payment_alert_configs_read on public.payment_alert_configs
for select to authenticated
using (public.is_global_viewer());

create policy payment_alert_configs_update on public.payment_alert_configs
for update to authenticated
using (
  exists (select 1 from public.user_profiles up
          where up.id = auth.uid() and up.role = 'super_admin'::public.user_role)
)
with check (
  exists (select 1 from public.user_profiles up
          where up.id = auth.uid() and up.role = 'super_admin'::public.user_role)
);

-- payment_alerts_log — append-only audit trail written by the Edge Function.
-- No INSERT/UPDATE/DELETE policy at all: service_role is the only writer.
create policy payment_alerts_log_read on public.payment_alerts_log
for select to authenticated
using (public.is_global_viewer());

-- Grants: anon loses everything (it kept SELECT after the 0802140000 revoke,
-- which only stripped writes). authenticated keeps just what the policies above
-- can actually use — the log stays read-only to every end-user role.
revoke all on public.payment_alert_configs from anon;
revoke all on public.payment_alerts_log    from anon;

revoke insert, delete on public.payment_alert_configs from authenticated;
revoke insert, update, delete on public.payment_alerts_log from authenticated;

commit;

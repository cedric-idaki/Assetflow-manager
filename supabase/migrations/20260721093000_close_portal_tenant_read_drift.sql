-- ============================================================================
-- CLOSE PORTAL READ DRIFT ON TENANT TABLES
-- ----------------------------------------------------------------------------
-- Follow-up to 20260721090000. Tightening tenant_view_audit_logs alone did NOT
-- close the leak: the live database carries policies that were created by hand
-- in the SQL editor and never tracked in git. RLS policies are PERMISSIVE and
-- OR'd together, so one loose policy re-opens everything.
--
-- The recurring mistake is this predicate:
--
--     admin_id IN (SELECT admin_id FROM user_profiles WHERE id = auth.uid())
--
-- It reads as "same tenant as me" and the policies using it are even named
-- "Staff ..." — but it performs NO staff check. user_profiles.admin_id is
-- populated for clients and sacco members too (that is the tenant model), so
-- every portal user in the tenant matched. Exposed to any logged-in client:
--
--     audit_logs           -> the admin's activity trail  (reported symptom)
--     payroll_records      -> staff salaries
--     journal_entries      -> the accounting ledger
--     sales                -> company sales
--     generated_contracts  -> every contract in the tenant
--
-- Fix: use the same guard the tracked policies use — is_staff_member(), which
-- excludes 'client' and 'sacco_member' — and give clients an explicit narrow
-- policy where they genuinely need read access.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. audit_logs — drop the untracked legacy SELECT policies.
--
--    Every grant they made is already covered by the two tracked policies, so
--    nothing legitimate is lost:
--      * user_id = auth.uid()      -> portal_view_own_audit_logs
--      * admin_id = auth.uid()     -> tenant_view_audit_logs (an admin's own
--                                     current_admin_id() IS auth.uid())
--      * admin_id IN (my admin_id) -> tenant_view_audit_logs for staff; for
--                                     portal users this was the leak itself.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "audit_logs_agent_self" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_select"     ON public.audit_logs;
DROP POLICY IF EXISTS "audit_select"          ON public.audit_logs;

-- ----------------------------------------------------------------------------
-- 2. payroll_records — staff only. No portal user has any business here.
--    "Admin manages own payroll" (ALL, admin_id = auth.uid()) is left intact.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff can read payroll" ON public.payroll_records;

CREATE POLICY "Staff can read payroll"
ON public.payroll_records FOR SELECT
USING (admin_id = public.current_admin_id() AND public.is_staff_member());

-- ----------------------------------------------------------------------------
-- 3. journal_entries — staff only (accounting ledger).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff sees admin journal entries" ON public.journal_entries;

CREATE POLICY "Staff sees admin journal entries"
ON public.journal_entries FOR SELECT
USING (admin_id = public.current_admin_id() AND public.is_staff_member());

-- ----------------------------------------------------------------------------
-- 4. sales — staff only. "Agent reads own sales" (agent_id -> agents.user_id)
--    is left intact so sales agents keep their own rows.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff reads sales" ON public.sales;

CREATE POLICY "Staff reads sales"
ON public.sales FOR SELECT
USING (admin_id = public.current_admin_id() AND public.is_staff_member());

-- ----------------------------------------------------------------------------
-- 5. generated_contracts — staff see the tenant's contracts; a client sees
--    ONLY their own.
--
--    The client portal (src/pages/client-portal/components/DocumentCentreTab.jsx)
--    reads this table filtered by .eq('client_id', clientId) in application code
--    only — the old policy would have served the whole tenant to any client who
--    dropped that filter. The new client policy makes the database enforce it.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff reads generated contracts" ON public.generated_contracts;

CREATE POLICY "Staff reads generated contracts"
ON public.generated_contracts FOR SELECT
USING (admin_id = public.current_admin_id() AND public.is_staff_member());

DROP POLICY IF EXISTS "Client reads own generated contracts" ON public.generated_contracts;

CREATE POLICY "Client reads own generated contracts"
ON public.generated_contracts FOR SELECT
USING (client_id = public.get_client_id_for_user());

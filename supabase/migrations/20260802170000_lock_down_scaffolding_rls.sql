-- ============================================================================
-- Replace the remaining March-2026 scaffolding `USING (true)` policies with
-- tenant-scoped ones.
--
-- WHY
-- ---
-- Each of these tables carried a single PERMISSIVE `FOR ALL TO authenticated
-- USING (true) WITH CHECK (true)` policy. PERMISSIVE policies OR together, so
-- where a correct policy also existed it was dead code: `kyc_documents` has
-- four properly scoped client policies that `kyc_documents_full_access`
-- swallowed whole. Combined with the full DML grant `authenticated` holds, any
-- logged-in user of any role or tenant had read+write on all of it.
--
-- All nine tables are currently EMPTY (the project reset), so this is a
-- pre-emptive fix — nothing is leaking today, but the first client upload
-- would have been readable and deletable platform-wide.
--
-- House pattern, from `clients_tenant_manage`:
--     ((admin_id = current_admin_id()) AND is_staff_member()) OR is_global_viewer()
-- Tables without admin_id reach their tenant through clients.admin_id.
-- Client self-access uses get_client_id_for_user() (client_auth_id, else email).
-- ============================================================================

BEGIN;

-- ── kyc_documents ───────────────────────────────────────────────────────────
-- Keep the four existing client policies; they were always correct, just
-- unreachable. Only the two open policies go, plus a staff path which the
-- table never had (that is WHY the open policy was added — dropping it without
-- a replacement would lock admins out of KYC review).
DROP POLICY IF EXISTS kyc_documents_full_access ON public.kyc_documents;
DROP POLICY IF EXISTS "Allow authenticated insert into kyc_documents" ON public.kyc_documents;

CREATE POLICY kyc_documents_tenant_staff ON public.kyc_documents
  FOR ALL TO authenticated
  USING (
    (public.is_staff_member() AND (
       admin_id = public.current_admin_id()
       -- fallback: legacy rows may have a null admin_id but a scoped client
       OR client_id IN (SELECT c.id FROM public.clients c
                         WHERE c.admin_id = public.current_admin_id())
    )) OR public.is_global_viewer()
  )
  WITH CHECK (
    public.is_staff_member() AND (
      admin_id = public.current_admin_id()
      OR client_id IN (SELECT c.id FROM public.clients c
                        WHERE c.admin_id = public.current_admin_id())
    )
  );

-- ── company_kyc_documents ───────────────────────────────────────────────────
DROP POLICY IF EXISTS authenticated_access_company_kyc_docs ON public.company_kyc_documents;

CREATE POLICY company_kyc_documents_tenant_staff ON public.company_kyc_documents
  FOR ALL TO authenticated
  USING (((admin_id = public.current_admin_id()) AND public.is_staff_member())
         OR public.is_global_viewer())
  WITH CHECK ((admin_id = public.current_admin_id()) AND public.is_staff_member());

-- ── client_invitations ──────────────────────────────────────────────────────
-- Holds invitation_token: a leak here is an account-takeover primitive, so the
-- agent path is limited to the agent's own invitations.
DROP POLICY IF EXISTS authenticated_access_client_invitations ON public.client_invitations;

CREATE POLICY client_invitations_tenant_staff ON public.client_invitations
  FOR ALL TO authenticated
  USING (
    ((admin_id = public.current_admin_id()) AND public.is_staff_member())
    OR (agent_id = auth.uid())
    OR public.is_global_viewer()
  )
  WITH CHECK (
    ((admin_id = public.current_admin_id()) AND public.is_staff_member())
    OR (agent_id = auth.uid())
  );

-- ── asset_enquiries ─────────────────────────────────────────────────────────
-- `scoped_asset_enquiries_access` is ALSO replaced, not kept: it scoped staff
-- with `admin_id = auth.uid()`, which only ever matched the tenant OWNER, so
-- an admin's staff saw nothing through it and the open policy was carrying
-- them. Swapping to current_admin_id() is what makes dropping the open one safe.
DROP POLICY IF EXISTS asset_enquiries_full_access ON public.asset_enquiries;
DROP POLICY IF EXISTS scoped_asset_enquiries_access ON public.asset_enquiries;

CREATE POLICY asset_enquiries_tenant_staff ON public.asset_enquiries
  FOR ALL TO authenticated
  USING (((admin_id = public.current_admin_id()) AND public.is_staff_member())
         OR public.is_global_viewer())
  WITH CHECK ((admin_id = public.current_admin_id()) AND public.is_staff_member());

-- Clients raise and track their own enquiries (ItemEnquiryTab / useClientPortal).
CREATE POLICY asset_enquiries_client_read ON public.asset_enquiries
  FOR SELECT TO authenticated
  USING (client_id = public.get_client_id_for_user());

CREATE POLICY asset_enquiries_client_insert ON public.asset_enquiries
  FOR INSERT TO authenticated
  WITH CHECK (client_id = public.get_client_id_for_user());

-- ── installment_plans ───────────────────────────────────────────────────────
-- No admin_id; tenancy runs through clients.admin_id.
DROP POLICY IF EXISTS authenticated_manage_installment_plans ON public.installment_plans;

CREATE POLICY installment_plans_tenant_staff ON public.installment_plans
  FOR ALL TO authenticated
  USING (
    (public.is_staff_member() AND client_id IN (
       SELECT c.id FROM public.clients c WHERE c.admin_id = public.current_admin_id()))
    OR public.is_global_viewer()
  )
  WITH CHECK (
    public.is_staff_member() AND client_id IN (
      SELECT c.id FROM public.clients c WHERE c.admin_id = public.current_admin_id())
  );

-- Read-only for the client: plans are created by staff, never self-served.
CREATE POLICY installment_plans_client_read ON public.installment_plans
  FOR SELECT TO authenticated
  USING (client_id = public.get_client_id_for_user());

-- ── installment_charges ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS authenticated_manage_installment_charges ON public.installment_charges;

CREATE POLICY installment_charges_tenant_staff ON public.installment_charges
  FOR ALL TO authenticated
  USING (
    (public.is_staff_member() AND (
       client_id IN (SELECT c.id FROM public.clients c
                      WHERE c.admin_id = public.current_admin_id())
       -- client_id is nullable here; reach the tenant through the parent plan
       OR plan_id IN (SELECT p.id FROM public.installment_plans p
                        JOIN public.clients c ON c.id = p.client_id
                       WHERE c.admin_id = public.current_admin_id())
    )) OR public.is_global_viewer()
  )
  WITH CHECK (
    public.is_staff_member() AND (
      client_id IN (SELECT c.id FROM public.clients c
                     WHERE c.admin_id = public.current_admin_id())
      OR plan_id IN (SELECT p.id FROM public.installment_plans p
                       JOIN public.clients c ON c.id = p.client_id
                      WHERE c.admin_id = public.current_admin_id())
    )
  );

CREATE POLICY installment_charges_client_read ON public.installment_charges
  FOR SELECT TO authenticated
  USING (
    client_id = public.get_client_id_for_user()
    OR plan_id IN (SELECT p.id FROM public.installment_plans p
                    WHERE p.client_id = public.get_client_id_for_user())
  );

-- ── payment_schedules ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS authenticated_manage_payment_schedules ON public.payment_schedules;

CREATE POLICY payment_schedules_tenant_staff ON public.payment_schedules
  FOR ALL TO authenticated
  USING (
    (public.is_staff_member() AND client_id IN (
       SELECT c.id FROM public.clients c WHERE c.admin_id = public.current_admin_id()))
    OR public.is_global_viewer()
  )
  WITH CHECK (
    public.is_staff_member() AND client_id IN (
      SELECT c.id FROM public.clients c WHERE c.admin_id = public.current_admin_id())
  );

-- Clients plan their own payments in PaymentCalculator (select/insert/delete).
CREATE POLICY payment_schedules_client_read ON public.payment_schedules
  FOR SELECT TO authenticated
  USING (client_id = public.get_client_id_for_user());

CREATE POLICY payment_schedules_client_insert ON public.payment_schedules
  FOR INSERT TO authenticated
  WITH CHECK (client_id = public.get_client_id_for_user());

CREATE POLICY payment_schedules_client_delete ON public.payment_schedules
  FOR DELETE TO authenticated
  USING (client_id = public.get_client_id_for_user());

-- ── payment_reminders ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS authenticated_manage_payment_reminders ON public.payment_reminders;

CREATE POLICY payment_reminders_tenant_staff ON public.payment_reminders
  FOR ALL TO authenticated
  USING (
    (public.is_staff_member() AND (
       admin_id = public.current_admin_id()
       OR client_id IN (SELECT c.id FROM public.clients c
                         WHERE c.admin_id = public.current_admin_id())
    )) OR public.is_global_viewer()
  )
  WITH CHECK (
    public.is_staff_member() AND (
      admin_id = public.current_admin_id()
      OR client_id IN (SELECT c.id FROM public.clients c
                        WHERE c.admin_id = public.current_admin_id())
    )
  );

CREATE POLICY payment_reminders_client_read ON public.payment_reminders
  FOR SELECT TO authenticated
  USING (client_id = public.get_client_id_for_user());

CREATE POLICY payment_reminders_client_insert ON public.payment_reminders
  FOR INSERT TO authenticated
  WITH CHECK (client_id = public.get_client_id_for_user());

-- ── maker_checker_queue ─────────────────────────────────────────────────────
-- This table had NO tenant column at all, and `initiator_id` is never
-- populated by the app, so there was nothing to scope by. Add admin_id and
-- default it to the caller's tenant, so inserts that omit it are still scoped
-- correctly rather than landing NULL and becoming invisible.
--
-- NOTE: src/pages/pos-module/index.jsx already writes `admin_id` here, so this
-- column matches what the app expects. Both call sites also write several
-- columns that do not exist (record_id, table_name, new_values, severity,
-- metadata, initiator_email) and so are failing today for reasons unrelated to
-- RLS — that is tracked separately, this migration does not address it.
ALTER TABLE public.maker_checker_queue
  ADD COLUMN IF NOT EXISTS admin_id uuid DEFAULT public.current_admin_id();

CREATE INDEX IF NOT EXISTS idx_maker_checker_queue_admin_id
  ON public.maker_checker_queue (admin_id);

DROP POLICY IF EXISTS authenticated_manage_maker_checker_queue ON public.maker_checker_queue;

-- Staff-only: approvals are an internal control surface, never client-facing.
CREATE POLICY maker_checker_queue_tenant_staff ON public.maker_checker_queue
  FOR ALL TO authenticated
  USING (((admin_id = public.current_admin_id()) AND public.is_staff_member())
         OR public.is_global_viewer())
  WITH CHECK ((admin_id = public.current_admin_id()) AND public.is_staff_member());

-- ── Grant-level backstop ────────────────────────────────────────────────────
-- anon has no policy on any of these, so RLS already yields nothing; revoking
-- is provable without reasoning about policy composition.
REVOKE ALL ON public.kyc_documents,
              public.company_kyc_documents,
              public.client_invitations,
              public.asset_enquiries,
              public.installment_plans,
              public.installment_charges,
              public.payment_schedules,
              public.payment_reminders,
              public.maker_checker_queue
  FROM anon;

COMMIT;

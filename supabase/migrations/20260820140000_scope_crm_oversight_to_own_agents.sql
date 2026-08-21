-- ===========================================================================
-- CRM OVERSIGHT: EVERY SUPERVISOR SEES ONLY THEIR OWN AGENTS
--
-- 20260820120000 gave the three CRM read policies two branches:
--
--     public.is_global_viewer()                    -- super_admin: everything
--     or (is_crm_supervisor() and agent_id in (select tenant_agent_ids()))
--
-- The first branch is wrong for this product. A super_admin is not an auditor
-- looking down on every tenant's sales floor -- it runs its OWN sales force.
-- The two forces sell different things and are managed separately:
--
--   • super-admin-created agents ('company' mode) register companies and
--     saccos onto the platform;
--   • admin-created agents ('client' mode) register clients for that one
--     admin's tenant, out of that admin's own stock.
--
-- With the global branch in place the super admin's CRM tab listed the admin's
-- agents alongside its own -- mixing two unrelated books, and showing one
-- tenant's customer conversations to somebody outside that tenant. Both halves
-- of that are wrong: the second is a privacy leak.
--
-- This migration drops the global branch from all three policies. Scope is now
-- uniform: you see the agents whose admin_id is you.
--
--   super_admin  -> agents it created        (current_admin_id() = its own uid,
--                                             since its user_profiles.admin_id
--                                             is NULL and current_admin_id()
--                                             coalesces to auth.uid())
--   admin        -> agents it created
--   director /
--   manager /
--   sacco_admin  -> their tenant's agents
--
-- NOTE the consequence: an agent row with admin_id IS NULL is now visible to
-- NOBODY through these policies (tenant_agent_ids() already excluded NULL).
-- There are none today, and set_admin_id_agents stamps every new agent, so
-- this is a latent case rather than a live one -- but an unowned agent's CRM
-- would silently vanish rather than error. Assign an owner, do not widen this.
--
-- is_crm_supervisor() is unchanged and still correct: it answers "may this role
-- supervise", not "whose agents". super_admin stays a supervisor -- of its own.
--
-- Idempotent: drop-then-create by name, so re-running lands the same end state.
-- ===========================================================================

begin;

-- ---- crm_interactions ----

drop policy if exists "supervisors_read_tenant_interactions" on public.crm_interactions;
create policy "supervisors_read_tenant_interactions"
on public.crm_interactions for select to authenticated
using (
  public.is_crm_supervisor()
  and agent_id in (select public.tenant_agent_ids())
);

-- ---- leads ----
-- The four agents_*_own_leads policies stay untouched; policies are OR'd, so an
-- agent's access to their own leads is exactly what it has always been.

drop policy if exists "supervisors_read_tenant_leads" on public.leads;
create policy "supervisors_read_tenant_leads"
on public.leads for select to authenticated
using (
  public.is_crm_supervisor()
  and agent_id in (select public.tenant_agent_ids())
);

-- ---- follow_ups ----

drop policy if exists "supervisors_read_tenant_followups" on public.follow_ups;
create policy "supervisors_read_tenant_followups"
on public.follow_ups for select to authenticated
using (
  public.is_crm_supervisor()
  and agent_id in (select public.tenant_agent_ids())
);

commit;

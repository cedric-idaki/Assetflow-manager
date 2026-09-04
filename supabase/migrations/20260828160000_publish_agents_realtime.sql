-- ===========================================================================
-- PUBLISH public.agents TO REALTIME
--
-- THE GAP
--
-- The supervisor CRM subscribes to `crm_interactions` and `leads`, so an agent
-- logging a call or losing a deal reaches the admin's screen immediately. But
-- `agents` was never in the publication, and `agents` is where the COMMERCIAL
-- half of that dashboard lives: total_sales, total_commission, agent_status.
--
-- Since 20260828120000 those columns are maintained by a trigger on payments.
-- So a payment completing now silently changes what the admin's CRM ought to be
-- showing — the Total sales tile, the Total commission tile, the leaderboard
-- ranking and the Sales / Commission columns on the agent table — and none of
-- it moved until somebody hit Refresh. Half a dashboard live and half of it
-- stale is worse than either, because there is nothing on screen saying which
-- half you are looking at.
--
-- Publishing `agents` closes that. The hook subscribes to it alongside the
-- other two.
--
-- WHY NOT PUBLISH `payments` INSTEAD
--
-- Because the CRM does not read payments — it reads the totals the payments
-- trigger maintains. Subscribing to the cause rather than the effect would
-- fire on every payment in the tenant including ones with no agent attached,
-- and would still be a beat ahead of the figures it is meant to announce.
--
-- SECURITY NOTE
--
-- Realtime enforces RLS per subscriber, so this grants no read anybody did not
-- already have. It does mean a super_admin's subscription carries other
-- tenants' agent rows, because tenant_manage_agents still contains
-- `or is_global_viewer()` — the same roster exposure already measured and
-- documented in scripts/verify-crm-tenant-isolation.sql check 6b. This
-- migration does not widen it; closing it means changing that policy, which is
-- a separate product decision.
--
-- Idempotent: the publication add is guarded, so re-running is a no-op.
-- ===========================================================================

begin;

do $$ begin
  alter publication supabase_realtime add table public.agents;
exception when duplicate_object then null; end $$;

-- UPDATE events need a replica identity to be emitted at all. The default
-- (primary key) is enough here: the CRM refetches on notification rather than
-- reading column values out of the payload, so it never needs the OLD row.
alter table public.agents replica identity default;

notify pgrst, 'reload schema';

commit;

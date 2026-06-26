-- Migration: sales-agent tiers (plans) for super-admin-created agents.
--
-- When a super_admin creates a sales agent they pick a plan that sets the
-- commission the agent earns each time they register an admin/company:
--   • bronze → KES 500 per admin created
--   • gold   → KES 1500 per admin created (gold agents also onboard/train the admin)
--
-- Admin-created agents (who register clients) do not use plans; the column stays
-- null for them. Existing super-admin agents with a null plan are treated as
-- bronze by the app.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS is a no-op when present.

alter table public.agents add column if not exists agent_plan text;

-- Refresh the PostgREST schema cache so the new column is immediately visible.
notify pgrst, 'reload schema';

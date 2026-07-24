-- Migration: sacco sales agents.
--
-- The sacco super-admin side (/sacco-oversight) gets its own sales agents,
-- mirroring the company super-admin ones — except a sacco agent registers
-- SACCOS (sacco_admin accounts) instead of companies. Both kinds live in the
-- same public.agents table; agent_type says which portal flow the agent gets:
--   • 'company' → existing behaviour (registers companies or clients,
--                 decided by the creator's role — see useSalesAgentPortal)
--   • 'sacco'   → registers saccos from the sales-agent portal
--
-- The commission model is shared: the agent_plan column (bronze KES 500 /
-- gold KES 1500 per registration) applies per sacco registered, and payouts
-- go through the existing agent_wallets table.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS is a no-op when present, and the
-- backfill only touches NULL rows.

alter table public.agents add column if not exists agent_type text default 'company';

-- Rows created before this migration are all company-side agents.
update public.agents set agent_type = 'company' where agent_type is null;

-- Refresh the PostgREST schema cache so the new column is immediately visible.
notify pgrst, 'reload schema';

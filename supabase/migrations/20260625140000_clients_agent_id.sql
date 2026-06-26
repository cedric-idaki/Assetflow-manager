-- Migration: ensure clients.agent_id exists.
--
-- Sales agents can now convert a lead into a CLIENT directly from the sales
-- agent portal (CreateClientModal). The new client row is attributed to the
-- agent via agent_id so the agent's "My Clients" can resolve them. The admin
-- "Invite Client" flow (useAdminDashboard.inviteClient) already writes this
-- column too, so guaranteeing it exists hardens both paths.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS is a no-op when the column is present.

alter table public.clients
  add column if not exists agent_id uuid references public.agents(id) on delete set null;

create index if not exists idx_clients_agent_id on public.clients(agent_id);

-- Refresh the PostgREST schema cache so the column is immediately visible.
notify pgrst, 'reload schema';

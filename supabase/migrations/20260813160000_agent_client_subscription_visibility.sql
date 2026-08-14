-- ===========================================================================
-- AGENT CLIENT SUBSCRIPTION VISIBILITY
--
-- A sales agent's client list has to answer one question: has the account I
-- registered paid, and is it still paid up? The data was always there in
-- company_subscriptions — the agent simply had no way to read it, so the portal
-- could only ever list who they had signed, never whether it was still worth
-- anything.
--
-- This grants a narrow SELECT: an agent may read the subscription rows of the
-- accounts THEY registered, and nothing else. Two links establish "they
-- registered it", matching how the portal resolves the same list:
--
--   1. leads.converted_ref_id — set when the account came from one of the
--      agent's leads (migration 20260725140000).
--   2. audit_logs record_id   — the 'user_created' row the create modals write.
--      Registrations made straight from the portal never touch a lead, so
--      without this half those accounts would be invisible to their own seller.
--
-- Deliberately SELECT only. An agent must never be able to edit, extend or
-- cancel a customer's subscription; renewals stay with the customer and the
-- super admin.
--
-- NOTE ON APPLYING THIS
--   company_subscriptions predates the tracked migrations and this repo's
--   remote migration history is known to disagree with the live schema in both
--   directions. Apply this file on its own and confirm the table has RLS
--   enabled before relying on the policy — a policy on a table without RLS
--   enforces nothing. The guard below enables it only if it is off, because
--   turning RLS on for the first time would otherwise silently cut off every
--   existing reader that currently relies on it being off.
-- ===========================================================================

begin;

-- ── Helper: the agents rows belonging to the calling user ──────────────────
-- An agent's identity is agents.user_id -> auth.uid(). Kept as a function so
-- the policy reads cleanly and the same rule can be reused elsewhere.
create or replace function public.agent_registered_admin(p_admin_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    -- Route 1: the account came from one of this agent's leads.
    select 1
    from public.leads l
    join public.agents a on a.id = l.agent_id
    where a.user_id = auth.uid()
      and l.converted_ref_id = p_admin_id
      and l.converted_entity in ('company', 'sacco')
  )
  or exists (
    -- Route 2: the agent created it directly, recorded in the audit trail.
    select 1
    from public.audit_logs al
    where al.user_id = auth.uid()
      and al.action = 'user_created'
      and al.table_name in ('company_profiles', 'saccos')
      and al.record_id = p_admin_id
  );
$$;

comment on function public.agent_registered_admin(uuid) is
  'True when the calling user is the sales agent who registered the given admin/sacco account. Used to scope an agent''s read of company_subscriptions to their own book.';

revoke all on function public.agent_registered_admin(uuid) from public;
grant execute on function public.agent_registered_admin(uuid) to authenticated;

-- ── Enable RLS only if it is currently off ─────────────────────────────────
do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'company_subscriptions' and rowsecurity = false
  ) then
    raise notice 'company_subscriptions had RLS disabled; enabling it. Verify existing readers (admin profile page, super admin dashboard, mpesa-stk-push) still work.';
    alter table public.company_subscriptions enable row level security;
  end if;
end
$$;

-- ── The policy ─────────────────────────────────────────────────────────────
drop policy if exists "agents_read_registered_subscriptions" on public.company_subscriptions;
create policy "agents_read_registered_subscriptions"
on public.company_subscriptions
for select
to authenticated
using (public.agent_registered_admin(admin_id));

comment on policy "agents_read_registered_subscriptions" on public.company_subscriptions is
  'A sales agent may read (never write) the subscription history of accounts they registered, so the portal can flag expired and expiring clients.';

-- ── Supporting indexes ─────────────────────────────────────────────────────
-- Both routes above are looked up by the value being matched, per policy row.
create index if not exists idx_leads_converted_ref_id
  on public.leads (converted_ref_id) where converted_ref_id is not null;

create index if not exists idx_audit_logs_user_created_record
  on public.audit_logs (user_id, record_id) where action = 'user_created';

create index if not exists idx_company_subscriptions_admin_id
  on public.company_subscriptions (admin_id);

commit;

-- ===========================================================================
-- CRM MULTI-TENANT ISOLATION — LIVE VERIFICATION
--
-- Proves, against a real database, the six access-control scenarios the CRM
-- is required to enforce. Unit tests cannot do this: RLS is a property of the
-- database, and the only honest way to test it is to become each role and see
-- what comes back.
--
-- HOW IT WORKS
--   1. Seeds two synthetic tenants (Company A, Company B) plus a super admin,
--      each with one sales agent carrying one lead, one interaction and one
--      follow-up. The user_profiles step is an UPSERT because inserting into
--      auth.users fires handle_new_user(), which creates the profile row first.
--   2. Impersonates each role by setting request.jwt.claims and switching to
--      the `authenticated` role, exactly as PostgREST does for a real request.
--   3. Asserts what each role can and cannot read.
--   4. ROLLS BACK, ALWAYS.
--
-- SAFE TO RUN AGAINST PRODUCTION. The seed cannot survive this script:
--
--   * All seeding and all assertions happen inside ONE DO block, and that block
--     ALWAYS ends in RAISE EXCEPTION — on success as well as on failure. A DO
--     block is a single statement, so raising unwinds every insert it made even
--     if the client is in autocommit and ignores the BEGIN below.
--   * The surrounding BEGIN / ROLLBACK is a second, independent guard.
--
-- The success path therefore EXITS NON-ZERO with a message beginning
-- "ALL CHECKS PASSED". That error is intentional and is what proves the seed
-- was discarded. Read the message, not the exit code.
--
-- (Same RAISE-to-rollback approach already used to smoke-test the
-- crm_interactions triggers on this database.)
--
-- RUN IT
--   supabase db query --linked -f scripts/verify-crm-tenant-isolation.sql
--
-- READ THE OUTPUT
--   Every check prints PASS or FAIL as a NOTICE. If anything fails the block
--   raises at the end with a list, so a failure cannot scroll past unnoticed.
-- ===========================================================================

begin;

do $verify$
declare
  -- Fixed uuids so a failure is greppable in the output rather than random.
  sa_id      uuid := '00000000-0000-4000-8000-0000000000aa';  -- super admin
  a_admin    uuid := '00000000-0000-4000-8000-0000000000a1';  -- Company A admin
  b_admin    uuid := '00000000-0000-4000-8000-0000000000b1';  -- Company B admin
  a1_user    uuid := '00000000-0000-4000-8000-0000000000a2';  -- Company A agent login
  a2_user    uuid := '00000000-0000-4000-8000-0000000000a3';  -- Company A agent login #2
  b1_user    uuid := '00000000-0000-4000-8000-0000000000b2';  -- Company B agent login

  sa_agent   uuid;
  a1_agent   uuid;
  a2_agent   uuid;
  b1_agent   uuid;

  b1_lead    uuid;
  a2_lead    uuid;

  n          integer;
  failures   text[] := '{}';
  checks_run integer := 0;
  -- Carried into the final message. NOTICEs are invisible through
  -- `supabase db query` (the API returns only the error), so anything a reader
  -- must actually SEE has to travel in the RAISE at the end, not a notice.
  roster_leak integer := -1;

  -- Impersonation helper values
  claims     text;
begin

  -- =========================================================================
  -- 0. SEED
  -- =========================================================================
  raise notice '--- seeding two tenants (rolled back at the end) ---';

  insert into auth.users (id, email, instance_id, aud, role, created_at, updated_at)
  values
    (sa_id,   'verify-sa@example.invalid',      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (a_admin, 'verify-a-admin@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (b_admin, 'verify-b-admin@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (a1_user, 'verify-a1@example.invalid',      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (a2_user, 'verify-a2@example.invalid',      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (b1_user, 'verify-b1@example.invalid',      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

  -- UPSERT, not INSERT. Inserting into auth.users fires handle_new_user(), which
  -- has ALREADY created a user_profiles row copying id/email/full_name/role --
  -- and notably NOT admin_id, which is the same gap that produced the live
  -- agent/profile ownership drift fixed on 2026-08-20. So the rows exist by the
  -- time we get here; what they are missing is the tenant key and the role.
  --
  -- admin_id NULL on a tenant owner: current_admin_id() coalesces to their own
  -- uid, which is what makes an owner the root of their own tenant.
  insert into public.user_profiles (id, email, full_name, role, admin_id)
  values
    (sa_id,   'verify-sa@example.invalid',      'Verify SuperAdmin', 'super_admin'::public.user_role,  null),
    (a_admin, 'verify-a-admin@example.invalid', 'Verify Admin A',    'admin'::public.user_role,        null),
    (b_admin, 'verify-b-admin@example.invalid', 'Verify Admin B',    'admin'::public.user_role,        null),
    (a1_user, 'verify-a1@example.invalid',      'Verify Agent A1',   'sales_agent'::public.user_role,  a_admin),
    (a2_user, 'verify-a2@example.invalid',      'Verify Agent A2',   'sales_agent'::public.user_role,  a_admin),
    (b1_user, 'verify-b1@example.invalid',      'Verify Agent B1',   'sales_agent'::public.user_role,  b_admin)
  on conflict (id) do update
    set email     = excluded.email,
        full_name = excluded.full_name,
        role      = excluded.role,
        admin_id  = excluded.admin_id;

  insert into public.agents (user_id, admin_id, agent_code, full_name, email, agent_status, total_sales, total_commission)
  values
    (null,    sa_id,   'VERIFY-SA1', 'Verify Platform Agent', 'verify-sa1@example.invalid', 'active', 1000000, 40000),
    (a1_user, a_admin, 'VERIFY-A1',  'Verify Agent A1',       'verify-a1@example.invalid',  'active', 5200000, 208000),
    (a2_user, a_admin, 'VERIFY-A2',  'Verify Agent A2',       'verify-a2@example.invalid',  'active', 4800000, 192000),
    (b1_user, b_admin, 'VERIFY-B1',  'Verify Agent B1',       'verify-b1@example.invalid',  'active', 8100000, 324000);

  select id into sa_agent from public.agents where agent_code = 'VERIFY-SA1';
  select id into a1_agent from public.agents where agent_code = 'VERIFY-A1';
  select id into a2_agent from public.agents where agent_code = 'VERIFY-A2';
  select id into b1_agent from public.agents where agent_code = 'VERIFY-B1';

  insert into public.leads (agent_id, full_name, phone, stage)
  values
    (a1_agent, 'Verify Lead A1', '+254700000001', 'qualified'),
    (a2_agent, 'Verify Lead A2', '+254700000002', 'contacted'),
    (b1_agent, 'Verify Lead B1', '+254700000003', 'proposal_sent');

  select id into a2_lead from public.leads where full_name = 'Verify Lead A2';
  select id into b1_lead from public.leads where full_name = 'Verify Lead B1';

  insert into public.crm_interactions (agent_id, lead_id, contact_name, interaction_type, summary)
  values
    (a1_agent, (select id from public.leads where full_name = 'Verify Lead A1'),
     'Verify Lead A1', 'call', 'Company A private conversation'),
    (a2_agent, a2_lead, 'Verify Lead A2', 'meeting', 'Company A second agent conversation'),
    (b1_agent, b1_lead, 'Verify Lead B1', 'call', 'Company B private conversation');

  insert into public.follow_ups (agent_id, lead_id, lead_name, scheduled_at, is_completed)
  values
    (a1_agent, (select id from public.leads where full_name = 'Verify Lead A1'),
     'Verify Lead A1', now() - interval '2 days', false),
    (b1_agent, b1_lead, 'Verify Lead B1', now() - interval '2 days', false);

  raise notice 'seeded: A=% / % , B=% , SA=%', a1_agent, a2_agent, b1_agent, sa_agent;
  raise notice ' ';

  -- =========================================================================
  -- TEST 1 — Company A Admin attempts to access Company B's Sales Agent
  --          Expected: ACCESS DENIED (0 rows)
  -- =========================================================================
  claims := json_build_object('sub', a_admin::text, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';

  select count(*) into n from public.agents where id = b1_agent;

  execute 'reset role';
  checks_run := checks_run + 1;
  if n = 0 then
    raise notice 'PASS  Test 1  Company A admin cannot see Company B agent row';
  else
    failures := failures || 'Test 1: Company A admin READ Company B agent row';
    raise notice 'FAIL  Test 1  Company A admin saw % Company B agent row(s)', n;
  end if;

  -- =========================================================================
  -- TEST 2 — Company A Admin hand-crafts a request for Company B's agent id
  --          (the URL-tampering case: /crm/agents/<company-b-agent-id>)
  --          Expected: ACCESS DENIED — no leads, no interactions, no follow-ups
  -- =========================================================================
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';

  select (select count(*) from public.leads            where agent_id = b1_agent)
       + (select count(*) from public.crm_interactions where agent_id = b1_agent)
       + (select count(*) from public.follow_ups       where agent_id = b1_agent)
    into n;

  execute 'reset role';
  checks_run := checks_run + 1;
  if n = 0 then
    raise notice 'PASS  Test 2  Naming Company B agent id directly returns nothing';
  else
    failures := failures || 'Test 2: Company A admin READ Company B CRM rows by agent id';
    raise notice 'FAIL  Test 2  Company A admin saw % Company B CRM row(s) by id', n;
  end if;

  -- =========================================================================
  -- TEST 3 — Company A Admin queries Company B's CRM through the API surface
  --          (no id supplied — an unfiltered "select *", the way a tampered
  --          client would ask). Expected: no unauthorized rows.
  -- =========================================================================
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';

  select count(*) into n
    from public.crm_interactions
   where summary = 'Company B private conversation';

  execute 'reset role';
  checks_run := checks_run + 1;
  if n = 0 then
    raise notice 'PASS  Test 3  Unfiltered CRM query returns no Company B rows';
  else
    failures := failures || 'Test 3: unfiltered query leaked Company B interactions';
    raise notice 'FAIL  Test 3  Unfiltered query returned % Company B interaction(s)', n;
  end if;

  -- Positive control: Company A admin MUST still see its own two agents' work,
  -- or the policy is denying everything and tests 1-3 pass for the wrong reason.
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';
  select count(*) into n from public.leads where agent_id in (a1_agent, a2_agent);
  execute 'reset role';
  checks_run := checks_run + 1;
  if n = 2 then
    raise notice 'PASS  Test 3b Company A admin still reads its own agents'' leads (2)';
  else
    failures := failures || format('Test 3b: Company A admin saw %s of its own 2 leads', n);
    raise notice 'FAIL  Test 3b Company A admin saw % of its own 2 leads', n;
  end if;

  -- =========================================================================
  -- TEST 4 — Sales Agent A1 attempts to read Sales Agent A2's customers.
  --          Same company. Expected: ACCESS DENIED.
  --          This is the property that makes is_crm_supervisor() deliberately
  --          NOT is_staff_member() — the latter is true for sales_agent.
  -- =========================================================================
  perform set_config('request.jwt.claims',
                     json_build_object('sub', a1_user::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select (select count(*) from public.leads            where agent_id = a2_agent)
       + (select count(*) from public.crm_interactions where agent_id = a2_agent)
    into n;

  execute 'reset role';
  checks_run := checks_run + 1;
  if n = 0 then
    raise notice 'PASS  Test 4  Agent A1 cannot read Agent A2 customers (same company)';
  else
    failures := failures || 'Test 4: agent read a colleague''s CRM rows';
    raise notice 'FAIL  Test 4  Agent A1 read % of Agent A2''s row(s)', n;
  end if;

  -- Positive control: A1 must still see their OWN book.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', a1_user::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.leads where agent_id = a1_agent;
  execute 'reset role';
  checks_run := checks_run + 1;
  if n = 1 then
    raise notice 'PASS  Test 4b Agent A1 still reads their own lead';
  else
    failures := failures || format('Test 4b: agent saw %s of their own 1 lead', n);
    raise notice 'FAIL  Test 4b Agent A1 saw % of their own 1 lead', n;
  end if;

  -- =========================================================================
  -- TEST 5 — Super Admin accesses a company it is authorised for.
  --
  --   On THIS product "authorised" means the agents the super admin itself
  --   created: it runs the platform sales force that registers companies and
  --   saccos. It is not a global auditor of every tenant's sales floor.
  --   See migration 20260820140000, which removed that branch deliberately.
  --   Expected: ACCESS GRANTED to its own agents' CRM.
  -- =========================================================================
  perform set_config('request.jwt.claims',
                     json_build_object('sub', sa_id::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.agents where id = sa_agent;

  execute 'reset role';
  checks_run := checks_run + 1;
  if n = 1 then
    raise notice 'PASS  Test 5  Super admin reads its own sales force';
  else
    failures := failures || 'Test 5: super admin could not read its own agent';
    raise notice 'FAIL  Test 5  Super admin saw % of its own 1 agent', n;
  end if;

  -- =========================================================================
  -- TEST 6 — Super Admin attempts a company outside its authorisation scope.
  --          Expected: ACCESS DENIED to that tenant's CRM DATA.
  --
  --   Split into two checks on purpose, because the answers differ and the
  --   difference matters:
  --     6a  CRM data (leads / interactions / follow-ups) — scoped, denied.
  --     6b  The agent ROSTER — public.agents still carries
  --         `or public.is_global_viewer()` in tenant_manage_agents, so a super
  --         admin CAN list every tenant's agent rows. Names and codes, not
  --         customer conversations. Reported, not asserted, so that this stays
  --         visible rather than being quietly assumed.
  -- =========================================================================
  perform set_config('request.jwt.claims',
                     json_build_object('sub', sa_id::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select (select count(*) from public.leads            where agent_id in (a1_agent, a2_agent, b1_agent))
       + (select count(*) from public.crm_interactions where agent_id in (a1_agent, a2_agent, b1_agent))
       + (select count(*) from public.follow_ups       where agent_id in (a1_agent, a2_agent, b1_agent))
    into n;

  execute 'reset role';
  checks_run := checks_run + 1;
  if n = 0 then
    raise notice 'PASS  Test 6a Super admin cannot read tenant CRM data';
  else
    failures := failures || format('Test 6a: super admin read %s tenant CRM row(s)', n);
    raise notice 'FAIL  Test 6a Super admin read % tenant CRM row(s)', n;
  end if;

  perform set_config('request.jwt.claims',
                     json_build_object('sub', sa_id::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.agents where id in (a1_agent, a2_agent, b1_agent);
  execute 'reset role';
  roster_leak := n;
  raise notice 'NOTE  Test 6b Super admin can list % of 3 other-tenant agent ROWS '
               '(roster only; tenant_manage_agents still has is_global_viewer)', n;

  -- =========================================================================
  -- HELPER BEHAVIOUR — the functions the policies are built on
  -- =========================================================================
  raise notice ' ';

  perform set_config('request.jwt.claims',
                     json_build_object('sub', a1_user::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  checks_run := checks_run + 1;
  if public.is_crm_supervisor() then
    failures := failures || 'is_crm_supervisor() returned TRUE for a sales_agent';
    raise notice 'FAIL  is_crm_supervisor() is TRUE for a sales agent';
  else
    raise notice 'PASS  is_crm_supervisor() is FALSE for a sales agent';
  end if;
  execute 'reset role';

  perform set_config('request.jwt.claims',
                     json_build_object('sub', a_admin::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.tenant_agent_ids();
  execute 'reset role';
  checks_run := checks_run + 1;
  if n = 2 then
    raise notice 'PASS  tenant_agent_ids() returns exactly Company A''s 2 agents';
  else
    failures := failures || format('tenant_agent_ids() returned %s, expected 2', n);
    raise notice 'FAIL  tenant_agent_ids() returned %, expected 2', n;
  end if;

  -- =========================================================================
  -- VERDICT
  -- =========================================================================
  raise notice ' ';
  if array_length(failures, 1) is null then
    -- Deliberately an exception, not a notice. This is the ONLY exit from the
    -- block, so the seed is guaranteed to be unwound whatever the client's
    -- transaction settings are. Success is the message, not the exit code.
    raise exception E'ALL CHECKS PASSED — % scenarios verified. Seed rolled back (this error is intentional).\n'
                    'Test 6b (reported, not asserted): super admin could list % of 3 other-tenant agent ROSTER rows.',
                    checks_run, roster_leak;
  else
    raise exception E'CRM ISOLATION FAILURES (% of % checks):\n  - %\n'
                    'Test 6b (reported, not asserted): super admin could list % of 3 other-tenant agent ROSTER rows.',
                    array_length(failures, 1), checks_run,
                    array_to_string(failures, E'\n  - '), roster_leak;
  end if;

end
$verify$;

-- Belt and braces. The DO block above always raises, which alone unwinds the
-- seed; this rolls back the surrounding transaction for clients that opened one.
rollback;

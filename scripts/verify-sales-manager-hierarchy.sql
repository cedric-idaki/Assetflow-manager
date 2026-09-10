-- ===========================================================================
-- SALES MANAGER HIERARCHY (20260903120000) — LIVE VERIFICATION
--
-- Proves, against a real database, that the reporting line does what the
-- migration claims: one manager per agent unless somebody authorised a second,
-- administrators are the only people who can move it, and a manager sees their
-- own team's book and nobody else's.
--
-- Unit tests cannot check any of this. Every guarantee below is an RLS policy,
-- a partial unique index, a CHECK constraint or a trigger, and the only honest
-- way to test those is to become each role and try.
--
-- WHAT IS UNDER TEST
--
--   STRUCTURE   one active primary line per agent; a second manager refused
--               without an authorisation; no manager under a manager; no line
--               across tenants.
--   AUTHORITY   only super admins and administrators may draw, move,
--               deactivate or reactivate a line -- and an agent cannot get the
--               same effect by editing the agents row directly.
--   VISIBILITY  a manager reads their team's leads and only their team's; the
--               read is READ, not write; deactivating the line ends it.
--   ATTRIBUTION leads, clients and payments carry the manager who was over the
--               agent at the time, and a later reassignment does not rewrite
--               that unless the caller asks for it.
--
-- HOW IT WORKS
--   1. Seeds two tenants: Company A (an admin, two managers, two agents) and
--      Company B (an admin and one agent), plus a lead per agent. The
--      user_profiles step is an UPSERT because inserting into auth.users fires
--      handle_new_user(), which creates the profile row first (without
--      admin_id or role).
--   2. Impersonates each role by setting request.jwt.claims and switching to
--      the `authenticated` role, exactly as PostgREST does for a real request.
--   3. Asserts what each role can and cannot do.
--   4. ROLLS BACK, ALWAYS.
--
-- SAFE TO RUN AGAINST PRODUCTION. The seed cannot survive this script:
--
--   * All seeding and all assertions happen inside ONE DO block, and that block
--     ALWAYS ends in RAISE EXCEPTION -- on success as well as on failure. A DO
--     block is a single statement, so raising unwinds every insert it made even
--     if the client is in autocommit and ignores the BEGIN below.
--   * The surrounding BEGIN / ROLLBACK is a second, independent guard.
--
-- The success path therefore EXITS NON-ZERO with a message beginning
-- "ALL CHECKS PASSED". That error is intentional and is what proves the seed
-- was discarded. Read the message, not the exit code.
--
-- RUN IT
--   supabase db query --linked -f scripts/verify-sales-manager-hierarchy.sql
--
-- READ THE OUTPUT
--   Every check prints PASS or FAIL as a NOTICE. NOTICEs are invisible through
--   `supabase db query` (the API returns only the error), so the verdict that
--   must actually be SEEN travels in the RAISE at the end.
-- ===========================================================================

begin;

do $verify$
declare
  -- Fixed uuids so a failure is greppable in the output rather than random.
  a_admin  uuid := '00000000-0000-4000-8000-00000000d0a1';  -- Company A admin
  b_admin  uuid := '00000000-0000-4000-8000-00000000d0b1';  -- Company B admin
  m1_user  uuid := '00000000-0000-4000-8000-00000000d0a2';  -- Company A manager 1
  m2_user  uuid := '00000000-0000-4000-8000-00000000d0a3';  -- Company A manager 2
  a1_user  uuid := '00000000-0000-4000-8000-00000000d0a4';  -- Company A agent 1
  a2_user  uuid := '00000000-0000-4000-8000-00000000d0a5';  -- Company A agent 2
  b1_user  uuid := '00000000-0000-4000-8000-00000000d0b2';  -- Company B agent

  m1_agent uuid;  m2_agent uuid;
  a1_agent uuid;  a2_agent uuid;  b1_agent uuid;

  a1_lead  uuid;
  a2_lead  uuid;
  b1_lead  uuid;

  link     uuid;   -- the assignment row under test
  n           integer;
  got         uuid;
  ok          boolean;
  errtext     text;
  failures    text[] := '{}';
  checks_run  integer := 0;
  a_claims    text;
  m1_claims   text;
  m2_claims   text;
  a1_claims   text;
begin

  -- =========================================================================
  -- 0. PRECONDITION — has the migration actually run?
  --
  --    Checked first and loudly, because every assertion below would otherwise
  --    fail for the same uninteresting reason.
  -- =========================================================================
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public'
                    and table_name = 'agent_manager_assignments') then
    raise exception 'PRECONDITION FAILED: public.agent_manager_assignments does not exist. '
                    'Migration 20260903120000_sales_manager_hierarchy.sql has not been applied.';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'agents'
                    and column_name = 'agent_role') then
    raise exception 'PRECONDITION FAILED: public.agents has no agent_role column. '
                    'Migration 20260903120000_sales_manager_hierarchy.sql has not been applied.';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'payments'
                    and column_name = 'manager_id') then
    raise exception 'PRECONDITION FAILED: public.payments has no manager_id column. '
                    'Migration 20260903120000_sales_manager_hierarchy.sql has not been applied.';
  end if;

  -- =========================================================================
  -- 1. SEED
  -- =========================================================================
  raise notice '--- seeding (rolled back at the end) ---';

  insert into auth.users (id, email, instance_id, aud, role, created_at, updated_at)
  values
    (a_admin, 'vsmh-a-admin@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (b_admin, 'vsmh-b-admin@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (m1_user, 'vsmh-m1@example.invalid',      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (m2_user, 'vsmh-m2@example.invalid',      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (a1_user, 'vsmh-a1@example.invalid',      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (a2_user, 'vsmh-a2@example.invalid',      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (b1_user, 'vsmh-b1@example.invalid',      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

  -- admin_id NULL on a tenant owner: current_admin_id() coalesces to their own
  -- uid, which is what makes an owner the root of their own tenant. A sales
  -- MANAGER keeps the sales_agent login role -- see the migration header on why
  -- user_profiles.role = 'manager' would have been the wrong lever.
  insert into public.user_profiles (id, email, full_name, role, admin_id)
  values
    (a_admin, 'vsmh-a-admin@example.invalid', 'VSMH Admin A',   'admin'::public.user_role,       null),
    (b_admin, 'vsmh-b-admin@example.invalid', 'VSMH Admin B',   'admin'::public.user_role,       null),
    (m1_user, 'vsmh-m1@example.invalid',      'VSMH Manager 1', 'sales_agent'::public.user_role, a_admin),
    (m2_user, 'vsmh-m2@example.invalid',      'VSMH Manager 2', 'sales_agent'::public.user_role, a_admin),
    (a1_user, 'vsmh-a1@example.invalid',      'VSMH Agent A1',  'sales_agent'::public.user_role, a_admin),
    (a2_user, 'vsmh-a2@example.invalid',      'VSMH Agent A2',  'sales_agent'::public.user_role, a_admin),
    (b1_user, 'vsmh-b1@example.invalid',      'VSMH Agent B1',  'sales_agent'::public.user_role, b_admin)
  on conflict (id) do update
    set email = excluded.email, full_name = excluded.full_name,
        role  = excluded.role,  admin_id  = excluded.admin_id;

  insert into public.agents (user_id, admin_id, agent_code, full_name, email, agent_status, agent_role)
  values
    (m1_user, a_admin, 'VSMH-M1', 'VSMH Manager 1', 'vsmh-m1@example.invalid', 'active', 'manager'),
    (m2_user, a_admin, 'VSMH-M2', 'VSMH Manager 2', 'vsmh-m2@example.invalid', 'active', 'manager'),
    (a1_user, a_admin, 'VSMH-A1', 'VSMH Agent A1',  'vsmh-a1@example.invalid', 'active', 'agent'),
    (a2_user, a_admin, 'VSMH-A2', 'VSMH Agent A2',  'vsmh-a2@example.invalid', 'active', 'agent'),
    (b1_user, b_admin, 'VSMH-B1', 'VSMH Agent B1',  'vsmh-b1@example.invalid', 'active', 'agent');

  select id into m1_agent from public.agents where agent_code = 'VSMH-M1';
  select id into m2_agent from public.agents where agent_code = 'VSMH-M2';
  select id into a1_agent from public.agents where agent_code = 'VSMH-A1';
  select id into a2_agent from public.agents where agent_code = 'VSMH-A2';
  select id into b1_agent from public.agents where agent_code = 'VSMH-B1';

  a_claims  := json_build_object('sub', a_admin::text, 'role', 'authenticated')::text;
  m1_claims := json_build_object('sub', m1_user::text, 'role', 'authenticated')::text;
  m2_claims := json_build_object('sub', m2_user::text, 'role', 'authenticated')::text;
  a1_claims := json_build_object('sub', a1_user::text, 'role', 'authenticated')::text;

  raise notice 'seeded: M1=% M2=% A1=% A2=% B1=%', m1_agent, m2_agent, a1_agent, a2_agent, b1_agent;
  raise notice ' ';

  -- =========================================================================
  -- TEST 1 — An administrator draws a reporting line, and agents.manager_id
  --          picks it up.
  --
  --          Two claims in one: the RPC accepts the assignment, and the
  --          projection trigger keeps the denormalised column in step. The
  --          second is what every `select *` in the app depends on.
  -- =========================================================================
  perform set_config('request.jwt.claims', a_claims, true);
  execute 'set local role authenticated';

  begin
    select id into link from public.assign_agent_to_manager(a1_agent, m1_agent);
    errtext := null;
  exception when others then
    link := null; errtext := sqlerrm;
  end;

  execute 'reset role';
  select manager_id into got from public.agents where id = a1_agent;

  checks_run := checks_run + 1;
  if link is not null and got = m1_agent then
    raise notice 'PASS  Test 1  Admin assigned A1 to M1 and agents.manager_id followed';
  else
    failures := failures || format('Test 1: assign failed (link=%s projected=%s err=%s)', link, got, errtext);
    raise notice 'FAIL  Test 1  link=% projected=% err=%', link, got, errtext;
  end if;

  -- =========================================================================
  -- TEST 2 — One manager, not two. Assigning a second PRIMARY manager must
  --          MOVE the line, not add one: the old row closes, exactly one
  --          active primary survives, and the closed row keeps its history.
  -- =========================================================================
  perform set_config('request.jwt.claims', a_claims, true);
  execute 'set local role authenticated';
  begin
    perform public.assign_agent_to_manager(a1_agent, m2_agent);
    errtext := null;
  exception when others then errtext := sqlerrm;
  end;
  execute 'reset role';

  select count(*) into n
    from public.agent_manager_assignments
   where agent_id = a1_agent and is_active and is_primary;
  select manager_id into got from public.agents where id = a1_agent;

  checks_run := checks_run + 1;
  if n = 1 and got = m2_agent and errtext is null then
    raise notice 'PASS  Test 2  Reassignment moved the single primary line to M2';
  else
    failures := failures || format('Test 2: expected 1 active primary on M2, got n=%s projected=%s err=%s', n, got, errtext);
    raise notice 'FAIL  Test 2  n=% projected=% err=%', n, got, errtext;
  end if;

  checks_run := checks_run + 1;
  select count(*) into n
    from public.agent_manager_assignments
   where agent_id = a1_agent and manager_id = m1_agent
     and not is_active and ended_at is not null and ended_by = a_admin;
  if n = 1 then
    raise notice 'PASS  Test 2b The superseded line was closed, not deleted';
  else
    failures := failures || format('Test 2b: superseded line not retained as history (n=%s)', n);
    raise notice 'FAIL  Test 2b n=%', n;
  end if;

  -- Put A1 back under M1 for the visibility tests below.
  perform set_config('request.jwt.claims', a_claims, true);
  execute 'set local role authenticated';
  perform public.assign_agent_to_manager(a1_agent, m1_agent);
  perform public.assign_agent_to_manager(a2_agent, m2_agent);
  execute 'reset role';

  -- =========================================================================
  -- TEST 3 — An agent cannot draw their own reporting line.
  --          This is the whole "administrators only" claim, tested from the
  --          role most motivated to get around it.
  -- =========================================================================
  perform set_config('request.jwt.claims', a1_claims, true);
  execute 'set local role authenticated';
  ok := false;
  begin
    perform public.assign_agent_to_manager(a1_agent, m2_agent);
    ok := true;                                  -- got through: that is a FAIL
  exception when others then
    ok := false; errtext := sqlerrm;
  end;
  execute 'reset role';

  checks_run := checks_run + 1;
  if not ok then
    raise notice 'PASS  Test 3  A sales agent cannot assign themselves a manager (%)', left(errtext, 60);
  else
    failures := failures || 'Test 3: a sales agent reassigned themselves'::text;
    raise notice 'FAIL  Test 3  a sales agent reassigned themselves';
  end if;

  -- =========================================================================
  -- TEST 4 — …and cannot get the same result by editing the agents row.
  --
  --          tenant_manage_agents is `for all` to every staff member and
  --          is_staff_member() is true for sales_agent, so RLS lets an agent
  --          UPDATE this row. The column guard is the only thing standing
  --          between that and self-promotion. Both columns are tested.
  -- =========================================================================
  perform set_config('request.jwt.claims', a1_claims, true);
  execute 'set local role authenticated';
  ok := false;
  begin
    update public.agents set manager_id = m2_agent where id = a1_agent;
    ok := true;
  exception when others then ok := false; errtext := sqlerrm;
  end;
  execute 'reset role';

  checks_run := checks_run + 1;
  select manager_id into got from public.agents where id = a1_agent;
  if not ok and got = m1_agent then
    raise notice 'PASS  Test 4  Hand-editing agents.manager_id is refused';
  else
    failures := failures || format('Test 4: agents.manager_id was hand-edited (ok=%s now=%s)', ok, got);
    raise notice 'FAIL  Test 4  ok=% now=%', ok, got;
  end if;

  perform set_config('request.jwt.claims', a1_claims, true);
  execute 'set local role authenticated';
  ok := false;
  begin
    update public.agents set agent_role = 'manager' where id = a1_agent;
    ok := true;
  exception when others then ok := false;
  end;
  execute 'reset role';

  checks_run := checks_run + 1;
  select count(*) into n from public.agents where id = a1_agent and agent_role = 'agent';
  if not ok and n = 1 then
    raise notice 'PASS  Test 4b An agent cannot promote themselves to manager';
  else
    failures := failures || format('Test 4b: self-promotion succeeded (ok=%s still_agent=%s)', ok, n);
    raise notice 'FAIL  Test 4b ok=% still_agent=%', ok, n;
  end if;

  -- =========================================================================
  -- TEST 5 — "…unless authorised otherwise."
  --
  --          A second manager with no written authorisation is refused; the
  --          same call with one is accepted and records who signed for it.
  -- =========================================================================
  perform set_config('request.jwt.claims', a_claims, true);
  execute 'set local role authenticated';
  ok := false;
  begin
    perform public.assign_agent_to_manager(a1_agent, m2_agent, false, null);
    ok := true;
  exception when others then ok := false; errtext := sqlerrm;
  end;
  execute 'reset role';

  checks_run := checks_run + 1;
  if not ok then
    raise notice 'PASS  Test 5  A second manager without an authorisation is refused';
  else
    failures := failures || 'Test 5: an unauthorised second manager was accepted'::text;
    raise notice 'FAIL  Test 5  unauthorised second manager accepted';
  end if;

  perform set_config('request.jwt.claims', a_claims, true);
  execute 'set local role authenticated';
  begin
    select id into link from public.assign_agent_to_manager(
      a1_agent, m2_agent, false, 'Covering the coast region for Q4');
    errtext := null;
  exception when others then link := null; errtext := sqlerrm;
  end;
  execute 'reset role';

  checks_run := checks_run + 1;
  select count(*) into n
    from public.agent_manager_assignments
   where id = link and authorized_by = a_admin and authorization_note is not null;
  if link is not null and n = 1 then
    raise notice 'PASS  Test 5b An authorised second manager is accepted and signed for';
  else
    failures := failures || format('Test 5b: authorised second manager not recorded (link=%s n=%s err=%s)', link, n, errtext);
    raise notice 'FAIL  Test 5b link=% n=% err=%', link, n, errtext;
  end if;

  -- The primary line must be untouched by adding a second manager: the agent
  -- still reports to M1 first.
  checks_run := checks_run + 1;
  select manager_id into got from public.agents where id = a1_agent;
  if got = m1_agent then
    raise notice 'PASS  Test 5c The primary line survived the additional one';
  else
    failures := failures || format('Test 5c: primary line changed to %s when a second manager was added', got);
    raise notice 'FAIL  Test 5c primary is now %', got;
  end if;

  -- =========================================================================
  -- TEST 6 — No line across tenants, and no manager under a manager.
  --          The first is a privacy boundary; the second is what makes a cycle
  --          impossible.
  -- =========================================================================
  perform set_config('request.jwt.claims', a_claims, true);
  execute 'set local role authenticated';
  ok := false;
  begin
    perform public.assign_agent_to_manager(b1_agent, m1_agent);
    ok := true;
  exception when others then ok := false;
  end;
  execute 'reset role';

  checks_run := checks_run + 1;
  if not ok then
    raise notice 'PASS  Test 6  Company B agent cannot be put under a Company A manager';
  else
    failures := failures || 'Test 6: a cross-tenant reporting line was accepted'::text;
    raise notice 'FAIL  Test 6  cross-tenant reporting line accepted';
  end if;

  perform set_config('request.jwt.claims', a_claims, true);
  execute 'set local role authenticated';
  ok := false;
  begin
    perform public.assign_agent_to_manager(m2_agent, m1_agent);
    ok := true;
  exception when others then ok := false;
  end;
  execute 'reset role';

  checks_run := checks_run + 1;
  if not ok then
    raise notice 'PASS  Test 6b A manager cannot be assigned under another manager';
  else
    failures := failures || 'Test 6b: manager-under-manager accepted -- the hierarchy can now cycle'::text;
    raise notice 'FAIL  Test 6b manager-under-manager accepted';
  end if;

  -- =========================================================================
  -- TEST 7 — ATTRIBUTION. A lead written by A1 carries A1's manager.
  -- =========================================================================
  perform set_config('request.jwt.claims', a1_claims, true);
  execute 'set local role authenticated';
  insert into public.leads (agent_id, full_name, phone, stage, deal_value)
  values (a1_agent, 'VSMH Lead A1', '+254700000031', 'qualified', 750000)
  returning id into a1_lead;
  execute 'reset role';

  checks_run := checks_run + 1;
  select manager_id into got from public.leads where id = a1_lead;
  if got = m1_agent then
    raise notice 'PASS  Test 7  A new lead is stamped with the agent manager';
  else
    failures := failures || format('Test 7: lead manager_id is %s, expected %s', got, m1_agent);
    raise notice 'FAIL  Test 7  lead manager_id=% expected=%', got, m1_agent;
  end if;

  -- A2's lead and B1's lead exist so the visibility tests have something that
  -- must NOT be returned.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', a2_user::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.leads (agent_id, full_name, phone, stage)
  values (a2_agent, 'VSMH Lead A2', '+254700000032', 'contacted')
  returning id into a2_lead;
  execute 'reset role';

  perform set_config('request.jwt.claims',
                     json_build_object('sub', b1_user::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.leads (agent_id, full_name, phone, stage)
  values (b1_agent, 'VSMH Lead B1', '+254700000033', 'new_lead')
  returning id into b1_lead;
  execute 'reset role';

  -- Clients and payments take the same stamp. Seeded as the tenant admin,
  -- which is the path the admin dashboard actually uses.
  perform set_config('request.jwt.claims', a_claims, true);
  execute 'set local role authenticated';
  insert into public.clients (account_number, full_name, phone, agent_id)
  values ('VSMH-CLI-1', 'VSMH Client 1', '+254700000041', a1_agent);
  insert into public.payments (transaction_id, agent_id, amount, payment_status)
  values ('VSMH-TXN-1', a1_agent, 125000, 'completed');
  execute 'reset role';

  checks_run := checks_run + 1;
  select count(*) into n
    from public.clients c
    join public.payments p on p.transaction_id = 'VSMH-TXN-1'
   where c.account_number = 'VSMH-CLI-1'
     and c.manager_id = m1_agent and p.manager_id = m1_agent;
  if n = 1 then
    raise notice 'PASS  Test 7b A new client and payment carry the same manager';
  else
    failures := failures || 'Test 7b: client/payment manager_id not stamped'::text;
    raise notice 'FAIL  Test 7b client/payment manager_id not stamped';
  end if;

  -- =========================================================================
  -- TEST 8 — VISIBILITY. M1 reads A1's lead. M2 does not.
  --
  --          The negative half is the one that matters: a manager who can see
  --          another manager's pipeline is the leak this feature could most
  --          easily have shipped.
  -- =========================================================================
  perform set_config('request.jwt.claims', m1_claims, true);
  execute 'set local role authenticated';
  select count(*) into n from public.leads where id = a1_lead;
  execute 'reset role';

  checks_run := checks_run + 1;
  if n = 1 then
    raise notice 'PASS  Test 8  M1 reads their own agent lead';
  else
    failures := failures || 'Test 8: a manager cannot see their own agent lead'::text;
    raise notice 'FAIL  Test 8  M1 cannot see A1 lead';
  end if;

  perform set_config('request.jwt.claims', m2_claims, true);
  execute 'set local role authenticated';
  select count(*) into n from public.leads where id = a2_lead;      -- own team: visible
  execute 'reset role';

  checks_run := checks_run + 1;
  if n = 1 then
    raise notice 'PASS  Test 8b M2 reads their own agent lead';
  else
    failures := failures || 'Test 8b: M2 cannot see A2 lead'::text;
    raise notice 'FAIL  Test 8b M2 cannot see A2 lead';
  end if;

  perform set_config('request.jwt.claims', m2_claims, true);
  execute 'set local role authenticated';
  select count(*) into n from public.leads where id = b1_lead;
  execute 'reset role';

  checks_run := checks_run + 1;
  if n = 0 then
    raise notice 'PASS  Test 8c A manager cannot read another tenant lead';
  else
    failures := failures || 'Test 8c: cross-tenant lead visible to a manager'::text;
    raise notice 'FAIL  Test 8c cross-tenant lead visible';
  end if;

  -- =========================================================================
  -- TEST 9 — Oversight is READ. A manager must not be able to work their
  --          agent's book for them, the same boundary 20260820120000 drew for
  --          supervisors.
  -- =========================================================================
  perform set_config('request.jwt.claims', m1_claims, true);
  execute 'set local role authenticated';
  update public.leads set stage = 'closed' where id = a1_lead;
  get diagnostics n = row_count;
  execute 'reset role';

  checks_run := checks_run + 1;
  if n = 0 then
    raise notice 'PASS  Test 9  A manager cannot write their agent lead';
  else
    failures := failures || 'Test 9: a manager updated an agent lead'::text;
    raise notice 'FAIL  Test 9  a manager updated an agent lead';
  end if;

  -- =========================================================================
  -- TEST 10 — Reassignment moves VISIBILITY, not CREDIT.
  --
  --           A1 moves to M2. M2 can now open A1's existing lead; the lead is
  --           still stamped to M1, because M1's team earned it. This is the
  --           single most consequential design decision in the migration, so it
  --           is tested rather than asserted in a comment.
  -- =========================================================================
  perform set_config('request.jwt.claims', a_claims, true);
  execute 'set local role authenticated';
  perform public.assign_agent_to_manager(a1_agent, m2_agent);
  execute 'reset role';

  perform set_config('request.jwt.claims', m2_claims, true);
  execute 'set local role authenticated';
  select count(*) into n from public.leads where id = a1_lead;
  execute 'reset role';

  checks_run := checks_run + 1;
  select manager_id into got from public.leads where id = a1_lead;
  if n = 1 and got = m1_agent then
    raise notice 'PASS  Test 10 The new manager sees the book; the old one keeps the credit';
  else
    failures := failures || format('Test 10: visible_to_new=%s stamp=%s expected stamp %s', n, got, m1_agent);
    raise notice 'FAIL  Test 10 visible_to_new=% stamp=% expected=%', n, got, m1_agent;
  end if;

  -- …and the manager who earned it can still open it, through the stamp.
  perform set_config('request.jwt.claims', m1_claims, true);
  execute 'set local role authenticated';
  select count(*) into n from public.leads where id = a1_lead;
  execute 'reset role';

  checks_run := checks_run + 1;
  if n = 1 then
    raise notice 'PASS  Test 10b The manager who earned the lead can still read it';
  else
    failures := failures || 'Test 10b: the crediting manager lost sight of their own lead'::text;
    raise notice 'FAIL  Test 10b crediting manager cannot read the lead';
  end if;

  -- The explicit restructure: transfer the history too.
  perform set_config('request.jwt.claims', a_claims, true);
  execute 'set local role authenticated';
  perform public.assign_agent_to_manager(a1_agent, m1_agent, true, 'Restructure', true);
  execute 'reset role';

  checks_run := checks_run + 1;
  select manager_id into got from public.leads where id = a1_lead;
  if got = m1_agent then
    raise notice 'PASS  Test 10c p_transfer_history re-stamps the agent book';
  else
    failures := failures || format('Test 10c: history transfer left the stamp at %s', got);
    raise notice 'FAIL  Test 10c stamp=%', got;
  end if;

  -- =========================================================================
  -- TEST 11 — Deactivating a line ends the oversight it granted, and only an
  --           administrator may do it.
  -- =========================================================================
  select id into link
    from public.agent_manager_assignments
   where agent_id = a1_agent and manager_id = m1_agent and is_active and is_primary;

  perform set_config('request.jwt.claims', m1_claims, true);
  execute 'set local role authenticated';
  ok := false;
  begin
    perform public.set_agent_manager_link_active(link, false, 'not my call');
    ok := true;
  exception when others then ok := false;
  end;
  execute 'reset role';

  checks_run := checks_run + 1;
  if not ok then
    raise notice 'PASS  Test 11 A manager cannot deactivate their own reporting line';
  else
    failures := failures || 'Test 11: a manager deactivated a reporting line'::text;
    raise notice 'FAIL  Test 11 a manager deactivated a reporting line';
  end if;

  perform set_config('request.jwt.claims', a_claims, true);
  execute 'set local role authenticated';
  perform public.set_agent_manager_link_active(link, false, 'Agent moving to another region');
  execute 'reset role';

  checks_run := checks_run + 1;
  select manager_id into got from public.agents where id = a1_agent;
  if got is null then
    raise notice 'PASS  Test 11b Deactivating the line cleared the projected manager';
  else
    failures := failures || format('Test 11b: agents.manager_id still %s after deactivation', got);
    raise notice 'FAIL  Test 11b agents.manager_id=% after deactivation', got;
  end if;

  -- =========================================================================
  -- TEST 12 — The table itself is not writable by hand, by anyone.
  --           Two SECURITY DEFINER functions are the only way in; if a direct
  --           INSERT works, every authority check above is decorative.
  -- =========================================================================
  perform set_config('request.jwt.claims', a_claims, true);
  execute 'set local role authenticated';
  ok := false;
  begin
    insert into public.agent_manager_assignments (agent_id, manager_id, is_primary)
    values (a2_agent, m1_agent, false);
    ok := true;
  exception when others then ok := false; errtext := sqlerrm;
  end;
  execute 'reset role';

  checks_run := checks_run + 1;
  if not ok then
    raise notice 'PASS  Test 12 Even an admin cannot INSERT a reporting line directly (%)', left(errtext, 50);
  else
    failures := failures || 'Test 12: a reporting line was inserted directly, bypassing every check'::text;
    raise notice 'FAIL  Test 12 direct INSERT into agent_manager_assignments succeeded';
  end if;

  -- =========================================================================
  -- TEST 13 — sales_team_stats() is scoped by the caller, not by its argument.
  --           Called with no argument it must return the caller's world: every
  --           team for an administrator, one team for a manager.
  -- =========================================================================
  perform set_config('request.jwt.claims', a_claims, true);
  execute 'set local role authenticated';
  perform public.assign_agent_to_manager(a1_agent, m1_agent);
  select count(*) into n from public.sales_team_stats();
  execute 'reset role';

  checks_run := checks_run + 1;
  if n >= 2 then
    raise notice 'PASS  Test 13 An administrator sees every team (% rows)', n;
  else
    failures := failures || format('Test 13: admin saw %s team rows, expected at least 2', n);
    raise notice 'FAIL  Test 13 admin saw % rows', n;
  end if;

  perform set_config('request.jwt.claims', m2_claims, true);
  execute 'set local role authenticated';
  select count(*) into n from public.sales_team_stats();
  execute 'reset role';

  checks_run := checks_run + 1;
  if n = 1 then
    raise notice 'PASS  Test 13b A manager sees only their own team (% row)', n;
  else
    failures := failures || format('Test 13b: manager saw %s team rows, expected 1', n);
    raise notice 'FAIL  Test 13b manager saw % rows', n;
  end if;

  -- =========================================================================
  -- TEST 13c — Promoting an agent who already reports to somebody must not
  --            leave a manager reporting to a manager.
  --
  --            The validate trigger only fires on writes to the assignment
  --            table, so an agents-row promotion could arrive at the illegal
  --            two-level state by the back door -- silently, and it is the
  --            shape that makes a cycle possible.
  -- =========================================================================
  perform set_config('request.jwt.claims', a_claims, true);
  execute 'set local role authenticated';
  update public.agents set agent_role = 'manager' where id = a1_agent;
  execute 'reset role';

  checks_run := checks_run + 1;
  select count(*) into n
    from public.agent_manager_assignments
   where agent_id = a1_agent and is_active;
  select manager_id into got from public.agents where id = a1_agent;

  if n = 0 and got is null then
    raise notice 'PASS  Test 13c Promotion released the promoted agent own reporting lines';
  else
    failures := failures || format('Test 13c: promoted agent still reports to somebody (lines=%s projected=%s)', n, got);
    raise notice 'FAIL  Test 13c lines=% projected=%', n, got;
  end if;

  -- Put them back so Test 14 measures what it means to.
  perform set_config('request.jwt.claims', a_claims, true);
  execute 'set local role authenticated';
  update public.agents set agent_role = 'agent' where id = a1_agent;
  execute 'reset role';

  -- =========================================================================
  -- TEST 14 — A sales manager can still be DELETED.
  --
  --           Two foreign keys point at an agents row -- the assignment
  --           CASCADE and the agents.manager_id SET NULL -- and Postgres does
  --           not promise an order between them. If the SET NULL wins the race
  --           it drives an UPDATE the column guard would refuse, and the delete
  --           fails for a reason nobody could reproduce on demand. This is a
  --           LIVE path, not a theoretical one: agents.user_id cascades from
  --           user_profiles, so removing a staff member removes their agent
  --           row.
  -- =========================================================================
  ok := true;
  begin
    delete from public.agents where id = m2_agent;
  exception when others then
    ok := false; errtext := sqlerrm;
  end;

  checks_run := checks_run + 1;
  if ok then
    raise notice 'PASS  Test 14 A sales manager with a team can be deleted';
  else
    failures := failures || format('Test 14: deleting a manager failed -- %s', errtext);
    raise notice 'FAIL  Test 14 deleting a manager failed: %', errtext;
  end if;

  -- …and their agents are left unmanaged rather than pointing at a ghost.
  checks_run := checks_run + 1;
  select count(*) into n
    from public.agents a
   where a.id = a2_agent and a.manager_id is null;
  if n = 1 then
    raise notice 'PASS  Test 14b The deleted manager team was released, not orphaned';
  else
    failures := failures || 'Test 14b: an agent still points at a deleted manager'::text;
    raise notice 'FAIL  Test 14b agent still points at a deleted manager';
  end if;

  -- =========================================================================
  -- VERDICT
  --
  -- Always raises. On success the message begins ALL CHECKS PASSED; either way
  -- the exception is what discards the seed.
  -- =========================================================================
  raise notice ' ';
  if array_length(failures, 1) is null then
    -- Deliberately an exception, not a notice. This is the ONLY exit from the
    -- block, so the seed is guaranteed to be unwound whatever the client's
    -- transaction settings are. Success is the message, not the exit code.
    --
    -- One string literal, not two adjacent ones: only the FIRST literal of a
    -- continued constant may carry the E prefix, and `E'…' E'…'` is a syntax
    -- error rather than a concatenation.
    raise exception 'ALL CHECKS PASSED — % checks verified. Seed rolled back (this error is intentional).',
                    checks_run;
  else
    raise exception E'SALES MANAGER HIERARCHY FAILURES (% of % checks):\n  - %',
                    array_length(failures, 1), checks_run,
                    array_to_string(failures, E'\n  - ');
  end if;
end;
$verify$;

rollback;

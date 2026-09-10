-- ===========================================================================
-- SUPERVISOR-OWNED LEADS (20260831140000) — LIVE VERIFICATION
--
-- Proves, against a real database, that the super administrator's CRM can WRITE
-- its own pipeline and still cannot touch anybody else's. Unit tests cannot do
-- this: every guarantee below is an RLS policy, a CHECK constraint or a trigger,
-- and the only honest way to test those is to become each role and try.
--
-- The claim under test has two halves, and both matter:
--
--   NEW      a supervisor owns leads of their own -- insert, read, correct and
--            remove rows with agent_id IS NULL.
--   UNCHANGED an agent's lead stays read-only to supervisors, invisible to
--            other tenants, and untouchable by other agents. 20260820120000
--            drew that boundary on purpose and this migration must not move it.
--
-- HOW IT WORKS
--   1. Seeds a super admin, two tenant admins and two sales agents, each agent
--      with one lead. The user_profiles step is an UPSERT because inserting
--      into auth.users fires handle_new_user(), which creates the profile row
--      first (without admin_id or role).
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
--   supabase db query --linked -f scripts/verify-supervisor-owned-leads.sql
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
  sa_id    uuid := '00000000-0000-4000-8000-00000000c0aa';  -- super admin
  a_admin  uuid := '00000000-0000-4000-8000-00000000c0a1';  -- Company A admin
  b_admin  uuid := '00000000-0000-4000-8000-00000000c0b1';  -- Company B admin
  a1_user  uuid := '00000000-0000-4000-8000-00000000c0a2';  -- Company A agent login
  b1_user  uuid := '00000000-0000-4000-8000-00000000c0b2';  -- Company B agent login

  sa_agent uuid;
  a1_agent uuid;
  b1_agent uuid;

  a1_lead  uuid;   -- an AGENT's lead, the row supervisors must not write
  sa_lead  uuid;   -- the super admin's OWN lead, the row this migration adds

  n          integer;
  m          integer;
  owner      uuid;
  author     uuid;
  failures   text[] := '{}';
  checks_run integer := 0;
  claims     text;
begin

  -- =========================================================================
  -- 0. PRECONDITION — has the migration actually run?
  --
  --    Checked first and loudly, because every assertion below would otherwise
  --    fail for the same uninteresting reason.
  -- =========================================================================
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'leads'
                    and column_name = 'admin_id') then
    raise exception 'PRECONDITION FAILED: public.leads has no admin_id column. '
                    'Migration 20260831140000_supervisor_owned_leads.sql has not been applied.';
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'leads'
                and column_name = 'agent_id' and is_nullable = 'NO') then
    raise exception 'PRECONDITION FAILED: public.leads.agent_id is still NOT NULL. '
                    'Migration 20260831140000_supervisor_owned_leads.sql has not been applied.';
  end if;

  -- =========================================================================
  -- 1. SEED
  -- =========================================================================
  raise notice '--- seeding (rolled back at the end) ---';

  insert into auth.users (id, email, instance_id, aud, role, created_at, updated_at)
  values
    (sa_id,   'vsl-sa@example.invalid',      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (a_admin, 'vsl-a-admin@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (b_admin, 'vsl-b-admin@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (a1_user, 'vsl-a1@example.invalid',      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (b1_user, 'vsl-b1@example.invalid',      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

  -- admin_id NULL on a tenant owner: current_admin_id() coalesces to their own
  -- uid, which is what makes an owner the root of their own tenant.
  insert into public.user_profiles (id, email, full_name, role, admin_id)
  values
    (sa_id,   'vsl-sa@example.invalid',      'VSL SuperAdmin', 'super_admin'::public.user_role, null),
    (a_admin, 'vsl-a-admin@example.invalid', 'VSL Admin A',    'admin'::public.user_role,       null),
    (b_admin, 'vsl-b-admin@example.invalid', 'VSL Admin B',    'admin'::public.user_role,       null),
    (a1_user, 'vsl-a1@example.invalid',      'VSL Agent A1',   'sales_agent'::public.user_role, a_admin),
    (b1_user, 'vsl-b1@example.invalid',      'VSL Agent B1',   'sales_agent'::public.user_role, b_admin)
  on conflict (id) do update
    set email = excluded.email, full_name = excluded.full_name,
        role  = excluded.role,  admin_id  = excluded.admin_id;

  insert into public.agents (user_id, admin_id, agent_code, full_name, email, agent_status)
  values
    (null,    sa_id,   'VSL-SA1', 'VSL Platform Agent', 'vsl-sa1@example.invalid', 'active'),
    (a1_user, a_admin, 'VSL-A1',  'VSL Agent A1',       'vsl-a1@example.invalid',  'active'),
    (b1_user, b_admin, 'VSL-B1',  'VSL Agent B1',       'vsl-b1@example.invalid',  'active');

  select id into sa_agent from public.agents where agent_code = 'VSL-SA1';
  select id into a1_agent from public.agents where agent_code = 'VSL-A1';
  select id into b1_agent from public.agents where agent_code = 'VSL-B1';

  insert into public.leads (agent_id, full_name, phone, stage)
  values (a1_agent, 'VSL Agent Lead A1', '+254700000011', 'qualified')
  returning id into a1_lead;

  insert into public.leads (agent_id, full_name, phone, stage)
  values (b1_agent, 'VSL Agent Lead B1', '+254700000012', 'contacted');

  raise notice 'seeded: SA=% A1=% B1=%', sa_agent, a1_agent, b1_agent;
  raise notice ' ';

  -- =========================================================================
  -- TEST 1 — The super administrator writes a lead of their OWN.
  --          Expected: accepted, with admin_id and created_by stamped from the
  --          session rather than from anything the client sent.
  -- =========================================================================
  claims := json_build_object('sub', sa_id::text, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';

  begin
    insert into public.leads (full_name, phone, stage, deal_value, expected_close_date)
    values ('VSL Platform Prospect', '+254700000020', 'proposal_sent', 2500000, current_date + 20)
    returning id, admin_id, created_by into sa_lead, owner, author;
  exception when others then
    sa_lead := null;
    raise notice 'insert failed: %', sqlerrm;
  end;

  execute 'reset role';
  checks_run := checks_run + 1;
  if sa_lead is not null and owner = sa_id and author = sa_id then
    raise notice 'PASS  Test 1  Super admin created an own lead, stamped admin_id + created_by';
  else
    failures := failures || format('Test 1: own-lead insert failed or mis-stamped (id=%s owner=%s author=%s)',
                                   sa_lead, owner, author);
    raise notice 'FAIL  Test 1  own-lead insert id=% owner=% author=%', sa_lead, owner, author;
  end if;

  -- =========================================================================
  -- TEST 2 — The tenant key cannot be chosen by the caller.
  --          A super admin naming Company A as the owner must still get their
  --          own tenant: admin_id is derived by trigger, never trusted.
  -- =========================================================================
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';

  owner := null;
  begin
    insert into public.leads (admin_id, full_name, phone, stage)
    values (a_admin, 'VSL Forged Tenant', '+254700000021', 'new_lead')
    returning admin_id into owner;
  exception when others then
    owner := '00000000-0000-4000-8000-0000000000ff';   -- rejected outright
  end;

  execute 'reset role';
  checks_run := checks_run + 1;
  if owner is distinct from a_admin then
    raise notice 'PASS  Test 2  A supplied admin_id is overwritten or rejected (got %)', owner;
  else
    failures := failures || 'Test 2: caller-supplied admin_id was honoured -- cross-tenant write'::text;
    raise notice 'FAIL  Test 2  caller-supplied admin_id was honoured';
  end if;

  -- =========================================================================
  -- TEST 3 — The super administrator reads their own lead back.
  -- =========================================================================
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';
  select count(*) into n from public.leads where id = sa_lead;
  execute 'reset role';

  checks_run := checks_run + 1;
  if n = 1 then
    raise notice 'PASS  Test 3  Super admin reads their own lead';
  else
    failures := failures || format('Test 3: super admin read %s rows for their own lead, expected 1', n);
    raise notice 'FAIL  Test 3  super admin read % rows for their own lead', n;
  end if;

  -- =========================================================================
  -- TEST 4 — THE BOUNDARY THAT MUST NOT MOVE.
  --          A supervisor may WATCH an agent's lead and must not edit it.
  --          Company A's admin owns agent A1, so this is the strongest case:
  --          the row is inside their own tenant and still not theirs to write.
  -- =========================================================================
  perform set_config('request.jwt.claims',
                     json_build_object('sub', a_admin::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  update public.leads set stage = 'closed' where id = a1_lead;
  get diagnostics n = row_count;

  execute 'reset role';
  checks_run := checks_run + 1;
  if n = 0 then
    raise notice 'PASS  Test 4  Admin cannot edit their own agent lead (oversight stays read-only)';
  else
    failures := failures || 'Test 4: admin UPDATED an agent lead -- read-only oversight is broken'::text;
    raise notice 'FAIL  Test 4  admin updated % agent lead row(s)', n;
  end if;

  -- =========================================================================
  -- TEST 5 — Same boundary on DELETE.
  -- =========================================================================
  perform set_config('request.jwt.claims',
                     json_build_object('sub', a_admin::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  delete from public.leads where id = a1_lead;
  get diagnostics n = row_count;

  execute 'reset role';
  checks_run := checks_run + 1;
  if n = 0 then
    raise notice 'PASS  Test 5  Admin cannot delete an agent lead';
  else
    failures := failures || 'Test 5: admin DELETED an agent lead'::text;
    raise notice 'FAIL  Test 5  admin deleted % agent lead row(s)', n;
  end if;

  -- =========================================================================
  -- TEST 6 — Another tenant's admin cannot see the super admin's own lead.
  --          The row has no agent_id, so it can only be reached through the
  --          admin_id disjunct -- exactly the clause under test.
  -- =========================================================================
  perform set_config('request.jwt.claims',
                     json_build_object('sub', b_admin::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.leads where id = sa_lead;
  execute 'reset role';

  checks_run := checks_run + 1;
  if n = 0 then
    raise notice 'PASS  Test 6  Company B admin cannot see the platform own lead';
  else
    failures := failures || format('Test 6: Company B admin saw %s of the super admin own lead(s)', n);
    raise notice 'FAIL  Test 6  Company B admin saw % platform lead row(s)', n;
  end if;

  -- =========================================================================
  -- TEST 7 — A sales agent cannot read or write a supervisor's own lead.
  --          is_crm_supervisor() excludes sales_agent by design, and the agent
  --          policies compare against their own agent id, which is not NULL.
  -- =========================================================================
  perform set_config('request.jwt.claims',
                     json_build_object('sub', a1_user::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.leads where id = sa_lead;

  -- Both halves, because invisibility and immutability are separate policies:
  -- a read policy alone would not stop a blind UPDATE by a known id.
  update public.leads set stage = 'closed' where id = sa_lead;
  get diagnostics m = row_count;
  n := n + m;

  execute 'reset role';
  checks_run := checks_run + 1;
  if n = 0 then
    raise notice 'PASS  Test 7  Sales agent can neither see nor write a supervisor own lead';
  else
    failures := failures || format('Test 7: sales agent reached %s supervisor-owned lead row(s)', n);
    raise notice 'FAIL  Test 7  sales agent reached % supervisor-owned lead row(s)', n;
  end if;

  -- =========================================================================
  -- TEST 8 — An agent cannot create a tenant-owned lead either.
  --          Their insert policy compares agent_id against their own agent id;
  --          NULL = uuid is NULL, which is not true, so this must be refused.
  -- =========================================================================
  perform set_config('request.jwt.claims',
                     json_build_object('sub', a1_user::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  n := 0;
  begin
    insert into public.leads (full_name, phone, stage)
    values ('VSL Agent Forged Tenant Lead', '+254700000022', 'new_lead');
    n := 1;
  exception when others then
    n := 0;
  end;

  execute 'reset role';
  checks_run := checks_run + 1;
  if n = 0 then
    raise notice 'PASS  Test 8  Sales agent cannot create a tenant-owned lead';
  else
    failures := failures || 'Test 8: sales agent CREATED a tenant-owned lead'::text;
    raise notice 'FAIL  Test 8  sales agent created a tenant-owned lead';
  end if;

  -- =========================================================================
  -- TEST 9 — The super administrator corrects and then removes their own lead.
  --          Both halves matter: a pipeline you can write and not fix is worse
  --          than no pipeline, and a row nobody can delete is a leak.
  -- =========================================================================
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';

  update public.leads set deal_value = 3100000, win_probability = 75 where id = sa_lead;
  get diagnostics n = row_count;

  execute 'reset role';
  checks_run := checks_run + 1;
  if n = 1 then
    raise notice 'PASS  Test 9a Super admin corrects their own lead';
  else
    failures := failures || format('Test 9a: own-lead update touched %s rows, expected 1', n);
    raise notice 'FAIL  Test 9a own-lead update touched % rows', n;
  end if;

  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';
  delete from public.leads where id = sa_lead;
  get diagnostics n = row_count;
  execute 'reset role';

  checks_run := checks_run + 1;
  if n = 1 then
    raise notice 'PASS  Test 9b Super admin removes their own lead';
  else
    failures := failures || format('Test 9b: own-lead delete touched %s rows, expected 1', n);
    raise notice 'FAIL  Test 9b own-lead delete touched % rows', n;
  end if;

  -- =========================================================================
  -- TEST 10 — Oversight is unchanged: the super admin still reads the leads of
  --           the agents they own, and still not another tenant's.
  -- =========================================================================
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';
  select count(*) into n from public.leads where agent_id = b1_agent;
  execute 'reset role';

  checks_run := checks_run + 1;
  if n = 0 then
    raise notice 'PASS  Test 10 Super admin still cannot read another tenant agent leads';
  else
    failures := failures || format('Test 10: super admin read %s Company B agent lead(s)', n);
    raise notice 'FAIL  Test 10 super admin read % Company B agent lead(s)', n;
  end if;

  -- =========================================================================
  -- TEST 11 — A lead owned by nobody is impossible.
  --           leads_owner_present is what stops a row that is readable by no
  --           tenant, counted in nothing and undeletable through RLS.
  -- =========================================================================
  -- '{}' and not '': auth.uid() casts this setting to json, and an empty
  -- string is not valid json. An empty OBJECT has no 'sub', so auth.uid() is
  -- NULL -- which is what a service_role or direct-SQL write looks like, and
  -- the only case in which the trigger leaves admin_id unset.
  perform set_config('request.jwt.claims', '{}', true);

  n := 0;
  begin
    -- As the table owner, so only the CHECK constraint can stop this.
    insert into public.leads (agent_id, admin_id, full_name, stage)
    values (null, null, 'VSL Orphan Lead', 'new_lead');
    n := 1;
  exception when check_violation then
    n := 0;
  end;

  checks_run := checks_run + 1;
  if n = 0 then
    raise notice 'PASS  Test 11 A lead with no owner is rejected by leads_owner_present';
  else
    failures := failures || 'Test 11: an ownerless lead was accepted'::text;
    raise notice 'FAIL  Test 11 an ownerless lead was accepted';
  end if;

  -- =========================================================================
  -- VERDICT
  -- =========================================================================
  raise notice ' ';
  if array_length(failures, 1) is null then
    -- Deliberately an exception, not a notice. This is the ONLY exit from the
    -- block, so the seed is guaranteed to be unwound whatever the client's
    -- transaction settings are. Success is the message, not the exit code.
    raise exception 'ALL CHECKS PASSED — % scenarios verified. Seed rolled back (this error is intentional).',
                    checks_run;
  else
    raise exception E'SUPERVISOR-OWNED LEAD FAILURES (% of % checks):\n  - %',
                    array_length(failures, 1), checks_run,
                    array_to_string(failures, E'\n  - ');
  end if;

end
$verify$;

-- Belt and braces. The DO block above always raises, which alone unwinds the
-- seed; this rolls back the surrounding transaction for clients that opened one.
rollback;

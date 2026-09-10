-- ===========================================================================
-- WITHDRAWAL REVIEW (20260904120000) — LIVE VERIFICATION
--
-- Proves, against a real database, that the withdrawal review columns do what
-- the migration claims: a super admin can see and settle a request, an agent
-- cannot settle their own by any route, and an approver cannot alter the amount
-- they are approving.
--
-- Unit tests cannot check any of this. Every guarantee is an RLS policy, a
-- CHECK constraint or a trigger, and the only honest way to test those is to
-- become each role and try.
--
-- WHAT IS UNDER TEST
--
--   STRUCTURE   withdrawals land 'pending'; credits stay NULL; only the three
--               documented status values are accepted.
--   AUTHORITY   a super admin may read every wallet row and settle a
--               withdrawal. An agent may do neither -- not by UPDATE, and not
--               by posting a row that is already approved.
--   INTEGRITY   settling a request cannot change its amount, its owner or its
--               type.
--   REGRESSION  an agent still reads their own wallet and still cannot read
--               anybody else's.
--
-- HOW IT WORKS
--   1. Seeds one tenant: an owner, a platform super admin and two agents, with
--      a commission credit and a withdrawal for the first agent.
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
--   supabase db query --linked -f scripts/verify-agent-wallet-withdrawal-review.sql
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
  owner_user uuid := '00000000-0000-4000-8000-00000000e0a1';  -- tenant owner
  sa_user    uuid := '00000000-0000-4000-8000-00000000e0a2';  -- platform super admin
  a1_user    uuid := '00000000-0000-4000-8000-00000000e0a3';  -- agent 1
  a2_user    uuid := '00000000-0000-4000-8000-00000000e0a4';  -- agent 2

  a1_agent uuid;
  a2_agent uuid;

  wd_id     uuid;   -- the withdrawal under test
  credit_id uuid;   -- a commission credit, for the "not a decision" checks

  n          integer;
  got        text;
  got_ts     timestamptz;
  got_amount numeric;
  errtext    text;
  failures   text[] := '{}';
  checks_run integer := 0;

  sa_claims  text;
  a1_claims  text;
  a2_claims  text;
begin

  -- =========================================================================
  -- 0. PRECONDITION — has the migration actually run?
  --
  --    Checked first and loudly, because every assertion below would otherwise
  --    fail for the same uninteresting reason. This is also the exact check
  --    that failed in production: the columns were simply never there.
  -- =========================================================================
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'agent_wallets'
                    and column_name = 'status') then
    raise exception 'PRECONDITION FAILED: public.agent_wallets has no status column. '
                    'Migration 20260904120000_agent_wallet_withdrawal_review.sql has not been applied.';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'agent_wallets'
                    and column_name = 'reviewed_at') then
    raise exception 'PRECONDITION FAILED: public.agent_wallets has no reviewed_at column. '
                    'Migration 20260904120000_agent_wallet_withdrawal_review.sql has not been applied.';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'agent_wallets'
                    and column_name = 'reviewed_by') then
    raise exception 'PRECONDITION FAILED: public.agent_wallets has no reviewed_by column. '
                    'Migration 20260904120000_agent_wallet_withdrawal_review.sql has not been applied.';
  end if;

  -- =========================================================================
  -- 1. SEED
  -- =========================================================================
  raise notice '--- seeding (rolled back at the end) ---';

  insert into auth.users (id, email, instance_id, aud, role, created_at, updated_at)
  values
    (owner_user, 'vawr-owner@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (sa_user,    'vawr-sa@example.invalid',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (a1_user,    'vawr-a1@example.invalid',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (a2_user,    'vawr-a2@example.invalid',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

  -- Inserting into auth.users fires handle_new_user(), which creates the
  -- profile row first without admin_id or role -- hence UPSERT, not INSERT.
  -- admin_id NULL on the owner: current_admin_id() coalesces to their own uid.
  -- The super admin is deliberately NOT an agent; that is the whole reason the
  -- old self-only SELECT policy left their queue empty.
  insert into public.user_profiles (id, email, full_name, role, admin_id)
  values
    (owner_user, 'vawr-owner@example.invalid', 'VAWR Owner',       'admin'::public.user_role,       null),
    (sa_user,    'vawr-sa@example.invalid',    'VAWR Super Admin', 'super_admin'::public.user_role, null),
    (a1_user,    'vawr-a1@example.invalid',    'VAWR Agent 1',     'sales_agent'::public.user_role, owner_user),
    (a2_user,    'vawr-a2@example.invalid',    'VAWR Agent 2',     'sales_agent'::public.user_role, owner_user)
  on conflict (id) do update
    set role = excluded.role, admin_id = excluded.admin_id, full_name = excluded.full_name;

  insert into public.agents (user_id, admin_id, agent_code, full_name, email, agent_status)
  values
    (a1_user, owner_user, 'VAWR-A1', 'VAWR Agent 1', 'vawr-a1@example.invalid', 'active'),
    (a2_user, owner_user, 'VAWR-A2', 'VAWR Agent 2', 'vawr-a2@example.invalid', 'active');

  select id into a1_agent from public.agents where agent_code = 'VAWR-A1';
  select id into a2_agent from public.agents where agent_code = 'VAWR-A2';

  -- A commission credit. Seeded as the service role so the trigger, not a
  -- policy, is what we are observing.
  insert into public.agent_wallets (agent_id, total_earned, total_withdrawn, available_balance, tx_type, description)
  values (a1_agent, 50000, 0, 50000, 'credit'::public.wallet_tx_type, 'VAWR commission')
  returning id into credit_id;

  sa_claims := json_build_object('sub', sa_user::text, 'role', 'authenticated')::text;
  a1_claims := json_build_object('sub', a1_user::text, 'role', 'authenticated')::text;
  a2_claims := json_build_object('sub', a2_user::text, 'role', 'authenticated')::text;

  raise notice 'seeded: A1=% A2=% credit=%', a1_agent, a2_agent, credit_id;
  raise notice ' ';

  -- =========================================================================
  -- TEST 1 — An agent raising a withdrawal cannot pre-approve it.
  --
  --          The agent's own INSERT policy allows this row. The trigger is
  --          what refuses the status, which is why it overwrites rather than
  --          defaults. If this ever fails, agents can pay themselves.
  -- =========================================================================
  perform set_config('request.jwt.claims', a1_claims, true);
  execute 'set local role authenticated';

  begin
    insert into public.agent_wallets
      (agent_id, total_earned, total_withdrawn, available_balance, tx_type, description, status, reviewed_by, reviewed_at)
    values
      (a1_agent, 0, 20000, -20000, 'withdrawal'::public.wallet_tx_type, 'VAWR withdrawal',
       'approved', 'super_admin', now())
    returning id into wd_id;
    errtext := null;
  exception when others then
    wd_id := null; errtext := sqlerrm;
  end;

  execute 'reset role';

  select status, reviewed_at into got, got_ts
    from public.agent_wallets where id = wd_id;

  checks_run := checks_run + 1;
  if wd_id is not null and got = 'pending' and got_ts is null then
    raise notice 'PASS  Test 1  an agent-supplied status is overwritten with pending';
  else
    failures := failures || format('Test 1: withdrawal landed status=%s reviewed_at=%s (err: %s)',
                                   coalesce(got, '<null>'), coalesce(got_ts::text, '<null>'),
                                   coalesce(errtext, 'none'))::text;
    raise notice 'FAIL  Test 1  status=% reviewed_at=%', coalesce(got, '<null>'), coalesce(got_ts::text, '<null>');
  end if;

  -- =========================================================================
  -- TEST 2 — A credit is not a decision, so it carries no status.
  -- =========================================================================
  select status into got from public.agent_wallets where id = credit_id;

  checks_run := checks_run + 1;
  if got is null then
    raise notice 'PASS  Test 2  a credit row keeps status NULL';
  else
    failures := failures || format('Test 2: credit row has status=%s, expected NULL', got)::text;
    raise notice 'FAIL  Test 2  credit row has status=%', got;
  end if;

  -- =========================================================================
  -- TEST 3 — An agent cannot settle their own request.
  --
  --          There is deliberately no agent UPDATE policy. RLS makes the row
  --          invisible to the UPDATE rather than raising, so the tell is
  --          zero rows affected -- which is exactly how the app's own approve
  --          call would silently "succeed" if this were ever granted.
  -- =========================================================================
  perform set_config('request.jwt.claims', a1_claims, true);
  execute 'set local role authenticated';

  begin
    update public.agent_wallets set status = 'approved' where id = wd_id;
    get diagnostics n = row_count;
    errtext := null;
  exception when others then
    n := -1; errtext := sqlerrm;
  end;

  execute 'reset role';
  select status into got from public.agent_wallets where id = wd_id;

  checks_run := checks_run + 1;
  if n <= 0 and got = 'pending' then
    raise notice 'PASS  Test 3  an agent cannot approve their own withdrawal';
  else
    failures := failures || format('Test 3: agent update affected %s row(s), status now %s', n, got)::text;
    raise notice 'FAIL  Test 3  rows=% status=%', n, got;
  end if;

  -- =========================================================================
  -- TEST 4 — A super admin can SEE the queue.
  --
  --          This is the half that made the whole feature look empty rather
  --          than broken: before the migration the only read policy was
  --          self-only, and a super admin has no agents row to match.
  -- =========================================================================
  perform set_config('request.jwt.claims', sa_claims, true);
  execute 'set local role authenticated';

  select count(*) into n from public.agent_wallets
   where tx_type = 'withdrawal'::public.wallet_tx_type and id = wd_id;

  execute 'reset role';

  checks_run := checks_run + 1;
  if n = 1 then
    raise notice 'PASS  Test 4  a super admin reads a withdrawal they do not own';
  else
    failures := failures || format('Test 4: super admin saw %s of 1 withdrawal', n)::text;
    raise notice 'FAIL  Test 4  super admin saw % of 1', n;
  end if;

  -- =========================================================================
  -- TEST 5 — A super admin can settle it, and the decision sticks.
  --
  --          This is the exact statement the app issues; it is the one that
  --          has been throwing 42703 in production.
  -- =========================================================================
  perform set_config('request.jwt.claims', sa_claims, true);
  execute 'set local role authenticated';

  begin
    update public.agent_wallets
       set status = 'approved', reviewed_at = now(), reviewed_by = 'super_admin'
     where id = wd_id;
    get diagnostics n = row_count;
    errtext := null;
  exception when others then
    n := -1; errtext := sqlerrm;
  end;

  execute 'reset role';
  select status, reviewed_at into got, got_ts from public.agent_wallets where id = wd_id;

  checks_run := checks_run + 1;
  if n = 1 and got = 'approved' and got_ts is not null then
    raise notice 'PASS  Test 5  a super admin approves, and it persists';
  else
    failures := failures || format('Test 5: rows=%s status=%s reviewed_at=%s (err: %s)',
                                   n, coalesce(got, '<null>'), coalesce(got_ts::text, '<null>'),
                                   coalesce(errtext, 'none'))::text;
    raise notice 'FAIL  Test 5  rows=% status=% (err: %)', n, coalesce(got, '<null>'), coalesce(errtext, 'none');
  end if;

  -- =========================================================================
  -- TEST 6 — An approver cannot rewrite the amount.
  --
  --          RLS cannot restrict columns, so the same grant that lets someone
  --          approve KES 20,000 would let them make it KES 200,000 first. The
  --          freeze trigger is what stops that, and the audit entry would
  --          otherwise have recorded the inflated figure as approved.
  -- =========================================================================
  perform set_config('request.jwt.claims', sa_claims, true);
  execute 'set local role authenticated';

  begin
    update public.agent_wallets set total_withdrawn = 200000 where id = wd_id;
    errtext := null;
  exception when others then
    errtext := sqlerrm;
  end;

  execute 'reset role';
  select total_withdrawn into got_amount from public.agent_wallets where id = wd_id;

  checks_run := checks_run + 1;
  if errtext is not null and got_amount = 20000 then
    raise notice 'PASS  Test 6  the approved amount is immutable';
  else
    failures := failures || format('Test 6: amount is now %s, error was %s',
                                   got_amount, coalesce(errtext, 'none'))::text;
    raise notice 'FAIL  Test 6  amount=% err=%', got_amount, coalesce(errtext, 'none');
  end if;

  -- =========================================================================
  -- TEST 7 — The update grant does not extend to credit rows.
  --
  --          A commission credit is a ledger entry, not a decision. Nothing in
  --          the product updates one, so nothing should be able to.
  -- =========================================================================
  perform set_config('request.jwt.claims', sa_claims, true);
  execute 'set local role authenticated';

  begin
    update public.agent_wallets set description = 'tampered' where id = credit_id;
    get diagnostics n = row_count;
    errtext := null;
  exception when others then
    n := -1; errtext := sqlerrm;
  end;

  execute 'reset role';
  select description into got from public.agent_wallets where id = credit_id;

  checks_run := checks_run + 1;
  if n <= 0 and got = 'VAWR commission' then
    raise notice 'PASS  Test 7  a credit row cannot be updated through the review grant';
  else
    failures := failures || format('Test 7: credit update affected %s row(s), description now %s', n, got)::text;
    raise notice 'FAIL  Test 7  rows=% description=%', n, got;
  end if;

  -- =========================================================================
  -- TEST 8 — Only the three documented states are accepted.
  -- =========================================================================
  perform set_config('request.jwt.claims', sa_claims, true);
  execute 'set local role authenticated';

  begin
    update public.agent_wallets set status = 'paid' where id = wd_id;
    errtext := null;
  exception when others then
    errtext := sqlerrm;
  end;

  execute 'reset role';
  select status into got from public.agent_wallets where id = wd_id;

  checks_run := checks_run + 1;
  if errtext is not null and got = 'approved' then
    raise notice 'PASS  Test 8  an undocumented status is refused';
  else
    failures := failures || format('Test 8: status is now %s, error was %s',
                                   coalesce(got, '<null>'), coalesce(errtext, 'none'))::text;
    raise notice 'FAIL  Test 8  status=% err=%', coalesce(got, '<null>'), coalesce(errtext, 'none');
  end if;

  -- =========================================================================
  -- TEST 9 — REGRESSION: the new read policy did not open the wallet up.
  --
  --          `super_admin_reads_all_wallets` is an ADDITIONAL permissive
  --          policy, and permissive policies OR together. If it were ever
  --          written without the is_global_viewer() guard, every agent would
  --          read every other agent's commission.
  -- =========================================================================
  perform set_config('request.jwt.claims', a2_claims, true);
  execute 'set local role authenticated';

  select count(*) into n from public.agent_wallets where agent_id = a1_agent;

  execute 'reset role';

  checks_run := checks_run + 1;
  if n = 0 then
    raise notice 'PASS  Test 9  an agent still cannot read another agent''s wallet';
  else
    failures := failures || format('Test 9: agent 2 read %s of agent 1''s wallet rows', n)::text;
    raise notice 'FAIL  Test 9  agent 2 read % rows', n;
  end if;

  -- =========================================================================
  -- TEST 10 — REGRESSION: an agent still reads their OWN wallet.
  -- =========================================================================
  perform set_config('request.jwt.claims', a1_claims, true);
  execute 'set local role authenticated';

  select count(*) into n from public.agent_wallets where agent_id = a1_agent;

  execute 'reset role';

  checks_run := checks_run + 1;
  if n = 2 then
    raise notice 'PASS  Test 10 an agent still reads their own wallet in full';
  else
    failures := failures || format('Test 10: agent 1 read %s of their own 2 rows', n)::text;
    raise notice 'FAIL  Test 10 agent 1 read % of 2 rows', n;
  end if;

  -- =========================================================================
  -- VERDICT
  --
  -- Always raises. On success the message begins ALL CHECKS PASSED; either way
  -- the exception is what discards the seed.
  -- =========================================================================
  raise notice ' ';
  if array_length(failures, 1) is null then
    raise exception 'ALL CHECKS PASSED — % checks verified. Seed rolled back (this error is intentional).',
                    checks_run;
  else
    raise exception E'WITHDRAWAL REVIEW FAILURES (% of % checks):\n  - %',
                    array_length(failures, 1), checks_run,
                    array_to_string(failures, E'\n  - ');
  end if;
end;
$verify$;

rollback;

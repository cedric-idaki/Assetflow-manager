-- ===========================================================================
-- CLIENT INSTALLATION & ONBOARDING TRACKING (20260901180000) — LIVE VERIFICATION
--
-- Proves, against a real database, that the record of an installation cannot be
-- left saying something untrue, and that a client can read their own progress
-- without being able to declare it finished. Unit tests cannot do this: every
-- guarantee below is a trigger or an RLS policy, and the only honest way to
-- test those is to become each role and try.
--
-- What is under test:
--
--   SEEDING     every tenant gets exactly one record and the full checklist,
--               created by the database and not by the registration screen.
--   COUNTERS    steps_done / steps_total / progress_pct follow the checklist,
--               and a "not needed" step leaves BOTH sides of the fraction.
--   STAMPS      assignment, start, completion and the installation date are
--               written by the database; re-opening a record clears the
--               completion rather than leaving a date that is no longer true.
--   SCOPE       a super admin writes any record; a tenant READS ONLY ITS OWN
--               and can write none of it; another tenant sees nothing at all.
--
-- HOW IT WORKS
--   1. Seeds a super admin and two tenant admins. The user_profiles step is an
--      UPSERT because inserting into auth.users fires handle_new_user(), which
--      creates the profile row first (without admin_id or role).
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
--   supabase db query --linked -f scripts/verify-client-onboarding.sql
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
  sa_id    uuid := '00000000-0000-4000-8000-00000000e0aa';  -- super admin
  a_admin  uuid := '00000000-0000-4000-8000-00000000e0a1';  -- Company A admin
  b_admin  uuid := '00000000-0000-4000-8000-00000000e0b1';  -- Company B admin
  a_staff  uuid := '00000000-0000-4000-8000-00000000e0a2';  -- Company A's own staff

  ob_a     uuid;   -- Company A's onboarding record
  ob_b     uuid;   -- Company B's
  st_id    uuid;   -- one step of Company A's checklist
  st_two   uuid;

  n          integer;
  m          integer;
  k          integer;
  d          date;
  ts         timestamptz;
  who        uuid;
  txt        text;
  txt2       text;
  want       text;
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
  if to_regclass('public.client_onboardings') is null then
    raise exception 'PRECONDITION FAILED: public.client_onboardings does not exist. '
                    'Migration 20260901180000_client_onboarding_tracking.sql has not been applied.';
  end if;

  if to_regprocedure('public.client_onboarding_board(text,uuid,text,integer,integer)') is null then
    raise exception 'PRECONDITION FAILED: client_onboarding_board() is missing. '
                    'Migration 20260901180000_client_onboarding_tracking.sql is only half applied.';
  end if;

  -- =========================================================================
  -- 1. SEED
  -- =========================================================================
  raise notice '--- seeding (rolled back at the end) ---';

  insert into auth.users (id, email, instance_id, aud, role, created_at, updated_at)
  values
    (sa_id,   'vco-sa@example.invalid',      '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (a_admin, 'vco-a-admin@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (b_admin, 'vco-b-admin@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (a_staff, 'vco-a-staff@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

  -- admin_id NULL on a tenant owner: current_admin_id() coalesces to their own
  -- uid, which is what makes an owner the root of their own tenant. This UPSERT
  -- is also what fires client_onboarding_seed_tenant.
  insert into public.user_profiles (id, email, full_name, role, admin_id)
  values
    (sa_id,   'vco-sa@example.invalid',      'VCO SuperAdmin', 'super_admin'::public.user_role, null),
    (a_admin, 'vco-a-admin@example.invalid', 'VCO Admin A',    'admin'::public.user_role,       null),
    (b_admin, 'vco-b-admin@example.invalid', 'VCO Admin B',    'admin'::public.user_role,       null),
    (a_staff, 'vco-a-staff@example.invalid', 'VCO Staff A',    'manager'::public.user_role,     a_admin)
  on conflict (id) do update
    set email = excluded.email, full_name = excluded.full_name,
        role  = excluded.role,  admin_id  = excluded.admin_id;

  select id into ob_a from public.client_onboardings where admin_id = a_admin;
  select id into ob_b from public.client_onboardings where admin_id = b_admin;

  raise notice 'seeded: A=% B=%', ob_a, ob_b;
  raise notice ' ';

  -- =========================================================================
  -- TEST 1 — Registering a tenant creates its onboarding record, with the whole
  --          checklist on it. The registration screen never asks for this; the
  --          trigger is the only reason it is there.
  -- =========================================================================
  checks_run := checks_run + 1;
  select count(*) into n from public.client_onboarding_steps where onboarding_id = ob_a;
  select count(*) into m from public.client_onboarding_default_steps();

  if ob_a is not null and ob_b is not null and n = m and m >= 11 then
    raise notice 'PASS  Test 1  a new tenant gets one record and all % steps', m;
  else
    failures := failures || format('Test 1: record=%s steps=%s of %s', ob_a, n, m);
    raise notice 'FAIL  Test 1  record=% steps=% of %', ob_a, n, m;
  end if;

  -- =========================================================================
  -- TEST 2 — A tenant is onboarded ONCE. Re-running the seeder must not create
  --          a second record or duplicate the checklist — the backfill and the
  --          trigger both call it, and a tenant edited twice would otherwise
  --          collect twenty-two steps.
  -- =========================================================================
  perform public.client_onboarding_ensure(a_admin);
  perform public.client_onboarding_ensure(a_admin);

  checks_run := checks_run + 1;
  select count(*) into n from public.client_onboardings where admin_id = a_admin;
  select count(*) into m from public.client_onboarding_steps where onboarding_id = ob_a;

  if n = 1 and m = (select count(*) from public.client_onboarding_default_steps()) then
    raise notice 'PASS  Test 2  seeding is idempotent (1 record, % steps)', m;
  else
    failures := failures || format('Test 2: %s records, %s steps after re-seeding', n, m);
    raise notice 'FAIL  Test 2  % records, % steps after re-seeding', n, m;
  end if;

  -- =========================================================================
  -- TEST 3 — Ticking a step moves the counters, and moves a record that still
  --          claims 'not_started' to 'in_progress'. A checklist half ticked on
  --          a record saying nothing has begun is the commonest way a board
  --          like this goes stale.
  -- =========================================================================
  select id into st_id from public.client_onboarding_steps
   where onboarding_id = ob_a and step_key = 'kickoff_call';

  update public.client_onboarding_steps set status = 'done' where id = st_id;

  checks_run := checks_run + 1;
  select steps_done, steps_total, status into n, m, txt
    from public.client_onboardings where id = ob_a;

  if n = 1 and txt = 'in_progress' then
    raise notice 'PASS  Test 3  one step done -> steps_done=1, status=in_progress';
  else
    failures := failures || format('Test 3: steps_done=%s status=%s', n, txt);
    raise notice 'FAIL  Test 3  steps_done=% total=% status=%', n, m, txt;
  end if;

  -- =========================================================================
  -- TEST 4 — Ticking a step stamps WHO said so and WHEN. A completion date
  --          nobody's name is against is not evidence of anything.
  -- =========================================================================
  checks_run := checks_run + 1;
  select completed_at into ts from public.client_onboarding_steps where id = st_id;

  if ts is not null then
    raise notice 'PASS  Test 4  a completed step carries its own timestamp';
  else
    failures := failures || 'Test 4: a step marked done has no completed_at';
    raise notice 'FAIL  Test 4  a step marked done has no completed_at';
  end if;

  -- =========================================================================
  -- TEST 5 — Un-ticking a step drops the stamp with it, so a re-opened step
  --          cannot keep reporting a date the work was not finished on.
  -- =========================================================================
  update public.client_onboarding_steps set status = 'in_progress' where id = st_id;

  checks_run := checks_run + 1;
  select completed_at into ts from public.client_onboarding_steps where id = st_id;
  select steps_done into n from public.client_onboardings where id = ob_a;

  if ts is null and n = 0 then
    raise notice 'PASS  Test 5  re-opening a step clears its stamp and the count';
  else
    failures := failures || format('Test 5: completed_at=%s steps_done=%s', ts, n);
    raise notice 'FAIL  Test 5  completed_at=% steps_done=%', ts, n;
  end if;

  -- =========================================================================
  -- TEST 6 — "Not needed" leaves BOTH sides of the fraction.
  --
  --          A step that does not apply to this client (no data to migrate, no
  --          till number) must not hold the progress bar below 100%, and must
  --          not be reported as work performed either.
  -- =========================================================================
  select steps_total into m from public.client_onboardings where id = ob_a;

  select id into st_two from public.client_onboarding_steps
   where onboarding_id = ob_a and step_key = 'data_migration';
  update public.client_onboarding_steps set status = 'skipped' where id = st_two;

  checks_run := checks_run + 1;
  select steps_total, steps_done into n, k from public.client_onboardings where id = ob_a;

  if n = m - 1 then
    raise notice 'PASS  Test 6  a skipped step leaves the total (% -> %)', m, n;
  else
    failures := failures || format('Test 6: steps_total went %s -> %s, expected %s', m, n, m - 1);
    raise notice 'FAIL  Test 6  steps_total went % -> %, expected %', m, n, m - 1;
  end if;

  -- =========================================================================
  -- TEST 7 — progress_pct is derived, not stored. Nothing can write a
  --          percentage that disagrees with the checklist it came from.
  -- =========================================================================
  update public.client_onboarding_steps
     set status = 'done'
   where onboarding_id = ob_a and status not in ('done', 'skipped');

  checks_run := checks_run + 1;
  select progress_pct, steps_done, steps_total into n, m, k
    from public.client_onboardings where id = ob_a;

  if n = 100 then
    raise notice 'PASS  Test 7  every applicable step done reads 100%%';
  else
    failures := failures || format('Test 7: progress_pct=%s with %s/%s done', n, m, k);
    raise notice 'FAIL  Test 7  progress_pct=% with %/% done', n, m, k;
  end if;

  -- =========================================================================
  -- TEST 8 — A full checklist does NOT complete the record.
  --
  --          Sign-off is the moment the platform stops owing the client
  --          something. It is a person's decision, and the database must never
  --          make it on their behalf.
  -- =========================================================================
  checks_run := checks_run + 1;
  select status into txt from public.client_onboardings where id = ob_a;

  if txt <> 'completed' then
    raise notice 'PASS  Test 8  a 100%% checklist does not self-complete (status=%)', txt;
  else
    failures := failures || 'Test 8: the record completed itself when the checklist filled up';
    raise notice 'FAIL  Test 8  the record completed itself';
  end if;

  -- =========================================================================
  -- TEST 9 — Naming the responsible person stamps when, and by whom. As the
  --          super admin, which is the only role RLS lets write this.
  -- =========================================================================
  claims := json_build_object('sub', sa_id::text, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';

  n := 0;
  begin
    update public.client_onboardings
       set assigned_to = sa_id, scheduled_date = current_date - 2
     where id = ob_a;
    get diagnostics n = row_count;
  exception when insufficient_privilege then
    n := 0;
  end;

  execute 'reset role';

  checks_run := checks_run + 1;
  select assigned_at, assigned_by into ts, who from public.client_onboardings where id = ob_a;

  if n = 1 and ts is not null and who = sa_id then
    raise notice 'PASS  Test 9  assignment stamps assigned_at and assigned_by';
  else
    failures := failures || format('Test 9: rows=%s assigned_at=%s assigned_by=%s', n, ts, who);
    raise notice 'FAIL  Test 9  rows=% assigned_at=% assigned_by=%', n, ts, who;
  end if;

  -- =========================================================================
  -- TEST 10 — Taking the name off clears the stamps with it. Leaving them
  --           behind would report an unassigned job as owned since March.
  -- =========================================================================
  update public.client_onboardings set assigned_to = null where id = ob_a;

  checks_run := checks_run + 1;
  select assigned_at, assigned_by into ts, who from public.client_onboardings where id = ob_a;

  if ts is null and who is null then
    raise notice 'PASS  Test 10 unassigning clears assigned_at and assigned_by';
  else
    failures := failures || format('Test 10: assigned_at=%s assigned_by=%s survived', ts, who);
    raise notice 'FAIL  Test 10 assigned_at=% assigned_by=% survived', ts, who;
  end if;

  -- =========================================================================
  -- TEST 11 — Completing stamps the date, the person, AND fills in the
  --           installation date from the day the client was booked for.
  --
  --           Sign-off is routinely a few days after the visit, and the booked
  --           date is the one the client's paperwork carries.
  -- =========================================================================
  claims := json_build_object('sub', sa_id::text, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';

  update public.client_onboardings set status = 'completed' where id = ob_a;

  execute 'reset role';

  checks_run := checks_run + 1;
  select completed_at, completed_by, installation_date
    into ts, who, d
    from public.client_onboardings where id = ob_a;

  if ts is not null and who = sa_id and d = current_date - 2 then
    raise notice 'PASS  Test 11 completion stamps who, when, and the installed-on date';
  else
    failures := failures || format('Test 11: completed_at=%s by=%s installed=%s (expected %s)',
                                   ts, who, d, current_date - 2);
    raise notice 'FAIL  Test 11 completed_at=% by=% installed=% (expected %)',
                 ts, who, d, current_date - 2;
  end if;

  -- =========================================================================
  -- TEST 12 — Re-opening a completed record clears the completion.
  --
  --           A stale completion date is a lie that survives the correction —
  --           the same failure lost_at was fixed for on leads.
  -- =========================================================================
  update public.client_onboardings set status = 'in_progress' where id = ob_a;

  checks_run := checks_run + 1;
  select completed_at, completed_by into ts, who from public.client_onboardings where id = ob_a;

  if ts is null and who is null then
    raise notice 'PASS  Test 12 re-opening clears completed_at and completed_by';
  else
    failures := failures || format('Test 12: completed_at=%s by=%s survived a re-open', ts, who);
    raise notice 'FAIL  Test 12 completed_at=% by=% survived a re-open', ts, who;
  end if;

  -- =========================================================================
  -- TEST 13 — A hold reason only exists while the job is held.
  -- =========================================================================
  update public.client_onboardings
     set status = 'on_hold', on_hold_reason = 'VCO waiting on the client'
   where id = ob_a;

  select on_hold_reason into txt from public.client_onboardings where id = ob_a;

  update public.client_onboardings set status = 'in_progress' where id = ob_a;

  checks_run := checks_run + 1;
  if txt = 'VCO waiting on the client'
     and (select on_hold_reason from public.client_onboardings where id = ob_a) is null then
    raise notice 'PASS  Test 13 the hold reason is kept while held and cleared after';
  else
    failures := failures || 'Test 13: on_hold_reason did not follow the status';
    raise notice 'FAIL  Test 13 on_hold_reason did not follow the status';
  end if;

  -- =========================================================================
  -- TEST 14 — A tenant READS ITS OWN record. A client who paid for an
  --           installation may see where it has got to.
  -- =========================================================================
  claims := json_build_object('sub', a_admin::text, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';

  select count(*) into n from public.client_onboardings where id = ob_a;

  execute 'reset role';

  checks_run := checks_run + 1;
  if n = 1 then
    raise notice 'PASS  Test 14 a tenant can read its own onboarding record';
  else
    failures := failures || format('Test 14: the tenant read %s of its own records', n);
    raise notice 'FAIL  Test 14 the tenant read % of its own records', n;
  end if;

  -- =========================================================================
  -- TEST 15 — A tenant's own STAFF read it too, and see the checklist. The
  --           people doing the work at the client's end need to know what is
  --           waiting on them.
  -- =========================================================================
  claims := json_build_object('sub', a_staff::text, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';

  select count(*) into n from public.client_onboardings where id = ob_a;
  select count(*) into m from public.client_onboarding_steps where onboarding_id = ob_a;

  execute 'reset role';

  checks_run := checks_run + 1;
  if n = 1 and m > 0 then
    raise notice 'PASS  Test 15 the tenant''s staff read the record and its % steps', m;
  else
    failures := failures || format('Test 15: staff saw %s records and %s steps', n, m);
    raise notice 'FAIL  Test 15 staff saw % records and % steps', n, m;
  end if;

  -- =========================================================================
  -- TEST 16 — A tenant CANNOT WRITE ANY OF IT. An onboarding a client can mark
  --           complete is not evidence of anything.
  -- =========================================================================
  claims := json_build_object('sub', a_admin::text, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';

  n := 0;
  begin
    update public.client_onboardings set status = 'completed' where id = ob_a;
    get diagnostics n = row_count;
  exception when insufficient_privilege then
    n := 0;
  end;

  m := 0;
  begin
    update public.client_onboarding_steps set status = 'done'
     where onboarding_id = ob_a and step_key = 'training';
    get diagnostics m = row_count;
  exception when insufficient_privilege then
    m := 0;
  end;

  execute 'reset role';

  checks_run := checks_run + 1;
  if n = 0 and m = 0
     and (select status from public.client_onboardings where id = ob_a) <> 'completed' then
    raise notice 'PASS  Test 16 a tenant cannot complete its own onboarding';
  else
    failures := failures || format('Test 16: the tenant wrote %s records and %s steps', n, m);
    raise notice 'FAIL  Test 16 the tenant wrote % records and % steps', n, m;
  end if;

  -- =========================================================================
  -- TEST 17 — One tenant cannot see ANOTHER tenant's installation. What a
  --           competitor has bought, and whether the platform is late
  --           delivering it, is not theirs to read.
  -- =========================================================================
  claims := json_build_object('sub', a_admin::text, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';

  select count(*) into n from public.client_onboardings where id = ob_b;
  select count(*) into m from public.client_onboarding_steps where onboarding_id = ob_b;

  execute 'reset role';

  checks_run := checks_run + 1;
  if n = 0 and m = 0 then
    raise notice 'PASS  Test 17 a tenant sees nothing of another tenant''s onboarding';
  else
    failures := failures || format('Test 17: tenant A saw %s of B''s records and %s steps', n, m);
    raise notice 'FAIL  Test 17 tenant A saw % of B''s records and % steps', n, m;
  end if;

  -- =========================================================================
  -- TEST 18 — The board is scoped the same way the table is: a tenant's call
  --           returns its own row only, the super admin's returns both.
  --
  --           The board is SECURITY DEFINER, so this is the check that its
  --           explicit scope test matches the RLS policy beside it.
  -- =========================================================================
  claims := json_build_object('sub', a_admin::text, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';

  select count(*) into n from public.client_onboarding_board();
  select count(*) into m from public.client_onboarding_board()
   where admin_id = b_admin;

  execute 'reset role';

  checks_run := checks_run + 1;
  if n = 1 and m = 0 then
    raise notice 'PASS  Test 18 the board returns a tenant its own row and no other';
  else
    failures := failures || format('Test 18: the tenant''s board returned %s rows, %s of them B''s', n, m);
    raise notice 'FAIL  Test 18 the tenant''s board returned % rows, % of them B''s', n, m;
  end if;

  -- =========================================================================
  -- TEST 19 — The super admin's board carries the client's NAME and TYPE,
  --           resolved by joining rather than stored on the record. The name
  --           lives in company_profiles for a company and saccos for a society,
  --           and neither row exists when the trigger fires.
  -- =========================================================================
  -- company_profiles predates the local migration history and its NOT NULL set
  -- differs between databases, so the seed is best-effort: if it will not take,
  -- the coalesce falls through to the profile's own name and that is what is
  -- asserted. Either way the board must produce a name, never a blank cell.
  want := 'VCO Admin A';
  begin
    insert into public.company_profiles (admin_id, company_name, email)
    values (a_admin, 'VCO Kilimo Traders Ltd', 'vco-a-admin@example.invalid');
    want := 'VCO Kilimo Traders Ltd';
  exception when others then
    raise notice 'note: company_profiles seed skipped (%) — asserting the profile-name fallback', sqlerrm;
  end;

  claims := json_build_object('sub', sa_id::text, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';

  select client_name, entity_type into txt, txt2
    from public.client_onboarding_board() where admin_id = a_admin;

  select count(*) into n from public.client_onboarding_board();

  execute 'reset role';

  checks_run := checks_run + 1;
  if txt = want and txt2 = 'company' and n >= 2 then
    raise notice 'PASS  Test 19 the board names the client (%) and sees every tenant (% rows)', txt, n;
  else
    failures := failures || format('Test 19: name=%s (wanted %s) type=%s rows=%s', txt, want, txt2, n);
    raise notice 'FAIL  Test 19 name=% (wanted %) type=% rows=%', txt, want, txt2, n;
  end if;

  -- =========================================================================
  -- TEST 20 — The summary counts the WHOLE book for a super admin, and only
  --           its own row for a tenant. A total of somebody else's backlog is
  --           the one number a client must never be shown.
  -- =========================================================================
  claims := json_build_object('sub', a_admin::text, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';

  select total into n from public.client_onboarding_summary();

  execute 'reset role';

  claims := json_build_object('sub', sa_id::text, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', claims, true);
  execute 'set local role authenticated';

  select total into m from public.client_onboarding_summary();

  execute 'reset role';

  checks_run := checks_run + 1;
  if n = 1 and m >= 2 then
    raise notice 'PASS  Test 20 the summary is one row for a tenant and % for the platform', m;
  else
    failures := failures || format('Test 20: tenant total=%s platform total=%s', n, m);
    raise notice 'FAIL  Test 20 tenant total=% platform total=%', n, m;
  end if;

  -- =========================================================================
  -- TEST 21 — An unrecognised status cannot be written. The UI's vocabulary and
  --           the database's are two copies of one fact, and this is the half
  --           that cannot be talked round.
  -- =========================================================================
  n := 0;
  begin
    update public.client_onboardings set status = 'nearly_done' where id = ob_a;
    n := 1;
  exception when check_violation then
    n := 0;
  end;

  checks_run := checks_run + 1;
  if n = 0 then
    raise notice 'PASS  Test 21 an unknown status is refused by the CHECK constraint';
  else
    failures := failures || 'Test 21: an unknown status was accepted';
    raise notice 'FAIL  Test 21 an unknown status was accepted';
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
    raise exception E'CLIENT ONBOARDING FAILURES (% of % checks):\n  - %',
                    array_length(failures, 1), checks_run,
                    array_to_string(failures, E'\n  - ');
  end if;

end
$verify$;

-- Belt and braces. The DO block above always raises, which alone unwinds the
-- seed; this rolls back the surrounding transaction for clients that opened one.
rollback;

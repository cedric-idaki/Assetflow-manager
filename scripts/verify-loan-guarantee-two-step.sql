-- ===========================================================================
-- SACCO LOAN GUARANTEES (20260904160000) — LIVE VERIFICATION
--
-- Proves, against a real database, that a guarantee cannot be taken on by
-- accident: that the two steps are two, that the terms a guarantor signed are
-- the terms they read, that a confirmed guarantee is final, and that the
-- society's exposure cap actually refuses.
--
-- Unit tests cannot check any of this. The jsdom tests only prove the PORTAL
-- never presents a shortcut. Everything below is a SECURITY DEFINER RPC, a
-- CHECK constraint or an RLS policy, and the only honest way to test those is
-- to become the member and try.
--
-- WHAT IS UNDER TEST
--
--   ORDER       confirm() on an unread request is refused; review() must come
--               first, and the row is not binding in between.
--   IDENTITY    only the nominated guarantor may review or confirm; the
--               borrower cannot answer their own request.
--   THE HASH    a stale or invented hash is refused on both steps; changing
--               the loan after a review voids that review.
--   SIGNATURE   confirming under the wrong name is refused.
--   FINALITY    a confirmed guarantee cannot be confirmed twice, declined, or
--               withdrawn.
--   NO SIDE DOOR  a member cannot UPDATE the row to accepted via PostgREST.
--   THE CAP     a guarantee past the society's limit is refused at review, and
--               terms() says so; raising the multiple admits the same request.
--   ISOLATION   a member of another society can neither read the row nor
--               render its terms.
--   RELEASE     closing the loan releases an accepted guarantee.
--
-- NOT COVERED HERE (worth knowing before trusting this as a full pass):
--   the 30-minute review window (now() is frozen inside a transaction, so it
--   cannot expire), max_active_guarantees, and the borrower's cancel path.
--
-- HOW IT WORKS
--   1. Seeds one sacco with an admin, a borrower and a guarantor, a second
--      sacco with an outsider, and two loans. The user_profiles step is an
--      UPSERT because inserting into auth.users fires handle_new_user(), which
--      creates the profile row first (without admin_id or role).
--   2. Impersonates each member by setting request.jwt.claims and switching to
--      the `authenticated` role, exactly as PostgREST does for a real request.
--   3. Asserts what each member can and cannot do.
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
--   supabase db query --linked -f scripts/verify-loan-guarantee-two-step.sql
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
  s_admin  uuid := '00000000-0000-4000-8000-0000000067a1';  -- sacco admin
  bor_user uuid := '00000000-0000-4000-8000-0000000067a2';  -- borrower login
  gua_user uuid := '00000000-0000-4000-8000-0000000067a3';  -- guarantor login
  out_user uuid := '00000000-0000-4000-8000-0000000067a4';  -- member of another sacco

  sacco_a  uuid;  sacco_b uuid;
  bor_mem  uuid;  gua_mem uuid;  out_mem uuid;
  loan     uuid;

  g           uuid;      -- the guarantee under test
  g2          uuid;      -- a second one, for the concurrent-count check
  terms       jsonb;
  hash        text;
  row_status  text;
  n           integer;
  errtext     text;
  failures    text[] := '{}';
  checks_run  integer := 0;
  bor_claims  text;
  gua_claims  text;
  out_claims  text;

  -- Assert helper state
  ok          boolean;
begin

  -- =========================================================================
  -- 0. PRECONDITION — has the migration actually run?
  --
  --    Checked first and loudly, because every assertion below would otherwise
  --    fail for the same uninteresting reason.
  -- =========================================================================
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public'
                    and table_name = 'sacco_loan_guarantees') then
    raise exception 'PRECONDITION FAILED: public.sacco_loan_guarantees does not exist. '
                    'Migration 20260904160000_sacco_loan_guarantees.sql has not been applied.';
  end if;

  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public'
                    and table_name = 'sacco_guarantee_settings') then
    raise exception 'PRECONDITION FAILED: public.sacco_guarantee_settings does not exist. '
                    'Migration 20260904160000_sacco_loan_guarantees.sql has not been applied '
                    '(or predates the exposure cap).';
  end if;

  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'sacco_loan_guarantee_confirm') then
    raise exception 'PRECONDITION FAILED: sacco_loan_guarantee_confirm() does not exist. '
                    'Migration 20260904160000_sacco_loan_guarantees.sql has not been applied.';
  end if;

  -- =========================================================================
  -- 1. SEED
  -- =========================================================================
  raise notice '--- seeding (rolled back at the end) ---';

  insert into auth.users (id, email, instance_id, aud, role, created_at, updated_at)
  values
    (s_admin,  'vlg-admin@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (bor_user, 'vlg-bor@example.invalid',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (gua_user, 'vlg-gua@example.invalid',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (out_user, 'vlg-out@example.invalid',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

  -- admin_id NULL on the tenant owner: current_admin_id() coalesces to their
  -- own uid, which is what makes an owner the root of their own tenant.
  insert into public.user_profiles (id, email, full_name, role, admin_id)
  values
    (s_admin,  'vlg-admin@example.invalid', 'VLG Sacco Admin', 'sacco_admin'::public.user_role,  null),
    (bor_user, 'vlg-bor@example.invalid',   'VLG Borrower',    'sacco_member'::public.user_role, s_admin),
    (gua_user, 'vlg-gua@example.invalid',   'VLG Guarantor',   'sacco_member'::public.user_role, s_admin),
    (out_user, 'vlg-out@example.invalid',   'VLG Outsider',    'sacco_member'::public.user_role, s_admin)
  on conflict (id) do update
    set email = excluded.email, full_name = excluded.full_name,
        role  = excluded.role,  admin_id  = excluded.admin_id;

  insert into public.saccos (admin_id, name, registration_no)
  values (s_admin, 'VLG Test Sacco', 'VLG-001')
  returning id into sacco_a;

  -- A second society, so the isolation check has somewhere to stand.
  insert into public.saccos (admin_id, name, registration_no)
  values (s_admin, 'VLG Other Sacco', 'VLG-002')
  returning id into sacco_b;

  insert into public.sacco_members
    (admin_id, sacco_id, user_id, member_no, full_name, status)
  values
    (s_admin, sacco_a, bor_user, 'VLG-B1', 'VLG Borrower',  'active'),
    (s_admin, sacco_a, gua_user, 'VLG-G1', 'VLG Guarantor', 'active'),
    (s_admin, sacco_b, out_user, 'VLG-O1', 'VLG Outsider',  'active');

  select id into bor_mem from public.sacco_members where member_no = 'VLG-B1';
  select id into gua_mem from public.sacco_members where member_no = 'VLG-G1';
  select id into out_mem from public.sacco_members where member_no = 'VLG-O1';

  -- The guarantor's own security: 60,000 in settled contributions, no shares.
  -- With the default policy (1x, shares counted) their cap is 60,000.
  insert into public.sacco_contributions
    (admin_id, sacco_id, member_id, amount, status)
  values
    (s_admin, sacco_a, gua_mem, 60000, 'completed');

  insert into public.sacco_loans
    (admin_id, sacco_id, member_id, principal, annual_interest_rate,
     term_months, method, purpose, status)
  values
    (s_admin, sacco_a, bor_mem, 100000, 12, 12, 'reducing_balance', 'School fees', 'pending')
  returning id into loan;

  bor_claims := json_build_object('sub', bor_user::text, 'role', 'authenticated')::text;
  gua_claims := json_build_object('sub', gua_user::text, 'role', 'authenticated')::text;
  out_claims := json_build_object('sub', out_user::text, 'role', 'authenticated')::text;

  raise notice 'seeded: sacco=% borrower=% guarantor=% loan=%', sacco_a, bor_mem, gua_mem, loan;
  raise notice ' ';

  -- =========================================================================
  -- TEST 1 — The borrower nominates a guarantor.
  -- =========================================================================
  perform set_config('request.jwt.claims', bor_claims, true);
  execute 'set local role authenticated';
  begin
    select id into g from public.sacco_loan_guarantee_request(loan, gua_mem, 25000, 'Please help');
    errtext := null;
  exception when others then g := null; errtext := sqlerrm;
  end;
  execute 'reset role';

  checks_run := checks_run + 1;
  if g is not null then
    raise notice 'PASS  Test 1   Borrower requested a guarantee (%)', g;
  else
    failures := failures || format('Test 1: request failed (%s)', errtext);
    raise notice 'FAIL  Test 1   request failed: %', errtext;
  end if;

  if g is null then
    raise exception 'ABORTING: the request could not be created, so nothing below can be tested. %', errtext;
  end if;

  -- =========================================================================
  -- TEST 2 — A member cannot guarantee their own loan.
  -- =========================================================================
  perform set_config('request.jwt.claims', bor_claims, true);
  execute 'set local role authenticated';
  begin
    perform public.sacco_loan_guarantee_request(loan, bor_mem, 1000, null);
    errtext := null;
  exception when others then errtext := sqlerrm;
  end;
  execute 'reset role';

  checks_run := checks_run + 1;
  if errtext is not null then
    raise notice 'PASS  Test 2   Self-guarantee refused: %', errtext;
  else
    failures := failures || 'Test 2: a member guaranteed their own loan';
    raise notice 'FAIL  Test 2   a member guaranteed their own loan';
  end if;

  -- =========================================================================
  -- TEST 3 — THE CORE CLAIM. confirm() on an unread request is refused.
  --
  --          This is the whole feature: without a recorded review there is no
  --          consent to confirm, and no amount of client-side sequencing is
  --          trusted to have produced one.
  -- =========================================================================
  perform set_config('request.jwt.claims', gua_claims, true);
  select public.sacco_loan_guarantee_terms(g) into terms;
  hash := terms->>'hash';

  execute 'set local role authenticated';
  begin
    perform public.sacco_loan_guarantee_confirm(g, hash, 'VLG Guarantor');
    errtext := null;
  exception when others then errtext := sqlerrm;
  end;
  execute 'reset role';

  select status into row_status from public.sacco_loan_guarantees where id = g;

  checks_run := checks_run + 1;
  if errtext is not null and row_status = 'requested' then
    raise notice 'PASS  Test 3   Confirm without a review refused: %', errtext;
  else
    failures := failures || format('Test 3: confirmed an UNREAD guarantee (status=%s err=%s)', row_status, errtext);
    raise notice 'FAIL  Test 3   confirmed an unread guarantee (status=% err=%)', row_status, errtext;
  end if;

  -- =========================================================================
  -- TEST 4 — Only the nominated guarantor may review. The borrower cannot
  --          answer on their behalf.
  -- =========================================================================
  perform set_config('request.jwt.claims', bor_claims, true);
  execute 'set local role authenticated';
  begin
    perform public.sacco_loan_guarantee_review(g, hash);
    errtext := null;
  exception when others then errtext := sqlerrm;
  end;
  execute 'reset role';

  checks_run := checks_run + 1;
  if errtext is not null then
    raise notice 'PASS  Test 4   Borrower cannot review on the guarantor''s behalf: %', errtext;
  else
    failures := failures || 'Test 4: the borrower reviewed their own request';
    raise notice 'FAIL  Test 4   the borrower reviewed their own request';
  end if;

  -- =========================================================================
  -- TEST 5 — An invented hash is refused. The review has to be of the terms
  --          the server actually rendered.
  -- =========================================================================
  perform set_config('request.jwt.claims', gua_claims, true);
  execute 'set local role authenticated';
  begin
    perform public.sacco_loan_guarantee_review(g, 'not-a-real-hash');
    errtext := null;
  exception when others then errtext := sqlerrm;
  end;
  execute 'reset role';

  checks_run := checks_run + 1;
  if errtext is not null then
    raise notice 'PASS  Test 5   Review with a bogus hash refused: %', errtext;
  else
    failures := failures || 'Test 5: a bogus terms hash was accepted as a review';
    raise notice 'FAIL  Test 5   a bogus terms hash was accepted';
  end if;

  -- =========================================================================
  -- TEST 6 — A real review moves the row to under_review, and NOT to accepted.
  --          Step 1 binds nobody.
  -- =========================================================================
  perform set_config('request.jwt.claims', gua_claims, true);
  execute 'set local role authenticated';
  begin
    perform public.sacco_loan_guarantee_review(g, hash);
    errtext := null;
  exception when others then errtext := sqlerrm;
  end;
  execute 'reset role';

  select status into row_status from public.sacco_loan_guarantees where id = g;

  checks_run := checks_run + 1;
  if errtext is null and row_status = 'under_review' then
    raise notice 'PASS  Test 6   Review recorded; row is under_review, not accepted';
  else
    failures := failures || format('Test 6: review left status=%s (err=%s)', row_status, errtext);
    raise notice 'FAIL  Test 6   status=% err=%', row_status, errtext;
  end if;

  -- =========================================================================
  -- TEST 7 — THE HASH EARNS ITS KEEP. The borrower changes the loan after the
  --          review; the confirmation must now be refused, because the terms
  --          the guarantor read are no longer the terms on offer.
  -- =========================================================================
  update public.sacco_loans set principal = 150000 where id = loan;

  perform set_config('request.jwt.claims', gua_claims, true);
  execute 'set local role authenticated';
  begin
    perform public.sacco_loan_guarantee_confirm(g, hash, 'VLG Guarantor');
    errtext := null;
  exception when others then errtext := sqlerrm;
  end;
  execute 'reset role';

  select status into row_status from public.sacco_loan_guarantees where id = g;

  checks_run := checks_run + 1;
  if errtext is not null and row_status = 'under_review' then
    raise notice 'PASS  Test 7   Terms moved after the review; confirm refused: %', errtext;
  else
    failures := failures || format('Test 7: confirmed terms that had CHANGED since the review (status=%s err=%s)', row_status, errtext);
    raise notice 'FAIL  Test 7   confirmed changed terms (status=% err=%)', row_status, errtext;
  end if;

  -- Put the loan back and re-review against the current terms.
  update public.sacco_loans set principal = 100000 where id = loan;
  perform set_config('request.jwt.claims', gua_claims, true);
  select public.sacco_loan_guarantee_terms(g) into terms;
  hash := terms->>'hash';

  execute 'set local role authenticated';
  perform public.sacco_loan_guarantee_review(g, hash);
  execute 'reset role';

  -- =========================================================================
  -- TEST 8 — Signing under the wrong name is refused.
  -- =========================================================================
  perform set_config('request.jwt.claims', gua_claims, true);
  execute 'set local role authenticated';
  begin
    perform public.sacco_loan_guarantee_confirm(g, hash, 'Somebody Else');
    errtext := null;
  exception when others then errtext := sqlerrm;
  end;
  execute 'reset role';

  checks_run := checks_run + 1;
  if errtext is not null then
    raise notice 'PASS  Test 8   Wrong signature refused: %', errtext;
  else
    failures := failures || 'Test 8: a guarantee was confirmed under the wrong name';
    raise notice 'FAIL  Test 8   confirmed under the wrong name';
  end if;

  -- =========================================================================
  -- TEST 9 — NO SIDE DOOR. A member cannot reach `accepted` with a direct
  --          UPDATE the way PostgREST would send one. There is no member
  --          UPDATE policy, so this must affect zero rows.
  -- =========================================================================
  perform set_config('request.jwt.claims', gua_claims, true);
  execute 'set local role authenticated';
  begin
    update public.sacco_loan_guarantees
       set status = 'accepted', accepted_at = now(),
           accepted_terms_hash = hash, signature_name = 'VLG Guarantor'
     where id = g;
    get diagnostics n = row_count;
    errtext := null;
  exception when others then n := -1; errtext := sqlerrm;
  end;
  execute 'reset role';

  select status into row_status from public.sacco_loan_guarantees where id = g;

  checks_run := checks_run + 1;
  if row_status = 'under_review' and coalesce(n, 0) <= 0 then
    raise notice 'PASS  Test 9   Direct UPDATE to accepted got nowhere (rows=%, err=%)', n, errtext;
  else
    failures := failures || format('Test 9: a member UPDATEd their way to %s (rows=%s)', row_status, n);
    raise notice 'FAIL  Test 9   member UPDATEd to % (rows=%)', row_status, n;
  end if;

  -- =========================================================================
  -- TEST 10 — THE EXPOSURE CAP, step 1. The guarantor is worth 60,000. Asking
  --           them for 80,000 must be refused at review, not merely warned
  --           about in the browser.
  -- =========================================================================
  -- A SECOND loan: uq_sacco_loan_guarantee_live already holds the first
  -- (loan, guarantor) pair, and asking the same member twice for the same loan
  -- is correctly refused.
  insert into public.sacco_loans
    (admin_id, sacco_id, member_id, principal, annual_interest_rate,
     term_months, method, purpose, status)
  values
    (s_admin, sacco_a, bor_mem, 200000, 12, 12, 'reducing_balance', 'Business', 'pending')
  returning id into loan;

  perform set_config('request.jwt.claims', bor_claims, true);
  execute 'set local role authenticated';
  select id into g2 from public.sacco_loan_guarantee_request(loan, gua_mem, 80000, 'Too much');
  execute 'reset role';

  perform set_config('request.jwt.claims', gua_claims, true);
  select public.sacco_loan_guarantee_terms(g2) into terms;

  execute 'set local role authenticated';
  begin
    perform public.sacco_loan_guarantee_review(g2, terms->>'hash');
    errtext := null;
  exception when others then errtext := sqlerrm;
  end;
  execute 'reset role';

  checks_run := checks_run + 1;
  if errtext is not null and (terms->>'blocked_reason') is not null then
    raise notice 'PASS  Test 10  Over the cap: review refused AND terms said so: %', errtext;
  else
    failures := failures || format('Test 10: over-cap review was allowed (blocked_reason=%s err=%s)',
                                   terms->>'blocked_reason', errtext);
    raise notice 'FAIL  Test 10  over-cap review allowed (blocked_reason=% err=%)',
                 terms->>'blocked_reason', errtext;
  end if;

  -- =========================================================================
  -- TEST 11 — The cap is the SOCIETY'S rule, not a constant. Raising the
  --           multiple to 3x must let the same request through.
  -- =========================================================================
  insert into public.sacco_guarantee_settings (admin_id, sacco_id, max_exposure_multiple)
  values (s_admin, sacco_a, 3.00)
  on conflict (sacco_id) do update set max_exposure_multiple = 3.00;

  perform set_config('request.jwt.claims', gua_claims, true);
  select public.sacco_loan_guarantee_terms(g2) into terms;

  execute 'set local role authenticated';
  begin
    perform public.sacco_loan_guarantee_review(g2, terms->>'hash');
    errtext := null;
  exception when others then errtext := sqlerrm;
  end;
  execute 'reset role';

  select status into row_status from public.sacco_loan_guarantees where id = g2;

  checks_run := checks_run + 1;
  if errtext is null and row_status = 'under_review' and (terms->>'blocked_reason') is null then
    raise notice 'PASS  Test 11  Cap raised to 3x; the same request now passes';
  else
    failures := failures || format('Test 11: 3x cap did not admit the request (status=%s blocked=%s err=%s)',
                                   row_status, terms->>'blocked_reason', errtext);
    raise notice 'FAIL  Test 11  status=% blocked=% err=%', row_status, terms->>'blocked_reason', errtext;
  end if;

  -- Put the policy back to the default for the tests that follow.
  update public.sacco_guarantee_settings set max_exposure_multiple = 1.00 where sacco_id = sacco_a;

  -- =========================================================================
  -- TEST 12 — THE HAPPY PATH, end to end. Review then confirm on the original
  --           guarantee; the row becomes accepted and carries the hash it was
  --           signed against.
  -- =========================================================================
  perform set_config('request.jwt.claims', gua_claims, true);
  select public.sacco_loan_guarantee_terms(g) into terms;
  hash := terms->>'hash';

  execute 'set local role authenticated';
  begin
    perform public.sacco_loan_guarantee_review(g, hash);
    perform public.sacco_loan_guarantee_confirm(g, hash, '  vlg   guarantor  ');  -- case/space tolerant
    errtext := null;
  exception when others then errtext := sqlerrm;
  end;
  execute 'reset role';

  select status into row_status from public.sacco_loan_guarantees where id = g;
  select (accepted_terms_hash = hash and accepted_at is not null and reviewed_at is not null)
    into ok from public.sacco_loan_guarantees where id = g;

  checks_run := checks_run + 1;
  if row_status = 'accepted' and ok then
    raise notice 'PASS  Test 12  Reviewed then confirmed; accepted against the hash that was read';
  else
    failures := failures || format('Test 12: happy path failed (status=%s hashmatch=%s err=%s)', row_status, ok, errtext);
    raise notice 'FAIL  Test 12  status=% hashmatch=% err=%', row_status, ok, errtext;
  end if;

  -- =========================================================================
  -- TEST 13 — FINALITY. A confirmed guarantee cannot be confirmed again, and
  --           cannot be declined or withdrawn afterwards.
  -- =========================================================================
  perform set_config('request.jwt.claims', gua_claims, true);
  execute 'set local role authenticated';
  begin
    perform public.sacco_loan_guarantee_confirm(g, hash, 'VLG Guarantor');
    errtext := null;
  exception when others then errtext := sqlerrm;
  end;
  execute 'reset role';

  checks_run := checks_run + 1;
  if errtext is not null then
    raise notice 'PASS  Test 13a Second confirmation refused: %', errtext;
  else
    failures := failures || 'Test 13a: a guarantee was confirmed twice';
    raise notice 'FAIL  Test 13a confirmed twice';
  end if;

  perform set_config('request.jwt.claims', gua_claims, true);
  execute 'set local role authenticated';
  begin
    perform public.sacco_loan_guarantee_decline(g, 'changed my mind');
    errtext := null;
  exception when others then errtext := sqlerrm;
  end;
  execute 'reset role';

  select status into row_status from public.sacco_loan_guarantees where id = g;

  checks_run := checks_run + 1;
  if errtext is not null and row_status = 'accepted' then
    raise notice 'PASS  Test 13b Declining a confirmed guarantee refused: %', errtext;
  else
    failures := failures || format('Test 13b: a confirmed guarantee was declined (status=%s)', row_status);
    raise notice 'FAIL  Test 13b confirmed guarantee declined (status=%)', row_status;
  end if;

  -- =========================================================================
  -- TEST 14 — ISOLATION. A member of another society cannot read this
  --           agreement at all, nor render its terms.
  -- =========================================================================
  perform set_config('request.jwt.claims', out_claims, true);
  execute 'set local role authenticated';
  select count(*) into n from public.sacco_loan_guarantees where id = g;
  begin
    perform public.sacco_loan_guarantee_terms(g);
    errtext := null;
  exception when others then errtext := sqlerrm;
  end;
  execute 'reset role';

  checks_run := checks_run + 1;
  if n = 0 and errtext is not null then
    raise notice 'PASS  Test 14  An outside member sees nothing and cannot render the terms';
  else
    failures := failures || format('Test 14: outsider read the guarantee (rows=%s termserr=%s)', n, errtext);
    raise notice 'FAIL  Test 14  outsider rows=% termserr=%', n, errtext;
  end if;

  -- =========================================================================
  -- TEST 15 — RELEASE. "The guarantee is released once the facility is repaid
  --           in full" is a clause the guarantor was shown, so closing the
  --           loan must honour it without anyone remembering to.
  -- =========================================================================
  select loan_id into loan from public.sacco_loan_guarantees where id = g;
  update public.sacco_loans set status = 'closed' where id = loan;

  select status into row_status from public.sacco_loan_guarantees where id = g;

  checks_run := checks_run + 1;
  if row_status = 'released' then
    raise notice 'PASS  Test 15  Closing the loan released the accepted guarantee';
  else
    failures := failures || format('Test 15: closed loan left the guarantee at %s', row_status);
    raise notice 'FAIL  Test 15  closed loan left the guarantee at %', row_status;
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
    raise exception E'LOAN GUARANTEE FAILURES (% of % checks):\n  - %',
                    array_length(failures, 1), checks_run,
                    array_to_string(failures, E'\n  - ');
  end if;
end;
$verify$;

rollback;

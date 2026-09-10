-- ===========================================================================
-- DIRECT CLIENT REGISTRATION — LIVE VERIFICATION
--
-- Proves 20260830220000 end to end: the acquisition columns and their CHECK
-- constraints, the trigger that DERIVES the channel at insert and FREEZES it
-- against later edits to agent_id, the signup-code minting and its uniqueness,
-- resolve_signup_code's refusal to leak a tenant that has self-signup off, the
-- whole of register_direct_client (tenant binding, agent attribution, the
-- cross-tenant refusal, the pending status, the user_profiles link, idempotency
-- on a retry), and the two admin controls with their authorisation.
--
-- The parts worth naming, because they are what a code review cannot check:
--
--   * The channel must survive the agent being DELETED. agent_id is ON DELETE
--     SET NULL, so a derived-on-read channel would rewrite every client an
--     agent ever signed into a walk-in the day they leave. Check 11 kills the
--     agent and looks again.
--   * An agent code belonging to ANOTHER tenant must be refused, not silently
--     ignored. Check 13. Accepting it would attribute one company's client to
--     a different company's agent.
--   * set_self_signup and rotate_signup_code must refuse a non-admin. Checks
--     16-17 run them under a real staff JWT, not as postgres.
--
-- SAFE TO RUN AGAINST PRODUCTION. One DO block that ALWAYS ends in RAISE
-- EXCEPTION, so the seed is unwound even under autocommit. Success exits
-- NON-ZERO with a message beginning "ALL CHECKS PASSED" — read the message,
-- not the exit code. Results travel in the RAISE because `supabase db query`
-- does not surface NOTICEs.
--
--   supabase db query --linked -f scripts/verify-direct-client-registration.sql
--
-- Or paste into the Supabase SQL editor and run the whole file.
-- ===========================================================================

begin;

do $verify$
declare
  u_admin  uuid := '00000000-0000-4000-8000-00000000e001';  -- tenant A owner
  u_agent  uuid := '00000000-0000-4000-8000-00000000e002';  -- tenant A agent
  u_staff  uuid := '00000000-0000-4000-8000-00000000e003';  -- tenant A non-admin
  u_other  uuid := '00000000-0000-4000-8000-00000000e004';  -- tenant B owner
  u_c1     uuid := '00000000-0000-4000-8000-00000000e005';  -- registers direct
  u_c2     uuid := '00000000-0000-4000-8000-00000000e006';  -- registers via agent
  u_c3     uuid := '00000000-0000-4000-8000-00000000e007';  -- only ever refused

  ag_a     uuid;            -- tenant A's agent row
  ag_a2    uuid;            -- tenant A's second agent (survives check 11)
  ag_b     uuid;            -- tenant B's agent row
  code_a   text;            -- tenant A's signup code
  code_b   text;
  new_code text;

  res      jsonb;
  r_name   text;
  r_city   text;
  r_chan   text;
  r_src    text;
  r_status text;
  r_admin  uuid;
  r_agent  uuid;
  r_auth   uuid;
  r_role   text;
  r_name2  text;
  n        integer;
  bad      boolean;

  failures text[] := '{}';
  checks   integer := 0;
  report   text   := '';
begin

  -- ---- guard --------------------------------------------------------------
  -- Everything below assumes the migration is in. Say so plainly rather than
  -- failing eighteen checks with confusing messages.
  if to_regclass('public.company_profiles') is null then
    raise exception 'company_profiles is not present — nothing to verify.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'clients'
                    and column_name = 'acquisition_channel') then
    raise exception 'clients.acquisition_channel is missing — migration 20260830220000 has not been applied.';
  end if;

  -- ---- seed ---------------------------------------------------------------
  insert into auth.users (id, email, instance_id, aud, role, created_at, updated_at,
                          raw_user_meta_data)
  values
    (u_admin, 'dcr-admin@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now(), '{}'::jsonb),
    (u_agent, 'dcr-agent@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now(), '{}'::jsonb),
    (u_staff, 'dcr-staff@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now(), '{}'::jsonb),
    (u_other, 'dcr-other@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now(), '{}'::jsonb),
    -- The two registrants arrive with the metadata the Edge Function sets, so
    -- handle_new_user() writes their profile exactly as it would in production.
    (u_c1,    'dcr-c1@example.invalid',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now(),
     jsonb_build_object('full_name', 'Direct Client', 'role', 'client')),
    (u_c2,    'dcr-c2@example.invalid',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now(),
     jsonb_build_object('full_name', 'Referred Client', 'role', 'client')),
    -- Never successfully registers. Kept separate so a regression in checks 13
    -- or 19 cannot land on an account that means something.
    (u_c3,    'dcr-c3@example.invalid',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now(),
     jsonb_build_object('full_name', 'Refused Client', 'role', 'client'));

  insert into public.user_profiles (id, email, full_name, role, admin_id)
  values
    (u_admin, 'dcr-admin@example.invalid', 'DCR Admin',  'admin'::public.user_role,       null),
    (u_agent, 'dcr-agent@example.invalid', 'DCR Agent',  'sales_agent'::public.user_role, u_admin),
    (u_staff, 'dcr-staff@example.invalid', 'DCR Staff',  'operations'::public.user_role,  u_admin),
    (u_other, 'dcr-other@example.invalid', 'DCR Other',  'admin'::public.user_role,       null)
  on conflict (id) do update
    set email = excluded.email, full_name = excluded.full_name,
        role = excluded.role, admin_id = excluded.admin_id;

  -- Two tenants. Tenant B exists purely so the cross-tenant checks have
  -- somewhere real to point at.
  insert into public.company_profiles
    (admin_id, company_name, business_registration_number, business_type,
     city, location, email, phone, kyc_status)
  values
    (u_admin, 'DCR Scratch Motors', 'DCR-REG-1', 'Asset Financing',
     'Nairobi', 'Westlands', 'dcr-admin@example.invalid', '+254700000801', 'pending'),
    (u_other, 'DCR Other Motors',   'DCR-REG-2', 'Asset Financing',
     'Mombasa', 'Nyali',     'dcr-other@example.invalid', '+254700000802', 'pending');

  insert into public.agents (user_id, admin_id, agent_code, full_name, email, agent_status)
  values (u_agent, u_admin, 'DCR-A1', 'DCR Agent', 'dcr-agent@example.invalid', 'active');
  select id into ag_a from public.agents where agent_code = 'DCR-A1';

  insert into public.agents (admin_id, agent_code, full_name, email, agent_status)
  values (u_admin, 'DCR-A2', 'DCR Second Agent', 'dcr-a2@example.invalid', 'active');
  select id into ag_a2 from public.agents where agent_code = 'DCR-A2';

  insert into public.agents (admin_id, agent_code, full_name, email, agent_status)
  values (u_other, 'DCR-B1', 'DCR Other Agent', 'dcr-otheragent@example.invalid', 'active');
  select id into ag_b from public.agents where agent_code = 'DCR-B1';

  -- ---- 1. the insert trigger mints a signup code for a new tenant ----------
  select signup_code, self_signup_enabled into code_a, bad
    from public.company_profiles where admin_id = u_admin;

  checks := checks + 1;
  if code_a is not null and code_a ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$' then
    report := report || E'\n  PASS  1  a new tenant gets an 8-char code from the unambiguous alphabet';
  else
    failures := failures || format('1: signup_code=%s is missing or off-alphabet', coalesce(code_a, 'NULL'));
  end if;

  -- ---- 2. ... but the door starts SHUT ------------------------------------
  -- Opening a company's client book to strangers is that company's decision.
  checks := checks + 1;
  if bad is false then
    report := report || E'\n  PASS  2  self_signup_enabled defaults to false for a new tenant';
  else
    failures := failures || format('2: self_signup_enabled defaulted to %s, not false', bad);
  end if;

  -- ---- 3. codes are unique across tenants ---------------------------------
  select signup_code into code_b from public.company_profiles where admin_id = u_other;
  select count(*) into n from public.company_profiles
   where signup_code is not null
   group by upper(signup_code) having count(*) > 1 limit 1;

  checks := checks + 1;
  if code_b is not null and code_b <> code_a and n is null then
    report := report || E'\n  PASS  3  every tenant has a distinct code (unique index holds)';
  else
    failures := failures || format('3: code_a=%s code_b=%s duplicate_groups=%s', code_a, code_b, coalesce(n::text, '0'));
  end if;

  -- ---- 4. a tenant with self-signup OFF does not resolve -------------------
  -- A wrong code and a tenant that has the feature off must be indistinguishable
  -- from outside, or the endpoint becomes a directory of every company here.
  select company_name into r_name from public.resolve_signup_code(code_a);

  checks := checks + 1;
  if r_name is null then
    report := report || E'\n  PASS  4  a code resolves to nothing while self-signup is off';
  else
    failures := failures || format('4: resolve_signup_code leaked %s with self-signup off', r_name);
  end if;

  -- ---- 5. registration is refused while the door is shut ------------------
  bad := false;
  begin
    perform public.register_direct_client(code_a, u_c1, 'Direct Client', 'dcr-c1@example.invalid');
    bad := true;
  exception when others then
    bad := false;
  end;

  checks := checks + 1;
  if not bad then
    report := report || E'\n  PASS  5  register_direct_client refuses a tenant with self-signup off';
  else
    failures := failures || '5: registered against a tenant that had self-signup switched OFF';
  end if;

  -- ---- open the door, as the tenant owner would ---------------------------
  perform set_config('request.jwt.claims',
                     json_build_object('sub', u_admin::text, 'role', 'authenticated')::text, true);

  perform public.set_self_signup(true);

  -- ---- 6. the switch actually moved --------------------------------------
  -- Through the RPC precisely because a plain UPDATE that RLS declines matches
  -- zero rows and returns no error.
  select self_signup_enabled into bad from public.company_profiles where admin_id = u_admin;

  checks := checks + 1;
  if bad then
    report := report || E'\n  PASS  6  set_self_signup(true) is visible on the row afterwards';
  else
    failures := failures || '6: set_self_signup(true) reported success but the row did not change';
  end if;

  -- ---- 7. now the code resolves, and says only what a poster would --------
  select company_name, city into r_name, r_city from public.resolve_signup_code(lower(code_a));

  checks := checks + 1;
  if r_name = 'DCR Scratch Motors' and r_city = 'Nairobi' then
    report := report || E'\n  PASS  7  a live code resolves case-insensitively to the company name + city';
  else
    failures := failures || format('7: resolve returned name=%s city=%s', coalesce(r_name, 'NULL'), coalesce(r_city, 'NULL'));
  end if;

  -- Back to no JWT: register_direct_client is called by the Edge Function with
  -- the service role, which is what the rest of these checks must exercise.
  perform set_config('request.jwt.claims', '{}', true);

  -- ---- 8. a DIRECT registration lands correctly in every column -----------
  res := public.register_direct_client(code_a, u_c1, 'Direct Client', 'DCR-C1@Example.Invalid', '+254700000811', null);

  select acquisition_channel, registration_source, client_status::text,
         admin_id, agent_id, client_auth_id, email
    into r_chan, r_src, r_status, r_admin, r_agent, r_auth, r_name
    from public.clients where id = (res->>'client_id')::uuid;

  checks := checks + 1;
  if r_chan = 'direct' and r_src = 'self_service' and r_status = 'pending'
     and r_admin = u_admin and r_agent is null and r_auth = u_c1
     and r_name = 'dcr-c1@example.invalid'
     and (res->>'account_number') ~ '^AF-[0-9]{4}-[0-9]{6}$' then
    report := report || E'\n  PASS  8  a direct signup is direct/self_service/pending, tenant-bound, email lowercased';
  else
    failures := failures || format('8: chan=%s src=%s status=%s admin=%s agent=%s auth=%s email=%s acct=%s',
                                   r_chan, r_src, r_status, r_admin, r_agent, r_auth, r_name, res->>'account_number');
  end if;

  -- ---- 9. the portal login is bound to the tenant, as a client ------------
  -- is_staff_member() excludes 'client', so an admin_id here grants nothing
  -- beyond their own row — but WITHOUT it the client resolves to no tenant.
  select role::text, admin_id into r_role, r_admin from public.user_profiles where id = u_c1;

  checks := checks + 1;
  if r_role = 'client' and r_admin = u_admin then
    report := report || E'\n  PASS  9  the registrant''s user_profile is role=client and bound to the tenant';
  else
    failures := failures || format('9: user_profile role=%s admin_id=%s', r_role, coalesce(r_admin::text, 'NULL'));
  end if;

  -- ---- 10. an AGENT code attributes the account and names the agent back ---
  res := public.register_direct_client(code_a, u_c2, 'Referred Client', 'dcr-c2@example.invalid', null, 'dcr-a1');

  select acquisition_channel, agent_id into r_chan, r_agent
    from public.clients where id = (res->>'client_id')::uuid;

  checks := checks + 1;
  if r_chan = 'agent' and r_agent = ag_a
     and res->>'agent_name' = 'DCR Agent'
     and res->>'acquisition_channel' = 'agent' then
    report := report || E'\n  PASS 10  a lower-case agent code attributes the client and returns the agent name';
  else
    failures := failures || format('10: chan=%s agent=%s returned=%s', r_chan, r_agent, res::text);
  end if;

  -- ---- 11. the channel SURVIVES the agent being deleted --------------------
  -- The whole reason this is a column and not `agent_id IS NULL`. agent_id is
  -- ON DELETE SET NULL: derived-on-read, every client this agent ever signed
  -- would become a walk-in the day they leave, and the commission history
  -- would rewrite itself.
  delete from public.agents where id = ag_a;

  select acquisition_channel, agent_id into r_chan, r_agent
    from public.clients where client_auth_id = u_c2;

  checks := checks + 1;
  if r_chan = 'agent' and r_agent is null then
    report := report || E'\n  PASS 11  deleting the agent nulls agent_id but the channel still reads ''agent''';
  else
    failures := failures || format('11: after agent delete chan=%s agent=%s', r_chan, coalesce(r_agent::text, 'NULL'));
  end if;

  -- ---- 12. re-assigning an account does not re-write how it was won -------
  -- Handing a direct client to an agent is account management. If it moved the
  -- channel, next month's commission report would pay for a sale nobody made.
  update public.clients set agent_id = ag_a2 where client_auth_id = u_c1;
  select acquisition_channel into r_chan from public.clients where client_auth_id = u_c1;

  checks := checks + 1;
  if r_chan = 'direct' then
    report := report || E'\n  PASS 12  setting agent_id on a direct client leaves the channel ''direct''';
  else
    failures := failures || format('12: reassigning an account moved the channel to %s', r_chan);
  end if;

  -- ---- 13. an agent from ANOTHER tenant is refused, not ignored ------------
  bad := false;
  begin
    perform public.register_direct_client(code_a, u_c3, 'Cross Tenant', 'dcr-x@example.invalid', null, 'DCR-B1');
    bad := true;
  exception when others then
    bad := false;
  end;

  checks := checks + 1;
  if not bad then
    report := report || E'\n  PASS 13  an agent code from a different tenant is rejected';
  else
    failures := failures || '13: attributed a client to an agent belonging to ANOTHER tenant';
  end if;

  -- ---- 14. a retry does not mint a second account for the same login ------
  res := public.register_direct_client(code_a, u_c1, 'Direct Client', 'dcr-c1@example.invalid');
  select count(*) into n from public.clients where client_auth_id = u_c1;

  checks := checks + 1;
  if n = 1 and (res->>'already_registered')::boolean
     and res->>'acquisition_channel' = 'direct' then
    report := report || E'\n  PASS 14  a repeat submission returns the existing account, still ''direct''';
  else
    failures := failures || format('14: rows=%s payload=%s', n, res::text);
  end if;

  -- ---- 15. the CHECK constraints reject anything off-vocabulary -----------
  bad := false;
  begin
    update public.clients set acquisition_channel = 'walk_in' where client_auth_id = u_c1;
    bad := true;
  exception when check_violation then
    bad := false;
  end;

  checks := checks + 1;
  if not bad then
    report := report || E'\n  PASS 15  clients_acquisition_channel_chk rejects a value the UI never offers';
  else
    failures := failures || '15: CHECK constraint accepted an arbitrary acquisition_channel';
  end if;

  -- ---- 16. a non-admin cannot open the door ------------------------------
  perform set_config('request.jwt.claims',
                     json_build_object('sub', u_staff::text, 'role', 'authenticated')::text, true);
  bad := false;
  begin
    perform public.set_self_signup(false);
    bad := true;
  exception when others then
    bad := false;
  end;

  checks := checks + 1;
  if not bad then
    report := report || E'\n  PASS 16  an operations-role staffer cannot change the self-signup switch';
  else
    failures := failures || '16: a non-admin staff member switched self-signup off';
  end if;

  -- ---- 17. ... nor invalidate a code the company is advertising -----------
  bad := false;
  begin
    perform public.rotate_signup_code();
    bad := true;
  exception when others then
    bad := false;
  end;

  checks := checks + 1;
  if not bad then
    report := report || E'\n  PASS 17  an operations-role staffer cannot rotate the registration code';
  else
    failures := failures || '17: a non-admin staff member rotated the tenant signup code';
  end if;

  -- ---- 18. the owner CAN rotate, and the old code dies -------------------
  perform set_config('request.jwt.claims',
                     json_build_object('sub', u_admin::text, 'role', 'authenticated')::text, true);
  new_code := public.rotate_signup_code();
  perform set_config('request.jwt.claims', '{}', true);

  select company_name into r_name  from public.resolve_signup_code(code_a);
  select company_name into r_name2 from public.resolve_signup_code(new_code);

  checks := checks + 1;
  if new_code <> code_a and r_name is null and r_name2 = 'DCR Scratch Motors' then
    report := report || E'\n  PASS 18  rotating mints a new code and the old one stops resolving';
  else
    failures := failures || format('18: new=%s old_resolves=%s new_resolves=%s',
                                   new_code, coalesce(r_name, 'NULL'), coalesce(r_name2, 'NULL'));
  end if;

  -- ---- 19. a wrong code is refused ---------------------------------------
  bad := false;
  begin
    perform public.register_direct_client('ZZZZZZZZ', u_c3, 'Nobody', 'dcr-z@example.invalid');
    bad := true;
  exception when others then
    bad := false;
  end;

  checks := checks + 1;
  if not bad then
    report := report || E'\n  PASS 19  an unknown registration code is refused';
  else
    failures := failures || '19: registered against a code that does not exist';
  end if;

  -- ---- 20. staff-entered clients are untouched by any of this ------------
  -- The backfill and the trigger must leave the ordinary invite path alone: a
  -- client an admin types in is direct, entered by staff, and not self-service.
  insert into public.clients (account_number, full_name, email, admin_id, client_status, kyc_status)
  values ('AF-9999-999001', 'Walk In', 'dcr-walkin@example.invalid', u_admin, 'active', 'unverified');

  select acquisition_channel, registration_source into r_chan, r_src
    from public.clients where account_number = 'AF-9999-999001';

  checks := checks + 1;
  if r_chan = 'direct' and r_src = 'staff' then
    report := report || E'\n  PASS 20  a client typed in by staff is direct/staff, not self_service';
  else
    failures := failures || format('20: staff-entered client got chan=%s src=%s', r_chan, r_src);
  end if;

  -- ---- verdict ------------------------------------------------------------
  if array_length(failures, 1) is null then
    raise exception E'ALL CHECKS PASSED — % checks. Seed rolled back (this error is intentional).%',
                    checks, report;
  else
    raise exception E'DIRECT CLIENT REGISTRATION FAILURES (% of % checks):\n  - %\n\nPassed:%',
                    array_length(failures, 1), checks,
                    array_to_string(failures, E'\n  - '), report;
  end if;

end
$verify$;

rollback;

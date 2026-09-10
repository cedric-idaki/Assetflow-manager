-- ===========================================================================
-- LEAD LOSS TRACKING — LIVE VERIFICATION
--
-- Proves 20260828140000: lost_at stamping, the CHECK constraint, and — the part
-- that is easy to get wrong — CLEARING the lost_* set when a lead stops being
-- lost. A revived or converted lead that keeps its lost_reason stays in the
-- loss report forever as a phantom failure, and double-counts against the win
-- it turned into.
--
-- SAFE TO RUN AGAINST PRODUCTION. One DO block that ALWAYS ends in RAISE
-- EXCEPTION, so the seed is unwound even under autocommit. Success exits
-- NON-ZERO with a message beginning "ALL CHECKS PASSED" — read the message,
-- not the exit code. Results travel in the RAISE because `supabase db query`
-- does not surface NOTICEs.
--
--   supabase db query --linked -f scripts/verify-lead-lost-reason.sql
-- ===========================================================================

begin;

do $verify$
declare
  u_admin uuid := '00000000-0000-4000-8000-00000000d001';
  u_a1    uuid := '00000000-0000-4000-8000-00000000d002';
  ag      uuid;
  ld      uuid;

  r_reason text;
  r_notes  text;
  r_at     timestamptz;
  first_at timestamptz;
  bad      boolean := false;

  failures text[] := '{}';
  checks   integer := 0;
  report   text   := '';
begin

  -- ---- seed ---------------------------------------------------------------
  insert into auth.users (id, email, instance_id, aud, role, created_at, updated_at)
  values
    (u_admin, 'loss-admin@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (u_a1,    'loss-a1@example.invalid',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

  insert into public.user_profiles (id, email, full_name, role, admin_id)
  values
    (u_admin, 'loss-admin@example.invalid', 'Loss Admin', 'admin'::public.user_role,       null),
    (u_a1,    'loss-a1@example.invalid',    'Loss Agent', 'sales_agent'::public.user_role, u_admin)
  on conflict (id) do update
    set email = excluded.email, full_name = excluded.full_name,
        role = excluded.role, admin_id = excluded.admin_id;

  insert into public.agents (user_id, admin_id, agent_code, full_name, email, agent_status)
  values (u_a1, u_admin, 'LOSS-A1', 'Loss Agent', 'loss-a1@example.invalid', 'active');
  select id into ag from public.agents where agent_code = 'LOSS-A1';

  insert into public.leads (agent_id, full_name, phone, stage)
  values (ag, 'Loss Lead', '+254700000900', 'qualified')
  returning id into ld;

  -- ---- 1. an OPEN lead has no loss fields ---------------------------------
  select lost_at, lost_reason into r_at, r_reason from public.leads where id = ld;
  checks := checks + 1;
  if r_at is null and r_reason is null then
    report := report || E'\n  PASS  1  an open lead carries no loss fields';
  else
    failures := failures || format('1: open lead already lost_at=%s reason=%s', r_at, r_reason);
  end if;

  -- ---- 2. closing without converting stamps lost_at and keeps the reason ---
  update public.leads
     set stage = 'closed', lost_reason = 'financing', lost_notes = 'SACCO declined the facility'
   where id = ld;

  select lost_at, lost_reason, lost_notes into r_at, r_reason, r_notes
    from public.leads where id = ld;
  first_at := r_at;

  checks := checks + 1;
  if r_at is not null and r_reason = 'financing' and r_notes = 'SACCO declined the facility' then
    report := report || E'\n  PASS  2  closing without converting stamps lost_at and keeps reason + note';
  else
    failures := failures || format('2: lost_at=%s reason=%s notes=%s', r_at, r_reason, r_notes);
  end if;

  -- ---- 3. re-closing does not move the date forward -----------------------
  perform pg_sleep(0.05);
  update public.leads set lost_notes = 'still declined' where id = ld;
  select lost_at into r_at from public.leads where id = ld;

  checks := checks + 1;
  if r_at = first_at then
    report := report || E'\n  PASS  3  editing a lost lead does not rewrite when the loss happened';
  else
    failures := failures || format('3: lost_at moved from %s to %s', first_at, r_at);
  end if;

  -- ---- 4. the CHECK constraint rejects a value the UI does not offer -------
  begin
    update public.leads set lost_reason = 'because_mercury_was_retrograde' where id = ld;
    bad := true;   -- reached only if the constraint let it through
  exception when check_violation then
    bad := false;
  end;

  checks := checks + 1;
  if not bad then
    report := report || E'\n  PASS  4  an off-vocabulary reason is rejected by the CHECK constraint';
  else
    failures := failures || '4: CHECK constraint accepted an arbitrary lost_reason';
  end if;

  -- ---- 5. REVIVING the lead clears the whole lost_* set --------------------
  update public.leads set stage = 'contacted' where id = ld;
  select lost_at, lost_reason, lost_notes into r_at, r_reason, r_notes
    from public.leads where id = ld;

  checks := checks + 1;
  if r_at is null and r_reason is null and r_notes is null then
    report := report || E'\n  PASS  5  reviving a lead clears lost_at, reason AND note together';
  else
    failures := failures || format('5: revived lead kept lost_at=%s reason=%s notes=%s', r_at, r_reason, r_notes);
  end if;

  -- ---- 6. CONVERTING a previously-lost lead clears it too ------------------
  update public.leads
     set stage = 'closed', lost_reason = 'price'
   where id = ld;                                    -- lost again
  update public.leads
     set stage = 'closed', converted_at = now()
   where id = ld;                                    -- ... then actually won

  select lost_at, lost_reason into r_at, r_reason from public.leads where id = ld;

  checks := checks + 1;
  if r_at is null and r_reason is null then
    report := report || E'\n  PASS  6  a lost lead that later converts stops counting as lost';
  else
    failures := failures || format('6: converted lead still lost_at=%s reason=%s', r_at, r_reason);
  end if;

  -- ---- verdict ------------------------------------------------------------
  if array_length(failures, 1) is null then
    raise exception E'ALL CHECKS PASSED — % checks. Seed rolled back (this error is intentional).%',
                    checks, report;
  else
    raise exception E'LEAD LOSS TRACKING FAILURES (% of % checks):\n  - %\n\nPassed:%',
                    array_length(failures, 1), checks,
                    array_to_string(failures, E'\n  - '), report;
  end if;

end
$verify$;

rollback;

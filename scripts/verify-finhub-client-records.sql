-- ===========================================================================
-- FINHUB CLIENT RECORDS — LIVE VERIFICATION
--
-- Proves 20260911120000 end to end: the lead link and the UNIQUE index that
-- makes it mean something, the duplicate scan and its tenant scope, every
-- branch of finhub_create_client (staff gate, minimum record, lead idempotency,
-- the "same person" link, the duplicate refusal, the recorded override,
-- cross-tenant refusal), and the three read functions that carry the balance
-- and the payment history.
--
-- The parts worth naming, because a code review cannot check them:
--
--   * Converting one lead TWICE must return the FIRST record. Check 6. This is
--     the whole reason clients.lead_id exists, and a screen that lost its
--     connection mid-save is the ordinary way it happens.
--   * The duplicate scan inside finhub_create_client must not see other
--     tenants. It is called from a SECURITY DEFINER function, where a SECURITY
--     INVOKER callee runs with RLS OFF — so the scope has to be an argument.
--     Checks 9 and 10 put an identical customer in another tenant and prove
--     neither the scan nor the refusal reaches it.
--   * The statement's running balance must be computed over the WHOLE history
--     before the page is cut, or the newest page starts from zero. Check 14.
--   * Draft and cancelled invoices, and payments that never confirmed, must
--     stay out of the balance. Check 13.
--
-- SAFE TO RUN AGAINST PRODUCTION. One DO block that ALWAYS ends in RAISE
-- EXCEPTION, so the seed is unwound even under autocommit. Success exits
-- NON-ZERO with a message beginning "ALL CHECKS PASSED" — read the message,
-- not the exit code.
--
--   supabase db query --linked -f scripts/verify-finhub-client-records.sql
--
-- Or paste into the Supabase SQL editor and run the whole file.
-- ===========================================================================

begin;

do $verify$
declare
  u_admin  uuid := '00000000-0000-4000-8000-00000000f001';  -- tenant A owner
  u_agent  uuid := '00000000-0000-4000-8000-00000000f002';  -- tenant A agent
  u_acct   uuid := '00000000-0000-4000-8000-00000000f003';  -- tenant A accountant
  u_client uuid := '00000000-0000-4000-8000-00000000f004';  -- a portal client
  u_other  uuid := '00000000-0000-4000-8000-00000000f005';  -- tenant B owner

  ag_a     uuid;              -- tenant A's agent row
  lead_1   uuid;              -- converts cleanly
  lead_2   uuid;              -- the same human, a second time
  lead_b   uuid;              -- belongs to tenant B

  c1       public.clients%rowtype;
  c2       public.clients%rowtype;
  c3       public.clients%rowtype;
  twin     uuid;              -- tenant B's identical customer

  r_stage  text;
  r_entity text;
  r_ref    uuid;
  r_text   text;
  n        integer;
  book_all integer;            -- the book's own claim about how big it is
  bad      boolean;
  s        record;
  st       record;

  failures text[] := '{}';
  checks   integer := 0;
  report   text   := '';
begin

  -- ---- guard --------------------------------------------------------------
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'clients'
                    and column_name = 'lead_id') then
    raise exception 'clients.lead_id is missing — migration 20260911120000 has not been applied.';
  end if;
  if to_regprocedure('public.finhub_create_client(text,text,text,text,text,text,text,uuid,uuid,text,uuid,boolean)') is null then
    raise exception 'finhub_create_client is missing — migration 20260911120000 has not been applied.';
  end if;

  -- ---- 1. the index that makes the link a rule, not a hope ---------------
  checks := checks + 1;
  if exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'clients'
       and indexname = 'idx_clients_lead_unique'
       and indexdef ilike '%unique%' and indexdef ilike '%lead_id is not null%'
  ) then
    report := report || E'\n  PASS  1  one lead can only ever produce one client record';
  else
    failures := failures || '1: idx_clients_lead_unique is absent or is not a partial UNIQUE index'::text;
  end if;

  -- ---- seed ---------------------------------------------------------------
  insert into auth.users (id, email, instance_id, aud, role, created_at, updated_at, raw_user_meta_data)
  values
    (u_admin,  'fcr-admin@example.invalid',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now(), '{}'::jsonb),
    (u_agent,  'fcr-agent@example.invalid',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now(), '{}'::jsonb),
    (u_acct,   'fcr-acct@example.invalid',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now(), '{}'::jsonb),
    (u_client, 'fcr-client@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now(), '{}'::jsonb),
    (u_other,  'fcr-other@example.invalid',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now(), '{}'::jsonb)
  on conflict (id) do nothing;

  insert into public.user_profiles (id, email, full_name, role, admin_id)
  values
    (u_admin,  'fcr-admin@example.invalid',  'FCR Admin',      'admin'::public.user_role,       null),
    (u_agent,  'fcr-agent@example.invalid',  'FCR Agent',      'sales_agent'::public.user_role, u_admin),
    (u_acct,   'fcr-acct@example.invalid',   'FCR Accountant', 'accountant'::public.user_role,  u_admin),
    (u_client, 'fcr-client@example.invalid', 'FCR Client',     'client'::public.user_role,      u_admin),
    (u_other,  'fcr-other@example.invalid',  'FCR Other',      'admin'::public.user_role,       null)
  on conflict (id) do update
    set role = excluded.role, admin_id = excluded.admin_id, full_name = excluded.full_name;

  insert into public.agents (user_id, admin_id, agent_code, full_name, email)
  values (u_agent, u_admin, 'FCR-AG-1', 'FCR Agent', 'fcr-agent@example.invalid')
  returning id into ag_a;

  -- Tenant B's customer: the same human, written down by somebody else.
  insert into public.clients (account_number, full_name, email, phone, kra_pin, admin_id, client_status)
  values ('FCR-OTHER-1', 'Wanjiru Kamau', 'fcr-wanjiru@example.invalid', '0712000811',
          'A00FCR811X', u_other, 'active'::public.client_status)
  returning id into twin;

  insert into public.leads (agent_id, admin_id, full_name, email, phone, kra_pin)
  values (ag_a, u_admin, 'Wanjiru Kamau', 'FCR-Wanjiru@Example.Invalid', '+254 712 000 811', 'a00fcr811x')
  returning id into lead_1;

  insert into public.leads (agent_id, admin_id, full_name, phone)
  values (ag_a, u_admin, 'W. Kamau', '0712000811')
  returning id into lead_2;

  insert into public.leads (admin_id, full_name, phone)
  values (u_other, 'Somebody Else', '0799000811')
  returning id into lead_b;

  -- ---- 2. a client-portal user may not create one ------------------------
  perform set_config('request.jwt.claims',
                     json_build_object('sub', u_client::text, 'role', 'authenticated')::text, true);
  begin
    perform public.finhub_create_client('Should Not Exist');
    bad := true;
  exception when sqlstate '42501' then
    bad := false;
  end;

  checks := checks + 1;
  if not bad then
    report := report || E'\n  PASS  2  a client-portal user is refused (42501)';
  else
    failures := failures || '2: a client-portal user created a client record'::text;
  end if;

  -- ---- from here on, the agent is acting ---------------------------------
  perform set_config('request.jwt.claims',
                     json_build_object('sub', u_agent::text, 'role', 'authenticated')::text, true);

  -- ---- 3. the minimum record is a name -----------------------------------
  c3 := public.finhub_create_client(p_full_name => 'FCR Walk In', p_customer_type => 'cash');

  checks := checks + 1;
  if c3.id is not null and c3.account_number like 'AF-%' and c3.admin_id = u_admin
     and c3.customer_type = 'cash'::public.customer_type then
    report := report || E'\n  PASS  3  a name alone produces a billable record with an allocated account number';
  else
    failures := failures || format('3: minimum record came back acct=%s admin=%s type=%s',
                                   c3.account_number, c3.admin_id, c3.customer_type);
  end if;

  -- ---- 4. a nameless record is refused -----------------------------------
  begin
    perform public.finhub_create_client('   ');
    bad := true;
  exception when sqlstate 'P0001' then
    bad := false;
  end;

  checks := checks + 1;
  if not bad then
    report := report || E'\n  PASS  4  a record with no name is refused';
  else
    failures := failures || '4: a nameless client record was accepted'::text;
  end if;

  -- ---- 5. converting a lead links and stamps in ONE transaction ----------
  c1 := public.finhub_create_client(
          p_full_name => 'Wanjiru Kamau',
          p_phone     => '+254 712 000 811',
          p_email     => 'FCR-Wanjiru@Example.Invalid',
          p_kra_pin   => 'a00fcr811x',
          p_lead_id   => lead_1);

  select stage::text, converted_entity, converted_ref_id
    into r_stage, r_entity, r_ref
    from public.leads where id = lead_1;

  checks := checks + 1;
  if c1.lead_id = lead_1 and c1.agent_id = ag_a
     and r_stage = 'closed' and r_entity = 'client' and r_ref = c1.id
     and c1.email = 'fcr-wanjiru@example.invalid'        -- normalised on the way in
     and c1.kra_pin = 'A00FCR811X' then
    report := report || E'\n  PASS  5  a converted lead is linked, closed and stamped in one act';
  else
    failures := failures || format('5: lead=%s stage=%s entity=%s ref=%s email=%s pin=%s',
                                   c1.lead_id, r_stage, r_entity, r_ref, c1.email, c1.kra_pin);
  end if;

  -- ---- 6. converting the SAME lead again returns the FIRST record --------
  select count(*) into n from public.clients where admin_id = u_admin;
  c2 := public.finhub_create_client(p_full_name => 'Wanjiru K', p_lead_id => lead_1);

  checks := checks + 1;
  if c2.id = c1.id
     and (select count(*) from public.clients where admin_id = u_admin) = n then
    report := report || E'\n  PASS  6  converting one lead twice returns the first record, not a second one';
  else
    failures := failures || format('6: second conversion produced %s (first was %s)', c2.id, c1.id);
  end if;

  -- ---- 7. a second lead for the same human is refused --------------------
  begin
    perform public.finhub_create_client(
      p_full_name => 'W. Kamau', p_phone => '0712000811', p_lead_id => lead_2);
    bad := true;
  exception when sqlstate '23505' then
    bad := false;
    r_text := sqlerrm;
  end;

  checks := checks + 1;
  if not bad and r_text like '%' || c1.account_number || '%' then
    report := report || E'\n  PASS  7  a duplicate phone number is refused, and the message names the record it collided with';
  elsif not bad then
    failures := failures || format('7: refused, but the message did not name %s: %s', c1.account_number, r_text);
  else
    failures := failures || '7: a second record was created for a customer already on file'::text;
  end if;

  -- ---- 8. the scan says WHY, and ranks ------------------------------------
  select string_agg(d.matched_on::text, ' ') , max(d.match_score)
    into r_text, n
    from public.finhub_find_client_duplicates(
           p_full_name => 'W. Kamau', p_phone => '254712000811') d;

  checks := checks + 1;
  if r_text like '%phone%' and n >= 25 then
    report := report || E'\n  PASS  8  the duplicate search matches across phone formats and scores the reason';
  else
    failures := failures || format('8: scan returned matched=%s score=%s', coalesce(r_text, 'NULL'), coalesce(n, -1));
  end if;

  -- ---- 9. another tenant's identical customer is invisible ---------------
  select count(*) into n
    from public.finhub_find_client_duplicates(
           p_full_name => 'Wanjiru Kamau', p_kra_pin => 'A00FCR811X') d
   where d.id = twin;

  checks := checks + 1;
  if n = 0 then
    report := report || E'\n  PASS  9  the duplicate search does not reach another tenant';
  else
    failures := failures || '9: the duplicate search returned a client belonging to another tenant'::text;
  end if;

  -- ---- 10. and neither does the refusal inside the creation path ---------
  -- The scan is called from a SECURITY DEFINER function, where RLS is off. If
  -- the tenant were not an explicit argument, tenant B's twin would block a
  -- perfectly good record here.
  begin
    c2 := public.finhub_create_client(
            p_full_name => 'Wanjiru Kamau', p_kra_pin => 'A00FCR811X',
            p_email     => 'fcr-second@example.invalid', p_force => true);
    bad := false;
  exception when others then
    bad := true;
    r_text := sqlerrm;
  end;

  checks := checks + 1;
  if not bad and c2.admin_id = u_admin then
    report := report || E'\n  PASS 10  creation is scoped to the caller tenant, not the whole platform';
  else
    failures := failures || format('10: creation failed or landed in the wrong tenant: %s', coalesce(r_text, c2.admin_id::text));
  end if;

  -- ---- 11. the override is recorded --------------------------------------
  select severity into r_text
    from public.audit_logs
   where table_name = 'clients' and record_id = c2.id
   order by created_at desc limit 1;

  checks := checks + 1;
  if r_text = 'warning' then
    report := report || E'\n  PASS 11  creating past a duplicate is logged as a warning against the person who did it';
  else
    failures := failures || format('11: forced creation logged severity=%s', coalesce(r_text, 'NO ROW'));
  end if;

  -- ---- 12. "same person" links the second lead and fills only blanks -----
  -- c1 has no national_id. The link must add one, leave the name alone, and
  -- leave lead_1 standing as where the record came from — while lead_2 is
  -- closed onto the same customer rather than spawning a second one.
  c2 := public.finhub_create_client(
          p_full_name    => 'W. Kamau',
          p_national_id  => '30011999',
          p_lead_id      => lead_2,
          p_use_existing => c1.id);

  select stage::text, converted_ref_id into r_stage, r_ref
    from public.leads where id = lead_2;

  checks := checks + 1;
  if c2.id = c1.id and c2.lead_id = lead_1 and c2.national_id = '30011999'
     and c2.full_name = 'Wanjiru Kamau'
     and r_stage = 'closed' and r_ref = c1.id then
    report := report || E'\n  PASS 12  a repeat enquiry closes onto the record on file, filling blanks and keeping its origin';
  else
    failures := failures || format('12: link gave id=%s origin=%s id_no=%s name=%s lead2 stage=%s ref=%s',
                                   c2.id, c2.lead_id, coalesce(c2.national_id, 'NULL'), c2.full_name,
                                   r_stage, r_ref);
  end if;

  -- ---- 12b. and converting THAT lead again still finds the same customer -
  -- lead_2 never became clients.lead_id, so the idempotency check has to read
  -- the conversion stamp as well. Without that it would come round as a
  -- duplicate, which is the fault this whole migration exists to remove.
  c2 := public.finhub_create_client(p_full_name => 'W. Kamau', p_lead_id => lead_2);

  checks := checks + 1;
  if c2.id = c1.id then
    report := report || E'\n  PASS 12b a lead closed onto an existing customer is not converted twice';
  else
    failures := failures || format('12b: re-converting lead_2 produced %s, not %s', c2.id, c1.id);
  end if;

  -- ---- 13. the balance counts what was billed and what was received ------
  insert into public.company_invoices (admin_id, invoice_no, client_id, issue_date, due_date, total, status, notes)
  values
    (u_admin, 'FCR-INV-1', c1.id, current_date - 70, current_date - 40, 50000, 'paid',      'Deposit invoice'),
    (u_admin, 'FCR-INV-2', c1.id, current_date - 40, current_date - 10, 30000, 'pending',   'Monthly billing'),
    (u_admin, 'FCR-INV-3', c1.id, current_date - 20, current_date + 10, 10000, 'draft',     'Not issued yet'),
    (u_admin, 'FCR-INV-4', c1.id, current_date - 90, current_date - 60, 99999, 'cancelled', 'Raised in error');

  insert into public.payments (admin_id, transaction_id, client_id, amount, payment_status, payment_method, payment_date, reference_number)
  values
    (u_admin, 'FCR-TX-1', c1.id, 50000, 'completed'::public.payment_status, 'mpesa', now() - interval '68 days', 'FCRQWE1'),
    (u_admin, 'FCR-TX-2', c1.id, 12000, 'completed'::public.payment_status, 'mpesa', now() - interval '35 days', 'FCRQWE2'),
    (u_admin, 'FCR-TX-3', c1.id, 88000, 'pending'::public.payment_status,   'mpesa', now() - interval '2 days',  'FCRQWE3');

  select * into s from public.finhub_client_summary(c1.id);

  checks := checks + 1;
  if s.invoiced = 80000 and s.paid = 62000 and s.balance = 18000
     and s.invoice_count = 2 and s.overdue_count = 1 and s.payment_count = 2 then
    report := report || E'\n  PASS 13  drafts, cancellations and unconfirmed payments stay out of the balance';
  else
    failures := failures || format('13: summary invoiced=%s paid=%s balance=%s inv=%s overdue=%s pay=%s',
                                   s.invoiced, s.paid, s.balance, s.invoice_count, s.overdue_count, s.payment_count);
  end if;

  -- ---- 14. the statement carries a balance over the whole history --------
  select * into st from public.finhub_client_statement(c1.id, 1);

  checks := checks + 1;
  if st.kind = 'payment' and st.running_balance = 18000 then
    report := report || E'\n  PASS 14  the newest page of the statement still shows a true running balance';
  else
    failures := failures || format('14: newest statement row kind=%s balance=%s',
                                   coalesce(st.kind, 'NONE'), coalesce(st.running_balance, -1));
  end if;

  -- ---- 15. the book totals in Postgres and counts the whole book ---------
  select count(*)::integer, max(b.total_count)::integer
    into n, book_all
    from public.finhub_client_book(p_limit => 1, p_offset => 0) b;

  checks := checks + 1;
  if n = 1 and book_all >= 3 then
    report := report || E'\n  PASS 15  one page comes back, with the true size of the book beside it';
  else
    failures := failures || format('15: book returned %s rows claiming a total of %s', n, book_all);
  end if;

  -- ---- 15b. and the book is ONE company's, not the platform's ------------
  -- The tenant filter is explicit in finhub_client_book rather than left to
  -- RLS, because the clients policy opens to every tenant for a super
  -- administrator — and this tab sits beside invoices and payroll that are
  -- scoped to one company.
  select count(*) into n
    from public.finhub_client_book(p_limit => 500) b
   where b.id = twin;

  checks := checks + 1;
  if n = 0 then
    report := report || E'\n  PASS 15b the book never lists another tenant''s customer';
  else
    failures := failures || '15b: the client book returned a customer belonging to another tenant'::text;
  end if;

  -- ---- 16. a lead in another tenant cannot be converted ------------------
  begin
    perform public.finhub_create_client(p_full_name => 'Not Mine', p_lead_id => lead_b);
    bad := true;
  exception when sqlstate '42501' then
    bad := false;
  end;

  checks := checks + 1;
  if not bad then
    report := report || E'\n  PASS 16  a lead belonging to another tenant is refused (42501)';
  else
    failures := failures || '16: converted a lead belonging to another tenant'::text;
  end if;

  -- ---- 17. finance staff with no agent record can create one too ---------
  perform set_config('request.jwt.claims',
                     json_build_object('sub', u_acct::text, 'role', 'authenticated')::text, true);

  c3 := public.finhub_create_client(
          p_full_name       => 'FCR Logistics Ltd',
          p_kra_pin         => 'P05FCR812M',
          p_billing_address => 'Enterprise Road, Industrial Area');

  checks := checks + 1;
  if c3.id is not null and c3.admin_id = u_admin and c3.agent_id is null then
    report := report || E'\n  PASS 17  an accountant with no agent record can create a client record';
  else
    failures := failures || format('17: accountant creation gave admin=%s agent=%s', c3.admin_id, c3.agent_id);
  end if;

  perform set_config('request.jwt.claims', '{}', true);

  -- ---- verdict ------------------------------------------------------------
  if array_length(failures, 1) is null then
    raise exception E'ALL CHECKS PASSED — % checks. Seed rolled back (this error is intentional).%',
                    checks, report;
  else
    raise exception E'FINHUB CLIENT RECORD FAILURES (% of % checks):\n  - %\n\nPassed:%',
                    array_length(failures, 1), checks,
                    array_to_string(failures, E'\n  - '), report;
  end if;

end
$verify$;

rollback;

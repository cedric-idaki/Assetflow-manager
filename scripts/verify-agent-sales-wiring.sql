-- ===========================================================================
-- AGENT SALES / COMMISSION WIRING — LIVE VERIFICATION
--
-- Proves that 20260828120000 actually wires agents.total_sales and sales
-- commission, including the cases that are easy to get wrong: reversal,
-- re-completion, reassignment, deletion, and NOT clobbering assist commission.
--
-- SAFE TO RUN AGAINST PRODUCTION. Everything happens inside one DO block that
-- ALWAYS ends in RAISE EXCEPTION, so the seed is unwound even if the client is
-- in autocommit and ignores the BEGIN. Success exits NON-ZERO with a message
-- beginning "ALL CHECKS PASSED" — read the message, not the exit code.
--
-- RESULTS TRAVEL IN THE FINAL RAISE, not in NOTICEs: `supabase db query`
-- returns only the error, so anything a reader must see has to be in there.
--
-- RUN IT
--   supabase db query --linked -f scripts/verify-agent-sales-wiring.sql
-- ===========================================================================

begin;

do $verify$
declare
  u_admin  uuid := '00000000-0000-4000-8000-00000000c001';
  u_a1     uuid := '00000000-0000-4000-8000-00000000c002';
  u_a2     uuid := '00000000-0000-4000-8000-00000000c003';

  ag1      uuid;   -- 10% commission
  ag2      uuid;   -- 10% commission, receives a reassigned payment
  pay      uuid;

  sales    numeric;
  comm     numeric;
  ledger   numeric;
  rows_n   integer;
  delta    numeric;

  failures text[] := '{}';
  checks   integer := 0;
  report   text   := '';
begin

  -- =========================================================================
  -- SEED
  -- =========================================================================
  insert into auth.users (id, email, instance_id, aud, role, created_at, updated_at)
  values
    (u_admin, 'wire-admin@example.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (u_a1,    'wire-a1@example.invalid',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
    (u_a2,    'wire-a2@example.invalid',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());

  -- handle_new_user() already made these rows; claim them.
  insert into public.user_profiles (id, email, full_name, role, admin_id)
  values
    (u_admin, 'wire-admin@example.invalid', 'Wire Admin',  'admin'::public.user_role,       null),
    (u_a1,    'wire-a1@example.invalid',    'Wire Agent1', 'sales_agent'::public.user_role, u_admin),
    (u_a2,    'wire-a2@example.invalid',    'Wire Agent2', 'sales_agent'::public.user_role, u_admin)
  on conflict (id) do update
    set email = excluded.email, full_name = excluded.full_name,
        role = excluded.role, admin_id = excluded.admin_id;

  insert into public.agents (user_id, admin_id, agent_code, full_name, email, agent_status, commission_rate)
  values
    (u_a1, u_admin, 'WIRE-A1', 'Wire Agent1', 'wire-a1@example.invalid', 'active', 10.00),
    (u_a2, u_admin, 'WIRE-A2', 'Wire Agent2', 'wire-a2@example.invalid', 'active', 10.00);

  select id into ag1 from public.agents where agent_code = 'WIRE-A1';
  select id into ag2 from public.agents where agent_code = 'WIRE-A2';

  -- Pre-existing ASSIST commission, exactly as the assist triggers leave it:
  -- a wallet credit with NO reference_id, plus the agents increment. If the new
  -- code recomputes commission from anywhere, this is what it destroys.
  insert into public.agent_wallets
    (agent_id, total_earned, total_withdrawn, available_balance, tx_type, description)
  values (ag1, 7000, 0, 7000, 'credit', 'Assist commission — pre-existing');
  update public.agents set total_commission = 7000 where id = ag1;

  -- =========================================================================
  -- 1. A PENDING payment must not count.
  -- =========================================================================
  insert into public.payments (transaction_id, agent_id, client_id, amount, payment_status)
  values ('WIRE-TX-1', ag1, null, 500000, 'pending')
  returning id into pay;

  select total_sales, total_commission into sales, comm from public.agents where id = ag1;
  checks := checks + 1;
  if sales = 0 and comm = 7000 then
    report := report || E'\n  PASS  1  pending payment counts for nothing (sales 0, assist commission intact)';
  else
    failures := failures || format('1: pending payment counted (sales=%s comm=%s)', sales, comm);
  end if;

  -- =========================================================================
  -- 2. Completing it books the sale AND 10% commission.
  -- =========================================================================
  update public.payments set payment_status = 'completed' where id = pay;

  select total_sales, total_commission into sales, comm from public.agents where id = ag1;
  checks := checks + 1;
  if sales = 500000 and comm = 7000 + 50000 then
    report := report || E'\n  PASS  2  completing books KES 500,000 and 10% = KES 50,000 commission';
  else
    failures := failures || format('2: expected sales=500000 comm=57000, got sales=%s comm=%s', sales, comm);
  end if;

  -- Assist commission must have survived: it is still its own ledger row.
  select coalesce(sum(total_earned), 0) into ledger
    from public.agent_wallets where agent_id = ag1 and reference_id is null;
  checks := checks + 1;
  if ledger = 7000 then
    report := report || E'\n  PASS  2b assist commission untouched by the sales path';
  else
    failures := failures || format('2b: assist ledger became %s, expected 7000', ledger);
  end if;

  -- =========================================================================
  -- 3. Re-running the poster pays nothing extra (idempotent).
  -- =========================================================================
  select public.post_payment_commission(pay) into delta;
  select total_commission into comm from public.agents where id = ag1;
  checks := checks + 1;
  if delta = 0 and comm = 57000 then
    report := report || E'\n  PASS  3  re-posting the same payment pays zero (idempotent)';
  else
    failures := failures || format('3: replay paid %s, commission now %s', delta, comm);
  end if;

  -- =========================================================================
  -- 4. REVERSING must move sales DOWN and post a contra entry.
  --    This is the case a `+=` implementation cannot do at all.
  -- =========================================================================
  update public.payments set payment_status = 'reversed' where id = pay;

  select total_sales, total_commission into sales, comm from public.agents where id = ag1;
  select count(*) into rows_n
    from public.agent_wallets
   where reference_id = pay and tx_type = 'adjustment' and total_earned < 0;

  checks := checks + 1;
  if sales = 0 and comm = 7000 and rows_n = 1 then
    report := report || E'\n  PASS  4  reversal drops sales to 0, claws back commission, posts 1 contra entry';
  else
    failures := failures || format('4: sales=%s comm=%s contra_rows=%s (want 0 / 7000 / 1)', sales, comm, rows_n);
  end if;

  -- Nothing was deleted: the ledger keeps both sides of the story.
  select count(*) into rows_n from public.agent_wallets where reference_id = pay;
  checks := checks + 1;
  if rows_n = 2 then
    report := report || E'\n  PASS  4b ledger is append-only — credit and reversal both retained';
  else
    failures := failures || format('4b: expected 2 ledger rows for the payment, found %s', rows_n);
  end if;

  -- =========================================================================
  -- 5. Completing AGAIN must pay again.
  --    A paid_at-style one-shot guard fails here; a delta does not.
  -- =========================================================================
  update public.payments set payment_status = 'completed' where id = pay;

  select total_sales, total_commission into sales, comm from public.agents where id = ag1;
  checks := checks + 1;
  if sales = 500000 and comm = 57000 then
    report := report || E'\n  PASS  5  re-completion pays again (pending->completed->reversed->completed)';
  else
    failures := failures || format('5: expected sales=500000 comm=57000, got %s / %s', sales, comm);
  end if;

  -- =========================================================================
  -- 6. Reassigning the payment must refresh BOTH agents.
  -- =========================================================================
  update public.payments set agent_id = ag2 where id = pay;

  select total_sales into sales from public.agents where id = ag1;
  checks := checks + 1;
  if sales = 0 then
    report := report || E'\n  PASS  6  the old agent loses the sale on reassignment';
  else
    failures := failures || format('6: old agent still holds sales=%s', sales);
  end if;

  select total_sales into sales from public.agents where id = ag2;
  checks := checks + 1;
  if sales = 500000 then
    report := report || E'\n  PASS  6b the new agent gains it';
  else
    failures := failures || format('6b: new agent has sales=%s, expected 500000', sales);
  end if;

  -- =========================================================================
  -- 7. Deleting the payment must take the sale with it.
  -- =========================================================================
  delete from public.payments where id = pay;

  select total_sales into sales from public.agents where id = ag2;
  checks := checks + 1;
  if sales = 0 then
    report := report || E'\n  PASS  7  deleting the payment removes the sale';
  else
    failures := failures || format('7: sales still %s after delete', sales);
  end if;

  -- =========================================================================
  -- 8. Two payments for one agent must SUM, not overwrite.
  -- =========================================================================
  insert into public.payments (transaction_id, agent_id, client_id, amount, payment_status)
  values ('WIRE-TX-2', ag2, null, 200000, 'completed'),
         ('WIRE-TX-3', ag2, null, 300000, 'completed');

  select total_sales into sales from public.agents where id = ag2;
  checks := checks + 1;
  if sales = 500000 then
    report := report || E'\n  PASS  8  multiple payments sum (200k + 300k = 500k)';
  else
    failures := failures || format('8: expected 500000, got %s', sales);
  end if;

  -- =========================================================================
  -- VERDICT — always raises, so the seed can never be committed.
  -- =========================================================================
  if array_length(failures, 1) is null then
    raise exception E'ALL CHECKS PASSED — % checks. Seed rolled back (this error is intentional).%',
                    checks, report;
  else
    raise exception E'AGENT SALES WIRING FAILURES (% of % checks):\n  - %\n\nPassed:%',
                    array_length(failures, 1), checks,
                    array_to_string(failures, E'\n  - '), report;
  end if;

end
$verify$;

-- Belt and braces: the DO block above always raises, which alone unwinds the
-- seed; this rolls back the surrounding transaction for clients that opened one.
rollback;

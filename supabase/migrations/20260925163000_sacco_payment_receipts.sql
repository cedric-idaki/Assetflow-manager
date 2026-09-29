-- ============================================================================
-- SACCO PAYMENT RECEIPTS — share purchases and loan repayments
--
-- Contributions have had a receipt book since 20260801120000: a number on
-- every entry, the method, the reference, the officer who took the money. The
-- two other payments a member makes to the society had none of it.
--
--   LOAN REPAYMENTS were a checkbox. "Mark paid" flipped
--   sacco_loan_schedule.paid and stamped today's date — no amount, no method,
--   no reference, no officer, no number. The "receipt" the screens printed was
--   the schedule row itself, re-drawn on every download.
--
--   SHARE PURCHASES settle in the share engine without any money being taken:
--   a member buys on the internal market and the shares are theirs the same
--   second. The society collects the price afterwards, outside the system, and
--   nothing recorded that it ever did.
--
-- This adds the receipt book for both:
--
--   1. sacco_receipts          one row per payment received — the receipt
--   2. sacco_receipt_lines     what that payment settled: instalments of one
--                              loan, or one share purchase
--   3. sacco_receipt_counters  gapless numbering, per sacco per year
--   4. RPCs                    record a loan repayment / a share purchase
--                              payment, list purchases still awaiting payment,
--                              and period totals
--
-- Design points:
--
--   * A RECEIPT IS ISSUED BY THE DATABASE, IN THE SAME TRANSACTION AS THE
--     PAYMENT. The loan RPC marks the instalments paid and writes the receipt
--     together, so there is no repayment without a receipt and no receipt for
--     a repayment that did not land. Nobody writes these tables directly —
--     there is no INSERT, UPDATE or DELETE policy, and the grants say so too.
--
--   * WHOLE INSTALMENTS ONLY. The schedule records an instalment as paid or
--     not; it has no partial state. The receipt therefore settles whole
--     instalments, and the amount received must equal what they total — the
--     cashier types what the member handed over and the database checks it
--     against what is being settled, so the wrong instalments cannot be
--     receipted by a slip of the mouse.
--
--   * EVERYTHING DOWNSTREAM KEEPS WORKING UNCHANGED. Marking the instalment
--     paid is still the event: the guarantor notice, the arrears flag and the
--     ledger sync (sacco_loan_schedule:<id>:LOAN_REPAY_*) all key on it
--     exactly as before, and closing the loan still releases the guarantors'
--     escrow through the existing trigger on sacco_loans.
--
--   * GAPLESS NUMBERS. RCT-2026-000014. A receipt book is audited for gaps, so
--     the number comes from a counter row locked inside the issuing
--     transaction rather than from a sequence — a rolled-back payment gives
--     its number back instead of leaving a hole.
--
--   * A RECEIPT IS A SNAPSHOT. The member's name and number, the officer's
--     name and the balance left are copied onto it, so a renamed member or a
--     deleted staff account cannot rewrite a receipt already handed out.
--
--   * ONE M-PESA CODE, ONE RECEIPT. Safaricom codes are globally unique, so the
--     same code turning up twice is the same payment receipted twice.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. THE RECEIPTS
-- ----------------------------------------------------------------------------
create table if not exists public.sacco_receipts (
  id                uuid primary key default gen_random_uuid(),
  admin_id          uuid not null,
  sacco_id          uuid not null references public.saccos(id) on delete cascade,
  receipt_no        text not null,
  receipt_type      text not null,
  member_id         uuid references public.sacco_members(id) on delete set null,
  member_name       text not null,
  member_no         text,
  amount            numeric(15,2) not null,
  payment_method    text not null,
  payment_reference text,
  paid_on           date not null,
  -- Loan repayments: the loan, and where it stands once this payment landed.
  loan_id           uuid references public.sacco_loans(id) on delete set null,
  balance_after     numeric(15,2),
  instalments_left  integer,
  -- Share purchases: the holding once the purchase settled.
  shares_after      integer,
  description       text not null,
  notes             text,
  received_by       uuid,
  received_by_name  text,
  created_at        timestamptz not null default now(),
  constraint sacco_receipts_type_chk
    check (receipt_type in ('loan_repayment', 'share_purchase')),
  constraint sacco_receipts_method_chk
    check (payment_method in ('cash', 'bank', 'mpesa', 'card', 'cheque', 'other')),
  constraint sacco_receipts_amount_chk check (amount > 0)
);

create unique index if not exists uq_sacco_receipts_no
  on public.sacco_receipts(sacco_id, receipt_no);
create index if not exists idx_sacco_receipts_admin
  on public.sacco_receipts(admin_id);
create index if not exists idx_sacco_receipts_register
  on public.sacco_receipts(sacco_id, created_at desc);
create index if not exists idx_sacco_receipts_paid_on
  on public.sacco_receipts(sacco_id, paid_on);
create index if not exists idx_sacco_receipts_member
  on public.sacco_receipts(member_id, created_at desc);
create index if not exists idx_sacco_receipts_loan
  on public.sacco_receipts(loan_id) where loan_id is not null;

-- The hard guard behind "one M-Pesa code, one receipt". The RPCs check first
-- so the cashier gets a sentence rather than a constraint name; this catches
-- the two cashiers who press the button in the same second.
create unique index if not exists uq_sacco_receipts_mpesa_ref
  on public.sacco_receipts(admin_id, upper(payment_reference))
  where payment_method = 'mpesa' and payment_reference is not null;

comment on table public.sacco_receipts is
  'Official receipts for money a member paid the society: loan repayments and share purchases. '
  'Issued only by sacco_receipt_loan_repayment() / sacco_receipt_share_purchase(); never edited.';

-- ----------------------------------------------------------------------------
-- 2. WHAT EACH RECEIPT SETTLED
--    The unique indexes are the point: an instalment, or a share purchase, can
--    be receipted exactly once.
-- ----------------------------------------------------------------------------
create table if not exists public.sacco_receipt_lines (
  id               uuid primary key default gen_random_uuid(),
  admin_id         uuid not null,
  sacco_id         uuid not null references public.saccos(id) on delete cascade,
  receipt_id       uuid not null references public.sacco_receipts(id) on delete cascade,
  member_id        uuid references public.sacco_members(id) on delete set null,
  line_no          integer not null,
  schedule_id      uuid references public.sacco_loan_schedule(id) on delete set null,
  share_txn_id     uuid references public.sacco_share_transactions(id) on delete set null,
  description      text not null,
  -- Loan instalment
  period_no        integer,
  due_date         date,
  principal        numeric(15,2) not null default 0,
  interest         numeric(15,2) not null default 0,
  -- Share purchase: the price of the shares, and the buyer's trading fee
  shares           integer,
  price_per_share  numeric(15,2),
  consideration    numeric(18,2) not null default 0,
  fee              numeric(15,2) not null default 0,
  amount           numeric(18,2) not null,
  constraint sacco_receipt_lines_amount_chk check (amount > 0),
  constraint sacco_receipt_lines_one_target_chk
    check (schedule_id is null or share_txn_id is null)
);

create unique index if not exists uq_sacco_receipt_lines_schedule
  on public.sacco_receipt_lines(schedule_id) where schedule_id is not null;
create unique index if not exists uq_sacco_receipt_lines_share_txn
  on public.sacco_receipt_lines(share_txn_id) where share_txn_id is not null;
create index if not exists idx_sacco_receipt_lines_receipt
  on public.sacco_receipt_lines(receipt_id, line_no);
create index if not exists idx_sacco_receipt_lines_member
  on public.sacco_receipt_lines(member_id);

comment on table public.sacco_receipt_lines is
  'What a receipt settled: loan instalments (schedule_id) or one share purchase (share_txn_id). '
  'Each instalment and each purchase appears here at most once.';

-- ----------------------------------------------------------------------------
-- 3. NUMBERING
--    One counter row per sacco per year. The UPDATE takes a row lock that is
--    held to the end of the issuing transaction, so numbers are handed out in
--    order and a rolled-back payment returns its number.
-- ----------------------------------------------------------------------------
create table if not exists public.sacco_receipt_counters (
  sacco_id  uuid not null references public.saccos(id) on delete cascade,
  year      integer not null,
  last_no   integer not null default 0,
  primary key (sacco_id, year)
);

create or replace function public.sacco_receipt_next_no(p_sacco_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer := extract(year from (now() at time zone 'Africa/Nairobi'))::integer;
  v_no   integer;
begin
  insert into public.sacco_receipt_counters as c (sacco_id, year, last_no)
  values (p_sacco_id, v_year, 1)
  on conflict (sacco_id, year) do update set last_no = c.last_no + 1
  returning c.last_no into v_no;

  return format('RCT-%s-%s', v_year, lpad(v_no::text, 6, '0'));
end;
$$;

revoke all on function public.sacco_receipt_next_no(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. PAYMENT TERMS — one set of rules for both kinds of receipt
--    How the member paid, the reference that proves it, and when. Returns the
--    normalised values the receipt is written with.
-- ----------------------------------------------------------------------------
create or replace function public.sacco_receipt_payment_terms(
  p_admin_id   uuid,
  p_method     text,
  p_reference  text,
  p_paid_on    date,
  out method    text,
  out reference text,
  out paid_on   date
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
  v_dup   text;
begin
  method := lower(nullif(trim(coalesce(p_method, '')), ''));
  if method is null or method not in ('cash', 'bank', 'mpesa', 'card', 'cheque', 'other') then
    raise exception 'Choose how the member paid: cash, M-Pesa, bank, cheque, card or other';
  end if;

  reference := nullif(trim(coalesce(p_reference, '')), '');
  -- M-Pesa codes are printed in capitals; store them the way they are quoted.
  if method = 'mpesa' then
    reference := upper(reference);
  end if;

  -- Money that came through a system leaves a reference behind. Cash does not.
  if reference is null and method in ('mpesa', 'bank', 'cheque') then
    raise exception '%',
      case method
        when 'mpesa' then 'Enter the M-Pesa code for this payment'
        when 'bank'  then 'Enter the bank reference for this payment'
        else              'Enter the cheque number for this payment'
      end;
  end if;

  if method = 'mpesa' then
    select r.receipt_no into v_dup
      from public.sacco_receipts r
     where r.admin_id = p_admin_id
       and r.payment_method = 'mpesa'
       and upper(r.payment_reference) = reference
     limit 1;
    if v_dup is not null then
      raise exception 'M-Pesa code % is already receipted on %', reference, v_dup
        using errcode = '23505';
    end if;
  end if;

  paid_on := coalesce(p_paid_on, v_today);
  if paid_on > v_today then
    raise exception 'The payment date cannot be in the future';
  end if;
end;
$$;

revoke all on function public.sacco_receipt_payment_terms(uuid, text, text, date)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. RECORD A LOAN REPAYMENT
--    Settles whole instalments of ONE loan and issues the receipt for them.
-- ----------------------------------------------------------------------------
create or replace function public.sacco_receipt_loan_repayment(
  p_schedule_ids   uuid[],
  p_amount         numeric,
  p_payment_method text,
  p_reference      text default null,
  p_paid_on        date default null,
  p_notes          text default null
)
returns public.sacco_receipts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids        uuid[];
  v_loan_ids   uuid[];
  v_found      integer;
  l            public.sacco_loans%rowtype;
  m            public.sacco_members%rowtype;
  s            record;
  v_admin      uuid;
  v_product    text;
  v_loan_ref   text;
  v_terms      record;
  v_due        numeric := 0;
  v_count      integer := 0;
  v_periods    text;
  v_of         integer;
  v_left       integer;
  v_balance    numeric;
  v_staff      text;
  v_desc       text;
  v_receipt    public.sacco_receipts%rowtype;
begin
  select array_agg(distinct x) into v_ids
    from unnest(coalesce(p_schedule_ids, '{}'::uuid[])) as x
   where x is not null;
  if v_ids is null then
    raise exception 'Choose the instalments this payment settles';
  end if;

  select array_agg(distinct sc.loan_id), count(*)
    into v_loan_ids, v_found
    from public.sacco_loan_schedule sc
   where sc.id = any(v_ids);
  if v_found <> cardinality(v_ids) then
    raise exception 'One or more of those instalments no longer exists — reload the schedule';
  end if;
  if cardinality(v_loan_ids) <> 1 then
    raise exception 'A receipt settles instalments of one loan only';
  end if;

  -- The loan row is the lock: two cashiers receipting the same loan queue up
  -- here instead of both reading the same instalments as unpaid.
  select * into l from public.sacco_loans where id = v_loan_ids[1] for update;
  if l.id is null then
    raise exception 'Loan not found';
  end if;

  perform public.sacco_share_require_staff(l.sacco_id);
  select admin_id into v_admin from public.saccos where id = l.sacco_id;

  if not public.module_enabled('loans', v_admin) then
    raise exception 'The loans module is switched off for this account.'
      using errcode = '42501';
  end if;
  if l.status::text <> 'active' then
    raise exception 'Only an active loan takes repayments — this loan is %', l.status;
  end if;

  select * into v_terms
    from public.sacco_receipt_payment_terms(v_admin, p_payment_method, p_reference, p_paid_on);

  for s in select sc.* from public.sacco_loan_schedule sc
            where sc.id = any(v_ids) order by sc.period_no for update loop
    if coalesce(s.paid, false) then
      raise exception 'Instalment % is already paid', s.period_no;
    end if;
    v_due   := v_due + round(coalesce(s.principal, 0) + coalesce(s.interest, 0), 2);
    v_count := v_count + 1;
  end loop;

  if v_due <= 0 then
    raise exception 'Those instalments have nothing to pay';
  end if;
  if p_amount is null then
    raise exception 'Enter the amount received';
  end if;
  if round(p_amount, 2) <> round(v_due, 2) then
    raise exception 'The amount received (KES %) does not match the % instalment% selected, which total KES %',
      to_char(round(p_amount, 2), 'FM999,999,999,990.00'), v_count,
      case when v_count = 1 then '' else 's' end,
      to_char(round(v_due, 2), 'FM999,999,999,990.00');
  end if;

  select * into m from public.sacco_members where id = l.member_id;
  select p.name into v_product from public.sacco_loan_products p where p.id = l.product_id;
  select up.full_name into v_staff from public.user_profiles up where up.id = auth.uid();

  select string_agg(sc.period_no::text, ', ' order by sc.period_no)
    into v_periods
    from public.sacco_loan_schedule sc where sc.id = any(v_ids);
  select count(*) into v_of from public.sacco_loan_schedule sc where sc.loan_id = l.id;

  -- ── Settle ────────────────────────────────────────────────────────────────
  -- The same write "Mark paid" always made, so every trigger behind it — the
  -- guarantor notice, the arrears flag — fires exactly as it used to.
  update public.sacco_loan_schedule
     set paid = true, paid_date = v_terms.paid_on
   where id = any(v_ids);

  select count(*), coalesce(sum(sc.principal), 0)
    into v_left, v_balance
    from public.sacco_loan_schedule sc
   where sc.loan_id = l.id and coalesce(sc.paid, false) is false;

  -- Fully repaid: close it. The escrow trigger on sacco_loans releases any
  -- guarantor's shares held against it.
  if v_left = 0 then
    update public.sacco_loans set status = 'closed', updated_at = now() where id = l.id;
  end if;

  -- ── Receipt ───────────────────────────────────────────────────────────────
  v_loan_ref := 'LN-' || upper(left(l.id::text, 8));
  v_desc := format('Repayment of %s %s, instalment%s %s of %s',
                   coalesce(v_product, 'loan'), v_loan_ref,
                   case when v_count = 1 then '' else 's' end, v_periods, v_of);

  insert into public.sacco_receipts
    (admin_id, sacco_id, receipt_no, receipt_type, member_id, member_name, member_no,
     amount, payment_method, payment_reference, paid_on,
     loan_id, balance_after, instalments_left,
     description, notes, received_by, received_by_name)
  values
    (v_admin, l.sacco_id, public.sacco_receipt_next_no(l.sacco_id), 'loan_repayment',
     l.member_id, coalesce(m.full_name, 'Member'), nullif(trim(coalesce(m.member_no, '')), ''),
     round(v_due, 2), v_terms.method, v_terms.reference, v_terms.paid_on,
     l.id, round(v_balance, 2), v_left,
     v_desc, nullif(trim(coalesce(p_notes, '')), ''), auth.uid(), coalesce(v_staff, 'Staff'))
  returning * into v_receipt;

  insert into public.sacco_receipt_lines
    (admin_id, sacco_id, receipt_id, member_id, line_no, schedule_id, description,
     period_no, due_date, principal, interest, amount)
  select v_admin, l.sacco_id, v_receipt.id, l.member_id,
         row_number() over (order by sc.period_no), sc.id,
         format('Instalment %s of %s', sc.period_no, v_of),
         sc.period_no, sc.due_date,
         round(coalesce(sc.principal, 0), 2), round(coalesce(sc.interest, 0), 2),
         round(coalesce(sc.principal, 0) + coalesce(sc.interest, 0), 2)
    from public.sacco_loan_schedule sc
   where sc.id = any(v_ids);

  return v_receipt;
end;
$$;

revoke all on function public.sacco_receipt_loan_repayment(uuid[], numeric, text, text, date, text)
  from public, anon, authenticated;
grant execute on function public.sacco_receipt_loan_repayment(uuid[], numeric, text, text, date, text)
  to authenticated;

comment on function public.sacco_receipt_loan_repayment(uuid[], numeric, text, text, date, text) is
  'Settle whole instalments of one active loan and issue the receipt for them, in one transaction. '
  'p_amount must equal the instalments'' principal + interest. Staff only.';

-- ----------------------------------------------------------------------------
-- 6. RECORD PAYMENT FOR A SHARE PURCHASE
--    The share engine settles a purchase without taking money. This is where
--    the society records that it has now been paid, and issues the receipt.
-- ----------------------------------------------------------------------------

-- The rule for "a member's purchase that money is owed on", in one place so
-- the pending list and the receipting RPC cannot disagree about it.
create or replace function public.sacco_receipt_purchase_is_payable(p_txn public.sacco_share_transactions)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_txn.txn_type = 'purchase'
     and p_txn.member_id is not null
     and not coalesce(p_txn.is_treasury, false)
     and coalesce(p_txn.amount, 0) + coalesce(p_txn.fee, 0) > 0
     -- A reversal settles as a mirror trade, which writes a 'purchase' row for
     -- the original seller. Nobody paid for that.
     and not exists (select 1 from public.sacco_share_transfers tr
                      where tr.id = p_txn.transfer_id and tr.trade_type = 'reversal')
     -- A purchase that was itself reversed has been unwound.
     and not exists (select 1 from public.sacco_share_transfers rv
                      where p_txn.transfer_id is not null and rv.reversed_of = p_txn.transfer_id);
$$;

revoke all on function public.sacco_receipt_purchase_is_payable(public.sacco_share_transactions)
  from public, anon, authenticated;

create or replace function public.sacco_receipt_share_purchase(
  p_share_txn_id   uuid,
  p_amount         numeric,
  p_payment_method text,
  p_reference      text default null,
  p_paid_on        date default null,
  p_notes          text default null
)
returns public.sacco_receipts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t         public.sacco_share_transactions%rowtype;
  m         public.sacco_members%rowtype;
  v_admin   uuid;
  v_terms   record;
  v_total   numeric;
  v_seller  text;
  v_staff   text;
  v_desc    text;
  v_dup     text;
  v_receipt public.sacco_receipts%rowtype;
begin
  select * into t from public.sacco_share_transactions where id = p_share_txn_id;
  if t.id is null then
    raise exception 'Share purchase not found';
  end if;

  perform public.sacco_share_require_staff(t.sacco_id);
  select admin_id into v_admin from public.saccos where id = t.sacco_id;

  if not public.module_enabled('shares', v_admin) then
    raise exception 'The shares module is switched off for this account.'
      using errcode = '42501';
  end if;

  if not public.sacco_receipt_purchase_is_payable(t) then
    raise exception 'Only a member''s own share purchase, with money owed on it, can be receipted — '
                    'not a sale, a transfer, a gift or a reversed trade';
  end if;

  -- Serialise receipting of this one purchase; the unique index on
  -- sacco_receipt_lines(share_txn_id) is the backstop.
  perform pg_advisory_xact_lock(hashtextextended('sacco_receipt:' || t.id::text, 0));

  select r.receipt_no into v_dup
    from public.sacco_receipt_lines rl
    join public.sacco_receipts r on r.id = rl.receipt_id
   where rl.share_txn_id = t.id;
  if v_dup is not null then
    raise exception 'This purchase is already receipted on %', v_dup
      using errcode = '23505';
  end if;

  v_total := round(coalesce(t.amount, 0) + coalesce(t.fee, 0), 2);
  if p_amount is null then
    raise exception 'Enter the amount received';
  end if;
  if round(p_amount, 2) <> v_total then
    raise exception 'The amount received (KES %) does not match this purchase, which totals KES %',
      to_char(round(p_amount, 2), 'FM999,999,999,990.00'),
      to_char(v_total, 'FM999,999,999,990.00');
  end if;

  select * into v_terms
    from public.sacco_receipt_payment_terms(v_admin, p_payment_method, p_reference, p_paid_on);

  select * into m from public.sacco_members where id = t.member_id;
  select up.full_name into v_staff from public.user_profiles up where up.id = auth.uid();

  v_seller := case
    when t.counterparty_is_treasury then 'the SACCO treasury'
    else coalesce((select cp.full_name from public.sacco_members cp where cp.id = t.counterparty_id),
                  'another member')
  end;

  v_desc := format('Purchase of %s share%s at KES %s each from %s',
                   to_char(t.shares, 'FM999,999,999,990'),
                   case when t.shares = 1 then '' else 's' end,
                   to_char(t.price_per_share, 'FM999,999,990.00'),
                   v_seller);

  insert into public.sacco_receipts
    (admin_id, sacco_id, receipt_no, receipt_type, member_id, member_name, member_no,
     amount, payment_method, payment_reference, paid_on, shares_after,
     description, notes, received_by, received_by_name)
  values
    (v_admin, t.sacco_id, public.sacco_receipt_next_no(t.sacco_id), 'share_purchase',
     t.member_id, coalesce(m.full_name, 'Member'), nullif(trim(coalesce(m.member_no, '')), ''),
     v_total, v_terms.method, v_terms.reference, v_terms.paid_on, t.balance_after,
     v_desc, nullif(trim(coalesce(p_notes, '')), ''), auth.uid(), coalesce(v_staff, 'Staff'))
  returning * into v_receipt;

  insert into public.sacco_receipt_lines
    (admin_id, sacco_id, receipt_id, member_id, line_no, share_txn_id, description,
     shares, price_per_share, consideration, fee, amount)
  values
    (v_admin, t.sacco_id, v_receipt.id, t.member_id, 1, t.id,
     v_desc || coalesce(' (' || t.txn_no || ')', ''),
     t.shares, round(coalesce(t.price_per_share, 0), 2),
     round(coalesce(t.amount, 0), 2), round(coalesce(t.fee, 0), 2), v_total);

  return v_receipt;
end;
$$;

revoke all on function public.sacco_receipt_share_purchase(uuid, numeric, text, text, date, text)
  from public, anon, authenticated;
grant execute on function public.sacco_receipt_share_purchase(uuid, numeric, text, text, date, text)
  to authenticated;

comment on function public.sacco_receipt_share_purchase(uuid, numeric, text, text, date, text) is
  'Record that a member paid for a settled share purchase and issue the receipt. '
  'p_amount must equal the purchase price plus the buyer''s trading fee. Staff only.';

-- ----------------------------------------------------------------------------
-- 7. PURCHASES STILL AWAITING PAYMENT
--    What the treasurer has to collect: every member purchase with money owed
--    on it and no receipt yet, oldest first.
-- ----------------------------------------------------------------------------
create or replace function public.sacco_receipt_pending_share_purchases(p_member_id uuid default null)
returns table (
  share_txn_id    uuid,
  txn_no          text,
  bought_at       timestamptz,
  member_id       uuid,
  member_name     text,
  member_no       text,
  shares          integer,
  price_per_share numeric,
  consideration   numeric,
  fee             numeric,
  amount_due      numeric,
  seller          text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_sacco uuid := public.sacco_active_sacco_id();
begin
  perform public.sacco_share_require_staff(v_sacco);

  return query
  select t.id, t.txn_no, t.created_at, t.member_id, m.full_name, m.member_no,
         t.shares, round(coalesce(t.price_per_share, 0), 2),
         round(coalesce(t.amount, 0), 2), round(coalesce(t.fee, 0), 2),
         round(coalesce(t.amount, 0) + coalesce(t.fee, 0), 2),
         case when t.counterparty_is_treasury then 'SACCO treasury'
              else coalesce(cp.full_name, 'Another member') end
    from public.sacco_share_transactions t
    join public.sacco_members m on m.id = t.member_id
    left join public.sacco_members cp on cp.id = t.counterparty_id
   where t.sacco_id = v_sacco
     and (p_member_id is null or t.member_id = p_member_id)
     and public.sacco_receipt_purchase_is_payable(t)
     and not exists (select 1 from public.sacco_receipt_lines rl where rl.share_txn_id = t.id)
   order by t.created_at, t.id;
end;
$$;

revoke all on function public.sacco_receipt_pending_share_purchases(uuid) from public, anon, authenticated;
grant execute on function public.sacco_receipt_pending_share_purchases(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. PERIOD TOTALS
--    Grouped by kind and method, over the whole book for the period — the
--    register on screen is a page, so its totals must never come from it.
--    SECURITY INVOKER: RLS supplies the scope, so a member calling it totals
--    their own receipts and nothing else.
-- ----------------------------------------------------------------------------
create or replace function public.sacco_receipt_summary(p_from date default null, p_to date default null)
returns table (
  receipt_type   text,
  payment_method text,
  receipts       integer,
  amount         numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select r.receipt_type, r.payment_method, count(*)::integer, coalesce(sum(r.amount), 0)
    from public.sacco_receipts r
   where r.sacco_id = public.sacco_active_sacco_id()
     and (p_from is null or r.paid_on >= p_from)
     and (p_to   is null or r.paid_on <= p_to)
   group by r.receipt_type, r.payment_method
   order by r.receipt_type, r.payment_method;
$$;

revoke all on function public.sacco_receipt_summary(date, date) from public, anon;
grant execute on function public.sacco_receipt_summary(date, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. RLS AND GRANTS
--    Read-only from every client. Supabase's default privileges hand a new
--    public table ALL to anon and authenticated, so a bare GRANT SELECT would
--    add to a grant of everything — revoke first.
-- ----------------------------------------------------------------------------
alter table public.sacco_receipts         enable row level security;
alter table public.sacco_receipt_lines    enable row level security;
alter table public.sacco_receipt_counters enable row level security;

revoke all on table public.sacco_receipts, public.sacco_receipt_lines, public.sacco_receipt_counters
  from anon, authenticated;
grant select on table public.sacco_receipts, public.sacco_receipt_lines to authenticated;

drop policy if exists "staff_read_sacco_receipts" on public.sacco_receipts;
create policy "staff_read_sacco_receipts" on public.sacco_receipts
  for select to authenticated
  using ((admin_id = public.current_admin_id() and public.is_staff_member()) or public.is_global_viewer());

drop policy if exists "member_read_own_sacco_receipts" on public.sacco_receipts;
create policy "member_read_own_sacco_receipts" on public.sacco_receipts
  for select to authenticated
  using (member_id = public.current_sacco_member_id());

drop policy if exists "staff_read_sacco_receipt_lines" on public.sacco_receipt_lines;
create policy "staff_read_sacco_receipt_lines" on public.sacco_receipt_lines
  for select to authenticated
  using ((admin_id = public.current_admin_id() and public.is_staff_member()) or public.is_global_viewer());

drop policy if exists "member_read_own_sacco_receipt_lines" on public.sacco_receipt_lines;
create policy "member_read_own_sacco_receipt_lines" on public.sacco_receipt_lines
  for select to authenticated
  using (member_id = public.current_sacco_member_id());

-- sacco_receipt_counters: RLS on and no policy at all. Only the SECURITY
-- DEFINER numbering function touches it.

notify pgrst, 'reload schema';

commit;

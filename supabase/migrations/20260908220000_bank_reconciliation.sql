-- ============================================================================
-- BANK CONFIRMATION AND RECONCILIATION
-- ============================================================================
-- WHAT WAS MISSING
-- ----------------
-- A payment was 'completed' because somebody typed it in. For M-Pesa that is
-- almost true — mpesa-callback writes the row from Safaricom's own
-- confirmation — but for a BANK TRANSFER or a CHEQUE, "completed" meant a
-- customer had said they paid and a clerk had believed them. Nothing in the
-- system had ever seen the money.
--
-- There was also no way to answer the other half: given a bank statement, WHICH
-- of these lines are payments we are expecting, which are payments we recorded
-- but never received, and which arrived that nobody has claimed.
--
-- WHAT THIS ADDS
-- --------------
--   1. `bank_transactions` — the statement, imported. One row per line, with a
--      unique fingerprint so re-importing an overlapping statement (which
--      everybody does) does not double-count.
--
--   2. Matching, automatic then manual. Reference first, then amount-and-date.
--      A match is a LINK, never an overwrite: the payment keeps its own figures
--      and gains the statement line that proves them.
--
--   3. A gate. A bank transfer or a cheque cannot be marked 'completed' until
--      a statement line is matched to it. Cash, card and M-Pesa are untouched —
--      cash is in the drawer, and the other two are confirmed by their own
--      provider before the row is written.
--
-- ---------------------------------------------------------------------------
-- WHY THE GATE IS ON FOR TWO METHODS AND NOT ALL FIVE
--
-- Because a control that stops real work gets switched off, and one that never
-- fires is decoration. Cash sales would grind to a halt behind a reconciliation
-- nobody can do for notes in a till. M-Pesa already has Safaricom's
-- confirmation. Bank transfers and cheques are precisely the two where the only
-- evidence was somebody's word — a cheque can bounce a week later, and a
-- transfer "sent this morning" may never arrive.
--
-- The gate refuses the TRANSITION, not the record. A payment can still be taken
-- and sat at 'pending' all day; what it cannot do is claim to be settled.
--
-- Idempotent -- safe to re-run.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. THE STATEMENT
--
--    `fingerprint` is what makes a re-import safe. Statements are pulled with
--    overlapping date ranges as a matter of routine, and a bank line carries
--    no id of its own, so the row is identified by what it says: account, date,
--    amount, and the bank's own reference or description.
-- ---------------------------------------------------------------------------
create table if not exists public.bank_transactions (
  id             uuid primary key default gen_random_uuid(),
  admin_id       uuid,

  bank_account   text not null default 'default',
  txn_date       date not null,
  value_date     date,
  description    text,
  bank_reference text,
  amount         numeric(15,2) not null check (amount <> 0),
  direction      text not null default 'credit',
  running_balance numeric(15,2),
  currency       text not null default 'KES',

  status         text not null default 'unmatched',
  matched_payment_id uuid references public.payments(id) on delete set null,
  matched_at     timestamptz,
  matched_by     uuid,
  match_method   text,                     -- reference | amount_date | manual
  review_note    text,

  import_batch   uuid,
  imported_by    uuid,
  fingerprint    text not null,
  created_at     timestamptz not null default now(),

  constraint bank_transactions_direction_chk check (direction in ('credit', 'debit')),
  constraint bank_transactions_status_chk
    check (status in ('unmatched', 'matched', 'ignored', 'review'))
);

create unique index if not exists uq_bank_txn_fingerprint
  on public.bank_transactions (admin_id, fingerprint);
create index if not exists idx_bank_txn_admin_date on public.bank_transactions (admin_id, txn_date desc);
create index if not exists idx_bank_txn_status     on public.bank_transactions (admin_id, status);
create index if not exists idx_bank_txn_payment    on public.bank_transactions (matched_payment_id);

comment on table public.bank_transactions is
  'Imported bank statement lines. One row per line; fingerprint makes re-importing an overlapping statement idempotent.';
comment on column public.bank_transactions.matched_payment_id is
  'The payment this line proves. A LINK, not an overwrite -- the payment keeps its own figures and gains the evidence for them.';

-- ---------------------------------------------------------------------------
-- 2. WHAT THE PAYMENT KNOWS ABOUT ITS OWN EVIDENCE
-- ---------------------------------------------------------------------------
alter table public.payments
  add column if not exists bank_confirmed       boolean not null default false,
  add column if not exists bank_confirmed_at    timestamptz,
  add column if not exists bank_txn_id          uuid references public.bank_transactions(id) on delete set null,
  add column if not exists reconciliation_status text not null default 'pending';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payments_reconciliation_status_chk'
  ) then
    alter table public.payments
      add constraint payments_reconciliation_status_chk
      check (reconciliation_status in ('pending', 'confirmed', 'failed', 'review', 'not_required'));
  end if;
end
$$;

comment on column public.payments.bank_confirmed is
  'True once a statement line has been matched to this payment. NOT the same as payment_status: a payment can be recorded, and even taken, long before the money is seen.';
comment on column public.payments.reconciliation_status is
  'pending | confirmed | failed | review | not_required. not_required is set for cash, which has no statement line to wait for.';

-- Cash never needs a statement line, so it must not sit in the "pending" pile
-- for ever making the queue look permanently behind.
update public.payments
   set reconciliation_status = 'not_required'
 where payment_method = 'cash'::public.payment_method
   and reconciliation_status = 'pending';

create index if not exists idx_payments_reconciliation
  on public.payments (admin_id, reconciliation_status)
  where reconciliation_status in ('pending', 'review');

-- ---------------------------------------------------------------------------
-- 3. THE GATE
--
--    See the header for why exactly two methods. The message names the payment
--    and says what to do, because the person hitting this is a clerk with a
--    customer in front of them, not a developer.
-- ---------------------------------------------------------------------------
create or replace function public.payments_require_bank_confirmation()
returns trigger
language plpgsql
as $$
begin
  if new.payment_status = 'completed'::public.payment_status
     and coalesce(old.payment_status, 'pending'::public.payment_status) <> 'completed'::public.payment_status
     and new.payment_method in ('bank_transfer'::public.payment_method, 'cheque'::public.payment_method)
     and not coalesce(new.bank_confirmed, false)
  then
    raise exception
      'Payment % cannot be completed until the % is seen on a bank statement. Import the statement and match it, or leave the payment pending.',
      coalesce(new.transaction_id, new.id::text),
      case new.payment_method when 'cheque'::public.payment_method then 'cheque clearing' else 'transfer' end
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists payments_bank_confirmation_gate on public.payments;
create trigger payments_bank_confirmation_gate
  before update on public.payments
  for each row execute function public.payments_require_bank_confirmation();

-- Cash payments are marked not_required the moment they are written, so the
-- backfill above does not have to be re-run for every new row.
create or replace function public.payments_set_reconciliation_default()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' and new.payment_method = 'cash'::public.payment_method then
    new.reconciliation_status := 'not_required';
  end if;
  return new;
end;
$$;

drop trigger if exists payments_reconciliation_default on public.payments;
create trigger payments_reconciliation_default
  before insert on public.payments
  for each row execute function public.payments_set_reconciliation_default();

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
alter table public.bank_transactions enable row level security;

drop policy if exists bank_transactions_select on public.bank_transactions;
create policy bank_transactions_select on public.bank_transactions
  for select to authenticated
  using (
    public.is_global_viewer()
    or (admin_id is not null and admin_id = public.current_admin_id() and public.is_staff_member())
  );

revoke all on public.bank_transactions from anon;
grant select on public.bank_transactions to authenticated;

-- ---------------------------------------------------------------------------
-- 5. IMPORT
--
--    Takes the parsed statement as jsonb rather than a file: parsing a bank's
--    CSV is a presentation problem (every bank exports a different shape) and
--    belongs where it can be shown to a human before it is committed.
--
--    Returns what happened, not just a count. "Imported 240 lines" when 200 of
--    them were duplicates of yesterday's import is a number that hides the
--    thing you wanted to know.
-- ---------------------------------------------------------------------------
create or replace function public.import_bank_transactions(
  p_rows         jsonb,
  p_bank_account text default 'default'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin   uuid := public.current_admin_id();
  v_batch   uuid := gen_random_uuid();
  r         jsonb;
  v_new     integer := 0;
  v_dupe    integer := 0;
  v_bad     integer := 0;
  v_fp      text;
  v_amount  numeric;
  v_date    date;
begin
  if not public.is_staff_member() then
    raise exception 'Only staff may import a bank statement.' using errcode = '42501';
  end if;
  if v_admin is null then
    raise exception 'No tenant to import into.' using errcode = 'P0001';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin
      v_date   := (r->>'txn_date')::date;
      v_amount := round((r->>'amount')::numeric, 2);
    exception when others then
      -- A line the parser could not read is counted and skipped, never
      -- guessed at: an invented date or amount is worse than a missing line,
      -- because it will silently match the wrong payment.
      v_bad := v_bad + 1;
      continue;
    end;

    if v_date is null or v_amount is null or v_amount = 0 then
      v_bad := v_bad + 1;
      continue;
    end if;

    v_fp := md5(concat_ws('|', p_bank_account, v_date::text, v_amount::text,
                          coalesce(nullif(btrim(r->>'bank_reference'), ''),
                                   btrim(coalesce(r->>'description', '')))));

    insert into public.bank_transactions
      (admin_id, bank_account, txn_date, value_date, description, bank_reference,
       amount, direction, running_balance, currency, import_batch, imported_by, fingerprint)
    values
      (v_admin, p_bank_account, v_date,
       nullif(r->>'value_date', '')::date,
       nullif(btrim(coalesce(r->>'description', '')), ''),
       nullif(btrim(coalesce(r->>'bank_reference', '')), ''),
       abs(v_amount),
       case when v_amount < 0 then 'debit' else coalesce(nullif(r->>'direction', ''), 'credit') end,
       nullif(r->>'running_balance', '')::numeric,
       coalesce(nullif(r->>'currency', ''), 'KES'),
       v_batch, auth.uid(), v_fp)
    on conflict (admin_id, fingerprint) do nothing;

    if found then v_new := v_new + 1; else v_dupe := v_dupe + 1; end if;
  end loop;

  return jsonb_build_object(
    'batch_id',   v_batch,
    'imported',   v_new,
    'duplicates', v_dupe,
    'unreadable', v_bad);
end;
$$;

revoke execute on function public.import_bank_transactions(jsonb, text) from public, anon;
grant  execute on function public.import_bank_transactions(jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. AUTOMATIC MATCHING
--
--    Two passes, strongest evidence first.
--
--      Pass 1  REFERENCE. The statement line carries the payment's reference
--              (an M-Pesa code, a transfer narration the customer was told to
--              use). Exact, case-insensitive, and it is allowed to match a
--              payment of a different amount -- because a mismatch there is
--              exactly the thing a human needs to look at, so it lands in
--              'review' rather than being silently skipped.
--
--      Pass 2  AMOUNT AND DATE. Same amount, within the window, and EXACTLY
--              ONE candidate. Two candidates is not a weak match, it is an
--              ambiguous one, and guessing between them puts the wrong
--              customer's receipt on the wrong money.
-- ---------------------------------------------------------------------------
create or replace function public.bank_reconcile_auto(p_window_days integer default 3)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin  uuid := public.current_admin_id();
  t        record;
  -- Scalars, not a record: PL/pgSQL cannot reset a record between loop passes,
  -- so a miss on this line would still be holding the previous line's match.
  v_pay_id uuid;
  v_pay_amt numeric;
  v_pay_ref text;
  v_hits   integer;
  v_lo     date;
  v_hi     date;
  v_ref    integer := 0;
  v_amt    integer := 0;
  v_rev    integer := 0;
begin
  if not public.is_staff_member() then
    raise exception 'Only staff may reconcile.' using errcode = '42501';
  end if;

  for t in
    select * from public.bank_transactions
     where admin_id = v_admin and status = 'unmatched' and direction = 'credit'
     order by txn_date
  loop
    v_pay_id  := null;
    v_pay_amt := null;
    v_pay_ref := null;
    v_lo := t.txn_date - greatest(coalesce(p_window_days, 0), 0);
    v_hi := t.txn_date + greatest(coalesce(p_window_days, 0), 0);

    -- Pass 1: the reference.
    if coalesce(btrim(t.bank_reference), '') <> '' then
      select p.id, p.amount, coalesce(p.transaction_id, p.id::text)
        into v_pay_id, v_pay_amt, v_pay_ref
        from public.payments p
       where p.admin_id = v_admin
         and not coalesce(p.bank_confirmed, false)
         and (upper(btrim(coalesce(p.reference_number, ''))) = upper(btrim(t.bank_reference))
              or upper(btrim(coalesce(p.transaction_id, ''))) = upper(btrim(t.bank_reference)))
       limit 1;

      if v_pay_id is not null then
        -- A reference match whose amount disagrees is the single most useful
        -- thing this whole function produces. Flag it; do not swallow it.
        if round(v_pay_amt, 2) <> round(t.amount, 2) then
          update public.bank_transactions
             set status = 'review', match_method = 'reference',
                 review_note = format('Reference matches payment %s, but the statement says %s and the payment says %s.',
                                      v_pay_ref, t.amount, v_pay_amt)
           where id = t.id;
          update public.payments set reconciliation_status = 'review' where id = v_pay_id;
          v_rev := v_rev + 1;
          continue;
        end if;

        perform public.bank_match_payment(t.id, v_pay_id, 'reference');
        v_ref := v_ref + 1;
        continue;
      end if;
    end if;

    -- Pass 2: amount and date, but only when there is no ambiguity.
    select count(*) into v_hits
      from public.payments p
     where p.admin_id = v_admin
       and not coalesce(p.bank_confirmed, false)
       and round(p.amount, 2) = round(t.amount, 2)
       and p.payment_date::date between v_lo and v_hi;

    if v_hits = 1 then
      select p.id into v_pay_id
        from public.payments p
       where p.admin_id = v_admin
         and not coalesce(p.bank_confirmed, false)
         and round(p.amount, 2) = round(t.amount, 2)
         and p.payment_date::date between v_lo and v_hi;
      perform public.bank_match_payment(t.id, v_pay_id, 'amount_date');
      v_amt := v_amt + 1;
    elsif v_hits > 1 then
      update public.bank_transactions
         set status = 'review', match_method = 'amount_date',
             review_note = format('%s payments of %s fall in this window — pick the right one by hand.', v_hits, t.amount)
       where id = t.id;
      v_rev := v_rev + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'matched_by_reference', v_ref,
    'matched_by_amount',    v_amt,
    'needs_review',         v_rev);
end;
$$;

revoke execute on function public.bank_reconcile_auto(integer) from public, anon;
grant  execute on function public.bank_reconcile_auto(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. MATCH, UNMATCH, IGNORE
--
--    One writer for the link, so the two sides can never disagree about
--    whether a payment is confirmed.
-- ---------------------------------------------------------------------------
create or replace function public.bank_match_payment(
  p_txn_id     uuid,
  p_payment_id uuid,
  p_method     text default 'manual'
)
returns public.bank_transactions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t public.bank_transactions%rowtype;
  p public.payments%rowtype;
begin
  if not public.is_staff_member() then
    raise exception 'Only staff may match a bank line.' using errcode = '42501';
  end if;

  select * into t from public.bank_transactions where id = p_txn_id for update;
  if t.id is null then raise exception 'Statement line not found.' using errcode = 'P0002'; end if;
  select * into p from public.payments where id = p_payment_id for update;
  if p.id is null then raise exception 'Payment not found.' using errcode = 'P0002'; end if;

  if t.matched_payment_id is not null and t.matched_payment_id <> p_payment_id then
    raise exception 'That statement line is already matched to another payment. Unmatch it first.'
      using errcode = 'P0001';
  end if;

  update public.bank_transactions
     set matched_payment_id = p_payment_id,
         status = 'matched', matched_at = now(), matched_by = auth.uid(),
         match_method = coalesce(nullif(btrim(p_method), ''), 'manual'),
         review_note = null
   where id = p_txn_id
  returning * into t;

  update public.payments
     set bank_confirmed = true,
         bank_confirmed_at = now(),
         bank_txn_id = p_txn_id,
         reconciliation_status = 'confirmed'
   where id = p_payment_id;

  return t;
end;
$$;

revoke execute on function public.bank_match_payment(uuid, uuid, text) from public, anon;
grant  execute on function public.bank_match_payment(uuid, uuid, text) to authenticated;

create or replace function public.bank_unmatch_payment(p_txn_id uuid, p_reason text default null)
returns public.bank_transactions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t public.bank_transactions%rowtype;
begin
  if not public.is_staff_member() then
    raise exception 'Only staff may unmatch a bank line.' using errcode = '42501';
  end if;

  select * into t from public.bank_transactions where id = p_txn_id for update;
  if t.id is null then raise exception 'Statement line not found.' using errcode = 'P0002'; end if;

  if t.matched_payment_id is not null then
    -- The payment goes back to unconfirmed. It does NOT go back to pending on
    -- payment_status: unmatching is a correction to the evidence, not a claim
    -- that the money was returned.
    update public.payments
       set bank_confirmed = false, bank_confirmed_at = null,
           bank_txn_id = null, reconciliation_status = 'review'
     where id = t.matched_payment_id;
  end if;

  update public.bank_transactions
     set matched_payment_id = null, status = 'unmatched',
         matched_at = null, matched_by = null, match_method = null,
         review_note = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_txn_id
  returning * into t;

  return t;
end;
$$;

revoke execute on function public.bank_unmatch_payment(uuid, text) from public, anon;
grant  execute on function public.bank_unmatch_payment(uuid, text) to authenticated;

create or replace function public.bank_ignore_transaction(p_txn_id uuid, p_reason text)
returns public.bank_transactions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare t public.bank_transactions%rowtype;
begin
  if not public.is_staff_member() then
    raise exception 'Only staff may set a bank line aside.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    -- A line dismissed without a reason is a line nobody can defend later.
    raise exception 'Say why this line is being set aside.' using errcode = 'P0001';
  end if;

  update public.bank_transactions
     set status = 'ignored', review_note = btrim(p_reason), matched_at = now(), matched_by = auth.uid()
   where id = p_txn_id and matched_payment_id is null
  returning * into t;

  if t.id is null then
    raise exception 'That line could not be set aside — it may already be matched.' using errcode = 'P0001';
  end if;
  return t;
end;
$$;

revoke execute on function public.bank_ignore_transaction(uuid, text) from public, anon;
grant  execute on function public.bank_ignore_transaction(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. THE POSITION
--
--    SECURITY INVOKER, so the figures are the caller's own tenant's. Answers
--    the question the brief asks in one call: what is pending, confirmed,
--    failed or needs review, on both sides of the reconciliation.
-- ---------------------------------------------------------------------------
create or replace function public.bank_reconciliation_summary()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'payments', (
      select coalesce(jsonb_object_agg(s, jsonb_build_object('count', c, 'amount', a)), '{}'::jsonb)
        from (select reconciliation_status as s, count(*) as c, coalesce(sum(amount), 0) as a
                from public.payments group by reconciliation_status) q),
    'statement', (
      select coalesce(jsonb_object_agg(s, jsonb_build_object('count', c, 'amount', a)), '{}'::jsonb)
        from (select status as s, count(*) as c, coalesce(sum(amount), 0) as a
                from public.bank_transactions group by status) q),
    'unclaimed_credits', (
      -- Money in the account that no payment explains. The figure a treasurer
      -- actually wants: somebody paid and nobody recorded it.
      select coalesce(sum(amount), 0) from public.bank_transactions
       where status = 'unmatched' and direction = 'credit')
  );
$$;

revoke execute on function public.bank_reconciliation_summary() from public, anon;
grant  execute on function public.bank_reconciliation_summary() to authenticated;

notify pgrst, 'reload schema';

commit;

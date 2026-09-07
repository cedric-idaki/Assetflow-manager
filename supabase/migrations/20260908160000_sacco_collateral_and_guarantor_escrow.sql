-- ============================================================================
-- WHAT ACTUALLY BACKS A SACCO LOAN
-- ============================================================================
-- Three gaps, all the same shape: the society could RECORD who was standing
-- behind a loan, and could do nothing about it.
--
--   1. COLLATERAL had nowhere to live. A member pledging a logbook, a title
--      deed or a valued machine had a `purpose` free-text box and that was all.
--      Nothing captured the asset, its value or the proof of ownership, so a
--      recovery had no paper behind it.
--
--   2. THE GUARANTOR'S SHARES NEVER MOVED. 20260904160000 has the guarantor
--      consent "to their deposits and shares being attached", 20260905160000
--      has that consent executed through SignNow -- and then the shares sat in
--      their ordinary balance, sellable on the internal market the same
--      afternoon. The promise was recorded and unenforced.
--
--   3. THE GUARANTOR HEARD NOTHING AFTER SAYING YES. No notice on a repayment,
--      none on a missed one. The first a guarantor learns that the loan they
--      backed has gone bad is the society coming for their shares -- which is
--      the moment it is least defensible.
--
-- ---------------------------------------------------------------------------
-- THE ESCROW IS THE WITHHOLDING REGISTER, NOT A NEW MECHANISM
--
-- 20260901120000 already has exactly this: shares held back from a member,
-- with a reason_type, a reference, an outstanding balance, a release path, an
-- append-only history, and a guard that stops withheld shares being listed,
-- transferred or edited away. It even has 'loan_security' in its reason list.
-- Building a second lock beside it would give the share engine two sources of
-- truth about the same shares, and the guard only knows about one.
--
-- So a signed guarantee opens a withholding, and repayment closes it.
--
-- ---------------------------------------------------------------------------
-- WHY sacco_share_withhold IS SPLIT IN TWO HERE
--
-- That function begins with sacco_share_require_staff(). Correct for the desk
-- -- a treasurer withholding a member's shares is a deliberate act by staff --
-- and fatal for this: the escrow has to open when the GUARANTOR signs and
-- close when the BORROWER makes their last payment, and neither of them is
-- staff. auth.uid() is still the caller inside a SECURITY DEFINER function, so
-- there is no way to satisfy the check from a member's session.
--
-- The body is therefore lifted into `_core` functions that take the sacco
-- explicitly and check nothing, and the existing public functions become thin
-- wrappers that resolve the sacco, require staff, and delegate. Same
-- arithmetic, same events, same guard -- one copy of it. The `_core` functions
-- are revoked from every client role, so the only ways in are the staff
-- wrapper and this file's own triggers.
--
-- Idempotent -- safe to re-run.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. BELL VOCABULARY
--    ADD VALUE is transaction-safe on PG12+ provided the value is not USED in
--    the same transaction. It is not: the only uses are inside function bodies
--    below, which are parsed now and executed long after this commits.
-- ---------------------------------------------------------------------------
alter type public.audit_action add value if not exists 'guarantor_repayment';
alter type public.audit_action add value if not exists 'guarantor_arrears';

-- ============================================================================
-- PART A -- COLLATERAL
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A1. THE PLEDGE
--
--     One row per asset pledged against one loan. The VALUE is recorded as at
--     a date and never revalued in place: what the committee lent against is
--     the figure they were shown, and quietly updating it would rewrite the
--     basis of a decision already taken. A revaluation is a new row.
-- ---------------------------------------------------------------------------
create table if not exists public.sacco_loan_collateral (
  id                uuid primary key default gen_random_uuid(),
  admin_id          uuid,
  sacco_id          uuid not null references public.saccos(id) on delete cascade,
  loan_id           uuid not null references public.sacco_loans(id) on delete cascade,
  member_id         uuid not null references public.sacco_members(id) on delete cascade,

  asset_type        text not null default 'other',
  asset_reference   text not null,          -- logbook no., title deed no., serial
  asset_description text,
  estimated_value   numeric(15,2) not null check (estimated_value > 0),
  valuation_date    date,
  valuer            text,

  -- The proof. A bare object name in the private bucket, never a URL: a URL in
  -- a column outlives the token in it and starts returning 400s.
  document_path     text,
  document_name     text,

  status            text not null default 'pledged',
  released_at       timestamptz,
  release_reason    text,

  notes             text,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint sacco_loan_collateral_status_chk
    check (status in ('pledged', 'released', 'realised')),
  constraint sacco_loan_collateral_type_chk
    check (asset_type in ('vehicle', 'land', 'building', 'machinery', 'equipment',
                          'livestock', 'stock', 'receivable', 'deposit', 'other'))
);

create index if not exists idx_sacco_loan_collateral_loan   on public.sacco_loan_collateral (loan_id);
create index if not exists idx_sacco_loan_collateral_member on public.sacco_loan_collateral (member_id);
create index if not exists idx_sacco_loan_collateral_sacco  on public.sacco_loan_collateral (sacco_id, status);

comment on table public.sacco_loan_collateral is
  'Assets a member has pledged against a loan: what it is, what it was valued at and on what date, and the ownership or valuation document behind it.';
comment on column public.sacco_loan_collateral.estimated_value is
  'The value AS PRESENTED with the application. Never revalued in place -- the committee lent against this figure, and a later opinion is a new row.';
comment on column public.sacco_loan_collateral.document_path is
  'Object name in the private sacco-loan-collateral bucket, pathed <admin_id>/<loan_id>/<file>. Not a URL.';

-- ---------------------------------------------------------------------------
-- A2. RLS
--     A member sees their own pledges; the society's staff see all of theirs.
--     Writes go through the RPCs below, so there is no INSERT/UPDATE policy.
-- ---------------------------------------------------------------------------
alter table public.sacco_loan_collateral enable row level security;

drop policy if exists sacco_loan_collateral_select on public.sacco_loan_collateral;
create policy sacco_loan_collateral_select on public.sacco_loan_collateral
  for select to authenticated
  using (
    member_id = public.current_sacco_member_id()
    or exists (
      select 1 from public.saccos s
       where s.id = sacco_loan_collateral.sacco_id
         and (s.admin_id = public.current_admin_id() or public.is_global_viewer())
    )
  );

revoke all on public.sacco_loan_collateral from anon;
grant select on public.sacco_loan_collateral to authenticated;

-- ---------------------------------------------------------------------------
-- A3. PLEDGE AND RELEASE
--
--     A pledge may be added while the loan is still being decided, and NOT
--     after it is closed -- attaching security to a settled loan would put a
--     charge on an asset nothing is owed against.
-- ---------------------------------------------------------------------------
create or replace function public.sacco_loan_pledge_collateral(
  p_loan_id           uuid,
  p_asset_reference   text,
  p_estimated_value   numeric,
  p_asset_type        text default 'other',
  p_asset_description text default null,
  p_valuation_date    date default null,
  p_valuer            text default null,
  p_document_path     text default null,
  p_document_name     text default null,
  p_notes             text default null
)
returns public.sacco_loan_collateral
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  l   public.sacco_loans%rowtype;
  v_me uuid := public.current_sacco_member_id();
  v_admin uuid;
  v_row public.sacco_loan_collateral%rowtype;
begin
  select * into l from public.sacco_loans where id = p_loan_id;
  if l.id is null then
    raise exception 'Loan not found.' using errcode = 'P0002';
  end if;

  -- The borrower, or the society's own staff acting for them.
  if not (l.member_id = v_me
          or exists (select 1 from public.saccos s
                      where s.id = l.sacco_id
                        and (s.admin_id = public.current_admin_id() or public.is_global_viewer())))
  then
    raise exception 'Not your loan.' using errcode = '42501';
  end if;

  if l.status::text in ('closed', 'rejected', 'written_off') then
    raise exception 'A % loan cannot take new security.', l.status using errcode = 'P0001';
  end if;

  if nullif(btrim(coalesce(p_asset_reference, '')), '') is null then
    raise exception 'Security needs a reference -- a logbook, title deed or serial number.'
      using errcode = 'P0001';
  end if;
  if coalesce(p_estimated_value, 0) <= 0 then
    raise exception 'Security needs a value greater than zero.' using errcode = 'P0001';
  end if;

  select admin_id into v_admin from public.saccos where id = l.sacco_id;

  insert into public.sacco_loan_collateral
    (admin_id, sacco_id, loan_id, member_id, asset_type, asset_reference,
     asset_description, estimated_value, valuation_date, valuer,
     document_path, document_name, notes, created_by)
  values
    (v_admin, l.sacco_id, l.id, l.member_id,
     coalesce(nullif(btrim(p_asset_type), ''), 'other'),
     btrim(p_asset_reference), nullif(btrim(coalesce(p_asset_description, '')), ''),
     round(p_estimated_value, 2), p_valuation_date, nullif(btrim(coalesce(p_valuer, '')), ''),
     nullif(btrim(coalesce(p_document_path, '')), ''),
     nullif(btrim(coalesce(p_document_name, '')), ''),
     nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.sacco_loan_pledge_collateral(uuid, text, numeric, text, text, date, text, text, text, text) from public, anon;
grant  execute on function public.sacco_loan_pledge_collateral(uuid, text, numeric, text, text, date, text, text, text, text) to authenticated;

create or replace function public.sacco_loan_release_collateral(p_id uuid, p_reason text default null)
returns public.sacco_loan_collateral
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.sacco_loan_collateral%rowtype;
begin
  select * into c from public.sacco_loan_collateral where id = p_id for update;
  if c.id is null then
    raise exception 'Security not found.' using errcode = 'P0002';
  end if;

  -- Releasing security is the society's decision, never the borrower's: a
  -- member who could release their own charge could clear it the day before
  -- defaulting.
  if not exists (select 1 from public.saccos s
                  where s.id = c.sacco_id
                    and (s.admin_id = public.current_admin_id() or public.is_global_viewer()))
  then
    raise exception 'Only the society may release security.' using errcode = '42501';
  end if;

  update public.sacco_loan_collateral
     set status = 'released', released_at = now(),
         release_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
   where id = p_id
  returning * into c;

  return c;
end;
$$;

revoke execute on function public.sacco_loan_release_collateral(uuid, text) from public, anon;
grant  execute on function public.sacco_loan_release_collateral(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- A4. THE DOCUMENT BUCKET
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sacco-loan-collateral', 'sacco-loan-collateral', false, 26214400,
  array['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "sacco_collateral_tenant_read"   on storage.objects;
drop policy if exists "sacco_collateral_tenant_insert" on storage.objects;
drop policy if exists "sacco_collateral_tenant_delete" on storage.objects;

create policy "sacco_collateral_tenant_read"
on storage.objects for select to authenticated
using (
  bucket_id = 'sacco-loan-collateral'
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
);

create policy "sacco_collateral_tenant_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'sacco-loan-collateral'
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
);

create policy "sacco_collateral_tenant_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'sacco-loan-collateral'
  and (public.storage_path_is_own_tenant(name) or public.is_global_viewer())
);

-- ============================================================================
-- PART B -- THE GUARANTOR'S SHARES
-- ============================================================================

-- ---------------------------------------------------------------------------
-- B1. SPLIT THE WITHHOLDING FUNCTIONS
--     See the header. Body unchanged; the sacco comes in as an argument and
--     the staff check moves to the wrapper.
-- ---------------------------------------------------------------------------
create or replace function public.sacco_share_withhold_core(
  p_sacco_id    uuid,
  p_member_id   uuid,
  p_shares      integer,
  p_reason_type text,
  p_reason      text,
  p_reference   text default null,
  p_notes       text default null,
  p_actor       uuid default null
)
returns public.sacco_share_withholdings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sacco uuid := p_sacco_id;
  v_admin uuid;
  h       public.sacco_shares%rowtype;
  m       public.sacco_members%rowtype;
  l       record;
  w       public.sacco_share_withholdings%rowtype;
  v_need  integer;
  v_free  integer;
  v_unit  numeric;
  v_id    uuid;
begin
  if coalesce(p_shares, 0) <= 0 then
    raise exception 'Withhold at least one share';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Withholding a member''s shares needs a reason';
  end if;

  select * into m from public.sacco_members where id = p_member_id and sacco_id = v_sacco;
  if m.id is null then raise exception 'Member not found'; end if;

  select * into h from public.sacco_share_holding(v_sacco, p_member_id);

  if p_shares > h.shares_held - coalesce((
       select sum(w2.outstanding_shares) from public.sacco_share_withholdings w2
        where w2.sacco_id = v_sacco and w2.member_id = p_member_id and w2.status <> 'closed'), 0)
  then
    raise exception 'This member holds % shares, of which % are already withheld — cannot withhold % more',
      h.shares_held,
      coalesce((select sum(w2.outstanding_shares) from public.sacco_share_withholdings w2
                 where w2.sacco_id = v_sacco and w2.member_id = p_member_id and w2.status <> 'closed'), 0),
      p_shares;
  end if;

  -- Free up escrow if the member has shares out on the market.
  v_free := h.shares_held - h.locked_shares - h.withheld_shares;
  if v_free < p_shares then
    v_need := p_shares - v_free;
    for l in select * from public.sacco_share_listings
              where sacco_id = v_sacco and seller_member_id = p_member_id
                and side = 'sell' and status = 'open' and withholding_id is null
              order by created_at desc loop
      exit when v_need <= 0;
      perform public.sacco_share_cancel_order(l.id, 'Shares withheld by the society');
      v_need := v_need - greatest(l.shares - l.filled_shares, 0);
    end loop;

    select * into h from public.sacco_share_holding(v_sacco, p_member_id);
    if h.shares_held - h.locked_shares - h.withheld_shares < p_shares then
      raise exception 'Only % shares are free to withhold — % of this member''s % are committed to trades already in flight',
        greatest(h.shares_held - h.locked_shares - h.withheld_shares, 0),
        h.locked_shares, h.shares_held;
    end if;
  end if;

  select admin_id into v_admin from public.saccos where id = v_sacco;
  v_unit := public.sacco_share_unit_value(v_sacco);

  insert into public.sacco_share_withholdings
    (admin_id, sacco_id, member_id, ref_no, shares, reason_type, reason,
     reference, unit_value, notes, created_by)
  values
    (v_admin, v_sacco, p_member_id,
     'WH-' || lpad(nextval('public.sacco_share_withholding_seq')::text, 6, '0'),
     p_shares, coalesce(nullif(btrim(p_reason_type), ''), 'other'), btrim(p_reason),
     nullif(btrim(coalesce(p_reference, '')), ''), coalesce(v_unit, 0),
     nullif(btrim(coalesce(p_notes, '')), ''), coalesce(p_actor, auth.uid()))
  returning * into w;
  v_id := w.id;

  perform public.sacco_share_withholding_sync(v_sacco, p_member_id);
  perform public.sacco_share_withholding_event(v_id, 'withheld', p_shares, v_unit, null, null, btrim(p_reason));
  perform public.sacco_share_log(v_sacco, 'withholding', v_id, 'withheld', p_member_id,
    null, to_jsonb(w), btrim(p_reason));

  select * into w from public.sacco_share_withholdings where id = v_id;
  return w;
end;
$$;

revoke all on function public.sacco_share_withhold_core(uuid, uuid, integer, text, text, text, text, uuid)
  from public, anon, authenticated;

-- The desk's door. Unchanged signature, unchanged behaviour.
create or replace function public.sacco_share_withhold(
  p_member_id   uuid,
  p_shares      integer,
  p_reason_type text,
  p_reason      text default null,
  p_reference   text default null,
  p_notes       text default null
)
returns public.sacco_share_withholdings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sacco uuid := public.sacco_active_sacco_id();
begin
  perform public.sacco_share_require_staff(v_sacco);
  return public.sacco_share_withhold_core(
    v_sacco, p_member_id, p_shares, p_reason_type, p_reason, p_reference, p_notes, auth.uid());
end;
$$;

revoke all on function public.sacco_share_withhold(uuid, integer, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.sacco_share_withhold(uuid, integer, text, text, text, text)
  to authenticated;

create or replace function public.sacco_share_withholding_release_core(
  p_id     uuid,
  p_shares integer default null,
  p_reason text    default null
)
returns public.sacco_share_withholdings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w      public.sacco_share_withholdings%rowtype;
  v_qty  integer;
  v_old  jsonb;
  v_held integer;
  v_id   uuid;
begin
  select * into w from public.sacco_share_withholdings where id = p_id for update;
  if w.id is null then raise exception 'Withholding not found'; end if;

  if w.status = 'closed' then
    raise exception 'Withholding % is already closed', w.ref_no;
  end if;

  v_held := greatest(w.outstanding_shares - w.listed_shares, 0);
  v_qty  := least(coalesce(nullif(p_shares, 0), v_held), v_held);

  if v_qty <= 0 then
    if w.listed_shares > 0 then
      raise exception 'All % outstanding shares on % are on the market — cancel the sale order first',
        w.outstanding_shares, w.ref_no;
    end if;
    raise exception 'Nothing left to release on %', w.ref_no;
  end if;

  v_old := to_jsonb(w);
  v_id  := w.id;

  update public.sacco_share_withholdings
     set released_shares = released_shares + v_qty, updated_at = now()
   where id = v_id
  returning * into w;

  perform public.sacco_share_withholding_sync(w.sacco_id, w.member_id);
  perform public.sacco_share_withholding_event(v_id, 'released', v_qty, w.unit_value, null, null, p_reason);
  perform public.sacco_share_log(w.sacco_id, 'withholding', v_id, 'released', w.member_id,
    v_old, to_jsonb(w), p_reason);

  select * into w from public.sacco_share_withholdings where id = v_id;
  return w;
end;
$$;

revoke all on function public.sacco_share_withholding_release_core(uuid, integer, text)
  from public, anon, authenticated;

create or replace function public.sacco_share_withholding_release(
  p_id     uuid,
  p_shares integer default null,
  p_reason text    default null
)
returns public.sacco_share_withholdings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_sacco uuid;
begin
  select sacco_id into v_sacco from public.sacco_share_withholdings where id = p_id;
  if v_sacco is null then raise exception 'Withholding not found'; end if;
  perform public.sacco_share_require_staff(v_sacco);
  return public.sacco_share_withholding_release_core(p_id, p_shares, p_reason);
end;
$$;

revoke all on function public.sacco_share_withholding_release(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.sacco_share_withholding_release(uuid, integer, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- B2. THE LINK BETWEEN A GUARANTEE AND ITS HOLD
-- ---------------------------------------------------------------------------
alter table public.sacco_loan_guarantees
  add column if not exists escrow_withholding_id uuid references public.sacco_share_withholdings(id) on delete set null,
  add column if not exists escrow_shares         integer,
  add column if not exists escrow_locked_at      timestamptz,
  add column if not exists escrow_released_at    timestamptz;

comment on column public.sacco_loan_guarantees.escrow_withholding_id is
  'The withholding this guarantee opened against the guarantor''s shares. NULL until the agreement is executed; the shares are locked by the ordinary withholding register, not a second mechanism.';
comment on column public.sacco_loan_guarantees.escrow_shares is
  'How many shares the hold covers, priced at the unit value on the day it was taken. Not recomputed as the share price moves -- the hold secures a fixed sum.';

-- ---------------------------------------------------------------------------
-- B3. LOCK
--
--     Runs when the agreement is executed. Idempotent: a second call on a
--     guarantee that already holds shares returns quietly rather than
--     doubling the hold, because a webhook that fires twice is normal.
-- ---------------------------------------------------------------------------
create or replace function public.sacco_guarantee_escrow_lock(p_guarantee_id uuid)
returns public.sacco_loan_guarantees
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  g       public.sacco_loan_guarantees%rowtype;
  v_unit  numeric;
  v_shares integer;
  v_loan  text;
  w       public.sacco_share_withholdings%rowtype;
begin
  select * into g from public.sacco_loan_guarantees where id = p_guarantee_id for update;
  if g.id is null then
    raise exception 'Guarantee not found.' using errcode = 'P0002';
  end if;

  if g.escrow_withholding_id is not null then
    return g;                       -- already held; nothing to do
  end if;

  if g.status <> 'accepted' then
    raise exception 'Only a confirmed guarantee can put shares on hold; this one is %.', g.status
      using errcode = 'P0001';
  end if;

  v_unit := public.sacco_share_unit_value(g.sacco_id);
  if coalesce(v_unit, 0) <= 0 then
    raise exception 'This society has no share price set, so the hold cannot be sized.'
      using errcode = 'P0001';
  end if;

  -- Round UP. A hold that is one share short of the sum guaranteed is a hold
  -- that does not cover it.
  v_shares := ceil(g.amount_guaranteed / v_unit)::integer;

  select 'Loan ' || coalesce(l.id::text, '') into v_loan
    from public.sacco_loans l where l.id = g.loan_id;

  w := public.sacco_share_withhold_core(
    g.sacco_id,
    g.guarantor_member_id,
    v_shares,
    'loan_security',
    format('Guarantee %s — shares held until the loan is repaid.', g.ref_no),
    g.ref_no,
    'Opened automatically when the guarantee agreement was executed.',
    null);

  update public.sacco_loan_guarantees
     set escrow_withholding_id = w.id,
         escrow_shares         = v_shares,
         escrow_locked_at      = now(),
         updated_at            = now()
   where id = p_guarantee_id
  returning * into g;

  perform public.sacco_loan_guarantee_notify(
    g.guarantor_member_id, 'guarantor_response', g.id,
    format('%s of your shares are now held as security for guarantee %s. They cannot be sold or withdrawn until the loan is repaid.',
           v_shares, g.ref_no),
    'warning');

  return g;
end;
$$;

revoke execute on function public.sacco_guarantee_escrow_lock(uuid) from public, anon;
grant  execute on function public.sacco_guarantee_escrow_lock(uuid) to authenticated;

comment on function public.sacco_guarantee_escrow_lock(uuid) is
  'Put the guarantor''s shares on hold for a confirmed guarantee. Called by the signing trigger, and callable by the society for a guarantee executed on paper.';

-- ---------------------------------------------------------------------------
-- B4. RELEASE
-- ---------------------------------------------------------------------------
create or replace function public.sacco_guarantee_escrow_release(
  p_guarantee_id uuid,
  p_reason       text default null
)
returns public.sacco_loan_guarantees
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  g public.sacco_loan_guarantees%rowtype;
begin
  select * into g from public.sacco_loan_guarantees where id = p_guarantee_id for update;
  if g.id is null then
    raise exception 'Guarantee not found.' using errcode = 'P0002';
  end if;
  if g.escrow_withholding_id is null or g.escrow_released_at is not null then
    return g;
  end if;

  -- Release everything still outstanding. Shares already SOLD to recover on a
  -- default are gone and stay gone; release only touches what is still held.
  perform public.sacco_share_withholding_release_core(
    g.escrow_withholding_id, null,
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''),
             format('Loan repaid — guarantee %s discharged.', g.ref_no)));

  update public.sacco_loan_guarantees
     set escrow_released_at = now(), updated_at = now()
   where id = p_guarantee_id
  returning * into g;

  perform public.sacco_loan_guarantee_notify(
    g.guarantor_member_id, 'guarantor_response', g.id,
    format('Your shares held under guarantee %s have been released. The loan you backed is settled.', g.ref_no),
    'info');

  return g;
end;
$$;

revoke execute on function public.sacco_guarantee_escrow_release(uuid, text) from public, anon;
grant  execute on function public.sacco_guarantee_escrow_release(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- B5. LOCK ON SIGNATURE
--
--     Guarded by to_regclass because the signing layer (20260901160000 /
--     20260905160000) is optional and may not be applied. Where it is not, the
--     society calls sacco_guarantee_escrow_lock() itself -- a guarantee
--     executed on paper still has to bind the shares.
-- ---------------------------------------------------------------------------
create or replace function public.sacco_guarantee_escrow_on_signed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.doc_kind = 'guarantee_agreement'
     and new.status in ('signed', 'released')
     and coalesce(old.status, '') not in ('signed', 'released')
  then
    -- A failure here must not roll back the signature. The document IS signed;
    -- refusing to record that because the guarantor's shares happen to be
    -- mid-trade would lose the executed agreement and leave nothing at all.
    begin
      perform public.sacco_guarantee_escrow_lock(new.source_id);
    exception when others then
      raise warning 'Guarantee % signed but shares not held: %', new.source_id, sqlerrm;
    end;
  end if;
  return null;
end;
$$;

revoke all on function public.sacco_guarantee_escrow_on_signed() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.signing_requests') is not null then
    execute 'drop trigger if exists escrow_on_guarantee_signed on public.signing_requests';
    execute 'create trigger escrow_on_guarantee_signed
               after update of status on public.signing_requests
               for each row execute function public.sacco_guarantee_escrow_on_signed()';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- B6. RELEASE ON REPAYMENT
--
--     When the loan closes, every hold it opened comes off.
-- ---------------------------------------------------------------------------
create or replace function public.sacco_guarantee_escrow_on_loan_closed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  g record;
begin
  if new.status::text not in ('closed', 'repaid', 'settled')
     or old.status::text = new.status::text then
    return null;
  end if;

  for g in select id from public.sacco_loan_guarantees
            where loan_id = new.id
              and escrow_withholding_id is not null
              and escrow_released_at is null loop
    begin
      perform public.sacco_guarantee_escrow_release(g.id, 'Loan repaid in full.');
    exception when others then
      -- One guarantor's shares stuck on the market must not stop the others
      -- being freed, nor block the loan closing.
      raise warning 'Could not release the hold on guarantee %: %', g.id, sqlerrm;
    end;
  end loop;

  return null;
end;
$$;

revoke all on function public.sacco_guarantee_escrow_on_loan_closed() from public, anon, authenticated;

drop trigger if exists escrow_release_on_loan_closed on public.sacco_loans;
create trigger escrow_release_on_loan_closed
  after update of status on public.sacco_loans
  for each row execute function public.sacco_guarantee_escrow_on_loan_closed();

-- ============================================================================
-- PART C -- TELLING THE GUARANTOR WHAT IS HAPPENING
-- ============================================================================

-- ---------------------------------------------------------------------------
-- C1. EVERY REPAYMENT
--
--     A guarantor's exposure falls with each instalment, and a guarantor who
--     can see that is one who does not have to ring the office to find out.
--     Fires on the schedule row being marked paid, which is the one event that
--     means "money arrived against this loan" however it was posted.
-- ---------------------------------------------------------------------------
create or replace function public.sacco_guarantee_notify_repayment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  g          record;
  v_borrower text;
  v_balance  numeric;
begin
  if not (new.paid is true and coalesce(old.paid, false) is false) then
    return null;
  end if;

  select m.full_name into v_borrower
    from public.sacco_loans l
    join public.sacco_members m on m.id = l.member_id
   where l.id = new.loan_id;

  -- What is still owed after this instalment, read off the schedule rather
  -- than recomputed: those rows are what the borrower's contract says.
  select coalesce(sum(s.principal + s.interest), 0) into v_balance
    from public.sacco_loan_schedule s
   where s.loan_id = new.loan_id and coalesce(s.paid, false) is false;

  for g in select id, guarantor_member_id, ref_no
             from public.sacco_loan_guarantees
            where loan_id = new.loan_id and status = 'accepted' loop
    perform public.sacco_loan_guarantee_notify(
      g.guarantor_member_id, 'guarantor_repayment', g.id,
      format('%s has made a repayment on the loan you guaranteed (%s). Instalment %s of the schedule is settled; %s remains outstanding.',
             coalesce(v_borrower, 'The borrower'), g.ref_no, new.period_no,
             'KES ' || to_char(v_balance, 'FM999,999,999,990.00')),
      'info');
  end loop;

  return null;
end;
$$;

revoke all on function public.sacco_guarantee_notify_repayment() from public, anon, authenticated;

drop trigger if exists notify_guarantors_on_repayment on public.sacco_loan_schedule;
create trigger notify_guarantors_on_repayment
  after update of paid on public.sacco_loan_schedule
  for each row execute function public.sacco_guarantee_notify_repayment();

-- ---------------------------------------------------------------------------
-- C2. A MISSED ONE
--
--     Separate from the repayment notice on purpose, and the more important of
--     the two: an instalment going unpaid is the first moment a guarantor's
--     own money is genuinely at risk, and it is the notice they will ask why
--     they never got.
--
--     ONCE PER INSTALMENT, not once per sweep. `arrears_notified_at` is what
--     makes a nightly job idempotent -- without it a loan three months down
--     would send the same warning every night until the guarantor stopped
--     reading them.
-- ---------------------------------------------------------------------------
alter table public.sacco_loan_schedule
  add column if not exists arrears_notified_at timestamptz;

comment on column public.sacco_loan_schedule.arrears_notified_at is
  'When the guarantors were warned this instalment was missed. Stops a nightly sweep re-sending the same warning; NULL means not yet warned.';

create or replace function public.sacco_guarantee_arrears_sweep(p_grace_days integer default 3)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r       record;
  g       record;
  v_sent  integer := 0;
begin
  for r in
    select s.id, s.loan_id, s.period_no, s.due_date,
           (s.principal + s.interest) as amount_due,
           l.member_id
      from public.sacco_loan_schedule s
      join public.sacco_loans l on l.id = s.loan_id
     where coalesce(s.paid, false) is false
       and s.due_date < current_date - make_interval(days => greatest(coalesce(p_grace_days, 0), 0))
       and s.arrears_notified_at is null
       and l.status::text not in ('closed', 'rejected', 'written_off')
       and exists (select 1 from public.sacco_loan_guarantees gg
                    where gg.loan_id = l.id and gg.status = 'accepted')
  loop
    for g in select id, guarantor_member_id, ref_no
               from public.sacco_loan_guarantees
              where loan_id = r.loan_id and status = 'accepted' loop
      perform public.sacco_loan_guarantee_notify(
        g.guarantor_member_id, 'guarantor_arrears', g.id,
        format('A payment on the loan you guaranteed (%s) is overdue. Instalment %s of %s was due on %s and has not been received.',
               g.ref_no, r.period_no,
               'KES ' || to_char(r.amount_due, 'FM999,999,999,990.00'),
               to_char(r.due_date, 'DD Mon YYYY')),
        'warning');
      v_sent := v_sent + 1;
    end loop;

    update public.sacco_loan_schedule set arrears_notified_at = now() where id = r.id;
  end loop;

  return v_sent;
end;
$$;

revoke all on function public.sacco_guarantee_arrears_sweep(integer) from public, anon, authenticated;
-- The nightly job runs as service_role, the same way sacco_governance_run_due does.
grant execute on function public.sacco_guarantee_arrears_sweep(integer) to service_role;

comment on function public.sacco_guarantee_arrears_sweep(integer) is
  'Warn the guarantors of every loan carrying an instalment overdue by more than the grace period. Idempotent per instalment via sacco_loan_schedule.arrears_notified_at. Called by the sacco-governance-tick job.';

-- A payment arriving late clears the flag, so the NEXT time that instalment
-- falls behind (a reversal, a bounced cheque) the guarantors are told again.
create or replace function public.sacco_clear_arrears_flag()
returns trigger
language plpgsql
as $$
begin
  if new.paid is true and coalesce(old.paid, false) is false then
    new.arrears_notified_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_arrears_flag_on_payment on public.sacco_loan_schedule;
create trigger clear_arrears_flag_on_payment
  before update of paid on public.sacco_loan_schedule
  for each row execute function public.sacco_clear_arrears_flag();

notify pgrst, 'reload schema';

commit;

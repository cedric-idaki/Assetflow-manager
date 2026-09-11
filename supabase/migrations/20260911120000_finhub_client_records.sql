-- ============================================================================
-- THE FINHUB CLIENT RECORD
-- ============================================================================
-- WHAT WAS MISSING
-- ----------------
-- A sales agent closes a lead. To bill that person the tenant needs a row in
-- public.clients -- that is what company_invoices.client_id points at, what
-- payments.client_id points at, and what payment_requests.client_id points at.
-- There were three unrelated ways to create one and not one of them could tell
-- you whether the person was already on file:
--
--   1. asset-client-management  the full KYC form. `ACC-${Date.now()}` for an
--                               account number, no duplicate check.
--   2. CreateClientModal        the agent's own form. Prefills from a lead,
--                               writes the lead id into an AUDIT LINE and
--                               nowhere else. No duplicate check.
--   3. create_cash_customer()   the counter. Name only, no lead, no check.
--
-- So the same buyer becomes two client records the moment two people write
-- them down, or one person converts the same lead twice. Two records means two
-- balances, two payment histories, and an invoice raised against whichever one
-- the operator happened to pick out of the dropdown. Nothing downstream can
-- merge them afterwards, because the invoices have already been issued.
--
-- WHAT THIS ADDS
-- --------------
--   clients.lead_id            The originating lead, ON THE CLIENT ROW, with a
--                              UNIQUE index. One lead produces exactly one
--                              client record, enforced by Postgres rather than
--                              by whichever screen happens to be open.
--
--                              The link is deliberately ASYMMETRIC. A customer
--                              may enquire again next year, so many leads can
--                              close onto one record -- that is what
--                              leads.converted_ref_id says, and it is not
--                              unique. clients.lead_id says something narrower:
--                              which lead this record CAME FROM. It is set
--                              once and never rewritten.
--
--   finhub_find_client_duplicates()   Who is already on file that looks like
--                              this? Asked BEFORE the record is written, so
--                              the answer is a choice rather than a rejection.
--
--   finhub_create_client()     One creation path for agents and finance staff.
--                              Minimum billing identity, the lead link, and a
--                              server-side duplicate refusal as the backstop.
--
--   finhub_client_summary()    Invoiced, paid, balance -- for one client.
--   finhub_client_statement()  The payment history, with a running balance.
--   finhub_client_book()       The same figures for the whole book, a page at
--                              a time.
--
-- WHY THE DUPLICATE GATE IS BOTH A SEARCH AND A REFUSAL
-- -----------------------------------------------------
-- A search alone is advice, and advice is skipped. A refusal alone is a wall
-- in front of somebody who knows perfectly well that two people share a name.
-- So the search is what the screen shows, and the refusal is what the database
-- does to any caller that did not look -- a second tab, an import, or a future
-- screen nobody has written yet. p_force is how a human overrides it, and the
-- override is recorded on the row.
--
-- WHY THE BALANCE IS DERIVED AND NOT STORED
-- -----------------------------------------
-- clients.outstanding_balance already exists and means something else: the
-- hire-purchase receivable the collections hub maintains. A second stored
-- number for the invoice balance would be a second thing to keep in step, and
-- the two would disagree within a week. The invoice balance is therefore read
-- out of company_invoices and payments every time it is asked for, and the
-- hire-purchase figure is reported beside it under its own name.
--
-- WHY THE READ FUNCTIONS ARE SECURITY INVOKER
-- -------------------------------------------
-- They aggregate over clients, company_invoices and payments. RLS on those
-- tables already says who may see what; running as the caller means the scope
-- comes from the policies instead of from a hand-rolled tenant check that will
-- drift from them. Same decision 20260822140000 made for the SACCO dashboard.
--
-- Idempotent -- safe to re-run.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. THE COLUMNS A BILLING IDENTITY NEEDS
--
--    Most of these are already live; several were added to this database
--    outside the migration history and so cannot be replayed from it. Asserting
--    them here makes the file stand on its own on a fresh database and changes
--    nothing on this one.
-- ---------------------------------------------------------------------------
alter table public.clients add column if not exists kra_pin          text;
alter table public.clients add column if not exists physical_address text;
alter table public.clients add column if not exists postal_address   text;
alter table public.clients add column if not exists agent_id         uuid;
alter table public.clients add column if not exists kyc_status       text default 'unverified';

-- THE LINK. Not a convenience: this is the anti-duplicate mechanism.
alter table public.clients
  add column if not exists lead_id uuid references public.leads(id) on delete set null;

comment on column public.clients.lead_id is
  'The lead this client record came out of. UNIQUE where not null: converting the same lead twice returns the first record instead of making a second one.';

-- ---------------------------------------------------------------------------
-- 2. BACKFILL THE LINK FROM THE CONVERSION STAMP
--
--    leads.converted_ref_id has pointed at the client since 20260725140000, so
--    the history is already there -- it just points the wrong way for the
--    question this feature asks ("has this person got a record?").
--
--    DISTINCT ON because the stamp was never unique: two leads for the same
--    buyer could both be marked converted against one client. The earliest
--    conversion wins and the others stay unlinked, which is the honest answer
--    -- a second lead did not create a second record.
-- ---------------------------------------------------------------------------
update public.clients c
   set lead_id = pick.lead_id
  from (
    select distinct on (l.converted_ref_id)
           l.converted_ref_id as client_id,
           l.id               as lead_id
      from public.leads l
     where l.converted_entity = 'client'
       and l.converted_ref_id is not null
     order by l.converted_ref_id, l.converted_at nulls last, l.created_at
  ) pick
 where pick.client_id = c.id
   and c.lead_id is null;

create unique index if not exists idx_clients_lead_unique
  on public.clients (lead_id)
  where lead_id is not null;

create index if not exists idx_clients_admin_lower_email
  on public.clients (admin_id, lower(email));
create index if not exists idx_clients_admin_kra_pin
  on public.clients (admin_id, kra_pin)
  where kra_pin is not null;

-- ---------------------------------------------------------------------------
-- 3. NORMALISATION
--
--    "0712 345 678", "+254712345678" and "254 712 345678" are one phone
--    number, and a duplicate check that compares them as text finds nothing.
--    Nine digits is the whole of a Kenyan subscriber number, so that is what
--    gets compared; anything shorter is not a number worth matching on.
-- ---------------------------------------------------------------------------
create or replace function public.normalise_msisdn(p_phone text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $fn$
  select case
    when length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) < 9 then null
    else right(regexp_replace(p_phone, '[^0-9]', '', 'g'), 9)
  end;
$fn$;

create or replace function public.normalise_identifier(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $fn$
  select nullif(upper(regexp_replace(coalesce(p_value, ''), '[^A-Za-z0-9]', '', 'g')), '');
$fn$;

create or replace function public.normalise_email(p_email text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $fn$
  select nullif(lower(btrim(coalesce(p_email, ''))), '');
$fn$;

create or replace function public.normalise_person_name(p_name text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $fn$
  select nullif(lower(regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g')), '');
$fn$;

comment on function public.normalise_msisdn(text) is
  'The last nine digits of a phone number: the part that identifies the subscriber however the number was typed.';
comment on function public.normalise_identifier(text) is
  'Letters and digits only, upper-cased. Compares KRA PINs and national IDs written with spaces, dashes or mixed case.';

-- ---------------------------------------------------------------------------
-- 4. WHO IS ALREADY ON FILE THAT LOOKS LIKE THIS?
--
--    SECURITY INVOKER: the tenant scope is the clients policy, not an argument.
--    A client-portal user calling this sees their own row and nothing else,
--    which is exactly what their policy already allows.
--
--    Name is deliberately the weakest signal and never qualifies on its own --
--    "John Mwangi" is not evidence, and a list full of near-namesakes trains
--    people to click past the warning.
-- ---------------------------------------------------------------------------
--    THE SCAN TAKES ITS TENANT AS AN ARGUMENT, and the wrapper below supplies
--    it from the session. That split exists for one reason: finhub_create_client
--    is SECURITY DEFINER, and a SECURITY INVOKER function called from inside it
--    runs as the definer too -- RLS off, every tenant visible. The creation path
--    therefore has to name the tenant it is checking, or its "duplicate" check
--    would silently read the whole platform.
create or replace function public.finhub_client_duplicate_scan(
  p_admin_id    uuid,
  p_full_name   text    default null,
  p_email       text    default null,
  p_phone       text    default null,
  p_kra_pin     text    default null,
  p_national_id text    default null,
  p_exclude_id  uuid    default null,
  p_limit       integer default 10
)
returns table (
  id                  uuid,
  account_number      text,
  full_name           text,
  email               text,
  phone               text,
  kra_pin             text,
  customer_type       text,
  client_status       text,
  lead_id             uuid,
  outstanding_balance numeric,
  created_at          timestamptz,
  matched_on          text[],
  match_score         integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  with needle as (
    select public.normalise_email(p_email)            as email_k,
           public.normalise_msisdn(p_phone)           as phone_k,
           public.normalise_identifier(p_kra_pin)     as pin_k,
           public.normalise_identifier(p_national_id) as id_k,
           public.normalise_person_name(p_full_name)  as name_k
  ),
  hit as (
    select c.id, c.account_number, c.full_name, c.email, c.phone, c.kra_pin,
           c.customer_type::text as customer_type,
           c.client_status::text as client_status,
           c.lead_id, c.outstanding_balance, c.created_at,
           array_remove(array[
             case when n.pin_k   is not null and public.normalise_identifier(c.kra_pin)     = n.pin_k   then 'kra_pin'     end,
             case when n.id_k    is not null and public.normalise_identifier(c.national_id) = n.id_k    then 'national_id' end,
             case when n.phone_k is not null and public.normalise_msisdn(c.phone)           = n.phone_k then 'phone'       end,
             case when n.email_k is not null and public.normalise_email(c.email)            = n.email_k then 'email'       end,
             case when n.name_k  is not null and public.normalise_person_name(c.full_name)  = n.name_k  then 'name'        end
           ], null) as matched_on
      from public.clients c
      cross join needle n
     where (p_exclude_id is null or c.id <> p_exclude_id)
       and (p_admin_id   is null or c.admin_id = p_admin_id)
  )
  select h.id, h.account_number, h.full_name, h.email, h.phone, h.kra_pin,
         h.customer_type, h.client_status, h.lead_id, h.outstanding_balance,
         h.created_at, h.matched_on,
         -- Weighted by how hard the signal is to share by accident. A tax PIN
         -- is one legal person; a name is a coincidence waiting to happen.
         ( case when 'kra_pin'     = any(h.matched_on) then 50 else 0 end
         + case when 'national_id' = any(h.matched_on) then 40 else 0 end
         + case when 'phone'       = any(h.matched_on) then 30 else 0 end
         + case when 'email'       = any(h.matched_on) then 25 else 0 end
         + case when 'name'        = any(h.matched_on) then 10 else 0 end
         )::integer as match_score
    from hit h
   where array_length(h.matched_on, 1) is not null
     and h.matched_on <> array['name']::text[]   -- a name on its own is not a duplicate
   order by match_score desc, h.created_at
   limit greatest(coalesce(p_limit, 10), 1);
$fn$;

revoke execute on function public.finhub_client_duplicate_scan(uuid, text, text, text, text, text, uuid, integer) from public, anon;
grant  execute on function public.finhub_client_duplicate_scan(uuid, text, text, text, text, text, uuid, integer) to authenticated;

-- What the screen calls. The tenant comes from the session, and for the super
-- administrator it is deliberately left open: they have no tenant of their own,
-- and a duplicate check that finds too much is the safe direction to err in.
create or replace function public.finhub_find_client_duplicates(
  p_full_name   text    default null,
  p_email       text    default null,
  p_phone       text    default null,
  p_kra_pin     text    default null,
  p_national_id text    default null,
  p_exclude_id  uuid    default null,
  p_limit       integer default 10
)
returns table (
  id                  uuid,
  account_number      text,
  full_name           text,
  email               text,
  phone               text,
  kra_pin             text,
  customer_type       text,
  client_status       text,
  lead_id             uuid,
  outstanding_balance numeric,
  created_at          timestamptz,
  matched_on          text[],
  match_score         integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  select *
    from public.finhub_client_duplicate_scan(
           case when public.is_global_viewer() then null else public.current_admin_id() end,
           p_full_name, p_email, p_phone, p_kra_pin, p_national_id, p_exclude_id, p_limit);
$fn$;

revoke execute on function public.finhub_find_client_duplicates(text, text, text, text, text, uuid, integer) from public, anon;
grant  execute on function public.finhub_find_client_duplicates(text, text, text, text, text, uuid, integer) to authenticated;

comment on function public.finhub_find_client_duplicates(text, text, text, text, text, uuid, integer) is
  'Existing client records sharing a tax PIN, ID, phone, email or exact name with the details being entered. Ranked; a name alone never qualifies.';

-- ---------------------------------------------------------------------------
-- 5. CREATE THE RECORD
--
--    SECURITY DEFINER, because three of the things it must do cannot be done
--    by the caller: stamping the lead (a finance clerk has no write policy on
--    an agent's lead), reading across the tenant to find duplicates the
--    caller's own policy may hide, and refusing itself. Every one of those is
--    a reason the rule has to live below the screen.
--
--    THE MINIMUM IS A NAME. Everything else is optional on purpose: an invoice
--    needs a bill-to name and a number, and a required field is a field
--    somebody will type "x" into. The PIN is prompted for rather than required
--    because without it the document is a bill, not a tax invoice -- that is a
--    warning to show, not a door to lock.
-- ---------------------------------------------------------------------------
create or replace function public.finhub_create_client(
  p_full_name       text,
  p_phone           text    default null,
  p_email           text    default null,
  p_kra_pin         text    default null,
  p_national_id     text    default null,
  p_billing_address text    default null,
  p_customer_type   text    default 'account',
  p_lead_id         uuid    default null,
  p_agent_id        uuid    default null,
  p_notes           text    default null,
  p_use_existing    uuid    default null,
  p_force           boolean default false
)
returns public.clients
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_admin   uuid := public.current_admin_id();
  v_row     public.clients%rowtype;
  v_lead    public.leads%rowtype;
  v_agent   uuid := p_agent_id;
  v_name    text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_type    public.customer_type;
  v_acct    text;
  v_dupes   text;
  v_matched integer;
begin
  if not public.is_staff_member() then
    raise exception 'Only staff may create a client record.' using errcode = '42501';
  end if;

  -- The one required field, checked before anything else touches the database.
  -- Without it the not-null on full_name would report this as a schema error at
  -- the end of a long function, which tells the person at the screen nothing.
  if v_name is null and p_use_existing is null then
    raise exception 'A client record needs a name.' using errcode = 'P0001';
  end if;

  v_type := coalesce(nullif(btrim(coalesce(p_customer_type, '')), ''), 'account')::public.customer_type;

  -- ── The lead, if this is a conversion ──────────────────────────────────
  if p_lead_id is not null then
    select l.* into v_lead from public.leads l where l.id = p_lead_id;
    if v_lead.id is null then
      raise exception 'That lead no longer exists.' using errcode = 'P0002';
    end if;
    -- Reach, mirroring the leads policies: my tenant owns it, I am the agent
    -- working it, it belongs to an agent of my tenant, or I am the platform.
    if not (
         public.is_global_viewer()
      or (v_lead.admin_id is not null and v_lead.admin_id = v_admin)
      or (v_lead.agent_id is not null and v_lead.agent_id = public.get_agent_id_for_user(auth.uid()))
      or (v_lead.agent_id is not null and v_lead.agent_id in (select public.tenant_agent_ids()))
    ) then
      raise exception 'That lead belongs to another tenant.' using errcode = '42501';
    end if;

    -- ALREADY CONVERTED -> return what it became. This is the whole point of
    -- the link: a second click on Convert is not a second customer, and a
    -- screen that lost its connection mid-save does not create one either.
    --
    -- TWO SIGNALS, because the link is asymmetric. clients.lead_id names the
    -- lead a record ORIGINATED from and is unique; leads.converted_ref_id is
    -- where a lead ENDED UP and is not. A lead closed onto a customer who was
    -- already on file has the second and not the first, and must still be
    -- recognised here or it would come round again as a duplicate.
    select c.* into v_row from public.clients c where c.lead_id = p_lead_id;
    if v_row.id is null and v_lead.converted_entity = 'client'
       and v_lead.converted_ref_id is not null then
      select c.* into v_row from public.clients c where c.id = v_lead.converted_ref_id;
    end if;
    if v_row.id is not null then
      return v_row;
    end if;

    v_agent := coalesce(v_agent, v_lead.agent_id);
  end if;

  -- ── "This is the same person as that record" ───────────────────────────
  --
  -- The operator looked at the duplicate list and recognised somebody. No new
  -- row: the existing record takes the lead link, and any billing field it was
  -- missing is filled in. Filled, never overwritten -- what is already on a
  -- customer's file beat what somebody has just typed into a lead form.
  if p_use_existing is not null then
    select c.* into v_row from public.clients c where c.id = p_use_existing;
    if v_row.id is null then
      raise exception 'That client record could not be found.' using errcode = 'P0002';
    end if;
    if v_row.admin_id is distinct from v_admin and not public.is_global_viewer() then
      raise exception 'That client record belongs to another tenant.' using errcode = '42501';
    end if;

    -- A customer who already originated from a lead KEEPS that origin: the new
    -- lead is stamped onto them further down, but it does not rewrite where the
    -- record came from. Refusing this outright was the first shape of the rule
    -- and it was wrong in the obvious way -- a repeat customer enquiring a
    -- second time is exactly the case this feature exists to keep to ONE
    -- record, and a refusal here forces the agent to create the duplicate.
    update public.clients c
       set lead_id          = coalesce(c.lead_id, p_lead_id),
           agent_id         = coalesce(c.agent_id, v_agent),
           email            = coalesce(c.email,            public.normalise_email(p_email)),
           phone            = coalesce(c.phone,            nullif(btrim(coalesce(p_phone, '')), '')),
           kra_pin          = coalesce(c.kra_pin,          nullif(btrim(upper(coalesce(p_kra_pin, ''))), '')),
           national_id      = coalesce(c.national_id,      nullif(btrim(coalesce(p_national_id, '')), '')),
           physical_address = coalesce(c.physical_address, nullif(btrim(coalesce(p_billing_address, '')), '')),
           updated_at       = now()
     where c.id = v_row.id
    returning * into v_row;

  else
    -- ── The duplicate backstop ───────────────────────────────────────────
    if not coalesce(p_force, false) then
      select count(*), string_agg(d.full_name || ' (' || coalesce(d.account_number, 'no account no.') || ')', ', ')
        into v_matched, v_dupes
        from public.finhub_client_duplicate_scan(
               case when public.is_global_viewer() then null else v_admin end,
               v_name, p_email, p_phone, p_kra_pin, p_national_id, null, 3) d
       where d.match_score >= 25;      -- an email match or stronger
      if coalesce(v_matched, 0) > 0 then
        raise exception 'A client record already exists for these details: %. Use that record, or tick "create anyway" if they are different people.', v_dupes
          using errcode = '23505';
      end if;
    end if;

    -- ── Allocate an account number ───────────────────────────────────────
    --
    -- AF-YYYY-NNNNNN, the format every other client-creation path in this app
    -- already produces. Generated here rather than by the caller because it is
    -- UNIQUE across the table, and letting two screens invent one is how you
    -- get a 23505 in front of a customer.
    for i in 1..6 loop
      v_acct := 'AF-' || to_char(now(), 'YYYY') || '-' ||
                lpad((floor(random() * 999999) + 1)::int::text, 6, '0');
      begin
        insert into public.clients
          (account_number, full_name, email, phone, national_id, kra_pin,
           physical_address, country, notes, client_status, kyc_status,
           customer_type, admin_id, created_by, agent_id, lead_id)
        values
          (v_acct, v_name,
           public.normalise_email(p_email),
           nullif(btrim(coalesce(p_phone, '')), ''),
           nullif(btrim(coalesce(p_national_id, '')), ''),
           nullif(btrim(upper(coalesce(p_kra_pin, ''))), ''),
           nullif(btrim(coalesce(p_billing_address, '')), ''),
           'Kenya',
           nullif(btrim(coalesce(p_notes, '')), ''),
           'active'::public.client_status, 'unverified',
           v_type, v_admin, auth.uid(), v_agent, p_lead_id)
        returning * into v_row;
        exit;
      exception when unique_violation then
        -- Either the account number collided, or another session linked this
        -- same lead a moment ago. The second one is not worth retrying.
        if p_lead_id is not null then
          select c.* into v_row from public.clients c where c.lead_id = p_lead_id;
          if v_row.id is not null then
            return v_row;
          end if;
        end if;
        v_row := null;
      end;
    end loop;

    if v_row.id is null then
      raise exception 'Could not allocate an account number -- please try again.' using errcode = 'P0001';
    end if;
  end if;

  -- ── Stamp the lead ─────────────────────────────────────────────────────
  --
  -- The frontend used to do this in a second call that could fail silently
  -- after the client existed, leaving a converted buyer sitting in the open
  -- pipeline. Same transaction now: either both or neither.
  if p_lead_id is not null then
    update public.leads
       set converted_at     = coalesce(converted_at, now()),
           converted_entity = 'client',
           converted_ref_id = v_row.id,
           stage            = 'closed',
           updated_at       = now()
     where id = p_lead_id;
  end if;

  insert into public.audit_logs (user_id, action, table_name, record_id, description, new_values, severity)
  values (
    auth.uid(), 'create'::public.audit_action, 'clients', v_row.id,
    case when p_use_existing is not null
         then 'Linked existing client record ' || coalesce(v_row.account_number, '') || ' (' || v_row.full_name || ') to a lead'
         else 'Created FinHub client record ' || coalesce(v_row.account_number, '') || ' (' || v_row.full_name || ')'
    end,
    jsonb_build_object(
      'client_id',     v_row.id,
      'account_number', v_row.account_number,
      'lead_id',       p_lead_id,
      'agent_id',      v_agent,
      'customer_type', v_type,
      'linked_existing', p_use_existing,
      'forced_past_duplicates', coalesce(p_force, false)
    ),
    case when coalesce(p_force, false) then 'warning' else 'info' end
  );

  return v_row;
end;
$fn$;

revoke execute on function public.finhub_create_client(text, text, text, text, text, text, text, uuid, uuid, text, uuid, boolean) from public, anon;
grant  execute on function public.finhub_create_client(text, text, text, text, text, text, text, uuid, uuid, text, uuid, boolean) to authenticated;

comment on function public.finhub_create_client(text, text, text, text, text, text, text, uuid, uuid, text, uuid, boolean) is
  'The one way to create a billable client record. Idempotent per lead, refuses silent duplicates, stamps the conversion in the same transaction.';

-- ---------------------------------------------------------------------------
-- 6. WHAT DOES THIS CLIENT OWE?
--
--    Invoiced is what was billed: every company_invoices row that is not a
--    draft and not cancelled. Paid is money actually received -- completed
--    payments only, because a pending M-Pesa push that never confirmed has not
--    reduced anybody's balance.
-- ---------------------------------------------------------------------------
create or replace function public.finhub_client_summary(p_client_id uuid)
returns table (
  client_id           uuid,
  invoiced            numeric,
  paid                numeric,
  balance             numeric,
  invoice_count       integer,
  unpaid_count        integer,
  overdue_count       integer,
  payment_count       integer,
  first_invoice_at    date,
  last_invoice_at     date,
  last_payment_at     timestamptz,
  hire_purchase_due   numeric
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  with inv as (
    select coalesce(sum(i.total), 0)                                        as invoiced,
           count(*)::integer                                                as invoice_count,
           count(*) filter (where i.status in ('pending', 'overdue'))::integer as unpaid_count,
           count(*) filter (where i.status = 'overdue'
                               or (i.status = 'pending' and i.due_date is not null
                                   and i.due_date < current_date))::integer as overdue_count,
           min(i.issue_date)                                                as first_invoice_at,
           max(i.issue_date)                                                as last_invoice_at
      from public.company_invoices i
     where i.client_id = p_client_id
       and i.status not in ('draft', 'cancelled')
  ),
  pay as (
    select coalesce(sum(p.amount), 0) as paid,
           count(*)::integer          as payment_count,
           max(p.payment_date)        as last_payment_at
      from public.payments p
     where p.client_id = p_client_id
       and p.payment_status = 'completed'::public.payment_status
  )
  select p_client_id,
         inv.invoiced,
         pay.paid,
         inv.invoiced - pay.paid,
         inv.invoice_count, inv.unpaid_count, inv.overdue_count,
         pay.payment_count,
         inv.first_invoice_at, inv.last_invoice_at, pay.last_payment_at,
         coalesce((select c.outstanding_balance from public.clients c where c.id = p_client_id), 0)
    from inv cross join pay;
$fn$;

revoke execute on function public.finhub_client_summary(uuid) from public, anon;
grant  execute on function public.finhub_client_summary(uuid) to authenticated;

comment on function public.finhub_client_summary(uuid) is
  'Invoiced, received and outstanding for one client record. Hire-purchase arrears are reported separately: they are a different receivable.';

-- ---------------------------------------------------------------------------
-- 7. THE PAYMENT HISTORY
--
--    Invoices and payments interleaved on one timeline with a running balance,
--    because "what do they owe and how did it get there" is one question. The
--    window runs over the whole history before the limit applies, so the
--    newest page still shows a true balance rather than one that starts at
--    zero halfway through the year.
-- ---------------------------------------------------------------------------
create or replace function public.finhub_client_statement(
  p_client_id uuid,
  p_limit     integer default 100
)
returns table (
  entry_at        timestamptz,
  kind            text,
  reference       text,
  description     text,
  charged         numeric,
  received        numeric,
  status          text,
  method          text,
  running_balance numeric,
  source_id       uuid
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  with entries as (
    select coalesce(i.issue_date::timestamptz, i.created_at) as entry_at,
           'invoice'::text                                   as kind,
           i.invoice_no                                      as reference,
           coalesce(nullif(btrim(i.notes), ''), 'Invoice')    as description,
           i.total                                           as charged,
           0::numeric                                        as received,
           i.status::text                                    as status,
           i.payment_method                                  as method,
           i.id                                              as source_id
      from public.company_invoices i
     where i.client_id = p_client_id
       and i.status not in ('draft', 'cancelled')
    union all
    select coalesce(p.payment_date, p.created_at),
           'payment'::text,
           coalesce(p.reference_number, p.transaction_id),
           coalesce(nullif(btrim(p.notes), ''), 'Payment received'),
           0::numeric,
           p.amount,
           p.payment_status::text,
           p.payment_method::text,
           p.id
      from public.payments p
     where p.client_id = p_client_id
       and p.payment_status = 'completed'::public.payment_status
  ),
  running as (
    select e.*,
           sum(e.charged - e.received) over (order by e.entry_at, e.kind, e.source_id
                                             rows between unbounded preceding and current row) as running_balance
      from entries e
  )
  select r.entry_at, r.kind, r.reference, r.description, r.charged, r.received,
         r.status, r.method, r.running_balance, r.source_id
    from running r
   order by r.entry_at desc, r.kind, r.source_id
   limit greatest(coalesce(p_limit, 100), 1);
$fn$;

revoke execute on function public.finhub_client_statement(uuid, integer) from public, anon;
grant  execute on function public.finhub_client_statement(uuid, integer) to authenticated;

comment on function public.finhub_client_statement(uuid, integer) is
  'One client''s invoices and receipts on a single timeline with a running balance. The balance is computed over the whole history, not over the page.';

-- ---------------------------------------------------------------------------
-- 8. THE BOOK
--
--    The same figures for every client, paged and searched in Postgres. The
--    alternative -- fetch the clients, then aggregate in the browser -- is the
--    pattern 20260822140000 removed from the SACCO dashboard: a cap on the
--    fetch silently makes every total on screen wrong.
-- ---------------------------------------------------------------------------
create or replace function public.finhub_client_book(
  p_search text    default null,
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  id              uuid,
  account_number  text,
  full_name       text,
  email           text,
  phone           text,
  kra_pin         text,
  customer_type   text,
  client_status   text,
  lead_id         uuid,
  agent_id        uuid,
  created_at      timestamptz,
  invoiced        numeric,
  paid            numeric,
  balance         numeric,
  invoice_count   integer,
  overdue_count   integer,
  last_payment_at timestamptz,
  total_count     bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $fn$
  with scoped as (
    select c.*
      from public.clients c
     -- The tenant filter is explicit here even though RLS supplies it for
     -- staff, because it does NOT for the super administrator: is_global_viewer
     -- opens the clients policy to every tenant, and this tab is one company's
     -- book. Every other tab in the hub reads .eq('admin_id', aId); a Clients
     -- tab that quietly listed the whole platform beside them would not be the
     -- same page.
     where c.admin_id = public.current_admin_id()
       and (p_search is null
        or btrim(p_search) = ''
        or c.full_name      ilike '%' || btrim(p_search) || '%'
        or c.account_number ilike '%' || btrim(p_search) || '%'
        or c.email          ilike '%' || btrim(p_search) || '%'
        or c.phone          ilike '%' || btrim(p_search) || '%'
        or c.kra_pin        ilike '%' || btrim(p_search) || '%')
  ),
  page as (
    select s.*, count(*) over () as total_count
      from scoped s
     order by s.created_at desc
     limit greatest(coalesce(p_limit, 50), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select p.id, p.account_number, p.full_name, p.email, p.phone, p.kra_pin,
         p.customer_type::text, p.client_status::text, p.lead_id, p.agent_id,
         p.created_at,
         coalesce(inv.invoiced, 0),
         coalesce(pay.paid, 0),
         coalesce(inv.invoiced, 0) - coalesce(pay.paid, 0),
         coalesce(inv.invoice_count, 0),
         coalesce(inv.overdue_count, 0),
         pay.last_payment_at,
         p.total_count
    from page p
    left join lateral (
      select coalesce(sum(i.total), 0)  as invoiced,
             count(*)::integer          as invoice_count,
             count(*) filter (where i.status = 'overdue'
                                 or (i.status = 'pending' and i.due_date is not null
                                     and i.due_date < current_date))::integer as overdue_count
        from public.company_invoices i
       where i.client_id = p.id
         and i.status not in ('draft', 'cancelled')
    ) inv on true
    left join lateral (
      select coalesce(sum(pm.amount), 0) as paid,
             max(pm.payment_date)        as last_payment_at
        from public.payments pm
       where pm.client_id = p.id
         and pm.payment_status = 'completed'::public.payment_status
    ) pay on true
   order by p.created_at desc;
$fn$;

revoke execute on function public.finhub_client_book(text, integer, integer) from public, anon;
grant  execute on function public.finhub_client_book(text, integer, integer) to authenticated;

comment on function public.finhub_client_book(text, integer, integer) is
  'One page of client records with their invoiced, received and outstanding figures. Searched and aggregated in Postgres so a capped page never produces a wrong total.';

notify pgrst, 'reload schema';

commit;

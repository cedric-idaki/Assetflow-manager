-- ===========================================================================
-- DIRECT CLIENT REGISTRATION
--
-- A client could only ever enter this system by being PUT there: an admin's
-- "Invite Client", or a sales agent converting a lead in CreateClientModal.
-- Someone who comes to the company on their own -- found the website, saw the
-- yard, was told by a friend -- had no door. /user-registration-screen exists in
-- the router but nothing links to it, and what it does is worse than nothing: a
-- bare supabase.auth.signUp with no metadata, so handle_new_user() clamps the
-- role to 'operations', no clients row is written, no admin_id is set, and the
-- browser is sent to /role-based-dashboard where RoleGuard bounces it. That
-- path has never produced a usable client account.
--
-- WHAT "DIRECT" HAS TO MEAN HERE
--
--   Every clients row is tenant-scoped by admin_id -- tenant_manage_clients
--   (20260817120000) is `admin_id = current_admin_id()`, so a row without a
--   tenant is a row no member of staff can see. "Direct" therefore cannot mean
--   "belongs to nobody". It means "arrived without a sales agent", and the
--   client must still land in one company's book.
--
--   The company publishes a SIGNUP CODE, and the link that carries it. That is
--   the tenant half. The agent half is the agent's own agent_code, already
--   UNIQUE NOT NULL on public.agents and already the thing an agent hands out.
--   One form, two codes, and which of them is present is exactly what the
--   acquisition channel records.
--
-- WHY THE CHANNEL IS ITS OWN COLUMN AND NOT `agent_id IS NULL`
--
--   `agent_id` is ON DELETE SET NULL. Delete the agent and every client they
--   ever signed becomes indistinguishable from a walk-in -- the commission
--   history silently rewrites itself. Acquisition is a fact about the day the
--   client arrived, so it is stored as one and frozen against later edits to
--   agent_id. Reassigning an account to a new agent is account management, not
--   re-acquisition, and must not move the number in the report.
--
-- Five parts:
--
--   1. clients -- acquisition_channel (direct | agent) and registration_source
--      (how the row came to exist), backfilled from the agent_id there today.
--   2. company_profiles -- signup_code + self_signup_enabled, opt-in per tenant.
--   3. resolve_signup_code() -- what the public page may know about a tenant.
--   4. register_direct_client() -- the whole signup, decided in the database.
--   5. The tenant's two controls -- the on/off switch, and the code rotation
--      that answers a leaked code without closing the door.
--
-- Parts 3 and 4 are granted to service_role ONLY. The public page reaches them
-- through the `register-client` Edge Function, the same shape as the public
-- listing page (20260813140000): attribution is resolved here from the codes,
-- never taken from the request body.
--
-- Idempotent throughout and wrapped in a transaction.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. clients -- how this client was acquired, and how the row came to exist
-- ---------------------------------------------------------------------------

alter table public.clients
  add column if not exists acquisition_channel text not null default 'direct';

alter table public.clients
  add column if not exists registration_source text not null default 'staff';

-- Two axes, deliberately not one column:
--   acquisition_channel -- WHO won the customer. The commission question.
--   registration_source -- HOW the row came to exist. The trust question: a
--                          walk-in typed in by the office is not the same as a
--                          stranger who signed themselves up online, even
--                          though both are 'direct'.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.clients'::regclass
       and conname  = 'clients_acquisition_channel_chk'
  ) then
    alter table public.clients
      add constraint clients_acquisition_channel_chk
      check (acquisition_channel in ('direct', 'agent'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.clients'::regclass
       and conname  = 'clients_registration_source_chk'
  ) then
    alter table public.clients
      add constraint clients_registration_source_chk
      check (registration_source in ('staff', 'agent_portal', 'self_service', 'import'));
  end if;
end $$;

-- Backfill from the only evidence the existing rows carry. Rows with an agent
-- were converted in the agent portal; rows without were entered by staff, which
-- is what the column defaults already say.
update public.clients
   set acquisition_channel = 'agent',
       registration_source = 'agent_portal'
 where agent_id is not null
   and acquisition_channel = 'direct'
   and registration_source = 'staff';

create index if not exists idx_clients_acquisition_channel
  on public.clients(admin_id, acquisition_channel);

-- Partial: the only question anyone asks of this column is "who signed
-- themselves up and still needs looking at".
create index if not exists idx_clients_self_registered
  on public.clients(admin_id, created_at desc)
  where registration_source = 'self_service';

-- On INSERT the channel is DERIVED -- a client arriving with an agent was
-- acquired through that agent, and no caller gets to say otherwise.
--
-- On UPDATE it is FROZEN against agent_id. An explicit write to the channel
-- itself still lands (staff own their tenant's clients and a mis-attribution
-- has to be fixable); what cannot happen is agent_id moving and quietly taking
-- the acquisition history with it.
create or replace function public.set_client_acquisition_channel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.acquisition_channel := case when new.agent_id is not null then 'agent' else 'direct' end;
    return new;
  end if;

  -- UPDATE: only an explicit write to the column itself changes it.
  if new.acquisition_channel is not distinct from old.acquisition_channel then
    new.acquisition_channel := old.acquisition_channel;
  end if;
  -- Provenance never changes. The row was created how it was created.
  new.registration_source := old.registration_source;
  return new;
end;
$$;

revoke execute on function public.set_client_acquisition_channel() from public, anon, authenticated;

drop trigger if exists set_client_acquisition_channel on public.clients;
create trigger set_client_acquisition_channel
  before insert or update on public.clients
  for each row execute function public.set_client_acquisition_channel();

-- ---------------------------------------------------------------------------
-- 2. company_profiles -- the tenant's public signup code
--
--    Guarded by to_regclass: this project's migration ledger does not match its
--    live schema (company_profiles is created by a migration that is not in
--    this repo), so the table is checked for rather than assumed.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.company_profiles') is null then
    raise notice 'company_profiles not present -- skipping signup-code columns';
    return;
  end if;

  execute 'alter table public.company_profiles
             add column if not exists signup_code text';

  -- OFF by default, for every tenant including the ones that already exist.
  -- Opening a door into a company''s client book is that company''s decision,
  -- not a side effect of a deploy.
  execute 'alter table public.company_profiles
             add column if not exists self_signup_enabled boolean not null default false';

  execute 'create unique index if not exists company_profiles_signup_code_key
             on public.company_profiles(upper(signup_code))
             where signup_code is not null';
end $$;

-- Eight characters from an unambiguous alphabet -- no O/0, no I/1/L. It is read
-- off a poster and typed by hand, so the alphabet matters more than the length.
create or replace function public.generate_signup_code()
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
  taken     boolean;
begin
  if to_regclass('public.company_profiles') is null then
    raise exception 'company_profiles is not present';
  end if;

  for attempt in 1..20 loop
    candidate := '';
    for pos in 1..8 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;

    execute 'select exists (select 1 from public.company_profiles
                             where upper(signup_code) = $1)'
       into taken using candidate;

    if not taken then
      return candidate;
    end if;
  end loop;

  raise exception 'could not mint a unique signup code';
end;
$$;

revoke execute on function public.generate_signup_code() from public, anon;

-- Give every existing tenant a code now, so switching self-signup on later is a
-- switch rather than a provisioning job. The switch itself stays off.
do $$
declare
  r record;
begin
  if to_regclass('public.company_profiles') is null then return; end if;

  for r in execute 'select admin_id from public.company_profiles where signup_code is null' loop
    execute 'update public.company_profiles set signup_code = $1 where admin_id = $2'
      using public.generate_signup_code(), r.admin_id;
  end loop;
end $$;

-- New tenants get theirs at registration, without the signup form having to
-- know the code exists.
create or replace function public.set_company_signup_code()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.signup_code is null then
    new.signup_code := public.generate_signup_code();
  end if;
  return new;
end;
$$;

revoke execute on function public.set_company_signup_code() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.company_profiles') is null then return; end if;

  execute 'drop trigger if exists set_company_signup_code on public.company_profiles';
  execute 'create trigger set_company_signup_code
             before insert on public.company_profiles
             for each row execute function public.set_company_signup_code()';
end $$;

-- ---------------------------------------------------------------------------
-- 3. resolve_signup_code -- everything the public registration page may know
--
--    Returns the company's NAME and city, and nothing that could be mined: no
--    admin_id, no email, no phone, no counts. A wrong code is indistinguishable
--    from a code belonging to a tenant that has self-signup switched off, so the
--    endpoint cannot be walked to enumerate which companies exist.
-- ---------------------------------------------------------------------------

create or replace function public.resolve_signup_code(p_code text)
returns table (company_name text, city text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if to_regclass('public.company_profiles') is null then
    return;
  end if;

  return query execute
    'select cp.company_name::text, cp.city::text
       from public.company_profiles cp
      where upper(cp.signup_code) = upper(btrim($1))
        and cp.self_signup_enabled
      limit 1'
    using p_code;
end;
$$;

revoke execute on function public.resolve_signup_code(text) from public, anon, authenticated;
grant  execute on function public.resolve_signup_code(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. register_direct_client -- the whole signup, decided here
--
--    The Edge Function has already created the auth user; this binds it to a
--    tenant. Everything that decides money -- which company, which agent, which
--    channel -- is resolved from the two codes INSIDE this function. Nothing is
--    taken from the caller's body, so a crafted request cannot name a tenant it
--    was not given a code for, or attribute itself to an agent working for
--    somebody else.
--
--    The account is created 'pending'. A self-registered client is a stranger
--    until a member of staff says otherwise: they can sign in and see their own
--    empty portal, and nothing else happens until the tenant activates them.
-- ---------------------------------------------------------------------------

create or replace function public.register_direct_client(
  p_signup_code  text,
  p_auth_user_id uuid,
  p_full_name    text,
  p_email        text,
  p_phone        text default null,
  p_agent_code   text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id   uuid;
  v_company    text;
  v_existing   text;
  v_agent_id   uuid;
  v_agent_name text;
  v_channel    text;
  v_account    text;
  v_client_id  uuid;
  v_name       text := btrim(coalesce(p_full_name, ''));
  v_email      text := lower(btrim(coalesce(p_email, '')));
  v_phone      text := nullif(btrim(coalesce(p_phone, '')), '');
  v_agent_code text := nullif(upper(btrim(coalesce(p_agent_code, ''))), '');
begin
  if p_auth_user_id is null or v_email = '' or v_name = '' then
    raise exception 'auth user, name and email are required' using errcode = '22023';
  end if;

  -- ── The tenant, from the signup code ──────────────────────────────────────
  if to_regclass('public.company_profiles') is null then
    raise exception 'Self-service registration is not available.' using errcode = '22023';
  end if;

  execute 'select cp.admin_id, cp.company_name::text
             from public.company_profiles cp
            where upper(cp.signup_code) = upper(btrim($1))
              and cp.self_signup_enabled
            limit 1'
    into v_admin_id, v_company
   using p_signup_code;

  if v_admin_id is null then
    raise exception 'That registration code was not recognised.' using errcode = '22023';
  end if;

  -- ── The agent, from the agent code -- and only within THAT tenant ─────────
  -- A code that does not resolve is an error, not a shrug. The client typed it
  -- because somebody gave it to them, and silently filing the account as
  -- 'direct' is how an agent loses a commission they earned.
  if v_agent_code is not null then
    select a.id, a.full_name
      into v_agent_id, v_agent_name
      from public.agents a
     where upper(a.agent_code) = v_agent_code
       and a.admin_id = v_admin_id
       and coalesce(a.agent_status::text, 'active') = 'active'
     limit 1;

    if v_agent_id is null then
      raise exception 'That sales agent code was not recognised.' using errcode = '22023';
    end if;
  end if;

  v_channel := case when v_agent_id is not null then 'agent' else 'direct' end;

  -- ── One client per auth user (clients_client_auth_id_key, 20260619120000) ──
  -- A retried submission must not mint a second account for the same login.
  select c.id, c.account_number, c.acquisition_channel
    into v_client_id, v_account, v_existing
    from public.clients c
   where c.client_auth_id = p_auth_user_id
   limit 1;

  if v_client_id is not null then
    return jsonb_build_object(
      'client_id',           v_client_id,
      'account_number',      v_account,
      'acquisition_channel', v_existing,
      'company_name',        v_company,
      'already_registered',  true
    );
  end if;

  -- ── The clients row ───────────────────────────────────────────────────────
  -- account_number is UNIQUE NOT NULL; retry the random sequence on collision,
  -- the same way inviteClient and CreateClientModal do.
  for attempt in 1..5 loop
    v_account := 'AF-' || to_char(now(), 'YYYY') || '-'
                 || lpad((1 + floor(random() * 999999))::int::text, 6, '0');
    begin
      insert into public.clients (
        account_number, full_name, email, phone,
        admin_id, agent_id, client_auth_id,
        client_status, kyc_status,
        acquisition_channel, registration_source
      ) values (
        v_account, v_name, v_email, v_phone,
        v_admin_id, v_agent_id, p_auth_user_id,
        'pending'::public.client_status, 'unverified',
        v_channel, 'self_service'
      )
      returning id into v_client_id;
      exit;
    exception when unique_violation then
      -- Only account_number is worth retrying. A clash on client_auth_id means
      -- a concurrent submission won the race, so hand back that row instead.
      select c.id, c.account_number, c.acquisition_channel
        into v_client_id, v_account, v_existing
        from public.clients c where c.client_auth_id = p_auth_user_id limit 1;
      if v_client_id is not null then
        return jsonb_build_object(
          'client_id',           v_client_id,
          'account_number',      v_account,
          'acquisition_channel', v_existing,
          'company_name',        v_company,
          'already_registered',  true
        );
      end if;
    end;
  end loop;

  if v_client_id is null then
    raise exception 'Could not allocate an account number. Please try again.';
  end if;

  -- ── The portal login's profile ────────────────────────────────────────────
  -- handle_new_user() has already created this row from the signup metadata,
  -- with role 'client' and NO admin_id. This is what puts it in the tenant.
  -- is_staff_member() excludes 'client', so an admin_id here grants a client
  -- nothing beyond their own row (20260817120000).
  insert into public.user_profiles (id, email, full_name, phone, role, admin_id)
  values (p_auth_user_id, v_email, v_name, v_phone, 'client'::public.user_role, v_admin_id)
  on conflict (id) do update
    set role      = 'client'::public.user_role,
        admin_id  = v_admin_id,
        full_name = coalesce(excluded.full_name, user_profiles.full_name),
        phone     = coalesce(excluded.phone,     user_profiles.phone);

  return jsonb_build_object(
    'client_id',           v_client_id,
    'account_number',      v_account,
    'acquisition_channel', v_channel,
    'agent_name',          v_agent_name,
    'company_name',        v_company,
    'already_registered',  false
  );
end;
$$;

revoke execute on function public.register_direct_client(text, uuid, text, text, text, text)
  from public, anon, authenticated;
grant  execute on function public.register_direct_client(text, uuid, text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. THE TENANT'S TWO CONTROLS
--
--    Both go through RPCs rather than a plain UPDATE on company_profiles, for
--    two reasons:
--
--      * That table is created by a migration this repo does not hold, so what
--        policies sit on it cannot be read here. An UPDATE that RLS declines
--        matches zero rows and returns NO ERROR -- the switch would appear to
--        work and would not have. Same trap 20260817120000 documents on the
--        client-invite path.
--      * A new code has to be unique across every tenant, and a caller cannot
--        see the rows it is colliding with, so the retry has to happen here.
--
--    Both are scoped to current_admin_id() and to the tenant owner: staff below
--    admin do not get to open a door into the client book, or invalidate a code
--    the company is currently advertising.
-- ---------------------------------------------------------------------------

-- The guard both controls share. Returns the caller's tenant, or raises.
create or replace function public.assert_tenant_owner()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid := public.current_admin_id();
  v_role     public.user_role;
begin
  if auth.uid() is null or v_admin_id is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select up.role into v_role from public.user_profiles up where up.id = auth.uid();

  if v_role is distinct from 'admin'::public.user_role
     and v_role is distinct from 'super_admin'::public.user_role then
    raise exception 'only an administrator may change registration settings'
      using errcode = '42501';
  end if;

  if to_regclass('public.company_profiles') is null then
    raise exception 'company_profiles is not present';
  end if;

  return v_admin_id;
end;
$$;

revoke execute on function public.assert_tenant_owner() from public, anon;
grant  execute on function public.assert_tenant_owner() to authenticated;

-- The on/off switch. Closing it stops abuse AND stops every legitimate
-- registration, so it is a shutdown rather than a remedy -- see rotate below.
create or replace function public.set_self_signup(p_enabled boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid := public.assert_tenant_owner();
  v_rows     integer;
begin
  execute 'update public.company_profiles
              set self_signup_enabled = $1,
                  signup_code = coalesce(signup_code, public.generate_signup_code())
            where admin_id = $2'
    using coalesce(p_enabled, false), v_admin_id;

  -- EXECUTE feeds GET DIAGNOSTICS but leaves FOUND alone, and FOUND starts
  -- false in every call -- `if not found` here would raise on every success.
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'no company profile for this tenant' using errcode = '22023';
  end if;

  return coalesce(p_enabled, false);
end;
$$;

revoke execute on function public.set_self_signup(boolean) from public, anon;
grant  execute on function public.set_self_signup(boolean) to authenticated;

-- The remedy. A signup code gets photographed off a poster, forwarded out of a
-- WhatsApp group, and pasted where nobody intended. Rotating mints a new code
-- and kills the old one in the same statement, with the door left open -- which
-- is the thing an admin actually wants at 9pm on a Friday.
create or replace function public.rotate_signup_code()
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid := public.assert_tenant_owner();
  v_code     text := public.generate_signup_code();
  v_rows     integer;
begin
  execute 'update public.company_profiles set signup_code = $1 where admin_id = $2'
    using v_code, v_admin_id;

  -- EXECUTE feeds GET DIAGNOSTICS but leaves FOUND alone, and FOUND starts
  -- false in every call -- `if not found` here would raise on every success.
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'no company profile for this tenant' using errcode = '22023';
  end if;

  return v_code;
end;
$$;

revoke execute on function public.rotate_signup_code() from public, anon;
grant  execute on function public.rotate_signup_code() to authenticated;

commit;

notify pgrst, 'reload schema';

-- ===========================================================================
-- USER DEVICE RESTRICTIONS
--
-- Every account may keep at most TWO active devices, one per "slot":
--
--   slot 'mobile'    -> the phone
--   slot 'computer'  -> the laptop OR the tablet (one, not one of each)
--
-- The cap is a UNIQUE INDEX on (user_id, device_slot) WHERE revoked_at IS NULL,
-- so it holds even if a bug (or a hand-written INSERT) skips the RPCs below.
-- Nothing outside these SECURITY DEFINER functions may write the table:
-- INSERT/UPDATE/DELETE grants are revoked from anon and authenticated.
--
-- Device identity
--   The client mints a random id once and keeps it in localStorage; it is
--   passed as p_device_id. The *slot* is NOT taken from the client — it is
--   derived here from the request's User-Agent header, so a client cannot
--   claim to be a phone in order to reach the free slot. The client's own
--   guess is accepted only as a fallback when no UA header is present (a
--   native client later on), and even then the two-slot cap still applies.
--
-- Scope of enforcement (read this before assuming more than it does)
--   These functions govern the device REGISTRY and the app's session gate
--   (src/contexts/AuthContext.jsx signs the user into a blocked state that
--   renders nothing but the "device not authorised" screen). They do not, on
--   their own, filter row access per device: a caller holding a valid JWT can
--   still reach PostgREST directly. Making that impossible means adding
--   public.is_device_authorized() to the policies of every sensitive table,
--   which is deliberately left out of this migration — it would rewrite RLS
--   across the whole schema. The helper is provided and ready for that.
--
-- Lockouts
--   A user is never permanently stranded: they may swap a device themselves
--   from the blocked screen. Swaps are rate-limited (see MAX_SELF_CHANGES)
--   so "remove and re-add" cannot become an unlimited device allowance. Once
--   the quota is spent, only a tenant admin / super_admin can free the slot.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Slot type
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'device_slot' and n.nspname = 'public'
  ) then
    create type public.device_slot as enum ('mobile', 'computer');
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 2. Tables
--    user_id -> user_profiles (not auth.users) so PostgREST can embed the
--    owner in the admin listing: select *, user:user_profiles(full_name,...).
--    Every auth user gets a profile row from handle_new_user(), so the FK is
--    satisfied by the time a device can ever be registered.
-- ---------------------------------------------------------------------------
create table if not exists public.user_devices (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.user_profiles(id) on delete cascade,
  admin_id       uuid,                       -- owning tenant, for admin oversight
  device_id      text not null,              -- client-minted, stable per browser
  device_slot    public.device_slot not null,
  device_type    text not null,              -- phone | tablet | laptop (display)
  device_name    text,                       -- "Chrome on Windows"
  user_agent     text,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  revoked_at     timestamptz,
  revoked_by     uuid,
  revoked_reason text,
  constraint user_devices_device_id_len check (char_length(device_id) between 8 and 128),
  constraint user_devices_unique_per_user unique (user_id, device_id)
);

-- THE CAP. One live device per slot, two slots, therefore two devices.
create unique index if not exists user_devices_one_active_per_slot
  on public.user_devices (user_id, device_slot)
  where revoked_at is null;

-- user_id lookups ride the (user_id, device_id) unique constraint's index.
create index if not exists idx_user_devices_admin on public.user_devices(admin_id);

-- Append-only trail. Also the source of truth for the swap quota, so it must
-- record who acted: a swap the user made themselves counts against them, one
-- an administrator made on their behalf does not.
create table if not exists public.user_device_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.user_profiles(id) on delete cascade,
  admin_id    uuid,
  device_id   text,
  device_slot public.device_slot,
  device_name text,
  device_type text,
  event       text not null check (event in ('registered', 'blocked', 'replaced', 'revoked')),
  actor_id    uuid,
  user_agent  text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_user_device_events_user
  on public.user_device_events(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Classification helpers
--    Mirrored in src/utils/deviceIdentity.js — keep the two in step. The copy
--    here is the authoritative one; the JS copy only labels the UI.
-- ---------------------------------------------------------------------------
create or replace function public.classify_device_type(p_user_agent text, p_hint text default null)
returns text
language plpgsql
immutable
as $$
declare
  ua text := lower(coalesce(p_user_agent, ''));
begin
  -- No UA at all: trust the caller's hint, clamped to the known values.
  if ua = '' then
    return case lower(coalesce(p_hint, ''))
             when 'phone'  then 'phone'
             when 'tablet' then 'tablet'
             else 'laptop'
           end;
  end if;

  -- Tablets are tested first: an iPad's Safari UA also carries "Mobile", and
  -- an Android tablet is just an Android UA *without* the "Mobile" token.
  -- (An iPad in desktop mode identifies as a Mac and lands on 'laptop' — same
  -- slot either way, so the cap is unaffected.)
  if ua like '%ipad%'
     or ua like '%tablet%'
     or ua like '%kindle%'
     or ua like '%silk/%'
     or ua like '%playbook%'
     or (ua like '%android%' and ua not like '%mobile%')
  then
    return 'tablet';
  end if;

  if ua like '%iphone%'
     or ua like '%ipod%'
     or ua like '%android%'
     or ua like '%windows phone%'
     or ua like '%blackberry%'
     or ua like '%bb10%'
     or ua like '%opera mini%'
     or ua like '%mobile%'
  then
    return 'phone';
  end if;

  return 'laptop';
end;
$$;

-- A laptop and a tablet share one slot; the phone gets the other.
create or replace function public.device_slot_for_type(p_type text)
returns public.device_slot
language sql
immutable
as $$
  select case when p_type = 'phone'
              then 'mobile'::public.device_slot
              else 'computer'::public.device_slot
         end;
$$;

-- The UA of the request currently being served (PostgREST exposes the request
-- headers as a GUC). NULL outside a PostgREST request, e.g. in the SQL editor.
create or replace function public.current_request_user_agent()
returns text
language sql
stable
as $$
  select nullif(coalesce(current_setting('request.headers', true)::json ->> 'user-agent', ''), '');
$$;

create or replace function public.user_device_json(d public.user_devices)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id',            d.id,
    'device_id',     d.device_id,
    'device_slot',   d.device_slot,
    'device_type',   d.device_type,
    'device_name',   d.device_name,
    'first_seen_at', d.first_seen_at,
    'last_seen_at',  d.last_seen_at,
    'revoked_at',    d.revoked_at
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Authority: who may look at / revoke a given user's devices
--    Yourself; the admin or sacco_admin who owns you; super_admin & director.
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_user_devices(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p_user_id = auth.uid()
    or public.is_global_viewer()
    or exists (
      select 1
      from public.user_profiles me
      join public.user_profiles target on target.id = p_user_id
      where me.id = auth.uid()
        and me.role in ('admin'::public.user_role, 'sacco_admin'::public.user_role)
        and target.admin_id = me.id
    );
$$;

-- ---------------------------------------------------------------------------
-- 5. Self-service change quota
--    Counts the device changes a user made *themselves* in the rolling window.
--    Revokes and swaps both count — otherwise "revoke, then register" would be
--    a swap that costs nothing.
-- ---------------------------------------------------------------------------
create or replace function public.device_changes_remaining(p_user_id uuid default null)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  MAX_SELF_CHANGES constant integer  := 3;
  CHANGE_WINDOW    constant interval := interval '30 days';
  target uuid := coalesce(p_user_id, auth.uid());
  used   integer;
begin
  if target is null then
    return 0;
  end if;
  if not public.can_manage_user_devices(target) then
    raise exception 'device_changes_remaining: not authorised for user %', target
      using errcode = '42501';
  end if;

  select count(*) into used
  from public.user_device_events e
  where e.user_id = target
    and e.actor_id = target                      -- admin-initiated changes are free
    and e.event in ('replaced', 'revoked')
    and e.created_at > now() - CHANGE_WINDOW;

  return greatest(0, MAX_SELF_CHANGES - used);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. register_current_device
--    Called on every sign-in and session restore.
--      * known, live device            -> touch last_seen, allowed
--      * free slot                     -> register, allowed
--      * slot taken, p_replace = false -> denied, describes the occupant
--      * slot taken, p_replace = true  -> revoke occupant and take the slot,
--                                         if the change quota allows
-- ---------------------------------------------------------------------------
create or replace function public.register_current_device(
  p_device_id    text,
  p_device_label text    default null,
  p_client_hint  text    default null,
  p_replace      boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller   uuid := auth.uid();
  ua       text := public.current_request_user_agent();
  tenant   uuid;
  d_type   text;
  d_slot   public.device_slot;
  d_name   text;
  existing public.user_devices;
  occupant public.user_devices;
  fresh    public.user_devices;
  left_qty integer;
begin
  if caller is null then
    raise exception 'register_current_device: no authenticated user'
      using errcode = '42501';
  end if;

  if p_device_id is null
     or char_length(p_device_id) < 8
     or char_length(p_device_id) > 128 then
    raise exception 'register_current_device: device id must be 8-128 characters'
      using errcode = '22023';
  end if;

  d_type := public.classify_device_type(ua, p_client_hint);
  d_slot := public.device_slot_for_type(d_type);
  d_name := nullif(left(coalesce(p_device_label, ''), 120), '');
  tenant := public.current_admin_id();

  -- ── Already registered and still live: just a heartbeat. The stored slot and
  -- type are left alone — re-deriving them could move a device into a slot the
  -- other device holds, and a device does not change shape mid-life anyway.
  select * into existing
  from public.user_devices
  where user_id = caller and device_id = p_device_id;

  if found and existing.revoked_at is null then
    update public.user_devices
       set last_seen_at = now(),
           user_agent   = coalesce(ua, user_agent),
           device_name  = coalesce(d_name, device_name),
           admin_id     = coalesce(admin_id, tenant)
     where id = existing.id
    returning * into existing;

    return jsonb_build_object(
      'allowed', true,
      'status',  'recognized',
      'device',  public.user_device_json(existing)
    );
  end if;

  -- ── New device, or one that was revoked: it has to claim its slot.
  select * into occupant
  from public.user_devices
  where user_id = caller
    and device_slot = d_slot
    and revoked_at is null
  limit 1;

  if occupant.id is not null then
    left_qty := public.device_changes_remaining(caller);

    if not p_replace or left_qty <= 0 then
      -- One row per device per 15 minutes: a blocked client re-checks on every
      -- focus, and the trail is for humans to read, not a hit counter.
      insert into public.user_device_events
        (user_id, admin_id, device_id, device_slot, device_name, device_type, event, actor_id, user_agent, detail)
      select
        caller, tenant, p_device_id, d_slot, d_name, d_type, 'blocked', caller, ua,
        jsonb_build_object(
          'reason', case when p_replace then 'change_limit_reached' else 'slot_occupied' end,
          'occupied_by', occupant.id)
      where not exists (
        select 1 from public.user_device_events e
        where e.user_id = caller
          and e.device_id = p_device_id
          and e.event = 'blocked'
          and e.created_at > now() - interval '15 minutes'
      );

      return jsonb_build_object(
        'allowed',           false,
        'reason',            case when p_replace then 'change_limit_reached' else 'slot_occupied' end,
        'slot',              d_slot,
        'device_type',       d_type,
        'changes_remaining', left_qty,
        'occupied_by',       public.user_device_json(occupant)
      );
    end if;

    update public.user_devices
       set revoked_at     = now(),
           revoked_by     = caller,
           revoked_reason = 'replaced_by_user'
     where id = occupant.id;

    insert into public.user_device_events
      (user_id, admin_id, device_id, device_slot, device_name, device_type, event, actor_id, user_agent, detail)
    values
      (caller, tenant, occupant.device_id, occupant.device_slot, occupant.device_name, occupant.device_type,
       'replaced', caller, ua, jsonb_build_object('replaced_by', p_device_id));
  end if;

  -- ON CONFLICT also revives a row for this same device that had been revoked.
  begin
    insert into public.user_devices as ud
      (user_id, admin_id, device_id, device_slot, device_type, device_name, user_agent)
    values
      (caller, tenant, p_device_id, d_slot, d_type, d_name, ua)
    on conflict (user_id, device_id) do update
      set device_slot    = excluded.device_slot,
          device_type    = excluded.device_type,
          device_name    = coalesce(excluded.device_name, ud.device_name),
          user_agent     = coalesce(excluded.user_agent, ud.user_agent),
          admin_id       = coalesce(ud.admin_id, excluded.admin_id),
          last_seen_at   = now(),
          revoked_at     = null,
          revoked_by     = null,
          revoked_reason = null
    returning * into fresh;
  exception when unique_violation then
    -- Two tabs registering at once; the index is the arbiter, so the loser is
    -- simply told the slot is taken.
    return jsonb_build_object(
      'allowed',     false,
      'reason',      'slot_occupied',
      'slot',        d_slot,
      'device_type', d_type
    );
  end;

  insert into public.user_device_events
    (user_id, admin_id, device_id, device_slot, device_name, device_type, event, actor_id, user_agent, detail)
  values
    (caller, tenant, p_device_id, d_slot, d_name, d_type, 'registered', caller, ua,
     jsonb_build_object('replaced_occupant', occupant.id));

  return jsonb_build_object(
    'allowed', true,
    'status',  case when occupant.id is not null then 'replaced' else 'registered' end,
    'device',  public.user_device_json(fresh)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. revoke_user_device
--    Self-service (costs one change) or on an administrator's authority (free).
-- ---------------------------------------------------------------------------
create or replace function public.revoke_user_device(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller  uuid := auth.uid();
  target  public.user_devices;
  by_self boolean;
begin
  if caller is null then
    raise exception 'revoke_user_device: no authenticated user' using errcode = '42501';
  end if;

  select * into target from public.user_devices where id = p_id;
  if not found then
    raise exception 'revoke_user_device: device not found' using errcode = 'P0002';
  end if;

  if not public.can_manage_user_devices(target.user_id) then
    raise exception 'revoke_user_device: not authorised to manage this user''s devices'
      using errcode = '42501';
  end if;

  if target.revoked_at is not null then
    return jsonb_build_object('revoked', true, 'already_revoked', true);
  end if;

  by_self := target.user_id = caller;

  -- Spending the last change on a revoke would leave the slot empty with no way
  -- to refill it, which is a worse lockout than refusing the revoke.
  if by_self and public.device_changes_remaining(caller) <= 0 then
    return jsonb_build_object(
      'revoked',           false,
      'reason',            'change_limit_reached',
      'changes_remaining', 0
    );
  end if;

  update public.user_devices
     set revoked_at     = now(),
         revoked_by     = caller,
         revoked_reason = case when by_self then 'revoked_by_user' else 'revoked_by_admin' end
   where id = p_id;

  insert into public.user_device_events
    (user_id, admin_id, device_id, device_slot, device_name, device_type, event, actor_id, user_agent, detail)
  values
    (target.user_id, target.admin_id, target.device_id, target.device_slot, target.device_name,
     target.device_type, 'revoked', caller, public.current_request_user_agent(),
     jsonb_build_object('by_self', by_self));

  return jsonb_build_object(
    'revoked',           true,
    'changes_remaining', case when by_self then public.device_changes_remaining(caller) else null end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. is_device_authorized — the building block for per-request enforcement.
--    Reads the X-Device-Id header the web client sends on every PostgREST call
--    (src/lib/supabase.js). Add `and public.is_device_authorized()` to a table's
--    policies to make that table unreachable from an unregistered device.
--    Not wired into any policy here on purpose — see the header note.
-- ---------------------------------------------------------------------------
create or replace function public.is_device_authorized()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_devices d
    where d.user_id = auth.uid()
      and d.revoked_at is null
      and d.device_id = nullif(
            coalesce(current_setting('request.headers', true)::json ->> 'x-device-id', ''), '')
  );
$$;

-- ---------------------------------------------------------------------------
-- 9. RLS — read-only to end users; every write goes through the RPCs above.
-- ---------------------------------------------------------------------------
alter table public.user_devices       enable row level security;
alter table public.user_device_events enable row level security;

drop policy if exists user_devices_select on public.user_devices;
create policy user_devices_select on public.user_devices
for select to authenticated
using (public.can_manage_user_devices(user_id));

drop policy if exists user_device_events_select on public.user_device_events;
create policy user_device_events_select on public.user_device_events
for select to authenticated
using (public.can_manage_user_devices(user_id));

-- Supabase grants ALL on new public tables to anon/authenticated by default;
-- without this revoke the RPC-only write path would be advisory. TRUNCATE is
-- not filtered by RLS at all, so no end-user role may keep it.
revoke all on public.user_devices       from anon, authenticated;
revoke all on public.user_device_events from anon, authenticated;
grant select on public.user_devices       to authenticated;
grant select on public.user_device_events to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Function grants. REVOKE FROM PUBLIC alone leaves anon/authenticated
--     holding EXECUTE via default privileges, so name them explicitly.
-- ---------------------------------------------------------------------------
revoke execute on function public.classify_device_type(text, text)               from public, anon, authenticated;
revoke execute on function public.device_slot_for_type(text)                     from public, anon, authenticated;
revoke execute on function public.current_request_user_agent()                   from public, anon, authenticated;
revoke execute on function public.user_device_json(public.user_devices)          from public, anon, authenticated;

revoke execute on function public.can_manage_user_devices(uuid)                  from public, anon;
revoke execute on function public.device_changes_remaining(uuid)                 from public, anon;
revoke execute on function public.is_device_authorized()                         from public, anon;
revoke execute on function public.register_current_device(text, text, text, boolean) from public, anon;
revoke execute on function public.revoke_user_device(uuid)                       from public, anon;

-- can_manage_user_devices is referenced by the policies above, and RLS
-- expressions run as the querying role, so authenticated must keep EXECUTE.
grant execute on function public.can_manage_user_devices(uuid)                   to authenticated;
grant execute on function public.device_changes_remaining(uuid)                  to authenticated;
grant execute on function public.is_device_authorized()                          to authenticated;
grant execute on function public.register_current_device(text, text, text, boolean) to authenticated;
grant execute on function public.revoke_user_device(uuid)                        to authenticated;

commit;

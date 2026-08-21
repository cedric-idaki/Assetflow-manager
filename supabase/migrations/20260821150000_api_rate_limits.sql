-- ===========================================================================
-- API RATE LIMITING — SHARED COUNTER FOR EDGE FUNCTIONS
--
-- Why this lives in the database and not in the function
-- -----------------------------------------------------
-- Edge Functions are stateless and horizontally scaled: Supabase runs as many
-- isolates as it likes and recycles them freely. A counter held in a module
-- variable therefore counts one isolate's traffic, and an attacker spreading
-- requests across warm instances gets N times the intended budget while a
-- legitimate user hitting a cold instance gets a fresh allowance. To limit a
-- CALLER you need one counter every instance shares, and the only thing every
-- function already shares is Postgres.
--
-- What a "bucket" is
-- ------------------
-- An opaque string built by the calling function, of the shape
--
--     <function>:<action>:<identity>
--
-- e.g. "send-sms:user:9d3f..." or "listing-public:enquire:ip:a91c...". Identity
-- is the strongest thing the function knows: user id > API-key hash > hashed
-- IP. The function decides that; this table only counts.
--
-- Fixed windows, not sliding
-- --------------------------
-- A fixed window can pass up to 2x the limit across a window boundary (full
-- budget at the end of one window, full budget at the start of the next). That
-- is a known and accepted tradeoff: these limits exist to stop spam and runaway
-- spend, not to meter a paid API to the request. A sliding log would cost a row
-- per request on the hottest path in the system, which buys precision nobody
-- here needs at a price everybody pays.
--
-- Privacy
-- -------
-- Buckets NEVER contain a raw IP address. Callers pass a salted SHA-256 of it
-- (hashedIp() in _shared/http.ts), matching how listing-public already hashes
-- viewer IPs. The bucket string is the primary key, so keeping it
-- non-identifying keeps this table non-identifying.
--
-- Access
-- ------
-- The table has RLS on with ZERO policies and no grants to anon/authenticated:
-- it is reachable only through api_rate_limit_hit(), which is SECURITY DEFINER
-- and granted to service_role. A client cannot read another caller's usage
-- and — the part that matters — cannot reset its own counter.
--
-- Idempotent and transactional: safe to re-run, lands whole or not at all.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. STORAGE
-- ---------------------------------------------------------------------------

create table if not exists public.api_rate_limits (
  bucket        text        primary key,
  window_start  timestamptz not null default now(),
  hits          integer     not null default 0
);

comment on table public.api_rate_limits is
  'Shared fixed-window request counters for Edge Functions. Written only by public.api_rate_limit_hit(). Buckets are opaque and contain hashed, never raw, client identifiers.';

-- Sweeping expired rows is the only query here that is not a primary-key lookup.
create index if not exists api_rate_limits_window_start_idx
  on public.api_rate_limits (window_start);

alter table public.api_rate_limits enable row level security;

-- Deliberately no policies. Everything goes through the RPC below.
revoke all on public.api_rate_limits from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. THE COUNTER
-- ---------------------------------------------------------------------------

-- Counts one request against a bucket and reports whether it may proceed.
--
-- The whole decision is a SINGLE statement on purpose. Read-then-write would
-- race: two concurrent requests both read hits = limit - 1, both decide they
-- are fine, and the limit is breached by exactly the traffic pattern a rate
-- limiter exists to catch. INSERT ... ON CONFLICT DO UPDATE takes a row lock
-- and serialises the increment, so N concurrent callers produce N increments.
--
-- Expiry is folded into the same statement rather than left to the sweeper: if
-- the stored window is older than p_window_seconds the row is REUSED with a
-- fresh window and the count restarts. A bucket therefore self-heals on its
-- next request even if the sweeper never runs.
create or replace function public.api_rate_limit_hit(
  p_bucket         text,
  p_limit          integer,
  p_window_seconds integer,
  p_cost           integer default 1
)
-- The result column is `hit_count`, not `hits`, deliberately. RETURNS TABLE
-- columns are PL/pgSQL variables, and naming one `hits` would put a variable
-- and a column of the very table this function writes into the same namespace.
-- Every reference below is either qualified or in a position Postgres parses as
-- a column name, so it would in fact resolve — but "would in fact resolve" is a
-- poor property for a migration against a live database to depend on, and the
-- rename costs nothing.
returns table (
  allowed     boolean,
  hit_count   integer,
  limit_value integer,
  reset_at    timestamptz,
  retry_after integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_hits  integer;
  v_start timestamptz;
  v_reset timestamptz;
begin
  if p_bucket is null or length(p_bucket) = 0 then
    raise exception 'api_rate_limit_hit: bucket is required';
  end if;

  -- Defend the counter against nonsense arguments. A limit of 0 or a negative
  -- window would otherwise mean "block everything"; a caller's bug should not
  -- become an outage.
  p_limit          := greatest(coalesce(p_limit, 60), 1);
  p_window_seconds := greatest(coalesce(p_window_seconds, 60), 1);
  p_cost           := greatest(coalesce(p_cost, 1), 0);

  insert into public.api_rate_limits as r (bucket, window_start, hits)
  values (p_bucket, now(), p_cost)
  on conflict (bucket) do update
     set hits = case
                  when r.window_start <= now() - make_interval(secs => p_window_seconds)
                  then p_cost                -- window expired: start over
                  else r.hits + p_cost       -- same window: accumulate
                end,
         window_start = case
                  when r.window_start <= now() - make_interval(secs => p_window_seconds)
                  then now()
                  else r.window_start
                end
  returning r.hits, r.window_start into v_hits, v_start;

  v_reset := v_start + make_interval(secs => p_window_seconds);

  return query select
    v_hits <= p_limit,
    v_hits,
    p_limit,
    v_reset,
    -- Retry-After must be whole seconds and must never be 0, or a client that
    -- honours it retries instantly and re-triggers the same 429.
    greatest(1, ceil(extract(epoch from (v_reset - now())))::integer);
end;
$fn$;

comment on function public.api_rate_limit_hit(text, integer, integer, integer) is
  'Atomically counts one request against a fixed-window bucket. Returns whether the request is within budget plus the values needed for X-RateLimit-* and Retry-After headers. service_role only.';

-- ---------------------------------------------------------------------------
-- 3. SWEEPER
-- ---------------------------------------------------------------------------

-- Expired rows are harmless (the counter reuses them) but unbounded: every
-- distinct caller that ever hit a limited endpoint leaves one behind. Sweep
-- anything older than a day, well past the longest window any function uses.
create or replace function public.api_rate_limits_sweep(
  p_older_than interval default interval '1 day'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_deleted integer;
begin
  delete from public.api_rate_limits where window_start < now() - p_older_than;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$fn$;

comment on function public.api_rate_limits_sweep(interval) is
  'Deletes rate-limit rows whose window closed long ago. Schedule roughly hourly.';

-- ---------------------------------------------------------------------------
-- 4. GRANTS
-- ---------------------------------------------------------------------------

-- Both are SECURITY DEFINER, so the implicit grant to PUBLIC must be stripped
-- explicitly — otherwise any authenticated user could call the counter directly
-- to burn another caller's budget, or sweep the table clean before an attack.
revoke all on function public.api_rate_limit_hit(text, integer, integer, integer) from public;
revoke all on function public.api_rate_limits_sweep(interval) from public;

grant execute on function public.api_rate_limit_hit(text, integer, integer, integer) to service_role;
grant execute on function public.api_rate_limits_sweep(interval) to service_role;

commit;

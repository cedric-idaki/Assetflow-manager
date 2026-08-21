/// <reference lib="deno.ns" />
/**
 * HTTP EDGE FOR EVERY FUNCTION — CORS, RATE LIMITS, VERSIONING, ERROR HIDING.
 *
 * WHY THIS EXISTS
 * ---------------
 * _shared/auth.ts answers "who is calling". This answers the four questions
 * that come after it, and that every one of the 26 functions previously got
 * wrong in the same way because each hand-rolled its own header block:
 *
 *   1. CORS      — every function shipped `Access-Control-Allow-Origin: "*"`,
 *                  several with `Allow-Headers: "*"` too. That hands any web
 *                  page on the internet a scripted client for this API. It is
 *                  not an authentication hole by itself (auth.ts still runs),
 *                  but it removes the browser's own barrier against a hostile
 *                  page driving the API through a visiting staff member.
 *   2. RATE      — nothing counted anything. send-sms and send-email spend real
 *                  money per call; mpesa-stk-push makes a stranger's phone ring
 *                  with a payment prompt. A loop was the whole attack.
 *   3. VERSION   — responses had no version, so any change to a payload shape
 *                  broke whatever was already deployed. That is worst for the
 *                  Play Store TWA, where "old client" can mean months old.
 *   4. ERRORS    — 17 sites returned `error.message` straight to the caller.
 *                  Postgres puts table and column names in those; Stripe and
 *                  Twilio put account internals. It is free reconnaissance.
 *
 * USAGE
 * -----
 *     const api = await openRequest(req, {
 *       fn: "send-sms",
 *       methods: "POST, OPTIONS",
 *       versions: ["2026-08-21"],
 *     });
 *     if (api.halt) return api.halt;            // preflight / bad origin / bad version
 *
 *     const auth = await authenticateCaller(req);
 *     if (!auth.ok) return api.json({ error: auth.error }, auth.status);
 *
 *     const over = await api.enforceLimit({
 *       action: "send", identity: identityOf(auth.caller), limit: 20, windowSeconds: 60,
 *     });
 *     if (over) return over;                     // 429 with Retry-After
 *
 *     try { ... return api.json({ ok: true }); }
 *     catch (e) { return api.fail(e); }          // logs detail, returns a request id
 *
 * Rate limiting comes AFTER authentication wherever a function has an
 * authenticated caller, so the budget is charged to a user rather than to a
 * shared corporate NAT address. Public functions have no such caller and are
 * limited by hashed IP instead.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";

// ===========================================================================
// 1. CORS — TRUSTED ORIGINS ONLY
// ===========================================================================

/**
 * Where the allowlist comes from.
 *
 * ALLOWED_ORIGINS is the explicit list. PORTAL_URL and ESIGN_ALLOWED_PORTALS
 * already exist in this project for signing links, and a portal that may host a
 * signing page is by definition a trusted origin, so they are folded in rather
 * than duplicated.
 *
 * An entry may be an exact origin ("https://app.example.com") or a single
 * wildcard label ("https://*.vercel.app") for preview deployments. The wildcard
 * matches ONE label and never crosses a dot, so "https://*.vercel.app" accepts
 * "https://ararat-git-abc.vercel.app" but not "https://evil.com.vercel.app.co".
 */
const parseOriginList = (raw: string | undefined): string[] =>
  (raw || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);

let cachedAllowlist: string[] | null = null;

function allowlist(): string[] {
  if (cachedAllowlist) return cachedAllowlist;
  const list = [
    ...parseOriginList(Deno.env.get("ALLOWED_ORIGINS")),
    ...parseOriginList(Deno.env.get("PORTAL_URL")),
    ...parseOriginList(Deno.env.get("ESIGN_ALLOWED_PORTALS")),
  ];
  cachedAllowlist = Array.from(new Set(list));
  return cachedAllowlist;
}

/** Test seam: forget everything memoised so a test can change the env. */
export const resetHttpCache = (): void => {
  cachedAllowlist = null;
  memoryBuckets.clear();
  limiterClient = null;
};

const isLocalOrigin = (origin: string): boolean =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);

function originMatches(origin: string, pattern: string): boolean {
  if (pattern === origin) return true;
  if (!pattern.includes("*")) return false;
  // Escape everything, then re-open the single wildcard as "one label".
  const rx = new RegExp(
    "^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, "[^.]+") + "$",
  );
  return rx.test(origin);
}

/**
 * Is this browser origin allowed to read our responses?
 *
 * Localhost is accepted only when the allowlist is EMPTY (a developer running
 * `supabase functions serve` with no secrets set) or when the origin is
 * explicitly listed. It is never implied in a configured deployment, so a
 * production project cannot quietly trust a developer machine.
 */
export function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  const list = allowlist();
  if (list.length === 0) return isLocalOrigin(origin);
  return list.some((p) => originMatches(origin, p));
}

/** Headers a browser is allowed to READ off our responses. */
const EXPOSED = [
  "X-Api-Version",
  "X-Request-Id",
  "X-RateLimit-Limit",
  "X-RateLimit-Remaining",
  "X-RateLimit-Reset",
  "Retry-After",
].join(", ");

/**
 * Request headers a browser may SEND. The old `"*"` is not merely lax — in a
 * credentialed request browsers ignore the wildcard entirely, so being explicit
 * is also more correct. supabase-js sends apikey / authorization / x-client-info;
 * the rest are ours.
 */
const ALLOWED_REQUEST_HEADERS = [
  "authorization",
  "apikey",
  "content-type",
  "x-client-info",
  "x-api-key",
  "x-api-version",
  "x-request-id",
].join(", ");

export type CorsDecision = {
  /** Headers to attach to every response for this request. */
  headers: Record<string, string>;
  /** The Origin header as sent, or "" when there wasn't one. */
  origin: string;
  /** True when a browser sent an Origin we do not trust. */
  rejected: boolean;
};

/**
 * Decide CORS for one request.
 *
 * The case that matters most here is NO Origin header at all. That is not a
 * browser: it is Safaricom POSTing an M-Pesa callback, a dealer's server
 * calling ingest-assets with an x-api-key, pg_cron driving a worker, or one
 * Edge Function calling another. CORS is a browser mechanism and simply does
 * not apply to them, so they pass through with no CORS headers and nothing
 * breaks. Treating a missing Origin as a rejection would take payments offline.
 */
export function corsFor(req: Request, methods = "POST, OPTIONS"): CorsDecision {
  const origin = (req.headers.get("Origin") || "").replace(/\/+$/, "");

  const base: Record<string, string> = {
    "Content-Type": "application/json",
    // Responses vary by Origin, so a shared cache must not serve one origin's
    // response (with its ACAO) to another.
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
    // These are all authenticated, per-caller, or money-related payloads.
    "Cache-Control": "no-store",
  };

  if (!origin) return { headers: base, origin: "", rejected: false };

  if (!isAllowedOrigin(origin)) {
    // No Access-Control-Allow-Origin: the browser refuses to expose the
    // response to the calling page. We deliberately do not echo the origin back
    // in any form.
    return { headers: base, origin, rejected: true };
  }

  return {
    origin,
    rejected: false,
    headers: {
      ...base,
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": methods,
      "Access-Control-Allow-Headers": ALLOWED_REQUEST_HEADERS,
      "Access-Control-Expose-Headers": EXPOSED,
      // supabase-js sends the session as an Authorization header rather than a
      // cookie, but credentialed fetch is allowed for callers that use one —
      // safe only because the origin above is a single trusted value, never "*".
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Max-Age": "86400",
    },
  };
}

// ===========================================================================
// 2. API VERSIONING
// ===========================================================================

/**
 * Versions are dates, matching the `apiVersion: '2024-06-20'` convention this
 * codebase already uses for Stripe.
 *
 * THE CONTRACT, and the whole point of the exercise:
 *
 *   A client that sends no X-Api-Version gets the OLDEST supported version —
 *   forever. Every client deployed before today sends nothing, so every client
 *   deployed before today keeps the response shape it was written against. New
 *   shapes ship as a NEW dated version that a client opts into explicitly.
 *
 * That is why the default is the oldest and not the newest. Defaulting to the
 * newest would mean shipping a version breaks exactly the clients versioning is
 * supposed to protect.
 *
 * Supabase fixes the URL at /functions/v1/<name>, so the `v1` there is the
 * platform's, not ours, and cannot carry our version. Hence a header, with
 * ?api_version= as a fallback for callers that cannot set headers (a webhook
 * console, a plain <form>, a link).
 *
 * An UNRECOGNISED version is a 400, never a silent downgrade: a client asking
 * for a shape we cannot produce must be told, not handed a different one that
 * happens to parse.
 */
export const API_VERSION_HEADER = "X-Api-Version";

export type VersionDecision =
  | { ok: true; version: string }
  | { ok: false; status: number; error: string };

export function negotiateVersion(req: Request, supported: string[]): VersionDecision {
  if (!supported.length) return { ok: true, version: "" };

  const sorted = [...supported].sort();      // ISO dates sort lexicographically
  const oldest = sorted[0];

  const raw =
    req.headers.get(API_VERSION_HEADER) ||
    new URL(req.url).searchParams.get("api_version") ||
    "";
  const asked = raw.trim();

  if (!asked) return { ok: true, version: oldest };
  if (sorted.includes(asked)) return { ok: true, version: asked };

  return {
    ok: false,
    status: 400,
    error:
      `Unsupported API version "${asked.slice(0, 40)}". ` +
      `Supported: ${sorted.join(", ")}. Omit the ${API_VERSION_HEADER} header to pin the oldest.`,
  };
}

// ===========================================================================
// 3. ERRORS THAT NEVER LEAK
// ===========================================================================

/**
 * An error whose message is SAFE to show a caller, because we wrote it for
 * them: "Phone number is required", "This link has expired".
 *
 * Anything that is not an ApiError is treated as internal — a thrown Postgres
 * error, a Stripe SDK failure, a TypeError from our own bug — and is replaced
 * with a generic message before it leaves the building.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status = 400, code = "bad_request") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Correlates the generic client message with the full server-side log line. */
const requestIdOf = (req: Request): string =>
  req.headers.get("x-request-id")?.slice(0, 64) || crypto.randomUUID();

// ===========================================================================
// 4. RATE LIMITING
// ===========================================================================

/**
 * Per-isolate fallback counter.
 *
 * The database is the real limiter (see 20260821150000_api_rate_limits.sql).
 * This exists for the case where the RPC itself fails — Postgres unreachable,
 * migration not yet applied, service-role key missing. The alternatives were
 * both bad: fail open and the abuse endpoints are wide open during exactly the
 * incident an attacker would pick, or fail closed and a database blip stops
 * payments. So a degraded limiter runs in-process instead.
 *
 * It is genuinely weaker — it counts one isolate's traffic, so a caller spread
 * across instances gets more than the budget — but "weaker than intended" beats
 * both "absent" and "outage".
 */
type MemoryBucket = { windowStart: number; hits: number };
const memoryBuckets = new Map<string, MemoryBucket>();

/** Keeps a long-lived isolate from accumulating buckets without bound. */
const MEMORY_BUCKET_CAP = 5_000;

function memoryLimit(bucket: string, limit: number, windowSeconds: number): RateVerdict {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  if (memoryBuckets.size > MEMORY_BUCKET_CAP) {
    for (const [k, v] of memoryBuckets) {
      if (now - v.windowStart > windowMs) memoryBuckets.delete(k);
    }
    // Still full of live buckets: this isolate is under real load, and holding
    // stale-but-live counters matters more than perfect bookkeeping.
    if (memoryBuckets.size > MEMORY_BUCKET_CAP) memoryBuckets.clear();
  }

  const existing = memoryBuckets.get(bucket);
  const fresh = !existing || now - existing.windowStart >= windowMs;
  const entry: MemoryBucket = fresh
    ? { windowStart: now, hits: 1 }
    : { windowStart: existing!.windowStart, hits: existing!.hits + 1 };
  memoryBuckets.set(bucket, entry);

  const resetAt = entry.windowStart + windowMs;
  return {
    allowed: entry.hits <= limit,
    limit,
    remaining: Math.max(0, limit - entry.hits),
    resetAt: new Date(resetAt),
    retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    degraded: true,
  };
}

/**
 * One row of api_rate_limit_hit()'s result.
 *
 * Spelled out because the client is built without generated database types, so
 * supabase-js resolves rpc() to `never` and every field access below would be a
 * type error. Keep this in step with the RETURNS TABLE in
 * 20260821150000_api_rate_limits.sql.
 */
type RateLimitRow = {
  allowed: boolean;
  hit_count: number;
  limit_value: number;
  reset_at: string;
  retry_after: number;
};

export type RateVerdict = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfter: number;
  /** True when the in-process fallback answered instead of the database. */
  degraded: boolean;
};

let limiterClient: ReturnType<typeof createClient> | null = null;

function limiter() {
  if (!limiterClient && SUPABASE_URL && SERVICE_ROLE_KEY) {
    limiterClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return limiterClient;
}

export async function consumeRateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
  cost = 1,
): Promise<RateVerdict> {
  const client = limiter();
  if (!client) return memoryLimit(bucket, limit, windowSeconds);

  try {
    const { data, error } = await (client.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: RateLimitRow[] | RateLimitRow | null; error: unknown }>)(
      "api_rate_limit_hit",
      {
        p_bucket: bucket,
        p_limit: limit,
        p_window_seconds: windowSeconds,
        p_cost: cost,
      },
    );
    if (error) throw error;

    const row: RateLimitRow | null = Array.isArray(data) ? data[0] ?? null : data;
    if (!row) throw new Error("api_rate_limit_hit returned no row");

    return {
      allowed: Boolean(row.allowed),
      limit: Number(row.limit_value ?? limit),
      remaining: Math.max(0, Number(row.limit_value ?? limit) - Number(row.hit_count ?? 0)),
      resetAt: new Date(row.reset_at),
      retryAfter: Math.max(1, Number(row.retry_after ?? windowSeconds)),
      degraded: false,
    };
  } catch (err) {
    console.error("rate-limit: falling back to in-process counter", {
      bucket: bucket.split(":").slice(0, 2).join(":"),   // never log the identity
      error: err instanceof Error ? err.message : String(err),
    });
    return memoryLimit(bucket, limit, windowSeconds);
  }
}

/**
 * Salted SHA-256 of a client IP, for use as a rate-limit identity.
 *
 * Never the address itself: this string becomes a primary key in a table we
 * keep, and "who visited" is not something this feature needs to record. The
 * per-function salt stops one visitor being correlated across endpoints. Mirrors
 * hashIp() in listing-public, which already does this for view logging.
 */
export async function hashedIp(req: Request, salt: string): Promise<string> {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = (fwd.split(",")[0] || req.headers.get("x-real-ip") || "").trim();
  if (!ip) return "unknown";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

// ===========================================================================
// 5. THE PER-REQUEST HANDLE
// ===========================================================================

export type OpenOptions = {
  /** Function name. Namespaces rate-limit buckets and tags log lines. */
  fn: string;
  /** Value for Access-Control-Allow-Methods. */
  methods?: string;
  /** Supported API versions, ISO dates. Oldest is the default for old clients. */
  versions?: string[];
};

export type LimitOptions = {
  /** What is being limited — "send", "enquire", "view". Namespaces the bucket. */
  action: string;
  /**
   * Strongest available caller identity: user id, key hash, or hashed IP.
   * `null` EXEMPTS the request — see callerIdentity().
   */
  identity: string | null;
  limit: number;
  windowSeconds: number;
  /** Charge more than one unit for a request that costs us more. */
  cost?: number;
};

/**
 * Rate-limit identity for an authenticated caller, or null to exempt.
 *
 * Service-role callers are exempt, and that is not a loophole — it is required
 * for correctness. Internal traffic is one Edge Function calling another
 * (esign-reminders and payment-alerts fan out to send-email / send-sms one
 * recipient at a time) or pg_cron driving a worker. A nightly reminder batch
 * legitimately makes hundreds of calls in a burst; metering it against a
 * per-caller budget would throttle the platform's own scheduled work and drop
 * notifications that customers depend on. The service-role key is not
 * obtainable by a client — it never ships to the browser — so exempting it
 * grants nothing to an attacker that they would not already own outright.
 *
 * Every genuine end-user is limited by user id, which is strictly better than
 * limiting by IP: it survives a phone changing networks and it does not punish
 * a whole office behind one NAT address.
 */
export const callerIdentity = (
  caller: { kind: "service" } | { kind: "user"; userId: string },
): string | null => (caller.kind === "service" ? null : `user:${caller.userId}`);

export type ApiContext = {
  /** Non-null when the request is already answered: preflight, bad origin, bad version. */
  halt: Response | null;
  /** The negotiated API version. */
  version: string;
  /** Correlation id, echoed to the client and present in every log line. */
  requestId: string;
  /** Response headers, for handlers that build a Response by hand. */
  headers: Record<string, string>;
  json: (body: unknown, status?: number, extra?: Record<string, string>) => Response;
  /** Returns a 429 Response when over budget, or null to proceed. */
  enforceLimit: (opts: LimitOptions) => Promise<Response | null>;
  /** Logs the real error, returns a safe one. */
  fail: (err: unknown, status?: number) => Response;
};

export async function openRequest(req: Request, opts: OpenOptions): Promise<ApiContext> {
  const cors = corsFor(req, opts.methods || "POST, OPTIONS");
  const requestId = requestIdOf(req);
  const versions = opts.versions || [];

  const headers: Record<string, string> = { ...cors.headers, "X-Request-Id": requestId };

  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });

  // --- Preflight ---------------------------------------------------------
  // Answered before anything else and without touching auth or the database:
  // a preflight carries no credentials by definition, so there is nothing to
  // check and no reason to spend a query on it.
  if (req.method === "OPTIONS") {
    const halt = cors.rejected
      ? json({ error: "Origin not allowed." }, 403)
      : new Response(null, { status: 204, headers });
    return stub(halt, headers, requestId, json);
  }

  // --- Disallowed browser origin ----------------------------------------
  // Omitting Access-Control-Allow-Origin already stops the page reading the
  // response, but the request would still have RUN. For anything with a side
  // effect that is too late, so refuse outright.
  //
  // This is defence in depth, not authentication: a non-browser client sends
  // whatever Origin it likes, or none. auth.ts remains the actual gate.
  if (cors.rejected) {
    console.warn(`${opts.fn}: rejected origin`, { requestId, origin: cors.origin });
    return stub(json({ error: "Origin not allowed.", requestId }, 403), headers, requestId, json);
  }

  // --- Version -----------------------------------------------------------
  const negotiated = negotiateVersion(req, versions);
  if (!negotiated.ok) {
    return stub(
      json({ error: negotiated.error, requestId }, negotiated.status),
      headers,
      requestId,
      json,
    );
  }
  const version = negotiated.version;
  if (version) headers[API_VERSION_HEADER] = version;

  const enforceLimit = async (limitOpts: LimitOptions): Promise<Response | null> => {
    // A null identity is a deliberate exemption for internal service traffic.
    // "" is not — that is a caller we failed to identify, and it gets pooled
    // under one shared budget rather than escaping the limiter entirely.
    if (limitOpts.identity === null) return null;

    const identity = limitOpts.identity || "unidentified";
    const bucket = `${opts.fn}:${limitOpts.action}:${identity}`;
    const verdict = await consumeRateLimit(
      bucket,
      limitOpts.limit,
      limitOpts.windowSeconds,
      limitOpts.cost ?? 1,
    );

    const rateHeaders = {
      "X-RateLimit-Limit": String(verdict.limit),
      "X-RateLimit-Remaining": String(verdict.remaining),
      "X-RateLimit-Reset": String(Math.floor(verdict.resetAt.getTime() / 1000)),
    };
    Object.assign(headers, rateHeaders);

    if (verdict.allowed) return null;

    console.warn(`${opts.fn}: rate limit exceeded`, {
      requestId,
      action: limitOpts.action,
      limit: verdict.limit,
      degraded: verdict.degraded,
    });

    return json(
      {
        error: "Too many requests. Please slow down and try again shortly.",
        retryAfter: verdict.retryAfter,
        requestId,
      },
      429,
      { ...rateHeaders, "Retry-After": String(verdict.retryAfter) },
    );
  };

  const fail = (err: unknown, status = 500): Response => {
    // Deliberate, caller-facing message: pass it through unchanged.
    if (err instanceof ApiError) {
      return json({ error: err.message, code: err.code, requestId }, err.status);
    }

    // Everything else is internal. The full detail goes to the function log,
    // where the operator can find it by requestId; the caller gets a sentence
    // and that id. No message, no code, no stack, no table names.
    console.error(`${opts.fn}: unhandled error`, {
      requestId,
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });

    return json(
      {
        error: "Something went wrong on our end. Please try again.",
        code: "internal_error",
        requestId,
      },
      status,
    );
  };

  return { halt: null, version, requestId, headers, json, enforceLimit, fail };
}

/** An ApiContext that is already answered — every method resolves to `halt`. */
function stub(
  halt: Response,
  headers: Record<string, string>,
  requestId: string,
  json: ApiContext["json"],
): ApiContext {
  return {
    halt,
    version: "",
    requestId,
    headers,
    json,
    enforceLimit: async () => null,
    fail: () => halt,
  };
}

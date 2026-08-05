/// <reference lib="deno.ns" />
/**
 * Caller authentication for Edge Functions.
 *
 * WHY THIS EXISTS
 * ---------------
 * `verify_jwt = true` is NOT an authorization check. It only asserts that the
 * bearer token is a valid JWT signed by this project — and the ANON KEY is
 * exactly that. The anon key ships inside the public JS bundle, so any function
 * that relied on `verify_jwt` alone was callable by anybody who opened
 * devtools. That is how send-email / send-sms / maker-checker-notify became an
 * open mail-and-SMS relay on a verified sending domain.
 *
 * Every function must therefore identify its caller IN CODE. Use:
 *
 *     const auth = await authenticateCaller(req);
 *     if (!auth.ok) return json({ error: auth.error }, auth.status);
 *     const denied = requireStaff(auth.caller);      // or requireRole(...)
 *     if (denied) return json({ error: denied.error }, denied.status);
 *
 * A caller is one of:
 *   - "service": the request carried the service-role key. This is how one Edge
 *     Function calls another (esign-*, *-reminders → send-email / send-sms) and
 *     how pg_cron invokes workers. Always allowed; role checks are skipped.
 *   - "user": a real end-user session, resolved through auth.getUser() and then
 *     looked up in user_profiles for the role.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
// Deployments in this project use both names, so accept either.
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

/** Length-independent equality, to avoid leaking the key a byte at a time. */
export const safeEqual = (a?: string | null, b?: string | null): boolean => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export type Caller =
  | { kind: "service" }
  | { kind: "user"; userId: string; email?: string; role: string; adminId: string | null };

export type AuthResult =
  | { ok: true; caller: Caller }
  | { ok: false; status: number; error: string };

export type Denial = { status: number; error: string } | null;

/** Roles that are NOT internal staff of a tenant. */
const NON_STAFF_ROLES = ["client", "sacco_member"];

export const bearerFrom = (req: Request): string => {
  const h = req.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
};

/** True when the request carries the service-role key (internal / scheduler). */
export const isServiceRole = (req: Request): boolean =>
  safeEqual(bearerFrom(req), SERVICE_ROLE_KEY);

/**
 * Capability probe for a service-role credential.
 *
 * Comparing the bearer token against Deno.env's service-role key is NOT
 * reliable on this project: it has two key generations live at once (legacy
 * `eyJ…` JWTs plus newer `sb_publishable_` / `sb_secret_` keys), and the value
 * injected into a function does not necessarily equal the credential a caller
 * actually presents. A string compare therefore silently rejects legitimate
 * internal traffic — exactly the kind of outage a security fix must not cause.
 *
 * So ask the platform instead of guessing: only a genuine service-role
 * credential can drive the GoTrue admin API, and its signature is validated
 * server-side, so this cannot be forged by crafting a token with
 * `"role":"service_role"` in the payload.
 *
 * Only reached AFTER getUser() has failed, so ordinary user requests never pay
 * for the extra round trip. The single-entry cache keeps repeat internal calls
 * on a warm instance from re-probing.
 */
let cachedServiceToken: string | null = null;

async function hasServiceRolePower(token: string): Promise<boolean> {
  if (cachedServiceToken && safeEqual(token, cachedServiceToken)) return true;
  if (!SUPABASE_URL) return false;
  try {
    const probe = createClient(SUPABASE_URL, token, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) return false;
    cachedServiceToken = token;
    return true;
  } catch {
    return false;
  }
}

export async function authenticateCaller(req: Request): Promise<AuthResult> {
  const token = bearerFrom(req);
  if (!token) return { ok: false, status: 401, error: "Missing Authorization header." };

  // Fast path: the token matches this function's own service-role env value.
  if (SERVICE_ROLE_KEY && safeEqual(token, SERVICE_ROLE_KEY)) {
    return { ok: true, caller: { kind: "service" } };
  }

  // The anon key is a structurally valid project JWT — which is precisely why
  // verify_jwt never authenticated anything. Reject it explicitly: it
  // identifies the application, never a caller.
  if (ANON_KEY && safeEqual(token, ANON_KEY)) {
    return { ok: false, status: 401, error: "Authentication required." };
  }

  if (!SUPABASE_URL) {
    // Fail closed rather than silently accepting when the function is
    // misconfigured — an unauthenticated relay is worse than an outage.
    console.error("auth: SUPABASE_URL not configured");
    return { ok: false, status: 500, error: "Server auth not configured." };
  }

  // Resolve as an end-user session. A service-role credential has no `sub`
  // claim, so this legitimately fails for internal callers.
  const verifier = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || token, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error } = await verifier.auth.getUser(token);
  if (error || !user) {
    if (await hasServiceRolePower(token)) return { ok: true, caller: { kind: "service" } };
    return { ok: false, status: 401, error: "Invalid or expired session." };
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || token, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile } = await admin
    .from("user_profiles")
    .select("role, admin_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.role) {
    return { ok: false, status: 403, error: "No profile is associated with this account." };
  }

  return {
    ok: true,
    caller: {
      kind: "user",
      userId: user.id,
      email: user.email ?? undefined,
      role: String(profile.role),
      adminId: (profile as { admin_id?: string | null }).admin_id ?? null,
    },
  };
}

/** Restrict to an explicit role allowlist. Service-role callers bypass. */
export const requireRole = (caller: Caller, roles: string[]): Denial => {
  if (caller.kind === "service") return null;
  if (!roles.includes(caller.role)) {
    return { status: 403, error: `Role "${caller.role}" is not permitted to perform this action.` };
  }
  return null;
};

/** Restrict to tenant staff — anyone who is not a client or sacco member. */
export const requireStaff = (caller: Caller): Denial => {
  if (caller.kind === "service") return null;
  if (NON_STAFF_ROLES.includes(caller.role)) {
    return { status: 403, error: `Role "${caller.role}" is not permitted to perform this action.` };
  }
  return null;
};

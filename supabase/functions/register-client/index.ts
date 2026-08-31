// register-client — backend for the public client registration page,
// /user-registration-screen.
//
// The person filling this in has no account yet, by definition, so the function
// is unauthenticated (verify_jwt = false) and runs with the service role. That
// makes it the whole security boundary for direct client signup, the same
// position listing-public holds for the public listing page, and it is built
// the same way:
//
//   1. It decides NOTHING about attribution. Which company the client lands in
//      and which agent (if any) gets the credit are both resolved inside
//      public.register_direct_client() from the codes that were typed. The body
//      cannot name a tenant, an admin_id, an agent_id or a channel.
//   2. A registration code is required before an auth user is ever minted, so
//      the endpoint is not an open account factory. A caller without a valid
//      code cannot create a single login.
//   3. Every miss answers identically — a bad code and a company that has
//      self-signup switched off are the same response — so the code space
//      cannot be walked to enumerate tenants.
//
//   POST { action: "resolve",  code }
//        → { company: { name, city } }        — "you are registering with Acme"
//   POST { action: "register", code, fullName, email, password, phone?, agentCode? }
//        → { accountNumber, acquisitionChannel, agentName, company }
//
// @ts-nocheck — Deno runtime globals are not known to the app's TS config.
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hashedIp, openRequest } from "../_shared/http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";

const API_VERSIONS = ["2026-08-21"];

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Codes are 8 chars from generate_signup_code's unambiguous alphabet; agent
// codes are whatever an admin typed into agentmodal (AGT-1724... by default).
// Both are bounded and checked here so nothing shapeless reaches the database.
const SIGNUP_CODE_RE = /^[A-Za-z0-9]{4,16}$/;
const AGENT_CODE_RE = /^[A-Za-z0-9_-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (v: unknown, max = 200): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s.length ? s : null;
};

// Server-side password policy — mirrors PASSWORD_POLICY in src/utils/validation.js
// and the identical check in create-staff-user. Enforced here so the rule holds
// for a direct API call, not only for someone using the form. Keep in sync.
const passwordPolicyError = (pw: string): string | null => {
  const failed: string[] = [];
  if (pw.length < 8) failed.push("at least 8 characters");
  if (!/[A-Z]/.test(pw)) failed.push("an uppercase letter");
  if (!/[a-z]/.test(pw)) failed.push("a lowercase letter");
  if (!/[0-9]/.test(pw)) failed.push("a number");
  if (!/[^A-Za-z0-9]/.test(pw)) failed.push("a special character");
  return failed.length ? `Password must include ${failed.join(", ")}.` : null;
};

serve(async (req) => {
  const api = await openRequest(req, {
    fn: "register-client",
    methods: "POST, OPTIONS",
    versions: API_VERSIONS,
  });
  if (api.halt) return api.halt;

  const json = api.json;

  // The registrant has no account, so a salted hash of their IP is the only
  // identity available — the same treatment listing-public gives a buyer.
  const visitor = `ip:${await hashedIp(req, "register-client")}`;

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    console.error("register-client: service credentials not configured");
    return json({ error: "Server not configured." }, 500);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const action = clean(body?.action, 20);
  const code = clean(body?.code, 16);

  if (!code || !SIGNUP_CODE_RE.test(code)) {
    return json({ error: "That registration code was not recognised." }, 404);
  }

  // ── Resolve the tenant ────────────────────────────────────────────────────
  // Both actions start here, and both answer a miss identically. resolve_signup_code
  // returns the company NAME and city and nothing else — no ids, no contacts —
  // so a probe that guesses a live code learns only what a poster would say.
  const { data: tenantRows, error: tenantErr } = await admin
    .rpc("resolve_signup_code", { p_code: code });

  if (tenantErr) {
    console.error("register-client: code lookup failed:", tenantErr.message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }

  const tenant = Array.isArray(tenantRows) ? tenantRows[0] : tenantRows;

  if (!tenant?.company_name) {
    // A wrong code is cheap to answer and cheap to retry, which is exactly what
    // makes it worth guessing. Misses get their own tight budget so the code
    // space cannot be searched, while a real registrant — who arrived with a
    // code that works — never touches this limit.
    const probing = await api.enforceLimit({
      action: "miss",
      identity: visitor,
      limit: 10,
      windowSeconds: 600,
    });
    if (probing) return probing;

    return json({ error: "That registration code was not recognised." }, 404);
  }

  const company = { name: tenant.company_name, city: tenant.city ?? null };

  // ── resolve — "which company am I signing up with?" ───────────────────────
  if (action === "resolve") {
    const over = await api.enforceLimit({
      action: "resolve",
      identity: visitor,
      limit: 30,
      windowSeconds: 300,
    });
    if (over) return over;

    return json({ company });
  }

  if (action !== "register") {
    return json({ error: "Invalid request." }, 400);
  }

  // ── register ──────────────────────────────────────────────────────────────
  const fullName = clean(body?.fullName, 120);
  const email = clean(body?.email, 160)?.toLowerCase() ?? null;
  const phone = clean(body?.phone, 32);
  const agentCode = clean(body?.agentCode, 32);
  const password = typeof body?.password === "string" ? body.password : "";

  if (!fullName || fullName.length < 2) {
    return json({ error: "Please give your full name." }, 400);
  }
  if (!email || !EMAIL_RE.test(email)) {
    return json({ error: "Please give a valid email address." }, 400);
  }
  if (agentCode && !AGENT_CODE_RE.test(agentCode)) {
    return json({ error: "That sales agent code was not recognised." }, 400);
  }

  const pwError = passwordPolicyError(password);
  if (pwError) return json({ error: pwError }, 400);

  // Creating a login and consuming an email address is the expensive,
  // irreversible half. Charged per IP and deliberately tight: a household
  // registering two people on one connection is fine, a loop is not.
  const over = await api.enforceLimit({
    action: "register",
    identity: visitor,
    limit: 5,
    windowSeconds: 3600,
  });
  if (over) return over;

  try {
    // ── Does this email already have an account? ───────────────────────────
    // Answered before anything is created. Telling the visitor "you already
    // have an account, sign in" is worth the small existence disclosure — it is
    // the same thing the sign-in screen tells them, and the alternative is a
    // dead end they cannot get out of.
    const { data: existing } = await admin.auth.admin.listUsers();
    const clash = existing?.users?.find(
      (u: any) => (u.email || "").toLowerCase() === email,
    );

    if (clash) {
      return json({
        error: "An account with that email already exists. Please sign in instead.",
        code: "email_taken",
      }, 409);
    }

    // ── Mint the login ────────────────────────────────────────────────────
    // email_confirm: true because the password was chosen here and now, by the
    // person holding the mailbox-independent registration code. Leaving it
    // false would create an account that cannot sign in until a confirmation
    // mail lands, and the clients row below would already exist — a half
    // account is worse than either outcome.
    //
    // role: 'client' in the metadata is what handle_new_user() writes into
    // user_profiles. The RPC then binds that profile to the tenant; the
    // metadata alone grants nothing, since handle_new_user clamps what it will
    // accept and 'client' has no privileges anywhere.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, role: "client" },
    });

    if (createErr || !created?.user?.id) {
      console.error("register-client: auth user creation failed:", createErr?.message);
      return json({ error: "We could not create your account. Please try again." }, 500);
    }

    const authUserId = created.user.id;

    // ── Bind it to the tenant ─────────────────────────────────────────────
    const { data: result, error: rpcErr } = await admin.rpc("register_direct_client", {
      p_signup_code: code,
      p_auth_user_id: authUserId,
      p_full_name: fullName,
      p_email: email,
      p_phone: phone,
      p_agent_code: agentCode,
    });

    if (rpcErr) {
      // Roll the login back. inviteClient's comment records what happens
      // otherwise: an auth user with no client row AND the email address
      // consumed, so the person cannot even retry with their own address.
      try {
        await admin.auth.admin.deleteUser(authUserId);
      } catch (delErr) {
        console.error("register-client: rollback failed:", (delErr as Error).message);
      }

      // 22023 is what the RPC raises for the two things the registrant can
      // actually fix — a bad registration code, a bad agent code — so that
      // wording is passed through. Anything else is ours, not theirs.
      const theirs = rpcErr.code === "22023";
      console.error("register-client: binding failed:", rpcErr.message);
      return json(
        { error: theirs ? rpcErr.message : "We could not complete your registration. Please try again." },
        theirs ? 400 : 500,
      );
    }

    return json({
      accountNumber: result?.account_number ?? null,
      acquisitionChannel: result?.acquisition_channel ?? "direct",
      agentName: result?.agent_name ?? null,
      company,
      // 'pending' until the company activates the account. The page says so
      // rather than implying the client can start transacting.
      status: "pending",
    }, 201);
  } catch (err) {
    return api.fail(err);
  }
});

/// <reference lib="deno.ns" />
/**
 * SIGNNOW CONNECTION — the write path for a tenant's own SignNow account.
 *
 * signnow_connections has RLS enabled with zero policies, so nothing in the
 * browser can read or write it. This function is the only door, and it runs
 * under the service role.
 *
 * Four rules it exists to enforce — the same four as mpesa-credentials, for the
 * same reasons:
 *
 *  1. SECRETS ARE ENCRYPTED BEFORE THEY TOUCH THE DATABASE. Client id, client
 *     secret, username, password and the webhook secret are AES-256-GCM sealed
 *     with SIGNNOW_CRED_ENC_KEY, which lives only in function secrets.
 *
 *  2. SECRETS ARE NEVER RETURNED. Not to the owner, not to a super admin. The
 *     response says whether each is PRESENT, never what it is. The account
 *     email IS returned — it is the "from" address on every invite the tenant's
 *     officers receive, so an operator needs to see which login is sending.
 *
 *  3. CREDENTIALS ARE NOT TRUSTED UNTIL SIGNNOW ACCEPTS THEM. Saving performs
 *     a live token fetch. is_active is set only when that succeeds, so the
 *     send path (which skips inactive rows) can never queue a certificate
 *     against an account we have never authenticated with.
 *
 *  4. THE WEBHOOK IS REGISTERED HERE, NOT BY HAND. A connection without
 *     callbacks looks healthy and silently never completes anything: documents
 *     get signed and the register never finds out. So connecting also
 *     subscribes the four events, with a freshly generated per-tenant HMAC
 *     secret.
 *
 * verify_jwt = true: the caller's JWT is what establishes which tenant these
 * credentials belong to. admin_id is never taken from the request body.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openRequest } from "../_shared/http.ts";
import { encryptSecret, decryptSecret, keyConfigured } from "../_shared/crypto.ts";
import {
  getToken,
  createWebhook,
  deleteWebhook,
  newWebhookSecret,
  WEBHOOK_EVENTS,
  SignNowError,
  type SignNowCreds,
  type SignNowEnvironment,
} from "../_shared/signnow.ts";

const API_VERSIONS = ["2026-09-01"];

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

/** Roles that own a tenant, and may therefore connect its SignNow account. */
const TENANT_OWNER_ROLES = ["admin", "sacco_admin"];

type Row = {
  id: string;
  admin_id: string;
  environment: string;
  account_email: string | null;
  client_id_enc: string;
  client_secret_enc: string;
  username_enc: string;
  password_enc: string;
  webhook_secret_enc: string | null;
  webhook_registered_at: string | null;
  webhook_event_ids: unknown;
  is_active: boolean;
  verified_at: string | null;
  last_error: string | null;
  updated_at: string | null;
};

/**
 * Open a stored connection back into usable credentials.
 *
 * The AAD is the tenant's admin_id, not the row id: a connection that is
 * disconnected and remade gets a new row id, and ciphertext sealed under the
 * old one would stop decrypting for no reason a reader could work out.
 */
async function credsFrom(row: Row): Promise<SignNowCreds> {
  const c = { recordId: row.admin_id, field: "signnow" };
  return {
    clientId: await decryptSecret(row.client_id_enc, "signnow", c),
    clientSecret: await decryptSecret(row.client_secret_enc, "signnow", c),
    username: await decryptSecret(row.username_enc, "signnow", c),
    password: await decryptSecret(row.password_enc, "signnow", c),
    environment: row.environment as SignNowEnvironment,
  };
}

/** The safe shape: everything an operator needs, nothing they could leak. */
const publicView = (row: Row | null, callbackUrl: string) => ({
  configured: !!row,
  environment: (row?.environment ?? "sandbox") as SignNowEnvironment,
  accountEmail: row?.account_email ?? null,
  isActive: row?.is_active ?? false,
  verifiedAt: row?.verified_at ?? null,
  lastError: row?.last_error ?? null,
  updatedAt: row?.updated_at ?? null,
  webhook: {
    url: callbackUrl,
    registeredAt: row?.webhook_registered_at ?? null,
    events: Array.isArray(row?.webhook_event_ids) ? row!.webhook_event_ids.length : 0,
  },
  // Presence only — never the values.
  present: {
    clientId: Boolean(row?.client_id_enc),
    clientSecret: Boolean(row?.client_secret_enc),
    username: Boolean(row?.username_enc),
    password: Boolean(row?.password_enc),
  },
  // An operator who has connected the eval account and expects real invites
  // will otherwise spend an afternoon on it.
  isSandbox: (row?.environment ?? "sandbox") === "sandbox",
  encryptionReady: keyConfigured("signnow"),
});

Deno.serve(async (req) => {
  const api = await openRequest(req, {
    fn: "signnow-credentials",
    methods: "POST, OPTIONS",
    versions: API_VERSIONS,
  });
  if (api.halt) return api.halt;

  const json = api.json;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const callbackUrl = `${supabaseUrl}/functions/v1/signnow-webhook`;

    // ── Identify the caller ─────────────────────────────────────────────────
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Not authenticated" }, 401);

    const { data: userData } = await admin.auth.getUser(jwt);
    const user = userData?.user;
    if (!user) return json({ error: "Not authenticated" }, 401);

    // Saving verifies against SignNow, so each call is an external round trip —
    // and this is the one endpoint where an attacker holding a tenant-owner
    // session could brute-force SignNow logins using our server as the caller.
    // Connecting happens a handful of times in a tenant's life.
    const over = await api.enforceLimit({
      action: "save",
      identity: `user:${user.id}`,
      limit: 10,
      windowSeconds: 60,
    });
    if (over) return over;

    const { data: profile } = await admin
      .from("user_profiles")
      .select("role, admin_id")
      .eq("id", user.id)
      .maybeSingle();

    if (!TENANT_OWNER_ROLES.includes(profile?.role ?? "")) {
      return json(
        { error: "Only the account owner can connect SignNow for this organisation." },
        403,
      );
    }

    // Mirrors public.current_admin_id(). Staff of a tenant resolve to their
    // owning admin, but the role gate above already excludes them.
    const adminId: string = profile?.admin_id ?? user.id;

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? "status";

    const loadRow = async (): Promise<Row | null> => {
      const { data } = await admin
        .from("signnow_connections")
        .select("*")
        .eq("admin_id", adminId)
        .maybeSingle();
      return (data as Row) ?? null;
    };

    // ── status ──────────────────────────────────────────────────────────────
    if (action === "status") {
      return json(publicView(await loadRow(), callbackUrl));
    }

    // ── disable ─────────────────────────────────────────────────────────────
    // Stops sending without destroying the credentials, so turning it back on
    // does not mean re-keying four secrets from the SignNow developer portal.
    // The webhook subscriptions are left in place deliberately: a document
    // already out for signature must still be able to complete.
    if (action === "disable") {
      const existing = await loadRow();
      if (!existing) return json({ error: "SignNow is not set up for this account." }, 404);

      await admin
        .from("signnow_connections")
        .update({ is_active: false, last_error: "Switched off by the account owner.", updated_at: new Date().toISOString() })
        .eq("admin_id", adminId);

      return json({
        ...publicView(await loadRow(), callbackUrl),
        message: "SignNow sending switched off. Documents already out for signature can still complete.",
      });
    }

    // ── disconnect ──────────────────────────────────────────────────────────
    // The full removal: unsubscribe the callbacks at SignNow, then drop the
    // row. Unsubscribing first, and only deleting if we got a token, means a
    // failure here never leaves SignNow posting to an endpoint that no longer
    // knows the secret to verify it with.
    if (action === "disconnect") {
      const existing = await loadRow();
      if (!existing) return json({ error: "SignNow is not set up for this account." }, 404);

      let unsubscribed = 0;
      let unsubscribeError: string | null = null;
      try {
        const token = await getToken(await credsFrom(existing));
        const ctx = { token: token.accessToken, environment: existing.environment as SignNowEnvironment };
        const ids = Array.isArray(existing.webhook_event_ids) ? existing.webhook_event_ids : [];
        for (const id of ids) {
          await deleteWebhook(ctx, String(id));
          unsubscribed += 1;
        }
      } catch (err) {
        unsubscribeError = err instanceof SignNowError ? err.publicMessage : "Could not reach SignNow.";
        console.warn("signnow-credentials: unsubscribe failed", { adminId, detail: (err as Error).message });
      }

      await admin.from("signnow_connections").delete().eq("admin_id", adminId);

      return json({
        ...publicView(null, callbackUrl),
        message: unsubscribeError
          ? `Disconnected here, but the SignNow callbacks could not be removed: ${unsubscribeError} Remove them in the SignNow portal.`
          : `Disconnected. ${unsubscribed} callback subscription${unsubscribed === 1 ? "" : "s"} removed from SignNow.`,
      });
    }

    // ── save ────────────────────────────────────────────────────────────────
    if (action !== "save") return json({ error: `Unknown action '${action}'` }, 400);

    if (!keyConfigured("signnow")) {
      return json(
        {
          error:
            "SIGNNOW_CRED_ENC_KEY is not set on this project, so credentials cannot be stored securely. Set it in the Supabase function secrets first.",
          code: "ENC_KEY_MISSING",
        },
        503,
      );
    }

    const existing = await loadRow();

    const environment: SignNowEnvironment =
      body.environment === "production" ? "production" : "sandbox";

    // Blank means "keep what is already stored", so an operator can switch
    // sandbox to production without re-pasting four secrets they may not have
    // to hand. A first-time save has nothing to keep, so all four are required.
    const rawClientId = String(body.clientId ?? "").trim();
    const rawSecret = String(body.clientSecret ?? "").trim();
    const rawUsername = String(body.username ?? "").trim().toLowerCase();
    const rawPassword = String(body.password ?? "");

    if (!existing && (!rawClientId || !rawSecret || !rawUsername || !rawPassword)) {
      return json(
        { error: "Client id, client secret, username and password are all required the first time." },
        400,
      );
    }

    if (rawUsername && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawUsername)) {
      return json({ error: "The SignNow username must be the account's email address." }, 400);
    }

    const ctxOf = (id: string) => ({ recordId: id, field: "signnow" });

    // ── Prove SignNow accepts them BEFORE going live ──────────────────────
    const candidate: SignNowCreds = {
      clientId: rawClientId || (await decryptSecret(existing!.client_id_enc, "signnow", ctxOf(existing!.admin_id))),
      clientSecret: rawSecret || (await decryptSecret(existing!.client_secret_enc, "signnow", ctxOf(existing!.admin_id))),
      username: rawUsername || (await decryptSecret(existing!.username_enc, "signnow", ctxOf(existing!.admin_id))),
      password: rawPassword || (await decryptSecret(existing!.password_enc, "signnow", ctxOf(existing!.admin_id))),
      environment,
    };

    let verified = false;
    let lastError: string | null = null;
    let accessToken = "";
    try {
      const token = await getToken(candidate);
      accessToken = token.accessToken;
      verified = true;
    } catch (err) {
      lastError = err instanceof SignNowError ? err.publicMessage : "Could not reach SignNow.";
      console.warn("signnow-credentials: verification failed", { adminId, detail: (err as Error).message });
    }

    // AAD binds each ciphertext to this tenant's row, so a value copied from
    // another tenant's row will not decrypt. adminId is the stable key here —
    // the row id changes if the connection is deleted and remade.
    const aad = ctxOf(adminId);
    const clientIdEnc = rawClientId ? await encryptSecret(rawClientId, "signnow", aad) : existing!.client_id_enc;
    const clientSecretEnc = rawSecret ? await encryptSecret(rawSecret, "signnow", aad) : existing!.client_secret_enc;
    const usernameEnc = rawUsername ? await encryptSecret(rawUsername, "signnow", aad) : existing!.username_enc;
    const passwordEnc = rawPassword ? await encryptSecret(rawPassword, "signnow", aad) : existing!.password_enc;

    // ── Webhooks ──────────────────────────────────────────────────────────
    // Only attempted when the credentials verified — there is no point asking
    // SignNow to call us back on an account we could not sign into. Existing
    // subscriptions are removed first so re-saving does not accumulate
    // duplicates, each of which would deliver the same completion again.
    let webhookSecret = existing?.webhook_secret_enc ?? null;
    let webhookIds: string[] = Array.isArray(existing?.webhook_event_ids)
      ? (existing!.webhook_event_ids as string[]).map(String)
      : [];
    let webhookRegisteredAt = existing?.webhook_registered_at ?? null;
    let webhookNote = "";

    if (verified) {
      const ctx = { token: accessToken, environment };
      try {
        for (const id of webhookIds) await deleteWebhook(ctx, id);

        const secret = newWebhookSecret();
        const fresh: string[] = [];
        for (const event of WEBHOOK_EVENTS) {
          const id = await createWebhook(ctx, event, callbackUrl, secret);
          if (id) fresh.push(id);
        }

        webhookSecret = await encryptSecret(secret, "signnow", { recordId: adminId, field: "signnow_webhook" });
        webhookIds = fresh;
        webhookRegisteredAt = new Date().toISOString();
        webhookNote = ` ${fresh.length} of ${WEBHOOK_EVENTS.length} callbacks registered.`;
      } catch (err) {
        // A connection with no callbacks still SENDS; it just cannot hear back
        // on its own. signnow-documents can poll in that state, so this is
        // reported rather than treated as a failed connection.
        webhookNote = " Credentials are good, but the completion callbacks could not be registered — statuses will need refreshing by hand until that is fixed.";
        console.warn("signnow-credentials: webhook registration failed", {
          adminId,
          detail: (err as Error).message,
        });
      }
    }

    const { error: upsertErr } = await admin.from("signnow_connections").upsert(
      {
        admin_id: adminId,
        environment,
        account_email: candidate.username,
        client_id_enc: clientIdEnc,
        client_secret_enc: clientSecretEnc,
        username_enc: usernameEnc,
        password_enc: passwordEnc,
        webhook_secret_enc: webhookSecret,
        webhook_registered_at: webhookRegisteredAt,
        webhook_event_ids: webhookIds,
        // Only a live token makes these usable. signnow-documents skips
        // inactive rows, so a failed check leaves sending safely off rather
        // than queueing certificates at an account we cannot sign into.
        is_active: verified,
        verified_at: verified ? new Date().toISOString() : existing?.verified_at ?? null,
        last_error: lastError,
        created_by: existing ? undefined : user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "admin_id" },
    );

    if (upsertErr) {
      console.error("signnow-credentials: store failed", upsertErr.message);
      return json({ error: "Could not save the connection. Please try again." }, 500);
    }

    return json({
      ...publicView(await loadRow(), callbackUrl),
      verified,
      message: verified
        ? `SignNow accepted these credentials.${webhookNote}`
        : `Saved, but SignNow rejected these credentials, so sending stays off. ${lastError ?? ""}`.trim(),
    });
  } catch (err) {
    return api.fail(err);
  }
});

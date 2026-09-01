/// <reference lib="deno.ns" />
/**
 * SIGNNOW (airSlate) API CLIENT
 *
 * The whole of this platform's contact with SignNow lives here, so there is one
 * place to look when their API changes and one place that knows how a document
 * gets from our storage bucket to an officer's inbox and back signed.
 *
 * ENDPOINTS USED — the contract this module depends on
 * ----------------------------------------------------
 *   POST /oauth2/token          Basic base64(client_id:client_secret),
 *                               form body grant_type=password&username&password
 *                               → { access_token, refresh_token, expires_in }
 *   POST /document              multipart/form-data, part name `file`
 *                               → { id }
 *   PUT  /document/{id}         { fields: [...] } — places signature/date/text
 *                               boxes and names the roles that fill them
 *   GET  /document/{id}         → { roles, fields, field_invites, signatures }
 *   POST /document/{id}/invite  role-based invite:
 *                               { document_id, from, to: [{ email, role,
 *                                 role_id, order, subject, message }], subject,
 *                                 message }
 *   PUT  /document/{id}/fieldinvitecancel   withdraws an outstanding invite
 *   GET  /document/{id}/download?type=collapsed  → the PDF bytes
 *   POST /api/v2/events         webhook subscription:
 *                               { event, entity_id, action: "callback",
 *                                 attributes: { callback, secret_key,
 *                                 use_tls_12, integration_id } }
 *   GET/DELETE /api/v2/events   list / remove subscriptions
 *
 * Base URLs: https://api.signnow.com (production),
 *            https://api-eval.signnow.com (sandbox / eval).
 *
 * WHY NO SDK
 * ----------
 * SignNow's own SDKs are Node and browser builds that assume a filesystem and
 * `require`. Edge Functions are Deno with a strict import graph; a 200-line
 * fetch wrapper we can read is worth more here than a dependency we would have
 * to shim.
 *
 * ERRORS
 * ------
 * Everything throws SignNowError, which carries the HTTP status and SignNow's
 * own message. Callers surface `.publicMessage` — SignNow's errors name the
 * account and sometimes the document, so the raw text is logged, not returned.
 */

// ===========================================================================
// TYPES
// ===========================================================================

export type SignNowEnvironment = "sandbox" | "production";

export type SignNowCreds = {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  environment: SignNowEnvironment;
};

export type SignNowToken = {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch millis. */
  expiresAt: number;
};

/** One signature block on the document: who signs it and where it sits. */
export type SignerSpec = {
  /** The office — "Chairperson". SignNow calls this a role. */
  roleName: string;
  email: string;
  name?: string | null;
  order: number;
  /** Page (0-based) and PDF points from the TOP-LEFT of that page. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Draw a date box beside the signature. Certificates want one; contracts
   *  usually carry their own date field already. */
  withDate?: boolean;
};

export class SignNowError extends Error {
  readonly status: number;
  readonly publicMessage: string;
  constructor(status: number, message: string, publicMessage?: string) {
    super(message);
    this.name = "SignNowError";
    this.status = status;
    this.publicMessage = publicMessage ||
      "SignNow rejected the request. Check the connection settings and try again.";
  }
}

// ===========================================================================
// BASE
// ===========================================================================

export const baseUrlFor = (env: SignNowEnvironment): string =>
  env === "production" ? "https://api.signnow.com" : "https://api-eval.signnow.com";

/**
 * SignNow answers errors in at least three shapes depending on the endpoint:
 * `{errors:[{message}]}`, `{error:"..."}` and `{404:{...}}`. Pull a sentence
 * out of whichever arrived, and fall back to the raw body so a shape we have
 * not seen still reaches the logs intact.
 */
const messageFrom = (status: number, body: string): string => {
  try {
    const j = JSON.parse(body);
    if (Array.isArray(j?.errors) && j.errors[0]?.message) return String(j.errors[0].message);
    if (typeof j?.error === "string") return j.error;
    if (typeof j?.error_description === "string") return j.error_description;
    if (typeof j?.message === "string") return j.message;
  } catch { /* not JSON — use the raw text */ }
  return body ? body.slice(0, 400) : `HTTP ${status}`;
};

/**
 * Turn SignNow's failure into something an operator can act on. Anything we
 * cannot classify becomes the generic line: their messages quote account
 * emails and document ids, and those must not travel back to a browser.
 */
const publicMessageFor = (status: number, raw: string): string => {
  const t = raw.toLowerCase();
  if (status === 401 || t.includes("invalid_grant") || t.includes("invalid credentials")) {
    return "SignNow rejected the sign-in. Check the API client id, secret, username and password.";
  }
  if (status === 403) {
    return "This SignNow account is not permitted to do that. Check the plan and the API application's scopes.";
  }
  if (status === 404) return "SignNow no longer has that document.";
  if (status === 413) return "The document is too large for SignNow to accept.";
  if (status === 429) return "SignNow is rate-limiting this account. Try again in a few minutes.";
  if (status >= 500) return "SignNow is having trouble at their end. The request was not completed.";
  return "SignNow rejected the request. Check the connection settings and try again.";
};

async function readError(res: Response): Promise<SignNowError> {
  const raw = await res.text().catch(() => "");
  const msg = messageFrom(res.status, raw);
  return new SignNowError(res.status, msg, publicMessageFor(res.status, msg));
}

// ===========================================================================
// AUTH
// ===========================================================================

/**
 * Password-grant token.
 *
 * `scope=*` is what SignNow's own examples use; a narrower scope silently
 * removes endpoints rather than failing at token time, which is a miserable
 * thing to debug from a webhook that stopped arriving.
 */
export async function getToken(creds: SignNowCreds): Promise<SignNowToken> {
  const basic = btoa(`${creds.clientId}:${creds.clientSecret}`);
  const body = new URLSearchParams({
    grant_type: "password",
    username: creds.username,
    password: creds.password,
    scope: "*",
  });

  const res = await fetch(`${baseUrlFor(creds.environment)}/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!res.ok) throw await readError(res);

  const j = await res.json();
  if (!j?.access_token) {
    throw new SignNowError(502, "SignNow returned no access token.",
      "SignNow accepted the sign-in but returned no token. Try again.");
  }

  return {
    accessToken: String(j.access_token),
    refreshToken: j.refresh_token ? String(j.refresh_token) : null,
    // Shave 60s so a token never expires mid-request.
    expiresAt: Date.now() + (Number(j.expires_in || 1800) - 60) * 1000,
  };
}

// ===========================================================================
// REQUEST HELPER
// ===========================================================================

type Ctx = { token: string; environment: SignNowEnvironment };

async function api<T>(
  ctx: Ctx,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { "Authorization": `Bearer ${ctx.token}` };
  let payload: BodyInit | undefined;

  if (body instanceof FormData) {
    payload = body;                      // fetch sets the multipart boundary
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${baseUrlFor(ctx.environment)}${path}`, { method, headers, body: payload });
  if (!res.ok) throw await readError(res);
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

// ===========================================================================
// DOCUMENTS
// ===========================================================================

/** Upload a PDF. Returns SignNow's document id. */
export async function uploadDocument(
  ctx: Ctx,
  file: Uint8Array,
  filename: string,
): Promise<string> {
  const form = new FormData();
  // SignNow keys the upload off the filename extension, so a name without
  // ".pdf" is accepted and then fails later at field placement.
  const safe = filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`;
  form.append("file", new Blob([file], { type: "application/pdf" }), safe);

  const out = await api<{ id?: string }>(ctx, "POST", "/document", form);
  if (!out?.id) {
    throw new SignNowError(502, "SignNow returned no document id after upload.",
      "SignNow accepted the document but did not identify it. Try sending again.");
  }
  return out.id;
}

/**
 * Place the signature blocks.
 *
 * COORDINATES. SignNow measures in PDF points from the TOP-LEFT of the page,
 * which is the opposite origin to pdf-lib and jsPDF. The caller works in the
 * same top-left space (that is what SignerSpec documents), so nothing is
 * flipped here — but the moment someone reuses a y from a pdf-lib drawing call
 * it will land at the wrong end of the page, so it is worth saying twice.
 *
 * Every signature field is `required`, which is what makes "signed" mean every
 * officer signed: SignNow will not let a signer complete while one is empty.
 */
export async function placeFields(ctx: Ctx, documentId: string, signers: SignerSpec[]): Promise<void> {
  const fields = signers.flatMap((s) => {
    const base = {
      page_number: s.page,
      role: s.roleName,
      required: true,
      x: Math.round(s.x),
      y: Math.round(s.y),
    };
    const sig = {
      ...base,
      type: "signature",
      width: Math.round(s.width),
      height: Math.round(s.height),
      name: `sig_${s.order}`,
      label: `${s.roleName} signature`,
    };
    if (!s.withDate) return [sig];
    return [
      sig,
      {
        ...base,
        type: "text",
        // Sits under the signature line rather than beside it: the certificate
        // designs give each office a narrow column, and a date box to the right
        // would overlap the next officer's block.
        y: Math.round(s.y + s.height + 4),
        width: Math.round(Math.min(s.width, 120)),
        height: 14,
        name: `sigdate_${s.order}`,
        label: "Date",
        prefilled_text: "",
      },
    ];
  });

  await api(ctx, "PUT", `/document/${encodeURIComponent(documentId)}`, { fields });
}

export type SignNowDocument = {
  id: string;
  document_name?: string;
  roles?: Array<{ unique_id?: string; signing_order?: number | string; name?: string }>;
  field_invites?: Array<{
    id?: string;
    status?: string;
    email?: string;
    role?: string;
    role_id?: string;
    signer_user_id?: string;
    updated?: number | string;
    declined_message?: string;
  }>;
  signatures?: Array<{ id?: string; created?: number | string; email?: string }>;
};

export const getDocument = (ctx: Ctx, documentId: string): Promise<SignNowDocument> =>
  api<SignNowDocument>(ctx, "GET", `/document/${encodeURIComponent(documentId)}`);

/**
 * Send the role-based invite.
 *
 * Roles are created by placeFields (a field's `role` names one), and SignNow
 * assigns each a `unique_id` that the invite must quote. So the order is
 * always: upload → placeFields → getDocument to read the role ids → invite.
 * Skipping the read and inviting by role NAME is accepted by the API and then
 * delivers to nobody, which is the single most confusing failure in this
 * integration.
 *
 * `order` drives sequential signing. For a parallel panel every signer is
 * given order 1, which is how SignNow expresses "all at once".
 */
export async function sendInvite(
  ctx: Ctx,
  documentId: string,
  opts: {
    from: string;
    signers: Array<{ email: string; roleName: string; roleId: string; order: number; name?: string | null }>;
    subject: string;
    message: string;
    sequential: boolean;
    expiresDays?: number | null;
    /** Where a signer lands after signing. */
    redirectUrl?: string | null;
  },
): Promise<void> {
  const to = opts.signers.map((s) => ({
    email: s.email,
    role: s.roleName,
    role_id: s.roleId,
    order: opts.sequential ? s.order : 1,
    prefill_signature_name: s.name || undefined,
    subject: opts.subject,
    message: opts.message,
    ...(opts.expiresDays ? { expiration_days: opts.expiresDays } : {}),
    ...(opts.redirectUrl ? { redirect_uri: opts.redirectUrl } : {}),
  }));

  await api(ctx, "POST", `/document/${encodeURIComponent(documentId)}/invite`, {
    document_id: documentId,
    from: opts.from,
    to,
    subject: opts.subject,
    message: opts.message,
  });
}

/** Withdraw an outstanding invite. Safe to call on a document with none. */
export async function cancelInvite(ctx: Ctx, documentId: string): Promise<void> {
  try {
    await api(ctx, "PUT", `/document/${encodeURIComponent(documentId)}/fieldinvitecancel`, {});
  } catch (err) {
    // A document with nothing outstanding answers 400/404. Cancelling is
    // idempotent by intent, so that is success, not failure.
    if (err instanceof SignNowError && (err.status === 400 || err.status === 404)) return;
    throw err;
  }
}

/**
 * Download the signed PDF.
 *
 * `type=collapsed` flattens the signatures into the page content. Without it
 * SignNow returns the document with the signatures as separate annotation
 * objects, which some PDF readers decline to render — and a certificate whose
 * signatures are invisible in the recipient's viewer is worse than an unsigned
 * one, because it looks deliberate.
 */
export async function downloadSigned(ctx: Ctx, documentId: string): Promise<Uint8Array> {
  const res = await fetch(
    `${baseUrlFor(ctx.environment)}/document/${encodeURIComponent(documentId)}/download?type=collapsed`,
    { method: "GET", headers: { "Authorization": `Bearer ${ctx.token}` } },
  );
  if (!res.ok) throw await readError(res);
  return new Uint8Array(await res.arrayBuffer());
}

// ===========================================================================
// WEBHOOKS
// ===========================================================================

/**
 * The events this integration subscribes to.
 *
 * document.complete is the one that matters — it fires when the last required
 * field on the last invite is filled. The other three exist so the register can
 * show progress and so a decline stops the request rather than leaving it
 * "sent" until it expires.
 */
export const WEBHOOK_EVENTS = [
  "document.complete",
  "document.fieldinvite.signed",
  "document.fieldinvite.decline",
  "document.open",
] as const;

export type WebhookEvent = typeof WEBHOOK_EVENTS[number];

/**
 * Register one callback subscription.
 *
 * `secret_key` is what SignNow HMACs each callback body with, and is the only
 * thing standing between our webhook endpoint and anybody who can guess the
 * URL. It is generated per tenant, stored encrypted, and never reused.
 */
export async function createWebhook(
  ctx: Ctx,
  event: WebhookEvent,
  callbackUrl: string,
  secretKey: string,
): Promise<string | null> {
  const out = await api<{ id?: string; data?: { id?: string } }>(ctx, "POST", "/api/v2/events", {
    event,
    action: "callback",
    attributes: {
      callback: callbackUrl,
      use_tls_12: true,
      integration_id: "ararat-manager",
      secret_key: secretKey,
    },
  });
  return out?.id ? String(out.id) : (out?.data?.id ? String(out.data.id) : null);
}

export async function deleteWebhook(ctx: Ctx, eventId: string): Promise<void> {
  try {
    await api(ctx, "DELETE", `/api/v2/events/${encodeURIComponent(eventId)}`);
  } catch (err) {
    // Already gone is the state we wanted.
    if (err instanceof SignNowError && err.status === 404) return;
    throw err;
  }
}

/**
 * Verify the HMAC on an incoming callback.
 *
 * SignNow documents the header as X-SignNow-Signature and the value as the
 * body hashed with the subscription's secret_key under HMAC-SHA256. The
 * encoding is documented as base64 and observed as hex in the wild, so both
 * are accepted — comparing against both costs one extra hash and removes a
 * whole class of "webhooks silently rejected" incident.
 *
 * The comparison is constant-time in the sense that matters here: it does not
 * return early on the first differing byte, so it leaks no information about
 * how close a forged signature was.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  secretKey: string,
): Promise<boolean> {
  if (!header || !secretKey) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
  );

  const hex = Array.from(mac).map((b) => b.toString(16).padStart(2, "0")).join("");
  let bin = "";
  for (const b of mac) bin += String.fromCharCode(b);
  const b64 = btoa(bin);

  const supplied = header.trim();
  return safeEqual(supplied, hex) || safeEqual(supplied, b64);
}

/** Length-independent, non-short-circuiting string comparison. */
const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/** 32 bytes of CSPRNG, hex. The per-tenant webhook secret. */
export const newWebhookSecret = (): string => {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
};

// ===========================================================================
// DIGEST
// ===========================================================================

/** SHA-256 of the bytes we uploaded, hex. Stored on the request. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

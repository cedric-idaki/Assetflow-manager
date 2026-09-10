/// <reference lib="deno.ns" />
/**
 * SIGNNOW ⇄ DATABASE
 *
 * The half of the integration that touches our own tables. _shared/signnow.ts
 * knows how to talk to SignNow and nothing about this platform; this module
 * knows about signing_requests, the storage bucket and the release rule, and
 * nothing about HTTP.
 *
 * It exists because the completion path has two entrances that must behave
 * identically:
 *
 *   * the webhook, when SignNow tells us a document is complete, and
 *   * signnow-documents `sync`, when a tenant's callbacks are not registered
 *     (or one was lost) and somebody presses Refresh.
 *
 * If those two drifted, a certificate would be released one way and not the
 * other, and which one you got would depend on whether a webhook happened to
 * arrive. So both call applyDocumentState() and neither interprets anything
 * itself.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptSecret } from "./crypto.ts";
import {
  getToken,
  getDocument,
  downloadSigned,
  type SignNowCreds,
  type SignNowDocument,
  type SignNowEnvironment,
} from "./signnow.ts";

export const SIGNED_BUCKET = "signed-certificates";

export type ConnectionRow = {
  admin_id: string;
  environment: string;
  account_email: string | null;
  client_id_enc: string;
  client_secret_enc: string;
  username_enc: string;
  password_enc: string;
  webhook_secret_enc: string | null;
  is_active: boolean;
};

export type RequestRow = {
  id: string;
  admin_id: string;
  doc_kind: string;
  source_table: string;
  source_id: string;
  document_name: string;
  draft_path: string | null;
  signed_path: string | null;
  draft_digest: string | null;
  certificate_serial: string | null;
  status: string;
  signing_order: string;
  provider_document_id: string | null;
  provider_environment: string | null;
  expires_at: string | null;
};

export type SignerRow = {
  id: string;
  request_id: string;
  role_name: string;
  signer_name: string | null;
  signer_email: string;
  signing_order: number;
  provider_role_id: string | null;
  provider_invite_id: string | null;
  status: string;
};

/** Storage path for one side of a request. Tenant-first, so the bucket's RLS
 *  policy can compare the leading folder to current_admin_id(). */
export const storagePathFor = (r: { admin_id: string; doc_kind: string; id: string }, side: "draft" | "signed") =>
  `${r.admin_id}/${r.doc_kind}/${r.id}-${side}.pdf`;

// ===========================================================================
// CONNECTION
// ===========================================================================

export async function loadConnection(
  admin: SupabaseClient,
  adminId: string,
): Promise<ConnectionRow | null> {
  const { data } = await admin
    .from("signnow_connections")
    .select("*")
    .eq("admin_id", adminId)
    .maybeSingle();
  return (data as ConnectionRow) ?? null;
}

export const credsFromConnection = async (row: ConnectionRow): Promise<SignNowCreds> => {
  const c = { recordId: row.admin_id, field: "signnow" };
  return {
    clientId: await decryptSecret(row.client_id_enc, "signnow", c),
    clientSecret: await decryptSecret(row.client_secret_enc, "signnow", c),
    username: await decryptSecret(row.username_enc, "signnow", c),
    password: await decryptSecret(row.password_enc, "signnow", c),
    environment: row.environment as SignNowEnvironment,
  };
};

export const webhookSecretFor = (row: ConnectionRow): Promise<string> =>
  decryptSecret(row.webhook_secret_enc ?? "", "signnow", {
    recordId: row.admin_id,
    field: "signnow_webhook",
  });

export type ApiCtx = { token: string; environment: SignNowEnvironment };

/**
 * A token for this tenant, per invocation.
 *
 * SignNow's password grant is not free — it is a login — and one edge-function
 * invocation can easily touch the same tenant three times (read the document,
 * download it, cancel an invite). Cached by tenant for the life of the
 * instance, and dropped when it expires.
 */
const tokenCache = new Map<string, { ctx: ApiCtx; expiresAt: number }>();

export async function ctxFor(conn: ConnectionRow): Promise<ApiCtx> {
  const hit = tokenCache.get(conn.admin_id);
  if (hit && hit.expiresAt > Date.now()) return hit.ctx;

  const token = await getToken(await credsFromConnection(conn));
  const ctx: ApiCtx = { token: token.accessToken, environment: conn.environment as SignNowEnvironment };
  tokenCache.set(conn.admin_id, { ctx, expiresAt: token.expiresAt });
  return ctx;
}

/** Test seam / credential rotation: drop a cached token. */
export const forgetToken = (adminId: string): void => {
  tokenCache.delete(adminId);
};

// ===========================================================================
// EVENTS
// ===========================================================================

export async function logEvent(
  admin: SupabaseClient,
  request: { id: string; admin_id: string },
  eventType: string,
  detail: string,
  payload: Record<string, unknown> = {},
  actor = "SignNow",
): Promise<void> {
  const { error } = await admin.from("signing_request_events").insert({
    request_id: request.id,
    admin_id: request.admin_id,
    event_type: eventType,
    actor,
    detail,
    payload,
  });
  // The trail is evidence, not control flow. A failure to write it must not
  // take down the release it was describing — but it must not be silent
  // either, or the first anyone knows is an empty audit page.
  if (error) console.warn("signing_request_events insert failed", { requestId: request.id, error: error.message });
}

// ===========================================================================
// APPLYING SIGNNOW'S VIEW OF A DOCUMENT
// ===========================================================================

export type ApplyResult = {
  status: string;
  changed: boolean;
  released: boolean;
  signedPath: string | null;
  serial: string | null;
  signers: Array<{ role: string; status: string }>;
};

/** SignNow's invite statuses, mapped onto ours. Anything unrecognised is left
 *  as pending rather than guessed at — a wrong "signed" is unrecoverable. */
const signerStatusOf = (raw: string | undefined): string => {
  switch ((raw || "").toLowerCase()) {
    case "fulfilled":
    case "signed":
    case "completed":
      return "signed";
    case "declined":
      return "declined";
    case "viewed":
    case "opened":
      return "viewed";
    case "created":
    case "pending":
    case "sent":
      return "sent";
    default:
      return "pending";
  }
};

/**
 * Reconcile one signing request against what SignNow currently says.
 *
 * Idempotent by construction: it computes the state the request SHOULD be in
 * and writes that, so a redelivered callback and a manual refresh five minutes
 * apart produce the same row. Nothing here decides anything twice.
 *
 * The release is the one step with a side effect outside this table, and it
 * goes through signing_request_release(), which is itself idempotent.
 */
export async function applyDocumentState(
  admin: SupabaseClient,
  request: RequestRow,
  doc: SignNowDocument,
  ctx: ApiCtx,
  opts: { autoRelease: boolean; actor?: string } = { autoRelease: true },
): Promise<ApplyResult> {
  const actor = opts.actor || "SignNow";

  // A request that is already finished with is not moved by anything SignNow
  // says afterwards.
  //
  // This is not tidiness. A withdrawn request can still be signed at SignNow —
  // the invite is cancelled there first, but a signature already in flight can
  // land after — and without this guard that callback would flip a cancelled
  // row back to `signed`. Where staff had already opened a replacement request
  // for the same record, that write also collides with the one-live-request
  // index; where they had not, it quietly un-cancels something a person
  // deliberately withdrew. Neither is recoverable by looking at the row later.
  const TERMINAL = ["released", "declined", "cancelled", "expired", "failed"];
  if (TERMINAL.includes(request.status)) {
    return {
      status: request.status,
      changed: false,
      released: false,
      signedPath: request.signed_path,
      serial: request.certificate_serial,
      signers: [],
    };
  }

  const invites = Array.isArray(doc.field_invites) ? doc.field_invites : [];

  const { data: signerRows } = await admin
    .from("signing_request_signers")
    .select("*")
    .eq("request_id", request.id);
  const signers = (signerRows as SignerRow[]) ?? [];

  const now = new Date().toISOString();
  let anyViewed = false;
  let declined: { email: string; reason: string } | null = null;
  const summary: Array<{ role: string; status: string }> = [];

  for (const s of signers) {
    // Match on the provider's role id where we recorded one, and fall back to
    // the email. Role names are ours; SignNow echoes them, but an invite
    // re-created in their UI comes back with only the email in common.
    const inv = invites.find((i) =>
      (s.provider_role_id && i.role_id && String(i.role_id) === s.provider_role_id) ||
      (i.email && i.email.toLowerCase() === s.signer_email.toLowerCase())
    );

    const next = signerStatusOf(inv?.status);
    summary.push({ role: s.role_name, status: next });

    if (next === "viewed") anyViewed = true;
    if (next === "declined" && !declined) {
      declined = { email: s.signer_email, reason: inv?.declined_message || "No reason given." };
    }

    // Only ever move a signer FORWARD. SignNow occasionally reports an invite
    // as "created" again after a resend, and a signature that has been given
    // cannot be un-given.
    const rank = ["pending", "sent", "viewed", "signed"];
    const cur = rank.indexOf(s.status);
    const nxt = rank.indexOf(next);
    const forward = next === "declined" || (nxt > -1 && cur > -1 && nxt > cur);
    if (!forward) continue;

    await admin.from("signing_request_signers").update({
      status: next,
      provider_invite_id: inv?.id ? String(inv.id) : s.provider_invite_id,
      viewed_at: next === "viewed" || next === "signed" ? now : null,
      signed_at: next === "signed" ? now : null,
      declined_at: next === "declined" ? now : null,
      decline_reason: next === "declined" ? (inv?.declined_message ?? null) : null,
    }).eq("id", s.id);
  }

  // Complete means EVERY signatory we asked has signed. Deliberately computed
  // from our own signer rows rather than from a document-level flag: the
  // tenant's panel is what the certificate's signature blocks were drawn for,
  // and a document SignNow calls complete because its own required fields are
  // filled is not the same claim.
  const allSigned = signers.length > 0 &&
    summary.length === signers.length &&
    summary.every((s) => s.status === "signed");

  // ── Declined ────────────────────────────────────────────────────────────
  // One refusal ends the request. There is no partial certificate: a share
  // certificate the Treasurer would not sign is not two-thirds issued.
  if (declined) {
    await admin.from("signing_requests").update({
      status: "declined",
      decline_reason: `${declined.email}: ${declined.reason}`,
    }).eq("id", request.id);
    await logEvent(admin, request, "declined",
      `${declined.email} declined to sign.`, { reason: declined.reason }, actor);

    return { status: "declined", changed: true, released: false,
             signedPath: request.signed_path, serial: request.certificate_serial, signers: summary };
  }

  // ── Complete ────────────────────────────────────────────────────────────
  if (allSigned) {
    let signedPath = request.signed_path;

    // Fetch the signed PDF once. A request already holding one has been here
    // before — a redelivered callback, or a refresh racing a webhook — and
    // re-downloading would only cost a round trip and risk overwriting a good
    // file with a failed download.
    if (!signedPath && request.provider_document_id) {
      const bytes = await downloadSigned(ctx, request.provider_document_id);
      const path = storagePathFor(request, "signed");
      const { error: upErr } = await admin.storage.from(SIGNED_BUCKET)
        .upload(path, bytes, { contentType: "application/pdf", upsert: true });
      if (upErr) throw new Error(`Could not store the signed certificate: ${upErr.message}`);
      signedPath = path;

      await admin.from("signing_requests").update({
        status: "signed",
        signed_path: path,
        signed_at: now,
      }).eq("id", request.id);

      await logEvent(admin, request, "signed",
        "Every signatory has signed. The signed document has been retrieved and stored.",
        { signed_path: path, bytes: bytes.length }, actor);
    }

    if (!opts.autoRelease) {
      return { status: "signed", changed: true, released: false,
               signedPath, serial: request.certificate_serial, signers: summary };
    }

    // Releasing is what turns a file into the issued certificate, so there has
    // to BE a file. Without this, a request whose provider_document_id was
    // never recorded would release with signed_path NULL and the register would
    // claim an issued certificate nobody can open.
    if (!signedPath) {
      await logEvent(admin, request, "error",
        "Every signatory has signed, but no signed document could be retrieved, so the certificate was not issued.",
        {}, actor);
      return { status: "signed", changed: true, released: false,
               signedPath: null, serial: request.certificate_serial, signers: summary };
    }

    const { data: serial, error: relErr } = await admin.rpc("signing_request_release", {
      p_request_id: request.id,
      p_signed_path: signedPath,
      p_actor: actor,
    });
    if (relErr) throw new Error(`Could not release the certificate: ${relErr.message}`);

    return { status: "released", changed: true, released: true,
             signedPath, serial: (serial as string) ?? request.certificate_serial, signers: summary };
  }

  // ── Still out ───────────────────────────────────────────────────────────
  if (anyViewed && request.status === "sent") {
    await admin.from("signing_requests").update({ status: "viewed", first_viewed_at: now }).eq("id", request.id);
    await logEvent(admin, request, "viewed", "A signatory has opened the document.", {}, actor);
    return { status: "viewed", changed: true, released: false,
             signedPath: request.signed_path, serial: request.certificate_serial, signers: summary };
  }

  return { status: request.status, changed: false, released: false,
           signedPath: request.signed_path, serial: request.certificate_serial, signers: summary };
}

/** Load, reconcile, and return — the whole of `sync` for one request. */
export async function refreshRequest(
  admin: SupabaseClient,
  request: RequestRow,
  conn: ConnectionRow,
  autoRelease: boolean,
  actor = "SignNow",
): Promise<ApplyResult> {
  if (!request.provider_document_id) {
    return { status: request.status, changed: false, released: false,
             signedPath: request.signed_path, serial: request.certificate_serial, signers: [] };
  }
  const ctx = await ctxFor(conn);
  const doc = await getDocument(ctx, request.provider_document_id);
  return applyDocumentState(admin, request, doc, ctx, { autoRelease, actor });
}

/** The tenant's policy for a document kind, with the defaults applied. */
export async function policyFor(
  admin: SupabaseClient,
  adminId: string,
  docKind: string,
): Promise<{ autoRelease: boolean; expiresDays: number | null; sequential: boolean; requireSignature: boolean }> {
  const { data } = await admin
    .from("signing_policies")
    .select("auto_release, expires_days, signing_order, require_signature")
    .eq("admin_id", adminId)
    .eq("doc_kind", docKind)
    .maybeSingle();

  return {
    autoRelease: data?.auto_release ?? true,
    expiresDays: data?.expires_days ?? null,
    sequential: (data?.signing_order ?? "sequential") === "sequential",
    requireSignature: data?.require_signature ?? false,
  };
}

/// <reference lib="deno.ns" />
/**
 * SIGNNOW CALLBACKS — the moment a certificate becomes issuable.
 *
 * SignNow POSTs here when a document is opened, signed, declined or completed.
 * On completion this function downloads the signed PDF, stores it, and — if the
 * tenant has auto-release on — releases it as the issued certificate. That is
 * the whole point of the feature: without this endpoint working, documents get
 * signed and the register never finds out.
 *
 * verify_jwt = false. SignNow has no Supabase JWT and never will; the
 * per-tenant HMAC in X-SignNow-Signature is the credential, and it is checked
 * against the secret we generated when the tenant connected.
 *
 * WHAT THIS FUNCTION REFUSES TO TRUST
 * -----------------------------------
 * The body names a document id and an event. That is ALL it is believed for,
 * and only after the HMAC verifies. Everything else — which tenant, which
 * record, who was supposed to sign, whether every signature is in — is read
 * from our own tables, and the signed file itself is fetched from SignNow's
 * API with the tenant's own credentials rather than taken from the payload.
 * A forged callback that somehow passed the HMAC could therefore, at worst,
 * make us re-read a document we already know about.
 *
 * ALWAYS 200
 * ----------
 * Except for a bad signature (401) and a malformed body (400), this answers
 * 200 even when handling failed. SignNow retries non-2xx, and a callback that
 * fails deterministically — a storage outage, a bug — would otherwise be
 * redelivered forever while the retries hid the original error. The delivery
 * is recorded with handled=false and handling_error set, and the tenant's
 * Refresh button (signnow-documents `sync`) recovers the same state on demand.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsFor } from "../_shared/http.ts";
import { keyConfigured } from "../_shared/crypto.ts";
import { getDocument, verifyWebhookSignature } from "../_shared/signnow.ts";
import {
  applyDocumentState,
  ctxFor,
  policyFor,
  loadConnection,
  webhookSecretFor,
  logEvent,
  type ConnectionRow,
  type RequestRow,
} from "../_shared/signnow-store.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

/** Pull the document id out of whichever shape the event carries it in.
 *  SignNow puts it at the top level for document events and one level down
 *  under `meta`/`content` for invite events. */
const documentIdOf = (body: Record<string, unknown>): string | null => {
  const candidates = [
    body?.document_id,
    body?.documentId,
    (body?.meta as Record<string, unknown>)?.["document_id"],
    (body?.content as Record<string, unknown>)?.["document_id"],
    (body?.data as Record<string, unknown>)?.["document_id"],
    (body?.data as Record<string, unknown>)?.["id"],
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
};

const eventNameOf = (body: Record<string, unknown>): string => {
  const candidates = [body?.event, body?.event_name, (body?.meta as Record<string, unknown>)?.["event"]];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "unknown";
};

/** A stable key for one delivery, so a retry is recognised. SignNow does not
 *  always send a delivery id, so the fallback is a hash of the body — which
 *  de-dupes an identical retry exactly as well. */
async function deliveryKeyFor(body: Record<string, unknown>, raw: string): Promise<string> {
  const id = body?.delivery_id ?? body?.id ?? (body?.meta as Record<string, unknown>)?.["callback_id"];
  if (typeof id === "string" && id.trim()) return id.trim();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  // SignNow is a server, not a browser: it sends no Origin and expects no CORS
  // headers. corsFor still supplies the response header block so a preflight
  // from a debugging console behaves, but no origin check gates the callback —
  // the HMAC does.
  const cors = corsFor(req, "POST, OPTIONS");
  const headers = { ...cors.headers, "Content-Type": "application/json" };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  // The raw text, not the parsed object: the HMAC is over the bytes SignNow
  // sent, and JSON.stringify(JSON.parse(x)) is not reliably x.
  const raw = await req.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return json({ error: "Malformed body" }, 400);
  }

  const eventName = eventNameOf(body);
  const documentId = documentIdOf(body);
  const deliveryKey = await deliveryKeyFor(body, raw);

  if (!keyConfigured("signnow")) {
    console.error("signnow-webhook: SIGNNOW_CRED_ENC_KEY is not set — callbacks cannot be verified.");
    // Recorded so the gap is visible later, and answered 200 so SignNow does
    // not retry a request that cannot succeed until an operator acts.
    await admin.from("signing_webhook_deliveries").insert({
      event_name: eventName, delivery_key: deliveryKey, document_id: documentId,
      signature_ok: null, handled: false,
      handling_error: "SIGNNOW_CRED_ENC_KEY is not set on this project.",
      body,
    });
    return json({ ok: false, reason: "not_configured" });
  }

  if (!documentId) {
    await admin.from("signing_webhook_deliveries").insert({
      event_name: eventName, delivery_key: deliveryKey, signature_ok: null,
      handled: false, handling_error: "No document id in the payload.", body,
    });
    return json({ ok: false, reason: "no_document_id" });
  }

  // ── Which request, and therefore which tenant's secret ───────────────────
  const { data: reqRow } = await admin
    .from("signing_requests")
    .select("*")
    .eq("provider_document_id", documentId)
    .maybeSingle();
  const request = reqRow as RequestRow | null;

  if (!request) {
    // A document this platform did not send. Recorded and dropped: the tenant
    // may well use the same SignNow account for their own unrelated documents,
    // and those callbacks are not an error.
    await admin.from("signing_webhook_deliveries").insert({
      event_name: eventName, delivery_key: deliveryKey, document_id: documentId,
      signature_ok: null, handled: false,
      handling_error: "No signing request for this document.", body,
    });
    return json({ ok: true, ignored: true });
  }

  const conn = (await loadConnection(admin, request.admin_id)) as ConnectionRow | null;

  // ── HMAC ─────────────────────────────────────────────────────────────────
  let signatureOk = false;
  if (conn?.webhook_secret_enc) {
    try {
      const secret = await webhookSecretFor(conn);
      signatureOk = await verifyWebhookSignature(
        raw,
        req.headers.get("x-signnow-signature") || req.headers.get("X-SignNow-Signature"),
        secret,
      );
    } catch (err) {
      console.error("signnow-webhook: could not open the webhook secret", {
        adminId: request.admin_id, detail: (err as Error).message,
      });
    }
  }

  if (!signatureOk) {
    await admin.from("signing_webhook_deliveries").insert({
      event_name: eventName, delivery_key: deliveryKey, document_id: documentId,
      request_id: request.id, signature_ok: false, handled: false,
      handling_error: conn?.webhook_secret_enc
        ? "HMAC did not verify."
        : "No webhook secret is stored for this tenant.",
      body,
    });
    console.warn("signnow-webhook: rejected unverified callback", {
      documentId, requestId: request.id, event: eventName,
    });
    // 401, not 200: an unverified callback is the one case where a retry is
    // genuinely worth having, because the commonest cause is a secret that has
    // just been rotated.
    return json({ error: "Signature verification failed." }, 401);
  }

  // ── De-dupe ──────────────────────────────────────────────────────────────
  // The unique index on (provider, delivery_key) is the authority. An insert
  // that conflicts means this exact delivery has already been through here.
  const { error: dupErr } = await admin.from("signing_webhook_deliveries").insert({
    event_name: eventName, delivery_key: deliveryKey, document_id: documentId,
    request_id: request.id, signature_ok: true, handled: false, body,
  });
  if (dupErr) {
    if ((dupErr.code ?? "") === "23505") return json({ ok: true, duplicate: true });
    console.warn("signnow-webhook: could not record delivery", dupErr.message);
    // Carry on regardless — losing the raw copy is bad, but not applying a
    // completion is worse.
  }

  // ── Apply ────────────────────────────────────────────────────────────────
  try {
    if (!conn) throw new Error("The tenant's SignNow connection has been removed.");

    const policy = await policyFor(admin, request.admin_id, request.doc_kind);
    const ctx = await ctxFor(conn);
    // Re-read the document from SignNow rather than trusting the payload's
    // view of who has signed. This is the single most important line in the
    // function: it is what makes a forged (or stale) callback unable to
    // release an unsigned certificate.
    const doc = await getDocument(ctx, documentId);

    const result = await applyDocumentState(admin, request, doc, ctx, {
      autoRelease: policy.autoRelease,
      actor: "SignNow",
    });

    await admin.from("signing_webhook_deliveries")
      .update({ handled: true })
      .eq("provider", "signnow").eq("delivery_key", deliveryKey);

    if (result.released) {
      console.log("signnow-webhook: certificate released", {
        requestId: request.id, serial: result.serial,
      });
    }

    return json({ ok: true, status: result.status, released: result.released });
  } catch (err) {
    const detail = (err as Error).message;
    console.error("signnow-webhook: handling failed", {
      requestId: request.id, documentId, event: eventName, detail,
    });

    await admin.from("signing_webhook_deliveries")
      .update({ handled: false, handling_error: detail.slice(0, 500) })
      .eq("provider", "signnow").eq("delivery_key", deliveryKey);

    await logEvent(admin, request, "error",
      "A SignNow callback could not be applied. Use Refresh on the signing request to try again.",
      { event: eventName, detail: detail.slice(0, 500) });

    // 200 on purpose — see the header comment.
    return json({ ok: false, recorded: true });
  }
});

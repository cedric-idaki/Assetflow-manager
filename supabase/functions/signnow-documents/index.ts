/// <reference lib="deno.ns" />
/**
 * SIGNNOW DOCUMENTS — send a generated certificate for signature, and track it.
 *
 * The browser has already done two things before it calls this: rendered the
 * PDF (watermarked DRAFT until it comes back signed) and put it in the
 * signed-certificates bucket, then opened a signing_requests row through
 * signing_request_open(). This function is what carries that row to SignNow.
 *
 * ACTIONS
 *   send    upload the draft, place the signature blocks, invite the panel
 *   sync    ask SignNow where the document has got to, and apply the answer
 *   cancel  withdraw the invite at SignNow and close the request here
 *
 * WHY THE BROWSER DOES NOT TALK TO SIGNNOW DIRECTLY
 * -------------------------------------------------
 * Because it would need the tenant's SignNow password to do it, and a
 * credential that reaches a browser is a credential that has been published.
 * Everything here runs under the service role with the secrets decrypted in
 * memory for the length of one request.
 *
 * WHAT IS TAKEN FROM THE CALLER, AND WHAT IS NOT
 * ----------------------------------------------
 * The caller supplies a request id and the coordinates of the signature blocks
 * it drew. Everything else — which tenant, which record, who signs, what the
 * document is called — is read from the database. The field coordinates are
 * bounded-checked rather than trusted: they are a layout detail of a PDF the
 * caller generated for their own tenant, so the risk is a malformed document,
 * not a crossed tenant boundary.
 *
 * verify_jwt = true: the JWT establishes the tenant, and the request must
 * belong to it.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openRequest } from "../_shared/http.ts";
import { keyConfigured } from "../_shared/crypto.ts";
import {
  uploadDocument,
  placeFields,
  getDocument,
  sendInvite,
  cancelInvite,
  sha256Hex,
  SignNowError,
  type SignerSpec,
} from "../_shared/signnow.ts";
import {
  loadConnection,
  ctxFor,
  logEvent,
  refreshRequest,
  policyFor,
  SIGNED_BUCKET,
  type RequestRow,
  type SignerRow,
} from "../_shared/signnow-store.ts";

const API_VERSIONS = ["2026-09-01"];

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

/** A4 in PDF points. Field coordinates outside this are a bug in the caller's
 *  layout, and SignNow answers a 400 that tells nobody anything useful. */
const PAGE_W = 595.28;
const PAGE_H = 841.89;
/** Landscape certificates (the share certificate is A4 landscape) swap them,
 *  so the bound is the larger of the two in each direction. */
const MAX_X = Math.max(PAGE_W, PAGE_H);
const MAX_Y = Math.max(PAGE_W, PAGE_H);

type FieldSpecIn = {
  role?: string;
  page?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  withDate?: boolean;
};

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Turn the caller's layout into SignerSpecs, one per signer row, in the
 * signing order recorded in the database.
 *
 * A signer with no matching field gets a default block laid out along the
 * bottom of the last page. That is not a nicety: a signature field is what
 * makes SignNow require a signature, so a signer without one can "complete"
 * the document having signed nothing, and the certificate would then be
 * released with a blank signature line — the exact failure this whole feature
 * exists to remove.
 */
const specsFor = (signers: SignerRow[], fields: FieldSpecIn[], lastPage: number): SignerSpec[] => {
  const byRole = new Map<string, FieldSpecIn>();
  for (const f of fields) {
    if (f?.role) byRole.set(String(f.role).trim().toLowerCase(), f);
  }

  const ordered = [...signers].sort((a, b) => a.signing_order - b.signing_order);
  const slotWidth = 150;
  const gap = 24;

  return ordered.map((s, i) => {
    const f = byRole.get(s.role_name.trim().toLowerCase());
    if (f) {
      return {
        roleName: s.role_name,
        email: s.signer_email,
        name: s.signer_name,
        order: s.signing_order,
        page: Math.max(0, Math.min(50, Math.trunc(num(f.page, lastPage)))),
        x: Math.max(0, Math.min(MAX_X - 40, num(f.x, 60))),
        y: Math.max(0, Math.min(MAX_Y - 20, num(f.y, 600))),
        width: Math.max(60, Math.min(300, num(f.width, slotWidth))),
        height: Math.max(20, Math.min(120, num(f.height, 40))),
        withDate: f.withDate !== false,
      };
    }
    return {
      roleName: s.role_name,
      email: s.signer_email,
      name: s.signer_name,
      order: s.signing_order,
      page: lastPage,
      x: 56 + i * (slotWidth + gap),
      y: PAGE_H - 170,
      width: slotWidth,
      height: 40,
      withDate: true,
    };
  });
};

Deno.serve(async (req) => {
  const api = await openRequest(req, {
    fn: "signnow-documents",
    methods: "POST, OPTIONS",
    versions: API_VERSIONS,
  });
  if (api.halt) return api.halt;

  const json = api.json;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Not authenticated" }, 401);

    // A second client bound to the CALLER's token, for the one RPC that is
    // meant to be authorised as a person rather than as the platform.
    // signing_request_cancel() gates on is_staff_member() and
    // current_admin_id(), both of which read auth.uid() — under the service
    // role that is NULL, so calling it with `admin` would always be refused.
    const asCaller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData } = await admin.auth.getUser(jwt);
    const user = userData?.user;
    if (!user) return json({ error: "Not authenticated" }, 401);

    const { data: profile } = await admin
      .from("user_profiles")
      .select("role, admin_id, full_name")
      .eq("id", user.id)
      .maybeSingle();

    const role = profile?.role ?? "";
    if (["client", "sacco_member"].includes(role)) {
      return json({ error: "Not permitted to send documents for signature." }, 403);
    }
    const adminId: string = profile?.admin_id ?? user.id;
    const actorName: string = profile?.full_name || user.email || "Staff";

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = String(body?.action ?? "");

    // Sending posts a document into somebody's inbox in the tenant's name, so
    // it is metered harder than reading a status back.
    const over = await api.enforceLimit({
      action: action === "send" ? "send" : "read",
      identity: `user:${user.id}`,
      limit: action === "send" ? 30 : 120,
      windowSeconds: 60,
    });
    if (over) return over;

    if (!keyConfigured("signnow")) {
      return json({
        error: "SIGNNOW_CRED_ENC_KEY is not set on this project, so the stored SignNow credentials cannot be opened.",
        code: "ENC_KEY_MISSING",
      }, 503);
    }

    const requestId = String(body?.requestId ?? "");
    if (!requestId) return json({ error: "Which signing request?" }, 400);

    const { data: reqRow } = await admin
      .from("signing_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle();

    const request = reqRow as RequestRow | null;
    if (!request) return json({ error: "No such signing request." }, 404);

    // The tenant check. A super admin passes because is_global_viewer() lets
    // them see every tenant's register, and support cannot help with a stuck
    // signature they are not allowed to look at.
    if (request.admin_id !== adminId && role !== "super_admin") {
      return json({ error: "That signing request belongs to another organisation." }, 403);
    }

    const conn = await loadConnection(admin, request.admin_id);
    if (!conn) {
      return json({
        error: "SignNow is not connected for this organisation. Connect it in Settings first.",
        code: "NOT_CONNECTED",
      }, 409);
    }
    if (!conn.is_active) {
      return json({
        error: conn.account_email
          ? "The SignNow connection is switched off or was rejected at the last check. Reconnect it in Settings."
          : "SignNow is not connected for this organisation.",
        code: "CONNECTION_INACTIVE",
      }, 409);
    }

    const policy = await policyFor(admin, request.admin_id, request.doc_kind);

    // ── sync ────────────────────────────────────────────────────────────────
    if (action === "sync") {
      const result = await refreshRequest(admin, request, conn, policy.autoRelease, actorName);
      return json({ ok: true, ...result });
    }

    // ── cancel ──────────────────────────────────────────────────────────────
    if (action === "cancel") {
      // SignNow first. If the invite is withdrawn there but our row still says
      // "sent", a sync repairs it; the other way round leaves a live invite for
      // a document the register has already written off, and an officer can
      // still sign it.
      if (request.provider_document_id) {
        try {
          const ctx = await ctxFor(conn);
          await cancelInvite(ctx, request.provider_document_id);
        } catch (err) {
          console.warn("signnow-documents: cancel at provider failed", {
            requestId, detail: (err as Error).message,
          });
          return json({
            error: err instanceof SignNowError
              ? err.publicMessage
              : "Could not withdraw the invite at SignNow, so nothing was cancelled here either.",
          }, 502);
        }
      }

      const { error: cancelErr } = await asCaller.rpc("signing_request_cancel", {
        p_request_id: requestId,
        p_reason: String(body?.reason ?? "").slice(0, 500) || null,
      });
      if (cancelErr) {
        console.error("signnow-documents: cancel rpc failed", { requestId, detail: cancelErr.message });
        return json({
          error: "The invite was withdrawn at SignNow, but the request could not be closed here. Refresh it and try again.",
        }, 500);
      }

      return json({ ok: true, status: "cancelled" });
    }

    // ── send ────────────────────────────────────────────────────────────────
    if (action !== "send") return json({ error: `Unknown action '${action}'` }, 400);

    if (request.status !== "draft") {
      return json({
        error: `This request has already been ${request.status}. Open a new one to send again.`,
      }, 409);
    }
    if (!request.draft_path) {
      return json({ error: "The document was not stored before sending." }, 400);
    }

    const { data: signerRows } = await admin
      .from("signing_request_signers")
      .select("*")
      .eq("request_id", requestId)
      .order("signing_order", { ascending: true });

    const signers = (signerRows as SignerRow[]) ?? [];
    if (signers.length === 0) {
      return json({ error: "This request has no signatories." }, 400);
    }

    // ── The bytes ─────────────────────────────────────────────────────────
    const { data: file, error: dlErr } = await admin.storage.from(SIGNED_BUCKET).download(request.draft_path);
    if (dlErr || !file) {
      console.error("signnow-documents: draft missing", { requestId, path: request.draft_path, dlErr });
      return json({ error: "The generated document could not be read back. Generate it again." }, 404);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0) return json({ error: "The generated document is empty." }, 400);

    const digest = await sha256Hex(bytes);
    // The digest recorded when the request was opened is what the staff member
    // reviewed. If the file in the bucket no longer hashes to it, something
    // replaced it between generating and sending, and this is the last moment
    // anyone could notice.
    if (request.draft_digest && request.draft_digest !== digest) {
      await logEvent(admin, request, "error",
        "The stored document did not match the digest recorded when the request was opened; sending was refused.",
        { expected: request.draft_digest, actual: digest }, actorName);
      await admin.from("signing_requests").update({
        status: "failed",
        last_error: "The stored document changed after the request was opened.",
      }).eq("id", requestId);
      return json({
        error: "The stored document does not match the one this request was opened for. Generate it again.",
        code: "DIGEST_MISMATCH",
      }, 409);
    }

    const lastPage = Math.max(0, Math.trunc(num(body?.lastPage, 0)));
    const fields: FieldSpecIn[] = Array.isArray(body?.fields) ? body.fields : [];
    const specs = specsFor(signers, fields, lastPage);

    let documentId = "";
    try {
      const ctx = await ctxFor(conn);

      // 1. Upload.
      documentId = await uploadDocument(ctx, bytes, `${request.document_name || "certificate"}.pdf`);

      // 2. Place the signature blocks. This is also what CREATES the roles —
      //    SignNow derives them from the fields, which is why the read below
      //    has to come after this and not before.
      await placeFields(ctx, documentId, specs);

      // 3. Read the role ids back. Inviting by role NAME is accepted and then
      //    delivers to nobody; the id is the only thing that binds an invite to
      //    a field.
      const doc = await getDocument(ctx, documentId);
      const roles = Array.isArray(doc.roles) ? doc.roles : [];

      const invited = specs.map((s) => {
        const match = roles.find((r) => (r.name || "").trim().toLowerCase() === s.roleName.trim().toLowerCase());
        return { spec: s, roleId: match?.unique_id ? String(match.unique_id) : "" };
      });

      const missing = invited.filter((i) => !i.roleId).map((i) => i.spec.roleName);
      if (missing.length > 0) {
        throw new SignNowError(
          502,
          `SignNow did not create roles for: ${missing.join(", ")}`,
          "SignNow accepted the document but did not create a signing role for every signatory. Nothing was sent.",
        );
      }

      // 4. Invite.
      const subject = `Signature required: ${request.document_name}`;
      const message = [
        `${actorName} has asked you to sign ${request.document_name}.`,
        request.certificate_serial ? `Certificate serial ${request.certificate_serial}.` : "",
        "This document is not valid until every signatory has signed.",
      ].filter(Boolean).join("\n\n");

      await sendInvite(ctx, documentId, {
        from: conn.account_email || "",
        signers: invited.map((i) => ({
          email: i.spec.email,
          roleName: i.spec.roleName,
          roleId: i.roleId,
          order: i.spec.order,
          name: i.spec.name,
        })),
        subject,
        message,
        sequential: request.signing_order === "sequential",
        expiresDays: policy.expiresDays,
      });

      // 5. Record it. Written after the invite, so a row carrying a
      //    provider_document_id is a row whose panel has actually been asked.
      await admin.from("signing_requests").update({
        status: "sent",
        provider_document_id: documentId,
        provider_environment: conn.environment,
        draft_digest: digest,
        sent_at: new Date().toISOString(),
        last_error: null,
      }).eq("id", requestId);

      for (const i of invited) {
        await admin.from("signing_request_signers").update({
          status: "sent",
          provider_role_id: i.roleId,
        }).eq("request_id", requestId).eq("role_name", i.spec.roleName);
      }

      await logEvent(admin, request, "sent",
        `Sent to ${invited.length} signatory${invited.length === 1 ? "" : "-ies"} through SignNow (${conn.environment}).`,
        { document_id: documentId, digest, signers: invited.map((i) => i.spec.email) },
        actorName);

      return json({
        ok: true,
        status: "sent",
        documentId,
        digest,
        signers: invited.map((i) => ({ role: i.spec.roleName, email: i.spec.email, order: i.spec.order })),
        message: `Sent for signature to ${invited.map((i) => i.spec.email).join(", ")}.`,
      });
    } catch (err) {
      const publicMessage = err instanceof SignNowError
        ? err.publicMessage
        : "The document could not be sent for signature.";

      console.error("signnow-documents: send failed", {
        requestId, documentId, detail: (err as Error).message,
      });

      // A document that reached SignNow but whose invite failed is the worst
      // state to leave behind: it sits in their account, unsent, and a retry
      // would upload a second copy. Withdraw it so the retry starts clean.
      if (documentId) {
        try {
          const ctx = await ctxFor(conn);
          await cancelInvite(ctx, documentId);
        } catch { /* best effort — the failure is already being reported */ }
      }

      await admin.from("signing_requests").update({
        status: "failed",
        last_error: publicMessage,
      }).eq("id", requestId);

      await logEvent(admin, request, "error", publicMessage,
        { document_id: documentId || null }, actorName);

      return json({ error: publicMessage, code: "SEND_FAILED" }, 502);
    }
  } catch (err) {
    return api.fail(err);
  }
});

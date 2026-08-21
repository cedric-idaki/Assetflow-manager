// esign-api — REST backend for API & Embedded Signing.
//
// Lets a client team drive the whole signing flow from THEIR OWN app instead of
// redirecting users to Ararat:
//
//   1. POST create-document with a PDF + signers (+ optional field positions)
//      → per-signer hosted signing links AND iframe-ready /embed/sign links.
//   2. The client app iframes the embed link; the page emits `ararat-esign`
//      postMessage events (ready / signed / completed / error) to the host.
//   3. Webhooks (esign_api_keys.webhook_url) notify the client's server as each
//      signer signs and when the sealed, certified PDF is ready.
//
// AUTH: a per-tenant API key in the `x-api-key` header (NOT a Supabase JWT —
//       the caller is the client's server). SHA-256 of the key is matched
//       against esign_api_keys.key_hash → config.toml sets verify_jwt = false.
//
// Actions (POST JSON):
//   { action: "create-document", name, signers:[…], file_base64|file_url, … }
//   { action: "get-document",    document_id | external_ref }
//   { action: "list-documents",  status?, limit?, offset? }
//   { action: "refresh-link",    document_id, email }
//   { action: "send-invite",     document_id, email? }
//
// Field coordinates are normalized 0..1 of the page (top-left origin) — the
// same convention the in-app field editor and the PDF burner use.
//
// @ts-nocheck — Deno runtime globals are not known to the app's TS config.
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hashedIp, openRequest } from "../_shared/http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");

const API_VERSIONS = ["2026-08-21"];

/**
 * The action handlers below take `json` as a PARAMETER rather than closing over
 * a module-level helper.
 *
 * The headers now depend on the request (its Origin, its negotiated version),
 * and a module-level value set per request would be a real bug: a Deno isolate
 * serves concurrent requests, so one caller's headers could be written while
 * another's response is being built. Passing it down keeps each response tied
 * to the request that produced it.
 */
type Json = (body: unknown, status?: number) => Response;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const FIELD_TYPES = ["signature", "initials", "date", "text", "checkbox", "radio", "dropdown"];
// radio/dropdown carry their own choice list; the signer's answer is one of these labels.
const CHOICE_TYPES = new Set(["radio", "dropdown"]);

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const genToken = () => crypto.randomUUID().replace(/-/g, "");
const isEmail = (v: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());

// Resolve the tenant from the x-api-key header.
async function resolveKey(req: Request) {
  const raw = req.headers.get("x-api-key")?.trim();
  if (!raw) return null;
  const hash = await sha256Hex(raw);
  const { data } = await admin.from("esign_api_keys")
    .select("id, admin_id, label, webhook_url, active")
    .eq("key_hash", hash).eq("active", true).limit(1).maybeSingle();
  if (!data) return null;
  admin.from("esign_api_keys").update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id).then(() => {}, () => {});
  return data;
}

// Where hosted/embedded signing pages live. The client can override per call
// (portal_base) when they run multiple environments.
// portal_base used to be taken verbatim from the request body, which meant an
// API-key holder could have us email signers a link to any domain they liked —
// carrying a real signing token, from the tenant's verified sending domain. It
// is now checked against an allowlist: PORTAL_URL plus anything in
// ESIGN_ALLOWED_PORTALS (comma-separated origins). An unlisted value is refused
// rather than silently downgraded to the default, so a caller with a typo finds
// out instead of sending links to the wrong environment.
function allowedPortals(): string[] {
  const raw = [
    Deno.env.get("PORTAL_URL") || "",
    // The app's own origin is a portal by definition, and APP_URL is already
    // configured on this project while PORTAL_URL is not — without this the
    // allowlist would be empty and every portal_base would be refused.
    Deno.env.get("APP_URL") || "",
    ...(Deno.env.get("ESIGN_ALLOWED_PORTALS") || "").split(","),
  ];
  return raw.map((v) => v.trim().replace(/\/$/, "")).filter(Boolean);
}

function portalBase(body: any): { base: string; error?: string } {
  const allowed = allowedPortals();
  const requested = String(body?.portal_base || "").trim().replace(/\/$/, "");

  if (!requested) return { base: allowed[0] || "" };

  // Compare on origin so a path or trailing segment cannot smuggle in a
  // different host (e.g. https://evil.test/?x=https://portal.test).
  let reqOrigin: string;
  try {
    reqOrigin = new URL(requested).origin;
  } catch {
    return { base: "", error: "portal_base is not a valid URL" };
  }

  const match = allowed.some((a) => {
    try { return new URL(a).origin === reqOrigin; } catch { return false; }
  });

  if (!match) {
    return {
      base: "",
      error: allowed.length
        ? `portal_base '${reqOrigin}' is not an approved portal origin for this deployment`
        : "No portal origins are configured — set the PORTAL_URL or ESIGN_ALLOWED_PORTALS function secret before passing portal_base",
    };
  }
  return { base: requested };
}

// create-document accepts a file_url and fetches it, which makes this function a
// request proxy for anyone holding an API key. Refuse plaintext HTTP, loopback,
// link-local (cloud instance metadata) and RFC1918 targets so the proxy cannot
// be aimed at infrastructure the caller could not otherwise reach. Redirects are
// disabled at the call site so a public URL cannot bounce into one of these.
// Hostnames that resolve to private space are still reachable; a full fix needs
// resolve-then-connect, which Deno's fetch does not expose.
function checkFetchTarget(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return "file_url is not a valid URL"; }
  if (u.protocol !== "https:") return "file_url must use https";

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    return "file_url may not point at an internal host";
  }
  const blocked = [
    /^127\./, /^10\./, /^192\.168\./, /^169\.254\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^0\./, /^::1$/, /^fe80:/i, /^fc00:/i, /^fd/i,
  ];
  if (blocked.some((re) => re.test(host))) {
    return "file_url may not point at a private or link-local address";
  }
  return null;
}

// esign-documents is a private bucket as of 20260731091000, so the stored
// file_url is a reference rather than a fetchable link. API responses hand back
// a short-lived signed URL instead, or the caller gets a 404 they cannot fix.
async function signStoredUrl(value: string | null, expiresIn = 3600): Promise<string | null> {
  if (!value) return null;
  const m = String(value).match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?]+)/);
  if (!m) return value;
  let path = m[2];
  try { path = decodeURIComponent(path); } catch { /* keep raw */ }
  const { data, error } = await admin.storage.from(m[1]).createSignedUrl(path, expiresIn);
  if (error) { console.warn("signStoredUrl failed:", error.message); return null; }
  return data?.signedUrl ?? null;
}

const links = (base: string, token: string) => ({
  signing_url: base ? `${base}/sign/${token}` : null,
  embed_url:   base ? `${base}/embed/sign/${token}` : null,
});

async function callEmail(type: string, to: string, data: any) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({ type, to, data }),
    });
  } catch (e) { console.warn("callEmail failed:", e.message); }
}

async function callSms(to: string, message: string) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE },
      body: JSON.stringify({ type: "custom", to, message }),
    });
  } catch (e) { console.warn("callSms failed:", e.message); }
}

async function recordAudit(adminId: string, contractId: string, label: string, eventType: string, detail: string) {
  await admin.from("esign_audit_events").insert({
    admin_id: adminId, contract_id: contractId, document_label: label,
    event_type: eventType, actor: "API", detail,
  }).then(() => {}, () => {});
}

// Email + SMS the signing invite to one signer row.
async function inviteSigner(row: any, docName: string, message: string | null, base: string) {
  if (!row?.token || !base) return;
  const link = `${base}/sign/${row.token}`;
  await callEmail("signing_invite", row.email, {
    signerName: row.name, documentName: docName, link,
    message: message || undefined, expiresAt: row.token_expires_at,
  });
  if (row.phone) {
    await callSms(row.phone, `Ararat E-Sign: Hi ${row.name || "there"}, please sign "${docName}". Sign securely: ${link}`);
  }
}

// ── create-document ────────────────────────────────────────────────────────────
async function createDocument(key: any, body: any, json: Json) {
  const name = String(body.name || "").trim();
  if (!name) return json({ error: "name is required" }, 400);

  const signersIn = Array.isArray(body.signers) ? body.signers : [];
  if (!signersIn.length) return json({ error: "At least one signer is required" }, 400);
  for (const s of signersIn) {
    if (!isEmail(s?.email)) return json({ error: `Invalid signer email: ${s?.email ?? "(missing)"}` }, 400);
  }
  const emails = signersIn.map((s: any) => String(s.email).trim().toLowerCase());
  const dupe = emails.find((e: string, i: number) => emails.indexOf(e) !== i);
  if (dupe) return json({ error: `Duplicate signer email: ${dupe}` }, 400);

  // ── The PDF: base64 payload or a fetchable URL; re-hosted in our bucket so
  //    the sealed copy and public preview always resolve. ──
  let bytes: Uint8Array | null = null;
  if (typeof body.file_base64 === "string" && body.file_base64) {
    const b64 = body.file_base64.replace(/^data:application\/pdf;base64,/, "");
    try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }
    catch { return json({ error: "file_base64 is not valid base64" }, 400); }
  } else if (typeof body.file_url === "string" && body.file_url) {
    const guard = checkFetchTarget(body.file_url);
    if (guard) return json({ error: guard }, 400);
    const res = await fetch(body.file_url, { redirect: "error" });
    if (!res.ok) return json({ error: `Could not fetch file_url (${res.status})` }, 400);
    bytes = new Uint8Array(await res.arrayBuffer());
  } else {
    return json({ error: "Provide file_base64 (PDF) or file_url" }, 400);
  }
  if (!bytes || bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") {
    return json({ error: "The file must be a PDF" }, 400);
  }
  if (bytes.length > 50 * 1024 * 1024) return json({ error: "PDF exceeds the 50MB limit" }, 400);

  const sequential = body.sequential !== false;               // default sequential
  const expiresDays = Math.min(60, Math.max(1, Number(body.expires_days) || 14));
  const expires = new Date(Date.now() + expiresDays * 24 * 3600 * 1000).toISOString();
  const { base, error: portalErr } = portalBase(body);
  if (portalErr) return json({ error: portalErr }, 400);

  // Document row first (we need the id for the storage path).
  const { data: docRow, error: docErr } = await admin.from("esign_documents").insert({
    admin_id: key.admin_id, name, file_type: "PDF",
    status: "pending", signing_order: sequential ? "sequential" : "parallel",
    message: body.message ? String(body.message) : null,
    expires_at: expires, api_key_id: key.id,
    external_ref: body.external_ref ? String(body.external_ref) : null,
  }).select("id").single();
  if (docErr) { console.error("esign-api: document insert failed", docErr.message); return json({ error: "Could not create the document." }, 500); }

  const path = `${key.admin_id}/api_${docRow.id}.pdf`;
  const { error: upErr } = await admin.storage.from("esign-documents")
    .upload(path, bytes, { upsert: true, contentType: "application/pdf" });
  if (upErr) {
    await admin.from("esign_documents").delete().eq("id", docRow.id).then(() => {}, () => {});
    console.error("esign-api: storage upload failed", upErr.message);
    return json({ error: "Could not store the document file." }, 500);
  }
  const { data: pub } = admin.storage.from("esign-documents").getPublicUrl(path);
  await admin.from("esign_documents").update({ file_url: pub?.publicUrl }).eq("id", docRow.id);

  // Signer rows with one-time tokens.
  const { data: signerRows, error: sErr } = await admin.from("esign_signers").insert(
    signersIn.map((s: any, i: number) => ({
      admin_id: key.admin_id,
      esign_document_id: docRow.id,
      source_type: "esign_doc",
      name: String(s.name || s.email.split("@")[0]).trim(),
      email: String(s.email).trim(),
      phone: s.phone ? String(s.phone).trim() : null,
      role: s.role ? String(s.role) : "Signer",
      signing_order: sequential ? (Number.isFinite(Number(s.order)) ? Number(s.order) : i) : 0,
      status: "pending",
      token: genToken(),
      token_expires_at: expires,
      link_base: base || null,
    }))
  ).select("id, name, email, phone, role, signing_order, token, token_expires_at");
  if (sErr) {
    await admin.from("esign_documents").delete().eq("id", docRow.id).then(() => {}, () => {});
    console.error("esign-api: signer insert failed", sErr.message);
    return json({ error: "Could not create the signers." }, 500);
  }

  // Field placements (optional — signers without fields tap-and-sign anywhere).
  const fieldRows: any[] = [];
  signersIn.forEach((s: any, i: number) => {
    for (const f of (Array.isArray(s.fields) ? s.fields : [])) {
      const type = String(f.type || f.field_type || "signature").toLowerCase();
      if (!FIELD_TYPES.includes(type)) continue;
      // A choice field with fewer than two labels would render as an unanswerable
      // box in the signed contract, so drop it rather than ship something broken.
      const options = Array.isArray(f.options)
        ? f.options.map((o: unknown) => String(o).trim()).filter(Boolean)
        : [];
      if (CHOICE_TYPES.has(type) && options.length < 2) continue;
      fieldRows.push({
        admin_id: key.admin_id,
        source_type: "esign_doc",
        esign_document_id: docRow.id,
        signer_id: signerRows[i].id,
        field_type: type,
        page_index: Math.max(0, Number(f.page ?? f.page_index) || 0),
        pos_x: Math.min(1, Math.max(0, Number(f.x ?? f.pos_x) || 0)),
        pos_y: Math.min(1, Math.max(0, Number(f.y ?? f.pos_y) || 0)),
        width:  Math.min(1, Math.max(0.01, Number(f.w ?? f.width)  || 0.25)),
        height: Math.min(1, Math.max(0.01, Number(f.h ?? f.height) || 0.05)),
        required: f.required !== false,
        placeholder: f.placeholder ? String(f.placeholder) : null,
        options,
      });
    }
  });
  if (fieldRows.length) {
    const { error: fErr } = await admin.from("esign_fields").insert(fieldRows);
    if (fErr) { console.error("esign-api: field insert failed", fErr.message); return json({ error: "Could not create the document fields." }, 500); }
  }

  await recordAudit(key.admin_id, docRow.id, name, "created",
    `Created via API key "${key.label}" · ${signerRows.length} signer(s) · ${fieldRows.length} field(s)`);

  // Invites: optional — embedded flows usually deliver the link themselves.
  if (body.send_invites === true) {
    const toInvite = sequential ? signerRows.slice(0, 1) : signerRows;
    await Promise.all(toInvite.map((r: any) => inviteSigner(r, name, body.message || null, base)));
    await recordAudit(key.admin_id, docRow.id, name, "sent",
      `${sequential ? "sequential" : "parallel"} order · ${toInvite.length} invite(s) sent via API`);
  }

  return json({
    ok: true,
    document_id: docRow.id,
    external_ref: body.external_ref || null,
    status: "pending",
    expires_at: expires,
    file_url: await signStoredUrl(pub?.publicUrl || null),
    signers: signerRows.map((r: any) => ({
      email: r.email, name: r.name, role: r.role, signing_order: r.signing_order,
      token: r.token, token_expires_at: r.token_expires_at,
      ...links(base, r.token),
    })),
    ...(base ? {} : { note: "No portal_base was provided and PORTAL_URL is unset — signing links are null; build them as {portal}/embed/sign/{token}." }),
  });
}

// ── get-document ───────────────────────────────────────────────────────────────
async function getDocument(key: any, body: any, json: Json) {
  let q = admin.from("esign_documents")
    .select("id, name, status, file_url, final_pdf_hash, external_ref, signing_order, expires_at, created_at, updated_at")
    .eq("admin_id", key.admin_id);
  if (body.document_id) q = q.eq("id", body.document_id);
  else if (body.external_ref) q = q.eq("external_ref", String(body.external_ref));
  else return json({ error: "document_id or external_ref is required" }, 400);
  const { data: doc } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!doc) return json({ error: "Document not found" }, 404);

  const { data: signers } = await admin.from("esign_signers")
    .select("name, email, role, status, signing_order, viewed_at, signed_at, token, token_expires_at")
    .eq("esign_document_id", doc.id).order("signing_order", { ascending: true });
  const { base, error: portalErr } = portalBase(body);
  if (portalErr) return json({ error: portalErr }, 400);
  return json({
    ok: true,
    document: { ...doc, file_url: await signStoredUrl(doc.file_url) },
    signers: (signers || []).map((s: any) => ({
      name: s.name, email: s.email, role: s.role, status: s.status,
      signing_order: s.signing_order, viewed_at: s.viewed_at, signed_at: s.signed_at,
      ...(s.token ? links(base, s.token) : { signing_url: null, embed_url: null }),
    })),
  });
}

// ── list-documents ─────────────────────────────────────────────────────────────
async function listDocuments(key: any, body: any, json: Json) {
  const limit = Math.min(100, Math.max(1, Number(body.limit) || 25));
  const offset = Math.max(0, Number(body.offset) || 0);
  let q = admin.from("esign_documents")
    .select("id, name, status, external_ref, final_pdf_hash, file_url, created_at, updated_at")
    .eq("admin_id", key.admin_id).eq("api_key_id", key.id)
    .order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  if (body.status) q = q.eq("status", String(body.status));
  const { data, error } = await q;
  if (error) { console.error("esign-api: list failed", error.message); return json({ error: "Could not list documents." }, 500); }
  const documents = await Promise.all(
    (data || []).map(async (d: any) => ({ ...d, file_url: await signStoredUrl(d.file_url) }))
  );
  return json({ ok: true, documents, limit, offset });
}

// ── refresh-link: re-issue an expired/spent link for an unsigned signer ────────
async function refreshLink(key: any, body: any, json: Json) {
  if (!body.document_id || !isEmail(body.email)) return json({ error: "document_id and email are required" }, 400);
  const { data: signer } = await admin.from("esign_signers")
    .select("id, status, name, email")
    .eq("esign_document_id", body.document_id).eq("admin_id", key.admin_id)
    .eq("email", String(body.email).trim()).limit(1).maybeSingle();
  if (!signer) return json({ error: "Signer not found on that document" }, 404);
  if (signer.status === "signed") return json({ error: "This signer has already signed" }, 409);

  const expiresDays = Math.min(60, Math.max(1, Number(body.expires_days) || 14));
  const expires = new Date(Date.now() + expiresDays * 24 * 3600 * 1000).toISOString();
  const token = genToken();
  const { base, error: portalErr } = portalBase(body);
  if (portalErr) return json({ error: portalErr }, 400);
  await admin.from("esign_signers")
    .update({ token, token_expires_at: expires, status: "pending", link_base: base || null })
    .eq("id", signer.id);
  return json({ ok: true, email: signer.email, token, token_expires_at: expires, ...links(base, token) });
}

// ── send-invite: (re)deliver invites by email/SMS ──────────────────────────────
async function sendInvite(key: any, body: any, json: Json) {
  if (!body.document_id) return json({ error: "document_id is required" }, 400);
  const { data: doc } = await admin.from("esign_documents")
    .select("id, name, message, signing_order")
    .eq("id", body.document_id).eq("admin_id", key.admin_id).maybeSingle();
  if (!doc) return json({ error: "Document not found" }, 404);

  let q = admin.from("esign_signers")
    .select("id, name, email, phone, token, token_expires_at, signing_order, status")
    .eq("esign_document_id", doc.id).neq("status", "signed").not("token", "is", null)
    .order("signing_order", { ascending: true });
  if (body.email) q = q.eq("email", String(body.email).trim());
  const { data: rows } = await q;
  if (!rows?.length) return json({ error: "No invitable signers found" }, 404);

  const { base, error: portalErr } = portalBase(body);
  if (portalErr) return json({ error: portalErr }, 400);
  if (!base) return json({ error: "No portal_base provided and PORTAL_URL is unset — cannot build signing links" }, 400);
  const toInvite = (!body.email && doc.signing_order === "sequential") ? rows.slice(0, 1) : rows;
  await Promise.all(toInvite.map((r: any) => inviteSigner(r, doc.name, doc.message, base)));
  await recordAudit(key.admin_id, doc.id, doc.name, "sent", `Invite(s) delivered via API to ${toInvite.map((r: any) => r.email).join(", ")}`);
  return json({ ok: true, invited: toInvite.map((r: any) => r.email) });
}

serve(async (req: Request) => {
  const api = await openRequest(req, {
    fn: "esign-api",
    methods: "POST, OPTIONS",
    versions: API_VERSIONS,
  });
  if (api.halt) return api.halt;

  const json = api.json;
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  try {
    const key = await resolveKey(req);
    if (!key) {
      // verify_jwt = false, so the x-api-key header is the only credential and
      // anybody can reach here to guess at it. Budget the REJECTED path by
      // address: a client's server presents a working key and never lands here.
      const guessing = await api.enforceLimit({
        action: "bad-key",
        identity: `ip:${await hashedIp(req, "esign-api")}`,
        limit: 10,
        windowSeconds: 300,
      });
      if (guessing) return guessing;

      return json({ error: "Invalid or missing x-api-key" }, 401);
    }

    // Keyed on the tenant's key id, so one client team's integration cannot
    // spend another's budget. create-document uploads a PDF, writes several
    // tables and emails every signer, so this is not a cheap call to loop.
    const over = await api.enforceLimit({
      action: "call",
      identity: `key:${key.id}`,
      limit: 120,
      windowSeconds: 60,
    });
    if (over) return over;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    switch (action) {
      case "create-document": return await createDocument(key, body, json);
      case "get-document":    return await getDocument(key, body, json);
      case "list-documents":  return await listDocuments(key, body, json);
      case "refresh-link":    return await refreshLink(key, body, json);
      case "send-invite":     return await sendInvite(key, body, json);
      default: return json({ error: `Unknown action: ${String(action).slice(0, 40) || "(none)"}` }, 400);
    }
  } catch (error) {
    return api.fail(error);
  }
});

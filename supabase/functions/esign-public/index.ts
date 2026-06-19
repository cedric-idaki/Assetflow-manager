// esign-public — secure backend for the public /sign/:token external-signing page.
//
// esign_signers is staff-only under RLS, so an unauthenticated external signer
// cannot read their token row or the document directly. This function runs with
// the service role (bypassing RLS) and exposes only three narrow, token-scoped
// actions, keeping signing tokens server-side instead of weakening RLS.
//
//   POST { action: "lookup",          token }
//   POST { action: "send-otp",        token }
//   POST { action: "verify-and-sign", token, code, signature:{type,data,font?}, ip?, device? }
//
// @ts-nocheck — Deno runtime globals are not known to the app's TS config.
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: CORS });

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// SHA-256 hex of `${token}:${code}` — we store only the hash, never the code.
async function hashOtp(token: string, code: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${token}:${code}`));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Resolve the parent document (name + file_url) for a signer row.
async function resolveDocument(signer: any): Promise<{ name: string; file_url: string | null }> {
  const src = signer.source_type || "generated";
  if (src === "company") {
    const { data } = await admin.from("company_contracts").select("contract_name, file_url").eq("id", signer.contract_id).single();
    return { name: data?.contract_name || "Contract", file_url: data?.file_url || null };
  }
  if (src === "esign_doc") {
    const { data } = await admin.from("esign_documents").select("name, file_url").eq("id", signer.esign_document_id).single();
    return { name: data?.name || "Document", file_url: data?.file_url || null };
  }
  const { data } = await admin.from("generated_contracts").select("invoice_number, client_name, pricing_model, file_url").eq("id", signer.contract_id).single();
  const title = (data?.pricing_model === "installment" ? "Hire Purchase Agreement" : "Sale Agreement") + " — " + (data?.client_name || "Client");
  return { name: title, file_url: data?.file_url || null };
}

// Load a usable signer by token (unsigned + token not expired).
async function getSigner(token: string) {
  if (!token) return null;
  const { data } = await admin.from("esign_signers").select("*").eq("token", token).limit(1).single();
  if (!data) return null;
  if (data.status === "signed") return { row: data, expired: false, signed: true };
  const expired = data.token_expires_at ? new Date(data.token_expires_at) < new Date() : false;
  return { row: data, expired, signed: false };
}

async function recordAudit(adminId: string, contractId: string, label: string, eventType: string, actor: string, detail: string, extra: any = {}) {
  await admin.from("esign_audit_events").insert({
    admin_id: adminId, contract_id: contractId, document_label: label,
    event_type: eventType, actor, detail, ...extra,
  }).then(() => {}, () => {});
}

async function callEmail(type: string, to: string, data: any) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({ type, to, data }),
    });
  } catch (e) { console.warn("callEmail failed:", e.message); }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { action, token, code, signature, device } = await req.json();
    if (!action || !token) return json({ error: "action and token are required" }, 400);

    // Derive the signer's IP from the request for the audit trail.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

    const found = await getSigner(token);
    if (!found) return json({ error: "This signing link is invalid." }, 404);
    if (found.signed) return json({ error: "This document has already been signed." }, 410);
    if (found.expired) return json({ error: "This signing link has expired." }, 410);

    const signer = found.row;
    const doc = await resolveDocument(signer);
    const label = doc.name;

    // ── lookup ──────────────────────────────────────────────────────────────
    if (action === "lookup") {
      await recordAudit(signer.admin_id, signer.contract_id, label, "viewed",
        signer.name || signer.email, "External signer opened the document",
        { actor_email: signer.email, ip, device });
      return json({
        ok: true,
        signer: { name: signer.name, email: signer.email, role: signer.role },
        document: { name: doc.name, file_url: doc.file_url },
      });
    }

    // ── send-otp ────────────────────────────────────────────────────────────
    if (action === "send-otp") {
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const otp_hash = await hashOtp(token, otp);
      const otp_expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await admin.from("esign_signers").update({ otp_hash, otp_expires_at }).eq("id", signer.id);
      await callEmail("signing_otp", signer.email, {
        signerName: signer.name, code: otp, documentName: doc.name, expiresMinutes: 10,
      });
      return json({ ok: true });
    }

    // ── verify-and-sign ───────────────────────────────────────────────────────
    if (action === "verify-and-sign") {
      if (!code || !signature?.data) return json({ error: "Code and signature are required." }, 400);
      if (!signer.otp_hash || !signer.otp_expires_at) return json({ error: "Request a verification code first." }, 400);
      if (new Date(signer.otp_expires_at) < new Date()) return json({ error: "Your code expired. Request a new one." }, 410);
      const incoming = await hashOtp(token, String(code));
      if (incoming !== signer.otp_hash) return json({ error: "Invalid verification code." }, 401);

      const signedAt = new Date().toISOString();
      const hashInput = `${label}:${signedAt}:${signature.data}`;
      const sigHashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput));
      const sigHash = Array.from(new Uint8Array(sigHashBuf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 24) + "…";

      // Persist the signature on the signer row and expire the one-time link.
      await admin.from("esign_signers").update({
        status: "signed", signed_at: signedAt, ip, device,
        signature_type: signature.type, signature_data: signature.data, signature_hash: sigHash,
        otp_hash: null, otp_expires_at: null, token: null, token_expires_at: null,
      }).eq("id", signer.id);

      // Are all signers for this document done?
      const src = signer.source_type || "generated";
      const linkCol = src === "esign_doc" ? "esign_document_id" : "contract_id";
      const linkVal = src === "esign_doc" ? signer.esign_document_id : signer.contract_id;
      const { data: siblings } = await admin.from("esign_signers").select("status").eq(linkCol, linkVal).eq("source_type", src);
      const allSigned = (siblings || []).every(s => s.status === "signed");

      // Flip the parent document status.
      if (src === "company") {
        await admin.from("company_contracts").update({
          esign_status: allSigned ? "signed" : "pending",
          ...(allSigned ? { signed_at: signedAt, signature_hash: sigHash } : {}),
        }).eq("id", signer.contract_id);
      } else if (src === "esign_doc") {
        await admin.from("esign_documents").update({ status: allSigned ? "completed" : "in_review", updated_at: signedAt }).eq("id", signer.esign_document_id);
      } else {
        await admin.from("generated_contracts").update({
          esign_status: allSigned ? "signed" : "pending",
          ...(allSigned ? { signed_at: signedAt, signature_hash: sigHash } : {}),
        }).eq("id", signer.contract_id);
      }

      const refId = src === "esign_doc" ? signer.esign_document_id : signer.contract_id;
      await recordAudit(signer.admin_id, refId, label, "signed", signer.name || signer.email,
        "External signature applied — OTP verified by email", { actor_email: signer.email, ip, device, hash: sigHash });
      if (allSigned) {
        await recordAudit(signer.admin_id, refId, label, "completed", "System", "All signatures verified. Document sealed.", { hash: sigHash });
      }

      // Tenant notification + a confirmation/security record to the signer.
      await admin.from("esign_notifications").insert({
        admin_id: signer.admin_id, type: "success",
        title: allSigned ? `${label} fully signed` : `${label} signed by ${signer.name || signer.email}`,
        detail: `External signer ${signer.email} signed on ${signedAt}`, contract_id: refId,
      }).then(() => {}, () => {});
      await callEmail("esign_security_alert", signer.email, {
        ownerName: signer.name, documentName: label, actor: signer.name || signer.email,
        time: signedAt, ip, device,
      });

      return json({ ok: true, completed: allSigned });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (error) {
    return json({ error: error.message || "Unexpected error" }, 500);
  }
});

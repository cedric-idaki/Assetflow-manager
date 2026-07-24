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
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

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

// Stamp a compact signing footer on every original page so each page — not just
// the appended certificate — carries the signature evidence. Mirrors the
// browser-side stampPageFooters in applySignatureToPDF.js.
function stampPageFooters(pages: any[], helv: any, helvB: any, meta: any = {}) {
  const total = meta.totalPages || pages.length;
  const name = meta.documentName ? String(meta.documentName) : "";
  const hash = meta.hash ? String(meta.hash) : "";
  const M = 40;
  pages.forEach((page: any, i: number) => {
    const { width: pw } = page.getSize();
    const right = pw - M;
    page.drawLine({ start: { x: M, y: 33 }, end: { x: right, y: 33 }, thickness: 0.5, color: rgb(0.78, 0.82, 0.9) });
    const brand = "Electronically signed · Ararat E-Signature";
    page.drawText(brand, { x: M, y: 22, size: 6.5, font: helvB, color: rgb(0.24, 0.34, 0.55) });
    const pageLabel = `Page ${i + 1} of ${total}`;
    page.drawText(pageLabel, { x: right - helv.widthOfTextAtSize(pageLabel, 6.5), y: 22, size: 6.5, font: helv, color: rgb(0.45, 0.49, 0.56) });
    if (name) {
      const clipped = name.length > 74 ? name.slice(0, 73) + "…" : name;
      page.drawText(clipped, { x: M, y: 13, size: 6, font: helv, color: rgb(0.5, 0.54, 0.6) });
    }
    if (hash) {
      const vt = `Verified ${hash}`;
      page.drawText(vt, { x: right - helv.widthOfTextAtSize(vt, 6), y: 13, size: 6, font: helv, color: rgb(0.5, 0.54, 0.6) });
    }
  });
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

// Burn every placed field into the source PDF (server-side counterpart of the
// browser's applyFieldsToPDF) and append the certificate page. Coordinates are
// normalized (0..1); pdf-lib's origin is bottom-left. Typed signatures fall
// back to oblique text since Deno has no canvas to rasterize a script font.
async function burnFieldsIntoPdf(fileUrl: string, fields: any[], meta: any): Promise<Uint8Array> {
  const bytes = await fetch(fileUrl).then((r) => {
    if (!r.ok) throw new Error(`Could not fetch source PDF (${r.status})`);
    return r.arrayBuffer();
  });
  const pdf   = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const helv  = await pdf.embedFont(StandardFonts.Helvetica);
  const helvB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const helvO = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const pages = pdf.getPages();

  for (const f of (fields || [])) {
    const page = pages[f.page_index ?? 0];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();
    const boxW = Math.max(1, (f.width  || 0.2)  * pw);
    const boxH = Math.max(1, (f.height || 0.05) * ph);
    const x    = (f.pos_x || 0) * pw;
    const y    = ph - (f.pos_y || 0) * ph - boxH;
    const type = f.field_type || "signature";
    const value = f.value;

    // Fields detected over {{anchor tags}}/glyphs: hide the source text first.
    if (f.mask) {
      page.drawRectangle({ x: x - 1, y: y - 1, width: boxW + 2, height: boxH + 2, color: rgb(1, 1, 1) });
    }

    if (type === "signature" || type === "initials") {
      let cap: any = null;
      try { cap = value ? JSON.parse(value) : null; } catch { cap = value ? { type: "typed", data: String(value) } : null; }
      let drew = false;
      if (cap && cap.type === "drawn" && typeof cap.data === "string" && cap.data.startsWith("data:image")) {
        try {
          const png = await pdf.embedPng(cap.data);
          const scale = Math.min(boxW / png.width, boxH / png.height);
          const w = png.width * scale, h = png.height * scale;
          page.drawImage(png, { x: x + (boxW - w) / 2, y: y + (boxH - h) / 2, width: w, height: h });
          drew = true;
        } catch { /* fall back to text */ }
      }
      if (!drew && cap && cap.data) {
        const size = Math.min(20, Math.max(9, boxH * 0.7));
        page.drawText(String(cap.data), { x: x + 2, y: y + (boxH - size) / 2 + 1, size, font: helvO, color: rgb(0.1, 0.14, 0.2) });
      }
      page.drawLine({ start: { x, y }, end: { x: x + boxW, y }, thickness: 0.5, color: rgb(0.6, 0.7, 0.85) });
    } else if (type === "checkbox") {
      const s = Math.min(boxW, boxH);
      page.drawRectangle({ x, y, width: s, height: s, borderWidth: 1, borderColor: rgb(0.4, 0.45, 0.5) });
      if (String(value) === "true") page.drawText("X", { x: x + s * 0.18, y: y + s * 0.14, size: s * 0.7, font: helvB, color: rgb(0.06, 0.4, 0.13) });
    } else { // date | text
      const text = value == null ? "" : String(value);
      const size = Math.min(13, Math.max(7, boxH * 0.55));
      page.drawText(text, { x: x + 2, y: y + (boxH - size) / 2 + 1, size, font: helv, color: rgb(0.1, 0.14, 0.2) });
    }
  }

  // Signing footer on every page (appendix on each page); count the certificate.
  const totalPages = pages.length + 1;
  stampPageFooters(pages, helv, helvB, { documentName: meta.documentName, hash: meta.hash, totalPages });

  // Certificate page.
  const cp = pdf.addPage([595.28, 841.89]);
  const M = 50; let cy = 780;
  cp.drawRectangle({ x: 0, y: 800, width: 595.28, height: 42, color: rgb(0.10, 0.34, 0.86) });
  cp.drawText("Electronic Signature Certificate", { x: M, y: 812, size: 16, font: helvB, color: rgb(1, 1, 1) });
  cy = 750;
  cp.drawText("This certifies that the document was electronically signed via Ararat E-Signature.", { x: M, y: cy, size: 9, font: helv, color: rgb(0.3, 0.34, 0.4) });
  cy -= 26;
  cp.drawText("Document", { x: M, y: cy, size: 9, font: helvB, color: rgb(0.25, 0.29, 0.35) });
  cp.drawText(String(meta.documentName || "—"), { x: M + 130, y: cy, size: 9, font: helv, color: rgb(0.12, 0.16, 0.22) });
  cy -= 22;
  cp.drawText("Signers", { x: M, y: cy, size: 10, font: helvB, color: rgb(0.15, 0.19, 0.25) });
  cy -= 18;
  for (let i = 0; i < (meta.signers || []).length; i++) {
    const s = meta.signers[i];
    cp.drawText(`${i + 1}. ${s.name || "—"}${s.role ? " · " + s.role : ""}`, { x: M, y: cy, size: 9, font: helvB, color: rgb(0.12, 0.16, 0.22) });
    cy -= 12;
    const line = [s.signedAt && `Signed ${s.signedAt}`, s.ip && `IP ${s.ip}`].filter(Boolean).join("  ·  ");
    if (line) { cp.drawText(line, { x: M + 12, y: cy, size: 7.5, font: helv, color: rgb(0.42, 0.46, 0.52) }); cy -= 14; } else cy -= 4;
  }
  cp.drawText("Ararat Management · Tamper-evident electronic signature record", { x: M, y: 40, size: 7, font: helv, color: rgb(0.55, 0.6, 0.66) });
  // Carry the same "Page X of Y" onto the certificate page (it's the last page).
  const certLabel = `Page ${totalPages} of ${totalPages}`;
  cp.drawText(certLabel, { x: 595.28 - M - helv.widthOfTextAtSize(certLabel, 7), y: 40, size: 7, font: helv, color: rgb(0.55, 0.6, 0.66) });

  return await pdf.save();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { action, token, code, signature, fields, fields_adhoc, device } = await req.json();
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
      const { data: signerFields } = await admin
        .from("esign_fields")
        .select("id, field_type, page_index, pos_x, pos_y, width, height, required, placeholder")
        .eq("signer_id", signer.id)
        .order("page_index", { ascending: true });
      return json({
        ok: true,
        signer: { name: signer.name, email: signer.email, role: signer.role },
        document: { name: doc.name, file_url: doc.file_url },
        fields: signerFields || [],
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
      const hasFields = Array.isArray(fields) && fields.length > 0;
      // Ad-hoc fields: the sender placed none, so the signer's client auto-
      // detected the document's signature areas and sends geometry + values.
      const adhocFields = (!hasFields && Array.isArray(fields_adhoc))
        ? fields_adhoc.filter((f: any) => f && f.field_type)
        : [];
      const hasAdhoc = adhocFields.length > 0;
      if (!code) return json({ error: "Verification code is required." }, 400);
      if (!hasFields && !hasAdhoc && !signature?.data) return json({ error: "A signature is required." }, 400);
      if (!signer.otp_hash || !signer.otp_expires_at) return json({ error: "Request a verification code first." }, 400);
      if (new Date(signer.otp_expires_at) < new Date()) return json({ error: "Your code expired. Request a new one." }, 410);
      const incoming = await hashOtp(token, String(code));
      if (incoming !== signer.otp_hash) return json({ error: "Invalid verification code." }, 401);

      const signedAt = new Date().toISOString();
      const src = signer.source_type || "generated";

      // This signer's field definitions — used for required-validation, picking
      // the representative signature, and burning the sealed PDF.
      const { data: signerFields } = await admin.from("esign_fields").select("*").eq("signer_id", signer.id);
      const submitted = new Map((fields || []).map((f: any) => [f.id, f.value]));

      // Every required field must carry a value.
      for (const ff of (signerFields || [])) {
        if (!ff.required) continue;
        const v = submitted.get(ff.id);
        const ok = v != null && v !== "" && !(ff.field_type === "checkbox" && String(v) === "false");
        if (!ok) return json({ error: "Please complete all required fields before signing." }, 400);
      }

      // Persist each submitted field value.
      if (hasFields) {
        for (const f of fields) {
          if (!f?.id) continue;
          await admin.from("esign_fields").update({ value: f.value ?? null, filled_at: signedAt })
            .eq("id", f.id).eq("signer_id", signer.id);
        }
      }

      // Persist ad-hoc (auto-detected) fields as real rows so the seal step
      // burns them. A signature must be among them.
      if (hasAdhoc) {
        const hasSig = adhocFields.some((f: any) =>
          (f.field_type === "signature" || f.field_type === "initials") && f.value) || !!signature?.data;
        if (!hasSig) return json({ error: "Add your signature before submitting." }, 400);
        await admin.from("esign_fields").insert(adhocFields.map((f: any) => ({
          admin_id: signer.admin_id,
          source_type: src,
          contract_id: src === "esign_doc" ? null : signer.contract_id,
          esign_document_id: src === "esign_doc" ? signer.esign_document_id : null,
          signer_id: signer.id,
          field_type: f.field_type,
          page_index: f.page_index ?? 0,
          pos_x: f.pos_x ?? 0, pos_y: f.pos_y ?? 0,
          width: f.width ?? 0.2, height: f.height ?? 0.05,
          required: false, mask: f.mask === true,
          value: f.value ?? null, filled_at: signedAt,
        })));
      }

      // Representative signature for the signer row + hash: prefer a
      // signature/initials field, else the legacy top-level signature payload.
      let sigType = signature?.type || null;
      let sigData = signature?.data || null;
      if (hasFields) {
        for (const ff of (signerFields || [])) {
          if (ff.field_type === "signature" || ff.field_type === "initials") {
            const v = submitted.get(ff.id);
            if (v) { try { const cap = JSON.parse(v); sigType = cap.type || "drawn"; sigData = cap.data; } catch { sigData = String(v); } break; }
          }
        }
      }
      if (!sigData && hasAdhoc) {
        for (const f of adhocFields) {
          if ((f.field_type === "signature" || f.field_type === "initials") && f.value) {
            try { const cap = JSON.parse(f.value); sigType = cap.type || "drawn"; sigData = cap.data; } catch { sigData = String(f.value); }
            break;
          }
        }
      }
      if (!sigData) { sigType = sigType || "typed"; sigData = `${signer.name || signer.email} · ${signedAt}`; }

      const hashInput = `${label}:${signedAt}:${sigData}`;
      const sigHashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput));
      const sigHash = Array.from(new Uint8Array(sigHashBuf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 24) + "…";

      // Persist the signature on the signer row and expire the one-time link.
      await admin.from("esign_signers").update({
        status: "signed", signed_at: signedAt, ip, device,
        signature_type: sigType, signature_data: sigData, signature_hash: sigHash,
        otp_hash: null, otp_expires_at: null, token: null, token_expires_at: null,
      }).eq("id", signer.id);

      // Are all signers for this document done?
      const linkCol = src === "esign_doc" ? "esign_document_id" : "contract_id";
      const linkVal = src === "esign_doc" ? signer.esign_document_id : signer.contract_id;
      const { data: siblings } = await admin.from("esign_signers").select("status").eq(linkCol, linkVal).eq("source_type", src);
      const allSigned = (siblings || []).every((s: any) => s.status === "signed");

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

      // Once everyone has signed, burn all placed fields into the PDF and point
      // the parent record at the sealed copy (also fixes the historic gap where
      // externally-signed PDFs were never stamped).
      if (allSigned && doc.file_url && /\.pdf(\?|$)/i.test(doc.file_url)) {
        try {
          let allFieldsQ = admin.from("esign_fields").select("*");
          allFieldsQ = src === "esign_doc"
            ? allFieldsQ.eq("esign_document_id", signer.esign_document_id)
            : allFieldsQ.eq("contract_id", signer.contract_id).eq("source_type", src);
          const { data: allFields } = await allFieldsQ;
          if (allFields && allFields.length) {
            const { data: allSigners } = await admin.from("esign_signers")
              .select("name, email, role, signed_at, ip").eq(linkCol, linkVal).eq("source_type", src);
            const sealed = await burnFieldsIntoPdf(doc.file_url, allFields, {
              documentName: label,
              hash: sigHash,
              signers: (allSigners || []).map((s: any) => ({ name: s.name || s.email, role: s.role, signedAt: s.signed_at, ip: s.ip })),
            });
            const bucket = src === "esign_doc" ? "esign-documents" : "contracts";
            const path = `${signer.admin_id}/signed_${refId}.pdf`;
            const { error: upErr } = await admin.storage.from(bucket).upload(path, sealed, { upsert: true, contentType: "application/pdf" });
            if (!upErr) {
              const { data: pub } = admin.storage.from(bucket).getPublicUrl(path);
              const tbl = src === "company" ? "company_contracts" : src === "esign_doc" ? "esign_documents" : "generated_contracts";
              if (pub?.publicUrl) await admin.from(tbl).update({ file_url: pub.publicUrl }).eq("id", refId);
            }
          }
        } catch (e) { console.warn("burnFieldsIntoPdf failed:", e.message); }
      }

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

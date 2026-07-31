// esign-reminders — the scheduled worker behind e-signature auto-reminders and
// link expiry.
//
// Run it every ~6 hours (Supabase scheduled function / external cron — the same
// mechanism agent-followup-reminders and sacco-governance-tick use). It:
//   1. EXPIRES signing links whose token_expires_at has passed: the signer row
//      flips to 'expired', and when no signer on the document ever signed the
//      parent record flips to expired too (audit: 'expired');
//   2. REMINDS signers who still haven't signed: after 48h of silence it re-sends
//      the secure link by email (signing_reminder template) and by SMS when a
//      phone is on file — at most 3 reminders, spaced 48h apart, and only to the
//      signer whose turn it actually is in a sequential chain;
//   3. stamps last_reminder_at / reminder_count so a broken mailbox can never
//      turn into an every-run retry loop, and writes an audit 'reminder' row.
//
// verify_jwt = false (see config.toml) so the scheduler can invoke it with the
// service-role key. There is no user session here — the service role reads
// across all tenants by design.
//
// @ts-nocheck — Deno runtime globals are not known to the app's TS config.
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const PORTAL_URL = Deno.env.get("PORTAL_URL") || "";

const REMIND_AFTER_MS = 48 * 3600 * 1000; // silence before the first/next nudge
const MAX_REMINDERS = 3;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json",
};

// ─── Scheduler authentication ─────────────────────────────────────────────────
// config.toml sets verify_jwt = false so pg_cron can invoke this without a user
// JWT — which also means the platform performs no auth at all and anyone can
// POST here. That matters more for this worker than the others: it drives real
// Resend email and Twilio SMS sends. Accept only the service-role key (what the
// scheduler sends) or an explicit CRON_SECRET, compared in constant time.
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const safeEqual = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const isScheduler = (req) => {
  const auth = req.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (safeEqual(bearer, SERVICE_ROLE)) return true;
  return safeEqual((req.headers.get("x-cron-secret") || "").trim(), CRON_SECRET);
};

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const parentTable = (src: string) =>
  src === "company" ? "company_contracts" : src === "esign_doc" ? "esign_documents" : "generated_contracts";

const parentRef = (s: any) =>
  (s.source_type || "generated") === "esign_doc" ? s.esign_document_id : s.contract_id;

async function recordAudit(s: any, eventType: string, detail: string) {
  await admin.from("esign_audit_events").insert({
    admin_id: s.admin_id, contract_id: parentRef(s), event_type: eventType,
    actor: "System", actor_email: s.email, detail,
  }).then(() => {}, () => {});
}

async function callEmail(type: string, to: string, data: any) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({ type, to, data }),
    });
    return res.ok;
  } catch (e) { console.warn("callEmail failed:", e.message); return false; }
}

async function callSms(to: string, message: string) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
      body: JSON.stringify({ type: "custom", to, message }),
    });
    return res.ok;
  } catch (e) { console.warn("callSms failed:", e.message); return false; }
}

// Is an earlier signer in a sequential chain still unsigned? (Parallel sends
// give everyone order 0, so this never blocks them.)
function hasEarlierUnsigned(signer: any, siblings: any[]) {
  if (!signer.signing_order || signer.signing_order <= 0) return false;
  return siblings.some(s =>
    s.id !== signer.id && (s.signing_order || 0) < signer.signing_order && s.status !== "signed");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // verify_jwt = false leaves this endpoint open to the internet, so the caller
  // has to prove it is the scheduler.
  if (!isScheduler(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: CORS });
  }

  try {
    // { dry_run: true } reports what WOULD happen without sending or writing.
    const dryRun = await req.json().then((b) => b?.dry_run === true).catch(() => false);
    const now = new Date();
    const nowIso = now.toISOString();
    let expired = 0, reminded = 0;

    // ── 1. Expire overdue links ──────────────────────────────────────────────
    const { data: overdue } = await admin.from("esign_signers")
      .select("id, admin_id, contract_id, esign_document_id, source_type, name, email, signing_order")
      .in("status", ["pending", "viewed"])
      .not("token", "is", null)
      .lt("token_expires_at", nowIso);

    for (const s of (overdue || [])) {
      if (dryRun) { expired++; continue; }
      await admin.from("esign_signers").update({ status: "expired" }).eq("id", s.id);
      await recordAudit(s, "expired", `Signing link for ${s.email} expired unused`);
      expired++;

      // Parent flips to expired only when nobody on the document ever signed
      // and no live links remain.
      const linkCol = (s.source_type || "generated") === "esign_doc" ? "esign_document_id" : "contract_id";
      const { data: sibs } = await admin.from("esign_signers")
        .select("id, status, token_expires_at")
        .eq(linkCol, parentRef(s)).eq("source_type", s.source_type || "generated");
      const anySigned = (sibs || []).some(x => x.status === "signed");
      const anyLive = (sibs || []).some(x =>
        (x.status === "pending" || x.status === "viewed") &&
        (!x.token_expires_at || new Date(x.token_expires_at) >= now));
      if (!anySigned && !anyLive) {
        const tbl = parentTable(s.source_type || "generated");
        if (tbl === "esign_documents") {
          await admin.from(tbl).update({ status: "expired", updated_at: nowIso }).eq("id", parentRef(s)).neq("status", "completed");
        } else {
          await admin.from(tbl).update({ esign_status: "expired" }).eq("id", parentRef(s)).eq("esign_status", "pending");
        }
        await admin.from("esign_notifications").insert({
          admin_id: s.admin_id, type: "warning", title: "Signature request expired",
          detail: `All signing links expired before anyone signed`, contract_id: parentRef(s),
        }).then(() => {}, () => {});
      }
    }

    // ── 2. Remind signers who still haven't signed ───────────────────────────
    const threshold = new Date(now.getTime() - REMIND_AFTER_MS).toISOString();
    const { data: stale } = await admin.from("esign_signers")
      .select("id, admin_id, contract_id, esign_document_id, source_type, name, email, phone, token, token_expires_at, signing_order, status, link_base, last_reminder_at, reminder_count, created_at")
      .in("status", ["pending", "viewed"])
      .not("token", "is", null)
      .gte("token_expires_at", nowIso)
      .lt("reminder_count", MAX_REMINDERS)
      .lt("created_at", threshold);

    for (const s of (stale || [])) {
      // Respect the 48h spacing between nudges.
      if (s.last_reminder_at && new Date(s.last_reminder_at).getTime() > now.getTime() - REMIND_AFTER_MS) continue;

      // Sequential chains: don't nag signers whose turn hasn't come.
      const linkCol = (s.source_type || "generated") === "esign_doc" ? "esign_document_id" : "contract_id";
      const { data: sibs } = await admin.from("esign_signers")
        .select("id, status, signing_order")
        .eq(linkCol, parentRef(s)).eq("source_type", s.source_type || "generated");
      if (hasEarlierUnsigned(s, sibs || [])) continue;

      const base = s.link_base || PORTAL_URL;
      if (!base) continue; // no way to rebuild the signing link
      if (dryRun) { reminded++; continue; }
      const link = `${base.replace(/\/$/, "")}/sign/${s.token}`;

      // Resolve a display name for the document.
      let docName = "your document";
      const tbl = parentTable(s.source_type || "generated");
      if (tbl === "esign_documents") {
        const { data: d } = await admin.from(tbl).select("name").eq("id", parentRef(s)).single();
        docName = d?.name || docName;
      } else if (tbl === "company_contracts") {
        const { data: d } = await admin.from(tbl).select("contract_name").eq("id", parentRef(s)).single();
        docName = d?.contract_name || docName;
      } else {
        const { data: d } = await admin.from(tbl).select("client_name, pricing_model").eq("id", parentRef(s)).single();
        if (d) docName = (d.pricing_model === "installment" ? "Hire Purchase Agreement" : "Sale Agreement") + " — " + (d.client_name || "Client");
      }

      const n = (s.reminder_count || 0) + 1;
      await callEmail("signing_reminder", s.email, {
        signerName: s.name, documentName: docName, link,
        expiresAt: s.token_expires_at, reminderNumber: n,
      });
      if (s.phone) {
        await callSms(s.phone,
          `Ararat E-Sign reminder: Hi ${s.name || "there"}, "${docName}" is still waiting for your signature. Sign securely: ${link}`);
      }

      // Stamp even if delivery failed upstream — a broken mailbox must not
      // become an every-run retry loop.
      await admin.from("esign_signers")
        .update({ last_reminder_at: nowIso, reminder_count: n })
        .eq("id", s.id);
      await recordAudit(s, "reminder", `Reminder ${n} of ${MAX_REMINDERS} sent to ${s.email}${s.phone ? " (email + SMS)" : ""}`);
      reminded++;
    }

    return new Response(JSON.stringify({ ok: true, dry_run: dryRun, expired, reminded }), { headers: CORS });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || "Unexpected error" }), { status: 500, headers: CORS });
  }
});

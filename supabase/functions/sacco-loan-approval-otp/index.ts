// sacco-loan-approval-otp — sends the one-time code that confirms a loan
// approval decision.
//
//   POST { action: "send", step_id, channel? ("email" | "sms") }
//     → { ok, channel, destination }   (destination is masked)
//
// The code goes to the APPROVER named on the level (their email / phone as
// snapshotted onto the step), never back to the caller. The staff member at
// the dashboard types it in; sacco_loan_approval_decide() then checks it
// against the hash stored here. The plain code exists only in this function's
// memory and in the approver's inbox.
//
// Who may ask: sacco staff of the loan's own tenant, and only for a step that
// is actually actionable (loan still pending, level still pending, and in
// sequential mode every earlier level approved). Those checks run in
// sacco_loan_approval_otp_context() AS THE CALLER, via their own JWT.
//
// See supabase/migrations/20260930140000_sacco_loan_approval_workflow.sql.
//
// @ts-nocheck — Deno runtime globals are not known to the app's TS config.
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticateCaller, bearerFrom, requireStaff } from "../_shared/auth.ts";
import { callerIdentity, openRequest } from "../_shared/http.ts";
import { EMAIL_FROM } from "../_shared/email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const API_VERSIONS = ["2026-08-21"];
const OTP_MINUTES = 10;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// SHA-256 hex of `${stepId}:${code}` — must match the digest() in decide().
async function hashOtp(stepId: string, code: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${stepId}:${code}`));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Six digits from the CSPRNG, uniform via rejection sampling (same as esign-public).
function generateOtp(): string {
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= 4294000000);
  return String(100000 + (n % 900000));
}

// Kenyan numbers are stored every which way; Twilio wants E.164.
function toE164(phone: string): string {
  const p = String(phone || "").replace(/[^\d+]/g, "");
  if (p.startsWith("+")) return p;
  if (p.startsWith("254")) return `+${p}`;
  if (p.startsWith("0")) return `+254${p.slice(1)}`;
  if (/^[17]\d{8}$/.test(p)) return `+254${p}`;
  return `+${p}`;
}

const maskEmail = (e: string) => {
  const [u, d] = String(e).split("@");
  return `${u.slice(0, 2)}•••@${d || ""}`;
};
const maskPhone = (p: string) => (p && p.length > 3 ? `•••${p.slice(-3)}` : "•••");

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const kes = (n: unknown) =>
  `KES ${Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function sendEmail(to: string, ctx: any, code: string): Promise<boolean> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) { console.error("sacco-loan-approval-otp: RESEND_API_KEY not set"); return false; }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [to],
      subject: `${code} — loan approval code (${ctx.level_name})`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f8fafc">
          <div style="background:#fff;border-radius:12px;padding:28px">
            <p style="margin:0 0 4px;color:#64748b;font-size:13px">${esc(ctx.sacco_name || "SACCO")} · Loan approval</p>
            <h2 style="margin:0 0 16px;color:#0f172a;font-size:18px">Hello ${esc(ctx.approver_name)},</h2>
            <p style="color:#334155;font-size:14px;line-height:1.5">
              A decision is being recorded in your name as <strong>${esc(ctx.level_name)}</strong>
              on the loan application of <strong>${esc(ctx.member_name || "a member")}</strong>
              for <strong>${esc(kes(ctx.principal))}</strong>.
            </p>
            <p style="text-align:center;font-size:32px;letter-spacing:8px;font-weight:bold;color:#0f172a;margin:24px 0">${code}</p>
            <p style="color:#64748b;font-size:13px;line-height:1.5">
              The code expires in ${OTP_MINUTES} minutes. Give it only to the person recording your decision.
              If you did not expect this, do not share it and inform your SACCO.
            </p>
          </div>
        </div>`,
    }),
  });
  if (!res.ok) console.error("sacco-loan-approval-otp: Resend rejected", res.status, await res.text());
  return res.ok;
}

async function sendSms(to: string, ctx: any, code: string): Promise<boolean> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const tok = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_PHONE_NUMBER");
  if (!sid || !tok || !from) { console.error("sacco-loan-approval-otp: Twilio not configured"); return false; }
  const body =
    `${ctx.sacco_name || "SACCO"}: ${code} is your code to approve/reject the loan of ` +
    `${ctx.member_name || "a member"} (${kes(ctx.principal)}) as ${ctx.level_name}. ` +
    `Expires in ${OTP_MINUTES} min. Never share it with anyone else.`;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${sid}:${tok}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: toE164(to), From: from, Body: body }).toString(),
  });
  if (!res.ok) console.error("sacco-loan-approval-otp: Twilio rejected", res.status, await res.text());
  return res.ok;
}

serve(async (req) => {
  const api = await openRequest(req, {
    fn: "sacco-loan-approval-otp",
    methods: "POST, OPTIONS",
    versions: API_VERSIONS,
  });
  if (api.halt) return api.halt;

  const auth = await authenticateCaller(req);
  if (!auth.ok) return api.json({ error: auth.error }, auth.status);
  if (auth.caller.kind !== "user") return api.json({ error: "A signed-in staff user is required." }, 403);
  const denied = requireStaff(auth.caller);
  if (denied) return api.json({ error: denied.error }, denied.status);

  // Each send costs an email or SMS; a human requests one at a time.
  const over = await api.enforceLimit({
    action: "send",
    identity: callerIdentity(auth.caller),
    limit: 10,
    windowSeconds: 60,
  });
  if (over) return over;

  try {
    const { action, step_id, channel } = await req.json();
    if (action !== "send") return api.json({ error: "Unknown action." }, 400);
    if (!step_id) return api.json({ error: "step_id is required." }, 400);

    // Tenant + turn checks, run as the caller.
    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${bearerFrom(req)}` } },
    });
    const { data: ctx, error: ctxErr } = await asUser.rpc("sacco_loan_approval_otp_context", { p_step_id: step_id });
    if (ctxErr || !ctx) {
      // These messages are our own RAISE texts ("Sequential approval: ...").
      return api.json({ error: ctxErr?.message || "This level cannot be decided right now." }, 409);
    }

    const hasEmail = !!ctx.approver_email;
    const hasPhone = !!ctx.approver_phone;
    let use = channel === "sms" ? "sms" : channel === "email" ? "email" : (hasEmail ? "email" : "sms");
    if (use === "email" && !hasEmail) use = "sms";
    if (use === "sms" && !hasPhone) use = "email";

    const code = generateOtp();
    const { error: storeErr } = await admin.rpc("sacco_loan_approval_store_otp", {
      p_step_id: ctx.step_id,
      p_hash: await hashOtp(ctx.step_id, code),
      p_channel: use,
    });
    if (storeErr) {
      if (storeErr.hint === "otp_send_cap") return api.json({ error: storeErr.message }, 429);
      throw storeErr;
    }

    const sent = use === "email"
      ? await sendEmail(ctx.approver_email, ctx, code)
      : await sendSms(ctx.approver_phone, ctx, code);

    if (!sent) {
      await admin.rpc("sacco_loan_approval_clear_otp", { p_step_id: ctx.step_id });
      return api.json({
        error: use === "email"
          ? "The code could not be emailed. Check the approver's email, or send by SMS."
          : "The code could not be sent by SMS. Check the approver's phone, or send by email.",
      }, 502);
    }

    return api.json({
      ok: true,
      channel: use,
      destination: use === "email" ? maskEmail(ctx.approver_email) : maskPhone(ctx.approver_phone),
      expires_minutes: OTP_MINUTES,
    });
  } catch (e) {
    return api.fail(e);
  }
});

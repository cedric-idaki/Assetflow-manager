/// <reference lib="deno.ns" />
//
// agent-followup-reminders — the scheduled worker behind follow-up reminders.
//
// Run it every 15 minutes (Supabase scheduled function / external cron — the
// same mechanism kyc-renewal-reminders and sacco-governance-tick use). It:
//   1. finds every OPEN follow-up whose remind_at has passed and that has not
//      been reminded yet (public.follow_ups, indexed by idx_follow_ups_due);
//   2. emails the owning agent via the send-email `agent_follow_up_reminder`
//      template;
//   3. writes an audit_logs row so the reminder also lands in the agent's
//      in-app notification bell (the Header bell reads audit_logs);
//   4. stamps reminder_sent_at so the same follow-up is never emailed twice.
//
// The stamp is written even when the email fails: a broken mailbox must not turn
// into an infinite retry loop that re-sends every 15 minutes forever. The portal
// still shows the follow-up as due, so nothing is lost.
//
// verify_jwt = false (see config.toml) so the scheduler can invoke it with the
// service-role key. There is no user session here — the service role reads
// across all agents by design.

// @ts-ignore: Deno global is available in the Deno runtime
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { hashedIp, openRequest } from "../_shared/http.ts";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Where the agent portal lives, for the "open my portal" button in the email.
const PORTAL_URL = Deno.env.get("PORTAL_URL") || "";
const portalLink = PORTAL_URL ? `${PORTAL_URL.replace(/\/$/, "")}/sales-agent-portal` : "";

// How far back to look. A follow-up whose remind_at is older than this was
// almost certainly missed while the worker was down; emailing a two-week-old
// reminder is noise, so it is stamped and skipped instead.
const MAX_LOOKBACK_HOURS = 72;

const API_VERSIONS = ["2026-08-21"];

// ─── Scheduler authentication ─────────────────────────────────────────────────
// config.toml sets verify_jwt = false so pg_cron can invoke this without a user
// JWT — which also means the platform performs no auth at all and anyone can
// POST here. Accept only the service-role key (what the scheduler sends) or an
// explicit CRON_SECRET, compared in constant time.
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const safeEqual = (a: string, b: string): boolean => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const isScheduler = (req: Request): boolean => {
  const auth = req.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (safeEqual(bearer, SERVICE_KEY)) return true;
  return safeEqual((req.headers.get("x-cron-secret") || "").trim(), CRON_SECRET);
};

// ─── Supabase REST helpers (service role) ─────────────────────────────────────

const rest = async (path: string, options: RequestInit = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  return { data, ok: res.ok, status: res.status };
};

const sendEmail = async (to: string, data: Record<string, unknown>) => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ type: "agent_follow_up_reminder", to, data }),
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, error: json?.error };
};

// audit_logs.admin_id is the tenant tag the agent's bell filters on
// (tenant_view_audit_logs: admin_id = current_admin_id() AND is_staff_member()).
// current_admin_id() resolves to user_profiles.admin_id, falling back to the
// user's own id — mirror that exactly, or the row is written but invisible.
// The set_admin_id_default trigger cannot help here: it calls current_admin_id(),
// which is NULL under the service role since there is no auth.uid().
const adminIdCache = new Map<string, string>();

const resolveAdminId = async (userId: string): Promise<string> => {
  const cached = adminIdCache.get(userId);
  if (cached) return cached;

  const { data } = await rest(`/user_profiles?select=admin_id&id=eq.${userId}&limit=1`);
  const adminId = (Array.isArray(data) && data[0]?.admin_id) || userId;
  adminIdCache.set(userId, adminId);
  return adminId;
};

// The in-app half of the reminder: the notification bell renders audit_logs.
const logNotification = async (
  userId: string | null,
  followUpId: string,
  leadName: string,
  scheduledAt: string,
  isOverdue: boolean,
) => {
  if (!userId) return;
  await rest("/audit_logs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      user_id: userId,
      admin_id: await resolveAdminId(userId),
      action: isOverdue ? "follow_up_overdue" : "follow_up_reminder",
      table_name: "follow_ups",
      record_id: followUpId,
      description: isOverdue
        ? `Overdue follow-up with ${leadName} — was due ${new Date(scheduledAt).toLocaleString("en-KE")}`
        : `Follow-up reminder: ${leadName} at ${new Date(scheduledAt).toLocaleString("en-KE")}`,
      severity: isOverdue ? "warning" : "info",
    }),
  });
};

// ─── Handler ──────────────────────────────────────────────────────────────────

serve(async (req) => {
  const api = await openRequest(req, {
    fn: "agent-followup-reminders",
    methods: "POST, OPTIONS",
    versions: API_VERSIONS,
  });
  if (api.halt) return api.halt;

  // Keeps the existing spreads below working while the values behind them
  // become origin-checked instead of "*".
  const corsHeaders = api.headers;

  if (!isScheduler(req)) {
    // verify_jwt = false means the platform lets anybody reach this handler, so
    // an attacker can hammer it to grind at the two shared secrets. The compare
    // is constant-time, but nothing bounded the attempts themselves. Rejected
    // callers are budgeted by hashed IP; the real scheduler presents a valid key
    // on its first try and never reaches this branch.
    const over = await api.enforceLimit({
      action: "unauthorized",
      identity: `ip:${await hashedIp(req, "agent-followup-reminders")}`,
      limit: 10,
      windowSeconds: 300,
    });
    if (over) return over;

    return api.json({ error: "Unauthorized" }, 401);
  }

  const now = new Date();
  const lookbackFrom = new Date(now.getTime() - MAX_LOOKBACK_HOURS * 3600 * 1000);

  const summary = { scanned: 0, emailed: 0, failed: 0, skipped_stale: 0, no_email: 0 };

  try {
    // 1. Due, open, not yet reminded — embed the agent so we have their inbox.
    const { data: due, ok } = await rest(
      `/follow_ups?select=id,agent_id,lead_id,lead_name,appointment_type,scheduled_at,remind_at,location,notes,` +
        `agent:agents(id,full_name,email,user_id,agent_code),` +
        `lead:leads(full_name,phone,email)` +
        `&is_completed=eq.false&reminder_sent_at=is.null&remind_at=lte.${now.toISOString()}` +
        `&order=remind_at.asc&limit=200`,
    );

    if (!ok || !Array.isArray(due)) {
      throw new Error("Could not read due follow-ups");
    }

    summary.scanned = due.length;

    for (const f of due) {
      const stamp = async () =>
        rest(`/follow_ups?id=eq.${f.id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ reminder_sent_at: new Date().toISOString() }),
        });

      // Too old to be useful — retire it quietly.
      if (f.remind_at && new Date(f.remind_at) < lookbackFrom) {
        summary.skipped_stale++;
        await stamp();
        continue;
      }

      const agentEmail = f.agent?.email;
      if (!agentEmail) {
        summary.no_email++;
        await stamp();
        continue;
      }

      const leadName  = f.lead?.full_name || f.lead_name || "a lead";
      const isOverdue = new Date(f.scheduled_at) < now;

      const { ok: sent, error } = await sendEmail(agentEmail, {
        agentName:       f.agent?.full_name,
        leadName,
        leadPhone:       f.lead?.phone,
        leadEmail:       f.lead?.email,
        appointmentType: f.appointment_type,
        scheduledAt:     f.scheduled_at,
        location:        f.location,
        notes:           f.notes,
        portalUrl:       portalLink,
        isOverdue,
      });

      if (sent) summary.emailed++;
      else {
        summary.failed++;
        console.error(`follow-up ${f.id}: email failed — ${error || "unknown error"}`);
      }

      // In-app notification regardless of email outcome.
      await logNotification(f.agent?.user_id || null, f.id, leadName, f.scheduled_at, isOverdue);

      // Stamp either way — see the header note on retry loops.
      await stamp();
    }

    return new Response(JSON.stringify({ success: true, ...summary }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    console.error("agent-followup-reminders failed:", { requestId: api.requestId, summary });
    return api.fail(error);
  }
});

/// <reference lib="deno.ns" />
//
// STATUTORY RETURN REMINDERS — tell a tenant a deadline is coming, before it is
// a penalty.
//
// WHAT IT DOES, once a day:
//
//   1. asks statutory_reminder_workload() who owes what, for which period,
//      across every tenant, in ONE query (already-filed returns excluded);
//   2. derives each return's deadline from the versioned schedule in
//      _shared/statutory.ts — the 9th for PAYE/NSSF/SHIF, the 9th WORKING day
//      for the housing levy, the 20th for VAT;
//   3. fires on the lead days 7, 3, 1 and 0, then chases daily for a fortnight
//      once a return is overdue and then stops;
//   4. GROUPS every return falling due on the same day into ONE email. PAYE,
//      NSSF and SHIF all land on the 9th, so three separate emails on the same
//      morning would be three chances to filter the lot;
//   5. writes an audit_logs row so the reminder also lands in the tenant's
//      in-app notification bell (the Header bell reads audit_logs);
//   6. records each send in statutory_reminder_logs, where a partial unique
//      index makes "send once" a database guarantee rather than a hope.
//
// WHY THE LOG ROW IS WRITTEN BEFORE THE EMAIL
//
// kyc-renewal-reminders dedupes by SELECTing "has this gone out?" and then
// sending. That is a race: two overlapping runs both read "no" and both send.
// Here the insert IS the claim — uq_statutory_reminder_once rejects the second
// one — so the send happens only for the run that won. If the send then fails,
// the row is flipped to 'failed', which frees the slot (the index is partial on
// status = 'sent') and the next run retries it.
//
// WHAT IT NEVER DOES
//
// It does not file anything, and it never says a return HAS been filed. A row
// in statutory_return_filings is a note that a human filed it. The email says
// so in as many words, because a reminder that implied otherwise would be worse
// than no reminder at all.
//
// verify_jwt = false (see config.toml) so the scheduler can invoke it with the
// service-role key. There is no user session here — the workload RPC reads
// across all tenants by design, and is granted to service_role only.

declare const Deno: any;

import { hashedIp, openRequest } from "../_shared/http.ts";
import {
  STATUTORY_RETURNS,
  amountsFromWorkload,
  dueDateFor,
  obligationApplies,
  reminderDueToday,
  shiftPeriod,
  type StatutoryReturn,
} from "../_shared/statutory.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const PORTAL_URL = Deno.env.get("PORTAL_URL") || "";

const API_VERSIONS = ["2026-09-03"];

// Where the calendar lives, for the button in the email.
const calendarLink = PORTAL_URL
  ? `${PORTAL_URL.replace(/\/$/, "")}/hr-management?tab=payroll`
  : "";

// How far back to sweep. A period's last reminder is its deadline (up to the
// 20th of the following month) plus the 14-day overdue chase — about 34 days
// past the period end. Three months is comfortably clear of that and still
// bounds the query.
const LOOKBACK_MONTHS = 3;

/** Length-independent equality, so a secret cannot be guessed a byte at a time. */
const safeEqual = (a?: string | null, b?: string | null): boolean => {
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

// ─── Supabase REST (service role) ─────────────────────────────────────────────

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
    body: JSON.stringify({ type: "statutory_return_reminder", to, data }),
  });
  const json = await res.json().catch(() => null);
  // The upstream error can name the sending domain and Resend's own codes, and
  // this string ends up in the response. Log the detail; report only failure.
  if (!res.ok) console.error("statutory-return-reminders: send-email rejected", json);
  return { ok: res.ok, error: res.ok ? undefined : "email delivery failed" };
};

// ─── Reminder log: the claim, and its release ─────────────────────────────────

type LogKey = {
  adminId: string;
  returnKey: string;
  period: string;
  dueDate: string;
  leadDays: number;
  channel: string;
  recipient: string;
};

/**
 * Claim a reminder by inserting it as 'sent'.
 *
 * Returns the new row's id when this run won the claim, or null when the unique
 * index refused it — which means some other run has already sent this exact
 * reminder and there is nothing to do.
 */
const claimReminder = async (k: LogKey): Promise<string | null> => {
  const { data, ok, status } = await rest("/statutory_reminder_logs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      admin_id: k.adminId,
      return_key: k.returnKey,
      period: k.period,
      due_date: k.dueDate,
      lead_days: k.leadDays,
      channel: k.channel,
      recipient: k.recipient,
      status: "sent",
    }),
  });

  // 409 is the unique index doing its job — already sent, not an error.
  if (status === 409) return null;
  if (!ok) {
    console.error("statutory-return-reminders: could not claim reminder", { status, data });
    return null;
  }
  return (Array.isArray(data) && data[0]?.id) || null;
};

/**
 * Release a claim whose send failed, so the next run can retry it.
 *
 * The unique index is partial on status = 'sent', so flipping the row to
 * 'failed' frees the slot while keeping the evidence that we tried.
 */
const releaseReminder = async (id: string, error: string) => {
  await rest(`/statutory_reminder_logs?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "failed", error_message: error }),
  });
};

// ─── In-app bell ──────────────────────────────────────────────────────────────

/**
 * The in-app half of the reminder: the notification bell renders audit_logs.
 *
 * user_id AND admin_id are both the tenant owner's id. admin_id is the tenant
 * tag the bell's tenant-wide policy filters on (tenant_view_audit_logs:
 * admin_id = current_admin_id() AND sees_tenant_activity_feed()), so the
 * tenant's finance staff see it too — a deadline is not the owner's private
 * business. The set_admin_id_default trigger cannot fill this in for us: it
 * calls current_admin_id(), which is NULL under the service role.
 */
const logToBell = async (
  adminId: string,
  dueDate: string,
  overdue: boolean,
  daysOverdue: number,
  daysRemaining: number,
  labels: string[],
) => {
  const what = labels.join(", ");
  await rest("/audit_logs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      user_id: adminId,
      admin_id: adminId,
      action: overdue ? "statutory_return_overdue" : "statutory_return_due",
      table_name: "statutory_return_filings",
      description: overdue
        ? `${what} — ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue (was due ${dueDate})`
        : daysRemaining === 0
        ? `${what} due today (${dueDate})`
        : `${what} due in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} (${dueDate})`,
      severity: overdue ? "warning" : daysRemaining <= 1 ? "warning" : "info",
    }),
  });
};

// ─── Handler ──────────────────────────────────────────────────────────────────

type WorkloadRow = {
  admin_id: string;
  tenant_name: string;
  recipient: string | null;
  extra_recipients: string[] | null;
  vat_registered: boolean;
  period: string;
  employees: number;
  gross: number;
  paye: number;
  nssf: number;
  shif: number;
  housing_levy: number;
  has_vat_activity: boolean;
  filed_keys: string[] | null;
};

/** One email's worth: everything one tenant owes on one day. */
type Bundle = {
  adminId: string;
  tenantName: string;
  recipients: string[];
  dueDate: string;
  overdue: boolean;
  daysOverdue: number;
  daysRemaining: number;
  leadDays: number;
  returns: Array<Record<string, unknown>>;
};

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Claim every return in a bundle for one channel and recipient.
 *
 * Returns only the ones this run won — the rest have already been reported to
 * this recipient for this deadline. An empty result means there is nothing to
 * send, which is the common case on a day the scheduler runs twice.
 */
const claimReturns = async (
  bundle: Bundle,
  channel: string,
  recipient: string,
): Promise<Array<{ logId: string; entry: Record<string, unknown> }>> => {
  const won: Array<{ logId: string; entry: Record<string, unknown> }> = [];
  for (const entry of bundle.returns) {
    const logId = await claimReminder({
      adminId: bundle.adminId,
      returnKey: String(entry.returnKey),
      period: String(entry.period),
      dueDate: bundle.dueDate,
      leadDays: bundle.leadDays,
      channel,
      recipient,
    });
    if (logId) won.push({ logId, entry });
  }
  return won;
};

Deno.serve(async (req: Request) => {
  const api = await openRequest(req, {
    fn: "statutory-return-reminders",
    methods: "POST, OPTIONS",
    versions: API_VERSIONS,
  });
  if (api.halt) return api.halt;

  const corsHeaders = api.headers;

  if (!isScheduler(req)) {
    // verify_jwt = false means the platform lets anybody reach this handler, so
    // an attacker can hammer it to grind at the two shared secrets. The compare
    // is constant-time, but nothing bounds the attempts themselves. Rejected
    // callers are budgeted by hashed IP; the real scheduler presents a valid
    // key on its first try and never reaches this branch.
    const over = await api.enforceLimit({
      action: "unauthorized",
      identity: `ip:${await hashedIp(req, "statutory-return-reminders")}`,
      limit: 10,
      windowSeconds: 300,
    });
    if (over) return over;

    return api.json({ error: "Unauthorized" }, 401);
  }

  // "Today" is resolved once for the whole run. A run that straddles midnight
  // must not compute half its deadlines against one date and half against the
  // next — that would send one tenant's 7-day reminder and skip another's.
  const asOf = new Date().toISOString().slice(0, 10);
  const since = shiftPeriod(asOf.slice(0, 7), -LOOKBACK_MONTHS)!;

  const summary = {
    tenants: 0,
    periods: 0,
    bundles: 0,
    emailsSent: 0,
    bellNotices: 0,
    alreadySent: 0,
    noRecipient: 0,
    failed: 0,
    errors: [] as string[],
  };

  try {
    const { data: workload, ok } = await rest(
      `/rpc/statutory_reminder_workload`,
      { method: "POST", body: JSON.stringify({ p_since: since }) },
    );

    if (!ok || !Array.isArray(workload)) {
      console.error("statutory-return-reminders: workload query failed", workload);
      return api.json({ error: "Could not read the statutory workload." }, 502);
    }

    summary.periods = workload.length;
    summary.tenants = new Set(workload.map((r: WorkloadRow) => r.admin_id)).size;

    // ── Build the bundles: one per (tenant, deadline day) ────────────────────
    //
    // Keyed on the DUE DATE rather than the period, because that is what the
    // recipient experiences: "these three things are due on the 9th", not
    // "here are three emails about August".
    const bundles = new Map<string, Bundle>();

    for (const row of workload as WorkloadRow[]) {
      const filed = new Set(row.filed_keys || []);
      const amounts = amountsFromWorkload(row);
      const evidence = {
        hasPayroll: Number(row.employees) > 0,
        hasVatActivity: !!row.has_vat_activity,
        vatRegistered: !!row.vat_registered,
      };

      const recipients = [
        row.recipient,
        ...(row.extra_recipients || []),
      ]
        .map((e) => String(e || "").trim())
        .filter((e) => VALID_EMAIL.test(e));

      for (const obligation of STATUTORY_RETURNS as StatutoryReturn[]) {
        if (filed.has(obligation.key)) continue;
        if (!obligationApplies(obligation, evidence)) continue;

        const due = dueDateFor(obligation, row.period);
        if (!due) continue;

        const fire = reminderDueToday(due.dueDate, asOf);
        if (!fire) continue;

        const bundleKey = `${row.admin_id}|${due.dueDate}`;
        let bundle = bundles.get(bundleKey);
        if (!bundle) {
          bundle = {
            adminId: row.admin_id,
            tenantName: row.tenant_name || "there",
            recipients,
            dueDate: due.dueDate,
            overdue: fire.overdue,
            daysOverdue: fire.daysOverdue,
            daysRemaining: fire.overdue ? -fire.daysOverdue : fire.leadDays,
            leadDays: fire.leadDays,
            returns: [],
          };
          bundles.set(bundleKey, bundle);
        }

        bundle.returns.push({
          returnKey: obligation.key,
          label: obligation.label,
          period: row.period,
          authority: obligation.authority,
          portal: obligation.portal,
          amountLabel: obligation.amountLabel,
          amount: amounts[obligation.amountKey] ?? null,
          dueDate: due.dueDate,
          instrument: due.instrument,
          penalty: due.penalty,
          fallsOnNonWorkingDay: due.fallsOnNonWorkingDay,
          nonWorkingReason: due.nonWorkingReason,
          nextWorkingDay: due.nextWorkingDay,
        });
      }
    }

    summary.bundles = bundles.size;

    // ── Send ────────────────────────────────────────────────────────────────
    //
    // EVERY RETURN IS CLAIMED SEPARATELY, even though they are delivered
    // together. Claiming once per bundle would have to pick one of its returns
    // to log the claim against, and which one that is changes as returns get
    // filed: on the 9th a tenant owes PAYE, NSSF and SHIF; file the PAYE at
    // lunchtime and the next run's bundle starts at NSSF, so the claim key
    // moves and the same deadline is emailed twice. Per-return claims cannot
    // drift, and they let a run that half-failed resend exactly the half that
    // did not go.
    for (const bundle of bundles.values()) {
      // The bell first. It is free, it cannot bounce, and it is the only
      // channel a tenant with no email on file has at all.
      const bellWon = await claimReturns(bundle, "in_app", bundle.adminId);
      if (bellWon.length) {
        await logToBell(
          bundle.adminId,
          bundle.dueDate,
          bundle.overdue,
          bundle.daysOverdue,
          bundle.daysRemaining,
          bellWon.map((w) => String(w.entry.label)),
        );
        summary.bellNotices++;
      } else {
        summary.alreadySent++;
      }

      if (!bundle.recipients.length) {
        summary.noRecipient++;
        continue;
      }

      for (const to of bundle.recipients) {
        const won = await claimReturns(bundle, "email", to);

        // Lost every claim: this deadline has already gone to this address.
        if (!won.length) {
          summary.alreadySent++;
          continue;
        }

        // The email covers exactly what this run claimed — not the whole
        // bundle — so a return already reported to this address is not
        // repeated in it.
        const result = await sendEmail(to, {
          tenantName: bundle.tenantName,
          dueDate: bundle.dueDate,
          daysRemaining: bundle.daysRemaining,
          isOverdue: bundle.overdue,
          daysOverdue: bundle.daysOverdue,
          returns: won.map((w) => w.entry),
          portalUrl: calendarLink,
        });

        if (result.ok) {
          summary.emailsSent++;
        } else {
          // Free every slot this run took, so the next one retries the lot.
          for (const w of won) {
            await releaseReminder(w.logId, result.error || "email delivery failed");
          }
          summary.failed++;
          summary.errors.push(`email failed for tenant ${bundle.adminId} (${bundle.dueDate})`);
        }
      }
    }

    console.log("statutory reminder run complete:", summary);

    return new Response(JSON.stringify({ success: true, asOf, ...summary }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("statutory-return-reminders error:", {
      requestId: api.requestId,
      message: error?.message,
      summary,
    });
    return api.fail(error);
  }
});

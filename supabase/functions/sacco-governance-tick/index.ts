/// <reference lib="deno.ns" />
//
// sacco-governance-tick — the scheduled worker behind auto-close.
//
// Run this every minute (Supabase scheduled function / external cron — the same
// mechanism the other reminder functions use). It:
//   1. calls sacco_governance_run_due(), which advances every DUE election and
//      motion in one transaction and returns the events that just happened;
//   2. emails the affected sacco's active members about each event, reusing the
//      send-email templates.
//
// Correctness does NOT depend on this running on time: the DB refuses late
// ballots/votes on its own (see the *_scheduled_at / voting_end guards). This
// worker only performs the visible status flip and the notifications.
//
// verify_jwt = false (see config.toml) so the scheduler can invoke it with the
// service-role key; sacco_governance_run_due is granted to service_role only.

// @ts-ignore: Deno global is available in the Deno runtime
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Where the member portal lives, for the "open the portal" buttons in emails.
// Falls back to empty (templates simply omit the button when unset).
const PORTAL_URL = Deno.env.get("PORTAL_URL") || "";
const loginUrl = PORTAL_URL ? `${PORTAL_URL.replace(/\/$/, "")}/login` : "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Supabase REST / RPC helpers (service role) ───────────────────────────────

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
  return { data, ok: res.ok };
};

const callRpc = async (fn: string, args: Record<string, unknown> = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(args),
  });
  const data = await res.json().catch(() => null);
  return { data, ok: res.ok };
};

const sendEmail = async (type: string, to: string, data: Record<string, unknown>) => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ type, to, data }),
  });
  return res.ok;
};

// ─── Event → email mapping ────────────────────────────────────────────────────

// Which events notify members, and with which template. Events not listed
// (e.g. an election's nominations_closed) are internal steps — no member email.
const emailTypeFor = (ev: any): string | null => {
  if (ev.kind === "election" && ev.event === "voting_opened") return "sacco_election_voting_open";
  if (ev.kind === "election" && ev.event === "voting_closed") return "sacco_election_voting_closed";
  if (ev.kind === "motion" && ev.event === "motion_closed") return "sacco_motion_closed";
  return null;
};

// Per-event email payload (fullName is added per recipient below).
const emailDataFor = (ev: any, saccoName: string) => {
  const base = { saccoName, portalUrl: loginUrl };
  if (ev.kind === "election") {
    return { ...base, electionTitle: ev.title };
  }
  // motion_closed carries the tally from sacco_motion_close
  return {
    ...base,
    motionTitle: ev.title,
    ballotType: ev.ballot_type,
    status: ev.status,
    yes: ev.yes,
    no: ev.no,
    abstain: ev.abstain,
    quorumMet: ev.quorum_met,
  };
};

// ─── Handler ──────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Advance everything that is due.
    const { data: events, ok } = await callRpc("sacco_governance_run_due");
    if (!ok) {
      throw new Error(typeof events?.message === "string" ? events.message : "run_due failed");
    }
    const list: any[] = Array.isArray(events) ? events : [];

    // 2. Notify members. Cache sacco name + recipient list per sacco.
    const nameCache = new Map<string, string>();
    const recipientCache = new Map<string, { full_name: string; email: string }[]>();

    const getSaccoName = async (saccoId: string): Promise<string> => {
      if (nameCache.has(saccoId)) return nameCache.get(saccoId)!;
      const { data } = await rest(`/saccos?id=eq.${saccoId}&select=name`);
      const name = Array.isArray(data) && data[0]?.name ? data[0].name : "";
      nameCache.set(saccoId, name);
      return name;
    };

    const getRecipients = async (saccoId: string) => {
      if (recipientCache.has(saccoId)) return recipientCache.get(saccoId)!;
      const { data } = await rest(
        `/sacco_members?sacco_id=eq.${saccoId}&status=eq.active&select=full_name,email`,
      );
      const rows = (Array.isArray(data) ? data : []).filter((m: any) => m?.email);
      recipientCache.set(saccoId, rows);
      return rows;
    };

    let emailed = 0;
    let failed = 0;
    const summary: any[] = [];

    for (const ev of list) {
      const type = emailTypeFor(ev);
      if (!type) {
        summary.push({ kind: ev.kind, event: ev.event, id: ev.id, notified: 0 });
        continue;
      }
      const saccoName = await getSaccoName(ev.sacco_id);
      const recipients = await getRecipients(ev.sacco_id);
      const data = emailDataFor(ev, saccoName);
      const results = await Promise.allSettled(
        recipients.map((m) => sendEmail(type, m.email, { fullName: m.full_name, ...data })),
      );
      const sent = results.filter((r) => r.status === "fulfilled" && r.value).length;
      emailed += sent;
      failed += recipients.length - sent;
      summary.push({ kind: ev.kind, event: ev.event, id: ev.id, notified: sent });
    }

    return new Response(
      JSON.stringify({ ok: true, transitions: list.length, emailed, failed, summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

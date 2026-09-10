/**
 * useAdminCrm
 *
 * The administrator's OWN CRM, as opposed to the one they merely watch.
 *
 * useCrmOversight answers "what are my agents doing". This answers "what am I
 * doing with my customers" — and until 20260830180000 the honest answer was
 * "nothing that can be written down". Every write policy on crm_interactions
 * and follow_ups compared against `get_agent_id_for_user(auth.uid())`, which is
 * NULL for an admin, so the admin's own escalation calls, arrears chases and
 * site visits had exactly one place to live: `clients.notes`, a single text
 * column the next edit overwrites. Exactly the hole crm_interactions was built
 * to fill for agents.
 *
 * SCOPE. The admin's book is the tenant's CLIENTS, not its leads. A lead
 * belongs to the agent working it and oversight over those stays read-only —
 * an admin does not edit an agent's lead behind their back. What the admin owns
 * outright is the customer list, plus contacts who are not a row anywhere yet
 * (crm_interactions.contact_name has always allowed a bare name).
 *
 * OWNERSHIP is read off two columns rather than a new one: a row the tenant
 * itself wrote has `agent_id IS NULL` and `admin_id = current_admin_id()`. The
 * write policies key on precisely that shape, so this hook must never send an
 * agent_id — one would be rejected, not silently mis-filed.
 *
 * WHAT IS FETCHED, and why it is wider than what is written:
 *
 *   • clients        — the tenant's own rows (tenant_manage_clients).
 *   • interactions   — every touch in the tenant, the agents' included. A
 *                      customer record that showed only the admin's half of
 *                      the conversation would be worse than none: the admin
 *                      would ring somebody an agent spoke to yesterday.
 *   • follow_ups     — the same, so the diary can show the whole tenant's
 *                      commitments to a customer.
 *
 * Writing is narrow, reading is wide, and `isOwn` marks the difference on
 * every row so the UI can be honest about what it will let you change.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { getTenantAdminId } from '../lib/tenant';
import { useAuth } from '../contexts/AuthContext';
import { useAuthScopedLoader } from './useAuthScopedLoader';
import { logger } from '../utils/logger';
import { outcomeMeta, daysSince } from './useCrmInteractions';
import { CRM_SUPERVISOR_ROLES } from './useCrmOversight';
import { channelMeta, toChannelValue, toFollowUpChannel, CONTACT_CHANNELS } from '../config/crmVocabulary';

const DAY = 86400000;

// Module-level counter, not Date.now(): StrictMode mounts an effect twice and
// both runs can land inside the same millisecond. supabase.channel(name)
// returns the EXISTING channel for a name already in use, and calling .on()
// after that channel has subscribed throws — which the error boundary renders
// as a blank "Something went wrong" page. Same fix as useCrmOversight.
let _adminCrmChannelSeq = 0;

export { CRM_SUPERVISOR_ROLES };

/**
 * How long a customer relationship may go quiet before it is worth flagging.
 *
 * Deliberately NOT the 14 days a LEAD gets (STALE_CONTACT_DAYS). A lead cools
 * in a fortnight because somebody else is selling to them; a customer who has
 * already bought is not in play, and chasing them every other week is a
 * nuisance rather than service. A month is the interval at which "nobody has
 * spoken to this account" starts to mean something.
 */
export const CLIENT_QUIET_DAYS = 30;

/** Rows fetched per table. Deep enough for a year of a busy tenant. */
const ROW_LIMIT = 2000;

/** Clients loaded for the book. Above this the list needs its own paging. */
const CLIENT_LIMIT = 1000;

const CLIENT_COLS = 'id, admin_id, agent_id, account_number, full_name, email, phone, national_id, '
                  + 'address, city, client_status, kyc_status, outstanding_balance, credit_score, '
                  + 'total_assets, notes, created_at, interaction_count, last_contact_at, last_interaction_type';

const TOUCH_COLS  = 'id, agent_id, admin_id, lead_id, client_id, contact_name, interaction_type, direction, '
                  + 'subject, summary, outcome, duration_minutes, occurred_at, next_step, logged_by, created_at';

const FOLLOW_COLS = 'id, agent_id, admin_id, lead_id, client_id, lead_name, appointment_type, scheduled_at, '
                  + 'remind_at, is_completed, completed_at, outcome, location, notes, created_by, created_at';

/** A number that must never arrive as NaN — PostgREST sends DECIMAL as text. */
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const ts = (iso) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * Normalise a date for writing.
 *
 * <input type="datetime-local"> hands back local wall-clock text with no zone
 * ("2026-09-05T10:00"), and Postgres would read that against the SERVER's
 * timezone — booking a 10am appointment for 1pm in Nairobi. The same
 * conversion the agent portal does on the way in.
 */
const toIso = (value) => {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

/** The later of two timestamps, ignoring nulls. */
const laterOf = (a, b) => {
  const ta = ts(a);
  const tb = ts(b);
  if (ta === null) return b || null;
  if (tb === null) return a || null;
  return ta >= tb ? a : b;
};

/** Midnight local, so "today" means the reader's today and not UTC's. */
const startOfDay = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * A row the tenant itself wrote, as opposed to one of its agents.
 *
 * The single definition, because four things depend on getting it right: which
 * records the UI offers an edit button on, which ones the write policies will
 * actually accept, how the reports split "my activity" from "the team's", and
 * which follow-ups belong in the admin's own diary.
 */
export const isTenantOwned = (row) => Boolean(row) && !row.agent_id;

/**
 * Every client, with the CRM facts a person needs before picking up the phone.
 *
 * `last_contact_at` on the client row is maintained by the database trigger and
 * is authoritative — it sees the whole history, while the interactions loaded
 * here are capped at ROW_LIMIT and a long-quiet customer's last touch may well
 * have fallen off the end of that window. But the fetched rows can be NEWER
 * than the column for a few hundred milliseconds after a contact is logged
 * optimistically, so the later of the two wins. Taking either one alone gives a
 * list that is wrong exactly when it matters: too old to trust, or "never
 * contacted" for a customer with years of history.
 */
export const deriveClientBook = ({ clients = [], interactions = [], followUps = [], now = Date.now() } = {}) => {
  const touchesByClient = new Map();
  for (const i of interactions) {
    if (!i?.client_id) continue;
    const list = touchesByClient.get(i.client_id) || [];
    list.push(i);
    touchesByClient.set(i.client_id, list);
  }

  const followsByClient = new Map();
  for (const f of followUps) {
    if (!f?.client_id) continue;
    const list = followsByClient.get(f.client_id) || [];
    list.push(f);
    followsByClient.set(f.client_id, list);
  }

  return clients.map((c) => {
    const touches = (touchesByClient.get(c.id) || [])
      .slice()
      .sort((a, b) => (ts(b.occurred_at) ?? 0) - (ts(a.occurred_at) ?? 0));

    const follows = (followsByClient.get(c.id) || [])
      .slice()
      .sort((a, b) => (ts(a.scheduled_at) ?? 0) - (ts(b.scheduled_at) ?? 0));

    const openFollows  = follows.filter(f => !f.is_completed);
    const nextFollowUp = openFollows[0] || null;

    const lastContactAt = laterOf(c.last_contact_at, touches[0]?.occurred_at || null);
    const quietDays     = daysSince(lastContactAt, now);

    // interaction_count counts the whole history; the fetched slice can only
    // ever be a subset of it, so the larger of the two is the truthful one.
    const touchCount = Math.max(num(c.interaction_count), touches.length);

    return {
      ...c,
      touches,
      followUps: follows,
      openFollowUps: openFollows.length,
      nextFollowUp,
      followUpOverdue: Boolean(nextFollowUp && (ts(nextFollowUp.scheduled_at) ?? Infinity) < now),
      lastTouch: touches[0] || null,
      lastContactAt,
      lastChannel: touches[0]?.interaction_type || c.last_interaction_type || null,
      quietDays,
      touchCount,
      outstanding: num(c.outstanding_balance),
      // Three states rather than a boolean, because "never spoken to" and "went
      // quiet" call for different actions: one is an introduction nobody has
      // made, the other is a relationship being dropped.
      contactState: lastContactAt === null
        ? 'never'
        : (quietDays !== null && quietDays >= CLIENT_QUIET_DAYS ? 'quiet' : 'recent'),
    };
  });
};

/**
 * The diary, split the way a working day is read.
 *
 * Overdue first and oldest-first inside it: the appointment somebody has been
 * failing to keep for a week is more urgent than yesterday's. Everything else
 * runs soonest-first, which is the order it will actually happen in.
 */
export const bucketFollowUps = (followUps = [], now = Date.now()) => {
  const todayStart = startOfDay(now);
  const todayEnd   = todayStart + DAY;
  const weekEnd    = todayStart + 7 * DAY;

  const overdue = [];
  const today = [];
  const thisWeek = [];
  const later = [];
  const completed = [];

  for (const f of followUps) {
    if (!f) continue;
    if (f.is_completed) { completed.push(f); continue; }

    const at = ts(f.scheduled_at);
    // An appointment with no usable date cannot be sorted into a day, and
    // dropping it would lose a commitment. It is treated as needing attention.
    if (at === null)        { overdue.push(f); continue; }
    if (at < now)           { overdue.push(f); continue; }
    if (at < todayEnd)      { today.push(f); continue; }
    if (at < weekEnd)       { thisWeek.push(f); continue; }
    later.push(f);
  }

  const bySoonest = (a, b) => (ts(a.scheduled_at) ?? Infinity) - (ts(b.scheduled_at) ?? Infinity);

  overdue.sort(bySoonest);
  today.sort(bySoonest);
  thisWeek.sort(bySoonest);
  later.sort(bySoonest);
  completed.sort((a, b) => (ts(b.completed_at || b.scheduled_at) ?? 0) - (ts(a.completed_at || a.scheduled_at) ?? 0));

  const open = overdue.length + today.length + thisWeek.length + later.length;
  const settled = open + completed.length;

  return {
    overdue, today, thisWeek, later, completed,
    open,
    // What share of everything booked actually got closed off. A diary nobody
    // ticks is a diary nobody reads, and this is the number that says so.
    completionRate: settled ? Math.round((completed.length / settled) * 100) : null,
  };
};

/** Contacts per day for the last `days` days, oldest first, gaps filled. */
export const dailyActivity = (interactions = [], now = Date.now(), days = 14) => {
  const start = startOfDay(now) - (days - 1) * DAY;
  const counts = new Map();
  for (let d = 0; d < days; d += 1) counts.set(start + d * DAY, 0);

  for (const i of interactions) {
    const at = ts(i?.occurred_at);
    if (at === null) continue;
    const key = startOfDay(at);
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  }

  return Array.from(counts.entries()).map(([t, count]) => ({ date: new Date(t).toISOString(), count }));
};

/** Count rows by a controlled-vocabulary key, biggest first, never dropping unknowns. */
const tally = (rows, key, describe) => {
  const counts = new Map();
  for (const r of rows) {
    const raw = r?.[key] ?? null;
    const meta = describe(raw);
    const id = meta.value ?? '__none__';
    const hit = counts.get(id) || { value: meta.value, label: meta.label, count: 0 };
    hit.count += 1;
    counts.set(id, hit);
  }
  const total = rows.length;
  return Array.from(counts.values())
    .map(r => ({ ...r, share: total ? Math.round((r.count / total) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);
};

/**
 * Everything the reporting view puts on screen, in one pure function.
 *
 * Pure and exported because every figure here is one somebody will act on —
 * "43% of your customers have never been contacted" is a instruction to go and
 * do something — and arithmetic that decides work has to be testable without a
 * database in the room.
 */
export const summariseAdminCrm = ({ book = [], interactions = [], followUps = [], now = Date.now() } = {}) => {
  const weekAgo  = now - 7 * DAY;
  const monthAgo = now - 30 * DAY;

  // ── Coverage: the customer list, seen as relationships rather than records ──
  const never  = book.filter(c => c.contactState === 'never');
  const quiet  = book.filter(c => c.contactState === 'quiet');
  const recent = book.filter(c => c.contactState === 'recent');
  const active = book.filter(c => c.client_status === 'active');

  // ── Activity ──
  const own  = interactions.filter(isTenantOwned);
  const team = interactions.filter(i => !isTenantOwned(i));

  const inWindow = (rows, from) => rows.filter(i => (ts(i?.occurred_at) ?? 0) >= from);

  const rated = interactions.filter(i => outcomeMeta(i?.outcome));
  const positive = rated.filter(i => outcomeMeta(i.outcome)?.sentiment === 'positive');

  const diary = bucketFollowUps(followUps, now);

  return {
    clients: {
      total: book.length,
      active: active.length,
      never: never.length,
      quiet: quiet.length,
      recent: recent.length,
      // The share of the customer base somebody has spoken to inside the quiet
      // window. This is the headline number of an admin's CRM: not how many
      // calls were made, but how much of the book they actually reached.
      coverageRate: book.length ? Math.round((recent.length / book.length) * 100) : null,
      withOpenBalance: book.filter(c => c.outstanding > 0).length,
      // Quiet customers who owe money, worst first — the list where "nobody has
      // called them" and "they have not paid" are the same problem.
      quietWithBalance: quiet
        .filter(c => c.outstanding > 0)
        .sort((a, b) => b.outstanding - a.outstanding),
    },
    activity: {
      total: interactions.length,
      thisWeek: inWindow(interactions, weekAgo).length,
      thisMonth: inWindow(interactions, monthAgo).length,
      // Split so the admin can see whether the contact is theirs or the
      // team's. A tenant where the admin logs everything and the agents log
      // nothing is a different problem from a quiet month.
      ownTotal: own.length,
      ownThisWeek: inWindow(own, weekAgo).length,
      teamTotal: team.length,
      teamThisWeek: inWindow(team, weekAgo).length,
      byChannel: tally(interactions, 'interaction_type', channelMeta),
      byOutcome: tally(interactions, 'outcome', v => (outcomeMeta(v) || { value: null, label: 'Not recorded' })),
      inbound: interactions.filter(i => i?.direction === 'inbound').length,
      outbound: interactions.filter(i => i?.direction !== 'inbound').length,
      positiveRate: rated.length ? Math.round((positive.length / rated.length) * 100) : null,
      daily: dailyActivity(interactions, now),
    },
    diary: {
      open: diary.open,
      overdue: diary.overdue.length,
      today: diary.today.length,
      thisWeek: diary.thisWeek.length,
      completed: diary.completed.length,
      completionRate: diary.completionRate,
    },
  };
};

/**
 * The client book as export rows.
 *
 * Flat, labelled and already formatted: a CSV that needs a lookup table to read
 * is a CSV nobody opens twice.
 */
export const buildClientCrmExport = (book = []) => book.map(c => ({
  'Account': c.account_number || '',
  'Client': c.full_name || '',
  'Phone': c.phone || '',
  'Email': c.email || '',
  'Status': c.client_status || '',
  'Outstanding (KES)': c.outstanding,
  'Contacts logged': c.touchCount,
  'Last contact': c.lastContactAt ? new Date(c.lastContactAt).toISOString().slice(0, 10) : 'never',
  'Last channel': c.lastChannel ? channelMeta(c.lastChannel).label : '',
  'Days quiet': c.quietDays === null ? '' : c.quietDays,
  'Relationship': c.contactState,
  'Next follow-up': c.nextFollowUp?.scheduled_at
    ? new Date(c.nextFollowUp.scheduled_at).toISOString().slice(0, 16).replace('T', ' ')
    : '',
}));

/** The communication log as export rows. */
export const buildActivityExport = (interactions = [], nameFor = () => '') => interactions.map(i => ({
  'When': i.occurred_at ? new Date(i.occurred_at).toISOString().slice(0, 16).replace('T', ' ') : '',
  'Contact': i.contact_name || nameFor(i) || '',
  'Channel': channelMeta(i.interaction_type).label,
  'Direction': i.direction === 'inbound' ? 'They contacted us' : 'We reached out',
  'Outcome': outcomeMeta(i.outcome)?.label || '',
  'Minutes': i.duration_minutes ?? '',
  'Summary': i.summary || '',
  'Next step': i.next_step || '',
  'Logged by': isTenantOwned(i) ? 'Office' : 'Agent',
}));

export const useAdminCrm = () => {
  const { userProfile, user } = useAuth();
  const role = userProfile?.role || null;
  const canView = CRM_SUPERVISOR_ROLES.includes(role);

  const [clients, setClients]           = useState([]);
  const [interactions, setInteractions] = useState([]);
  const [followUps, setFollowUps]       = useState([]);
  const [adminId, setAdminId]           = useState(null);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState(null);
  const channelsRef = useRef([]);

  const reset = useCallback(() => {
    setClients([]); setInteractions([]); setFollowUps([]);
    setAdminId(null); setError(null); setLoading(true);
  }, []);

  const fetchAll = useCallback(async () => {
    if (!canView) { setLoading(false); return; }
    setLoading(true);
    try {
      const tenant = await getTenantAdminId();
      setAdminId(tenant);

      // Filtering by admin_id is a NARROWING of what RLS already allows, never
      // a widening: the supervisor policies decide which rows may be returned
      // at all, and a tampered filter can only ever ask for less.
      const [clientRes, touchRes, followRes] = await Promise.all([
        supabase.from('clients').select(CLIENT_COLS)
          .eq('admin_id', tenant).order('full_name').limit(CLIENT_LIMIT),
        supabase.from('crm_interactions').select(TOUCH_COLS)
          .eq('admin_id', tenant).order('occurred_at', { ascending: false }).limit(ROW_LIMIT),
        supabase.from('follow_ups').select(FOLLOW_COLS)
          .eq('admin_id', tenant).order('scheduled_at', { ascending: false }).limit(ROW_LIMIT),
      ]);

      if (clientRes.error) throw clientRes.error;
      setClients(clientRes.data || []);
      setInteractions(touchRes.data || []);
      setFollowUps(followRes.data || []);

      // On a database where 20260830180000 has not run, these queries fail
      // rather than return nothing — follow_ups has no admin_id column to
      // filter on. Say so once, instead of rendering a confident empty CRM.
      const firstErr = touchRes.error || followRes.error;
      setError(firstErr
        ? `Some CRM records could not be loaded: ${firstErr.message || 'the request was rejected'}`
        : null);
    } catch (err) {
      logger.error('[useAdminCrm] load failed', { message: err?.message });
      setError(err?.message ? `Could not load your CRM: ${err.message}` : 'Could not load your CRM.');
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useAuthScopedLoader(fetchAll, reset);

  // A contact logged on a phone should appear on the laptop, and an
  // appointment a manager ticks off should leave the admin's diary without a
  // refresh. No filter: the subscription is tenant-wide by definition and RLS
  // decides which rows the payload may carry.
  useEffect(() => {
    if (!canView) return undefined;
    const channel = supabase
      .channel(`admin_crm_${++_adminCrmChannelSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_interactions' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'follow_ups' },       () => fetchAll())
      .subscribe();
    channelsRef.current = [channel];
    return () => { supabase.removeChannel(channel); channelsRef.current = []; };
  }, [canView, fetchAll]);

  // ── Writes ───────────────────────────────────────────────────────────────
  //
  // agent_id is never sent. The supervisor write policies require it to be
  // NULL, and admin_id is stamped from the session by the trigger — so neither
  // ownership column is the caller's to choose, which is the point.

  /**
   * Record a contact that has already happened, and optionally book the next
   * one in the same breath.
   *
   * The follow-up is inserted second and its failure is reported without
   * losing the contact: a written-down conversation is worth keeping even if
   * the diary entry did not land, and the alternative — rolling the contact
   * back — throws away the part the person actually typed.
   */
  const logContact = useCallback(async (input) => {
    setSaving(true);
    try {
      const payload = {
        agent_id:         null,
        lead_id:          input?.leadId   || null,
        client_id:        input?.clientId || null,
        contact_name:     input?.contactName?.trim() || null,
        interaction_type: toChannelValue(input?.type, 'call'),
        direction:        input?.direction === 'inbound' ? 'inbound' : 'outbound',
        subject:          input?.subject?.trim() || null,
        summary:          input?.summary?.trim() || null,
        outcome:          input?.outcome || null,
        duration_minutes: input?.durationMinutes ? Number(input.durationMinutes) : null,
        occurred_at:      toIso(input?.occurredAt) || new Date().toISOString(),
        next_step:        input?.nextStep?.trim() || null,
      };

      const { data, error: err } = await supabase
        .from('crm_interactions').insert(payload).select(TOUCH_COLS).single();
      if (err) throw err;

      setInteractions(prev => [data, ...prev]);

      let followUpError = null;
      if (input?.followUp?.scheduledAt) {
        const { error: fErr } = await supabase.from('follow_ups').insert({
          agent_id:         null,
          lead_id:          payload.lead_id,
          client_id:        payload.client_id,
          lead_name:        payload.contact_name,
          appointment_type: toFollowUpChannel(input.followUp.channel ?? payload.interaction_type),
          scheduled_at:     toIso(input.followUp.scheduledAt),
          remind_at:        toIso(input.followUp.remindAt),
          location:         input.followUp.location?.trim() || null,
          notes:            input.followUp.notes?.trim() || payload.next_step,
          source_interaction_id: data.id,
        });
        if (fErr) followUpError = fErr.message || 'The contact was saved but the follow-up was not.';
      }

      await fetchAll();

      // The contact landed, so this call SUCCEEDED — returning an error would
      // hold the form open on a write that already happened, and the obvious
      // next move (press save again) would duplicate the contact. The diary
      // half is reported through the banner instead: visible, and not in the
      // way. Set after fetchAll, which writes its own error state.
      if (followUpError) {
        setError(`The contact was saved, but the follow-up was not booked: ${followUpError}`);
      }
      return { data };
    } catch (err) {
      logger.error('[useAdminCrm] logContact failed', { message: err?.message });
      return { error: err?.message || 'Could not save that contact.' };
    } finally {
      setSaving(false);
    }
  }, [fetchAll]);

  const scheduleFollowUp = useCallback(async (input) => {
    setSaving(true);
    try {
      const scheduledAt = toIso(input?.scheduledAt);
      if (!scheduledAt) throw new Error('Pick a date and time for the appointment.');
      const { data, error: err } = await supabase.from('follow_ups').insert({
        agent_id:         null,
        lead_id:          input.leadId   || null,
        client_id:        input.clientId || null,
        lead_name:        input.contactName?.trim() || input.leadName?.trim() || null,
        appointment_type: toFollowUpChannel(input.channel ?? input.appointmentType),
        scheduled_at:     scheduledAt,
        remind_at:        toIso(input.remindAt),
        location:         input.location?.trim() || null,
        notes:            input.notes?.trim() || null,
        source_interaction_id: input.sourceInteractionId || null,
      }).select(FOLLOW_COLS).single();
      if (err) throw err;

      setFollowUps(prev => [data, ...prev]);
      return { data };
    } catch (err) {
      logger.error('[useAdminCrm] scheduleFollowUp failed', { message: err?.message });
      return { error: err?.message || 'Could not book that follow-up.' };
    } finally {
      setSaving(false);
    }
  }, []);

  const updateFollowUp = useCallback(async (id, patch) => {
    try {
      const { data, error: err } = await supabase
        .from('follow_ups').update(patch).eq('id', id).select(FOLLOW_COLS).single();
      if (err) throw err;
      setFollowUps(prev => prev.map(f => (f.id === id ? data : f)));
      return { data };
    } catch (err) {
      logger.error('[useAdminCrm] updateFollowUp failed', { message: err?.message });
      return { error: err?.message || 'Could not update that appointment.' };
    }
  }, []);

  /**
   * Tick off an appointment, recording what came of it.
   *
   * completed_at is left to the database: follow_ups_normalize already stamps
   * it from is_completed, and a second opinion from the browser clock is how
   * two timestamps end up disagreeing.
   */
  const completeFollowUp = useCallback(
    (id, outcome = null) => updateFollowUp(id, { is_completed: true, outcome: outcome || null }),
    [updateFollowUp],
  );

  // The database clears reminder_sent_at when scheduled_at moves, so a pushed
  // appointment gets a fresh reminder rather than staying silent.
  const rescheduleFollowUp = useCallback(
    (id, scheduledAt) => {
      const when = toIso(scheduledAt);
      if (!when) return Promise.resolve({ error: 'That is not a usable date.' });
      return updateFollowUp(id, { scheduled_at: when, is_completed: false });
    },
    [updateFollowUp],
  );

  const deleteFollowUp = useCallback(async (id) => {
    try {
      const { error: err } = await supabase.from('follow_ups').delete().eq('id', id);
      if (err) throw err;
      setFollowUps(prev => prev.filter(f => f.id !== id));
      return {};
    } catch (err) {
      logger.error('[useAdminCrm] deleteFollowUp failed', { message: err?.message });
      return { error: err?.message || 'Could not remove that appointment.' };
    }
  }, []);

  const updateInteraction = useCallback(async (id, patch) => {
    try {
      const { data, error: err } = await supabase
        .from('crm_interactions').update(patch).eq('id', id).select(TOUCH_COLS).single();
      if (err) throw err;
      setInteractions(prev => prev.map(i => (i.id === id ? data : i)));
      return { data };
    } catch (err) {
      logger.error('[useAdminCrm] updateInteraction failed', { message: err?.message });
      return { error: err?.message || 'Could not update that entry.' };
    }
  }, []);

  const deleteInteraction = useCallback(async (id) => {
    try {
      const { error: err } = await supabase.from('crm_interactions').delete().eq('id', id);
      if (err) throw err;
      setInteractions(prev => prev.filter(i => i.id !== id));
      // The client's counters are recomputed by trigger, so the book is stale
      // until it is re-read.
      await fetchAll();
      return {};
    } catch (err) {
      logger.error('[useAdminCrm] deleteInteraction failed', { message: err?.message });
      return { error: err?.message || 'Could not remove that entry.' };
    }
  }, [fetchAll]);

  /**
   * The standing note on a customer — what they are like to deal with, not
   * what was said on one call. Kept separate from the timeline on purpose:
   * conflating the two is what made clients.notes useless in the first place.
   */
  const saveClientNote = useCallback(async (clientId, notes) => {
    try {
      const { data, error: err } = await supabase
        .from('clients').update({ notes }).eq('id', clientId).select(CLIENT_COLS).single();
      if (err) throw err;
      setClients(prev => prev.map(c => (c.id === clientId ? data : c)));
      return { data };
    } catch (err) {
      logger.error('[useAdminCrm] saveClientNote failed', { message: err?.message });
      return { error: err?.message || 'Could not save that note.' };
    }
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────

  const book    = useMemo(() => deriveClientBook({ clients, interactions, followUps }), [clients, interactions, followUps]);
  const summary = useMemo(() => summariseAdminCrm({ book, interactions, followUps }), [book, interactions, followUps]);

  /** The tenant's own diary: appointments the office booked, not the agents'. */
  const ownFollowUps = useMemo(() => followUps.filter(isTenantOwned), [followUps]);
  const diary        = useMemo(() => bucketFollowUps(ownFollowUps), [ownFollowUps]);
  /** Every open appointment in the tenant, agents included — the read-wide half. */
  const teamDiary    = useMemo(() => bucketFollowUps(followUps), [followUps]);

  /** Name resolution for rows that point at a client but carry no label. */
  const clientName = useCallback((row) => {
    if (!row?.client_id) return row?.contact_name || row?.lead_name || '';
    return clients.find(c => c.id === row.client_id)?.full_name || row?.contact_name || row?.lead_name || '';
  }, [clients]);

  return {
    canView,
    adminId,
    userId: user?.id || null,
    clients,
    book,
    interactions,
    followUps,
    ownFollowUps,
    diary,
    teamDiary,
    summary,
    loading,
    saving,
    error,
    clientName,
    logContact,
    scheduleFollowUp,
    updateFollowUp,
    completeFollowUp,
    rescheduleFollowUp,
    deleteFollowUp,
    updateInteraction,
    deleteInteraction,
    saveClientNote,
    refetch: fetchAll,
    channels: CONTACT_CHANNELS,
  };
};

export default useAdminCrm;

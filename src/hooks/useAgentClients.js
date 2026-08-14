/**
 * useAgentClients
 *
 * The client book a sales agent works from: every account they registered, and
 * whether that account is still paying. "My Clients" used to be a list of
 * converted leads — it could tell an agent who they signed, never whether the
 * signature was still worth anything.
 *
 * What "still paying" means depends on what the agent registers:
 *
 *   • company mode — the agent registers admin/company (and sacco) accounts,
 *     each of which gets a company_subscriptions row keyed on admin_id. That is
 *     a real subscription: a period with an end_date, renewed by a later row.
 *     Buckets are expired / expiring / active / never activated.
 *
 *   • client mode  — the agent registers clients for one admin's tenant. There
 *     is no subscription anywhere in the schema for a client, so the equivalent
 *     lapse signals are used instead: client_status, kyc_status and any
 *     outstanding balance. Buckets are lapsed / needs attention / active.
 *
 * Sacco-mode agents keep the plain converted-lead list — they were left out of
 * this deliberately.
 *
 * Linking an account back to the agent who sold it:
 *   • clients carry agent_id (set by CreateClientModal) — a direct link.
 *   • companies do not, so ids come from leads.converted_ref_id plus the
 *     audit_logs 'user_created' rows the create modals write. Registrations made
 *     without a lead only appear through the audit trail, which is why both
 *     sources are unioned rather than one being preferred.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { logger } from '../utils/logger';

const DAY = 86400000;

/** A subscription this close to its end_date is worth a phone call. */
export const EXPIRING_WINDOW_DAYS = 30;
/** Inside this window it is urgent rather than merely upcoming. */
export const CRITICAL_WINDOW_DAYS = 7;

const SUBSCRIPTION_COLUMNS =
  'id, admin_id, plan_name, status, price_paid, max_users, start_date, end_date, created_at';
const CLIENT_COLUMNS =
  'id, account_number, full_name, email, phone, client_status, kyc_status, outstanding_balance, created_at';

// Ordered most-urgent-first: the filter tabs and the default sort both read it.
export const BUCKET_ORDER = ['expired', 'expiring', 'pending', 'attention', 'active', 'unknown'];

export const BUCKET_META = {
  expired:   { label: 'Expired',         tone: 'red'     },
  expiring:  { label: 'Expiring soon',   tone: 'amber'   },
  pending:   { label: 'Never activated', tone: 'slate'   },
  attention: { label: 'Needs attention', tone: 'amber'   },
  active:    { label: 'Active',          tone: 'emerald' },
  unknown:   { label: 'Unknown',         tone: 'slate'   },
};

/** Whole days from now until `date`. Negative once the date has passed. */
export const daysUntil = (date, now = Date.now()) => {
  if (!date) return null;
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - now) / DAY);
};

const plural = (n, word) => `${n} ${word}${Math.abs(n) === 1 ? '' : 's'}`;

/**
 * Reduce an account's subscription history to its current standing.
 * `rows` must be every company_subscriptions row for one admin_id.
 */
export const deriveSubscription = (rows = [], now = Date.now()) => {
  // Newest period first. created_at is the tiebreak because a scheduled seat
  // change writes the next period's row with start_date === the old end_date.
  const sorted = [...rows].sort((a, b) => {
    const byEnd = new Date(b.end_date || 0) - new Date(a.end_date || 0);
    return byEnd !== 0 ? byEnd : new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });

  const current = sorted[0] || null;
  // Every period that actually went live. The first one is the original
  // subscription, so anything beyond it is a renewal.
  const paidPeriods = sorted.filter(r => r.status === 'active').length;
  const renewals = Math.max(0, paidPeriods - 1);

  if (!current) {
    return {
      bucket: 'pending', statusLabel: 'Never subscribed', daysRemaining: null,
      current: null, history: sorted, renewals: 0, everPaid: false,
    };
  }

  const days = daysUntil(current.end_date, now);
  const base = { current, history: sorted, renewals, everPaid: paidPeriods > 0, daysRemaining: days };

  // A pending row is an account that was provisioned but never paid for — the
  // dates on it are a placeholder period, so they must not read as "active".
  if (current.status === 'pending') {
    return { ...base, bucket: 'pending', statusLabel: paidPeriods > 0 ? 'Renewal unpaid' : 'Never activated' };
  }
  if (current.status === 'cancelled' || current.status === 'canceled') {
    return { ...base, bucket: 'expired', statusLabel: 'Cancelled' };
  }
  if (days === null) {
    return { ...base, bucket: 'unknown', statusLabel: 'No end date on record' };
  }
  if (days < 0) {
    return { ...base, bucket: 'expired', statusLabel: `Expired ${plural(Math.abs(days), 'day')} ago` };
  }
  if (days <= EXPIRING_WINDOW_DAYS) {
    return {
      ...base,
      bucket: 'expiring',
      statusLabel: days === 0 ? 'Expires today' : `Expires in ${plural(days, 'day')}`,
    };
  }
  return { ...base, bucket: 'active', statusLabel: `Active · ${plural(days, 'day')} left` };
};

/**
 * Client-mode equivalent. Clients have no subscription, so standing comes from
 * the fields that do lapse: account status, KYC, and money owed.
 */
export const deriveClientStanding = (client = {}) => {
  const status  = String(client.client_status || '').toLowerCase();
  const kyc     = String(client.kyc_status || '').toLowerCase();
  const balance = Number(client.outstanding_balance || 0);

  if (status === 'suspended') return { bucket: 'expired',   statusLabel: 'Suspended' };
  if (status === 'inactive')  return { bucket: 'expired',   statusLabel: 'Inactive' };
  if (status === 'pending')   return { bucket: 'pending',   statusLabel: 'Awaiting activation' };
  if (balance > 0) {
    return {
      bucket: 'attention',
      statusLabel: `Owes KES ${balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
    };
  }
  if (kyc && kyc !== 'verified') {
    return { bucket: 'attention', statusLabel: kyc === 'under_review' ? 'KYC under review' : 'KYC not verified' };
  }
  return { bucket: 'active', statusLabel: 'Active' };
};

/** Supabase `.in()` has a practical URL length limit — page through the ids. */
const CHUNK = 100;
const chunked = (list) => {
  const out = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
};

const uniq = (list) => [...new Set(list.filter(Boolean))];

// Thrown when a column or table is missing in this environment rather than the
// query being wrong — worth reporting differently from a genuine failure.
const isMissingSchema = (err) =>
  !!err && (err.code === '42703' || err.code === 'PGRST204' || err.code === '42P01');

export const useAgentClients = (agentProfile, agentMode, leads = []) => {
  const agentId = agentProfile?.id || null;
  const authUserId = agentProfile?.user_id || null;

  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  // Set when the accounts were found but their subscription rows were not
  // readable — an RLS gap looks exactly like "nobody has subscribed", and the
  // agent must not be told the second when it is the first.
  const [subscriptionsBlocked, setSubscriptionsBlocked] = useState(false);

  const tracksSubscriptions = agentMode === 'company';
  const tracksStanding      = agentMode === 'client';
  const enabled             = tracksSubscriptions || tracksStanding;

  // Converted leads, indexed so a row can be traced back to the lead that
  // produced it (the follow-up modal prefills from it).
  const leadByRef = useMemo(() => {
    const map = new Map();
    (leads || []).forEach((l) => { if (l?.converted_ref_id) map.set(l.converted_ref_id, l); });
    return map;
  }, [leads]);

  /**
   * The company/sacco accounts this agent registered, with whatever naming the
   * agent can see without help. An agent cannot necessarily read another
   * tenant's user_profiles or company_profiles, so the create modals' own audit
   * entries — which the agent always owns — carry the fallback name, email and
   * phone. Without this a directly-registered account renders as "Unnamed".
   */
  const fetchCompanyAccounts = useCallback(async () => {
    const hints = new Map();
    const note = (id, hint) => {
      if (!id) return;
      hints.set(id, { ...(hints.get(id) || {}), ...hint });
    };

    (leads || [])
      .filter(l => ['company', 'sacco'].includes(l?.converted_entity))
      .forEach(l => note(l.converted_ref_id, {
        name: l.full_name, email: l.email, phone: l.phone, entity: l.converted_entity,
      }));

    // Registrations made straight from the portal never touch a lead, so the
    // audit trail is the only record that they were this agent's work.
    if (authUserId) {
      const { data, error: err } = await supabase
        .from('audit_logs')
        .select('record_id, table_name, new_values')
        .eq('user_id', authUserId)
        .eq('action', 'user_created')
        .in('table_name', ['company_profiles', 'saccos'])
        .limit(500);

      if (err) logger.warn('[useAgentClients] audit lookup failed', { message: err.message });
      else (data || []).forEach((row) => {
        const meta = row.new_values && typeof row.new_values === 'object' ? row.new_values : {};
        note(row.record_id, {
          // A lead-sourced name is the better one, so only fill what is missing.
          auditName:  meta.company_name || meta.sacco_name || null,
          auditEmail: meta.email || null,
          auditPhone: meta.phone || null,
          entity:     row.table_name === 'saccos' ? 'sacco' : 'company',
        });
      });
    }

    return hints;
  }, [leads, authUserId]);

  const fetchCompanyRows = useCallback(async () => {
    const hints = await fetchCompanyAccounts();
    const ids = uniq([...hints.keys()]);
    if (ids.length === 0) return { rows: [], blocked: false };

    // Names and contact details for the admin behind each account.
    const profiles = new Map();
    for (const part of chunked(ids)) {
      const { data } = await supabase
        .from('user_profiles')
        .select('id, full_name, email, phone, is_active')
        .in('id', part);
      (data || []).forEach(p => profiles.set(p.id, p));
    }

    // Company name, when the account is a company rather than a sacco.
    const companies = new Map();
    for (const part of chunked(ids)) {
      const { data } = await supabase
        .from('company_profiles')
        .select('admin_id, company_name, phone, email, city')
        .in('admin_id', part);
      (data || []).forEach(c => companies.set(c.admin_id, c));
    }

    // The subscriptions themselves — the reason this hook exists.
    const subsByAdmin = new Map();
    let blocked = false;
    for (const part of chunked(ids)) {
      const { data, error: err } = await supabase
        .from('company_subscriptions')
        .select(SUBSCRIPTION_COLUMNS)
        .in('admin_id', part);
      if (err) {
        blocked = true;
        logger.warn('[useAgentClients] subscription read failed', { message: err.message });
        continue;
      }
      (data || []).forEach((s) => {
        if (!subsByAdmin.has(s.admin_id)) subsByAdmin.set(s.admin_id, []);
        subsByAdmin.get(s.admin_id).push(s);
      });
    }

    const built = ids.map((id) => {
      const profile = profiles.get(id) || {};
      const company = companies.get(id) || {};
      const hint    = hints.get(id) || {};
      const lead    = leadByRef.get(id) || null;
      const subs    = subsByAdmin.get(id) || [];

      // With no readable subscription rows, "never subscribed" would be a guess.
      const derived = blocked && subs.length === 0
        ? { bucket: 'unknown', statusLabel: 'Subscription not visible', daysRemaining: null,
            current: null, history: [], renewals: 0, everPaid: false }
        : deriveSubscription(subs);

      return {
        id,
        kind:        hint.entity || 'company',
        // Company name first — it is what the agent sold to and what they will
        // search for. The audit hint covers accounts in tenants whose
        // company_profiles / user_profiles rows RLS keeps out of reach.
        name:        company.company_name || hint.auditName || profile.full_name || hint.name || 'Unnamed account',
        contactName: profile.full_name || hint.name || null,
        email:       profile.email || company.email || hint.email || hint.auditEmail || null,
        phone:       profile.phone || company.phone || hint.phone || hint.auditPhone || null,
        registeredAt: lead?.converted_at || derived.history?.[derived.history.length - 1]?.created_at || null,
        lead,
        planName:    derived.current?.plan_name || null,
        price:       derived.current?.price_paid != null ? Number(derived.current.price_paid) : null,
        seats:       derived.current?.max_users ?? null,
        startDate:   derived.current?.start_date || null,
        endDate:     derived.current?.end_date || null,
        ...derived,
      };
    });

    return { rows: built, blocked };
  }, [fetchCompanyAccounts, leadByRef]);

  const fetchClientRows = useCallback(async () => {
    let clients = [];

    // agent_id is the direct link. It is in safeKeys on the create form, which
    // means environments that lack the column silently drop it — fall back to
    // created_by there rather than showing an empty book.
    if (agentId) {
      const { data, error: err } = await supabase
        .from('clients')
        .select(CLIENT_COLUMNS)
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })
        .limit(500);
      if (err && !isMissingSchema(err)) throw err;
      clients = data || [];
    }

    if (clients.length === 0 && authUserId) {
      const { data, error: err } = await supabase
        .from('clients')
        .select(CLIENT_COLUMNS)
        .eq('created_by', authUserId)
        .order('created_at', { ascending: false })
        .limit(500);
      if (err && !isMissingSchema(err)) throw err;
      clients = data || [];
    }

    // Anything converted from a lead but registered before agent_id existed.
    const seen = new Set(clients.map(c => c.id));
    const missing = (leads || [])
      .filter(l => l?.converted_entity === 'client' && l.converted_ref_id && !seen.has(l.converted_ref_id))
      .map(l => l.converted_ref_id);

    for (const part of chunked(uniq(missing))) {
      const { data } = await supabase.from('clients').select(CLIENT_COLUMNS).in('id', part);
      (data || []).forEach((c) => { if (!seen.has(c.id)) { seen.add(c.id); clients.push(c); } });
    }

    return clients.map((c) => {
      const lead = leadByRef.get(c.id) || null;
      return {
        id:          c.id,
        kind:        'client',
        name:        c.full_name || lead?.full_name || 'Unnamed client',
        contactName: c.full_name || null,
        email:       c.email || lead?.email || null,
        phone:       c.phone || lead?.phone || null,
        accountNumber: c.account_number || null,
        registeredAt: c.created_at || lead?.converted_at || null,
        lead,
        outstanding: Number(c.outstanding_balance || 0),
        kycStatus:   c.kyc_status || null,
        clientStatus: c.client_status || null,
        planName: null, price: null, seats: null,
        startDate: null, endDate: null, daysRemaining: null,
        current: null, history: [], renewals: 0, everPaid: null,
        ...deriveClientStanding(c),
      };
    });
  }, [agentId, authUserId, leads, leadByRef]);

  const load = useCallback(async () => {
    if (!enabled || !agentProfile) { setRows([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      if (tracksSubscriptions) {
        const { rows: built, blocked } = await fetchCompanyRows();
        setRows(built);
        setSubscriptionsBlocked(blocked);
      } else {
        setRows(await fetchClientRows());
        setSubscriptionsBlocked(false);
      }
    } catch (err) {
      logger.error('[useAgentClients] load failed', { message: err?.message });
      setError(err?.message || 'Could not load your client list.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, agentProfile, tracksSubscriptions, fetchCompanyRows, fetchClientRows]);

  useEffect(() => { load(); }, [load]);

  // Counts drive the filter chips, so every bucket present gets one.
  const counts = useMemo(() => {
    const acc = { all: rows.length };
    BUCKET_ORDER.forEach((b) => { acc[b] = 0; });
    rows.forEach((r) => { acc[r.bucket] = (acc[r.bucket] || 0) + 1; });
    return acc;
  }, [rows]);

  // Whoever lapses soonest comes first; expired before expiring, and inside a
  // bucket the nearest date wins. Rows with no date sort last.
  const sorted = useMemo(() => {
    const rank = (b) => {
      const i = BUCKET_ORDER.indexOf(b);
      return i === -1 ? BUCKET_ORDER.length : i;
    };
    return [...rows].sort((a, b) => {
      const byBucket = rank(a.bucket) - rank(b.bucket);
      if (byBucket !== 0) return byBucket;
      const ad = a.daysRemaining, bd = b.daysRemaining;
      if (ad == null && bd == null) return (a.name || '').localeCompare(b.name || '');
      if (ad == null) return 1;
      if (bd == null) return -1;
      return ad - bd;
    });
  }, [rows]);

  const needsFollowUp = useMemo(
    () => sorted.filter(r => ['expired', 'expiring', 'pending', 'attention'].includes(r.bucket)),
    [sorted]
  );

  return {
    clients: sorted,
    counts,
    needsFollowUp,
    loading,
    error,
    subscriptionsBlocked,
    tracksSubscriptions,
    tracksStanding,
    enabled,
    refetch: load,
  };
};

export default useAgentClients;

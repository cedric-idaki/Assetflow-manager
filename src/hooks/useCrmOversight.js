/**
 * useCrmOversight
 *
 * The supervisor's half of the CRM: what every sales agent in the tenant is
 * doing with their pipeline, and whether anybody is actually being called back.
 *
 * Until 20260820120000 an admin could not read this at all. Every policy on
 * `leads` and `follow_ups` was `agent_id = get_agent_id_for_user(auth.uid())`,
 * so an admin querying leads got zero rows — not an error, not a permission
 * message, just an empty list that looked like a company with no leads. The
 * migration adds read-only supervisor policies; this hook is what asks.
 *
 * Scope follows the caller, never a prop, and is the SAME RULE for everyone:
 * you see the agents whose admin_id is you.
 *
 *   • super_admin              → the agents it created (the platform sales
 *                                force that registers companies and saccos)
 *   • admin / director /
 *     manager / sacco_admin    → their own tenant's agents
 *
 * A super_admin is NOT a global auditor here. It runs its own sales force, and
 * an admin's agents belong to that admin — their customer conversations are not
 * the platform owner's to read. See 20260820140000, which removed the
 * is_global_viewer() branch that used to mix the two books together.
 *
 * Enforced server-side by the supervisor policies. The client-side filter below
 * is a narrowing of what RLS already allows, so a tampered request can only
 * ever ask for less, never more.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { getTenantAdminId } from '../lib/tenant';
import { useAuth } from '../contexts/AuthContext';
import { useAuthScopedLoader } from './useAuthScopedLoader';
import { logger } from '../utils/logger';
import { outcomeMeta, daysSince, STALE_CONTACT_DAYS } from './useCrmInteractions';

const DAY = 86400000;

// Module-level counter, not Date.now(): React StrictMode mounts an effect twice,
// and both runs can land inside the same millisecond. supabase.channel(name)
// RETURNS AN EXISTING channel for a name already in use, so the second run got
// the first run's already-subscribed channel and .on() threw
// "cannot add `postgres_changes` callbacks ... after `subscribe()`", which the
// error boundary rendered as a blank "Something went wrong" page. Same fix and
// same reasoning as AgentActivityTrail.
let _crmOversightChannelSeq = 0;

/** Roles the supervisor policies admit. Mirrors public.is_crm_supervisor(). */
export const CRM_SUPERVISOR_ROLES = ['super_admin', 'admin', 'director', 'manager', 'sacco_admin'];

/** Pipeline order, left to right, matching the agent portal's board. */
export const PIPELINE_STAGES = [
  { value: 'new_lead',      label: 'New',           tone: 'slate'   },
  { value: 'contacted',     label: 'Contacted',     tone: 'blue'    },
  { value: 'qualified',     label: 'Qualified',     tone: 'violet'  },
  { value: 'proposal_sent', label: 'Proposal sent', tone: 'amber'   },
  { value: 'closed',        label: 'Closed',        tone: 'emerald' },
];

/** Rows fetched per table. Deep enough for a quarter, shallow enough to load. */
const ROW_LIMIT = 2000;

const isFresh = (iso, now, days) => {
  const d = daysSince(iso, now);
  return d !== null && d <= days;
};

/**
 * Count a set of leads by pipeline stage, plus the two derived numbers a
 * supervisor actually reads: how many are open, and what share converted.
 *
 * Conversion is measured against leads that have REACHED AN ENDING — closed or
 * converted — not against every lead ever created, because a pipeline full of
 * fresh leads would otherwise read as a collapsing conversion rate.
 */
export const summarisePipeline = (leads = []) => {
  const byStage = {};
  for (const s of PIPELINE_STAGES) byStage[s.value] = 0;

  let converted = 0;
  for (const l of leads) {
    const stage = l?.stage || 'new_lead';
    byStage[stage] = (byStage[stage] || 0) + 1;
    if (l?.converted_at) converted += 1;
  }

  const total  = leads.length;
  const closed = byStage.closed || 0;
  const open   = total - closed;

  return {
    total,
    open,
    closed,
    converted,
    byStage,
    conversionRate: closed ? Math.round((converted / closed) * 100) : null,
    // Share of ALL leads that ever closed — the blunter number, kept alongside
    // because it is the one people quote.
    closeRate: total ? Math.round((closed / total) * 100) : null,
  };
};

/**
 * One row per agent: pipeline, contact effort, follow-up discipline.
 *
 * Pure and exported so the arithmetic can be tested without a database. Every
 * number here is one an agent gets measured on, and a silently wrong "0 calls
 * this week" is worse than no dashboard at all.
 */
export const buildAgentScorecards = ({
  agents = [],
  leads = [],
  interactions = [],
  followUps = [],
  now = Date.now(),
} = {}) => {
  const weekAgo = now - 7 * DAY;

  const empty = () => ({
    leads: [], interactions: [], followUps: [],
  });

  const grouped = new Map();
  for (const a of agents) grouped.set(a.id, empty());

  const bucket = (id) => {
    if (!id) return null;
    // An agent the caller cannot read (deleted, or outside the tenant) still
    // owns rows RLS let through via a join; give them a bucket rather than
    // dropping the work silently.
    if (!grouped.has(id)) grouped.set(id, empty());
    return grouped.get(id);
  };

  for (const l of leads)        bucket(l?.agent_id)?.leads.push(l);
  for (const i of interactions) bucket(i?.agent_id)?.interactions.push(i);
  for (const f of followUps)    bucket(f?.agent_id)?.followUps.push(f);

  const agentById = new Map(agents.map(a => [a.id, a]));

  const cards = [];
  for (const [agentId, rows] of grouped.entries()) {
    const agent    = agentById.get(agentId) || { id: agentId, full_name: 'Unknown agent' };
    const pipeline = summarisePipeline(rows.leads);

    let touchesThisWeek = 0;
    let positive = 0;
    let rated = 0;
    let lastTouchAt = null;
    for (const i of rows.interactions) {
      const at = new Date(i?.occurred_at || i?.created_at || 0).getTime();
      if (!Number.isNaN(at)) {
        if (at >= weekAgo) touchesThisWeek += 1;
        if (!lastTouchAt || at > lastTouchAt) lastTouchAt = at;
      }
      const meta = outcomeMeta(i?.outcome);
      if (meta) {
        rated += 1;
        if (meta.sentiment === 'positive') positive += 1;
      }
    }

    const openFollowUps = rows.followUps.filter(f => !f?.is_completed);
    const overdue = openFollowUps.filter(f => {
      const at = new Date(f?.scheduled_at || 0).getTime();
      return !Number.isNaN(at) && at < now;
    });

    // Open leads nobody has touched inside the quiet window. This is the number
    // that catches an agent hoarding leads they never work.
    const neglected = rows.leads.filter(l =>
      l && !l.converted_at && l.stage !== 'closed'
      && !isFresh(l.last_contact_at || l.created_at, now, STALE_CONTACT_DAYS)
    );

    cards.push({
      agentId,
      agent,
      name:   agent.full_name || 'Unknown agent',
      code:   agent.agent_code || null,
      region: agent.region || null,
      status: agent.agent_status || null,
      pipeline,
      interactions:    rows.interactions.length,
      touchesThisWeek,
      positiveRate:    rated ? Math.round((positive / rated) * 100) : null,
      lastTouchAt:     lastTouchAt ? new Date(lastTouchAt).toISOString() : null,
      quietDays:       lastTouchAt ? daysSince(new Date(lastTouchAt).toISOString(), now) : null,
      openFollowUps:   openFollowUps.length,
      overdueFollowUps: overdue.length,
      neglectedLeads:  neglected.length,
    });
  }

  // Busiest pipeline first; an agent with nothing at all sorts to the bottom
  // where the empty rows do not push the working ones off the screen.
  return cards.sort((a, b) =>
    (b.pipeline.open - a.pipeline.open)
    || (b.touchesThisWeek - a.touchesThisWeek)
    || a.name.localeCompare(b.name)
  );
};

/** Platform/tenant totals, derived from the same rows the cards are built on. */
export const buildCrmTotals = ({ scorecards = [], interactions = [], now = Date.now() } = {}) => {
  const weekAgo = now - 7 * DAY;
  const totals = scorecards.reduce((acc, c) => ({
    agents:           acc.agents + 1,
    activeAgents:     acc.activeAgents + (c.touchesThisWeek > 0 ? 1 : 0),
    openLeads:        acc.openLeads + c.pipeline.open,
    totalLeads:       acc.totalLeads + c.pipeline.total,
    converted:        acc.converted + c.pipeline.converted,
    overdueFollowUps: acc.overdueFollowUps + c.overdueFollowUps,
    neglectedLeads:   acc.neglectedLeads + c.neglectedLeads,
  }), {
    agents: 0, activeAgents: 0, openLeads: 0, totalLeads: 0,
    converted: 0, overdueFollowUps: 0, neglectedLeads: 0,
  });

  const touchesThisWeek = interactions.filter(i => {
    const at = new Date(i?.occurred_at || i?.created_at || 0).getTime();
    return !Number.isNaN(at) && at >= weekAgo;
  }).length;

  return {
    ...totals,
    interactions: interactions.length,
    touchesThisWeek,
    conversionRate: totals.totalLeads
      ? Math.round((totals.converted / totals.totalLeads) * 100)
      : null,
  };
};

const AGENT_COLS  = 'id, user_id, admin_id, full_name, agent_code, email, phone, region, agent_status, commission_rate, created_at';
const LEAD_COLS   = 'id, agent_id, full_name, phone, email, stage, priority, source, asset_interest, budget_range, '
                  + 'last_contact_at, next_follow_up_at, interaction_count, last_interaction_type, converted_at, converted_entity, created_at';
const TOUCH_COLS  = 'id, agent_id, lead_id, client_id, contact_name, interaction_type, direction, subject, summary, outcome, duration_minutes, occurred_at, next_step, created_at';
const FOLLOW_COLS = 'id, agent_id, lead_id, lead_name, appointment_type, scheduled_at, is_completed, completed_at, outcome, location, notes';

export const useCrmOversight = () => {
  const { userProfile } = useAuth();
  const role = userProfile?.role || null;
  const canView = CRM_SUPERVISOR_ROLES.includes(role);
  // Only changes the wording on screen — a super admin's agents are the
  // platform sales force, not one company's. Scope itself is identical.
  const isPlatformOwner = role === 'super_admin';

  const [agents, setAgents] = useState([]);
  const [leads, setLeads] = useState([]);
  const [interactions, setInteractions] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const channelsRef = useRef([]);

  const reset = useCallback(() => {
    setAgents([]); setLeads([]); setInteractions([]); setFollowUps([]);
    setError(null); setLoading(true);
  }, []);

  const fetchAll = useCallback(async () => {
    if (!canView) { setLoading(false); return; }
    setLoading(true);
    try {
      // Everyone filters by their own tenant, super admin included: its
      // user_profiles.admin_id is NULL, so getTenantAdminId() falls back to its
      // own uid — which is exactly the admin_id stamped on the agents it
      // created. Same rule, no special case.
      const adminId = await getTenantAdminId();

      const agentQuery = supabase.from('agents')
        .select(AGENT_COLS)
        .eq('admin_id', adminId)
        .order('full_name');

      const [agentRes, leadRes, touchRes, followRes] = await Promise.all([
        agentQuery,
        supabase.from('leads').select(LEAD_COLS)
          .order('created_at', { ascending: false }).limit(ROW_LIMIT),
        supabase.from('crm_interactions').select(TOUCH_COLS)
          .order('occurred_at', { ascending: false }).limit(ROW_LIMIT),
        supabase.from('follow_ups').select(FOLLOW_COLS)
          .order('scheduled_at', { ascending: false }).limit(ROW_LIMIT),
      ]);

      if (agentRes.error) throw agentRes.error;

      const agentRows = agentRes.data || [];
      setAgents(agentRows);

      // leads / follow_ups / crm_interactions come back already scoped by the
      // supervisor policies, but this caller's own agent rows are the
      // authoritative list — narrowing to them keeps a row that slipped
      // through off a dashboard it does not belong on. No global branch: the
      // super admin is filtered by the same set as everybody else.
      const allowed = new Set(agentRows.map(a => a.id));
      const scope   = (rows) => (rows || []).filter(r => allowed.has(r.agent_id));

      setLeads(scope(leadRes.data));
      setInteractions(scope(touchRes.data));
      setFollowUps(scope(followRes.data));

      // The three CRM tables are new; on a database where the migration has not
      // run yet the queries fail rather than return nothing. Say so once,
      // instead of rendering a confident dashboard full of zeros.
      const firstErr = leadRes.error || touchRes.error || followRes.error;
      setError(firstErr ? (firstErr.message || 'Some CRM data could not be loaded.') : null);
    } catch (err) {
      logger.error('[useCrmOversight] load failed', { message: err?.message });
      setError(err?.message || 'Could not load CRM data.');
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useAuthScopedLoader(fetchAll, reset);

  // A logged call should land on the supervisor's screen the same way it lands
  // on the agent's. No filter: the subscription is tenant-wide by definition,
  // and RLS decides which rows the payload may carry.
  useEffect(() => {
    if (!canView) return undefined;
    const channel = supabase
      .channel(`crm_oversight_${++_crmOversightChannelSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_interactions' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' },            () => fetchAll())
      .subscribe();
    channelsRef.current = [channel];
    return () => { supabase.removeChannel(channel); channelsRef.current = []; };
  }, [canView, fetchAll]);

  const scorecards = useMemo(
    () => buildAgentScorecards({ agents, leads, interactions, followUps }),
    [agents, leads, interactions, followUps],
  );

  const totals   = useMemo(() => buildCrmTotals({ scorecards, interactions }), [scorecards, interactions]);
  const pipeline = useMemo(() => summarisePipeline(leads), [leads]);

  /** Leads nobody has touched inside the quiet window, coldest first. */
  const neglectedLeads = useMemo(() => {
    const now = Date.now();
    const byAgent = new Map(agents.map(a => [a.id, a]));
    return leads
      .filter(l => l && !l.converted_at && l.stage !== 'closed')
      .map(l => ({
        ...l,
        agentName: byAgent.get(l.agent_id)?.full_name || 'Unassigned',
        quietDays: daysSince(l.last_contact_at || l.created_at, now),
      }))
      .filter(l => l.quietDays === null || l.quietDays >= STALE_CONTACT_DAYS)
      .sort((a, b) => (b.quietDays ?? Infinity) - (a.quietDays ?? Infinity));
  }, [leads, agents]);

  /** The newest contacts across the whole scope, for the activity column. */
  const recentInteractions = useMemo(() => {
    const byAgent = new Map(agents.map(a => [a.id, a]));
    return interactions
      .slice(0, 100)
      .map(i => ({ ...i, agentName: byAgent.get(i.agent_id)?.full_name || 'Unknown agent' }));
  }, [interactions, agents]);

  return {
    canView,
    isPlatformOwner,
    agents,
    leads,
    interactions,
    followUps,
    scorecards,
    totals,
    pipeline,
    neglectedLeads,
    recentInteractions,
    loading,
    error,
    refetch: fetchAll,
  };
};

export default useCrmOversight;

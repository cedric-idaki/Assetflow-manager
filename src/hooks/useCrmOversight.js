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
import {
  sourceMeta, lostReasonMeta, isLostLead, channelMeta,
  PIPELINE_STAGES, OPPORTUNITY_STAGES,
} from '../config/crmVocabulary';
import { summariseOpportunities, leadValue, formatCompactMoney } from '../utils/pipelineValue';

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

/**
 * Pipeline order, left to right, matching the agent portal's board.
 *
 * Re-exported from the shared vocabulary rather than declared here, for the
 * same reason INTERACTION_TYPES is: the agent portal weights its forecast by
 * stage and so does this dashboard, and two copies of the odds means the two
 * screens quote different money for the same pipeline. Importers already
 * pointed here, so the name stays.
 */
export { PIPELINE_STAGES };

/** Rows fetched per table. Deep enough for a quarter, shallow enough to load. */
const ROW_LIMIT = 2000;

/** DECIMAL columns arrive from PostgREST as strings; NaN must never reach a sum. */
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

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
  let lost = 0;
  for (const l of leads) {
    const stage = l?.stage || 'new_lead';
    byStage[stage] = (byStage[stage] || 0) + 1;
    if (l?.converted_at) converted += 1;
    // A deal that reached the end of the board WITHOUT converting is a loss.
    // Stage alone cannot say this: 'closed' is where both winners and losers
    // come to rest, and converted_at is the only thing that separates them.
    else if (stage === 'closed') lost += 1;
  }

  const total  = leads.length;
  const closed = byStage.closed || 0;
  const open   = total - closed;

  // 'Opportunity' is not a table on this schema -- the pipeline is a single
  // lead_stage enum. A lead that has been qualified or has a proposal out is
  // the same thing a CRM would call an opportunity, so it is derived here
  // rather than invented as a new entity nobody writes to.
  const qualified     = byStage.qualified || 0;
  const opportunities = OPPORTUNITY_STAGES.reduce((n, s) => n + (byStage[s] || 0), 0);

  // The same pipeline, measured in money. Counting was always the wrong unit
  // for a supervisor too: "14 opportunities" says nothing about whether the
  // quarter lands, and an agent nursing one large deal read as the weakest
  // person on the team. Derived from the one shared summariser so the agent's
  // own panel and this dashboard cannot quote different figures.
  const value = summariseOpportunities(leads);

  return {
    total,
    open,
    closed,
    converted,
    qualified,
    opportunities,
    openValue:          value.open.value,
    weightedValue:      value.open.weighted,
    opportunityValue:   value.opportunities.value,
    wonValue:           value.won.value,
    lostValue:          value.lost.value,
    unvaluedOpen:       value.unvalued.count,
    valueWinRate:       value.valueWinRate,
    // Named for what a supervisor asks for. `won` is an alias of `converted`
    // on purpose: one number, two vocabularies, never allowed to drift apart.
    won: converted,
    lost,
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
      // Realised commercial figures live on the agent row and are maintained by
      // the sales flow, not by this dashboard. Coerced because the column is
      // DECIMAL, which PostgREST returns as a string.
      salesValue:  num(agent.total_sales),
      commission:  num(agent.total_commission),
      target:      num(agent.target_amount),
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
    // Two different questions that both get called "active". This one is the
    // employment record on public.agents; activeAgents above is whether they
    // actually did any work this week. A team can be 12/12 on payroll and
    // 2/12 working, and a supervisor needs to see both numbers.
    enabledAgents:    acc.enabledAgents + (c.status === 'active' ? 1 : 0),
    openLeads:        acc.openLeads + c.pipeline.open,
    totalLeads:       acc.totalLeads + c.pipeline.total,
    converted:        acc.converted + c.pipeline.converted,
    qualified:        acc.qualified + c.pipeline.qualified,
    opportunities:    acc.opportunities + c.pipeline.opportunities,
    // The money behind those counts, summed the same way. `salesValue` below
    // is banked commissionable revenue; these are the pipeline that has not
    // happened yet, and a supervisor needs both to see whether next quarter
    // has anything in it.
    openValue:        acc.openValue + c.pipeline.openValue,
    weightedValue:    acc.weightedValue + c.pipeline.weightedValue,
    opportunityValue: acc.opportunityValue + c.pipeline.opportunityValue,
    unvaluedOpen:     acc.unvaluedOpen + c.pipeline.unvaluedOpen,
    won:              acc.won + c.pipeline.won,
    lost:             acc.lost + c.pipeline.lost,
    salesValue:       acc.salesValue + c.salesValue,
    commission:       acc.commission + c.commission,
    overdueFollowUps: acc.overdueFollowUps + c.overdueFollowUps,
    neglectedLeads:   acc.neglectedLeads + c.neglectedLeads,
  }), {
    agents: 0, activeAgents: 0, enabledAgents: 0, openLeads: 0, totalLeads: 0,
    converted: 0, qualified: 0, opportunities: 0, won: 0, lost: 0,
    openValue: 0, weightedValue: 0, opportunityValue: 0, unvaluedOpen: 0,
    salesValue: 0, commission: 0, overdueFollowUps: 0, neglectedLeads: 0,
  });

  const touchesThisWeek = interactions.filter(i => {
    const at = new Date(i?.occurred_at || i?.created_at || 0).getTime();
    return !Number.isNaN(at) && at >= weekAgo;
  }).length;

  return {
    ...totals,
    interactions: interactions.length,
    touchesThisWeek,
    // Rounded to one decimal rather than an integer: with a small team the
    // difference between 3 and 3.4 leads per agent is the whole story.
    leadsPerAgent: totals.agents
      ? Math.round((totals.totalLeads / totals.agents) * 10) / 10
      : null,
    conversionRate: totals.totalLeads
      ? Math.round((totals.converted / totals.totalLeads) * 100)
      : null,
  };
};

/**
 * The sales-agent leaderboard.
 *
 * Ranked on REALISED sales value, not on pipeline size -- a board that rewards
 * hoarding leads is worse than no board, because it is a target agents can hit
 * without selling anything. Ties break on deals won, then on name so the order
 * is stable between renders rather than shuffling on every refetch.
 *
 * Agents with no sales are kept, at the bottom: a leaderboard that silently
 * drops the people who sold nothing hides exactly what a supervisor opened it
 * to find out.
 */
/**
 * Which lead sources actually work.
 *
 * Volume is the seductive number here and the wrong one: the source that
 * produces the most leads is very often not the source that produces the most
 * CUSTOMERS. Cold calling fills a pipeline with people who never buy; a
 * referral trickles in and closes. So this ranks on WON, and reports volume
 * beside it rather than instead of it.
 *
 * `won` counts converted leads. `decided` is wins plus losses — leads that have
 * actually finished — and the conversion rate is measured against THAT, not
 * against every lead ever received, or a source with a lot of fresh open leads
 * would read as though it were failing.
 */
export const buildSourcePerformance = (leads = []) => {
  const bySource = new Map();

  for (const l of leads) {
    if (!l) continue;
    const meta = sourceMeta(l.source);
    // Key on the resolved label so 'Website', 'website' and a NULL source do
    // not become three separate rows in a report meant to be read at a glance.
    const key = meta.value === null ? '__none__' : String(meta.value).toLowerCase();

    if (!bySource.has(key)) {
      bySource.set(key, {
        key,
        source: meta.value,
        label:  meta.label,
        icon:   meta.icon,
        known:  meta.known,
        total: 0, open: 0, won: 0, lost: 0, qualified: 0,
        // Kept so the panel can drill from a channel straight to the actual
        // people it produced, rather than leaving the reader to go and filter
        // a table by hand.
        leads: [],
      });
    }

    const row = bySource.get(key);
    row.total += 1;
    row.leads.push(l);
    if (l.converted_at)                    row.won += 1;
    else if (isLostLead(l))                row.lost += 1;
    else                                   row.open += 1;
    if ((l.stage || '') === 'qualified')   row.qualified += 1;
  }

  const grand = [...bySource.values()].reduce((n, r) => n + r.total, 0);

  return [...bySource.values()]
    .map(r => {
      const decided = r.won + r.lost;
      return {
        ...r,
        decided,
        // Null, not 0%, when nothing from this source has finished yet —
        // "no verdict" and "never converts" are different answers.
        conversionRate: decided ? Math.round((r.won / decided) * 100) : null,
        shareOfLeads:   grand ? Math.round((r.total / grand) * 100) : 0,
      };
    })
    .sort((a, b) =>
      (b.won - a.won)
      || ((b.conversionRate ?? -1) - (a.conversionRate ?? -1))
      || (b.total - a.total)
      || a.label.localeCompare(b.label)
    );
};

/**
 * Why we lose deals.
 *
 * Counts only leads that ARE lost, and reports how many of those nobody gave a
 * reason for — because that number is the health of the report itself. A loss
 * analysis built on 20% coverage is not an answer, it is a sample nobody chose,
 * and presenting it as though it were the whole picture is how a team ends up
 * fixing the wrong problem with total confidence.
 */
export const buildLossAnalysis = (leads = []) => {
  const lost = leads.filter(isLostLead);

  const byReason = new Map();
  let unrecorded = 0;

  for (const l of lost) {
    const meta = lostReasonMeta(l.lost_reason);
    if (meta.value === null) { unrecorded += 1; continue; }

    const key = meta.value;
    if (!byReason.has(key)) {
      byReason.set(key, { key, reason: meta.value, label: meta.label, hint: meta.hint, count: 0, leads: [] });
    }
    const row = byReason.get(key);
    row.count += 1;
    row.leads.push(l);
  }

  const recorded = lost.length - unrecorded;

  const reasons = [...byReason.values()]
    .map(r => ({
      ...r,
      // Share of the losses we actually KNOW the reason for. Dividing by all
      // losses instead would shrink every bar by however much is unrecorded and
      // make the biggest problem look smaller than it is.
      share: recorded ? Math.round((r.count / recorded) * 100) : 0,
    }))
    .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label));

  return {
    totalLost: lost.length,
    recorded,
    unrecorded,
    // How much of the loss picture is actually filled in.
    coverage: lost.length ? Math.round((recorded / lost.length) * 100) : null,
    reasons,
    topReason: reasons[0] || null,
  };
};

export const buildLeaderboard = (scorecards = [], limit = null) => {
  const ranked = [...scorecards].sort((a, b) =>
    (b.salesValue - a.salesValue)
    || (b.pipeline.won - a.pipeline.won)
    || a.name.localeCompare(b.name)
  );

  // Rank is assigned after sorting, so an agent's position survives whatever
  // slice the caller takes.
  const withRank = ranked.map((c, i) => ({ ...c, rank: i + 1 }));
  return limit ? withRank.slice(0, limit) : withRank;
};

/**
 * The eight KPI tiles, as data.
 *
 * Each entry names the number and, more importantly, says WHERE IT COMES FROM.
 * A tile reading zero is ambiguous -- nothing happened, or nothing is being
 * recorded? -- and `emptyHint` is the answer, shown when the figure is zero so
 * nobody has to read this file to find out.
 */
export const KPI_KEYS = [
  'activeAgents', 'openLeads', 'contacts', 'attention',
  'sales', 'commission', 'opportunities', 'conversion',
];

const fmtDay = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const fmtStamp = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const stageLabel = (v) =>
  PIPELINE_STAGES.find(st => st.value === v)?.label || String(v || 'new_lead').replace(/_/g, ' ');

/**
 * Explain one KPI tile: the rows the number was actually computed from.
 *
 * Pure, and takes the same arrays the tiles were built from, so a breakdown can
 * never disagree with the figure above it -- the commonest way a drill-down
 * lies. Nothing here re-queries; if a row is not on screen it was not counted.
 *
 * Returns null for an unknown key so the caller can render nothing rather than
 * an empty shell.
 */
export const buildKpiBreakdown = (key, {
  scorecards = [],
  leads = [],
  interactions = [],
  followUps = [],
  totals = {},
  now = Date.now(),
} = {}) => {
  const weekAgo   = now - 7 * DAY;
  const nameOf    = new Map(scorecards.map(c => [c.agentId, c.name]));
  const agentName = (id) => nameOf.get(id) || 'Unknown agent';

  const leadById = new Map(leads.map(l => [l.id, l]));

  switch (key) {
    // ---------------------------------------------------------------------
    case 'activeAgents': {
      const worked = scorecards.filter(c => c.touchesThisWeek > 0);
      const idle   = scorecards.filter(c => c.touchesThisWeek === 0);
      const row = (c) => ({
        id: c.agentId,
        primary: c.name,
        secondary: [c.code, c.status].filter(Boolean).join(' · ') || '—',
        value: c.touchesThisWeek > 0
          ? `${c.touchesThisWeek} contact${c.touchesThisWeek === 1 ? '' : 's'}`
          : (c.lastTouchAt ? `last ${fmtDay(c.lastTouchAt)}` : 'never active'),
        tone: c.touchesThisWeek > 0 ? 'good' : 'bad',
        agentId: c.agentId,
      });
      return {
        title: 'Who worked this week',
        hint: 'Counted from contacts logged in the last 7 days, not from whether the agent is enabled.',
        sections: [
          { label: `Worked this week (${worked.length})`, items: worked.map(row),
            empty: 'Nobody logged a single contact this week.' },
          { label: `Logged nothing (${idle.length})`, items: idle.map(row),
            empty: 'Everyone has been active.' },
        ],
      };
    }

    // ---------------------------------------------------------------------
    case 'openLeads': {
      const open = leads.filter(l => l && l.stage !== 'closed' && !l.converted_at);
      const sections = PIPELINE_STAGES
        .filter(st => st.value !== 'closed')
        .map(st => {
          const rows = open.filter(l => (l.stage || 'new_lead') === st.value);
          return {
            label: `${st.label} (${rows.length})`,
            items: rows.map(l => ({
              id: l.id,
              primary: l.full_name || 'Unnamed lead',
              secondary: [agentName(l.agent_id), l.asset_interest].filter(Boolean).join(' · '),
              value: l.last_contact_at ? fmtDay(l.last_contact_at) : 'never contacted',
              tone: l.last_contact_at ? 'plain' : 'bad',
              lead: l,
            })),
            empty: null,
          };
        })
        .filter(sec => sec.items.length > 0);

      return {
        title: 'Open leads by stage',
        hint: 'Every lead not yet closed or converted. Click one to open the full customer record.',
        sections: sections.length ? sections : [{ label: 'Open leads', items: [],
          empty: 'No open leads. Every lead has been closed or converted.' }],
      };
    }

    // ---------------------------------------------------------------------
    case 'contacts': {
      const week = interactions.filter(i => {
        const at = new Date(i?.occurred_at || i?.created_at || 0).getTime();
        return !Number.isNaN(at) && at >= weekAgo;
      });
      const row = (i) => ({
        id: i.id,
        primary: i.contact_name || 'Unnamed contact',
        secondary: [agentName(i.agent_id), String(i.interaction_type || '').replace(/_/g, ' ')]
          .filter(Boolean).join(' · '),
        value: fmtStamp(i.occurred_at || i.created_at),
        tone: 'plain',
        interaction: i,
      });

      // When the week is empty the useful question is "so when DID anyone last
      // speak to a customer" -- showing an empty box answers nothing.
      const sections = [{
        label: `This week (${week.length})`,
        items: week.map(row),
        empty: 'No contact logged in the last 7 days.',
      }];
      if (week.length === 0 && interactions.length > 0) {
        sections.push({
          label: `Most recent before that (${Math.min(interactions.length, 10)})`,
          items: interactions.slice(0, 10).map(row),
          empty: null,
        });
      }
      return {
        title: 'Contact activity',
        hint: 'Calls, meetings, site visits and messages agents logged from their portal.',
        emptyHint: interactions.length === 0
          ? 'Nothing has ever been logged. Agents record contact from the Sales Agent portal — until they do, this stays at zero.'
          : null,
        sections,
      };
    }

    // ---------------------------------------------------------------------
    case 'attention': {
      const overdue = followUps
        .filter(f => f && !f.is_completed)
        .filter(f => {
          const at = new Date(f.scheduled_at || 0).getTime();
          return !Number.isNaN(at) && at < now;
        })
        .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

      const quiet = leads
        .filter(l => l && !l.converted_at && l.stage !== 'closed')
        .map(l => ({ l, days: daysSince(l.last_contact_at || l.created_at, now) }))
        .filter(x => x.days === null || x.days >= STALE_CONTACT_DAYS)
        .sort((a, b) => (b.days ?? Infinity) - (a.days ?? Infinity));

      return {
        title: 'What needs attention',
        hint: `Follow-ups past their date, and open leads untouched for ${STALE_CONTACT_DAYS}+ days.`,
        sections: [
          {
            label: `Overdue follow-ups (${overdue.length})`,
            items: overdue.map(f => ({
              id: f.id,
              primary: f.lead_name || leadById.get(f.lead_id)?.full_name || 'Unnamed lead',
              secondary: [agentName(f.agent_id), channelMeta(f.appointment_type).label].filter(Boolean).join(' · '),
              value: `due ${fmtDay(f.scheduled_at) || '—'}`,
              tone: 'bad',
              lead: leadById.get(f.lead_id) || null,
            })),
            empty: 'Nothing overdue. Every scheduled follow-up is still in date.',
          },
          {
            label: `Leads gone quiet (${quiet.length})`,
            items: quiet.map(({ l, days }) => ({
              id: l.id,
              primary: l.full_name || 'Unnamed lead',
              secondary: [agentName(l.agent_id), stageLabel(l.stage)].filter(Boolean).join(' · '),
              value: days === null ? 'never contacted' : `${days} days quiet`,
              tone: 'warn',
              lead: l,
            })),
            empty: 'No open lead has been left alone.',
          },
        ],
      };
    }

    // ---------------------------------------------------------------------
    case 'sales':
    case 'commission': {
      const isSales = key === 'sales';
      const pick    = (c) => (isSales ? c.salesValue : c.commission);
      const ranked  = [...scorecards].sort((a, b) => pick(b) - pick(a));
      const total   = isSales ? totals.salesValue : totals.commission;

      return {
        title: isSales ? 'Sales by agent' : 'Commission by agent',
        hint: isSales
          ? 'Completed payments credited to each agent — not the value of the open pipeline.'
          : "Commission on completed payments at each agent's rate, plus any assist commission.",
        // Since 20260828120000 these are maintained by a trigger on payments,
        // so a zero now means something specific and actionable rather than
        // "the column has no writer", which is what it used to mean.
        emptyHint: !total
          ? (isSales
              ? 'No completed payment has been credited to an agent yet. Sales are counted from '
                + 'payments whose status is completed and whose agent is set — converting a lead '
                + 'does not create a payment, so the sale has to be recorded against the agent.'
              : 'No commission earned yet. It is posted automatically when a payment completes, '
                + "at the agent's commission rate, so it follows the sales figure.")
          : null,
        money: true,
        sections: [{
          label: `All agents (${ranked.length})`,
          items: ranked.map(c => ({
            id: c.agentId,
            primary: c.name,
            secondary: `${c.pipeline.won} won · ${c.pipeline.lost} lost · ${c.pipeline.open} open`,
            amount: pick(c),
            tone: pick(c) > 0 ? 'good' : 'plain',
            agentId: c.agentId,
          })),
          empty: 'No sales agents in this tenant yet.',
        }],
      };
    }

    // ---------------------------------------------------------------------
    case 'opportunities': {
      const inStage = (v) => leads.filter(l => l && (l.stage || 'new_lead') === v && !l.converted_at);
      const row = (l) => {
        const { value: amount, source } = leadValue(l);
        return {
          id: l.id,
          primary: l.full_name || 'Unnamed lead',
          secondary: [agentName(l.agent_id), l.asset_interest, l.budget_range]
            .filter(Boolean).join(' · '),
          // The deal's size where there is one, falling back to when it was
          // last touched. An opportunity with no price on it is a real and
          // reportable state — it says so rather than showing a bare zero,
          // which would read as a worthless deal instead of an unpriced one.
          value: source === 'none'
            ? (l.last_contact_at ? fmtDay(l.last_contact_at) : 'never contacted')
            : `${source === 'estimated' ? '~' : ''}${formatCompactMoney(amount)}`,
          tone: 'plain',
          lead: l,
        };
      };
      const bySize = (a, b) => leadValue(b).value - leadValue(a).value;
      const sum = (rows) => rows.reduce((t, l) => t + leadValue(l).value, 0);

      const qualified = inStage('qualified').sort(bySize);
      const proposals = inStage('proposal_sent').sort(bySize);

      return {
        title: 'Opportunities',
        hint: 'Leads that are qualified or have a proposal out, biggest first. This schema has no separate opportunity record — the pipeline stage is the opportunity, and leads.deal_value is what it is worth.',
        sections: [
          { label: `Qualified (${qualified.length}) · ${formatCompactMoney(sum(qualified))}`,
            items: qualified.map(row),
            empty: 'Nothing has been qualified yet.' },
          { label: `Proposal sent (${proposals.length}) · ${formatCompactMoney(sum(proposals))}`,
            items: proposals.map(row),
            empty: 'No proposals are outstanding.' },
        ],
      };
    }

    // ---------------------------------------------------------------------
    case 'conversion': {
      const ranked = [...scorecards].sort((a, b) => b.pipeline.won - a.pipeline.won);
      return {
        title: 'Conversion by agent',
        hint: 'Won means the lead converted. Lost means it reached closed without converting. The rate is won as a share of leads that actually ended.',
        emptyHint: !totals.totalLeads
          ? 'No leads have been registered, so there is nothing to convert yet.'
          : null,
        sections: [{
          label: `All agents (${ranked.length})`,
          items: ranked.map(c => ({
            id: c.agentId,
            primary: c.name,
            secondary: `${c.pipeline.total} lead${c.pipeline.total === 1 ? '' : 's'} · `
                     + `${c.pipeline.won} won · ${c.pipeline.lost} lost · ${c.pipeline.open} open`,
            value: c.pipeline.conversionRate === null ? 'no closed leads' : `${c.pipeline.conversionRate}%`,
            tone: c.pipeline.conversionRate === null
              ? 'plain'
              : (c.pipeline.conversionRate > 0 ? 'good' : 'bad'),
            agentId: c.agentId,
          })),
          empty: 'No sales agents in this tenant yet.',
        }],
      };
    }

    default:
      return null;
  }
};

/**
 * Each sort names the column it ranks and how to read that column's value.
 *
 * An accessor rather than a bare comparator, because the value is needed for
 * three separate jobs: ordering the rows, highlighting the column being ranked,
 * and detecting the case where every agent scores the same -- which is when a
 * sort silently appears broken. Clicking "Deals won" on a team that has won
 * nothing reorders nothing, and without a word on screen that reads as a dead
 * button rather than as the honest answer it is.
 */
export const AGENT_SORTS = [
  { value: 'sales',    label: 'Sales',         col: 'sales',     get: c => c.salesValue,       money: true },
  { value: 'open',     label: 'Open leads',    col: 'open',      get: c => c.pipeline.open },
  { value: 'won',      label: 'Deals won',     col: 'won',       get: c => c.pipeline.won },
  { value: 'activity', label: 'Contacts/week', col: 'week',      get: c => c.touchesThisWeek },
  { value: 'overdue',  label: 'Overdue',       col: 'overdue',   get: c => c.overdueFollowUps },
  { value: 'quiet',    label: 'Neglected',     col: 'neglected', get: c => c.neglectedLeads },
  { value: 'name',     label: 'Name',          col: 'agent',     get: c => c.name, text: true },
];

/**
 * Order the scorecard table. `flip` reverses whatever the natural order is.
 *
 * Ties fall back to name so the table cannot reshuffle between renders -- with
 * a team where every metric is still zero, EVERY row is a tie, and an unstable
 * comparator would make the rows jump about on each refetch.
 */
export const sortScorecards = (scorecards = [], sortValue = 'open', flip = false) => {
  const active = AGENT_SORTS.find(s => s.value === sortValue);
  if (!active) return [...scorecards];
  const dir = flip ? -1 : 1;
  return [...scorecards].sort((a, b) => {
    const av = active.get(a);
    const bv = active.get(b);
    // Primary order is the one worth reading first: A-Z for a name, biggest
    // first for a number.
    const cmp = active.text
      ? String(av ?? '').localeCompare(String(bv ?? ''))
      : (Number(bv || 0) - Number(av || 0));
    return (cmp || String(a.name ?? '').localeCompare(String(b.name ?? ''))) * dir;
  });
};

/**
 * The shared value when a metric cannot separate anybody, else null.
 *
 * "Deals won" on a team that has won nothing reorders nothing; without saying
 * so, the click reads as a dead button rather than as the honest answer.
 */
export const flatMetric = (scorecards = [], sortValue = 'open') => {
  const active = AGENT_SORTS.find(s => s.value === sortValue);
  if (!active || active.text || scorecards.length < 2) return null;
  const vals = scorecards.map(active.get).map(v => Number(v || 0));
  return vals.every(v => v === vals[0]) ? vals[0] : null;
};

const AGENT_COLS  = 'id, user_id, admin_id, full_name, agent_code, email, phone, region, agent_status, '
                  + 'commission_rate, total_sales, total_commission, target_amount, created_at';
const LEAD_COLS   = 'id, agent_id, full_name, phone, email, stage, priority, source, asset_interest, budget_range, '
                  + 'last_contact_at, next_follow_up_at, interaction_count, last_interaction_type, converted_at, converted_entity, created_at, '
                  + 'lost_reason, lost_notes, lost_at';
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
      // `agents` carries the commercial half — total_sales, total_commission,
      // agent_status — which a trigger on payments now maintains. Without this
      // the activity side of the dashboard was live while the money side sat
      // stale until a manual refresh, and nothing on screen said which was
      // which. Published by 20260828160000.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agents' },           () => fetchAll())
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
  const leaderboard = useMemo(() => buildLeaderboard(scorecards), [scorecards]);
  const sources     = useMemo(() => buildSourcePerformance(leads), [leads]);
  const losses      = useMemo(() => buildLossAnalysis(leads), [leads]);

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
    leaderboard,
    sources,
    losses,
    neglectedLeads,
    recentInteractions,
    loading,
    error,
    refetch: fetchAll,
  };
};

export default useCrmOversight;

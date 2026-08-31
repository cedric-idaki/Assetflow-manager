/**
 * useSupervisorLeads
 *
 * The pipeline a supervisor works themselves, as opposed to the ones they
 * merely watch.
 *
 * useCrmOversight answers "what are my agents selling". useAdminCrm answers
 * "what am I doing with my existing customers". Neither answers the third
 * question, which for a super administrator is the main one: "who am I trying
 * to WIN, and what is that worth". Until 20260831140000 there was nowhere to
 * put the answer — `leads.agent_id` was NOT NULL, so a prospect nobody had
 * assigned to an agent could not be written down at all.
 *
 * SCOPE. Tenant-owned leads only: `agent_id IS NULL` and
 * `admin_id = current_admin_id()`. An agent's lead is deliberately NOT in here.
 * It is visible through oversight, read-only, and stays that way — a supervisor
 * editing a lead out from under the person working it is the thing every one of
 * these migrations has refused to build.
 *
 * OPPORTUNITIES are not a second entity. PIPELINE_STAGES marks which stages
 * count as one (`isOpportunity`), and deal_value / expected_close_date /
 * win_probability have been on `leads` since 20260830140000. So the same rows
 * are the pipeline board and the forecast, and `summariseOpportunities` — the
 * agent portal's own function — does the money without a second set of odds.
 *
 * Deliberately separate from useAdminCrm rather than folded into it: that hook
 * is a shipped screen with its own test suite, and the clients/interactions/
 * follow-ups it loads are exactly what the admin's CRM needs. Leads are an
 * addition on top, so they compose rather than complicate.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { getTenantAdminId } from '../lib/tenant';
import { useAuth } from '../contexts/AuthContext';
import { useAuthScopedLoader } from './useAuthScopedLoader';
import { logger } from '../utils/logger';
import { CRM_SUPERVISOR_ROLES } from './useCrmOversight';
import { daysSince } from './useCrmInteractions';
import {
  PIPELINE_STAGES, PIPELINE_STAGE_VALUES, stageMeta, isOpportunity, isLostLead,
} from '../config/crmVocabulary';
import { summariseOpportunities, leadValue, weightedValue, isOpenLead } from '../utils/pipelineValue';

// Module-level counter, not Date.now(): StrictMode mounts an effect twice and
// both runs can land inside the same millisecond. supabase.channel(name)
// returns the EXISTING channel for a name already in use, and calling .on()
// after that channel has subscribed throws — which the error boundary renders
// as a blank "Something went wrong" page. Same fix as useAdminCrm.
let _supervisorLeadsChannelSeq = 0;

export { PIPELINE_STAGES, PIPELINE_STAGE_VALUES };

/** Rows fetched. Deep enough for years of a platform's own prospecting. */
const ROW_LIMIT = 1000;

const LEAD_COLS = 'id, agent_id, admin_id, created_by, full_name, phone, email, asset_interest, '
                + 'budget_range, priority, stage, source, notes, deal_value, expected_close_date, '
                + 'win_probability, lost_reason, lost_notes, lost_at, converted_at, converted_entity, '
                + 'converted_ref_id, next_follow_up_at, interaction_count, last_contact_at, '
                + 'last_interaction_type, created_at, updated_at';

/** How long a prospect may go quiet before the board should say so. */
export const STALE_LEAD_DAYS = 14;

/**
 * A number the caller may have left alone, cleared on purpose, or typed.
 *
 * `undefined` (not supplied) and `null` (deliberately cleared) are kept apart
 * throughout this hook, for the reason updateLeadDeal spells out in the agent
 * portal: clearing a deal value says "I do not know what this is worth", which
 * is a different and more honest state than zero.
 */
const optionalNumber = (value, label) => {
  if (value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be zero or more.`);
  return n;
};

const trimmed = (value) => {
  const s = String(value ?? '').trim();
  return s === '' ? null : s;
};

/**
 * Group the book into the board, in stage order.
 *
 * Every stage gets a column even when it is empty — a board that hides its
 * empty columns reflows every time a card moves, and "nothing in proposal sent"
 * is itself the most useful thing the board can say. Unknown stages are kept
 * under their own key rather than dropped, matching stageMeta's stance: a row
 * that exists must appear somewhere.
 */
export const groupByStage = (leads = []) => {
  const board = {};
  for (const stage of PIPELINE_STAGE_VALUES) board[stage] = [];

  for (const lead of leads) {
    const key = lead?.stage || 'new_lead';
    if (!board[key]) board[key] = [];
    board[key].push(lead);
  }
  return board;
};

/**
 * The board's headline numbers, plus the two nags that make the rest true.
 *
 * `stale` and `unworked` are separate on purpose. A stale lead has been
 * contacted and then left; an unworked one has never been contacted at all.
 * The second is a failure of follow-through and the first is a failure to
 * start, and rolling them together hides which one the supervisor has.
 */
export const summariseLeadBook = (leads = [], now = Date.now()) => {
  const open      = leads.filter(isOpenLead);
  const won       = leads.filter(l => Boolean(l?.converted_at));
  const lost      = leads.filter(isLostLead);
  const opps      = leads.filter(isOpportunity);
  const unworked  = open.filter(l => !l.last_contact_at && !l.interaction_count);
  const stale     = open.filter((l) => {
    const quiet = daysSince(l.last_contact_at, now);
    return quiet !== null && quiet >= STALE_LEAD_DAYS;
  });

  // Settled deals only — a conversion rate that counted deals still in play
  // would read low all quarter and climb for reasons nobody acted on.
  const settled = won.length + lost.length;

  return {
    total: leads.length,
    open: open.length,
    won: won.length,
    lost: lost.length,
    opportunities: opps.length,
    unworked,
    stale,
    conversionRate: settled ? Math.round((won.length / settled) * 100) : null,
    // `stage` and not `value` for the key, because `value` here is money. The
    // PIPELINE_STAGES entries call the stage key `value`, so spreading one in
    // and then adding a monetary `value` silently overwrites the identity of
    // the column with its total.
    byStage: PIPELINE_STAGES.map((s) => {
      const inStage = leads.filter(l => l.stage === s.value);
      return {
        stage: s.value,
        label: s.label,
        tone:  s.tone,
        count: inStage.length,
        value: inStage.reduce((sum, l) => sum + leadValue(l).value, 0),
      };
    }),
    pipelineValue: open.reduce((sum, l) => sum + leadValue(l).value, 0),
    weightedValue: open.reduce((sum, l) => sum + weightedValue(l), 0),
  };
};

/** CSV rows for the pipeline, in the shape a spreadsheet reader expects. */
export const buildLeadExport = (leads = []) => leads.map((l) => ({
  'Name': l.full_name || '',
  'Phone': l.phone || '',
  'Email': l.email || '',
  'Stage': stageMeta(l.stage).label,
  'Priority': l.priority || '',
  'Source': l.source || '',
  'Interest': l.asset_interest || '',
  'Deal value': l.deal_value ?? '',
  'Expected close': l.expected_close_date || '',
  'Win probability': l.win_probability ?? '',
  'Contacts logged': l.interaction_count ?? 0,
  'Last contact': l.last_contact_at ? new Date(l.last_contact_at).toISOString().slice(0, 10) : '',
  'Next follow-up': l.next_follow_up_at ? new Date(l.next_follow_up_at).toISOString().slice(0, 10) : '',
  'Lost reason': l.lost_reason || '',
  'Created': l.created_at ? new Date(l.created_at).toISOString().slice(0, 10) : '',
}));

export const useSupervisorLeads = () => {
  const { userProfile } = useAuth();
  const role = userProfile?.role || null;
  const canView = CRM_SUPERVISOR_ROLES.includes(role);

  const [leads, setLeads]     = useState([]);
  const [adminId, setAdminId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);
  const channelRef = useRef(null);

  const reset = useCallback(() => {
    setLeads([]); setAdminId(null); setError(null); setLoading(true);
  }, []);

  const fetchLeads = useCallback(async () => {
    if (!canView) { setLoading(false); return; }
    setLoading(true);
    try {
      const tenant = await getTenantAdminId();
      setAdminId(tenant);

      // `is('agent_id', null)` is what makes this the supervisor's OWN book
      // rather than the whole tenant's. Both filters narrow what RLS already
      // allows — a tampered filter can only ever ask for less.
      const { data, error: err } = await supabase
        .from('leads')
        .select(LEAD_COLS)
        .eq('admin_id', tenant)
        .is('agent_id', null)
        .order('created_at', { ascending: false })
        .limit(ROW_LIMIT);

      if (err) throw err;
      setLeads(data || []);
      setError(null);
    } catch (err) {
      logger.error('[useSupervisorLeads] load failed', { message: err?.message });
      // On a database where 20260831140000 has not run there is no admin_id
      // column on leads to filter by, so this fails rather than returning
      // nothing. Say which, instead of rendering a confident empty pipeline.
      setError(err?.message
        ? `Could not load your pipeline: ${err.message}`
        : 'Could not load your pipeline.');
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, [canView]);

  useAuthScopedLoader(fetchLeads, reset);

  // A lead created on a phone should appear on the laptop, and the contact
  // counters on these rows are maintained by trigger — so a colleague logging a
  // call changes what this board says without this session writing anything.
  useEffect(() => {
    if (!canView) return undefined;
    const channel = supabase
      .channel(`supervisor_leads_${++_supervisorLeadsChannelSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => fetchLeads())
      .subscribe();
    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); channelRef.current = null; };
  }, [canView, fetchLeads]);

  // ── Writes ───────────────────────────────────────────────────────────────
  //
  // agent_id is never sent. The supervisor write policies require it to be
  // NULL, and admin_id is stamped from the session by trg_leads_stamp — so
  // neither ownership column is the caller's to choose, which is the point.

  /**
   * Take down a new prospect.
   *
   * Accepts the same form shape the agent portal's LeadRegistrationModal
   * produces, so the one form serves both callers rather than there being a
   * second one to keep in step with the same set of constraints.
   */
  const createLead = useCallback(async (form) => {
    const name = trimmed(form?.name ?? form?.fullName);
    if (!name) return { error: 'A lead needs a name.' };

    setSaving(true);
    try {
      const payload = {
        agent_id:            null,
        full_name:           name,
        phone:               trimmed(form?.phone),
        email:               trimmed(form?.email),
        asset_interest:      trimmed(form?.assetInterest),
        budget_range:        trimmed(form?.budgetRange),
        deal_value:          optionalNumber(form?.dealValue, 'Deal value'),
        expected_close_date: form?.expectedCloseDate || null,
        priority:            form?.priority || 'medium',
        stage:               PIPELINE_STAGE_VALUES.includes(form?.stage) ? form.stage : 'new_lead',
        source:              trimmed(form?.source),
        notes:               trimmed(form?.notes),
      };

      const { data, error: err } = await supabase
        .from('leads').insert(payload).select(LEAD_COLS).single();
      if (err) throw err;

      setLeads(prev => [data, ...prev]);
      return { data };
    } catch (err) {
      logger.error('[useSupervisorLeads] createLead failed', { message: err?.message });
      return { error: err?.message || 'Could not save that lead.' };
    } finally {
      setSaving(false);
    }
  }, []);

  /** Apply a patch to one of the tenant's own leads and keep local state true. */
  const patchLead = useCallback(async (leadId, patch, what = 'that lead') => {
    try {
      const { data, error: err } = await supabase
        .from('leads').update(patch).eq('id', leadId).select(LEAD_COLS).single();
      if (err) throw err;
      setLeads(prev => prev.map(l => (l.id === leadId ? data : l)));
      return { data };
    } catch (err) {
      logger.error('[useSupervisorLeads] update failed', { message: err?.message });
      return { error: err?.message || `Could not update ${what}.` };
    }
  }, []);

  /**
   * Edit the prospect's own details, as opposed to where the deal sits.
   *
   * Only the fields actually supplied are written: a form that sends an
   * untouched section would otherwise blank it.
   */
  const updateLead = useCallback((leadId, form = {}) => {
    const patch = {};
    if (form.name !== undefined || form.fullName !== undefined) {
      const name = trimmed(form.name ?? form.fullName);
      if (!name) return Promise.resolve({ error: 'A lead needs a name.' });
      patch.full_name = name;
    }
    if (form.phone !== undefined)         patch.phone = trimmed(form.phone);
    if (form.email !== undefined)         patch.email = trimmed(form.email);
    if (form.assetInterest !== undefined) patch.asset_interest = trimmed(form.assetInterest);
    if (form.budgetRange !== undefined)   patch.budget_range = trimmed(form.budgetRange);
    if (form.priority !== undefined)      patch.priority = form.priority || 'medium';
    if (form.source !== undefined)        patch.source = trimmed(form.source);
    if (form.notes !== undefined)         patch.notes = trimmed(form.notes);

    if (!Object.keys(patch).length) return Promise.resolve({ data: null });
    return patchLead(leadId, patch, 'that lead');
  }, [patchLead]);

  /**
   * Move a deal along the board.
   *
   * The lost reason rides along when the move is a close, because that is the
   * moment somebody knows it — asked later, it is a guess. Skippable: a
   * supervisor closing forty stale prospects should not be held up by a form,
   * and `recordLostReason` exists for the ones worth going back to.
   */
  const moveLeadStage = useCallback(async (leadId, stage, lost = null) => {
    if (!PIPELINE_STAGE_VALUES.includes(stage)) {
      return { error: 'That is not a pipeline stage.' };
    }
    const patch = { stage };
    if (stage === 'closed' && lost?.reason) {
      patch.lost_reason = lost.reason;
      patch.lost_notes  = trimmed(lost.notes);
    }
    return patchLead(leadId, patch, 'that deal');
  }, [patchLead]);

  /**
   * Record or correct why a deal was lost, after the fact.
   *
   * Only meaningful on a lead that IS lost: trg_leads_stamp_lost wipes the
   * whole lost_* set the moment a lead is revived or converted, so a reason
   * written against a live lead would simply vanish.
   */
  const recordLostReason = useCallback((leadId, { reason, notes } = {}) => patchLead(
    leadId,
    { lost_reason: reason || null, lost_notes: trimmed(notes) },
    'that reason',
  ), [patchLead]);

  /**
   * Price a deal: what it is worth, when it lands, and the odds it does.
   *
   * Separate from moveLeadStage because it is a different action with a
   * different rhythm — a stage moves one deal at a time, while pricing is a
   * batch somebody does down a list. Only what the caller actually passed is
   * written, so a caller that sends nothing gets no write rather than a row of
   * blanks.
   */
  const saveDeal = useCallback(async (leadId, { dealValue, expectedCloseDate, winProbability } = {}) => {
    const patch = {};
    try {
      if (dealValue !== undefined)         patch.deal_value = optionalNumber(dealValue, 'Deal value');
      if (expectedCloseDate !== undefined) patch.expected_close_date = expectedCloseDate || null;
      if (winProbability !== undefined) {
        const p = optionalNumber(winProbability, 'Win probability');
        if (p !== null && p > 100) throw new Error('Win probability cannot be above 100.');
        patch.win_probability = p === null ? null : Math.round(p);
      }
    } catch (err) {
      return { error: err.message };
    }

    if (!Object.keys(patch).length) return { data: null };
    return patchLead(leadId, patch, 'that deal');
  }, [patchLead]);

  const deleteLead = useCallback(async (leadId) => {
    try {
      const { error: err } = await supabase.from('leads').delete().eq('id', leadId);
      if (err) throw err;
      setLeads(prev => prev.filter(l => l.id !== leadId));
      return {};
    } catch (err) {
      logger.error('[useSupervisorLeads] deleteLead failed', { message: err?.message });
      return { error: err?.message || 'Could not remove that lead.' };
    }
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────

  const board       = useMemo(() => groupByStage(leads), [leads]);
  const summary     = useMemo(() => summariseLeadBook(leads), [leads]);
  const opportunity = useMemo(() => summariseOpportunities(leads), [leads]);

  /** The rows the interaction and follow-up forms offer as subjects. */
  const pickable = useMemo(
    () => leads.filter(isOpenLead).map(l => ({ id: l.id, full_name: l.full_name, phone: l.phone })),
    [leads],
  );

  /** Name resolution for rows that point at a lead but carry no label. */
  const leadName = useCallback((row) => {
    if (!row?.lead_id) return row?.contact_name || row?.lead_name || '';
    return leads.find(l => l.id === row.lead_id)?.full_name
      || row?.contact_name || row?.lead_name || '';
  }, [leads]);

  return {
    canView,
    adminId,
    leads,
    board,
    summary,
    opportunity,
    pickable,
    leadName,
    loading,
    saving,
    error,
    createLead,
    updateLead,
    moveLeadStage,
    recordLostReason,
    saveDeal,
    deleteLead,
    refetch: fetchLeads,
  };
};

export default useSupervisorLeads;

/**
 * useCrmInteractions
 *
 * The agent's contact history: one row per call, meeting, WhatsApp or site
 * visit, against the lead or client it was about.
 *
 * The portal already knew WHERE a lead sat (leads.stage) and WHEN it would next
 * be seen (follow_ups). What it could never say was WHAT HAD HAPPENED — the
 * only place to write that down was leads.notes, a single text column the next
 * edit overwrites. So "we've called this man four times and he still won't
 * commit" looked exactly like "nobody has ever rung him".
 *
 * The database keeps leads.interaction_count / last_contact_at in step through
 * a trigger (see 20260820120000_crm_interactions_and_oversight.sql), so a stale
 * count here is a refetch away, never a write this hook has to remember to do.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { logger } from '../utils/logger';

const DAY = 86400000;

/** A contact this old means the relationship has gone quiet. */
export const STALE_CONTACT_DAYS = 14;

/** How many rows the portal timeline holds before "load more" would be needed. */
const PAGE_SIZE = 200;

export const INTERACTION_TYPES = [
  { value: 'call',       label: 'Phone call',   icon: 'Phone',        tone: 'blue'    },
  { value: 'whatsapp',   label: 'WhatsApp',     icon: 'MessageCircle', tone: 'emerald' },
  { value: 'sms',        label: 'SMS',          icon: 'MessageSquare', tone: 'slate'   },
  { value: 'email',      label: 'Email',        icon: 'Mail',         tone: 'violet'  },
  { value: 'meeting',    label: 'Meeting',      icon: 'Users',        tone: 'amber'   },
  { value: 'site_visit', label: 'Site visit',   icon: 'MapPin',       tone: 'orange'  },
  { value: 'proposal',   label: 'Proposal sent', icon: 'FileText',    tone: 'indigo'  },
  { value: 'note',       label: 'Note',         icon: 'StickyNote',   tone: 'slate'   },
  { value: 'other',      label: 'Other',        icon: 'Circle',       tone: 'slate'   },
];

/**
 * Outcomes are a fixed list, not free text, because the oversight dashboard
 * counts them — and a column of prose cannot be counted. `sentiment` drives the
 * colour and the "positive contact" rate an admin is shown.
 */
export const INTERACTION_OUTCOMES = [
  { value: 'connected',      label: 'Spoke to them',    sentiment: 'neutral'  },
  { value: 'no_answer',      label: 'No answer',        sentiment: 'negative' },
  { value: 'interested',     label: 'Interested',       sentiment: 'positive' },
  { value: 'needs_info',     label: 'Wants more info',  sentiment: 'neutral'  },
  { value: 'rescheduled',    label: 'Rescheduled',      sentiment: 'neutral'  },
  { value: 'deal_agreed',    label: 'Deal agreed',      sentiment: 'positive' },
  { value: 'not_interested', label: 'Not interested',   sentiment: 'negative' },
  { value: 'lost',           label: 'Lost to someone else', sentiment: 'negative' },
];

export const typeMeta = (value) =>
  INTERACTION_TYPES.find(t => t.value === value)
  || { value, label: value || 'Contact', icon: 'Circle', tone: 'slate' };

export const outcomeMeta = (value) =>
  INTERACTION_OUTCOMES.find(o => o.value === value) || null;

/** Whole days between `iso` and now. Null when there is no usable date. */
export const daysSince = (iso, now = Date.now()) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / DAY);
};

/**
 * The numbers the agent's CRM panel puts above the timeline.
 *
 * Exported and pure so the arithmetic is testable without a database: every
 * count here is one an agent will be judged on, and "7 this week" being off by
 * a timezone is the kind of bug nobody reports and everybody distrusts.
 */
export const deriveInteractionStats = (interactions = [], now = Date.now()) => {
  const weekAgo  = now - 7 * DAY;
  const monthAgo = now - 30 * DAY;

  let thisWeek = 0;
  let thisMonth = 0;
  let positive = 0;
  let rated = 0;
  const byType = {};
  const contacts = new Set();

  for (const i of interactions) {
    const at = new Date(i?.occurred_at || i?.created_at || 0).getTime();
    if (!Number.isNaN(at)) {
      if (at >= weekAgo)  thisWeek  += 1;
      if (at >= monthAgo) thisMonth += 1;
    }
    byType[i?.interaction_type] = (byType[i?.interaction_type] || 0) + 1;

    const meta = outcomeMeta(i?.outcome);
    if (meta) {
      rated += 1;
      if (meta.sentiment === 'positive') positive += 1;
    }

    const key = i?.lead_id || i?.client_id || i?.contact_name;
    if (key) contacts.add(key);
  }

  return {
    total: interactions.length,
    thisWeek,
    thisMonth,
    contactsTouched: contacts.size,
    byType,
    // Share of RATED contacts that went well. Unrated rows are excluded rather
    // than counted as failures — an agent who skips the dropdown is not losing.
    positiveRate: rated ? Math.round((positive / rated) * 100) : null,
  };
};

/**
 * Leads that have gone quiet: open (not converted) and either never contacted
 * or last touched more than STALE_CONTACT_DAYS ago. Sorted coldest first —
 * this is a call list, so the top of it should be the most overdue call.
 */
export const deriveStaleLeads = (leads = [], now = Date.now(), thresholdDays = STALE_CONTACT_DAYS) =>
  leads
    .filter(l => l && !l.converted_at && l.stage !== 'closed')
    .map(l => ({ ...l, quietDays: daysSince(l.last_contact_at || l.created_at, now) }))
    .filter(l => l.quietDays === null || l.quietDays >= thresholdDays)
    .sort((a, b) => (b.quietDays ?? Infinity) - (a.quietDays ?? Infinity));

const SELECT_COLS =
  'id, agent_id, lead_id, client_id, contact_name, interaction_type, direction, ' +
  'subject, summary, outcome, duration_minutes, occurred_at, next_step, created_at, updated_at';

export const useCrmInteractions = (agentProfile) => {
  const agentId = agentProfile?.id || null;

  const [interactions, setInteractions] = useState([]);
  const [loading, setLoading] = useState(true);
  // An empty timeline and a failed fetch look identical, and "you have not
  // logged anything" is the one an agent believes — so say which it is.
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const channelRef = useRef(null);

  const fetchInteractions = useCallback(async (id = agentId) => {
    if (!id) { setInteractions([]); setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('crm_interactions')
        .select(SELECT_COLS)
        .eq('agent_id', id)
        .order('occurred_at', { ascending: false })
        .limit(PAGE_SIZE);
      if (err) throw err;
      setInteractions(data || []);
      setError(null);
    } catch (err) {
      logger.error('[useCrmInteractions] load failed', { message: err?.message });
      setError(err?.message || 'Could not load your contact history.');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { fetchInteractions(); }, [fetchInteractions]);

  // Same agent, two devices — a call logged on the phone should appear on the
  // laptop without a refresh.
  useEffect(() => {
    if (!agentId) return undefined;
    const channel = supabase
      .channel(`crm_interactions_${agentId}_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'crm_interactions', filter: `agent_id=eq.${agentId}` },
        () => { fetchInteractions(agentId); },
      )
      .subscribe();
    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); channelRef.current = null; };
  }, [agentId, fetchInteractions]);

  /**
   * Record a contact.
   *
   * agent_id comes from the resolved profile, never from the form — RLS checks
   * it against the caller's own agent row, so a supplied one would only ever be
   * a rejected write or somebody else's book.
   */
  const logInteraction = useCallback(async (input) => {
    if (!agentId) return { error: 'No agent profile' };
    setSaving(true);
    try {
      const payload = {
        agent_id:         agentId,
        lead_id:          input?.leadId   || null,
        client_id:        input?.clientId || null,
        contact_name:     input?.contactName?.trim() || null,
        interaction_type: input?.type      || 'call',
        direction:        input?.direction || 'outbound',
        subject:          input?.subject?.trim() || null,
        summary:          input?.summary?.trim() || null,
        outcome:          input?.outcome || null,
        duration_minutes: input?.durationMinutes ? Number(input.durationMinutes) : null,
        occurred_at:      input?.occurredAt || new Date().toISOString(),
        next_step:        input?.nextStep?.trim() || null,
      };

      const { data, error: err } = await supabase
        .from('crm_interactions')
        .insert(payload)
        .select(SELECT_COLS)
        .single();
      if (err) throw err;

      // Optimistic prepend so the timeline moves before realtime catches up.
      setInteractions(prev => [data, ...prev]);
      return { data };
    } catch (err) {
      logger.error('[useCrmInteractions] log failed', { message: err?.message });
      return { error: err?.message || 'Could not save that contact.' };
    } finally {
      setSaving(false);
    }
  }, [agentId]);

  const updateInteraction = useCallback(async (id, patch) => {
    try {
      const { data, error: err } = await supabase
        .from('crm_interactions')
        .update(patch)
        .eq('id', id)
        .select(SELECT_COLS)
        .single();
      if (err) throw err;
      setInteractions(prev => prev.map(i => (i.id === id ? data : i)));
      return { data };
    } catch (err) {
      logger.error('[useCrmInteractions] update failed', { message: err?.message });
      return { error: err?.message || 'Could not update that entry.' };
    }
  }, []);

  const deleteInteraction = useCallback(async (id) => {
    try {
      const { error: err } = await supabase.from('crm_interactions').delete().eq('id', id);
      if (err) throw err;
      setInteractions(prev => prev.filter(i => i.id !== id));
      return {};
    } catch (err) {
      logger.error('[useCrmInteractions] delete failed', { message: err?.message });
      return { error: err?.message || 'Could not remove that entry.' };
    }
  }, []);

  /** Timeline rows keyed by lead, for the lead detail modal. */
  const byLead = useMemo(() => {
    const map = {};
    for (const i of interactions) {
      if (!i?.lead_id) continue;
      (map[i.lead_id] ||= []).push(i);
    }
    return map;
  }, [interactions]);

  const stats = useMemo(() => deriveInteractionStats(interactions), [interactions]);

  return {
    interactions,
    byLead,
    stats,
    loading,
    error,
    saving,
    logInteraction,
    updateInteraction,
    deleteInteraction,
    refetch: fetchInteractions,
  };
};

export default useCrmInteractions;

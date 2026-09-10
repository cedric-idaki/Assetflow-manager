/**
 * useSalesTeam
 *
 * A sales manager's own team, seen from inside the sales agent portal.
 *
 * The manager is an ordinary agent as far as the rest of the portal is
 * concerned — they have a code, a target, a wallet and their own leads. This
 * hook adds the one thing the flat portal could never show them: what the
 * people reporting to them are doing.
 *
 * SCOPE IS THE DATABASE'S, NOT THIS FILE'S. Every query here is unfiltered by
 * manager: `sales_team_stats()` is SECURITY INVOKER and the lead read carries
 * no manager predicate. What comes back is whatever
 * `managers_read_team_leads` and friends allow, which for a manager is their
 * live team plus anything still credited to them. Writing the filter here as
 * well would be duplicating the boundary in the weaker of the two places — and
 * a filter in the client is a suggestion, while a policy is a rule.
 *
 * READ-ONLY, deliberately. There is no write in this file and there is no
 * policy that would accept one: a manager watches their team's book, they do
 * not work it. That is the same line 20260820120000 drew for supervisors, and
 * the reason is the same — a lead edited out from under the person working it
 * is worse than a lead nobody edited.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useAuthScopedLoader } from './useAuthScopedLoader';
import { logger } from '../utils/logger';
import { summariseTeam, isManager } from '../config/salesHierarchy';
import { stageMeta, isOpportunity, isLostLead } from '../config/crmVocabulary';
import { leadValue, weightedValue, isOpenLead } from '../utils/pipelineValue';

// Module-level counter, not Date.now(): two StrictMode mounts inside the same
// millisecond would ask supabase.channel() for a name it has already issued,
// and .on() after that channel subscribed throws. Same fix as useAdminCrm.
let _salesTeamChannelSeq = 0;

/** Deep enough for a large team's live book without paging the roll-up. */
const LEAD_LIMIT = 1000;

const TEAM_LEAD_COLS = 'id, agent_id, manager_id, full_name, phone, email, stage, priority, '
                     + 'source, deal_value, expected_close_date, win_probability, lost_reason, '
                     + 'lost_at, converted_at, next_follow_up_at, interaction_count, '
                     + 'last_contact_at, created_at, updated_at';

export const useSalesTeam = () => {
  const { user } = useAuth();

  const [agentProfile, setAgentProfile] = useState(null);
  const [team, setTeam]     = useState([]);     // sales_team_stats rows
  const [leads, setLeads]   = useState([]);     // the team's live book
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const channelRef = useRef(null);

  const reset = useCallback(() => {
    setAgentProfile(null); setTeam([]); setLeads([]); setError(null); setLoading(true);
  }, []);

  const fetchAll = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data: me, error: meErr } = await supabase
        .from('agents')
        .select('id, full_name, agent_code, agent_role, region, admin_id, target_amount')
        .eq('user_id', user.id)
        .maybeSingle();
      if (meErr) throw meErr;

      setAgentProfile(me || null);

      // Not a manager: nothing to load, and no query worth sending. The portal
      // hides the tab in this case, but a hook that fetched anyway would put a
      // pointless round trip on every agent's page load.
      if (!me || !isManager(me)) {
        setTeam([]); setLeads([]); setError(null);
        return;
      }

      const [statsRes, leadsRes] = await Promise.all([
        supabase.rpc('sales_team_stats'),
        supabase.from('leads')
          .select(TEAM_LEAD_COLS)
          .neq('agent_id', me.id)                 // the manager's own book is the portal's other tabs
          .order('updated_at', { ascending: false })
          .limit(LEAD_LIMIT),
      ]);

      if (statsRes.error) throw statsRes.error;
      setTeam(statsRes.data || []);

      // A team roster with no pipeline is still a useful screen; a screen that
      // refuses to render because one of two queries failed is not.
      if (leadsRes.error) {
        logger.warn('[useSalesTeam] team leads failed', { message: leadsRes.error.message });
        setLeads([]);
      } else {
        setLeads(leadsRes.data || []);
      }

      setError(null);
    } catch (err) {
      logger.error('[useSalesTeam] fetch failed', { message: err?.message });
      setError(err?.message || 'Could not load your team.');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  const userId = useAuthScopedLoader(fetchAll, reset);

  // An administrator can reassign an agent while the manager is looking at the
  // screen, and the honest thing for the screen to do is change.
  useEffect(() => {
    if (!userId) return undefined;

    const name = `sales_team_${userId}_${++_salesTeamChannelSeq}`;
    const channel = supabase
      .channel(name)
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'agent_manager_assignments' },
          () => { fetchAll(); })
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'leads' },
          () => { fetchAll(); })
      .subscribe();

    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); channelRef.current = null; };
  }, [userId, fetchAll]);

  // ── Derived ──────────────────────────────────────────────────────────────

  const isTeamLead = useMemo(() => isManager(agentProfile), [agentProfile]);
  const summary    = useMemo(() => summariseTeam(team), [team]);

  const agentsById = useMemo(
    () => new Map(team.map(r => [r.agent_id, r])),
    [team],
  );

  /** Whose lead this is, for a board that mixes several agents' cards. */
  const ownerOf = useCallback(
    (lead) => agentsById.get(lead?.agent_id)?.full_name || 'Unassigned',
    [agentsById],
  );

  /**
   * The team's pipeline, by agent, richest first.
   *
   * Money is what a manager sorts by — the agent with 40 dead leads is not the
   * one to talk to first. Open deals only: counting closed ones would make a
   * quarter that has already been banked look like work still to do.
   */
  const pipelineByAgent = useMemo(() => {
    const open = leads.filter(isOpenLead);
    const rows = team.map((r) => {
      const mine = open.filter(l => l.agent_id === r.agent_id);
      return {
        agent: r,
        openLeads: mine.length,
        value:    mine.reduce((sum, l) => sum + leadValue(l).value, 0),
        weighted: mine.reduce((sum, l) => sum + weightedValue(l), 0),
        opportunities: mine.filter(isOpportunity).length,
      };
    });
    return rows.sort((a, b) => b.value - a.value);
  }, [team, leads]);

  /** Attention list: the team's deals that have gone quiet or been lost. */
  const needsAttention = useMemo(() => {
    const lost = leads.filter(isLostLead).slice(0, 20);
    const unworked = leads
      .filter(l => isOpenLead(l) && !l.last_contact_at && !l.interaction_count)
      .slice(0, 20);
    return { lost, unworked };
  }, [leads]);

  /** The board, so the team view can render the same columns the agent sees. */
  const byStage = useMemo(() => {
    const map = {};
    for (const lead of leads) {
      const key = lead?.stage || 'new_lead';
      (map[key] ||= []).push(lead);
    }
    return Object.entries(map).map(([stage, rows]) => ({
      stage,
      label: stageMeta(stage).label,
      count: rows.length,
      value: rows.reduce((sum, l) => sum + leadValue(l).value, 0),
    }));
  }, [leads]);

  return {
    agentProfile,
    isTeamLead,
    team,
    leads,
    summary,
    pipelineByAgent,
    needsAttention,
    byStage,
    ownerOf,
    loading,
    error,
    refetch: fetchAll,
  };
};

export default useSalesTeam;

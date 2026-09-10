/**
 * useSalesHierarchy
 *
 * The administrator's view of the sales org chart: who manages whom, who
 * manages nobody, and what each team is worth.
 *
 * SCOPE. One tenant's `agents` rows plus the `agent_manager_assignments` that
 * join them. Both are already tenant-scoped by RLS, so nothing here can reach
 * another organisation's floor even if a filter were dropped.
 *
 * EVERY WRITE GOES THROUGH AN RPC, and that is not a style choice. The reason
 * is in migration 20260903120000: `tenant_manage_agents` is `for all` to every
 * staff member and is_staff_member() is true for sales_agent, so an agent can
 * already UPDATE any agent row in their tenant. If the reporting line lived in
 * a column this hook wrote directly, any agent could move themselves under a
 * different manager with one PATCH. assign_agent_to_manager() and
 * set_agent_manager_link_active() are SECURITY DEFINER and check
 * is_hierarchy_admin() server-side; `agent_manager_assignments` has no write
 * policy at all. `canManage` below only decides whether to render the buttons.
 *
 * PROMOTION is the one write that does touch `agents` directly — agent_role is
 * a column on that table, and the guard trigger enforces the same rule the RPCs
 * do, so a non-administrator's UPDATE is refused by Postgres rather than by
 * this file.
 *
 * The per-agent NUMBERS come from public.sales_team_stats(), not from counting
 * rows here. It is SECURITY INVOKER, so the same call serves an administrator
 * (their whole tenant) and a manager (their own team) without either seeing the
 * other's scope — and aggregating in SQL is the rule this codebase already
 * settled for dashboard totals: a figure reduced over a fetched array is a
 * figure for the page, not for the team.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { getTenantAdminId } from '../lib/tenant';
import { useAuth } from '../contexts/AuthContext';
import { useAuthScopedLoader } from './useAuthScopedLoader';
import { logger } from '../utils/logger';
import {
  canAdministerHierarchy, buildOrgChart, managersOf,
  summariseTeam, explainAssignmentProblem, isManager,
} from '../config/salesHierarchy';

// Module-level counter, not Date.now(): StrictMode mounts an effect twice and
// both runs can land inside the same millisecond. supabase.channel(name)
// returns the EXISTING channel for a name already in use, and calling .on()
// after that channel has subscribed throws — which the error boundary renders
// as a blank "Something went wrong" page. Same fix as useAdminCrm.
let _hierarchyChannelSeq = 0;

const AGENT_COLS = 'id, user_id, admin_id, agent_code, full_name, email, phone, region, '
                 + 'agent_status, agent_role, manager_id, agent_type, agent_plan, '
                 + 'commission_rate, total_sales, total_commission, target_amount, created_at';

const LINK_COLS = 'id, agent_id, manager_id, admin_id, is_primary, is_active, '
                + 'authorized_by, authorization_note, assigned_by, assigned_at, '
                + 'ended_by, ended_at, end_reason, created_at, updated_at';

/**
 * Turn a Postgres error into something a person can act on.
 *
 * The RPCs raise sentences on purpose, so the default is to show what the
 * database said. The two codes below are the ones whose native text is
 * unreadable, and both mean something specific enough to say plainly.
 */
const readableError = (err, fallback) => {
  const msg = err?.message || '';
  if (err?.code === '42501' || /not authoris|not authoriz|permission denied/i.test(msg)) {
    return msg.includes('administrator')
      ? msg
      : 'Only a super admin or an administrator may change a reporting line.';
  }
  if (err?.code === '23505' || /duplicate key/i.test(msg)) {
    return 'That agent already reports to a manager — reassign them instead.';
  }
  return msg || fallback;
};

export const useSalesHierarchy = () => {
  const { userProfile } = useAuth();
  const role = userProfile?.role || null;
  const canManage = canAdministerHierarchy(role);

  const [agents, setAgents]           = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [teamStats, setTeamStats]     = useState([]);
  const [adminId, setAdminId]         = useState(null);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState(null);
  const channelRef = useRef(null);

  const reset = useCallback(() => {
    setAgents([]); setAssignments([]); setTeamStats([]);
    setAdminId(null); setError(null); setLoading(true);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const tenant = await getTenantAdminId();
      setAdminId(tenant);

      // History is loaded alongside the live lines rather than on demand: the
      // closed rows are what answer "who used to manage this agent", and that
      // question is asked from the same drawer as the live one.
      const [agentsRes, linksRes, statsRes] = await Promise.all([
        supabase.from('agents').select(AGENT_COLS)
          .eq('admin_id', tenant)
          .order('agent_role', { ascending: false })    // managers first
          .order('full_name', { ascending: true }),
        supabase.from('agent_manager_assignments').select(LINK_COLS)
          .eq('admin_id', tenant)
          .order('created_at', { ascending: false }),
        supabase.rpc('sales_team_stats'),
      ]);

      if (agentsRes.error) throw agentsRes.error;
      if (linksRes.error)  throw linksRes.error;

      setAgents(agentsRes.data || []);
      setAssignments(linksRes.data || []);

      // The roster is the screen; the numbers decorate it. A stats failure
      // shows an org chart without figures rather than an error page.
      if (statsRes.error) {
        logger.warn('[useSalesHierarchy] sales_team_stats failed', { message: statsRes.error.message });
        setTeamStats([]);
      } else {
        setTeamStats(statsRes.data || []);
      }

      setError(null);
    } catch (err) {
      logger.error('[useSalesHierarchy] fetch failed', { message: err?.message });
      setError(err?.message || 'Could not load the sales team.');
    } finally {
      setLoading(false);
    }
  }, []);

  const userId = useAuthScopedLoader(fetchAll, reset);

  // ── Realtime ─────────────────────────────────────────────────────────────
  // Reporting lines are changed by administrators, and more than one of them
  // can be in this screen at once. Refetching on notification rather than
  // patching from the payload keeps the derived roll-ups honest — a payload
  // carries one row, and the team totals depend on all of them.
  useEffect(() => {
    if (!userId) return undefined;

    const name = `sales_hierarchy_${userId}_${++_hierarchyChannelSeq}`;
    const channel = supabase
      .channel(name)
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'agent_manager_assignments' },
          () => { fetchAll(); })
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'agents' },
          () => { fetchAll(); })
      .subscribe();

    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); channelRef.current = null; };
  }, [userId, fetchAll]);

  // ── Writes ───────────────────────────────────────────────────────────────

  /**
   * Assign, reassign, or add an authorised second manager.
   *
   * One call for all three because the database makes no distinction either:
   * naming a primary manager for an agent who already has one IS the
   * reassignment, and doing it in one statement is what stops the agent being
   * momentarily unmanaged.
   */
  const assignManager = useCallback(async ({
    agentId, managerId, isPrimary = true, note = '', transferHistory = false,
  }) => {
    const agent   = agents.find(a => a.id === agentId) || null;
    const manager = agents.find(a => a.id === managerId) || null;

    // Local pre-flight so an obvious mistake is answered instantly and in the
    // same words the database would have used. It decides nothing: the RPC
    // re-checks all of it server-side.
    const problem = explainAssignmentProblem({
      agent, manager, isPrimary, note, existingLinks: assignments,
    });
    if (problem) return { error: problem };

    setSaving(true);
    try {
      const { data, error: err } = await supabase.rpc('assign_agent_to_manager', {
        p_agent_id:         agentId,
        p_manager_id:       managerId,
        p_is_primary:       isPrimary,
        p_note:             String(note ?? '').trim() || null,
        p_transfer_history: Boolean(transferHistory),
      });
      if (err) throw err;

      await fetchAll();
      return { data };
    } catch (err) {
      logger.error('[useSalesHierarchy] assignManager failed', { message: err?.message });
      return { error: readableError(err, 'Could not change that reporting line.') };
    } finally {
      setSaving(false);
    }
  }, [agents, assignments, fetchAll]);

  /** Activate or deactivate one line. Deactivating keeps it as history. */
  const setLinkActive = useCallback(async (assignmentId, active, note = '') => {
    setSaving(true);
    try {
      const { data, error: err } = await supabase.rpc('set_agent_manager_link_active', {
        p_assignment_id: assignmentId,
        p_active:        Boolean(active),
        p_note:          String(note ?? '').trim() || null,
      });
      if (err) throw err;

      await fetchAll();
      return { data };
    } catch (err) {
      logger.error('[useSalesHierarchy] setLinkActive failed', { message: err?.message });
      return { error: readableError(err, 'Could not change that reporting line.') };
    } finally {
      setSaving(false);
    }
  }, [fetchAll]);

  /**
   * Promote an agent to sales manager, or put a manager back on the floor.
   *
   * Demotion is the one that needs saying out loud: the database closes every
   * line under that manager, so their team becomes unassigned in the same
   * transaction. The caller is expected to have warned somebody first —
   * `teamSizeOf` exists so the confirm dialog can say how many people it is
   * about to leave without a manager.
   */
  const setAgentRole = useCallback(async (agentId, nextRole) => {
    if (!['agent', 'manager'].includes(nextRole)) {
      return { error: 'A sales agent is either an agent or a manager.' };
    }

    setSaving(true);
    try {
      const { data, error: err } = await supabase
        .from('agents')
        .update({ agent_role: nextRole })
        .eq('id', agentId)
        .select(AGENT_COLS)
        .maybeSingle();
      if (err) throw err;

      // Zero rows is not an error to PostgREST. Here it means RLS or the guard
      // trigger silently declined the write, which must not read as success.
      if (!data) {
        return { error: 'That change was refused — only an administrator may promote or demote a sales manager.' };
      }

      await fetchAll();
      return { data };
    } catch (err) {
      logger.error('[useSalesHierarchy] setAgentRole failed', { message: err?.message });
      return { error: readableError(err, 'Could not change that agent role.') };
    } finally {
      setSaving(false);
    }
  }, [fetchAll]);

  // ── Derived ──────────────────────────────────────────────────────────────

  const liveLinks = useMemo(() => assignments.filter(l => l.is_active), [assignments]);
  const history   = useMemo(() => assignments.filter(l => !l.is_active), [assignments]);

  const orgChart = useMemo(
    () => buildOrgChart(agents, liveLinks),
    [agents, liveLinks],
  );

  const managers = useMemo(() => agents.filter(isManager), [agents]);
  const fieldAgents = useMemo(() => agents.filter(a => !isManager(a)), [agents]);

  /** Per-manager stat rows, keyed so a team card can find its own figures. */
  const statsByManager = useMemo(() => {
    const map = new Map();
    for (const row of teamStats) {
      if (!row?.manager_id) continue;
      if (!map.has(row.manager_id)) map.set(row.manager_id, []);
      map.get(row.manager_id).push(row);
    }
    return map;
  }, [teamStats]);

  /** One manager's per-agent rows, or the whole floor's when none is named. */
  const statsFor = useCallback(
    (managerId) => (managerId ? (statsByManager.get(managerId) || []) : teamStats),
    [statsByManager, teamStats],
  );

  /** One manager's roll-up, or the whole floor's when no manager is named. */
  const summaryFor = useCallback(
    (managerId) => summariseTeam(statsFor(managerId)),
    [statsFor],
  );

  const teamSizeOf = useCallback(
    (managerId) => liveLinks.filter(l => l.manager_id === managerId && l.is_primary).length,
    [liveLinks],
  );

  const managersForAgent = useCallback(
    (agentId) => managersOf(agentId, liveLinks, agents),
    [liveLinks, agents],
  );

  const historyForAgent = useCallback(
    (agentId) => history.filter(l => l.agent_id === agentId),
    [history],
  );

  /** Who this agent reports to today, or null. Reads the projected column. */
  const primaryManagerOf = useCallback((agent) => {
    if (!agent?.manager_id) return null;
    return agents.find(a => a.id === agent.manager_id) || null;
  }, [agents]);

  return {
    canManage,
    adminId,
    agents,
    managers,
    fieldAgents,
    assignments,
    liveLinks,
    history,
    orgChart,
    teamStats,
    loading,
    saving,
    error,
    // writes
    assignManager,
    setLinkActive,
    setAgentRole,
    // lookups
    statsFor,
    summaryFor,
    teamSizeOf,
    managersForAgent,
    historyForAgent,
    primaryManagerOf,
    refetch: fetchAll,
  };
};

export default useSalesHierarchy;

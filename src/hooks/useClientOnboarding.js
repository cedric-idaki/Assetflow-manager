/**
 * useClientOnboarding
 *
 * The installation and onboarding board: every tenant the platform has taken an
 * installation fee from, what state that installation is in, who is responsible
 * for it, when it is booked, and how much of the checklist is done.
 *
 * READS COME FROM TWO RPCs, NOT FROM THE TABLE.
 *
 *   client_onboarding_board()   resolves the client's NAME, which lives in
 *                               company_profiles for a company and saccos for a
 *                               society. Doing that join in the browser means
 *                               three round trips and a third copy of the
 *                               coalesce; doing it in Postgres means one.
 *   client_onboarding_summary() aggregates over the WHOLE book. The KPI row is
 *                               never reduced from the rows on screen — a total
 *                               of one page is the number an operations lead
 *                               must never be shown (same rule as
 *                               sacco_dashboard_stats).
 *
 * WRITES GO STRAIGHT TO THE TABLES. The invariants that matter are triggers, not
 * application code: assignment stamps, completion stamps, clearing a stale
 * completion when a record is re-opened, and recounting the parent's progress
 * all live in 20260901180000_client_onboarding_tracking.sql and hold no matter
 * who writes. RLS restricts every one of those writes to a super admin; the
 * tenant's own staff can read their record and nothing more.
 *
 * STEPS ARE LOADED PER RECORD, not for the whole board. Eleven rows times every
 * tenant on the platform is a payload nobody looks at — the list needs the
 * counters the trigger maintains, and the drawer needs the eleven rows for the
 * one client that is open.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { logger } from '../utils/logger';

// A module-level counter, not Date.now(): StrictMode mounts effects twice and
// both runs can land in the same millisecond, and supabase.channel() hands back
// the already-subscribed channel for a name in use — which then throws when
// .on() is called on it.
let _onboardingChannelSeq = 0;

/** The board caps at 500 server-side; this is the page the screen asks for. */
export const BOARD_LIMIT = 200;

const EMPTY_SUMMARY = {
  total: 0,
  notStarted: 0,
  scheduled: 0,
  inProgress: 0,
  onHold: 0,
  completed: 0,
  cancelled: 0,
  unassigned: 0,
  overdue: 0,
  dueThisWeek: 0,
  avgDaysToComplete: null,
};

/** snake_case off the RPC, camelCase for the components. One place, once. */
const shapeSummary = (row) => {
  if (!row) return EMPTY_SUMMARY;
  return {
    total:         Number(row.total) || 0,
    notStarted:    Number(row.not_started) || 0,
    scheduled:     Number(row.scheduled) || 0,
    inProgress:    Number(row.in_progress) || 0,
    onHold:        Number(row.on_hold) || 0,
    completed:     Number(row.completed) || 0,
    cancelled:     Number(row.cancelled) || 0,
    unassigned:    Number(row.unassigned) || 0,
    overdue:       Number(row.overdue) || 0,
    dueThisWeek:   Number(row.due_this_week) || 0,
    // Null, not 0: "no installation has ever been completed" and "they complete
    // the same day" are different facts and the card must not print 0 for both.
    avgDaysToComplete: row.avg_days_to_complete === null || row.avg_days_to_complete === undefined
      ? null
      : Number(row.avg_days_to_complete),
  };
};

/**
 * The signed-in user's tenant, resolved the way public.current_admin_id() does
 * it server-side so a client-side filter and an RLS policy always agree.
 */
const getTenantId = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return null;
  const { data } = await supabase.from('user_profiles').select('admin_id').eq('id', uid).maybeSingle();
  return data?.admin_id || uid;
};

const useClientOnboarding = () => {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [installers, setInstallers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters. Held here rather than in the component because the board is
  // filtered server-side — the RPC takes them, so a filter change is a refetch.
  const [statusFilter, setStatusFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [search, setSearch] = useState('');

  // The open record's checklist, keyed by onboarding id so re-opening the same
  // client does not flash an empty list while the refetch lands.
  const [steps, setSteps] = useState({});
  const [stepsLoading, setStepsLoading] = useState(false);

  const filtersRef = useRef({ statusFilter, assigneeFilter, search });
  useEffect(() => {
    filtersRef.current = { statusFilter, assigneeFilter, search };
  }, [statusFilter, assigneeFilter, search]);

  // ── The board ────────────────────────────────────────────────────────────
  const loadBoard = useCallback(async () => {
    const { statusFilter: st, assigneeFilter: as, search: q } = filtersRef.current;
    try {
      const { data, error: rpcError } = await supabase.rpc('client_onboarding_board', {
        p_status: st && st !== 'all' ? st : null,
        p_assigned_to: as && as !== 'all' && as !== 'unassigned' ? as : null,
        p_search: q ? q.trim() : null,
        p_limit: BOARD_LIMIT,
        p_offset: 0,
      });
      if (rpcError) throw rpcError;

      // "Unassigned" is not a person, so it cannot be an argument to the RPC's
      // assignee filter. It is the absence of one, applied here.
      const list = data || [];
      setRows(as === 'unassigned' ? list.filter(r => !r.assigned_to) : list);
      setError(null);
    } catch (err) {
      logger.error('client onboarding board failed', { error: err.message });
      setError(err.message || 'Could not load the onboarding board.');
      setRows([]);
    }
  }, []);

  const loadSummary = useCallback(async () => {
    try {
      const { data, error: rpcError } = await supabase.rpc('client_onboarding_summary');
      if (rpcError) throw rpcError;
      setSummary(shapeSummary(Array.isArray(data) ? data[0] : data));
    } catch (err) {
      logger.error('client onboarding summary failed', { error: err.message });
      setSummary(EMPTY_SUMMARY);
    }
  }, []);

  /**
   * Who may be put down as responsible.
   *
   * The PLATFORM'S own people: the super admin, and the staff accounts whose
   * admin_id points at them. Filtering by role alone would offer every tenant's
   * accountant and manager as well — a super admin reads every profile through
   * is_global_viewer(), so the role list on its own is not a scope.
   */
  const loadInstallers = useCallback(async () => {
    try {
      const tenantId = await getTenantId();
      if (!tenantId) { setInstallers([]); return; }

      const { data, error: qError } = await supabase
        .from('user_profiles')
        .select('id, full_name, email, role, is_active')
        .or(`admin_id.eq.${tenantId},id.eq.${tenantId}`)
        .order('full_name', { ascending: true });
      if (qError) throw qError;

      // Inactive accounts are kept out of the picker but NOT out of the board:
      // a record already assigned to someone who has since left must keep
      // showing that name, which is why this only feeds the dropdown.
      setInstallers((data || []).filter(u => u.is_active !== false));
    } catch (err) {
      logger.error('client onboarding installers failed', { error: err.message });
      setInstallers([]);
    }
  }, []);

  const refetch = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadBoard(), loadSummary(), loadInstallers()]);
    setLoading(false);
  }, [loadBoard, loadSummary, loadInstallers]);

  useEffect(() => { refetch(); }, [refetch]);

  // A filter change refetches the board only — the KPI row is deliberately the
  // whole book and must not move when somebody narrows the list. The first run
  // is skipped because refetch() above has already loaded the unfiltered board;
  // without the guard every mount fetches it twice.
  const filtersMountedRef = useRef(false);
  useEffect(() => {
    if (!filtersMountedRef.current) {
      filtersMountedRef.current = true;
      return undefined;
    }
    // Debounced because `search` changes on every keystroke and the board is a
    // server-side ILIKE over four columns.
    const t = setTimeout(loadBoard, 250);
    return () => clearTimeout(t);
  }, [statusFilter, assigneeFilter, search, loadBoard]);

  // ── One record's checklist ───────────────────────────────────────────────
  const loadSteps = useCallback(async (onboardingId) => {
    if (!onboardingId) return [];
    setStepsLoading(true);
    try {
      const { data, error: qError } = await supabase
        .from('client_onboarding_steps')
        .select('*')
        .eq('onboarding_id', onboardingId)
        .order('sort_order', { ascending: true });
      if (qError) throw qError;

      // Names are looked up in a second query rather than embedded. completed_by
      // carries no foreign key on purpose — the point of it is to survive the
      // person leaving, and an FK would have to choose between SET NULL (losing
      // who did the work) and CASCADE (losing the work). PostgREST can only
      // embed across a key, so the join is done here, the same way the audit
      // trail resolves its actors.
      const rowsIn = data || [];
      const ids = [...new Set(rowsIn.flatMap(s => [s.owner_id, s.completed_by]).filter(Boolean))];
      let names = {};
      if (ids.length) {
        const { data: people } = await supabase
          .from('user_profiles')
          .select('id, full_name')
          .in('id', ids);
        (people || []).forEach((p) => { names[p.id] = p.full_name; });
      }

      const shaped = rowsIn.map(s => ({
        ...s,
        owner_name: s.owner_id ? (names[s.owner_id] || null) : null,
        completed_by_name: s.completed_by ? (names[s.completed_by] || null) : null,
      }));

      setSteps(prev => ({ ...prev, [onboardingId]: shaped }));
      return shaped;
    } catch (err) {
      logger.error('client onboarding steps failed', { error: err.message });
      return [];
    } finally {
      setStepsLoading(false);
    }
  }, []);

  // ── Writes ───────────────────────────────────────────────────────────────
  /**
   * Every mutation returns the updated row and refreshes what changed.
   *
   * The board is re-read rather than patched in place because the triggers
   * derive half the row — completed_at, installation_date, started_at,
   * steps_done, progress_pct — and a client-side guess at those would be a
   * second implementation of rules that already exist in one place.
   */
  const updateRecord = useCallback(async (id, patch) => {
    if (!id) return null;
    const { data, error: upError } = await supabase
      .from('client_onboardings')
      .update(patch)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (upError) {
      logger.error('client onboarding update failed', { error: upError.message, id });
      throw upError;
    }
    await Promise.all([loadBoard(), loadSummary()]);
    return data;
  }, [loadBoard, loadSummary]);

  /** Put someone's name against this installation, or take it off. */
  const assign = useCallback((id, userId) =>
    updateRecord(id, { assigned_to: userId || null }), [updateRecord]);

  /**
   * Move the installation to a new state.
   *
   * `on_hold_reason` is only sent with 'on_hold'; the trigger clears it for
   * every other status anyway, and sending it would suggest otherwise.
   */
  const setStatus = useCallback((id, status, { onHoldReason = null } = {}) =>
    updateRecord(id, status === 'on_hold'
      ? { status, on_hold_reason: onHoldReason || null }
      : { status }), [updateRecord]);

  /** Book it, or record the day it actually happened. */
  const setDates = useCallback((id, { scheduledDate, installationDate } = {}) => {
    const patch = {};
    if (scheduledDate !== undefined) patch.scheduled_date = scheduledDate || null;
    if (installationDate !== undefined) patch.installation_date = installationDate || null;
    return updateRecord(id, patch);
  }, [updateRecord]);

  const saveNotes = useCallback((id, notes) =>
    updateRecord(id, { notes: notes || null }), [updateRecord]);

  /**
   * Sign the whole job off.
   *
   * The date is optional here: the trigger falls back to the booked date and
   * then to today, so a sign-off can never land without one.
   */
  const complete = useCallback((id, installationDate = undefined) => {
    const patch = { status: 'completed' };
    if (installationDate) patch.installation_date = installationDate;
    return updateRecord(id, patch);
  }, [updateRecord]);

  const updateStep = useCallback(async (onboardingId, stepId, patch) => {
    if (!stepId) return null;
    const { error: upError } = await supabase
      .from('client_onboarding_steps')
      .update(patch)
      .eq('id', stepId);
    if (upError) {
      logger.error('client onboarding step update failed', { error: upError.message, stepId });
      throw upError;
    }
    // The step trigger recounts the parent, so the board moves too.
    await Promise.all([loadSteps(onboardingId), loadBoard(), loadSummary()]);
    return true;
  }, [loadSteps, loadBoard, loadSummary]);

  const setStepStatus = useCallback((onboardingId, stepId, status) =>
    updateStep(onboardingId, stepId, { status }), [updateStep]);

  /**
   * A step this client needs that the shipped eleven do not cover.
   *
   * Sorted to the end of its phase by taking the highest sort_order in hand and
   * adding one, so a bespoke step never lands in the middle of the standard run.
   */
  const addStep = useCallback(async (onboardingId, { label, phase = 'install', dueDate = null } = {}) => {
    const clean = String(label || '').trim();
    if (!onboardingId || !clean) return null;

    const existing = steps[onboardingId] || [];
    const nextOrder = existing.reduce((m, s) => Math.max(m, Number(s.sort_order) || 0), 0) + 1;
    const stepKey = `custom_${Date.now().toString(36)}`;

    const { error: insError } = await supabase
      .from('client_onboarding_steps')
      .insert({
        onboarding_id: onboardingId,
        step_key: stepKey,
        label: clean,
        phase,
        sort_order: nextOrder,
        due_date: dueDate || null,
      });
    if (insError) {
      logger.error('client onboarding add step failed', { error: insError.message });
      throw insError;
    }
    await Promise.all([loadSteps(onboardingId), loadBoard(), loadSummary()]);
    return stepKey;
  }, [steps, loadSteps, loadBoard, loadSummary]);

  const removeStep = useCallback(async (onboardingId, stepId) => {
    const { error: delError } = await supabase
      .from('client_onboarding_steps')
      .delete()
      .eq('id', stepId);
    if (delError) {
      logger.error('client onboarding remove step failed', { error: delError.message });
      throw delError;
    }
    await Promise.all([loadSteps(onboardingId), loadBoard(), loadSummary()]);
    return true;
  }, [loadSteps, loadBoard, loadSummary]);

  // ── Realtime ─────────────────────────────────────────────────────────────
  // Installations are worked by more than one person at once — an installer
  // ticking steps on site while an ops lead watches the board. Both tables are
  // watched; the steps table is what moves the progress bars.
  useEffect(() => {
    const ch = supabase
      .channel(`client_onboarding_${++_onboardingChannelSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_onboardings' }, () => {
        loadBoard();
        loadSummary();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_onboarding_steps' }, () => {
        loadBoard();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadBoard, loadSummary]);

  return {
    rows, summary, installers, steps, loading, stepsLoading, error,
    statusFilter, setStatusFilter,
    assigneeFilter, setAssigneeFilter,
    search, setSearch,
    refetch, loadSteps,
    assign, setStatus, setDates, saveNotes, complete,
    setStepStatus, updateStep, addStep, removeStep,
  };
};

export default useClientOnboarding;

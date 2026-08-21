/**
 * useStaffActivity
 *
 * What the people in your tenant are actually doing in the system — the staff
 * equivalent of the sales CRM. The CRM answers "who is talking to customers";
 * this answers "who is using the system at all, and what are they touching".
 *
 * Source is public.audit_logs, which every write path already stamps. Nothing
 * new is recorded and no new RLS is added: the existing tenant_view_audit_logs
 * policy already admits a tenant's staff rows.
 *
 * SCOPE follows the same rule as the CRM (see 20260820140000): you see your own
 * people. A super admin sees the staff it owns — not every tenant's staff — even
 * though the audit_logs policy would technically allow more through
 * is_global_viewer(). Narrowing in the query is safe; widening would not be.
 *
 * The signed-in owner is included in their own report, flagged `isSelf`. They
 * are not their own staff in an org-chart sense, but on this database EVERY
 * audit row belongs to a tenant owner and none to a staff member — so leaving
 * them out renders a page of zeros that reads as "nothing is happening" while
 * the account is in daily use.
 *
 * ── The ownership drift this has to cope with ─────────────────────────────
 * `agents.admin_id` and `user_profiles.admin_id` DISAGREE on this database.
 * Eric Nganga has agents.admin_id = the admin, but user_profiles.admin_id NULL.
 * Two consequences, both handled here rather than hidden:
 *
 *   1. Scoping staff by user_profiles.admin_id alone would drop him from this
 *      report while the CRM tab (scoped by agents.admin_id) still shows him —
 *      the same person present in one screen and missing from the next. So the
 *      staff list is the UNION of both sources.
 *
 *   2. His audit rows are stamped admin_id = his own id, because
 *      current_admin_id() coalesces a NULL admin_id to the user's own uid. The
 *      tenant policy therefore hides them from his admin. He is flagged
 *      `ownershipMismatch` so the report can say "activity may be missing"
 *      instead of showing a confident 0 — which would read as "Eric does
 *      nothing" when the truth is "we cannot see".
 */

import { useState, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { getTenantAdminId } from '../lib/tenant';
import { useAuth } from '../contexts/AuthContext';
import { useAuthScopedLoader } from './useAuthScopedLoader';
import { logger } from '../utils/logger';

const DAY = 86400000;

/** Roles allowed to watch their staff. Same list the CRM supervisor uses. */
export const STAFF_WATCHER_ROLES = ['super_admin', 'admin', 'director', 'manager', 'sacco_admin'];

/** Not staff — they are customers of a tenant, not people working in it. */
const NON_STAFF_ROLES = ['client', 'sacco_member'];

/** A staff member silent this long is worth asking about. */
export const IDLE_DAYS = 14;

const ROW_LIMIT = 3000;

/** How each audit action reads on screen. */
export const ACTION_META = {
  create:       { label: 'Created',  icon: 'Plus',      tone: 'emerald' },
  update:       { label: 'Updated',  icon: 'Edit2',     tone: 'blue'    },
  delete:       { label: 'Deleted',  icon: 'Trash2',    tone: 'red'     },
  login:        { label: 'Signed in',  icon: 'LogIn',   tone: 'slate'   },
  logout:       { label: 'Signed out', icon: 'LogOut',  tone: 'slate'   },
  user_created: { label: 'Added a user', icon: 'UserPlus', tone: 'violet' },
  approve:      { label: 'Approved', icon: 'Check',     tone: 'emerald' },
  reject:       { label: 'Rejected', icon: 'X',         tone: 'red'     },
};

export const actionMeta = (action) =>
  ACTION_META[action] || { label: action || 'Action', icon: 'Activity', tone: 'slate' };

/** Whole days since `iso`, or null when there is no usable date. */
export const daysSince = (iso, now = Date.now()) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / DAY);
};

/**
 * One row per staff member. Pure and exported so the arithmetic is testable —
 * these numbers get used to judge people, so "0 actions" being wrong matters.
 *
 * A person whose audit rows the caller cannot read is NOT reported as zero.
 * `activityVisible` is false for them and the report says so instead.
 */
export const buildStaffCards = ({ staff = [], logs = [], now = Date.now() } = {}) => {
  const byUser = new Map();
  for (const s of staff) byUser.set(s.id, []);
  for (const l of logs) {
    if (!l?.user_id) continue;
    if (!byUser.has(l.user_id)) byUser.set(l.user_id, []);
    byUser.get(l.user_id).push(l);
  }

  const staffById = new Map(staff.map(s => [s.id, s]));

  const cards = [];
  for (const [userId, rows] of byUser.entries()) {
    const person = staffById.get(userId) || { id: userId, full_name: 'Unknown user' };

    const byAction = {};
    const byTable = {};
    const activeDays = new Set();
    let lastAt = null;

    for (const r of rows) {
      byAction[r.action] = (byAction[r.action] || 0) + 1;
      if (r.table_name) byTable[r.table_name] = (byTable[r.table_name] || 0) + 1;
      const t = new Date(r.created_at).getTime();
      if (!Number.isNaN(t)) {
        activeDays.add(new Date(t).toISOString().slice(0, 10));
        if (!lastAt || t > lastAt) lastAt = t;
      }
    }

    const topTable = Object.entries(byTable).sort((a, b) => b[1] - a[1])[0] || null;

    // The mismatch means their rows are stamped under a different tenant, so an
    // empty list here is "not readable", not "did nothing".
    const activityVisible = !person.ownershipMismatch || rows.length > 0;

    cards.push({
      userId,
      person,
      name:  person.full_name || person.email || 'Unknown user',
      email: person.email || null,
      role:  person.role || null,
      isActive: person.is_active !== false,
      isSelf: Boolean(person.isSelf),
      ownershipMismatch: Boolean(person.ownershipMismatch),
      activityVisible,
      actions: rows.length,
      byAction,
      creates: byAction.create || 0,
      updates: byAction.update || 0,
      deletes: byAction.delete || 0,
      logins:  byAction.login || 0,
      activeDays: activeDays.size,
      topArea: topTable ? { table: topTable[0], count: topTable[1] } : null,
      lastActiveAt: lastAt ? new Date(lastAt).toISOString() : null,
      idleDays: lastAt ? daysSince(new Date(lastAt).toISOString(), now) : null,
      // Never worked, as far as anything readable shows.
      neverActive: activityVisible && rows.length === 0,
    });
  }

  // Busiest first; people with nothing sink to the bottom but stay on the page,
  // because "did nothing" is the finding, not a row to hide.
  return cards.sort((a, b) => (b.actions - a.actions) || a.name.localeCompare(b.name));
};

/** Headline numbers for the strip above the table. */
export const buildStaffTotals = ({ cards = [], logs = [], now = Date.now() } = {}) => {
  const weekAgo = now - 7 * DAY;
  const activeThisWeek = cards.filter(c =>
    c.lastActiveAt && new Date(c.lastActiveAt).getTime() >= weekAgo).length;

  return {
    staff: cards.length,
    activeThisWeek,
    idle: cards.filter(c =>
      c.activityVisible && (c.idleDays === null || c.idleDays >= IDLE_DAYS)).length,
    unreadable: cards.filter(c => !c.activityVisible).length,
    actions: logs.length,
    actionsThisWeek: logs.filter(l => {
      const t = new Date(l?.created_at).getTime();
      return !Number.isNaN(t) && t >= weekAgo;
    }).length,
    deletes: logs.filter(l => l?.action === 'delete').length,
  };
};

const STAFF_COLS = 'id, email, full_name, role, department, is_active, admin_id, created_at';
const LOG_COLS   = 'id, user_id, action, table_name, record_id, description, severity, created_at, client_name';

export const useStaffActivity = ({ from = null, to = null } = {}) => {
  const { userProfile } = useAuth();
  const role = userProfile?.role || null;
  const canView = STAFF_WATCHER_ROLES.includes(role);

  const [staff, setStaff] = useState([]);
  const [logs, setLogs]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reset = useCallback(() => {
    setStaff([]); setLogs([]); setError(null); setLoading(true);
  }, []);

  const fetchAll = useCallback(async () => {
    if (!canView) { setLoading(false); return; }
    setLoading(true);
    try {
      const adminId = await getTenantAdminId();
      const me = userProfile?.id || null;

      // Two sources, because the two admin_id columns disagree (see the note at
      // the top). Whoever either one says is ours, is ours.
      const [profileRes, agentRes] = await Promise.all([
        supabase.from('user_profiles').select(STAFF_COLS).eq('admin_id', adminId),
        supabase.from('agents').select('user_id, admin_id').eq('admin_id', adminId),
      ]);

      if (profileRes.error) throw profileRes.error;

      const rows = (profileRes.data || [])
        .filter(u => !NON_STAFF_ROLES.includes(u.role));

      // The owner's OWN row is included, marked `isSelf`. They are not their own
      // staff in an org-chart sense, but leaving them out makes the report a lie
      // by omission: on this database every audit row belongs to a tenant owner
      // and none to a staff member, so excluding them renders a page of zeros
      // that reads as "nothing is happening" when the account is in daily use.
      // An owner's admin_id is NULL rather than their own id, so the tenant
      // query above never returns them and they must be fetched by id.
      if (me) {
        const { data: selfRow } = await supabase.from('user_profiles')
          .select(STAFF_COLS).eq('id', me).maybeSingle();
        if (selfRow) rows.unshift({ ...selfRow, isSelf: true });
      }

      const seen = new Set(rows.map(u => u.id));
      const missingAgentUserIds = (agentRes.data || [])
        .map(a => a.user_id)
        .filter(id => id && id !== me && !seen.has(id));

      let extra = [];
      if (missingAgentUserIds.length) {
        const { data } = await supabase.from('user_profiles').select(STAFF_COLS)
          .in('id', missingAgentUserIds);
        // Flagged: the agents table claims them, their own profile does not, so
        // their audit rows are stamped under a different tenant.
        extra = (data || [])
          .filter(u => !NON_STAFF_ROLES.includes(u.role))
          .map(u => ({ ...u, ownershipMismatch: true }));
      }

      const allStaff = [...rows, ...extra];
      setStaff(allStaff);

      if (!allStaff.length) { setLogs([]); setError(null); return; }

      let q = supabase.from('audit_logs').select(LOG_COLS)
        .in('user_id', allStaff.map(s => s.id))
        .order('created_at', { ascending: false })
        .limit(ROW_LIMIT);
      if (from) q = q.gte('created_at', new Date(from).toISOString());
      if (to)   q = q.lte('created_at', new Date(to).toISOString());

      const { data: logRows, error: logErr } = await q;
      if (logErr) {
        // Say it rather than rendering a table of confident zeros.
        logger.error('[useStaffActivity] logs failed', { message: logErr.message });
        setLogs([]);
        setError(logErr.message || 'Staff activity could not be loaded.');
        return;
      }

      setLogs(logRows || []);
      setError(null);
    } catch (err) {
      logger.error('[useStaffActivity] load failed', { message: err?.message });
      setError(err?.message || 'Could not load staff activity.');
    } finally {
      setLoading(false);
    }
  }, [canView, userProfile?.id, from, to]);

  useAuthScopedLoader(fetchAll, reset);

  const cards  = useMemo(() => buildStaffCards({ staff, logs }), [staff, logs]);
  const totals = useMemo(() => buildStaffTotals({ cards, logs }), [cards, logs]);

  return { canView, staff, logs, cards, totals, loading, error, refetch: fetchAll };
};

export default useStaffActivity;

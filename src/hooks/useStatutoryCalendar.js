/**
 * useStatutoryCalendar
 *
 * What the tenant owes the state, when it is due, and whether anyone has filed
 * it yet.
 *
 * TOTALS COME FROM POSTGRES, NOT FROM THE PAGE. statutory_payroll_periods()
 * aggregates every payroll row for a month server-side. Summing the rows the HR
 * table happens to have loaded would produce the PAYE for a page — and the page
 * is capped at 200 records, so a tenant with 250 staff would be shown a figure
 * roughly a fifth short of what they owe KRA, with nothing on screen to say so.
 * Same rule as sacco_dashboard_stats(): a total is never reduced over a capped
 * array.
 *
 * DEADLINES ARE DERIVED, NOT STORED. The due date for a period comes from the
 * versioned schedule in src/config/statutoryReturns.js, resolved from the
 * period itself. Nothing in the database holds a future deadline, so an Act
 * that moves one is a single config entry and every screen moves with it.
 *
 * WHAT "FILED" MEANS HERE. A filing row is a note that a human filed a return.
 * It is not evidence that KRA, NSSF or the SHA received anything, and this hook
 * will never claim otherwise — see the header of
 * supabase/migrations/20260903140000_statutory_return_reminders.sql.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { logger } from '../utils/logger';
import {
  buildStatutoryCalendar,
  calendarSummary,
  statutoryAmountsFor,
  filingKey,
  todayIso,
  shiftPeriod,
} from '../utils/statutoryCalendar';
import { findReturn } from '../config/statutoryReturns';

/**
 * How much history to load.
 *
 * A period stops being actionable about five weeks after it ends (deadline up
 * to the 20th of the following month, plus the fortnight the reminder chases an
 * overdue one). Twelve months is far more than the calendar shows, but it is
 * what the "filed history" view reads, and one query is cheaper than two.
 */
const HISTORY_MONTHS = 12;

const EMPTY_SUMMARY = {
  overdue: 0, dueToday: 0, dueSoon: 0, upcoming: 0, filed: 0, actionable: 0, total: 0,
};

/**
 * Turn the three loaded things — aggregated payroll periods, recorded filings,
 * and whatever VAT position has been handed in — into the calendar the panel
 * renders.
 *
 * Exported and pure so it can be tested without a database. The rule that
 * matters most here is the one it would be easiest to get wrong: the payroll
 * figures come from ONE aggregate row per month, produced by
 * statutory_payroll_periods() in Postgres. They are never re-derived from a
 * list of payroll records, because that list is capped and a capped sum of a
 * tax liability is a number that is wrong in the dangerous direction.
 *
 * @param {object}  opts
 * @param {Array}   opts.periods       rows from statutory_payroll_periods()
 * @param {object}  opts.filings       'key:period' -> filing row
 * @param {object}  opts.vatByPeriod   'YYYY-MM' -> computeVatReturn() result
 * @param {object}  opts.settings      statutory_reminder_settings row, or null
 * @param {string}  [opts.asOf]        defaults to today
 */
export const buildCalendarFrom = ({
  periods = [],
  filings = {},
  vatByPeriod = {},
  settings = null,
  asOf = todayIso(),
} = {}) => {
  const byPeriod = Object.fromEntries(periods.map((p) => [p.period, p]));

  const amountsFor = (period) => statutoryAmountsFor({
    // The aggregate row IS the month's payroll, so it stands in for the record
    // list: one synthetic row carrying the already-summed columns. This keeps
    // the employer-match doubling inside statutoryAmountsFor alone, rather than
    // half there and half in SQL.
    payrollRecords: byPeriod[period]
      ? [{
          paye: byPeriod[period].paye,
          nssf: byPeriod[period].nssf,
          shif: byPeriod[period].shif,
          housing_levy: byPeriod[period].housing_levy,
        }]
      : [],
    vat: vatByPeriod[period] || null,
  });

  const evidenceFor = (period) => ({
    hasPayroll: (byPeriod[period]?.employees || 0) > 0,
    hasVatActivity: !!vatByPeriod[period],
  });

  const allPeriods = [...new Set([
    ...periods.map((p) => p.period),
    ...Object.keys(vatByPeriod),
    // The current month, so a tenant sees next month's deadlines forming even
    // before this month's payroll has been run.
    asOf.slice(0, 7),
  ])].sort().reverse();

  const options = {
    periods: allPeriods,
    amountsFor,
    evidenceFor,
    filings,
    vatRegistered: !!settings?.vat_registered,
    asOf,
  };

  const calendar = buildStatutoryCalendar(options);

  return {
    calendar,
    history: buildStatutoryCalendar({ ...options, includeFiled: true }),
    summary: periods.length || Object.keys(vatByPeriod).length
      ? calendarSummary(calendar)
      : EMPTY_SUMMARY,
    employeesIn: (period) => byPeriod[period]?.employees || 0,
  };
};

export const useStatutoryCalendar = ({ enabled = true } = {}) => {
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [adminId, setAdminId]   = useState(null);
  const [periods, setPeriods]   = useState([]);   // aggregated payroll per month
  const [filings, setFilings]   = useState({});   // 'key:period' -> row
  const [settings, setSettings] = useState(null);
  const [vatByPeriod, setVat]   = useState({});   // 'YYYY-MM' -> computeVatReturn result
  const [saving, setSaving]     = useState(false);

  const hasLoaded = useRef(false);

  // ── Scope ─────────────────────────────────────────────────────────────────
  // Mirrors resolveScope() in the HR page: an admin owns what they create; other
  // staff inherit their parent admin's tenant. A super admin is deliberately NOT
  // special-cased into a cross-tenant view here — "returns due" is a per-tenant
  // question, and a merged list across every tenant on the platform would be a
  // pile of deadlines belonging to nobody in particular.
  const resolveScope = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: profile } = await supabase
      .from('user_profiles').select('id, role, admin_id').eq('id', user.id).maybeSingle();
    return (profile?.role === 'admin' || profile?.role === 'super_admin')
      ? user.id
      : (profile?.admin_id || user.id);
  }, []);

  const load = useCallback(async () => {
    if (!enabled) { setLoading(false); return; }
    setLoading(true);
    setError(null);

    const aId = await resolveScope();
    setAdminId(aId);
    if (!aId) { setLoading(false); return; }

    const since = shiftPeriod(todayIso().slice(0, 7), -HISTORY_MONTHS);

    // Both reads are scoped to ONE tenant explicitly, not left to RLS alone. A
    // super_admin passes is_global_viewer() on both tables, and these figures
    // are SUMS: without the filter their panel would show every tenant's PAYE
    // added together as a single liability owed by nobody, with a button
    // offering to mark it filed. RLS is the access check; this is the scope.
    const [periodsRes, filingsRes, settingsRes] = await Promise.all([
      supabase.rpc('statutory_payroll_periods', { p_since: since, p_admin_id: aId }),
      supabase
        .from('statutory_return_filings')
        .select('id, return_key, period, due_date, amount, filed_at, filed_by, reference, notes')
        .eq('admin_id', aId)
        .gte('period', since),
      supabase
        .from('statutory_reminder_settings')
        .select('admin_id, enabled, vat_registered, extra_recipients')
        .eq('admin_id', aId)
        .maybeSingle(),
    ]);

    // The migration may not be applied yet. Say so plainly rather than
    // rendering an empty calendar, which would read as "nothing is due" — the
    // one message this panel must never send by accident.
    if (periodsRes.error) {
      logger.warn('Statutory calendar: statutory_payroll_periods() unavailable', periodsRes.error.message);
      setError('The statutory calendar needs migration 20260903140000. Until it is applied, deadlines are not tracked.');
      setPeriods([]);
      setLoading(false);
      hasLoaded.current = true;
      return;
    }

    if (filingsRes.error) {
      logger.warn('Statutory calendar: filings unavailable', filingsRes.error.message);
    }

    setPeriods(periodsRes.data || []);
    setFilings(Object.fromEntries(
      (filingsRes.data || []).map((f) => [filingKey(f.return_key, f.period), f]),
    ));
    setSettings(settingsRes.data || null);
    setLoading(false);
    hasLoaded.current = true;
  }, [enabled, resolveScope]);

  useEffect(() => {
    if (hasLoaded.current) return;
    load();
  }, [load]);

  // ── The calendar ──────────────────────────────────────────────────────────
  const { calendar, history, summary, employeesIn } =
    buildCalendarFrom({ periods, filings, vatByPeriod, settings });

  // ── Actions ───────────────────────────────────────────────────────────────

  /**
   * Record that a return was filed.
   *
   * Upsert on (admin_id, return_key, period) — the unique index makes this
   * idempotent, so double-clicking cannot create two filings for one return.
   * admin_id and filed_by are stamped by the trigger from the session, never
   * sent from here: a client that could name its own admin_id could file a
   * return against another tenant's books.
   */
  const markFiled = useCallback(async ({ returnKey, period, dueDate, amount, reference, notes }) => {
    setSaving(true);
    try {
      const { data, error: err } = await supabase
        .from('statutory_return_filings')
        .upsert({
          admin_id: adminId,
          return_key: returnKey,
          period,
          due_date: dueDate || null,
          amount: amount ?? null,
          filed_at: new Date().toISOString(),
          reference: reference || null,
          notes: notes || null,
        }, { onConflict: 'admin_id,return_key,period' })
        .select()
        .single();

      if (err) throw err;
      setFilings((prev) => ({ ...prev, [filingKey(returnKey, period)]: data }));
      return { ok: true };
    } catch (err) {
      logger.error('Statutory calendar: could not record the filing', err);
      return { ok: false, error: err?.message || 'Could not record the filing.' };
    } finally {
      setSaving(false);
    }
  }, [adminId]);

  /**
   * Undo a filing that was recorded in error.
   *
   * Clears filed_at rather than deleting the row: the record of what the
   * business believed it had done is worth keeping, and the trigger clears
   * filed_by to match so the two columns cannot disagree. There is no delete
   * policy on the table at all.
   */
  const unmarkFiled = useCallback(async ({ returnKey, period }) => {
    const existing = filings[filingKey(returnKey, period)];
    if (!existing?.id) return { ok: true };

    setSaving(true);
    try {
      const { data, error: err } = await supabase
        .from('statutory_return_filings')
        .update({ filed_at: null, reference: null })
        .eq('id', existing.id)
        .select()
        .single();

      if (err) throw err;
      setFilings((prev) => ({ ...prev, [filingKey(returnKey, period)]: data }));
      return { ok: true };
    } catch (err) {
      logger.error('Statutory calendar: could not undo the filing', err);
      return { ok: false, error: err?.message || 'Could not undo the filing.' };
    } finally {
      setSaving(false);
    }
  }, [filings]);

  /** Reminder preferences: on/off, VAT registration, extra recipients. */
  const saveSettings = useCallback(async (patch) => {
    setSaving(true);
    try {
      const { data, error: err } = await supabase
        .from('statutory_reminder_settings')
        // admin_id last: `settings` carries its own copy, and letting that one
        // win would mean the row's tenant came from state rather than from the
        // session. The trigger overrides it either way, but a client should not
        // be asserting a tenant id at all.
        .upsert({ ...settings, ...patch, admin_id: adminId }, { onConflict: 'admin_id' })
        .select()
        .single();

      if (err) throw err;
      setSettings(data);
      return { ok: true };
    } catch (err) {
      logger.error('Statutory calendar: could not save reminder settings', err);
      return { ok: false, error: err?.message || 'Could not save the settings.' };
    } finally {
      setSaving(false);
    }
  }, [adminId, settings]);

  /**
   * Hand the hook a VAT position for a period.
   *
   * VAT is not read here. Deriving it means classifying a tenant-defined chart
   * of accounts into input and output VAT, which computeVatReturn() in
   * src/utils/vatLedger.js already does — reimplementing it would be a second
   * copy of a subtle rule. The Finance Hub, which loads the ledger anyway,
   * pushes its result in; until it does, the VAT row shows a deadline with no
   * amount rather than a fabricated one.
   */
  const setVatPosition = useCallback((period, vatReturn) => {
    setVat((prev) => ({ ...prev, [period]: vatReturn }));
  }, []);

  return {
    loading, error, saving, adminId,
    calendar, history, summary, periods,
    settings,
    employeesIn,
    obligationFor: findReturn,
    markFiled, unmarkFiled, saveSettings, setVatPosition,
    reload: load,
  };
};

export default useStatutoryCalendar;

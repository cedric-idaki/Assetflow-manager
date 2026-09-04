/**
 * useReportBuilder
 *
 * Runs a report definition, and keeps the tenant's shelf of saved ones.
 *
 * The definition itself lives in the component — it is form state, and a hook
 * that owned it would make every keystroke a hook concern. What lives here is
 * everything that touches the network: resolving the tenant, issuing the query,
 * and the saved-report CRUD.
 *
 * ── WHY EVERY ROW, AND NOT A PAGE ────────────────────────────────────────────
 *
 * The report reads through fetchAllRows rather than a capped query, and that is
 * not a performance oversight. A report is either a complete answer or a
 * misleading one: an export named payments_august.csv holding the first 1,000
 * of 3,400 payments is worse than no export, and a SUM over a capped array is a
 * number somebody will put in a board pack. fetchAllRows THROWS at its ceiling
 * rather than returning a partial set, so the failure mode is a message telling
 * the user to narrow the range — never a plausible wrong figure. Same reasoning
 * as the ledger sync and the SACCO exports.
 *
 * ── WHY THE RETRY ────────────────────────────────────────────────────────────
 *
 * PostgREST fails a select whole. This schema has migrations that are written
 * but not applied everywhere, and a migration history that disagrees with the
 * live schema in both directions, so a column or an embed relationship may
 * simply not be there. One retry without the doubtful columns turns a broken
 * report into a report that is honest about what it could not fetch.
 */

import { useState, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { getTenantAdminId } from '../lib/tenant';
import { fetchAllRows } from '../lib/fetchAllRows';
import { useAuth } from '../contexts/AuthContext';
import { useAuthScopedLoader } from './useAuthScopedLoader';
import { logger } from '../utils/logger';
import { sourceByKey, canBuildReports } from '../config/reportSchema';
import {
  buildQueryPlan, applyOps, buildReport, stripUnavailable,
  describeDefinition, validateDefinition,
} from '../utils/reportQuery';

/**
 * How many rows one report may pull before it refuses.
 *
 * Well below fetchAllRows' own 100,000 default, because this runs in a browser
 * tab that also has to render the result. A tenant that genuinely needs more
 * than this in one report wants a narrower period, not a longer wait — and
 * saying so is more useful than a frozen tab.
 */
const ROW_CEILING = 25000;

/** Rows rendered in the on-screen table. The export always gets all of them. */
export const PREVIEW_ROWS = 200;

export const useReportBuilder = () => {
  const { userProfile } = useAuth();
  const role = userProfile?.role || null;

  const [savedReports, setSavedReports] = useState([]);
  const [loadingSaved, setLoadingSaved] = useState(true);

  const [result,   setResult]   = useState(null);   // { report, definition, source, coverage, dropped }
  const [running,  setRunning]  = useState(false);
  const [runError, setRunError] = useState(null);

  const canBuild = useMemo(() => canBuildReports(role), [role]);

  // ── LETTERHEAD ────────────────────────────────────────────────────────────
  /**
   * The tenant's company profile, for the head of a PDF export.
   *
   * Fetched on the first PDF and then cached, rather than on mount: most
   * sessions on this screen never ask for one, and a letterhead is not worth a
   * query for a report that leaves as a spreadsheet. `null` is a valid answer —
   * an unfilled profile still gets a headed document, see normaliseIssuer.
   */
  const companyRef = useRef(undefined);

  const loadCompany = useCallback(async () => {
    if (companyRef.current !== undefined) return companyRef.current;
    try {
      const adminId = await getTenantAdminId();
      const { data } = await supabase
        .from('company_profiles').select('*').eq('admin_id', adminId).maybeSingle();
      companyRef.current = data || null;
    } catch (err) {
      logger.debug('Company profile not available for the export letterhead', { error: err?.message });
      companyRef.current = null;
    }
    return companyRef.current;
  }, []);

  // ── SAVED REPORTS ─────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setSavedReports([]);
    setResult(null);
    setRunError(null);
    setLoadingSaved(true);
    // A different sign-in is a different tenant, so the cached letterhead has
    // to go with it — otherwise the next export carries the last one's name.
    companyRef.current = undefined;
  }, []);

  const loadSaved = useCallback(async () => {
    setLoadingSaved(true);
    try {
      // No tenant filter: custom_reports_read already restricts this to the
      // caller's own tenant AND to what they authored or the tenant shared.
      // Repeating it here would add nothing the server is not already doing.
      const { data, error } = await supabase
        .from('custom_reports')
        .select('id, name, description, source_key, definition, is_shared, created_by, last_run_at, run_count, updated_at')
        .order('updated_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      setSavedReports(data || []);
    } catch (err) {
      // Not deployed yet, or offline. An empty shelf is the correct degraded
      // state — the builder itself does not depend on this table at all.
      logger.warn('Saved reports could not be loaded', { error: err?.message });
      setSavedReports([]);
    } finally {
      setLoadingSaved(false);
    }
  }, []);

  useAuthScopedLoader(loadSaved, reset);

  const saveReport = useCallback(async ({ id, name, description, definition, isShared }) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return { error: { message: 'Give the report a name first.' } };

    const check = validateDefinition(definition);
    if (!check.ok) {
      return { error: { message: check.errors[0] || 'This report is not complete enough to save.' } };
    }

    // admin_id and created_by are stamped by trg_custom_reports_stamp from the
    // session — sending them would be sending a tenant the client chose.
    const row = {
      name: trimmed,
      description: description?.trim() || null,
      source_key: check.definition.sourceKey,
      definition: check.definition,
      is_shared: Boolean(isShared),
    };

    const query = id
      ? supabase.from('custom_reports').update(row).eq('id', id).select().maybeSingle()
      : supabase.from('custom_reports').insert(row).select().maybeSingle();

    const { data, error } = await query;
    if (error) {
      logger.warn('Saving a report was refused', { error: error.message, id: id || null });
      // 23505 is the per-author unique name index.
      const message = error.code === '23505'
        ? 'You already have a report with that name.'
        : error.message;
      return { error: { ...error, message } };
    }

    await loadSaved();
    return { data };
  }, [loadSaved]);

  const deleteReport = useCallback(async (id) => {
    const { error } = await supabase.from('custom_reports').delete().eq('id', id);
    if (error) return { error };
    await loadSaved();
    return {};
  }, [loadSaved]);

  const setShared = useCallback(async (id, isShared) => {
    const { error } = await supabase.from('custom_reports').update({ is_shared: isShared }).eq('id', id);
    if (error) return { error };
    await loadSaved();
    return {};
  }, [loadSaved]);

  // ── RUNNING ───────────────────────────────────────────────────────────────
  const fetchPlan = useCallback(async (plan) => fetchAllRows(
    () => {
      const query = supabase.from(plan.table).select(plan.select);
      return applyOps(query, plan.ops).order(plan.order.column, { ascending: plan.order.ascending });
    },
    { chunkSize: 1000, ceiling: ROW_CEILING },
  ), []);

  /**
   * Run a definition and put the finished report in state.
   *
   * `savedId` is only used to bump the run counter, through an RPC rather than
   * an update — running a shared report must not need write access to it.
   */
  const run = useCallback(async (definition, { savedId = null } = {}) => {
    setRunning(true);
    setRunError(null);

    try {
      const adminId = await getTenantAdminId();
      const now = new Date();

      const { ok, errors, plan } = buildQueryPlan(definition, { adminId, now });
      if (!ok || !plan) {
        setResult(null);
        setRunError(errors[0] || 'This report is not complete enough to run.');
        return { error: errors };
      }

      const source = plan.source;
      let rows;
      let dropped = [];
      let active = plan;

      try {
        rows = await fetchPlan(plan);
      } catch (err) {
        // The ceiling is a deliberate refusal, not a schema problem — re-throw
        // it so the user is told to narrow the range rather than being handed a
        // report with columns quietly missing for no reason.
        if (/Refusing to load more than/.test(err?.message || '')) throw err;

        const fallback = stripUnavailable(plan.definition, source);
        if (fallback.dropped.length === 0) throw err;

        logger.warn('Report query failed — retrying without the doubtful columns', {
          source: source.key, error: err?.message, dropped: fallback.dropped,
        });

        const retry = buildQueryPlan(fallback.definition, { adminId, now });
        if (!retry.ok || !retry.plan) throw err;

        rows = await fetchPlan(retry.plan);
        dropped = fallback.dropped;
        active = retry.plan;
      }

      const report = buildReport(rows, source, active.definition);

      setResult({
        source,
        definition: active.definition,
        report,
        // What the reader needs to know about the figures in front of them: the
        // period, every filter that was applied, and anything that could not be
        // fetched. A table of numbers with no statement of what was excluded is
        // a table that gets quoted out of context.
        coverage: describeDefinition(source, active.definition, active.range),
        dropped,
        warnings: errors,
        ranAt: now,
      });

      if (savedId) {
        // Best-effort: a report that ran is not un-run because a counter did not
        // move. Not awaited into the failure path for the same reason.
        supabase.rpc('custom_report_ran', { p_report: savedId })
          .then(({ error }) => { if (error) logger.debug('Run counter not recorded', { error: error.message }); });
      }

      return { data: report };
    } catch (err) {
      logger.error('Report run failed', { error: err?.message });
      setResult(null);
      setRunError(err?.message || 'The report could not be run.');
      return { error: err };
    } finally {
      setRunning(false);
    }
  }, [fetchPlan]);

  const clear = useCallback(() => { setResult(null); setRunError(null); }, []);

  return {
    role,
    canBuild,
    savedReports,
    loadingSaved,
    reloadSaved: loadSaved,
    saveReport,
    deleteReport,
    setShared,
    run,
    clear,
    loadCompany,
    result,
    running,
    runError,
    rowCeiling: ROW_CEILING,
    sourceByKey,
  };
};

export default useReportBuilder;

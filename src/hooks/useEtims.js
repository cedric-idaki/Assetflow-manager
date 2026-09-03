/**
 * useEtims — everything the KRA compliance screen reads and does.
 *
 * Four things live behind one hook because they are one question ("is this
 * business filing correctly?") answered from four places:
 *
 *   the device        etims-credentials (edge function; the table has RLS on
 *                     with zero policies, so this is the only way to see it)
 *   the queue         etims_queue_summary() + the recent rows, read directly
 *                     under the tenant's own RLS
 *   what is missing   etims_unclassified_items()
 *   the classifications themselves, which the tenant edits here
 *
 * NOTHING IN THIS FILE WRITES A TRANSMISSION RESULT. Statuses, signatures and
 * KRA's replies are written by the edge function under the service role only —
 * they are the figures a receipt asserts to a customer, and a browser must not
 * be able to set them. What the tenant can write from here is their own
 * classification data, which is an input to filing rather than a record of it.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { etimsReadiness } from '../utils/etimsReadiness';

/** How many recent documents the ledger shows. Totals come from the RPC. */
const RECENT_LIMIT = 50;

export const useEtims = () => {
  const [adminId, setAdminId] = useState(null);
  const [config, setConfig] = useState(null);
  const [summary, setSummary] = useState(null);
  const [recent, setRecent] = useState([]);
  const [classifications, setClassifications] = useState([]);
  const [unclassified, setUnclassified] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // ── The device ────────────────────────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    const { data, error: err } = await supabase.functions.invoke('etims-credentials', {
      body: { action: 'status' },
    });
    if (err) throw new Error(err.message);
    setConfig(data);
    return data;
  }, []);

  // ── The queue ─────────────────────────────────────────────────────────────
  const loadQueue = useCallback(async () => {
    // Totals from the RPC, never by reducing over the capped list below — a
    // page that sums 50 rows reports the total of 50 rows, not of the tenant's
    // filing history. Same rule as the dashboard stats RPCs.
    const [{ data: totals }, { data: rows }] = await Promise.all([
      supabase.rpc('etims_queue_summary', { p_since: null }),
      supabase
        .from('etims_invoices')
        .select(
          'id, sale_id, doc_type, status, invoice_number, kra_invoice_number, attempts, ' +
            'next_attempt_at, last_error, last_result_code, environment, total_tax, total_amount, ' +
            'receipt_signature, transmitted_at, created_at',
        )
        .order('created_at', { ascending: false })
        .limit(RECENT_LIMIT),
    ]);

    setSummary(Array.isArray(totals) ? totals[0] ?? null : totals ?? null);
    setRecent(rows || []);
  }, []);

  // ── What cannot be filed yet ──────────────────────────────────────────────
  const loadClassifications = useCallback(async (aId) => {
    const [{ data: rows }, { data: missing }] = await Promise.all([
      supabase
        .from('etims_item_classifications')
        .select('*')
        .eq('admin_id', aId)
        .order('item_name'),
      supabase.rpc('etims_unclassified_items'),
    ]);
    setClassifications(rows || []);
    setUnclassified(missing || []);
  }, []);

  const refresh = useCallback(async (aId = adminId) => {
    setError(null);
    try {
      await Promise.all([
        loadConfig(),
        loadQueue(),
        aId ? loadClassifications(aId) : Promise.resolve(),
      ]);
    } catch (err) {
      setError(err.message);
    }
  }, [adminId, loadConfig, loadQueue, loadClassifications]);

  useEffect(() => {
    const boot = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from('user_profiles')
          .select('role, admin_id')
          .eq('id', user.id)
          .maybeSingle();

        // Mirrors public.current_admin_id().
        const aId = profile?.admin_id ?? user.id;
        setAdminId(aId);
        await refresh(aId);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    boot();
    // Deliberately once: refresh is the way to reload, and depending on it here
    // would re-boot the screen on every state change it closes over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Registering the device ────────────────────────────────────────────────
  const saveDevice = useCallback(async ({ kraPin, branchId, deviceSerial, environment }) => {
    setSaving(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.functions.invoke('etims-credentials', {
        body: { action: 'save', kraPin, branchId, deviceSerial, environment },
      });
      // An edge function's non-2xx body carries the real message; supabase-js
      // reports only "non-2xx status code", which tells a user nothing.
      if (err) {
        const detail = await err?.context?.json?.().catch(() => null);
        throw new Error(detail?.error || err.message);
      }
      setConfig(data);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  const disableDevice = useCallback(async () => {
    setSaving(true);
    try {
      const { data, error: err } = await supabase.functions.invoke('etims-credentials', {
        body: { action: 'disable' },
      });
      if (err) throw new Error(err.message);
      setConfig(data);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  // ── Filing ────────────────────────────────────────────────────────────────
  /** Drain this tenant's queue now, rather than waiting for the scheduler. */
  const sendNow = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.functions.invoke('etims-transmit', {
        body: { action: 'drain' },
      });
      if (err) throw new Error(err.message);
      await loadQueue();
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [loadQueue]);

  /**
   * Decide what to do with a document that may or may not have reached KRA.
   *
   * `resolution` is 'mark_filed' (the tenant found it in their KRA portal and
   * supplies the signature), 'resend' (they checked and it is not there) or
   * 'cancel'. The choice is theirs on purpose — see the header of
   * supabase/functions/etims-transmit/index.ts.
   */
  const resolveDocument = useCallback(async (invoiceId, resolution, extra = {}) => {
    setSaving(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.functions.invoke('etims-transmit', {
        body: { action: 'resolve', invoiceId, resolution, ...extra },
      });
      if (err) {
        const detail = await err?.context?.json?.().catch(() => null);
        throw new Error(detail?.error || err.message);
      }
      await loadQueue();
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [loadQueue]);

  // ── Classification ────────────────────────────────────────────────────────
  const saveClassification = useCallback(async (row) => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        admin_id: adminId,
        asset_id: row.asset_id ?? null,
        item_code: row.item_code,
        item_name: row.item_name ?? null,
        classification_code: row.classification_code || null,
        tax_code: row.tax_code || null,
        quantity_unit: row.quantity_unit || 'U',
        packaging_unit: row.packaging_unit || 'NT',
        item_type: row.item_type || '2',
        origin_country: row.origin_country || 'KE',
        updated_at: new Date().toISOString(),
        // Changing how an item is taxed invalidates its registration with KRA,
        // so it is announced again on the next sale. Clearing this is cheap;
        // filing under a stale classification is not.
        registered_at: null,
      };

      const { error: err } = await supabase
        .from('etims_item_classifications')
        .upsert(payload, { onConflict: 'admin_id,item_code' });
      if (err) throw new Error(err.message);

      await loadClassifications(adminId);
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [adminId, loadClassifications]);

  const readiness = useMemo(
    () => etimsReadiness({
      config,
      unclassifiedCount: unclassified.length,
      queue: summary,
    }),
    [config, unclassified.length, summary],
  );

  return {
    adminId,
    config,
    summary,
    recent,
    classifications,
    unclassified,
    readiness,
    loading,
    saving,
    error,
    refresh,
    saveDevice,
    disableDevice,
    sendNow,
    resolveDocument,
    saveClassification,
  };
};

export default useEtims;

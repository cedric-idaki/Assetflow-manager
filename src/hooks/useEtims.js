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
  const [stockSummary, setStockSummary] = useState(null);
  const [stockRecent, setStockRecent] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [purchaseSummary, setPurchaseSummary] = useState(null);
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
            'receipt_signature, transmitted_at, created_at, reverses_id',
        )
        .order('created_at', { ascending: false })
        .limit(RECENT_LIMIT),
    ]);

    setSummary(Array.isArray(totals) ? totals[0] ?? null : totals ?? null);
    setRecent(rows || []);
  }, []);

  // ── Stock ─────────────────────────────────────────────────────────────────
  // Totals from the RPC for the same reason as the queue above: the list is
  // capped, and a page that sums the capped list reports the total of the cap.
  const loadStock = useCallback(async () => {
    const [{ data: totals }, { data: rows }] = await Promise.all([
      supabase.rpc('etims_stock_summary'),
      supabase
        .from('etims_stock_movements')
        .select(
          'id, asset_id, item_code, direction, quantity, movement_code, sale_id, note, ' +
            'sar_number, status, attempts, last_error, environment, occurred_at, ' +
            'transmitted_at, created_at',
        )
        .order('created_at', { ascending: false })
        .limit(RECENT_LIMIT),
    ]);
    setStockSummary(Array.isArray(totals) ? totals[0] ?? null : totals ?? null);
    setStockRecent(rows || []);
  }, []);

  // ── Purchases ─────────────────────────────────────────────────────────────
  // Read with their lines, because the review question is "do you recognise
  // this?" and nobody can answer that from a header.
  const loadPurchases = useCallback(async () => {
    const [{ data: totals }, { data: rows }] = await Promise.all([
      supabase.rpc('etims_purchase_summary'),
      supabase
        .from('etims_purchases')
        .select(
          'id, supplier_pin, supplier_name, supplier_invoice_no, purchase_date, ' +
            'total_taxable, total_tax, total_amount, decision, decided_at, decision_note, ' +
            'status, last_error, environment, created_at, ' +
            'items:etims_purchase_items(item_seq, item_name, item_code, quantity, unit_price, ' +
            'tax_code, taxable_amount, tax_amount, total_amount)',
        )
        .order('purchase_date', { ascending: false, nullsFirst: false })
        .limit(RECENT_LIMIT),
    ]);
    setPurchaseSummary(Array.isArray(totals) ? totals[0] ?? null : totals ?? null);
    setPurchases(rows || []);
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
        loadStock(),
        loadPurchases(),
        aId ? loadClassifications(aId) : Promise.resolve(),
      ]);
    } catch (err) {
      setError(err.message);
    }
  }, [adminId, loadConfig, loadQueue, loadStock, loadPurchases, loadClassifications]);

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

  /**
   * Reverse a filed invoice with a credit note.
   *
   * Note what is not sent: no amount, no lines, no date. The reversal's figures
   * are rebuilt server-side from the original sale and negated by the shared
   * builder, so this call cannot state what to credit — only which document,
   * and why. That is the same rule as the rest of this file: a browser supplies
   * inputs to filing, never the figures a receipt asserts.
   */
  const raiseCreditNote = useCallback(async (invoiceId, { reasonCode = null, remark = null } = {}) => {
    setSaving(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.rpc('etims_raise_credit_note', {
        p_invoice: invoiceId,
        p_reason_code: reasonCode || null,
        p_remark: remark || null,
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

  // ── Stock ─────────────────────────────────────────────────────────────────
  /**
   * Tell KRA that stock moved for a reason a sale cannot explain — received,
   * written off, broken, transferred.
   *
   * The reason is required of the operator rather than inferred, because a
   * change in quantity does not say why it changed and each reason is a
   * different code on a tax filing. This does NOT change the item's quantity in
   * the asset register: it records what to tell KRA about a change the tenant
   * has already made there.
   */
  const recordStockAdjustment = useCallback(
    async ({ assetId, direction, quantity, movementCode = null, note = null }) => {
      setSaving(true);
      setError(null);
      try {
        const { data, error: err } = await supabase.rpc('etims_record_stock_adjustment', {
          p_asset: assetId,
          p_direction: direction,
          p_quantity: Number(quantity),
          p_movement_code: movementCode || null,
          p_note: note || null,
        });
        if (err) throw new Error(err.message);
        await loadStock();
        return data;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [loadStock],
  );

  // ── Purchases ─────────────────────────────────────────────────────────────
  /** Refresh the supplier inbox from KRA. A read; it files nothing. */
  const pullPurchases = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.functions.invoke('etims-transmit', {
        body: { action: 'pull_purchases' },
      });
      if (err) {
        const detail = await err?.context?.json?.().catch(() => null);
        throw new Error(detail?.error || err.message);
      }
      await loadPurchases();
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [loadPurchases]);

  /**
   * Accept or reject a purchase a supplier filed against this PIN.
   *
   * Accepting claims input VAT, so nothing is auto-accepted and there is no
   * bulk button here: the liability for claiming tax on a supply that never
   * happened is the tenant's, and it should cost one deliberate click each.
   */
  const decidePurchase = useCallback(async (purchaseId, decision, note = null) => {
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase.rpc('etims_decide_purchase', {
        p_purchase: purchaseId,
        p_decision: decision,
        p_note: note || null,
      });
      if (err) throw new Error(err.message);
      await loadPurchases();
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [loadPurchases]);

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
    stockSummary,
    stockRecent,
    purchases,
    purchaseSummary,
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
    raiseCreditNote,
    recordStockAdjustment,
    pullPurchases,
    decidePurchase,
    saveClassification,
  };
};

export default useEtims;

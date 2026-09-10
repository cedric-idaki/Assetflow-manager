/**
 * usePaymentApproval
 *
 * The FinHub payment pipeline, from the agent's side and the approver's side.
 * One hook because both sides read the SAME rows through the same RLS — an
 * agent's list and a super admin's queue differ only in what the policy lets
 * through, and giving them separate hooks is how the two drift into disagreeing
 * about what "pending" means.
 *
 * EVERY WRITE IS AN RPC, and that is not a style choice. `payment_requests` has
 * a SELECT policy and nothing else: no INSERT, no UPDATE, no DELETE. A PATCH
 * from this file would be refused by Postgres. The whole status machine, the
 * role checks and the audit trail live in migration 20260908120000, so a screen
 * that forgets a step cannot skip it — the database refuses the transition.
 *
 * THE TWO-STEP DECISION IS TWO CALLS AND MUST STAY THAT WAY.
 *
 *   decide(id, 'approve', reason)  ->  returns { hash, lines, ... }
 *   verify(id, hash)               ->  the decision becomes real
 *
 * The hash is computed by the database FROM THE REQUEST AS IT STANDS. If the
 * request is revalidated, edited or settled by somebody else between the two
 * calls, the digest changes and verify() is refused. So the UI must render
 * `lines` verbatim in the confirmation step and hand back the hash it was
 * given — never a hash it cached from an earlier read, and never one it
 * recomputed itself. Doing either would defeat the only protection a
 * mis-clicked KES 400,000 approval has.
 *
 * TOTALS COME FROM SQL. `payment_request_totals()` is SECURITY INVOKER, so the
 * same call serves an agent, a manager and a super admin at their own scope.
 * Nothing here reduces over `requests` to produce a headline figure: that array
 * is one page, and a total computed from a page is a total of a page. Same rule
 * as sacco_dashboard_stats() — see the dashboard aggregate convention.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { logger } from '../utils/logger';

// Module-level counter, not Date.now(): StrictMode mounts effects twice and both
// runs can land in the same millisecond, and supabase.channel() hands back the
// already-subscribed channel for a name in use — which then throws when .on() is
// called on it. Same convention as useRealtimePayments.
let _payReqChannelSeq = 0;

const PAGE_SIZE = 50;

/** The thirteen statuses, in pipeline order, with how each should read. */
export const PAYMENT_STATUSES = [
  { value: 'draft',                   label: 'Draft',              tone: 'bg-gray-100 text-gray-700',        group: 'open' },
  { value: 'submitted',               label: 'Submitted',          tone: 'bg-blue-100 text-blue-700',        group: 'open' },
  { value: 'under_validation',        label: 'Under Validation',   tone: 'bg-indigo-100 text-indigo-700',    group: 'open' },
  { value: 'pending_approval',        label: 'Pending Approval',   tone: 'bg-amber-100 text-amber-800',      group: 'open' },
  { value: 'approved',                label: 'Approved',           tone: 'bg-emerald-100 text-emerald-700',  group: 'settled' },
  { value: 'rejected',                label: 'Rejected',           tone: 'bg-red-100 text-red-700',          group: 'settled' },
  { value: 'on_hold',                 label: 'On Hold',            tone: 'bg-orange-100 text-orange-700',    group: 'open' },
  { value: 'processing',              label: 'Processing',         tone: 'bg-sky-100 text-sky-700',          group: 'settled' },
  { value: 'executed',                label: 'Executed',           tone: 'bg-teal-100 text-teal-700',        group: 'settled' },
  { value: 'failed',                  label: 'Failed',             tone: 'bg-red-100 text-red-700',          group: 'settled' },
  { value: 'cancelled',               label: 'Cancelled',          tone: 'bg-gray-100 text-gray-500',        group: 'settled' },
  { value: 'reconciliation_required', label: 'Reconciliation Due', tone: 'bg-purple-100 text-purple-700',    group: 'settled' },
  { value: 'completed',               label: 'Completed',          tone: 'bg-emerald-100 text-emerald-800',  group: 'settled' },
];

export const statusMeta = (value) =>
  PAYMENT_STATUSES.find(s => s.value === value) || {
    value,
    // An unknown status is titled and kept rather than dropped: a row that
    // exists must appear somewhere, and filtering it would make the queue
    // under-count without saying so.
    label: String(value || 'Unknown').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    tone: 'bg-gray-100 text-gray-700',
    group: 'open',
  };

export const REQUEST_TYPES = [
  { value: 'agent_commission',      label: 'Agent Commission' },
  { value: 'staff_payment',         label: 'Staff Payment' },
  { value: 'supplier_payment',      label: 'Supplier Payment' },
  { value: 'client_refund',         label: 'Client Refund' },
  { value: 'expense_reimbursement', label: 'Expense Reimbursement' },
  { value: 'other',                 label: 'Other' },
];

export const DOCUMENT_TYPES = [
  { value: 'invoice',            label: 'Invoice' },
  { value: 'contract',           label: 'Contract' },
  { value: 'purchase_agreement', label: 'Purchase Agreement' },
  { value: 'delivery_evidence',  label: 'Delivery Evidence' },
  { value: 'receipt',            label: 'Receipt' },
  { value: 'id_document',        label: 'ID Document' },
  { value: 'other',              label: 'Other' },
];

const REQUEST_COLS =
  'id, request_no, admin_id, request_type, status, agent_id, manager_id, client_id, ' +
  'invoice_id, invoice_ref, amount, currency, payment_method, payee_name, payee_account, ' +
  'payee_phone, narrative, submitted_by, submitted_at, validation_passed, validation_result, ' +
  'validated_at, pending_decision, pending_reason, pending_decided_at, bulk_batch_id, ' +
  'decision, decision_reason, decided_by, decided_at, verified_by, verified_at, ' +
  'executed_at, payment_reference, failure_reason, wallet_entry_id, bank_confirmed, ' +
  'bank_confirmed_at, bank_reference, reconciled_at, reconciliation_note, created_at, updated_at';

export const EMPTY_TOTALS = {
  pending: { count: 0, amount: 0 },
  approved: { count: 0, amount: 0 },
  rejected: { count: 0, amount: 0 },
  onHold: { count: 0, amount: 0 },
  processing: { count: 0, amount: 0 },
  completed: { count: 0, amount: 0 },
  failed: { count: 0, amount: 0 },
  requestedTotal: 0,
  approvedTotal: 0,
  pendingTotal: 0,
  byStatus: {},
};

/** Fold the per-status rows the RPC returns into the tiles the dashboard shows. */
const shapeTotals = (rows) => {
  const byStatus = {};
  (rows || []).forEach(r => {
    byStatus[r.status] = {
      count: Number(r.request_count) || 0,
      amount: Number(r.total_amount) || 0,
    };
  });

  const at = (s) => byStatus[s] || { count: 0, amount: 0 };
  const sum = (...names) => names.reduce((acc, n) => ({
    count: acc.count + at(n).count,
    amount: acc.amount + at(n).amount,
  }), { count: 0, amount: 0 });

  return {
    byStatus,
    // "Pending" to an approver means everything still awaiting a decision,
    // not just the one status literally called pending_approval.
    pending:    sum('submitted', 'under_validation', 'pending_approval'),
    approved:   at('approved'),
    rejected:   at('rejected'),
    onHold:     at('on_hold'),
    processing: sum('processing', 'executed', 'reconciliation_required'),
    completed:  at('completed'),
    failed:     at('failed'),
    requestedTotal: Object.values(byStatus).reduce((a, v) => a + v.amount, 0),
    approvedTotal:  sum('approved', 'processing', 'executed', 'reconciliation_required', 'completed').amount,
    pendingTotal:   sum('submitted', 'under_validation', 'pending_approval', 'on_hold').amount,
  };
};

/**
 * @param {object}  opts
 * @param {boolean} opts.realtime  subscribe to changes (the approval dashboard does; a modal does not)
 */
export const usePaymentApproval = ({ realtime = true } = {}) => {
  const [requests, setRequests]   = useState([]);
  const [totals, setTotals]       = useState(EMPTY_TOTALS);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [hasMore, setHasMore]     = useState(false);
  const [busyId, setBusyId]       = useState(null);

  // Filters live here rather than in the tab so a refetch triggered by realtime
  // re-applies them; a filter held only in the view would silently widen the
  // list the moment anything else refreshed it.
  const [filters, setFilters] = useState({
    status: 'all',
    requestType: 'all',
    agentId: '',
    managerId: '',
    clientId: '',
    invoice: '',
    minAmount: '',
    maxAmount: '',
    from: '',
    to: '',
    search: '',
  });

  const pageRef  = useRef(0);
  const mounted  = useRef(true);

  const fetchTotals = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('payment_request_totals');
    if (err) {
      // A failed aggregate must not blank the queue: the list is still true.
      logger.debug('[usePaymentApproval] totals unavailable', { message: err.message });
      return;
    }
    if (mounted.current) setTotals(shapeTotals(data));
  }, []);

  const fetchRequests = useCallback(async (page = 0) => {
    const from = page * PAGE_SIZE;
    let q = supabase
      .from('payment_requests')
      .select(REQUEST_COLS)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE); // one extra row: that is how we know there is more

    if (filters.status !== 'all')      q = q.eq('status', filters.status);
    if (filters.requestType !== 'all') q = q.eq('request_type', filters.requestType);
    if (filters.agentId)   q = q.eq('agent_id', filters.agentId);
    if (filters.managerId) q = q.eq('manager_id', filters.managerId);
    if (filters.clientId)  q = q.eq('client_id', filters.clientId);
    if (filters.invoice)   q = q.ilike('invoice_ref', `%${filters.invoice}%`);
    if (filters.minAmount !== '' && !Number.isNaN(Number(filters.minAmount))) q = q.gte('amount', Number(filters.minAmount));
    if (filters.maxAmount !== '' && !Number.isNaN(Number(filters.maxAmount))) q = q.lte('amount', Number(filters.maxAmount));
    if (filters.from) q = q.gte('created_at', new Date(filters.from).toISOString());
    if (filters.to) {
      // An end date the user typed means "to the end of that day".
      const end = new Date(filters.to);
      end.setHours(23, 59, 59, 999);
      q = q.lte('created_at', end.toISOString());
    }

    const { data, error: err } = await q;
    if (err) throw err;

    const rows = data || [];
    const more = rows.length > PAGE_SIZE;
    return { rows: more ? rows.slice(0, PAGE_SIZE) : rows, more };
  }, [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      pageRef.current = 0;
      const [{ rows, more }] = await Promise.all([fetchRequests(0), fetchTotals()]);
      if (!mounted.current) return;
      setRequests(rows);
      setHasMore(more);
    } catch (err) {
      logger.error('[usePaymentApproval] load failed', { message: err?.message });
      if (mounted.current) {
        setError(err?.message || 'Could not load payment requests.');
        setRequests([]);
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [fetchRequests, fetchTotals]);

  const loadMore = useCallback(async () => {
    if (!hasMore) return;
    try {
      const next = pageRef.current + 1;
      const { rows, more } = await fetchRequests(next);
      pageRef.current = next;
      if (!mounted.current) return;
      setRequests(prev => [...prev, ...rows]);
      setHasMore(more);
    } catch (err) {
      logger.error('[usePaymentApproval] loadMore failed', { message: err?.message });
      setError(err?.message || 'Could not load more requests.');
    }
  }, [hasMore, fetchRequests]);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; };
  }, [load]);

  useEffect(() => {
    if (!realtime) return undefined;
    const n = ++_payReqChannelSeq;
    const ch = supabase
      .channel(`rt_payment_requests_${n}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_requests' }, () => {
        // Refetch rather than patch the row in place: RLS decides what this
        // viewer may see, and a payload is not filtered by it.
        load();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [realtime, load]);

  /** Shared shape for every RPC: run it, surface the real message, refresh. */
  const run = useCallback(async (fn, args, id) => {
    setBusyId(id || 'bulk');
    try {
      const { data, error: err } = await supabase.rpc(fn, args);
      if (err) throw new Error(err.message || `${fn} failed.`);
      await load();
      return data;
    } finally {
      setBusyId(null);
    }
  }, [load]);

  // ── The agent's side ────────────────────────────────────────────────────
  const submitRequest = useCallback((payload) => run('finhub_submit_payment_request', {
    p_amount:         Number(payload.amount),
    p_request_type:   payload.requestType || 'agent_commission',
    p_narrative:      payload.narrative || null,
    p_client_id:      payload.clientId || null,
    p_invoice_id:     payload.invoiceId || null,
    p_payment_method: payload.paymentMethod || null,
    p_payee_name:     payload.payeeName || null,
    p_payee_account:  payload.payeeAccount || null,
    p_payee_phone:    payload.payeePhone || null,
    p_submit_now:     payload.submitNow !== false,
  }), [run]);

  const cancelRequest = useCallback((id, reason) =>
    run('finhub_cancel_payment_request', { p_id: id, p_reason: reason || null }, id), [run]);

  // ── FinHub ──────────────────────────────────────────────────────────────
  const validateRequest = useCallback((id) =>
    run('finhub_validate_payment_request', { p_id: id }, id), [run]);

  const executeRequest = useCallback((id, reference) =>
    run('finhub_execute_payment_request', { p_id: id, p_reference: reference }, id), [run]);

  const failRequest = useCallback((id, reason) =>
    run('finhub_fail_payment_request', { p_id: id, p_reason: reason }, id), [run]);

  const confirmBankCredit = useCallback((id, bankReference, credited = true) =>
    run('finhub_confirm_payment_request', {
      p_id: id, p_bank_reference: bankReference || null, p_credited: credited,
    }, id), [run]);

  const reconcileRequest = useCallback((id, matched, note) =>
    run('finhub_reconcile_payment_request', {
      p_id: id, p_matched: !!matched, p_note: note || null,
    }, id), [run]);

  // ── The approver's two steps ────────────────────────────────────────────
  /**
   * Step one. Returns the terms the approver must be shown and the hash they
   * must hand back. DOES NOT settle anything — the status has not moved.
   */
  const decide = useCallback(async (id, decision, reason) => {
    const { data, error: err } = await supabase.rpc('finhub_decide_payment_request', {
      p_id: id, p_decision: decision, p_reason: reason,
    });
    if (err) throw new Error(err.message || 'Could not record the decision.');
    await load();
    return data; // { request_id, request_no, amount, currency, lines, hash }
  }, [load]);

  /** Step two. `hash` must be the one decide() returned, not a recomputed one. */
  const verifyDecision = useCallback((id, hash) =>
    run('finhub_verify_payment_decision', { p_id: id, p_hash: hash }, id), [run]);

  const bulkDecide = useCallback(async (ids, decision, reason) => {
    const { data, error: err } = await supabase.rpc('finhub_bulk_decide_payment_requests', {
      p_ids: ids, p_decision: decision, p_reason: reason,
    });
    if (err) throw new Error(err.message || 'Could not record the bulk decision.');
    await load();
    return data; // { batch_id, count, decision, reason, hash }
  }, [load]);

  const verifyBulk = useCallback((batchId, hash) =>
    run('finhub_verify_bulk_decision', { p_batch_id: batchId, p_hash: hash }), [run]);

  const resumeRequest = useCallback((id, reason) =>
    run('finhub_resume_payment_request', { p_id: id, p_reason: reason || null }, id), [run]);

  // ── Documents ───────────────────────────────────────────────────────────
  /**
   * Upload to the private bucket, then index it. The two are separate calls on
   * purpose: the RPC is what enforces "no documents after a decision", and it
   * must run against a file that is already there, not one we are about to
   * write. A failed index leaves an orphan object, which is recoverable; a
   * failed upload after a successful index would leave the trail claiming a
   * document that does not exist, which is not.
   */
  const attachDocument = useCallback(async (request, file, documentType = 'other') => {
    if (!file) throw new Error('Choose a file first.');
    const safe = file.name.replace(/[^\w.-]+/g, '_');
    const path = `${request.admin_id}/${request.id}/${Date.now()}_${safe}`;

    const { error: upErr } = await supabase.storage
      .from('payment-request-documents')
      .upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
    if (upErr) throw new Error(upErr.message || 'Upload failed.');

    const { data, error: err } = await supabase.rpc('finhub_attach_payment_document', {
      p_request_id:    request.id,
      p_document_type: documentType,
      p_file_name:     file.name,
      p_file_path:     path,
      p_mime_type:     file.type || null,
      p_file_size:     file.size ?? null,
    });
    if (err) {
      // Index refused (a decision has been taken, most likely). Take the object
      // back out rather than leaving a file nothing points at.
      await supabase.storage.from('payment-request-documents').remove([path]).catch(() => {});
      throw new Error(err.message || 'Could not attach the document.');
    }
    return data;
  }, []);

  const listDocuments = useCallback(async (requestId) => {
    const { data, error: err } = await supabase
      .from('payment_request_documents')
      .select('id, document_type, file_name, file_path, mime_type, file_size, uploaded_at')
      .eq('request_id', requestId)
      .order('uploaded_at', { ascending: true });
    if (err) throw err;
    return data || [];
  }, []);

  const documentUrl = useCallback(async (filePath) => {
    const { data, error: err } = await supabase.storage
      .from('payment-request-documents')
      .createSignedUrl(filePath, 300);
    if (err) throw new Error(err.message || 'Could not open the document.');
    return data?.signedUrl || null;
  }, []);

  const listEvents = useCallback(async (requestId) => {
    const { data, error: err } = await supabase
      .from('payment_request_events')
      .select('id, seq, event_type, from_status, to_status, actor_name, actor_role, reason, detail, amount, occurred_at')
      .eq('request_id', requestId)
      .order('seq', { ascending: true });
    if (err) throw err;
    return data || [];
  }, []);

  return {
    requests, totals, loading, error, hasMore, busyId,
    filters, setFilters,
    refetch: load, loadMore,
    submitRequest, cancelRequest,
    validateRequest, executeRequest, failRequest, confirmBankCredit, reconcileRequest,
    decide, verifyDecision, bulkDecide, verifyBulk, resumeRequest,
    attachDocument, listDocuments, documentUrl, listEvents,
  };
};

export default usePaymentApproval;

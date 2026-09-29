/**
 * SACCO receipt book — every call the receipt screens make.
 *
 * Writes go through two SECURITY DEFINER RPCs and nothing else: the tables
 * carry no write policy and no write grant, because a receipt has to be issued
 * in the same transaction as the payment it proves
 * (supabase/migrations/20260925163000_sacco_payment_receipts.sql). Reads are
 * plain selects scoped by RLS — staff see their tenant's book, a member sees
 * their own receipts.
 *
 * Errors are thrown as Supabase returned them, code intact, so a screen can
 * put them through describeReceiptError() in src/utils/saccoReceipts.js.
 */
import { supabase } from '../lib/supabase';
import { fetchAllRows } from '../lib/fetchAllRows';

/** Settle whole instalments of one loan and get the receipt back. */
export const recordLoanRepayment = async ({ scheduleIds, amount, method, reference, paidOn, notes }) => {
  const { data, error } = await supabase.rpc('sacco_receipt_loan_repayment', {
    p_schedule_ids: scheduleIds,
    p_amount: amount,
    p_payment_method: method,
    p_reference: reference || null,
    p_paid_on: paidOn || null,
    p_notes: notes || null,
  });
  if (error) throw error;
  return data;
};

/** Record that a settled share purchase has been paid for, and get the receipt back. */
export const recordSharePurchasePayment = async ({ shareTxnId, amount, method, reference, paidOn, notes }) => {
  const { data, error } = await supabase.rpc('sacco_receipt_share_purchase', {
    p_share_txn_id: shareTxnId,
    p_amount: amount,
    p_payment_method: method,
    p_reference: reference || null,
    p_paid_on: paidOn || null,
    p_notes: notes || null,
  });
  if (error) throw error;
  return data;
};

/** Member share purchases with money owed on them and no receipt yet, oldest first. */
export const fetchPendingSharePurchases = async (memberId = null) => {
  const { data, error } = await supabase.rpc('sacco_receipt_pending_share_purchases', {
    p_member_id: memberId || null,
  });
  if (error) throw error;
  return data || [];
};

/** Receipt totals for a period, one row per kind of receipt and payment method. */
export const fetchReceiptSummary = async ({ from = null, to = null } = {}) => {
  const { data, error } = await supabase.rpc('sacco_receipt_summary', {
    p_from: from || null,
    p_to: to || null,
  });
  if (error) throw error;
  return data || [];
};

/** One receipt with the lines it settled, in printed order. */
export const fetchReceipt = async (receiptId) => {
  const { data, error } = await supabase
    .from('sacco_receipts')
    .select('*, lines:sacco_receipt_lines(*)')
    .eq('id', receiptId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...data, lines: [...(data.lines || [])].sort((a, b) => (a.line_no || 0) - (b.line_no || 0)) };
};

/**
 * Which instalments and share purchases already carry a receipt.
 *
 * Pass `memberId` for everything one member has been receipted for (the member
 * portal), or `scheduleIds` for one loan's schedule. Returns two maps keyed by
 * schedule id and share transaction id, each holding { id, receipt_no, paid_on }.
 */
export const fetchReceiptLinks = async ({ memberId = null, scheduleIds = null } = {}) => {
  const empty = { bySchedule: new Map(), byShareTxn: new Map() };
  if (!memberId && !(scheduleIds && scheduleIds.length)) return empty;

  const rows = await fetchAllRows(() => {
    let q = supabase
      .from('sacco_receipt_lines')
      .select('id, schedule_id, share_txn_id, receipt:sacco_receipts(id, receipt_no, paid_on)')
      .order('id', { ascending: true });
    if (memberId) q = q.eq('member_id', memberId);
    if (scheduleIds && scheduleIds.length) q = q.in('schedule_id', scheduleIds);
    return q;
  });

  const links = { bySchedule: new Map(), byShareTxn: new Map() };
  rows.forEach((row) => {
    if (!row.receipt) return;
    if (row.schedule_id) links.bySchedule.set(row.schedule_id, row.receipt);
    if (row.share_txn_id) links.byShareTxn.set(row.share_txn_id, row.receipt);
  });
  return links;
};

/** Every active loan in the book, with its borrower, for the "what is being paid" picker. */
export const fetchActiveLoans = () => fetchAllRows(() => supabase
  .from('sacco_loans')
  .select('id, member_id, principal, term_months, disbursed_at, created_at, '
    + 'product:sacco_loan_products(name), member:sacco_members(id, full_name, member_no)')
  .eq('status', 'active')
  .order('created_at', { ascending: true }));

/** One loan's instalments still to be paid, in due order. */
export const fetchUnpaidInstalments = async (loanId) => {
  const { data, error } = await supabase
    .from('sacco_loan_schedule')
    .select('id, loan_id, period_no, due_date, interest, principal, payment, paid')
    .eq('loan_id', loanId)
    .not('paid', 'is', true)
    .order('period_no', { ascending: true });
  if (error) throw error;
  return data || [];
};

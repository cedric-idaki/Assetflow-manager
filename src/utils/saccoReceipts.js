/**
 * SACCO PAYMENT RECEIPTS — the rules both portals share.
 *
 * The receipt itself is issued by the database, in the same transaction as the
 * payment (supabase/migrations/20260925163000_sacco_payment_receipts.sql).
 * Nothing here decides what a receipt says. What lives here is what a screen
 * needs BEFORE it asks: which methods must carry a reference, what an
 * instalment costs, whether the amount the cashier typed matches what is being
 * settled. They are the same rules the RPCs enforce, so the cashier hears about
 * a slip before the round trip instead of after it.
 */

export const RECEIPT_TYPES = [
  { value: 'loan_repayment', label: 'Loan repayment', icon: 'Banknote' },
  { value: 'share_purchase', label: 'Share purchase', icon: 'PieChart' },
];

export const receiptTypeLabel = (type) =>
  RECEIPT_TYPES.find((t) => t.value === type)?.label || 'Payment';

/**
 * How a member can pay. Mirrors sacco_receipts_method_chk, and the methods
 * carrying `required` (the message shown when the reference is missing) mirror
 * sacco_receipt_payment_terms(): money that came through a system leaves a
 * reference behind, so M-Pesa, bank and cheque payments must quote it. Cash
 * does not.
 */
export const RECEIPT_METHODS = [
  { value: 'cash',   label: 'Cash',                    reference: 'Reference',      placeholder: 'Optional' },
  { value: 'mpesa',  label: 'M-Pesa',                  reference: 'M-Pesa code',    placeholder: 'e.g. QHX7Y8Z9AB',
    required: 'Enter the M-Pesa code.' },
  { value: 'bank',   label: 'Bank deposit / transfer', reference: 'Bank reference', placeholder: 'Slip or transfer reference',
    required: 'Enter the bank reference.' },
  { value: 'cheque', label: 'Cheque',                  reference: 'Cheque number',  placeholder: 'Cheque no.',
    required: 'Enter the cheque number.' },
  { value: 'card',   label: 'Card',                    reference: 'Approval code',  placeholder: 'Optional' },
  { value: 'other',  label: 'Other',                   reference: 'Reference',      placeholder: 'e.g. check-off, standing order' },
];

export const methodMeta = (method) => RECEIPT_METHODS.find((m) => m.value === method) || null;
export const methodLabel = (method) => methodMeta(method)?.label || (method ? String(method) : '—');

/** A Safaricom transaction code: ten letters and digits, printed in capitals. */
export const MPESA_CODE = /^[A-Z0-9]{10}$/;

const round2 = (n) => Math.round(((parseFloat(n) || 0) + Number.EPSILON) * 100) / 100;

const kes = (n) => `KES ${round2(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * What an instalment costs: principal plus interest, each as stored. That is
 * what the ledger sync posts for it and what the RPC checks the amount against
 * — NOT the schedule's `payment` column, which is rounded on its own and can
 * sit a cent away from the two parts it is made of.
 */
export const instalmentDue = (row) => round2(round2(row?.principal) + round2(row?.interest));

export const instalmentsDue = (rows = []) =>
  round2((rows || []).reduce((sum, r) => sum + instalmentDue(r), 0));

/** A share purchase costs the price of the shares plus the buyer's fee. */
export const purchaseDue = (purchase) =>
  round2(round2(purchase?.consideration ?? purchase?.amount) + round2(purchase?.fee));

/**
 * The short reference a loan is quoted by. Loans carry no number of their own,
 * so this is the same slice of the id the receipt RPC prints — keep the two in
 * step.
 */
export const loanRef = (loanId) => (loanId ? `LN-${String(loanId).slice(0, 8).toUpperCase()}` : 'LN-—');

/**
 * Today as the treasurer's calendar reads it. toISOString() is UTC, which in
 * Nairobi turns "today" into yesterday until 3am — and a date picker capped at
 * yesterday refuses the payment the member is standing there making.
 */
export const localToday = (now = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
};

/**
 * The first thing wrong with a payment, in words a cashier can act on, or null
 * when it is ready to receipt.
 */
export const validateReceiptPayment = ({ due, amount, method, reference, paidOn, today = localToday() } = {}) => {
  if (!(round2(due) > 0)) return 'Choose what this payment settles.';

  const typed = amount === '' || amount == null ? NaN : parseFloat(amount);
  if (Number.isNaN(typed)) return 'Enter the amount received.';
  if (round2(typed) !== round2(due)) {
    return `The amount received (${kes(typed)}) must equal what is being settled (${kes(due)}).`;
  }

  const meta = methodMeta(method);
  if (!meta) return 'Choose how the member paid.';

  const ref = String(reference ?? '').trim();
  if (meta.required && !ref) return meta.required;
  if (method === 'mpesa' && !MPESA_CODE.test(ref.toUpperCase())) {
    return 'An M-Pesa code is 10 letters and digits, like QHX7Y8Z9AB.';
  }

  if (!paidOn) return 'Enter the date the member paid.';
  if (paidOn > today) return 'The payment date cannot be in the future.';
  return null;
};

/**
 * The receipt book is missing on this database: the frontend shipped before
 * migration 20260925163000 did. PostgREST reports a missing function as
 * PGRST202 and a missing table as PGRST205 (42P01 underneath).
 */
export const isReceiptBookMissing = (err) => {
  const code = err?.code || '';
  const msg = String(err?.message || err || '');
  return ['PGRST202', 'PGRST205', '42P01', '42883'].includes(code)
    || /could not find the (function|table)|does not exist/i.test(msg);
};

/** A refusal from the receipt RPCs, as one sentence. */
export const describeReceiptError = (err) => {
  if (isReceiptBookMissing(err)) {
    return 'Receipts are not set up on the server yet — database migration 20260925163000 has to be applied first.';
  }
  const msg = String(err?.message || '');
  if (err?.code === '23505') {
    // The RPCs raise their own 23505 with a readable message. These are the
    // bare constraint errors from two cashiers pressing the button together.
    if (msg.includes('uq_sacco_receipts_mpesa_ref')) return 'That M-Pesa code is already on another receipt.';
    if (msg.includes('uq_sacco_receipt_lines_schedule')) return 'One of those instalments was receipted a moment ago. Reload the schedule.';
    if (msg.includes('uq_sacco_receipt_lines_share_txn')) return 'This purchase was receipted a moment ago.';
  }
  return msg || 'The receipt could not be issued.';
};

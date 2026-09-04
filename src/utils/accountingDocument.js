/**
 * ACCOUNTING DOCUMENT BUILDER
 *
 * Every accounting transaction in this app can now be handed over as a
 * document: a JOURNAL VOUCHER for an entry in the books, a TAX INVOICE for a
 * bill, an OFFICIAL RECEIPT for money received. Auditors ask for the paper
 * behind a figure, and most of the ledger had none — you could see an entry on
 * screen and had no way to take it off the screen.
 *
 * The module is deliberately split in two halves:
 *
 *   build*()                     pure. Turns a stored transaction into the
 *                                exact CONTENT of its document — title, party,
 *                                the double entry, totals, notes. No DOM and no
 *                                PDF, so what a voucher SAYS is assertable in a
 *                                test rather than inferred from a saved file.
 *
 *   downloadAccountingDocument() paints that content with jsPDF and hands the
 *                                browser the file. It makes no decisions: every
 *                                amount it prints was decided by a builder.
 *
 * That split matters because the numbers on a voucher are evidence. They are
 * derived once, from the rows as stored, and never re-computed at paint time.
 */

import { loadJsPDF } from './jsPdfLoader';

// ── Formatting ───────────────────────────────────────────────────────────────
export const money = (n, currency = 'KES') =>
  `${currency} ${(parseFloat(n) || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

export const fmtDate = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const round2 = (n) => Math.round(((parseFloat(n) || 0) + Number.EPSILON) * 100) / 100;

/** Every OS refuses a filename carrying these. */
const safeName = (s, fallback = 'Document') =>
  (String(s || '').trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_') || fallback).slice(0, 80);

// ── Issuer ───────────────────────────────────────────────────────────────────
/**
 * The letterhead. Callers hand this either a raw `company_profiles` row or an
 * already-resolved seller — the finance hub resolves an invoice's seller from
 * the asset, which is not always the tenant reading the screen — so both shapes
 * are accepted rather than forcing one on every call site.
 */
export const normaliseIssuer = (co) => {
  const name = co?.name || co?.company_name || co?.sacco_name || 'Ararat';
  const address = co?.address
    || co?.physical_address
    || [co?.location, co?.city].filter(Boolean).join(', ')
    || '';
  const regNo = co?.reg_no || co?.business_registration_number || co?.registration_no || '';
  const lines = [
    regNo ? `Reg No: ${regNo}` : '',
    co?.kra_pin ? `KRA PIN: ${co.kra_pin}` : '',
    address,
    [co?.phone, co?.email].filter(Boolean).join(' · '),
  ].filter(Boolean);
  return { name, lines: lines.slice(0, 4) };
};

// ── Journal entries ──────────────────────────────────────────────────────────
/**
 * The finance hub stores a journal entry as PAIRED rows — each row carries one
 * debit account, one credit account, and the amount that moved between them.
 * A voucher has to read the other way round, as legs: every account debited,
 * then every account credited.
 *
 * So the pairs are unwound and re-aggregated by account and side. A three-row
 * entry that touches the bank twice prints one bank line for the total, which
 * is what an accountant expects to sign — not six half-lines that happen to
 * mirror how the rows were written.
 */
export const normaliseJournalRows = (rows = []) => {
  const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
  const first = list[0] || {};

  const legs = new Map(); // "side|account" → { account, debit, credit }
  const add = (account, side, amount) => {
    const name = String(account || 'Unallocated');
    const key  = `${side}|${name}`;
    if (!legs.has(key)) legs.set(key, { account: name, debit: 0, credit: 0 });
    legs.get(key)[side] += parseFloat(amount) || 0;
  };
  list.forEach((r) => {
    const amount = parseFloat(r.amount) || 0;
    if (r.debit_account)  add(r.debit_account,  'debit',  amount);
    if (r.credit_account) add(r.credit_account, 'credit', amount);
  });

  // Debits first, the way a voucher is read and signed.
  const lines = [...legs.values()]
    .sort((a, b) => (b.debit > 0 ? 1 : 0) - (a.debit > 0 ? 1 : 0))
    .map((l) => ({ account: l.account, debit: round2(l.debit), credit: round2(l.credit) }));

  return {
    entryNo:     first.entry_no || (first.id ? `JE-${String(first.id).slice(-6).toUpperCase()}` : ''),
    date:        first.entry_date || first.created_at || null,
    description: first.description || '',
    reference:   first.reference || '',
    entryType:   first.entry_type || '',
    trigger:     first.trigger_event || '',
    period:      first.period_month || '',
    automated:   !!first.is_automated,
    status:      list.some((r) => r.status === 'reversed') ? 'reversed' : (first.status || 'posted'),
    lines,
    party:       null,
  };
};

/**
 * A sacco entry already stores true debit/credit lines, so nothing has to be
 * unwound — but it carries a member, and a member transaction's voucher is
 * worthless without saying whose money moved.
 */
export const normaliseSaccoEntry = (entry = {}) => {
  const lines = [...(entry.lines || [])]
    .sort((a, b) => (a.line_no || 0) - (b.line_no || 0))
    .map((l) => ({
      account: [l.account_code, l.account_name].filter(Boolean).join(' — ') || 'Unallocated',
      debit:   round2(l.debit),
      credit:  round2(l.credit),
    }));

  return {
    entryNo:     entry.entry_no || (entry.id ? `JE-${String(entry.id).slice(-6).toUpperCase()}` : ''),
    date:        entry.entry_date || entry.created_at || null,
    description: entry.description || '',
    reference:   entry.reference || '',
    entryType:   entry.template_code || '',
    trigger:     '',
    period:      '',
    automated:   !!entry.is_automated,
    status:      entry.status || 'posted',
    lines,
    party: entry.member
      ? {
          heading: 'Member',
          name: entry.member.full_name || '—',
          lines: [entry.member.member_no ? `Member No: ${entry.member.member_no}` : ''].filter(Boolean),
        }
      : null,
  };
};

/**
 * A journal voucher: the double entry, its totals, and enough provenance for
 * somebody who was not in the room to see why it was posted.
 */
export const buildJournalVoucher = ({ entry, company, currency = 'KES', title } = {}) => {
  const e = entry || {};
  const lines = e.lines || [];
  const totalDebit  = round2(lines.reduce((s, l) => s + (parseFloat(l.debit)  || 0), 0));
  const totalCredit = round2(lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0));
  const docNo = e.entryNo || 'JOURNAL VOUCHER';

  const meta = [
    { label: 'Entry No',   value: e.entryNo || '—' },
    { label: 'Entry Date', value: fmtDate(e.date) },
    { label: 'Type',       value: e.entryType || (e.automated ? 'Automated' : 'General') },
    { label: 'Reference',  value: e.reference || '—' },
    { label: 'Source',     value: e.automated ? 'Posted by the system' : 'Posted manually' },
    e.trigger ? { label: 'Trigger', value: e.trigger } : null,
    e.period  ? { label: 'Period',  value: e.period  } : null,
    { label: 'Status',     value: String(e.status || 'posted').toUpperCase() },
  ].filter(Boolean);

  const notes = [];
  // An out-of-balance voucher has to say so on its face. The database will not
  // accept one, so if it ever prints, the document is where it gets caught.
  const drift = round2(totalDebit - totalCredit);
  if (drift !== 0) {
    notes.push(`This entry is out of balance by ${money(Math.abs(drift), currency)}. Do not file it without a correction.`);
  }
  if (e.status === 'reversed') {
    notes.push('This entry has been REVERSED. A mirrored entry exists in the ledger; this voucher is retained for the audit trail only.');
  }
  if (e.status === 'reversal') {
    notes.push('This entry IS a reversal — it was posted to cancel an earlier entry.');
  }

  return {
    kind: 'journal_voucher',
    title: title || 'JOURNAL VOUCHER',
    docNo,
    dateLabel: fmtDate(e.date),
    status: e.status || 'posted',
    issuer: normaliseIssuer(company),
    party: e.party || null,
    subject: e.description || 'Journal entry',
    meta,
    table: {
      columns: [
        { key: 'account', label: 'Account', width: 0.58, align: 'left'  },
        { key: 'debit',   label: 'Debit',   width: 0.21, align: 'right' },
        { key: 'credit',  label: 'Credit',  width: 0.21, align: 'right' },
      ],
      rows: lines.map((l) => ({
        account: l.account,
        debit:   l.debit  > 0 ? money(l.debit,  currency) : '',
        credit:  l.credit > 0 ? money(l.credit, currency) : '',
      })),
      footer: { account: 'TOTALS', debit: money(totalDebit, currency), credit: money(totalCredit, currency) },
    },
    summary: [],
    notes,
    signatures: ['Prepared by', 'Checked by', 'Approved by'],
    footNote: 'Computer-generated journal voucher. File it with the supporting documents for this transaction.',
    filename: `Journal_Voucher_${safeName(docNo, 'Entry')}.pdf`,
  };
};

// ── Invoices and receipts ────────────────────────────────────────────────────
const PAID_STATUSES = new Set(['paid', 'completed', 'successful']);

const isPaid = (status) => PAID_STATUSES.has(String(status || '').toLowerCase());

/**
 * An invoice row prints as a TAX INVOICE while it is owed and as an OFFICIAL
 * RECEIPT once it is settled — the same transaction, but the document a client
 * needs changes the moment the money lands.
 */
export const buildInvoiceDocument = ({ invoice, company, currency = 'KES' } = {}) => {
  const inv  = invoice || {};
  const paid = isPaid(inv.status);

  const items = (inv.items && inv.items.length > 0)
    ? inv.items.map((it) => ({
        description: it.description || '—',
        quantity:    String(it.quantity ?? 1),
        unit:        money(it.unit_price, currency),
        amount:      money(it.line_total ?? ((parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0)), currency),
      }))
    : [{
        description: [
          inv.asset && inv.asset !== '—' ? inv.asset : 'Asset payment',
          [inv.asset_code, inv.plate_number].filter(Boolean).join(' · '),
        ].filter(Boolean).join('\n'),
        quantity: '1',
        unit:     money(inv.amount, currency),
        amount:   money(inv.amount, currency),
      }];

  const subtotal = round2(inv.amount);
  const vat      = round2(inv.vat_amount);
  const total    = round2(inv.total ?? (subtotal + vat));

  const summary = [
    { label: 'Subtotal', value: money(subtotal, currency) },
    { label: `VAT (${inv.vat_rate ?? 0}%)`, value: money(vat, currency) },
    { label: paid ? 'AMOUNT PAID' : 'TOTAL DUE', value: money(total, currency), emphasis: true },
  ];

  // Hire-purchase terms belong on the client's copy: what they pay each month,
  // for how long, and what the plan costs in total.
  const plan = inv.plan;
  if (plan) {
    summary.push({ label: 'Monthly installment', value: money(plan.monthly_installment, currency) });
    summary.push({ label: 'Tenure',              value: `${plan.tenure_months || 0} months` });
    summary.push({ label: 'Balance financed',    value: money(plan.financed, currency) });
    summary.push({ label: 'Total payable',       value: money(plan.plan_total, currency) });
  }

  return {
    kind: paid ? 'receipt' : 'tax_invoice',
    title: paid ? 'OFFICIAL RECEIPT' : 'TAX INVOICE',
    docNo: inv.invoice_no || '—',
    dateLabel: fmtDate(inv.date),
    status: inv.status || 'pending',
    issuer: normaliseIssuer(company),
    party: {
      heading: paid ? 'Received From' : 'Bill To',
      name: inv.client_name || '—',
      lines: [
        inv.account_no   ? `Account: ${inv.account_no}` : '',
        inv.client_phone || '',
        inv.client_email || '',
      ].filter(Boolean),
    },
    subject: paid ? 'Payment received with thanks.' : 'Amount due as detailed below.',
    meta: [
      { label: 'Invoice No', value: inv.invoice_no || '—' },
      { label: 'Date',       value: fmtDate(inv.date) },
      { label: 'Due Date',   value: fmtDate(inv.due_date) },
      { label: 'Method',     value: inv.method || inv.payment_method || '—' },
      { label: 'Reference',  value: inv.reference || '—' },
      { label: 'Status',     value: String(inv.status || 'pending').toUpperCase() },
    ],
    table: {
      columns: [
        { key: 'description', label: 'Description', width: 0.50, align: 'left'  },
        { key: 'quantity',    label: 'Qty',         width: 0.10, align: 'right' },
        { key: 'unit',        label: 'Unit Price',  width: 0.20, align: 'right' },
        { key: 'amount',      label: 'Amount',      width: 0.20, align: 'right' },
      ],
      rows: items,
      footer: null,
    },
    summary,
    notes: inv.notes ? [inv.notes] : [],
    signatures: paid ? [] : ['Prepared by', 'Authorised by'],
    footNote: paid
      ? 'Official receipt — no signature required. Retain it as proof of payment.'
      : 'Please settle this invoice by the due date shown above.',
    filename: `${paid ? 'Receipt' : 'Invoice'}_${safeName(inv.invoice_no, 'Document')}_${safeName(inv.client_name, 'Client')}.pdf`,
  };
};

/**
 * The collections desk holds payments in its own shape — a transaction rather
 * than an invoice — so it gets its own adapter instead of every call site
 * having to fake an invoice around one.
 */
export const buildPaymentReceipt = ({ txn, company, currency = 'KES' } = {}) => {
  const t = txn || {};
  const paid = isPaid(t.status);
  const amount = round2(t.amount);
  const when = [fmtDate(t.date), t.time].filter(Boolean).join(' ');

  return {
    kind: paid ? 'receipt' : 'tax_invoice',
    title: paid ? 'OFFICIAL RECEIPT' : 'INVOICE',
    docNo: t.transactionId || '—',
    dateLabel: when || '—',
    status: t.status || 'pending',
    issuer: normaliseIssuer(company),
    party: {
      heading: paid ? 'Received From' : 'Billed To',
      name: t.clientName || '—',
      lines: [
        t.accountNumber && t.accountNumber !== '-' ? `Account: ${t.accountNumber}` : '',
        t.clientPhone || '',
        t.clientEmail || '',
      ].filter(Boolean),
    },
    subject: paid ? 'Payment received with thanks.' : 'Amount due as detailed below.',
    meta: [
      { label: 'Transaction', value: t.transactionId || '—' },
      { label: 'Date',        value: when || '—' },
      { label: 'Method',      value: String(t.paymentMethod || '—').replace(/_/g, ' ') },
      { label: 'Reference',   value: t.reference || '—' },
      { label: 'Status',      value: String(t.status || 'pending').toUpperCase() },
    ],
    table: {
      columns: [
        { key: 'description', label: 'Description', width: 0.70, align: 'left'  },
        { key: 'amount',      label: 'Amount',      width: 0.30, align: 'right' },
      ],
      rows: [{
        description: [t.assetName || (paid ? 'Payment received' : 'Amount due'), t.assetCode || '']
          .filter(Boolean).join('\n'),
        amount: money(amount, currency),
      }],
      footer: null,
    },
    summary: [{ label: paid ? 'AMOUNT PAID' : 'TOTAL DUE', value: money(amount, currency), emphasis: true }],
    notes: t.notes ? [t.notes] : [],
    signatures: paid ? [] : ['Prepared by', 'Authorised by'],
    footNote: paid
      ? 'Official payment receipt — no signature required.'
      : 'Please settle this invoice by the agreed due date.',
    filename: `${paid ? 'Receipt' : 'Invoice'}_${safeName(t.transactionId, 'Payment')}_${safeName(t.clientName, 'Client')}.pdf`,
  };
};

const ACCOUNT_LABELS = {
  deposits: 'Member deposits (savings)',
  share_capital: 'Share capital',
  other: 'Other account',
};

/**
 * A member handing over money is the one transaction in a sacco that everybody
 * expects a slip for. Only a settled contribution is a receipt: one that is
 * pending, waived or reversed prints as an ACKNOWLEDGEMENT that says what it
 * actually is, so nobody can wave an unsettled slip as proof of payment.
 */
export const buildContributionReceipt = ({ contribution, sacco, currency = 'KES' } = {}) => {
  const c = contribution || {};
  const settled = String(c.status || '').toLowerCase() === 'completed';
  const amount  = round2(c.amount);
  const penalty = round2(c.penalty_amount);
  const when    = c.paid_at || c.paid_date || c.due_date;

  const rows = [{
    description: `${String(c.contribution_type || 'Contribution').replace(/_/g, ' ')} contribution`
      + `\n${ACCOUNT_LABELS[c.account] || c.account || 'Member account'}`,
    amount: money(amount, currency),
  }];
  if (penalty > 0) rows.push({ description: 'Late-payment penalty', amount: money(penalty, currency) });

  const total = round2(amount + penalty);

  return {
    kind: settled ? 'receipt' : 'acknowledgement',
    title: settled ? 'OFFICIAL RECEIPT' : 'CONTRIBUTION ACKNOWLEDGEMENT',
    docNo: c.txn_no || (c.id ? `CT-${String(c.id).slice(-6).toUpperCase()}` : '—'),
    dateLabel: fmtDate(when),
    status: c.status || 'pending',
    issuer: normaliseIssuer(sacco),
    party: {
      heading: 'Received From',
      name: c.member?.full_name || '—',
      lines: [c.member?.member_no ? `Member No: ${c.member.member_no}` : ''].filter(Boolean),
    },
    subject: settled
      ? 'Contribution received with thanks.'
      : 'This contribution has not settled. It is not proof of payment.',
    meta: [
      { label: 'Transaction No', value: c.txn_no || '—' },
      { label: settled ? 'Paid On' : 'Due On', value: fmtDate(when) },
      { label: 'Method',      value: String(c.payment_method || '—').replace(/_/g, ' ') },
      { label: 'Reference',   value: c.reference || '—' },
      { label: 'Received By', value: c.received_by_name || (c.channel === 'mpesa_auto' ? 'M-Pesa (automatic)' : '—') },
      { label: 'Status',      value: String(c.status || 'pending').toUpperCase() },
    ],
    table: {
      columns: [
        { key: 'description', label: 'Description', width: 0.70, align: 'left'  },
        { key: 'amount',      label: 'Amount',      width: 0.30, align: 'right' },
      ],
      rows,
      footer: null,
    },
    summary: [{ label: settled ? 'AMOUNT RECEIVED' : 'AMOUNT DUE', value: money(total, currency), emphasis: true }],
    notes: c.notes ? [c.notes] : [],
    signatures: settled ? ['Received by', 'Member'] : [],
    footNote: settled
      ? 'Official receipt — retain it as proof of your contribution.'
      : 'Not a receipt. It becomes one once the contribution is approved and settled.',
    filename: `${settled ? 'Receipt' : 'Acknowledgement'}_${safeName(c.txn_no, 'Contribution')}_${safeName(c.member?.full_name, 'Member')}.pdf`,
  };
};

/**
 * A loan installment, receipted. The borrower needs the split — how much of
 * what they handed over went to interest and how much actually reduced the
 * loan — and the balance they are left owing, which is the whole reason a
 * repayment slip exists rather than a bare "amount received".
 */
export const buildLoanRepaymentReceipt = ({ installment, loan, sacco, currency = 'KES' } = {}) => {
  const r = installment || {};
  const periodNo  = r.period_no ?? r.periodNo;
  const interest  = round2(r.interest);
  const principal = round2(r.principal);
  const payment   = round2(r.payment);
  const closing   = round2(r.closing_balance ?? r.closingBalance);
  const dueDate   = r.due_date || r.dueDate;
  const paid      = !!r.paid;

  return {
    kind: paid ? 'receipt' : 'demand',
    title: paid ? 'LOAN REPAYMENT RECEIPT' : 'LOAN INSTALLMENT NOTICE',
    docNo: `LR-${safeName(loan?.loan_no || String(loan?.id || '').slice(-6).toUpperCase(), 'LOAN')}-${periodNo ?? '0'}`,
    dateLabel: fmtDate(paid ? (r.paid_date || dueDate) : dueDate),
    status: paid ? 'paid' : 'pending',
    issuer: normaliseIssuer(sacco),
    party: {
      heading: 'Borrower',
      name: loan?.member?.full_name || '—',
      lines: [loan?.member?.member_no ? `Member No: ${loan.member.member_no}` : ''].filter(Boolean),
    },
    subject: paid
      ? `Installment ${periodNo} received with thanks.`
      : `Installment ${periodNo} falls due on ${fmtDate(dueDate)}.`,
    meta: [
      { label: 'Installment', value: String(periodNo ?? '—') },
      { label: 'Due Date',    value: fmtDate(dueDate) },
      paid ? { label: 'Paid On', value: fmtDate(r.paid_date || dueDate) } : null,
      { label: 'Loan Principal', value: money(loan?.principal, currency) },
      { label: 'Status',      value: paid ? 'PAID' : 'OUTSTANDING' },
    ].filter(Boolean),
    table: {
      columns: [
        { key: 'description', label: 'Applied To', width: 0.70, align: 'left'  },
        { key: 'amount',      label: 'Amount',     width: 0.30, align: 'right' },
      ],
      rows: [
        { description: 'Interest', amount: money(interest, currency) },
        { description: 'Principal reduction', amount: money(principal, currency) },
      ],
      footer: { description: paid ? 'AMOUNT RECEIVED' : 'AMOUNT DUE', amount: money(payment, currency) },
    },
    summary: [{ label: 'BALANCE AFTER THIS INSTALLMENT', value: money(closing, currency), emphasis: true }],
    notes: [],
    signatures: paid ? ['Received by', 'Borrower'] : [],
    footNote: paid
      ? 'Loan repayment receipt — retain it as proof of payment.'
      : 'Not a receipt. This installment has not been paid.',
    filename: `${paid ? 'Repayment_Receipt' : 'Installment_Notice'}_${safeName(loan?.member?.full_name, 'Borrower')}_${periodNo ?? '0'}.pdf`,
  };
};

/**
 * Share movements, as the member's own paperwork.
 *
 * `amount` on a share transaction is the gross consideration
 * (|shares| × price_per_share) and `fee` is that party's own trading fee, held
 * separately — so the fee is ADDED for someone acquiring shares and DEDUCTED
 * from someone disposing of them. Printing `amount` alone would understate what
 * a buyer actually paid and overstate what a seller actually received, which is
 * the one number either of them keeps the slip for.
 *
 * Money only moves on some of these types. A transfer or an adjustment moves
 * shares and nothing else, and is titled as an advice rather than a receipt so
 * it can never read as evidence of a payment.
 */
const SHARE_TXN_LABELS = {
  issue: 'Shares issued', purchase: 'Shares bought', sale: 'Shares sold',
  transfer_in: 'Shares received', transfer_out: 'Shares transferred out',
  allotment: 'Shares allotted', buyback: 'Shares bought back',
  retire: 'Shares retired', adjustment: 'Share adjustment',
  dividend: 'Dividend', reversal: 'Reversal',
};

export const buildShareTransactionReceipt = ({ txn, member, sacco, currency = 'KES' } = {}) => {
  const t = txn || {};
  const shares = parseInt(t.shares, 10) || 0;
  const price  = round2(t.price_per_share);
  const amount = round2(t.amount);
  const fee    = round2(t.fee);
  const gain   = round2(t.realized_gain);
  const who    = member || t.member || {};

  const acquired = shares > 0;
  const disposed = shares < 0;
  const paidFor  = amount > 0 || fee > 0;          // did money move at all?
  const movement = SHARE_TXN_LABELS[t.txn_type]
    || String(t.txn_type || 'Share movement').replace(/_/g, ' ');

  // The member's side of the money: a buyer pays the fee on top, a seller has
  // it taken out of the proceeds.
  const total = acquired ? round2(amount + fee) : round2(amount - fee);

  const receipt = acquired && paidFor;
  const title = receipt ? 'SHARE PURCHASE RECEIPT'
    : disposed && paidFor ? 'SHARE DISPOSAL ADVICE'
    : 'SHARE TRANSFER ADVICE';

  const rows = [{
    description: `${movement}`
      + `\n${Math.abs(shares).toLocaleString()} share${Math.abs(shares) === 1 ? '' : 's'}`
      + (price > 0 ? ` @ ${money(price, currency)} each` : ''),
    amount: money(amount, currency),
  }];
  if (fee > 0) {
    rows.push({
      description: acquired ? 'Trading fee (added)' : 'Trading fee (deducted)',
      amount: money(fee, currency),
    });
  }

  const summary = [{
    label: 'SHAREHOLDING AFTER THIS MOVEMENT',
    value: `${(parseInt(t.balance_after, 10) || 0).toLocaleString()} shares`,
    emphasis: true,
  }];
  if (disposed && gain !== 0) {
    summary.unshift({
      label: gain > 0 ? 'REALISED GAIN' : 'REALISED LOSS',
      value: money(Math.abs(gain), currency),
    });
  }

  return {
    kind: receipt ? 'receipt' : 'advice',
    title,
    docNo: t.txn_no || (t.id ? `SHT-${String(t.id).slice(-6).toUpperCase()}` : '—'),
    dateLabel: fmtDate(t.created_at),
    status: receipt ? 'completed' : 'recorded',
    issuer: normaliseIssuer(sacco),
    party: {
      heading: acquired ? 'Received From' : 'Shareholder',
      name: who.full_name || '—',
      lines: [who.member_no ? `Member No: ${who.member_no}` : ''].filter(Boolean),
    },
    subject: receipt
      ? 'Share purchase received with thanks.'
      : disposed && paidFor
        ? 'Your shares were disposed of as set out below.'
        : 'This records a movement of shares. No money changed hands.',
    meta: [
      { label: 'Transaction No', value: t.txn_no || '—' },
      { label: 'Date',           value: fmtDate(t.created_at) },
      { label: 'Movement',       value: movement },
      { label: 'Shares',         value: `${shares > 0 ? '+' : ''}${shares.toLocaleString()}` },
      price > 0 ? { label: 'Price Per Share', value: money(price, currency) } : null,
      { label: 'Balance After',  value: `${(parseInt(t.balance_after, 10) || 0).toLocaleString()} shares` },
    ].filter(Boolean),
    table: {
      columns: [
        { key: 'description', label: 'Description', width: 0.70, align: 'left'  },
        { key: 'amount',      label: 'Amount',      width: 0.30, align: 'right' },
      ],
      rows,
      footer: paidFor
        ? { description: acquired ? 'TOTAL PAID' : 'NET PROCEEDS', amount: money(total, currency) }
        : null,
    },
    summary,
    notes: t.notes ? [t.notes] : [],
    signatures: receipt ? ['Received by', 'Member'] : [],
    footNote: receipt
      ? 'Official receipt — retain it as proof of your share purchase.'
      : disposed && paidFor
        ? 'Share disposal advice. Any realised gain shown is the society’s own computation.'
        : 'Advice of a share movement. It is not a receipt and not proof of payment.',
    filename: `${receipt ? 'Share_Receipt' : 'Share_Advice'}_${safeName(t.txn_no, 'Share')}_${safeName(who.full_name, 'Member')}.pdf`,
  };
};

/**
 * A member's dividend, with the withholding tax shown on its face.
 *
 * The member is taxed on the gross and paid the net, and the difference is
 * withheld by the society on their behalf — so a slip showing only the net
 * would leave them unable to account for the tax at all. Gross, tax and net are
 * all printed, and an allocation that has not been paid says so rather than
 * passing for a payment advice.
 */
export const buildDividendStatement = ({ allocation, declaration, member, sacco, currency = 'KES' } = {}) => {
  const a = allocation || {};
  const d = declaration || a.declaration || {};
  const who = member || a.member || {};

  const gross  = round2(a.gross_amount);
  const tax    = round2(a.tax_amount);
  const net    = round2(a.net_amount);
  const shares = parseInt(a.shares_at_record, 10) || 0;

  const status    = String(a.status || 'pending').toLowerCase();
  const paid      = status === 'paid';
  const cancelled = status === 'cancelled';

  const basis = d.basis === 'per_share'
    ? `${money(d.dividend_per_share, currency)} per share`
    : d.dividend_percent
      ? `${parseFloat(d.dividend_percent)}% of profit`
      : '—';

  const rows = [{
    description: `Dividend for ${d.period_label || 'the period'}`
      + `\n${shares.toLocaleString()} share${shares === 1 ? '' : 's'} held at record date`,
    amount: money(gross, currency),
  }];
  if (tax > 0) rows.push({ description: 'Less: withholding tax', amount: money(tax, currency) });

  return {
    kind: paid ? 'receipt' : 'advice',
    title: cancelled ? 'DIVIDEND CANCELLATION NOTICE'
      : paid ? 'DIVIDEND PAYMENT ADVICE'
      : 'DIVIDEND ENTITLEMENT ADVICE',
    docNo: `DV-${safeName(d.period_label, 'PERIOD')}-${String(a.id || '').slice(-6).toUpperCase() || '000000'}`,
    dateLabel: fmtDate(paid ? (a.paid_at || d.payment_date) : (d.payment_date || d.record_date)),
    status,
    issuer: normaliseIssuer(sacco),
    party: {
      heading: paid ? 'Paid To' : 'Shareholder',
      name: who.full_name || '—',
      lines: [who.member_no ? `Member No: ${who.member_no}` : ''].filter(Boolean),
    },
    subject: cancelled
      ? 'This dividend allocation was cancelled.'
      : paid
        ? 'Your dividend has been paid as set out below.'
        : 'Your dividend entitlement is set out below. It has not been paid yet.',
    meta: [
      { label: 'Period',      value: d.period_label || '—' },
      { label: 'Basis',       value: basis },
      { label: 'Record Date', value: fmtDate(d.record_date) },
      { label: paid ? 'Paid On' : 'Payment Date',
        value: fmtDate(paid ? (a.paid_at || d.payment_date) : d.payment_date) },
      { label: 'Shares At Record', value: shares.toLocaleString() },
      a.payment_ref ? { label: 'Payment Ref', value: a.payment_ref } : null,
      { label: 'Status',      value: status.toUpperCase() },
    ].filter(Boolean),
    table: {
      columns: [
        { key: 'description', label: 'Description', width: 0.70, align: 'left'  },
        { key: 'amount',      label: 'Amount',      width: 0.30, align: 'right' },
      ],
      rows,
      footer: { description: paid ? 'NET DIVIDEND PAID' : 'NET DIVIDEND DUE', amount: money(net, currency) },
    },
    summary: [
      { label: 'GROSS DIVIDEND', value: money(gross, currency) },
      ...(tax > 0 ? [{ label: 'WITHHOLDING TAX', value: money(tax, currency) }] : []),
      { label: paid ? 'NET PAID' : 'NET DUE', value: money(net, currency), emphasis: true },
    ],
    notes: d.notes ? [d.notes] : [],
    signatures: paid ? ['Paid by', 'Member'] : [],
    footNote: cancelled
      ? 'This allocation was cancelled and no payment is due on it.'
      : paid
        ? 'Dividend payment advice — the withholding tax shown was remitted on your behalf.'
        : 'Not a payment advice. It becomes one once the dividend is paid.',
    filename: `${paid ? 'Dividend_Advice' : 'Dividend_Entitlement'}_${safeName(d.period_label, 'Period')}_${safeName(who.full_name, 'Member')}.pdf`,
  };
};

/**
 * A payroll run is an accounting transaction too, and the payslip is the
 * employee's copy of it — not the company's. This is the company's: the
 * payment voucher that says what was paid, what was withheld on the employee's
 * behalf, and who approved it.
 *
 * `data` is the resolved engine result (`resolvePayrollRecord`), so the tax
 * engine stays out of this module and the voucher can never disagree with the
 * payslip drawn from the same object.
 */
export const buildPayrollVoucher = ({ record, employee, month, data, company, currency = 'KES' } = {}) => {
  const r = record || {};
  const d = data || {};
  const gross = round2(d.grossCash);
  const net   = round2(d.netPay);
  const statutory = ['paye', 'nssf', 'shif', 'housingLevy']
    .reduce((s, k) => s + round2(d[k]), 0);
  // Whatever the engine withheld beyond the statutory four — pension, a salary
  // advance, a staff loan. Deriving it keeps gross less deductions equal to net
  // on the face of the voucher instead of leaving an unexplained gap.
  const other = round2(round2(d.totalDeductions) - statutory);

  const rows = [
    { description: 'Gross pay (cash earnings)', amount: money(gross, currency) },
    { description: 'PAYE (income tax)',   amount: `(${money(d.paye, currency)})` },
    { description: 'NSSF (Tier I & II)',  amount: `(${money(d.nssf, currency)})` },
    { description: 'SHIF',                amount: `(${money(d.shif, currency)})` },
    { description: 'Affordable Housing Levy', amount: `(${money(d.housingLevy, currency)})` },
  ];
  if (other > 0) rows.push({ description: 'Other deductions', amount: `(${money(other, currency)})` });

  const period = month || r.pay_month || '';
  const docNo = `PV-${safeName(period, 'PAYROLL')}-${safeName(employee?.full_name, 'Employee')}`;

  return {
    kind: 'payroll_voucher',
    title: 'PAYROLL PAYMENT VOUCHER',
    docNo,
    dateLabel: period ? fmtDate(`${period}-01`) : '—',
    status: r.status || 'pending',
    issuer: normaliseIssuer(company),
    party: {
      heading: 'Employee',
      name: employee?.full_name || '—',
      lines: [employee?.department || '', employee?.email || ''].filter(Boolean),
    },
    subject: `Salary for ${period || 'the period'}, paid net of statutory deductions.`,
    meta: [
      { label: 'Pay Month',  value: period || '—' },
      { label: 'Employee',   value: employee?.full_name || '—' },
      { label: 'Department', value: employee?.department || '—' },
      { label: 'Taxable Pay', value: d.taxablePay == null ? '—' : money(d.taxablePay, currency) },
      { label: 'Status',     value: String(r.status || 'pending').toUpperCase() },
      { label: 'Statutory basis', value: d.rateLabel || 'Not recorded' },
    ],
    table: {
      columns: [
        { key: 'description', label: 'Description', width: 0.70, align: 'left'  },
        { key: 'amount',      label: 'Amount',      width: 0.30, align: 'right' },
      ],
      rows,
      footer: { description: 'NET PAY', amount: money(net, currency) },
    },
    summary: [{ label: 'NET PAY', value: money(net, currency), emphasis: true }],
    notes: d.rateLabel ? [] : ['This row was priced by an earlier engine on a basis that was never recorded. The statutory figures are as stored.'],
    signatures: ['Prepared by', 'Approved by', 'Received by'],
    footNote: 'Payroll payment voucher. The employee’s own copy is the payslip for the same month.',
    filename: `Payroll_Voucher_${safeName(period, 'Period')}_${safeName(employee?.full_name, 'Employee')}.pdf`,
  };
};

// ── Painter ──────────────────────────────────────────────────────────────────
const BLUE  = [26, 86, 219];
const DARK  = [15, 23, 42];
const GRAY  = [100, 116, 139];
const LIGHT = [241, 245, 249];
const WHITE = [255, 255, 255];
const AMBER = [217, 119, 6];
const RED   = [220, 38, 38];
const GREEN = [5, 150, 105];

const STATUS_TONE = {
  paid: GREEN, completed: GREEN, successful: GREEN, approved: GREEN,
  posted: BLUE, pending: AMBER, reversal: AMBER,
  reversed: RED, overdue: RED, failed: RED, draft: GRAY,
};

const W = 210, M = 15, CW = W - M * 2, PAGE_BOTTOM = 272;

/**
 * Paints a built document and returns the jsPDF instance. It reads the model
 * and nothing else — every amount on the page was decided by a builder above.
 *
 * Rendering is separate from saving so the same page can be previewed or
 * attached to an email later without a file having to land on a disk first.
 */
export const renderAccountingDocument = async (model) => {
  if (!model) throw new Error('There is nothing to generate for this transaction.');
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const font  = (style = 'normal', size = 10) => { doc.setFont('helvetica', style); doc.setFontSize(size); };
  const color = (rgb) => doc.setTextColor(...rgb);
  const fill  = (x, y, w, h, rgb, r = 0) => {
    doc.setFillColor(...rgb);
    if (r > 0) doc.roundedRect(x, y, w, h, r, r, 'F'); else doc.rect(x, y, w, h, 'F');
  };
  const text = (s, x, y, opts) => doc.text(String(s ?? ''), x, y, opts);

  let Y = 0;
  const pageBreak = (needed = 10) => {
    if (Y + needed <= PAGE_BOTTOM) return false;
    doc.addPage();
    Y = M;
    return true;
  };

  // ── Header band ────────────────────────────────────────────────────────────
  fill(0, 0, W, 40, BLUE);
  font('bold', 16); color(WHITE);
  text(model.issuer?.name || 'Ararat', M, 15);
  font('normal', 8); color([185, 212, 255]);
  (model.issuer?.lines || []).forEach((l, i) => text(l, M, 21.5 + i * 4.5));

  font('bold', 18); color(WHITE);
  text(model.title, W - M, 15, { align: 'right' });
  font('normal', 9); color([185, 212, 255]);
  text(model.docNo, W - M, 21.5, { align: 'right' });
  text(`Date: ${model.dateLabel || '—'}`, W - M, 26.5, { align: 'right' });

  Y = 47;

  // Status pill
  const label = String(model.status || '').toUpperCase();
  if (label) {
    const tone = STATUS_TONE[String(model.status).toLowerCase()] || GRAY;
    const pillW = Math.max(26, doc.getTextWidth(label) + 10);
    fill(M, Y, pillW, 7, tone, 2);
    font('bold', 8); color(WHITE);
    text(label, M + pillW / 2, Y + 4.8, { align: 'center' });
    Y += 11;
  }

  // What the document is about
  if (model.subject) {
    font('normal', 10); color(DARK);
    const subject = doc.splitTextToSize(model.subject, CW);
    doc.text(subject, M, Y);
    Y += subject.length * 4.8 + 3;
  }

  // ── Party + transaction detail boxes ───────────────────────────────────────
  const colW = (CW - 5) / 2;
  const meta = model.meta || [];
  const partyRows = model.party ? 1 + (model.party.lines || []).length : 0;
  const boxH = 12 + Math.max(partyRows, meta.length) * 5;
  pageBreak(boxH + 20);

  if (model.party) {
    fill(M, Y, colW, boxH, LIGHT, 2);
    font('bold', 7.5); color(GRAY);
    text(String(model.party.heading || 'Party').toUpperCase(), M + 4, Y + 6);
    font('bold', 9.5); color(DARK);
    text(model.party.name, M + 4, Y + 12.5);
    font('normal', 8); color(GRAY);
    (model.party.lines || []).forEach((l, i) => text(l, M + 4, Y + 17.5 + i * 5));
  }

  const metaX = model.party ? M + colW + 5 : M;
  const metaW = model.party ? colW : CW;
  fill(metaX, Y, metaW, boxH, LIGHT, 2);
  font('bold', 7.5); color(GRAY);
  text('TRANSACTION DETAILS', metaX + 4, Y + 6);
  meta.forEach((m, i) => {
    const rowY = Y + 12.5 + i * 5;
    font('normal', 8); color(GRAY);
    text(m.label, metaX + 4, rowY);
    font('bold', 8); color(DARK);
    // One line only: the box is sized off the row count, so a long value is
    // clipped to its column rather than running over the row beneath it.
    text(doc.splitTextToSize(String(m.value ?? '—'), metaW - 34)[0] ?? '—',
      metaX + metaW - 4, rowY, { align: 'right' });
  });

  Y += boxH + 8;

  // ── Line table ─────────────────────────────────────────────────────────────
  const cols = (model.table?.columns || []).map((c) => ({ ...c, w: CW * c.width }));
  const colX = [];
  cols.reduce((x, c, i) => { colX[i] = x; return x + c.w; }, M);
  const cellX = (c, i) => (c.align === 'right' ? colX[i] + c.w - 3 : colX[i] + 3);
  const cellAlign = (c) => (c.align === 'right' ? 'right' : 'left');

  const drawHead = () => {
    fill(M, Y, CW, 8, BLUE);
    font('bold', 8); color(WHITE);
    cols.forEach((c, i) => text(c.label, cellX(c, i), Y + 5.4, { align: cellAlign(c) }));
    Y += 8;
  };

  if (cols.length) {
    pageBreak(26);
    drawHead();

    (model.table.rows || []).forEach((row, idx) => {
      // A description can wrap; the row grows to fit rather than overprinting
      // the one beneath it.
      const wrapped = cols.map((c) => doc.splitTextToSize(String(row[c.key] ?? ''), c.w - 6));
      const rowH = Math.max(8, wrapped.reduce((h, w) => Math.max(h, w.length), 1) * 4.4 + 3.6);
      if (pageBreak(rowH + 6)) drawHead();

      fill(M, Y, CW, rowH, idx % 2 === 0 ? WHITE : [248, 250, 252]);
      font('normal', 8.5); color(DARK);
      cols.forEach((c, i) => doc.text(wrapped[i], cellX(c, i), Y + 5.4, { align: cellAlign(c) }));
      Y += rowH;
    });

    const footer = model.table.footer;
    if (footer) {
      if (pageBreak(15)) drawHead();
      fill(M, Y, CW, 9, [232, 240, 254]);
      font('bold', 9); color(BLUE);
      cols.forEach((c, i) => text(footer[c.key] ?? '', cellX(c, i), Y + 6, { align: cellAlign(c) }));
      Y += 9;
    }
    Y += 8;
  }

  // ── Summary block ──────────────────────────────────────────────────────────
  // The label sits left and the figure is right-aligned in the same band, so a
  // long label used to run straight under the amount and the two overprinted —
  // the headline number of the document, unreadable. The figure is what the
  // document exists for, so it keeps its size and its place and the LABEL gives
  // way, shrinking until it clears.
  (model.summary || []).forEach((s) => {
    const h = s.emphasis ? 11 : 7;
    pageBreak(h + 4);
    const x = M + CW * 0.42;
    if (s.emphasis) fill(x, Y, CW * 0.58, h, BLUE, 2);
    const baseline = Y + (s.emphasis ? 7.4 : 5);
    const size = s.emphasis ? 11 : 9;
    const labelX = x + 4;
    const valueRight = W - M - 4;
    const labelStyle = s.emphasis ? 'bold' : 'normal';

    font('bold', size);
    const room = valueRight - labelX - doc.getTextWidth(String(s.value ?? '')) - 3;

    let labelSize = size;
    font(labelStyle, labelSize);
    while (labelSize > 6 && doc.getTextWidth(String(s.label ?? '')) > room) {
      labelSize -= 0.5;
      font(labelStyle, labelSize);
    }

    color(s.emphasis ? WHITE : GRAY);
    text(s.label, labelX, baseline);
    font('bold', size);
    color(s.emphasis ? WHITE : DARK);
    text(s.value, valueRight, baseline, { align: 'right' });
    Y += h + 2;
  });
  if ((model.summary || []).length) Y += 6;

  // ── Notes ──────────────────────────────────────────────────────────────────
  (model.notes || []).forEach((n) => {
    const lines = doc.splitTextToSize(String(n), CW - 10);
    const h = lines.length * 4.6 + 8;
    pageBreak(h + 4);
    fill(M, Y, CW, h, [255, 251, 235], 2);
    doc.setDrawColor(...AMBER); doc.setLineWidth(0.4);
    doc.rect(M, Y, CW, h, 'S');
    font('normal', 8); color([120, 80, 0]);
    doc.text(lines, M + 5, Y + 6);
    Y += h + 4;
  });

  // ── Signatures ─────────────────────────────────────────────────────────────
  const sigs = model.signatures || [];
  if (sigs.length) {
    pageBreak(26);
    Y += 12;
    const slot = CW / sigs.length;
    sigs.forEach((s, i) => {
      doc.setDrawColor(180, 200, 220); doc.setLineWidth(0.3);
      doc.line(M + slot * i + 6, Y, M + slot * (i + 1) - 6, Y);
      font('normal', 7.5); color(GRAY);
      text(s, M + slot * i + slot / 2, Y + 4.5, { align: 'center' });
    });
    Y += 14;
  }

  // ── Footer on every page ───────────────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    fill(0, 287, W, 10, BLUE);
    font('normal', 7); color([200, 222, 255]);
    text(
      `${model.issuer?.name || 'Ararat'} · ${model.title} ${model.docNo} · Generated ${fmtDate(new Date())} · Page ${p} of ${pages}`,
      W / 2, 291.2, { align: 'center' }
    );
    if (model.footNote) {
      font('normal', 6.5); color([170, 200, 250]);
      text(model.footNote, W / 2, 294.8, { align: 'center' });
    }
  }

  return doc;
};

/** Renders the document and hands the browser the file. */
export const downloadAccountingDocument = async (model) => {
  const doc = await renderAccountingDocument(model);
  doc.save(model.filename);
  return model.filename;
};

export default downloadAccountingDocument;

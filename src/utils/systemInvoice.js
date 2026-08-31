/**
 * Turn a stored billing row into the itemised invoice a renderer prints.
 *
 * Two rules, in this order:
 *
 *  1. PREFER WHAT WAS CHARGED. Rows raised after
 *     20260831160000_system_billing_breakdown.sql carry their own base /
 *     user / module / installation / VAT split. An invoice must print what the
 *     tenant actually paid, so a stored breakdown always wins — otherwise a
 *     price change would silently rewrite every historical invoice and a
 *     tenant would download a document that disagrees with their bank.
 *
 *  2. FALL BACK TO THE ENGINE for rows raised before that migration, which
 *     have only a single total. src/config/systemBilling.js re-derives the
 *     components, and the result is then RECONCILED to the stored total so the
 *     printed invoice can never contradict the money that moved.
 */

import { buildSystemInvoice, VAT_RATE, COMPANY_INSTALLATION_FEE } from '../config/systemBilling';

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n) => Number(n) || 0;

/**
 * A stored rate of 0 means zero-rated or exempt and must be honoured — it is
 * not a missing value. `num(v) || VAT_RATE` would silently tax such a row at
 * 16%, so absence is tested for explicitly.
 */
const rateOf = (v) => {
  if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return VAT_RATE;
  return Number(v);
};

/** Does this row carry a stored breakdown, or is it a pre-migration row? */
const hasStoredBreakdown = (row) => num(row?.subtotal) > 0 || num(row?.vat_amount) > 0;

/**
 * Build the line list from stored columns. Zero-value components are dropped,
 * exactly as the engine drops them, so a tenant with no modules does not read
 * a "KES 0" line and wonder what it is.
 */
const storedLines = (parts) =>
  parts
    .filter((p) => num(p.gross) !== 0)
    .map((p) => ({ label: p.label, qty: p.qty, unit: money(p.unit), gross: money(p.gross), amount: money(p.gross), taxable: true }));

/**
 * Restate gross lines as net so subtotal + VAT === total on the page. The
 * largest line absorbs the rounding residual (see distributeNet in
 * systemBilling.js — same rule, applied to stored figures).
 */
const netify = (lines, subtotal) => {
  if (!lines.length) return lines;
  const gross = lines.reduce((s, l) => s + l.gross, 0);
  if (!gross) return lines;
  let running = 0;
  lines.forEach((l) => {
    l.amount = money((l.gross / gross) * subtotal);
    running = money(running + l.amount);
  });
  const residual = money(subtotal - running);
  if (residual !== 0) {
    const biggest = lines.reduce((a, b) => (b.gross > a.gross ? b : a), lines[0]);
    biggest.amount = money(biggest.amount + residual);
  }
  return lines;
};

const wrap = (lines, subtotal, vatRate, vatAmount, total) => ({
  lines: netify(lines, subtotal),
  subtotal: money(subtotal),
  vatRate: rateOf(vatRate),
  vatAmount: money(vatAmount),
  total: money(total),
});

/**
 * Invoice for one company_subscriptions row.
 *
 * The legacy path has to work out whether the installation fee is inside
 * price_paid, because it was never stored separately: registration folded it
 * in, the scheduled-change rollover did not. Rather than guess from row order,
 * ask the money — if the amount paid is about a full installation fee above
 * the recurring price for those seats, the fee was in there.
 *
 * @param {object} row     company_subscriptions row
 * @param {string[]} [modules] module keys the tenant runs, for the extras line
 */
export function invoiceForSubscription(row, modules = null) {
  if (hasStoredBreakdown(row)) {
    const seats = row.max_users ?? 0;
    const lines = storedLines([
      { label: `Base system price — ${row.plan_name || '—'} plan`, qty: 1, unit: row.base_fee, gross: row.base_fee },
      { label: 'Licensed user charges', qty: seats, unit: seats ? num(row.user_fee) / seats : 0, gross: row.user_fee },
      { label: 'Additional modules', qty: 1, unit: row.module_fee, gross: row.module_fee },
      { label: 'Installation & onboarding (one-time)', qty: 1, unit: row.installation_fee, gross: row.installation_fee },
    ]);
    return wrap(lines, row.subtotal, row.vat_rate, row.vat_amount, row.price_paid);
  }

  const seats = num(row?.max_users);
  const paid = num(row?.price_paid);
  const opts = { productLine: 'company', seats, tierId: row?.plan_name || null, modules };

  const recurring = buildSystemInvoice({ ...opts, chargeInstallation: false });
  // Within half a fee of the gap means the fee is in there; a scheduled-change
  // rollover row sits at ~0 and correctly keeps chargeInstallation false.
  const chargeInstallation = paid - recurring.total > COMPANY_INSTALLATION_FEE / 2;
  const priced = chargeInstallation ? buildSystemInvoice({ ...opts, chargeInstallation: true }) : recurring;

  // The catalogue may have moved since this row was written. What the tenant
  // paid is the fact; the components are the best available explanation of it.
  return paid && Math.abs(paid - priced.total) > 0.02
    ? reconcile(priced, paid)
    : priced;
}

/**
 * Invoice for one sacco_invoices row. These are monthly billing runs, so the
 * installation fee is only ever what the row itself stores.
 */
export function invoiceForSaccoInvoice(row) {
  const members = num(row?.active_members);
  const lines = storedLines([
    { label: `Base system price — ${row?.tier || '—'} tier`, qty: 1, unit: row?.base_fee, gross: row?.base_fee },
    { label: 'Active member charges', qty: members, unit: members ? num(row?.per_member_fee_total) / members : 0, gross: row?.per_member_fee_total },
    { label: 'Storage excess', qty: 1, unit: row?.storage_fee, gross: row?.storage_fee },
    { label: 'Additional modules', qty: 1, unit: row?.module_fee, gross: row?.module_fee },
    { label: 'Installation & onboarding (one-time)', qty: 1, unit: row?.installation_fee, gross: row?.installation_fee },
  ]);

  if (hasStoredBreakdown(row)) {
    return wrap(lines, row.subtotal, row.vat_rate, row.vat_amount, row.total);
  }

  // Pre-migration row: back the tax out of the total it already carries, so
  // the figure the sacco was billed is untouched and only disclosed.
  const total = num(row?.total);
  const vatRate = rateOf(row?.vat_rate);
  const subtotal = money(total / (1 + vatRate / 100));
  return wrap(lines, subtotal, vatRate, money(total - subtotal), total);
}

/**
 * Force a computed invoice onto a total that is already a matter of record.
 * Scales the components proportionally rather than dropping them: a stale
 * catalogue should cost the reader detail, not accuracy.
 */
function reconcile(priced, paid) {
  const factor = priced.total ? paid / priced.total : 0;
  const lines = priced.lines.map((l) => ({ ...l, gross: money(l.gross * factor) }));
  const subtotal = money(paid / (1 + rateOf(priced.vatRate) / 100));
  return wrap(lines, subtotal, priced.vatRate, money(paid - subtotal), paid);
}

export { VAT_RATE };

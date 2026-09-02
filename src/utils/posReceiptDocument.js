/**
 * POS RECEIPT DOCUMENT BUILDER (pure)
 *
 * A till has to hand the customer paper. Until now the POS "Print" button
 * called `window.print()` on the app itself, so what came out of the printer
 * was the whole page — sidebar, step bar, the modal floating over a dimmed
 * wizard — on A4. Nobody could give that to a customer. The only real document
 * the module produced was a jsPDF download, which is a file, not a print job:
 * it needs a CDN round trip, and on the counter PC it lands in Downloads for
 * someone to open and print by hand.
 *
 * So the receipt is built here as markup and handed to the browser's own print
 * pipeline. Two paper sizes, because a POS prints to two very different things:
 *
 *   thermal  80mm roll — the till printer. Narrow, monospaced figures, no
 *            colour (thermal heads are one-colour), length is free.
 *   a4       the office printer. Wider, and carries the full amortisation
 *            schedule and signature lines a hire-purchase file needs.
 *
 * Building it as a string rather than printing the live DOM also means the
 * receipt a customer receives is assertable in a test — see
 * posReceiptDocument.test.js — instead of being whatever CSS happened to
 * survive the print stylesheet.
 *
 * Every interpolation goes through the `html` tagged template, which escapes
 * its values. Client names, asset descriptions and company names are all
 * tenant-supplied and reach this markup unfiltered otherwise, and the print
 * window inherits the app's origin — see htmlEscape.js.
 */

import { html, rawHtml } from './htmlEscape';
import { vatRateOn } from '../config/taxRegulations';

export const THERMAL = 'thermal';
export const A4 = 'a4';

// ── Formatting ───────────────────────────────────────────────────────────────
/** Receipts carry cents. A customer reconciling against M-Pesa needs the exact figure. */
const fmt = (n) =>
  `KES ${(parseFloat(n) || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const fmtDateTime = (d) => {
  const date = d ? new Date(d) : new Date();
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} `
    + date.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
};

export const PRICING_LABELS = {
  cash:         'Cash Sale (Full Payment)',
  installment:  'Deposit + Monthly Installments',
  balloon:      'Deposit + Balloon Payment',
  zero_deposit: 'Zero-Deposit Installment',
  lease_to_own: 'Lease-to-Own',
};

export const PAYMENT_LABELS = {
  mpesa:         'M-Pesa',
  cash:          'Cash',
  bank_transfer: 'Bank Transfer',
  card:          'Card / POS',
  cheque:        'Cheque',
};

// ── Styles ───────────────────────────────────────────────────────────────────
/*
 * `@page size` is what actually gets a roll printer to use the roll. Without it
 * the driver falls back to its default paper and an 80mm receipt prints centred
 * on A4 with three quarters of the sheet blank — on a thermal printer that
 * means it feeds the rest of the page out as blank roll before it cuts.
 *
 * Both sheets declare `color-scheme: light` and paint their own white ground:
 * the print window is a normal browser window, and an operator in dark mode
 * otherwise reads near-black text on a dark background — the preview behind
 * the print dialog is unreadable even though the paper comes out fine.
 */
const SHARED_STYLES = `
  :root { color-scheme: light; }
  html, body { background: #fff; }
  body { color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .r { text-align: right; }
  .muted { color: #555; }
  /* A label at the left margin and its figure at the right — the shape of
     every line on a receipt. */
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .row > span:last-child { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .total { font-weight: 700; }
  .dup { border: 2px solid #000; text-align: center; font-weight: 700; letter-spacing: .15em; padding: 4px; margin-bottom: 8px; }
`;

export const THERMAL_STYLES = `
  ${SHARED_STYLES}
  /* 80mm roll, 72mm printable. Height auto so the roll is cut at the end of
     the receipt rather than after a fixed page. */
  @page { size: 80mm auto; margin: 0; }
  body { width: 72mm; margin: 0 auto; padding: 4mm 0; font-family: "Courier New", Courier, monospace; font-size: 11px; line-height: 1.45; }
  .co { text-align: center; font-size: 14px; font-weight: 700; text-transform: uppercase; }
  .co-line { text-align: center; font-size: 10px; }
  .lbl, .title { text-align: center; font-weight: 700; letter-spacing: .12em; margin: 6px 0 2px; text-transform: uppercase; }
  .lbl { font-size: 10px; letter-spacing: .06em; }
  .rule { border-top: 1px dashed #000; margin: 6px 0; }
  .rule-solid { border-top: 1px solid #000; margin: 6px 0; }
  .item { margin: 4px 0; }
  .item-name { font-weight: 700; word-break: break-word; }
  .grand { font-size: 14px; font-weight: 700; border-top: 1px solid #000; border-bottom: 3px double #000; padding: 4px 0; margin: 4px 0; }
  .foot { text-align: center; font-size: 10px; margin-top: 8px; }
`;

export const A4_STYLES = `
  ${SHARED_STYLES}
  @page { size: A4; margin: 14mm; }
  body { max-width: 680px; margin: 0 auto; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.5; }
  .co { font-size: 20px; font-weight: 700; }
  .co-line { font-size: 11px; color: #555; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #000; padding-bottom: 12px; margin-bottom: 16px; }
  .title { font-size: 22px; font-weight: 800; letter-spacing: .08em; text-align: right; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .lbl { font-size: 10px; text-transform: uppercase; color: #666; letter-spacing: .05em; margin-bottom: 2px; }
  .rule { border-top: 1px solid #ccc; margin: 12px 0; }
  .rule-solid { border-top: 2px solid #000; margin: 12px 0; }
  .item { margin: 6px 0; }
  .item-name { font-weight: 700; }
  .grand { font-size: 16px; font-weight: 800; border-top: 2px solid #000; border-bottom: 3px double #000; padding: 8px 0; margin: 8px 0; }
  .foot { font-size: 10px; color: #666; text-align: center; margin-top: 24px; border-top: 1px solid #eee; padding-top: 10px; }
  .sched { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 6px; }
  .sched th { text-align: right; border-bottom: 1px solid #000; padding: 4px 3px; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }
  .sched th:first-child, .sched th:nth-child(2) { text-align: left; }
  .sched td { text-align: right; padding: 3px; border-bottom: 1px solid #f0f0f0; font-variant-numeric: tabular-nums; }
  .sched td:first-child, .sched td:nth-child(2) { text-align: left; }
  .sched tfoot td { border-top: 2px solid #000; border-bottom: none; font-weight: 700; }
  /* A schedule can run past one sheet; keep a row off the page break. */
  .sched tr { page-break-inside: avoid; }
  .sigs { display: flex; justify-content: space-between; gap: 24px; margin-top: 40px; }
  .sig { flex: 1; border-top: 1px solid #000; padding-top: 4px; font-size: 10px; text-align: center; }
`;

// ── Content ──────────────────────────────────────────────────────────────────
/**
 * The seller block. A receipt for a VAT-charged supply has to name the supplier
 * and its PIN — without them the customer cannot claim the input tax the
 * receipt says they were charged.
 */
const issuerLines = (co) => [
  co?.physical_address || co?.address || '',
  [co?.phone, co?.email].filter(Boolean).join(' · '),
  co?.kra_pin ? `KRA PIN: ${co.kra_pin}` : '',
].filter(Boolean);

/**
 * What the receipt asserts, derived once from the sale as submitted.
 *
 * `amountPaid` is the money that actually changed hands at the till today — the
 * full total on a cash sale, the deposit on any financed one. A receipt that
 * printed the total on a hire purchase would be a receipt for money the
 * customer has not paid, and the customer would be holding the proof of it.
 */
export const buildPosReceipt = ({
  saleData = {},
  client,
  asset,
  companyProfile,
  schedule,
  invoiceNo,
  receiptNo,
  cashier,
  issuedAt,
  copyNo = 1,
} = {}) => {
  const isCash     = saleData.pricingModel === 'cash';
  const gross      = parseFloat(saleData.sellingPrice) || 0;
  const discount   = parseFloat(saleData.discountAmount) || 0;
  const vat        = parseFloat(saleData.vatAmount) || 0;
  const total      = parseFloat(saleData.totalAmount) || 0;
  const deposit    = parseFloat(saleData.depositAmount) || 0;
  const amountPaid = isCash ? total : deposit;

  return {
    isCash,
    copyNo,
    isDuplicate: copyNo > 1,
    // A receipt is a tax document only when tax was actually charged on it.
    isTaxReceipt: vat > 0,
    issuer: {
      name:   companyProfile?.company_name || companyProfile?.name || 'Ararat',
      lines:  issuerLines(companyProfile),
      kraPin: companyProfile?.kra_pin || '',
    },
    receiptNo: receiptNo || '',
    invoiceNo: invoiceNo || '',
    // What names this document at the top of the page and in the footer. A sale
    // recorded before receipt numbers were stored has none, and inventing one
    // would assert a number that was never issued — so it falls back to the
    // invoice number, which was on the original receipt too.
    docRef:    receiptNo || invoiceNo || '',
    issuedAt:  issuedAt || new Date().toISOString(),
    cashier:   cashier || '',
    client: {
      name:    client?.full_name || 'Walk-in Customer',
      account: client?.account_number || '',
      phone:   client?.phone || '',
    },
    item: {
      description: asset?.description || 'Asset',
      code:        asset?.asset_code || '',
      type:        asset?.asset_type || '',
    },
    pricingLabel: PRICING_LABELS[saleData.pricingModel] || saleData.pricingModel || '',
    paymentLabel: PAYMENT_LABELS[saleData.paymentMethod] || saleData.paymentMethod || '',
    paymentRef:   saleData.mpesaRef || saleData.bankRef || '',
    amounts: {
      gross,
      discount,
      discountPct: parseFloat(saleData.discountPct) || 0,
      net:         gross - discount,
      vat,
      // The rate the sale was taxed at, carried on the sale itself — never a
      // literal, so a later rate change cannot leave an old receipt claiming a
      // percentage its own figures were not computed with.
      vatPercent: saleData.vatPercent ?? vatRateOn(),
      total,
      amountPaid,
      // What the customer still owes after today. Zero on a cash sale.
      balance: Math.max(0, total - amountPaid),
    },
    plan: isCash ? null : {
      financed:     parseFloat(saleData.financeBalance) || 0,
      rate:         parseFloat(saleData.interestRate) || 0,
      tenure:       parseInt(saleData.tenureMonths, 10) || 0,
      monthly:      parseFloat(saleData.monthlyInstallment) || 0,
      firstDue:     saleData.startDate || null,
      finalDue:     Array.isArray(schedule) && schedule.length ? schedule[schedule.length - 1].dueDate : null,
      totalPayable: parseFloat(saleData.totalPayable) || 0,
    },
    schedule: Array.isArray(schedule) ? schedule : [],
  };
};

// ── Fragments ────────────────────────────────────────────────────────────────
const line = (label, value, cls = '') =>
  rawHtml(html`<div class="row ${rawHtml(cls)}"><span>${label}</span><span>${value}</span></div>`);

const optionalLine = (label, value, show, cls = '') => (show ? line(label, value, cls) : '');

/**
 * The amortisation table — A4 only; a 60-row schedule is not a till receipt.
 *
 * The totals row spells out empty cells rather than using `colspan`: an
 * auto-layout table sizes a spanning cell independently of the columns it
 * covers, which walked the installment total left, out from under its heading.
 */
const scheduleTable = (rows) => {
  if (!rows.length) return '';
  const money = (n) => (parseFloat(n) || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 });
  const sum = (k) => rows.reduce((s, r) => s + (parseFloat(r[k]) || 0), 0);
  return rawHtml(html`
    <div class="rule"></div>
    <div class="lbl">Installment Repayment Schedule</div>
    <table class="sched">
      <thead><tr>
        <th>#</th><th>Due Date</th><th>Opening</th><th>Installment</th><th>Principal</th><th>Interest</th><th>Closing</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => rawHtml(html`<tr>
          <td>${r.installmentNo}</td>
          <td>${fmtDate(r.dueDate)}</td>
          <td>${money(r.openingBalance)}</td>
          <td>${money(r.installmentAmount)}</td>
          <td>${money(r.principalPortion)}</td>
          <td>${money(r.interestPortion)}</td>
          <td>${money(r.closingBalance)}</td>
        </tr>`))}
      </tbody>
      <tfoot><tr>
        <td>Totals</td><td></td><td></td>
        <td>${money(sum('installmentAmount'))}</td>
        <td>${money(sum('principalPortion'))}</td>
        <td>${money(sum('interestPortion'))}</td>
        <td></td>
      </tr></tfoot>
    </table>
  `);
};

/** The money block, identical in substance on both papers. */
const amountsBlock = (m, isCash) => rawHtml(html`
  ${line('Subtotal', fmt(m.net + m.discount))}
  ${optionalLine(`Discount${m.discountPct ? ` (${m.discountPct}%)` : ''}`, `- ${fmt(m.discount)}`, m.discount > 0)}
  ${optionalLine(`VAT (${m.vatPercent}%)`, fmt(m.vat), m.vat > 0)}
  <div class="row grand"><span>TOTAL</span><span>${fmt(m.total)}</span></div>
  ${line(isCash ? 'Amount Paid' : 'Deposit Paid Today', fmt(m.amountPaid), 'total')}
  ${optionalLine('Balance', fmt(m.balance), m.balance > 0, 'total')}
`);

const planBlock = (plan) => (plan ? rawHtml(html`
  <div class="rule"></div>
  <div class="lbl">Payment Plan</div>
  ${line('Balance financed', fmt(plan.financed))}
  ${line('Interest rate', `${plan.rate}% p.a.`)}
  ${optionalLine('Monthly installment', fmt(plan.monthly), plan.monthly > 0, 'total')}
  ${line('Tenure', `${plan.tenure} months`)}
  ${line('First installment due', fmtDate(plan.firstDue))}
  ${optionalLine('Final installment due', fmtDate(plan.finalDue), !!plan.finalDue)}
  ${optionalLine('Total payable', fmt(plan.totalPayable), plan.totalPayable > 0)}
`) : '');

// ── Bodies ───────────────────────────────────────────────────────────────────
/** 80mm roll — the till copy. */
export const thermalBody = (r) => html`
  ${r.isDuplicate ? rawHtml(html`<div class="dup">DUPLICATE — COPY ${r.copyNo}</div>`) : ''}
  <div class="co">${r.issuer.name}</div>
  ${r.issuer.lines.map(l => rawHtml(html`<div class="co-line">${l}</div>`))}
  <div class="title">${r.isTaxReceipt ? 'TAX RECEIPT' : 'OFFICIAL RECEIPT'}</div>
  <div class="rule"></div>
  ${optionalLine('Receipt', r.receiptNo, !!r.receiptNo)}
  ${line('Invoice', r.invoiceNo)}
  ${line('Date', fmtDateTime(r.issuedAt))}
  ${optionalLine('Served by', r.cashier, !!r.cashier)}
  <div class="rule"></div>
  ${line('Customer', r.client.name)}
  ${optionalLine('Account', r.client.account, !!r.client.account)}
  ${optionalLine('Phone', r.client.phone, !!r.client.phone)}
  <div class="rule"></div>
  <div class="item">
    <div class="item-name">${r.item.description}</div>
    ${r.item.code ? rawHtml(html`<div class="muted">Code: ${r.item.code}</div>`) : ''}
    <div class="muted">${r.pricingLabel}</div>
  </div>
  <div class="rule"></div>
  ${amountsBlock(r.amounts, r.isCash)}
  <div class="rule"></div>
  ${line('Paid by', r.paymentLabel)}
  ${optionalLine('Reference', r.paymentRef, !!r.paymentRef)}
  ${planBlock(r.plan)}
  <div class="rule-solid"></div>
  <div class="foot">
    ${r.isTaxReceipt && r.issuer.kraPin
      ? rawHtml(html`<div>VAT charged at ${r.amounts.vatPercent}% · PIN ${r.issuer.kraPin}</div>`)
      : ''}
    <div>Keep this receipt as proof of payment.</div>
    ${r.plan ? rawHtml(html`<div>Late installments attract a penalty per your agreement.</div>`) : ''}
    <div>Thank you for your business.</div>
  </div>
`;

/** A4 — the file copy, with the schedule and signature lines. */
export const a4Body = (r) => html`
  ${r.isDuplicate ? rawHtml(html`<div class="dup">DUPLICATE — COPY ${r.copyNo}</div>`) : ''}
  <div class="head">
    <div>
      <div class="co">${r.issuer.name}</div>
      ${r.issuer.lines.map(l => rawHtml(html`<div class="co-line">${l}</div>`))}
    </div>
    <div>
      <div class="title">${r.isTaxReceipt ? 'TAX RECEIPT' : 'OFFICIAL RECEIPT'}</div>
      <div class="co-line r">${r.docRef}</div>
      <div class="co-line r">${fmtDateTime(r.issuedAt)}</div>
    </div>
  </div>
  <div class="meta">
    <div>
      <div class="lbl">Received From</div>
      <div style="font-weight:600;">${r.client.name}</div>
      ${r.client.account ? rawHtml(html`<div class="co-line">Account: ${r.client.account}</div>`) : ''}
      ${r.client.phone ? rawHtml(html`<div class="co-line">${r.client.phone}</div>`) : ''}
    </div>
    <div>
      <div class="lbl">Reference</div>
      <div class="co-line">Invoice: ${r.invoiceNo}</div>
      <div class="co-line">Terms: ${r.pricingLabel}</div>
      ${r.cashier ? rawHtml(html`<div class="co-line">Served by: ${r.cashier}</div>`) : ''}
    </div>
  </div>
  <div class="lbl">For</div>
  <div class="item">
    <div class="item-name">${r.item.description}</div>
    ${r.item.code || r.item.type
      ? rawHtml(html`<div class="co-line">${[r.item.code, r.item.type].filter(Boolean).join(' · ')}</div>`)
      : ''}
  </div>
  <div class="rule"></div>
  ${amountsBlock(r.amounts, r.isCash)}
  <div class="rule"></div>
  ${line('Paid by', r.paymentLabel)}
  ${optionalLine('Reference', r.paymentRef, !!r.paymentRef)}
  ${planBlock(r.plan)}
  ${scheduleTable(r.schedule)}
  <div class="sigs">
    <div class="sig">Customer Signature</div>
    <div class="sig">Authorised Officer</div>
    <div class="sig">Company Stamp</div>
  </div>
  <div class="foot">
    ${r.isTaxReceipt && r.issuer.kraPin
      ? rawHtml(html`<div>VAT charged at ${r.amounts.vatPercent}% · PIN ${r.issuer.kraPin}</div>`)
      : ''}
    ${r.issuer.name} · ${r.docRef} · Keep this receipt as proof of payment.
  </div>
`;

/**
 * A complete printable page for one sale.
 *
 * `format` picks the paper: THERMAL for the till roll, A4 for the office
 * printer. It is the same document either way — only the schedule and the
 * signature block are A4-only, because neither belongs on a roll.
 */
export const posReceiptDocument = ({ format = THERMAL, ...sale } = {}) => {
  const receipt = buildPosReceipt(sale);
  const isA4    = format === A4;
  const body    = isA4 ? a4Body(receipt) : thermalBody(receipt);
  const title   = `Receipt ${receipt.docRef} — ${receipt.client.name}`;

  return html`<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${title}</title>
<style>${rawHtml(isA4 ? A4_STYLES : THERMAL_STYLES)}</style></head>
<body>${rawHtml(body)}</body></html>`;
};

// ── Reprint ──────────────────────────────────────────────────────────────────
/**
 * Turn a STORED sale back into the arguments `posReceiptDocument` takes.
 *
 * A receipt printed at the till is built from live wizard state; a reprint has
 * only what the database kept. This is the one place that bridges the two, so
 * a reprint and the original are the same document rather than two renderings
 * that drift apart.
 *
 * Three figures are not columns on the sale, and each is recovered rather than
 * guessed:
 *
 *   vatPercent  `sales.vat_percent` where the sale recorded it. Older rows have
 *               none, so it resolves to the rate in force on the SALE DATE —
 *               which is the rate the sale was computed at — never today's.
 *
 *   monthly /   Read off the stored `installment_schedules` rows rather than
 *   totalPayable recomputed. Those rows are what the customer's contract says;
 *               recomputing risks printing a plan that disagrees with it. If
 *               the schedule never persisted (the insert only warns), both come
 *               out zero and the receipt omits those lines instead of printing
 *               a made-up installment.
 *
 * The schedule is renamed rather than passed through: the table stores
 * snake_case columns and the document speaks the wizard's camelCase.
 */
export const reprintArgsFromSale = ({
  sale = {},
  client,
  asset,
  schedule = [],
  payment,
  companyProfile,
  cashier,
} = {}) => {
  const rows = (Array.isArray(schedule) ? schedule : []).map((r) => ({
    installmentNo:     r.installment_no,
    dueDate:           r.due_date,
    openingBalance:    parseFloat(r.opening_balance) || 0,
    installmentAmount: parseFloat(r.installment_amount) || 0,
    principalPortion:  parseFloat(r.principal_portion) || 0,
    interestPortion:   parseFloat(r.interest_portion) || 0,
    closingBalance:    parseFloat(r.closing_balance) || 0,
  }));

  const deposit = parseFloat(sale.deposit_amount) || 0;
  const monthly = rows[0]?.installmentAmount || 0;
  const scheduleTotal = rows.reduce((s, r) => s + r.installmentAmount, 0);

  return {
    saleData: {
      pricingModel:   sale.pricing_model,
      sellingPrice:   parseFloat(sale.selling_price) || 0,
      discountAmount: parseFloat(sale.discount_amount) || 0,
      // The percentage is not stored; the amount and the price are, and the
      // receipt only labels the discount with it.
      discountPct:    sale.selling_price > 0
        ? Math.round((parseFloat(sale.discount_amount) || 0) / parseFloat(sale.selling_price) * 1000) / 10
        : 0,
      vatAmount:      parseFloat(sale.vat_amount) || 0,
      vatPercent:     sale.vat_percent ?? vatRateOn(sale.sale_date),
      totalAmount:    parseFloat(sale.total_amount) || 0,
      depositAmount:  deposit,
      financeBalance: parseFloat(sale.finance_balance) || 0,
      interestRate:   parseFloat(sale.interest_rate) || 0,
      tenureMonths:   parseInt(sale.tenure_months, 10) || 0,
      startDate:      sale.payment_start_date,
      paymentMethod:  sale.payment_method,
      mpesaRef:       sale.mpesa_reference,
      bankRef:        sale.bank_reference,
      monthlyInstallment: monthly,
      totalPayable:   scheduleTotal > 0 ? scheduleTotal + deposit : 0,
    },
    client,
    asset,
    companyProfile,
    schedule: rows,
    invoiceNo: sale.invoice_number,
    receiptNo: sale.receipt_number || '',
    cashier,
    // The moment the money was taken. payment_date is the payment's own
    // timestamp; sale_date is a date only, so it is the coarser fallback.
    issuedAt: payment?.payment_date || sale.sale_date || sale.created_at,
  };
};

export default posReceiptDocument;

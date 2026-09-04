/**
 * PAYSLIP DOCUMENT BUILDER (pure)
 *
 * Builds payslip markup as a string. It opens no window and shows no toast, so
 * the document an employee receives can be asserted on directly in tests rather
 * than inferred from a print dialog.
 *
 * Two entry points:
 *
 *   payslipBody()      one payslip as a fragment
 *   payslipDocument()  a complete page wrapping one or many, page-broken so a
 *                      month's whole run prints as a single job
 *
 * Every interpolation goes through the `html` tagged template, which escapes
 * its values — employee names and company names are user-supplied and reach
 * this markup unfiltered otherwise.
 */

import { html, rawHtml } from './htmlEscape';

const fmt = (n) =>
  `KES ${parseFloat(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtMonth = (m) => m ? new Date(m + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '—';

export const PAYSLIP_STYLES = `
  /* A payslip is a document, not a themed page. It declares its own light
     ground: the text colours below are near-black, and a viewer in dark mode
     otherwise paints them onto a dark background — the pop-up sitting behind
     the print dialog comes out unreadable even though the printed sheet is
     fine. color-scheme keeps the browser from inverting scrollbars with it. */
  :root { color-scheme: light; }
  html, body { background: #fff; }
  body { font-family: Arial, sans-serif; max-width: 640px; margin: 32px auto; color: #111; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1A56DB; padding-bottom: 16px; margin-bottom: 20px; }
  .co { font-size: 18px; font-weight: 700; }
  .muted { color: #666; font-size: 12px; margin-top: 2px; }
  .title { font-size: 22px; font-weight: 800; color: #1A56DB; text-align: right; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; font-size: 13px; }
  .lbl { font-size: 11px; text-transform: uppercase; color: #888; letter-spacing: .05em; margin-bottom: 4px; }
  .sec { font-weight: 700; border-bottom: 1px solid #ddd; padding-bottom: 6px; margin: 16px 0 4px; }
  .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
  .row span:last-child { font-family: monospace; font-weight: 600; }
  .neg { color: #DC2626; }
  .gross { font-weight: 700; border-top: 2px solid #111; }
  .net { display: flex; justify-content: space-between; padding: 14px 0; border-top: 2px solid #111; margin-top: 8px; font-size: 18px; font-weight: 800; }
  .net span:last-child { color: #059669; font-family: monospace; }
  .foot { margin-top: 28px; font-size: 11px; color: #999; text-align: center; border-top: 1px solid #eee; padding-top: 12px; }
  /* Each payslip is its own sheet. Without this a batch runs slips together
     across page boundaries and nobody can hand one to one employee. */
  .payslip { page-break-after: always; }
  .payslip:last-child { page-break-after: auto; }
  @media print { body { margin: 0 auto; } }
`;

/** One payslip, as an escaped HTML fragment. */
export const payslipBody = ({ company, employee = {}, month, data = {} }) => {
  const coName = company?.company_name || 'Ararat Company';

  // These return pre-marked raw fragments, so `${earn(...)}` inside the escaped
  // template below renders as markup while its label/value stay escaped.
  const earn = (label, value) =>
    rawHtml(html`<div class="row"><span>${label}</span><span>${fmt(value)}</span></div>`);
  const ded = (label, value) =>
    rawHtml(html`<div class="row"><span>${label}</span><span class="neg">(${fmt(value)})</span></div>`);
  // Lines that only earn their place when there is something on them — a
  // payslip listing six zero allowances buries the figures that matter.
  const optional    = (label, value) => (parseFloat(value) > 0 ? earn(label, value) : '');
  const optionalDed = (label, value) => (parseFloat(value) > 0 ? ded(label, value)  : '');

  return html`
    <div class="payslip">
      <div class="head">
        <div>
          <div class="co">${coName}</div>
          ${company?.kra_pin ? rawHtml(html`<div class="muted">KRA PIN: ${company.kra_pin}</div>`) : ''}
          ${company?.physical_address ? rawHtml(html`<div class="muted">${company.physical_address}</div>`) : ''}
        </div>
        <div>
          <div class="title">PAYSLIP</div>
          <div class="muted" style="text-align:right;">${fmtMonth(month)}</div>
        </div>
      </div>
      <div class="meta">
        <div>
          <div class="lbl">Employee</div>
          <div style="font-weight:600;">${employee.full_name || '—'}</div>
          ${employee.department ? rawHtml(html`<div class="muted">${employee.department}</div>`) : ''}
          ${employee.email ? rawHtml(html`<div class="muted">${employee.email}</div>`) : ''}
          ${employee.kra_pin ? rawHtml(html`<div class="muted">KRA PIN: ${employee.kra_pin}</div>`) : ''}
        </div>
        <div>
          <div class="lbl">Employee ID</div>
          <div style="font-family:monospace;font-size:12px;word-break:break-all;">${employee.id || '—'}</div>
          <div class="lbl" style="margin-top:8px;">Pay Period</div>
          <div>${fmtMonth(month)}</div>
        </div>
      </div>
      <div class="sec">Earnings</div>
      ${earn('Basic Salary', data.basic)}
      ${optional('Housing Allowance', data.housingAllowance)}
      ${optional('Transport Allowance', data.transportAllowance)}
      ${optional('Meal Allowance', data.mealAllowance)}
      ${optional('Bonus', data.bonus)}
      ${optional('Gift', data.gift)}
      <div class="row gross"><span>Gross Pay</span><span>${fmt(data.grossCash)}</span></div>
      ${data.taxableNonCash > 0
        ? rawHtml(html`<div class="row"><span>Taxable non-cash benefits</span><span>${fmt(data.taxableNonCash)}</span></div>`)
        : ''}

      <div class="sec">Statutory Deductions</div>
      ${ded('NSSF (Tier I & II)', data.nssf)}
      ${ded('SHIF (2.75%)', data.shif)}
      ${ded('Affordable Housing Levy (1.5%)', data.housingLevy)}
      ${ded('PAYE (Income Tax)', data.paye)}

      ${data.voluntaryDeductions > 0 ? rawHtml(html`<div class="sec">Other Deductions</div>`) : ''}
      ${optionalDed('Pension Contribution', data.pension)}
      ${optionalDed('Post-Retirement Medical', data.postRetirementMedical)}
      ${optionalDed('Loan Repayment', data.loanDeduction)}
      ${optionalDed('Salary Advance', data.advanceDeduction)}
      ${optionalDed('Other', data.otherDeductions)}

      ${ded('Total Deductions', data.totalDeductions)}
      <div class="net"><span>NET PAY</span><span>${fmt(data.netPay)}</span></div>

      <!-- How the tax was arrived at. A payslip that shows only the tax gives
           an employee no way to check it, and gives the employer nothing to
           show a KRA query. -->
      <div class="sec">How PAYE Was Calculated</div>
      <div class="row"><span>Gross pay</span><span>${fmt(data.grossPay)}</span></div>
      <div class="row"><span>Less allowable deductions (NSSF, SHIF, AHL${data.mortgageDeduction > 0 ? ', mortgage interest' : ''}${data.medicalFundDeduction > 0 ? ', medical fund' : ''})</span><span class="neg">(${fmt(data.allowableDeductions)})</span></div>
      ${data.disabilityRelief > 0
        ? rawHtml(html`<div class="row"><span>Less disability exemption</span><span class="neg">(${fmt(data.disabilityRelief)})</span></div>`)
        : ''}
      <div class="row gross"><span>Taxable pay</span><span>${fmt(data.taxablePay)}</span></div>
      ${rawHtml((data.payeBands || []).map(b => html`
        <div class="row"><span style="padding-left:12px;">${(b.rate * 100).toFixed(b.rate === 0.325 ? 1 : 0)}% on ${fmt(b.amount)}</span><span>${fmt(b.tax)}</span></div>
      `).join(''))}
      <div class="row"><span>Tax on taxable pay</span><span>${fmt(data.grossTax)}</span></div>
      <div class="row"><span>Less personal relief</span><span class="neg">(${fmt(data.personalRelief)})</span></div>
      ${data.insuranceRelief > 0
        ? rawHtml(html`<div class="row"><span>Less insurance relief</span><span class="neg">(${fmt(data.insuranceRelief)})</span></div>`)
        : ''}
      <div class="row gross"><span>PAYE payable</span><span>${fmt(data.paye)}</span></div>

      <div class="foot">
        Generated by ${coName} on ${fmtDate(new Date())} · Computer-generated payslip, no signature required.<br/>
        ${data.rateLabel ? `Statutory rates: ${data.rateLabel}` : 'Statutory basis not recorded for this period'}
      </div>
    </div>
  `;
};

/**
 * A complete printable page holding one or many payslips.
 *
 * `payslips` is an array of the same argument object `payslipBody` takes. A
 * whole month's run goes out as one print job rather than one window per
 * employee — which is what "download all payslips" has to mean when the only
 * file-producing route available is the browser's own print-to-PDF.
 */
export const payslipDocument = (payslips = []) => {
  const list = Array.isArray(payslips) ? payslips : [payslips];
  const title = list.length === 1
    ? `Payslip — ${list[0]?.employee?.full_name || 'Employee'} — ${fmtMonth(list[0]?.month)}`
    : `Payslips — ${fmtMonth(list[0]?.month)} — ${list.length} employees`;

  return html`
    <html><head><title>${title}</title>
    <style>${rawHtml(PAYSLIP_STYLES)}</style></head><body>
    ${rawHtml(list.map(p => payslipBody(p)).join(''))}
    </body></html>
  `;
};

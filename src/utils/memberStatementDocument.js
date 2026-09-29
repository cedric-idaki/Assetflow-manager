/**
 * SACCO MEMBER STATEMENT — printable document (pure)
 *
 * The member portal's "Print / PDF" used to call window.print() on the portal
 * itself, so the printer got the sidebar, the filters and the navigation
 * around the table, and no society letterhead at all. This builds the
 * statement as its own page: the society's letterhead (logo, motto, contact
 * details), who the statement is for, the period, and the rows.
 *
 * Every interpolation goes through `html`, which escapes it — narrations and
 * references are member- and staff-supplied, and the print frame shares the
 * app's origin.
 */

import { html, rawHtml } from './htmlEscape';
import { LETTERHEAD_STYLES, letterheadContactLine, letterheadFromRecord, letterheadHtml, mergeLetterhead } from './letterhead';

const money = (n) =>
  `KES ${(parseFloat(n) || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const day = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  return Number.isNaN(date.getTime())
    ? String(d)
    : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const STYLES = `
  :root { color-scheme: light; }
  @page { size: A4; margin: 14mm; }
  html, body { background: #fff; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; max-width: 760px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
          border-bottom: 3px solid #0f2733; padding-bottom: 12px; margin-bottom: 14px; }
  .title { font-size: 18px; font-weight: 800; text-align: right; }
  .muted { color: #555; font-size: 11px; text-align: right; }
  .who { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #666; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #555;
       border-bottom: 1px solid #000; padding: 6px 4px; }
  td { padding: 6px 4px; border-bottom: 1px solid #eee; vertical-align: top; }
  td.r, th.r { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.ref { font-family: "Courier New", monospace; font-size: 11px; }
  tr { page-break-inside: avoid; }
  .empty { text-align: center; color: #666; padding: 18px 0; }
  .foot { margin-top: 18px; padding-top: 8px; border-top: 1px solid #ddd; font-size: 10px; color: #666; text-align: center; }
  ${LETTERHEAD_STYLES}
`;

/**
 * @param letterhead  the society's letterhead (useLetterhead)
 * @param sacco       the saccos row the portal holds — fills any gap
 * @param member      { full_name, member_no }
 * @param title       e.g. "Combined statement"
 * @param from, to    the period filter ('' = open-ended)
 * @param reference   the statement reference shown on screen
 * @param rows        [{ date, ref, section, detail, amount, status }]
 * @param note        an optional line under the member block (the holding)
 */
export const memberStatementDocument = ({
  letterhead = null, sacco = null, member = {}, title = 'Member statement',
  from = '', to = '', reference = '', rows = [], note = '',
} = {}) => {
  const lh = mergeLetterhead(letterhead, letterheadFromRecord(sacco));
  const society = lh?.name || 'Sacco Society';
  const contact = letterheadContactLine(lh);
  const period = from || to
    ? `${from ? day(from) : 'the start'} to ${to ? day(to) : 'today'}`
    : 'All transactions';

  const body = rows.length
    ? rows.map((r) => rawHtml(html`<tr>
        <td>${day(r.date)}</td>
        <td class="ref">${r.ref || '—'}</td>
        <td>${r.section || ''}</td>
        <td>${r.detail || ''}</td>
        <td class="r">${money(r.amount)}</td>
        <td>${String(r.status || '').replace(/_/g, ' ')}</td>
      </tr>`))
    : rawHtml('<tr><td colspan="6" class="empty">No transactions in this period.</td></tr>');

  return html`<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${title} — ${member.full_name || 'Member'}</title>
<style>${rawHtml(STYLES)}</style></head>
<body>
  <div class="head">
    ${rawHtml(letterheadHtml(lh, { fallbackName: society }))}
    <div>
      <div class="title">${String(title).toUpperCase()}</div>
      ${reference ? rawHtml(html`<div class="muted">Ref ${reference}</div>`) : ''}
      <div class="muted">Printed ${day(new Date())}</div>
    </div>
  </div>
  <div class="who">
    <div>
      <div class="lbl">Member</div>
      <div><strong>${member.full_name || '—'}</strong></div>
      ${member.member_no ? rawHtml(html`<div>Member No: ${member.member_no}</div>`) : ''}
    </div>
    <div>
      <div class="lbl">Period</div>
      <div>${period}</div>
      ${note ? rawHtml(html`<div>${note}</div>`) : ''}
    </div>
  </div>
  <table>
    <thead><tr>
      <th>Date</th><th>Reference</th><th>Section</th><th>Detail</th><th class="r">Amount</th><th>Status</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>
  <div class="foot">
    ${society} · Member statement generated from the society's records${contact ? rawHtml(html` · ${contact}`) : ''}.
    Query any entry by quoting its reference.
  </div>
</body></html>`;
};

export default memberStatementDocument;

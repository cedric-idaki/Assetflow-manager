/**
 * SEND AN INVOICE ON WHATSAPP
 *
 * wa.me is a link, not an API. It opens a chat with one number and a
 * pre-filled message; it carries TEXT and nothing else, and nothing leaves
 * until somebody presses Send inside WhatsApp. So the message does two jobs:
 *
 *   It RESTATES the document. Every figure is read off buildInvoiceDocument —
 *   the model the PDF is painted from — so the amount on the client's phone is
 *   the amount in the file, to the cent. Nothing is recomputed here.
 *
 *   It LINKS to the document. The PDF is filed in the document archive and the
 *   client gets a signed link to that copy (shareArchivedDocument), so a buyer
 *   who needs the tax invoice ends up holding the tax invoice, not a
 *   description of it.
 */

import { buildInvoiceDocument, renderAccountingDocument } from './accountingDocument';
import { archiveMetaFor, shareArchivedDocument, SHARE_LINK_DAYS } from './documentArchive';

// Read on a phone, often in a queue: past this the rest is in the PDF.
const MAX_ITEM_LINES = 10;

// "Unknown" is what the invoice list shows for a payment with no client row,
// and "Dear Unknown," is worse than no name at all.
const greeting = (name) => {
  const n = String(name || '').trim();
  return n && n !== '—' && n !== 'Unknown' ? `Dear ${n},` : 'Hello,';
};

const itemLine = (row) => {
  // An asset line arrives as "Toyota Hiace 2019\nAST-014 · KDA 123X".
  const [what = '—', ...detail] = String(row.description || '—').split('\n').filter(Boolean);
  const label = detail.length ? `${what} (${detail.join(', ')})` : what;
  const qty   = parseFloat(row.quantity);
  const each  = Number.isFinite(qty) && qty !== 1 ? ` — ${row.quantity} × ${row.unit}` : '';
  return `• ${label}${each}: ${row.amount}`;
};

/** +254 712 345 678 — so the person sending can see whose chat will open. */
export const displayMsisdn = (msisdn) => {
  const digits = String(msisdn || '').replace(/\D/g, '');
  if (!digits) return '';
  return /^254\d{9}$/.test(digits)
    ? `+${digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4')}`
    : `+${digits}`;
};

/**
 * The message, as WhatsApp will show it (*text* is bold there).
 *
 * @param {object} p
 * @param {object} p.invoice   an invoice as the finance hub lists it
 * @param {object} p.company   the seller, as invoiceSeller() resolves it
 * @param {string} [p.link]    where the PDF can be downloaded, if anywhere
 * @param {number} [p.linkDays] how long that link opens for
 */
export const buildInvoiceWhatsAppMessage = ({
  invoice, company, link = null, linkDays = SHARE_LINK_DAYS,
} = {}) => {
  const model = buildInvoiceDocument({ invoice, company });
  // A settled invoice is filed and downloaded as an OFFICIAL RECEIPT, so the
  // message says receipt too — the link must not promise one thing and open
  // the other.
  const paid = model.kind === 'receipt';

  const lines = [
    `*${String(model.issuer?.name || '').trim()}*`,
    `${model.title} ${model.docNo}`,
    '',
    greeting(model.party?.name),
    paid
      ? 'We have received your payment. Please find your receipt details below.'
      : 'Please find your invoice details below.',
    '',
  ];

  const rows   = model.table?.rows || [];
  const shown  = rows.length > MAX_ITEM_LINES ? rows.slice(0, MAX_ITEM_LINES - 1) : rows;
  const hidden = rows.length - shown.length;
  shown.forEach((r) => lines.push(itemLine(r)));
  if (hidden > 0) lines.push(`• …and ${hidden} more item${hidden === 1 ? '' : 's'}`);
  lines.push('');

  // The builder lists the totals, closes them with the emphasised figure (TOTAL
  // DUE / AMOUNT PAID), and puts any hire-purchase terms after it.
  const summary = model.summary || [];
  const cut     = summary.findIndex((s) => s.emphasis);
  const totals  = cut === -1 ? summary : summary.slice(0, cut + 1);
  const plan    = cut === -1 ? [] : summary.slice(cut + 1);
  totals.forEach((s) => lines.push(s.emphasis ? `*${s.label}: ${s.value}*` : `${s.label}: ${s.value}`));

  if (!paid) {
    const due = (model.meta || []).find((m) => m.label === 'Due Date')?.value;
    if (due && due !== '—') {
      const overdue = String(invoice?.status || '').toLowerCase() === 'overdue';
      lines.push(`Due date: ${due}${overdue ? ' (overdue)' : ''}`);
    }
  }

  if (plan.length) {
    lines.push('', '*Payment plan*');
    plan.forEach((s) => lines.push(`${s.label}: ${s.value}`));
  }

  (model.notes || []).forEach((n) => lines.push('', `Note: ${n}`));

  if (link) {
    lines.push('', `Download the ${paid ? 'receipt' : 'invoice'} (PDF, link valid for ${linkDays} days):`, link);
  }

  lines.push('', 'Thank you for your business.');
  return lines.join('\n');
};

/**
 * Render the invoice exactly as Download does, file that copy, and return a
 * signed link to it. Throws rather than returning nothing: the caller must not
 * open WhatsApp promising a PDF it does not have.
 *
 * @returns {Promise<{ url: string, filePath: string, expiresAt: string }>}
 */
export const createInvoiceShareLink = async ({ invoice, company, days = SHARE_LINK_DAYS } = {}) => {
  const model = buildInvoiceDocument({ invoice, company });
  const doc   = await renderAccountingDocument(model);
  return shareArchivedDocument(doc.output('blob'), archiveMetaFor(model), { days });
};

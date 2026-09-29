/**
 * What a client receives when an invoice is sent on WhatsApp.
 *
 * The promises worth pinning:
 *
 *   • the figures ARE the PDF's figures — read off the same model, never
 *     recomputed — so the phone and the file cannot disagree;
 *   • a settled invoice travels as a RECEIPT, in the message as in the file;
 *   • the link sits on its own line and says how long it opens for;
 *   • the link points at the same document Download produces, filed as an
 *     invoice — and when that document cannot be made, nothing pretends it was.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./accountingDocument', async (importOriginal) => ({
  ...(await importOriginal()),
  renderAccountingDocument: vi.fn(),
}));
vi.mock('./documentArchive', async (importOriginal) => ({
  ...(await importOriginal()),
  shareArchivedDocument: vi.fn(),
}));

import { buildInvoiceWhatsAppMessage, createInvoiceShareLink, displayMsisdn } from './invoiceWhatsApp';
import { buildInvoiceDocument, renderAccountingDocument } from './accountingDocument';
import { shareArchivedDocument, SHARE_LINK_DAYS } from './documentArchive';

// The seller as invoiceSeller() resolves it on the finance hub.
const seller = {
  name: 'Rift Valley Motors Ltd',
  kra_pin: 'P051234567X',
  address: 'Enterprise Road, Industrial Area, Nairobi',
  email: 'sales@riftvalleymotors.co.ke',
  phone: '0720000111',
  reg_no: 'PVT-9XABC12',
};

const invoice = (overrides = {}) => ({
  id: 'pay_1',
  source: 'payment',
  invoice_no: 'INV-2026-000123',
  date: '2026-08-01',
  due_date: '2026-08-31',
  client_name: 'Grace Wanjiru',
  client_email: 'grace@example.com',
  client_phone: '0712345678',
  account_no: 'ACC-0001',
  asset: 'Toyota Hiace 2019',
  asset_code: 'AST-014',
  plate_number: 'KDA 123X',
  amount: 200000,
  vat_amount: 32000,
  vat_rate: 16,
  total: 232000,
  status: 'pending',
  method: 'mpesa',
  reference: 'SFG7H2K9',
  notes: '',
  items: null,
  plan: null,
  seller: null,
  ...overrides,
});

const plan = {
  tenure_months: 24,
  monthly_installment: 47073.47,
  deposit: 200000,
  financed: 1000000,
  interest_rate: 12,
  start_date: '2026-09-01',
  final_due_date: '2028-08-01',
  plan_total: 1329763.28,
};

const LINK = 'https://example.supabase.co/storage/v1/object/sign/document-archive/admin-1/2026/09/25/101530_INV-2026-000123__Invoice.pdf?token=abc.def.ghi';

const message = (inv, extra = {}) => buildInvoiceWhatsAppMessage({ invoice: inv, company: seller, ...extra });

describe('buildInvoiceWhatsAppMessage', () => {
  it('heads the message with the seller and the document it restates', () => {
    const lines = message(invoice()).split('\n');
    expect(lines[0]).toBe('*Rift Valley Motors Ltd*');
    expect(lines[1]).toBe('TAX INVOICE INV-2026-000123');
    expect(lines).toContain('Dear Grace Wanjiru,');
  });

  it('states every figure exactly as the PDF states it', () => {
    const inv = invoice();
    const model = buildInvoiceDocument({ invoice: inv, company: seller });
    const text = message(inv);

    model.summary.forEach((s) => expect(text).toContain(`${s.label}: ${s.value}`));
    model.table.rows.forEach((r) => expect(text).toContain(r.amount));
    expect(text).toContain('VAT (16%): KES 32,000.00');
    expect(text).toContain('*TOTAL DUE: KES 232,000.00*');
  });

  it('describes an asset line with its code and plate', () => {
    expect(message(invoice())).toContain('• Toyota Hiace 2019 (AST-014 · KDA 123X): KES 200,000.00');
  });

  it('lists hand-raised line items with the quantity and unit price', () => {
    const text = message(invoice({
      source: 'manual',
      items: [
        { id: 'i1', description: 'Site survey', quantity: 2, unit_price: 1500, line_total: 3000 },
        { id: 'i2', description: 'Survey report', quantity: 1, unit_price: 5000, line_total: 5000 },
      ],
      amount: 8000, vat_amount: 1280, total: 9280,
    }));
    expect(text).toContain('• Site survey — 2 × KES 1,500.00: KES 3,000.00');
    expect(text).toContain('• Survey report: KES 5,000.00');
    expect(text).toContain('*TOTAL DUE: KES 9,280.00*');
  });

  it('gives the due date, and says so once it has passed', () => {
    const due = buildInvoiceDocument({ invoice: invoice(), company: seller })
      .meta.find((m) => m.label === 'Due Date').value;
    expect(message(invoice())).toContain(`Due date: ${due}\n`);
    expect(message(invoice({ status: 'overdue' }))).toContain(`Due date: ${due} (overdue)`);
  });

  it('sends a settled invoice as the receipt the PDF has become, with no due date', () => {
    const text = message(invoice({ status: 'paid' }), { link: LINK });
    expect(text.split('\n')[1]).toBe('OFFICIAL RECEIPT INV-2026-000123');
    expect(text).toContain('*AMOUNT PAID: KES 232,000.00*');
    expect(text).toContain('We have received your payment.');
    expect(text).toContain('Download the receipt (PDF');
    expect(text).not.toContain('TOTAL DUE');
    expect(text).not.toContain('Due date');
  });

  it('carries the hire-purchase plan the PDF carries', () => {
    const text = message(invoice({ plan }));
    expect(text).toContain('*Payment plan*');
    expect(text).toContain('Monthly installment: KES 47,073.47');
    expect(text).toContain('Tenure: 24 months');
    expect(text).toContain('Total payable: KES 1,329,763.28');
  });

  it('puts the PDF link on a line of its own and says how long it opens for', () => {
    const lines = message(invoice(), { link: LINK }).split('\n');
    const at = lines.indexOf(`Download the invoice (PDF, link valid for ${SHARE_LINK_DAYS} days):`);
    expect(at).toBeGreaterThan(-1);
    expect(lines[at + 1]).toBe(LINK);
  });

  it('mentions no PDF when there is no link to one', () => {
    const text = message(invoice());
    expect(text).not.toContain('Download');
    expect(text).not.toContain('http');
  });

  it('does not greet a client the invoice list could not name', () => {
    const text = message(invoice({ client_name: 'Unknown' }));
    expect(text).toContain('Hello,');
    expect(text).not.toContain('Dear Unknown');
  });

  it('keeps a long invoice readable on a phone and points at the rest', () => {
    const items = Array.from({ length: 14 }, (_, i) => ({
      id: `i${i}`, description: `Part ${i + 1}`, quantity: 1, unit_price: 100, line_total: 100,
    }));
    const text = message(invoice({ source: 'manual', items, amount: 1400, vat_amount: 224, total: 1624 }));
    expect(text).toContain('• Part 9:');
    expect(text).not.toContain('• Part 10:');
    expect(text).toContain('• …and 5 more items');
    expect(text).toContain('*TOTAL DUE: KES 1,624.00*');
  });

  it('carries the note printed on the invoice', () => {
    expect(message(invoice({ notes: 'Bank transfer to KCB A/C 1234567890 only.' })))
      .toContain('Note: Bank transfer to KCB A/C 1234567890 only.');
  });
});

describe('displayMsisdn', () => {
  it('shows a Kenyan number the way it is read aloud', () => {
    expect(displayMsisdn('254712345678')).toBe('+254 712 345 678');
  });

  it('leaves a foreign number whole', () => {
    expect(displayMsisdn('447700900123')).toBe('+447700900123');
  });

  it('shows nothing for nothing', () => {
    expect(displayMsisdn('')).toBe('');
    expect(displayMsisdn(null)).toBe('');
  });
});

describe('createInvoiceShareLink', () => {
  const blob = { type: 'application/pdf', size: 2048 };

  beforeEach(() => {
    vi.clearAllMocks();
    renderAccountingDocument.mockResolvedValue({ output: vi.fn(() => blob) });
    shareArchivedDocument.mockResolvedValue({ url: LINK, filePath: 'admin-1/x.pdf', expiresAt: '2026-10-25T00:00:00.000Z' });
  });

  it('files the very document Download produces, as an invoice, and links to it', async () => {
    const inv = invoice();
    const out = await createInvoiceShareLink({ invoice: inv, company: seller });

    expect(renderAccountingDocument).toHaveBeenCalledWith(buildInvoiceDocument({ invoice: inv, company: seller }));
    expect(shareArchivedDocument).toHaveBeenCalledWith(
      blob,
      expect.objectContaining({
        docType: 'invoice',
        module: 'accounting',
        reference: 'INV-2026-000123',
        clientName: 'Grace Wanjiru',
      }),
      { days: SHARE_LINK_DAYS },
    );
    expect(out.url).toBe(LINK);
  });

  it('files a settled invoice as the receipt it prints as', async () => {
    await createInvoiceShareLink({ invoice: invoice({ status: 'paid' }), company: seller });
    expect(shareArchivedDocument).toHaveBeenCalledWith(
      blob, expect.objectContaining({ docType: 'receipt', title: 'OFFICIAL RECEIPT' }), { days: SHARE_LINK_DAYS },
    );
  });

  it('fails out loud when the PDF cannot be made, and files nothing', async () => {
    renderAccountingDocument.mockRejectedValue(new Error('The PDF library could not be loaded.'));
    await expect(createInvoiceShareLink({ invoice: invoice(), company: seller }))
      .rejects.toThrow('The PDF library could not be loaded.');
    expect(shareArchivedDocument).not.toHaveBeenCalled();
  });
});

/**
 * "Send via WhatsApp", driven the way somebody at the finance desk drives it.
 *
 * The promises:
 *
 *   • the chat that opens is the number on screen — prefilled, but the one
 *     typed in wins, and a number WhatsApp cannot open is stopped here;
 *   • the message says what the PDF says, and carries a link to it;
 *   • opening the dialog files nothing; the link is made on send, once;
 *   • nothing is reported as SENT — WhatsApp opened, the person presses Send;
 *   • a failed link or a blocked pop-up is visible, and never a silent
 *     success.
 *
 * Driven with fireEvent rather than user-event: @testing-library/react carries
 * its own nested copy of @testing-library/dom, so user-event's events bypass
 * act() here and every keystroke logs a warning.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), getUser: vi.fn() } },
  getCurrentUser: vi.fn(),
  invokeSupabaseFunction: vi.fn(),
}));
vi.mock('../../../utils/jsPdfLoader', async (importOriginal) => ({
  ...(await importOriginal()),
  loadJsPDF: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../../../utils/invoiceWhatsApp', async (importOriginal) => ({
  ...(await importOriginal()),
  createInvoiceShareLink: vi.fn(),
}));

import InvoiceWhatsAppModal from './InvoiceWhatsAppModal';
import { createInvoiceShareLink } from '../../../utils/invoiceWhatsApp';

const seller = {
  name: 'Rift Valley Motors Ltd',
  kra_pin: 'P051234567X',
  address: 'Enterprise Road, Nairobi',
  email: 'sales@riftvalleymotors.co.ke',
  phone: '0720000111',
  reg_no: '',
};

const invoice = (overrides = {}) => ({
  id: 'inv_1',
  source: 'manual',
  invoice_no: 'INV-0012',
  date: '2026-09-01',
  due_date: '2026-10-01',
  client_name: 'Grace Wanjiru',
  client_email: 'grace@example.com',
  client_phone: '0712345678',
  account_no: 'ACC-0001',
  asset: 'Toyota Hiace 2019',
  asset_code: '',
  plate_number: '',
  amount: 200000,
  vat_amount: 32000,
  vat_rate: 16,
  total: 232000,
  status: 'pending',
  method: '—',
  reference: '—',
  notes: '',
  items: [{ id: 'l1', description: 'Toyota Hiace 2019', quantity: 1, unit_price: 200000, line_total: 200000 }],
  plan: null,
  seller: null,
  ...overrides,
});

const LINK = 'https://example.supabase.co/storage/v1/object/sign/document-archive/admin-1/INV-0012.pdf?token=abc';

let tab;
const setup = (inv = invoice()) => {
  const onClose = vi.fn();
  const utils = render(<InvoiceWhatsAppModal invoice={inv} company={seller} onClose={onClose} />);
  return { onClose, ...utils };
};

const openButton = () => screen.getByRole('button', { name: /open in whatsapp/i });
const numberInput = () => screen.getByLabelText(/whatsapp number/i);
const preview = () => screen.getByTestId('wa-invoice-preview').textContent;
const typeNumber = (value) => fireEvent.change(numberInput(), { target: { value } });

// Press "Open in WhatsApp" and wait for the line that reports the outcome, so
// everything the press changes has landed before anything is asserted.
const press = (outcome = 'status') => {
  fireEvent.click(openButton());
  return screen.findByRole(outcome);
};

// What window.open was handed: the chat it opens and the text it carries.
const opened = (call = 0) => {
  const url = new URL(window.open.mock.calls[call][0]);
  return { chat: `${url.origin}${url.pathname}`, text: url.searchParams.get('text') };
};

beforeEach(() => {
  vi.clearAllMocks();
  tab = { opener: 'the app' };
  vi.spyOn(window, 'open').mockImplementation(() => tab);
  createInvoiceShareLink.mockResolvedValue({ url: LINK, filePath: 'admin-1/INV-0012.pdf', expiresAt: '2026-10-25T00:00:00.000Z' });
});

afterEach(() => { window.open.mockRestore(); });

describe('Send via WhatsApp', () => {
  it("prefills the client's number and says whose chat it will open", () => {
    setup();
    expect(numberInput()).toHaveValue('0712345678');
    expect(screen.getByText('Opens a chat with +254 712 345 678')).toBeInTheDocument();
  });

  it('shows the message before anything goes, and files nothing just for looking', () => {
    setup();
    expect(preview()).toContain('TAX INVOICE INV-0012');
    expect(preview()).toContain('TOTAL DUE: KES 232,000.00');
    expect(preview()).toContain('a link to the PDF is added here');
    expect(createInvoiceShareLink).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it("opens the client's chat with the invoice and a link to its PDF", async () => {
    setup();
    await press();

    expect(window.open).toHaveBeenCalledTimes(1);
    const { chat, text } = opened();
    expect(chat).toBe('https://wa.me/254712345678');
    expect(text).toContain('*TOTAL DUE: KES 232,000.00*');
    expect(text.split('\n')).toContain(LINK);
    expect(createInvoiceShareLink).toHaveBeenCalledWith({ invoice: expect.objectContaining({ id: 'inv_1' }), company: seller });

    // The new tab cannot reach back into the app.
    expect(tab.opener).toBeNull();
  });

  it('reports WhatsApp as opened, never the invoice as sent', async () => {
    setup();
    const status = await press();
    expect(status).toHaveTextContent('WhatsApp opened a chat with +254 712 345 678');
    expect(status).toHaveTextContent('Press Send there to deliver the invoice');
    expect(status).not.toHaveTextContent(/\bsent\b/i);
  });

  it('sends to the number typed in, not the one on file', async () => {
    setup();
    typeNumber('+254 733 000 111');
    expect(screen.getByText('Opens a chat with +254 733 000 111')).toBeInTheDocument();

    await press();
    expect(opened().chat).toBe('https://wa.me/254733000111');
  });

  it('stops at a number WhatsApp cannot open — no link, no chat', async () => {
    setup();
    typeNumber('12345');
    expect(screen.getByText(/WhatsApp cannot open that number/)).toBeInTheDocument();

    expect(await press('alert')).toHaveTextContent('Enter a number WhatsApp can open');
    expect(createInvoiceShareLink).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it('asks for a number when the invoice carries none', () => {
    setup(invoice({ client_phone: '' }));
    expect(numberInput()).toHaveValue('');
    expect(screen.getByText(/No number on file/)).toBeInTheDocument();
  });

  it('does not open WhatsApp when the PDF link could not be made, and says so', async () => {
    createInvoiceShareLink.mockRejectedValue(new Error('The PDF could not be saved for sharing. Check your connection and try again.'));
    setup();

    const alert = await press('alert');
    expect(alert).toHaveTextContent('The PDF could not be saved for sharing');
    expect(alert).toHaveTextContent('WhatsApp was not opened');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('sends the details on their own when the PDF link is unticked', async () => {
    setup();
    fireEvent.click(screen.getByRole('checkbox', { name: /include a link to the pdf/i }));
    expect(preview()).not.toContain('Download the invoice');

    await press();
    expect(window.open).toHaveBeenCalledTimes(1);
    expect(createInvoiceShareLink).not.toHaveBeenCalled();
    expect(opened().text).not.toContain('Download the invoice');
    expect(opened().text).toContain('*TOTAL DUE: KES 232,000.00*');
  });

  it('hands over a real link when the browser blocks the pop-up', async () => {
    window.open.mockImplementation(() => null);
    setup();

    expect(await press('alert')).toHaveTextContent('stopped WhatsApp from opening');
    const fallback = screen.getByRole('link', { name: /open whatsapp/i });
    expect(fallback.getAttribute('href')).toBe(window.open.mock.calls[0][0]);
    expect(fallback).toHaveAttribute('target', '_blank');
    expect(fallback.getAttribute('rel')).toContain('noopener');
  });

  it('reuses the link on a second press instead of filing another copy', async () => {
    setup();
    await press();
    await press();

    expect(window.open).toHaveBeenCalledTimes(2);
    expect(createInvoiceShareLink).toHaveBeenCalledTimes(1);
    expect(opened(1).text.split('\n')).toContain(LINK);
  });

  it('makes a fresh link once the invoice is paid — the PDF is a receipt now', async () => {
    const { rerender, onClose } = setup();
    await press();

    rerender(<InvoiceWhatsAppModal invoice={invoice({ status: 'paid' })} company={seller} onClose={onClose} />);
    await press();

    expect(window.open).toHaveBeenCalledTimes(2);
    expect(createInvoiceShareLink).toHaveBeenCalledTimes(2);
    expect(opened(1).text).toContain('OFFICIAL RECEIPT INV-0012');
    expect(opened(1).text).toContain('Download the receipt');
  });

  it('closes on Escape and on Cancel', () => {
    const { onClose } = setup();
    fireEvent.keyDown(numberInput(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The reprint desk. What matters here is not that a table renders — it is that
 * the paper a customer walks away with is the SAME document the till issued,
 * marked as a copy, and that looking a sale up actually searches the whole book
 * rather than the page on screen.
 */

// Rows the fake database holds for the current test.
let SALES = [];
let SCHEDULE = [];
let PAYMENT = null;

// '\%' etc. arrive escaped from sanitizeSearchTerm; undo that to compare text.
const unescapeTerm = (t) => t.replace(/\\([%_*])/g, '$1');

const matchesOr = (row, orFilter) => orFilter
  .split(',')
  .some((clause) => {
    const [col, , pattern] = clause.split('.');
    const needle = unescapeTerm(pattern.replace(/^%|%$/g, '')).toLowerCase();
    return String(row[col] ?? '').toLowerCase().includes(needle);
  });

const salesBuilder = () => {
  const ops = { eq: [], gte: [], lte: [], or: null };
  const b = {
    select: () => b,
    eq:  (c, v) => { ops.eq.push([c, v]); return b; },
    gte: (c, v) => { ops.gte.push([c, v]); return b; },
    lte: (c, v) => { ops.lte.push([c, v]); return b; },
    or:  (f) => { ops.or = f; return b; },
    order: () => b,
    single: () => {
      const row = SALES.find(r => ops.eq.every(([c, v]) => String(r[c] ?? '') === String(v)));
      return Promise.resolve({ data: row || null, error: row ? null : { message: 'not found' } });
    },
    range: (from, to) => {
      const rows = SALES.filter(r =>
        ops.eq.every(([c, v]) => String(r[c] ?? '') === String(v)) &&
        ops.gte.every(([c, v]) => String(r[c] ?? '') >= String(v)) &&
        ops.lte.every(([c, v]) => String(r[c] ?? '') <= String(v)) &&
        (!ops.or || matchesOr(r, ops.or)));
      return Promise.resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null });
    },
  };
  return b;
};

const listBuilder = (rows) => {
  const b = {
    select: () => b,
    eq: () => b,
    order: () => Promise.resolve({ data: rows, error: null }),
    maybeSingle: () => Promise.resolve({ data: Array.isArray(rows) ? rows[0] : rows, error: null }),
  };
  return b;
};

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (table) => {
      if (table === 'sales') return salesBuilder();
      if (table === 'installment_schedules') return listBuilder(SCHEDULE);
      if (table === 'payments') return listBuilder(PAYMENT);
      if (table === 'user_profiles') return listBuilder({ full_name: 'John Otieno' });
      return listBuilder([]);
    },
    auth: { getUser: vi.fn(), getSession: vi.fn() },
    rpc: vi.fn(),
  },
  getCurrentUser: vi.fn(),
  invokeSupabaseFunction: vi.fn(),
}));

// Capture the document handed to the printer instead of opening a dialog.
const printed = [];
vi.mock('../../../utils/printDocument', () => ({
  printDocument: (markup) => { printed.push(markup); return true; },
  default: (markup) => { printed.push(markup); return true; },
}));

const SalesHistory = (await import('./SalesHistory')).default;

const CLIENT = { id: 'c1', full_name: 'Grace Wanjiru', account_number: 'ACC-0091', phone: '0722000111' };
const ASSET  = { id: 'a1', description: 'Toyota Probox 2016', asset_code: 'VEH-014', asset_type: 'Vehicle' };

const sale = (over = {}) => ({
  id: 'sale-1',
  admin_id: 'admin-1',
  client_id: 'c1',
  invoice_number: 'INV-0007',
  receipt_number: 'RCP-0007',
  pricing_model: 'cash',
  selling_price: 100000,
  discount_amount: 0,
  vat_amount: 16000,
  vat_percent: 16,
  total_amount: 116000,
  deposit_amount: 0,
  sale_date: '2026-09-02',
  payment_method: 'mpesa',
  mpesa_reference: 'SJK4H7T9QW',
  client: CLIENT,
  asset: ASSET,
  ...over,
});

// Strip tags so an assertion on a figure is not defeated by the markup.
const text = (markup) => markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

const COMPANY = { company_name: 'Ararat Motors Ltd', kra_pin: 'P051234567X' };

const mount = () =>
  render(<SalesHistory adminId="admin-1" clients={[CLIENT]} companyProfile={COMPANY} />);

beforeEach(() => {
  SALES = [sale()];
  SCHEDULE = [];
  PAYMENT = { payment_date: '2026-09-02T09:15:00.000Z', processed_by: 'u1', reference_number: 'SJK4H7T9QW' };
  printed.length = 0;
});

describe('SalesHistory', () => {
  it('lists past sales with the number on the customer’s paper', async () => {
    mount();
    expect(await screen.findByText('RCP-0007')).toBeTruthy();
    // Scoped to the table: the customer's name is also an <option> in the
    // filter dropdown, so an unscoped query matches twice.
    const row = screen.getByRole('table');
    expect(within(row).getByText('Grace Wanjiru')).toBeTruthy();
    expect(within(row).getByText('Toyota Probox 2016')).toBeTruthy();
  });

  it('shows what the customer actually paid, not the sale total, on a hire purchase', async () => {
    // The list column has to agree with the receipt: a financed sale receipted
    // its deposit, so that is the figure to show beside it.
    SALES = [sale({ pricing_model: 'installment', deposit_amount: 30000, total_amount: 116000 })];
    mount();
    expect(await screen.findByText('KES 30,000')).toBeTruthy();
    expect(screen.queryByText('KES 116,000')).toBeNull();
  });

  it('searches the whole book in Postgres, not the page on screen', async () => {
    SALES = [sale(), sale({ id: 'sale-2', invoice_number: 'INV-0008', receipt_number: 'RCP-0008' })];
    mount();
    expect(await screen.findByText('RCP-0007')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search by receipt or invoice number'), { target: { value: 'RCP-0008' } });
    await waitFor(() => expect(screen.queryByText('RCP-0007')).toBeNull());
    expect(screen.getByText('RCP-0008')).toBeTruthy();
  });

  it('prints a reprint as a DUPLICATE on the first press', async () => {
    // The original was issued at the till when the sale was made, so every
    // sheet this screen produces is a second copy. Two unmarked receipts for
    // one payment read as two payments.
    mount();
    fireEvent.click(await screen.findByLabelText('Reprint receipt RCP-0007'));
    const dialog = await screen.findByText('Reprint Receipt');
    expect(dialog).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: /Print Duplicate/i }));
    await waitFor(() => expect(printed.length).toBe(1));

    const out = text(printed[0]);
    expect(out).toContain('DUPLICATE — COPY 2');
    expect(out).toContain('RCP-0007');
    expect(out).toContain('Grace Wanjiru');
    expect(out).toContain('KES 116,000.00');
    // Resolved from payments.processed_by, so the copy names who served them.
    expect(out).toContain('Served by John Otieno');
    // The tenant's letterhead, not the app's fallback name.
    expect(out).toContain('Ararat Motors Ltd');
  });

  it('reprints the receipt as issued, not as recomputed today', async () => {
    mount();
    fireEvent.click(await screen.findByLabelText('Reprint receipt RCP-0007'));
    fireEvent.click(await screen.findByRole('button', { name: /Print Duplicate/i }));
    await waitFor(() => expect(printed.length).toBe(1));

    const out = text(printed[0]);
    // The rate the sale was charged at, off the stored sale.
    expect(out).toContain('VAT (16%)');
    // The moment the money changed hands, off the payment — not now. ICU
    // abbreviates September as "Sep" or "Sept" depending on the build.
    expect(out).toMatch(/02 Sept? 2026/);
    expect(out).not.toMatch(new RegExp(`\b${new Date().getFullYear() + 1}\b`));
  });

  it('says so when the sale predates stored receipt numbers', async () => {
    SALES = [sale({ receipt_number: null })];
    mount();
    fireEvent.click(await screen.findByLabelText('Reprint receipt INV-0007'));
    expect(await screen.findByText(/recorded before receipt numbers were stored/i)).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: /Print Duplicate/i }));
    await waitFor(() => expect(printed.length).toBe(1));
    // It identifies the copy by invoice rather than asserting a number that
    // was never issued.
    expect(text(printed[0])).toContain('Invoice INV-0007');
  });

  it('surfaces a load failure instead of printing a blank receipt', async () => {
    mount();
    const row = await screen.findByLabelText('Reprint receipt RCP-0007');
    SALES = [];              // the sale vanishes between listing and reprinting
    fireEvent.click(row);
    expect(await screen.findByText(/not found/i)).toBeTruthy();
    expect(printed.length).toBe(0);
  });

  it('tells the user when nothing matches rather than looking empty', async () => {
    SALES = [];
    mount();
    expect(await screen.findByText('No sales recorded yet.')).toBeTruthy();
  });
});

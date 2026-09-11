/**
 * The Clients tab, driven the way a user drives it.
 *
 * clientRecordWorkflow.test.jsx proves what the creation form does. This is the
 * other half: the tab is where a client record becomes USEFUL, and the promises
 * it makes are about numbers on a screen —
 *
 *   • the balance beside each name is that customer's, not the page's;
 *   • "showing 1-2 of 7" says seven when there are seven, so nobody concludes
 *     the system lost their customers;
 *   • the statement explains the balance rather than restating it;
 *   • a client picked here arrives at the invoice form already filled in.
 *
 * The server is src/test-utils/clientRecordServer.js, a mirror of migration
 * 20260911120000.
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { createFakeSupabase, resetFakeIds } from '../../../test-utils/fakeSupabase';
import { clientRecordRpcs } from '../../../test-utils/clientRecordServer';

let db;
vi.mock('../../../lib/supabase', () => ({
  get supabase() { return db; },
}));

const { default: ClientsTab } = await import('./ClientsTab');

const client = (n, over = {}) => ({
  id: `client_${n}`,
  account_number: `AF-2026-00000${n}`,
  full_name: `Customer ${n}`,
  email: `customer${n}@example.com`,
  phone: `07120000${n}${n}`,
  kra_pin: null,
  customer_type: 'account',
  client_status: 'active',
  outstanding_balance: 0,
  lead_id: null,
  admin_id: 'admin_1',
  created_at: `2026-0${n}-01T09:00:00Z`,
  ...over,
});

const CLIENTS = [1, 2, 3, 4, 5, 6, 7].map(n => client(n));

const INVOICES = [
  { id: 'inv_1', client_id: 'client_7', invoice_no: 'INV-0001', issue_date: '2026-07-01', total: 50000, status: 'paid',      notes: 'Deposit invoice' },
  { id: 'inv_2', client_id: 'client_7', invoice_no: 'INV-0002', issue_date: '2026-08-01', total: 30000, status: 'overdue',   notes: 'August billing' },
  { id: 'inv_3', client_id: 'client_7', invoice_no: 'INV-0003', issue_date: '2026-08-15', total: 10000, status: 'draft',     notes: 'Not issued' },
];
const PAYMENTS = [
  { id: 'pay_1', client_id: 'client_7', transaction_id: 'TX-1', amount: 50000, payment_status: 'completed', payment_method: 'mpesa', payment_date: '2026-07-03', reference_number: 'QWE123' },
  { id: 'pay_2', client_id: 'client_7', transaction_id: 'TX-2', amount: 12000, payment_status: 'completed', payment_method: 'mpesa', payment_date: '2026-08-09', reference_number: 'QWE456' },
  { id: 'pay_3', client_id: 'client_7', transaction_id: 'TX-3', amount: 88000, payment_status: 'pending',   payment_method: 'mpesa', payment_date: '2026-08-20', reference_number: 'QWE789' },
];

const setup = (props = {}) => {
  resetFakeIds();
  db = createFakeSupabase({
    user: { id: 'user_accountant' },
    tables: { clients: CLIENTS, company_invoices: INVOICES, payments: PAYMENTS },
    rpcs: clientRecordRpcs({ adminId: 'admin_1', role: 'accountant' }),
  });
  const onInvoiceClient = vi.fn();
  const utils = render(<ClientsTab onInvoiceClient={onInvoiceClient} {...props} />);
  return { onInvoiceClient, user: userEvent.setup(), ...utils };
};

const rowFor = (name) => screen.getByText(name).closest('tr');

describe('the client book', () => {
  it('shows each customer with their own invoiced, received and outstanding figures', async () => {
    setup();

    // Customer 7 is the one with money against them.
    const row = await waitFor(() => rowFor('Customer 7'));
    const cells = within(row).getAllByRole('cell');
    // Invoiced 80,000 — the draft is not billed. Received 62,000 — the pending
    // M-Pesa push has not been received. Outstanding 18,000.
    expect(cells[3]).toHaveTextContent('KES 80,000');
    expect(cells[4]).toHaveTextContent('KES 62,000');
    expect(cells[5]).toHaveTextContent('KES 18,000');
    expect(cells[5]).toHaveTextContent('1 overdue');

    // And a customer with nothing against them reads as nothing, not blank.
    expect(within(rowFor('Customer 1')).getAllByRole('cell')[5]).toHaveTextContent('KES 0');
  });

  it('states how many records there are, not how many fitted on the page', async () => {
    // The whole reason the count comes from Postgres: a book of seven paged at
    // two must not read as a book of two.
    setup();
    expect(await screen.findByText(/showing 1–7 of 7/i)).toBeInTheDocument();
  });

  it('opens a statement that explains the balance', async () => {
    const { user } = setup();

    const row = await waitFor(() => rowFor('Customer 7'));
    await user.click(within(row).getByRole('button', { name: /statement/i }));

    expect(await screen.findByText(/payment history/i)).toBeInTheDocument();

    // Every entry carries the balance AS AT that entry, so the history explains
    // the number rather than repeating it.
    const balanceOn = (reference) => {
      const cells = within(screen.getByText(reference).closest('tr')).getAllByRole('cell');
      return cells[cells.length - 1].textContent;
    };
    expect(balanceOn('QWE456')).toBe('KES 18,000');    // latest receipt
    expect(balanceOn('INV-0002')).toBe('KES 30,000');  // before it was paid down
    expect(balanceOn('INV-0001')).toBe('KES 50,000');  // the opening charge

    // The draft was never issued, so it is not part of the story.
    expect(screen.queryByText('INV-0003')).not.toBeInTheDocument();
  });

  it('hands a client to the invoice form rather than making the user find them again', async () => {
    const { user, onInvoiceClient } = setup();

    const row = await waitFor(() => rowFor('Customer 3'));
    await user.click(within(row).getByRole('button', { name: /invoice/i }));

    expect(onInvoiceClient).toHaveBeenCalledTimes(1);
    const [passed] = onInvoiceClient.mock.calls[0];
    // Everything the bill-to block needs, so the form does not have to look it
    // up in a list that may not contain a record created a second ago.
    expect(passed.id).toBe('client_3');
    expect(passed.full_name).toBe('Customer 3');
    expect(passed.account_number).toBe('AF-2026-000003');
    expect(passed.email).toBe('customer3@example.com');
  });

  it('searches the whole book, not the page on screen', async () => {
    const { user } = setup();
    await waitFor(() => rowFor('Customer 7'));

    await user.type(screen.getByPlaceholderText(/search name/i), 'AF-2026-000005');
    await user.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => expect(screen.getByText(/showing 1–1 of 1/i)).toBeInTheDocument());
    expect(screen.getByText('Customer 5')).toBeInTheDocument();
    expect(screen.queryByText('Customer 7')).not.toBeInTheDocument();
  });

  it('says so plainly when there is nothing on file yet', async () => {
    resetFakeIds();
    db = createFakeSupabase({
      user: { id: 'user_accountant' },
      tables: { clients: [] },
      rpcs: clientRecordRpcs({ adminId: 'admin_1', role: 'accountant' }),
    });
    render(<ClientsTab />);

    expect(await screen.findByText(/no client records yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new client record/i })).toBeEnabled();
  });
});

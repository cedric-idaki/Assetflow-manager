/**
 * Creating a FinHub client record, end to end on this side of the RPC boundary.
 *
 * WHAT THE FEATURE HAS TO GET RIGHT, and therefore what is tested here:
 *
 *   1. The minimum really is a name. Anything more required is a field somebody
 *      types "x" into.
 *   2. A lead converted twice produces ONE customer. This is the whole reason
 *      clients.lead_id exists.
 *   3. Somebody already on file is offered, not silently duplicated — and the
 *      offer is one click to take.
 *   4. "They are different people" is possible, deliberate, and recorded.
 *   5. A name on its own is a suggestion. Two people share one every day.
 *   6. The balance and the payment history read back off the record.
 *
 * The server side is src/test-utils/clientRecordServer.js, a mirror of migration
 * 20260911120000 that clientRecords.sync.test.js keeps honest. No Postgres runs
 * in this suite, so this proves the screens and the hook, not the SQL.
 */

import React from 'react';
import { render, screen, waitFor, renderHook, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase, resetFakeIds } from '../../test-utils/fakeSupabase';
import { clientRecordRpcs } from '../../test-utils/clientRecordServer';

const AGENT = { id: 'user_agent_1', email: 'agent@ararat.co.ke' };

let db;
vi.mock('../../lib/supabase', () => ({
  get supabase() { return db; },
}));

// Imported after the mock so the hook picks up the fake client.
const { default: ClientRecordModal } = await import('./ClientRecordModal');
const { useClientRecords } = await import('../../hooks/useClientRecords');

const ON_FILE = {
  id: 'client_existing',
  account_number: 'AF-2026-000001',
  full_name: 'Wanjiru Kamau',
  email: 'wanjiru@example.com',
  phone: '0712345678',
  kra_pin: 'A001234567X',
  national_id: null,
  customer_type: 'account',
  client_status: 'active',
  outstanding_balance: 0,
  lead_id: null,
  admin_id: 'admin_1',
  created_at: '2026-01-05T09:00:00Z',
};

const LEAD = {
  id: 'lead_1',
  full_name: 'Otieno Odhiambo',
  email: 'otieno@example.com',
  phone: '0722000111',
  stage: 'qualified',
};

const boot = ({ clients = [], leads = [], role = 'sales_agent', ...rest } = {}) => {
  resetFakeIds();
  db = createFakeSupabase({
    user: AGENT,
    tables: { clients, leads, ...rest },
    rpcs: clientRecordRpcs({ adminId: 'admin_1', role }),
  });
  return db;
};

const openModal = (props = {}) =>
  render(<ClientRecordModal isOpen onClose={() => {}} onCreated={() => {}} {...props} />);

const typeName = async (user, value) => {
  await user.type(screen.getByLabelText(/full name or company name/i), value);
};

describe('creating a client record', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('needs a name and nothing else', async () => {
    boot();
    const user = userEvent.setup();
    const onCreated = vi.fn();
    openModal({ onCreated });

    const save = screen.getByRole('button', { name: /create client record/i });
    expect(save).toBeDisabled();

    await typeName(user, 'Nairobi Logistics Ltd');
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const [created, meta] = onCreated.mock.calls[0];
    expect(created.full_name).toBe('Nairobi Logistics Ltd');
    expect(created.account_number).toMatch(/^AF-/);
    expect(meta.linked).toBe(false);
    // Created ready to bill: a tenant, an account number, and nothing pending.
    expect(db._rows('clients')).toHaveLength(1);
    expect(db._rows('clients')[0].admin_id).toBe('admin_1');
  });

  it('links the record to the lead it came from', async () => {
    boot({ leads: [LEAD] });
    const user = userEvent.setup();
    openModal({ lead: LEAD, agentId: 'agent_1' });

    // The lead's details are already in the form; nothing to retype.
    expect(screen.getByLabelText(/full name or company name/i)).toHaveValue('Otieno Odhiambo');
    expect(screen.getByLabelText(/^phone$/i)).toHaveValue('0722000111');

    await user.click(screen.getByRole('button', { name: /create client record/i }));

    await waitFor(() => expect(db._rows('clients')).toHaveLength(1));
    expect(db._rows('clients')[0].lead_id).toBe('lead_1');
    expect(db._rows('clients')[0].agent_id).toBe('agent_1');
    // And the lead is off the pipeline in the same act, not by a second call
    // that could fail on its own.
    expect(db._rows('leads')[0].stage).toBe('closed');
    expect(db._rows('leads')[0].converted_ref_id).toBe(db._rows('clients')[0].id);
  });

  it('converting the same lead twice returns the first record, not a second one', async () => {
    boot({ leads: [LEAD] });
    const { result } = renderHook(() => useClientRecords({ enabled: false }));

    let first; let second;
    await act(async () => {
      first = await result.current.createClient({ full_name: 'Otieno Odhiambo' }, { leadId: 'lead_1' });
    });
    await act(async () => {
      // A different spelling, the same lead — somebody re-opening the modal
      // after a lost connection.
      second = await result.current.createClient({ full_name: 'O. Odhiambo' }, { leadId: 'lead_1' });
    });

    expect(second.id).toBe(first.id);
    expect(second.full_name).toBe('Otieno Odhiambo');
    expect(db._rows('clients')).toHaveLength(1);
  });

  it('a repeat enquiry closes onto the customer on file and keeps its origin', async () => {
    // The same buyer comes back next year with a second lead. Many leads may
    // end up at one customer; the customer still came from the first.
    const AGAIN = { ...LEAD, id: 'lead_9', full_name: 'Otieno Odhiambo' };
    boot({ leads: [LEAD, AGAIN] });
    const { result } = renderHook(() => useClientRecords({ enabled: false }));

    let origin; let repeat; let third;
    await act(async () => {
      origin = await result.current.createClient({ full_name: 'Otieno Odhiambo' }, { leadId: 'lead_1' });
    });
    await act(async () => {
      repeat = await result.current.createClient(
        { full_name: 'Otieno Odhiambo', national_id: '31122000' },
        { leadId: 'lead_9', useExistingId: origin.id },
      );
    });
    // And converting that second lead again must not start over.
    await act(async () => {
      third = await result.current.createClient({ full_name: 'Otieno O' }, { leadId: 'lead_9' });
    });

    expect(repeat.id).toBe(origin.id);
    expect(third.id).toBe(origin.id);
    expect(repeat.lead_id).toBe('lead_1');          // the origin is not rewritten
    expect(repeat.national_id).toBe('31122000');    // but a blank field is filled
    expect(db._rows('leads').find(l => l.id === 'lead_9').converted_ref_id).toBe(origin.id);
    expect(db._rows('clients')).toHaveLength(1);
  });
});

describe('the duplicate gate', () => {
  it('offers the customer already on file and refuses to create beside them', async () => {
    boot({ clients: [ON_FILE] });
    const user = userEvent.setup();
    openModal();

    await typeName(user, 'W. Kamau');
    await user.type(screen.getByLabelText(/^phone$/i), '+254 712 345 678');

    // Written differently, same subscriber — the normalisation is the point.
    await screen.findByText(/already on file/i);
    expect(screen.getByText(/AF-2026-000001/)).toBeInTheDocument();
    expect(screen.getByText(/the same phone number/i)).toBeInTheDocument();

    // And the way forward is closed until the operator says which it is.
    expect(screen.getByRole('button', { name: /create client record/i })).toBeDisabled();
  });

  it('"use this record" links instead of creating', async () => {
    // A second lead for somebody the tenant already sells to — the ordinary way
    // a duplicate customer gets made.
    const SAME_PERSON = {
      ...LEAD, id: 'lead_2', full_name: 'Wanjiru Kamau',
      phone: '0712345678', email: 'wanjiru@example.com',
    };
    boot({ clients: [ON_FILE], leads: [SAME_PERSON] });
    const user = userEvent.setup();
    const onCreated = vi.fn();
    openModal({ lead: SAME_PERSON, onCreated });

    await user.click(await screen.findByRole('button', { name: /use this record/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const [client, meta] = onCreated.mock.calls[0];
    expect(meta.linked).toBe(true);
    expect(client.id).toBe('client_existing');
    // One customer, now carrying the lead. Not two.
    expect(db._rows('clients')).toHaveLength(1);
    expect(db._rows('clients')[0].lead_id).toBe('lead_2');
  });

  it('lets an operator say they are different people, and records that they did', async () => {
    boot({ clients: [ON_FILE] });
    const user = userEvent.setup();
    const onCreated = vi.fn();
    openModal({ onCreated });

    await typeName(user, 'W. Kamau');
    await user.type(screen.getByLabelText(/^phone$/i), '0712345678');
    await screen.findByText(/already on file/i);

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /create client record/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(db._rows('clients')).toHaveLength(2);
    const audit = db._rows('audit_logs').at(-1);
    expect(audit.new_values.forced_past_duplicates).toBe(true);
    expect(audit.severity).toBe('warning');
  });

  it('treats a shared name as a suggestion, not a blocker', async () => {
    boot({ clients: [ON_FILE] });
    const user = userEvent.setup();
    openModal();

    // The same name and nothing else. Common enough to be meaningless.
    await typeName(user, 'Wanjiru Kamau');

    // The server excludes a name-only match entirely, so nothing is shown and
    // nothing is blocked — the operator is not trained to click past warnings.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /create client record/i })).toBeEnabled());
    expect(screen.queryByText(/already on file/i)).not.toBeInTheDocument();
  });

  it('surfaces a refusal from the server even when the panel never showed one', async () => {
    // The duplicate lookup is unavailable — a caller that skipped the check, or
    // a network blip. The database refuses on its own account, and the screen
    // has to say so rather than failing silently.
    boot({ clients: [ON_FILE] });
    const rpcs = clientRecordRpcs({ adminId: 'admin_1' });
    db = createFakeSupabase({
      user: AGENT,
      tables: { clients: [ON_FILE] },
      rpcs: { ...rpcs, finhub_find_client_duplicates: () => [] },
    });

    const user = userEvent.setup();
    openModal();
    await typeName(user, 'Wanjiru Kamau');
    await user.type(screen.getByLabelText(/^kra pin$/i), 'A001234567X');
    await user.click(screen.getByRole('button', { name: /create client record/i }));

    expect(await screen.findByText(/a client record already exists/i)).toBeInTheDocument();
    expect(db._rows('clients')).toHaveLength(1);
  });
});

describe('balances and payment history', () => {
  const withMoney = () => boot({
    clients: [ON_FILE],
    company_invoices: [
      { id: 'inv_1', client_id: 'client_existing', invoice_no: 'INV-0001', issue_date: '2026-07-01', total: 50000, status: 'paid',      notes: 'Deposit invoice' },
      { id: 'inv_2', client_id: 'client_existing', invoice_no: 'INV-0002', issue_date: '2026-08-01', total: 30000, status: 'overdue',   notes: 'August billing' },
      { id: 'inv_3', client_id: 'client_existing', invoice_no: 'INV-0003', issue_date: '2026-08-15', total: 10000, status: 'draft',     notes: 'Not issued' },
      { id: 'inv_4', client_id: 'client_existing', invoice_no: 'INV-0004', issue_date: '2026-06-01', total: 99999, status: 'cancelled', notes: 'Raised in error' },
    ],
    payments: [
      { id: 'pay_1', client_id: 'client_existing', transaction_id: 'TX-1', amount: 50000, payment_status: 'completed', payment_method: 'mpesa', payment_date: '2026-07-03' },
      { id: 'pay_2', client_id: 'client_existing', transaction_id: 'TX-2', amount: 12000, payment_status: 'completed', payment_method: 'mpesa', payment_date: '2026-08-09' },
      { id: 'pay_3', client_id: 'client_existing', transaction_id: 'TX-3', amount: 88000, payment_status: 'pending',   payment_method: 'mpesa', payment_date: '2026-08-20' },
    ],
  });

  it('counts what was billed and what was received, and nothing else', async () => {
    withMoney();
    const { result } = renderHook(() => useClientRecords({ enabled: false }));

    let account;
    await act(async () => { account = await result.current.loadAccount('client_existing'); });

    // A draft was never issued and a cancelled invoice was withdrawn; a pending
    // M-Pesa push that never confirmed has not reduced anybody's balance.
    expect(account.summary.invoiced).toBe(80000);
    expect(account.summary.paid).toBe(62000);
    expect(account.summary.balance).toBe(18000);
    expect(account.summary.overdue_count).toBe(1);
    expect(account.summary.payment_count).toBe(2);
  });

  it('reads the history newest first, with a balance carried over the whole of it', async () => {
    withMoney();
    const { result } = renderHook(() => useClientRecords({ enabled: false }));

    let account;
    await act(async () => { account = await result.current.loadAccount('client_existing'); });

    expect(account.statement.map(r => r.reference)).toEqual(['TX-2', 'INV-0002', 'TX-1', 'INV-0001']);
    // The newest row's balance is the real one, not one that starts at zero
    // part-way through the year.
    expect(account.statement[0].running_balance).toBe(18000);
    expect(account.statement.at(-1).running_balance).toBe(50000);
  });

  it('totals the book in Postgres and states how many records there really are', async () => {
    withMoney();
    const { result } = renderHook(() => useClientRecords({ pageSize: 1 }));

    await waitFor(() => expect(result.current.clients).toHaveLength(1));
    expect(result.current.clients[0].balance).toBe(18000);
    expect(typeof result.current.clients[0].balance).toBe('number');
    expect(result.current.total).toBe(1);
  });
});

describe('who may create one', () => {
  it('refuses a client-portal user', async () => {
    boot({ role: 'client' });
    const { result } = renderHook(() => useClientRecords({ enabled: false }));

    await expect(
      act(async () => { await result.current.createClient({ full_name: 'Somebody' }); }),
    ).rejects.toThrow(/only staff/i);
  });
});

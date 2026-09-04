/**
 * End-to-end test of the maker-checker approval queue, driven through the real UI.
 *
 * This is the app's only genuine two-step approval surface. A maker raises an
 * action from POS (high_value_transaction, payment_refund) or from the penalty
 * panel (debt_adjustment); a checker settles it here. Because it is the closest
 * thing the app has to a payment validation → approval → audit pipeline, the
 * approve / reject / hold(escalate) / bulk cases the payment workflow lacks are
 * covered against it.
 *
 * What this does NOT cover, because it does not exist: nothing on the agent
 * withdrawal path ever enqueues here (see paymentApprovalWorkflow.test.jsx), so
 * releasing commission money is single-signature no matter the amount.
 *
 * Cases under "known defects" pin CURRENT wrong behaviour on purpose.
 */

import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeSupabase, resetFakeIds } from '../../../test-utils/fakeSupabase';

let db;
vi.mock('../../../lib/supabase', () => ({
  get supabase() { return db; },
  getCurrentUser: async () => ({ id: 'user_checker' }),
  invokeSupabaseFunction: vi.fn(async () => ({ data: null, error: null })),
}));

const MakerCheckerTab = (await import('./MakerCheckerTab')).default;

const queued = (o = {}) => ({
  id: 'mc_1',
  action_type: 'payment_refund',
  title: 'Refund KES 48,000 to Nyeri Traders',
  description: 'Duplicate M-Pesa collection on invoice INV-2291',
  initiator_id: 'user_maker', initiator_name: 'Grace Mwangi', initiator_role: 'cashier',
  status: 'pending', priority: 'high',
  affected_entity: 'payments', affected_entity_id: 'pay_991',
  change_details: { amount: 48000, invoice: 'INV-2291' },
  is_bulk_eligible: false,
  created_at: '2026-09-03T08:00:00.000Z',
  ...o,
});

/** The four clicks a checker makes to settle a batch. */
const bulkApprove = async (user, comment) => {
  await user.click(screen.getByRole('button', { name: /^Bulk Mode/i }));
  await user.click(await screen.findByRole('button', { name: /^Select All Eligible/i }));
  await user.click(screen.getByRole('button', { name: /^Bulk Approve/i }));
  const box = await screen.findByPlaceholderText(/comment for all selected approvals/i);
  if (comment !== null) await user.type(box, comment);
  await user.click(screen.getByRole('button', { name: /^Confirm Bulk Approval$/i }));
};

const seed = (rows, failures = {}) => createFakeSupabase({
  user: { id: 'user_checker', email: 'checker@ararat.co.ke' },
  failures,
  tables: { maker_checker_queue: rows, audit_logs: [], user_profiles: [] },
});

const row = (id) => db._row('maker_checker_queue', id);

/** Card for a queue item, located by its title. */
const cardFor = (title) => screen.getByText(title).closest('div.bg-card') || screen.getByText(title).closest('div');

/**
 * Drive one decision through the card exactly as a checker would:
 * click the action, type the mandatory comment, confirm.
 */
const decide = async (user, title, action, comment) => {
  const card = cardFor(title);
  await user.click(within(card).getByRole('button', { name: new RegExp(`^${action}$`, 'i') }));
  const box = await within(card).findByPlaceholderText(new RegExp(`${action.toLowerCase()} reason`, 'i'));
  if (comment !== null) await user.type(box, comment);
  await user.click(within(card).getByRole('button', { name: /^Confirm/i }));
};

beforeEach(() => {
  resetFakeIds();
  vi.clearAllMocks();
  db = seed([queued()]);
  // supabase.functions.invoke — the notify hook the tab fires after a decision.
  db.functions = { invoke: vi.fn(async () => ({ data: null, error: null })) };
});

const renderTab = async () => {
  const user = userEvent.setup();
  render(<MakerCheckerTab />);
  await screen.findByText('Refund KES 48,000 to Nyeri Traders');
  return user;
};

/* ──────────────────────────────────────────────────────────────────────────── */
describe('maker-checker · approval', () => {
  it('records the decision, the comment and the resolution time, then drops it from the queue', async () => {
    const user = await renderTab();

    await decide(user, 'Refund KES 48,000 to Nyeri Traders', 'Approve', 'Verified against the M-Pesa statement');

    await waitFor(() => expect(row('mc_1').status).toBe('approved'));
    expect(row('mc_1')).toMatchObject({
      status: 'approved',
      checker_comment: 'Verified against the M-Pesa statement',
      notification_sent: true,
    });
    expect(row('mc_1').resolved_at).toEqual(expect.any(String));

    // The queue reads only pending + escalated, so a settled item leaves it.
    await waitFor(() => expect(screen.queryByText('Refund KES 48,000 to Nyeri Traders')).toBeNull());
    expect(db.functions.invoke).toHaveBeenCalledWith('maker-checker-notify', expect.objectContaining({
      body: expect.objectContaining({ action_id: 'mc_1', status: 'approved' }),
    }));
  });

  it('refuses to submit without a comment — no write reaches the queue', async () => {
    const user = await renderTab();
    const card = cardFor('Refund KES 48,000 to Nyeri Traders');

    await user.click(within(card).getByRole('button', { name: /^Approve$/i }));
    await within(card).findByPlaceholderText(/approve reason/i);
    await user.click(within(card).getByRole('button', { name: /^Confirm/i }));

    expect(await within(card).findByText(/comment is required/i)).toBeInTheDocument();
    expect(row('mc_1').status).toBe('pending');
    expect(db._writes.filter((w) => w.op === 'update')).toHaveLength(0);
  });
});

describe('maker-checker · rejection', () => {
  it('records the rejection with its reason and notifies the maker', async () => {
    const user = await renderTab();

    await decide(user, 'Refund KES 48,000 to Nyeri Traders', 'Reject', 'Not a duplicate — two separate orders');

    await waitFor(() => expect(row('mc_1').status).toBe('rejected'));
    expect(row('mc_1').checker_comment).toBe('Not a duplicate — two separate orders');
    expect(db.functions.invoke).toHaveBeenCalledWith('maker-checker-notify', expect.objectContaining({
      body: expect.objectContaining({ status: 'rejected' }),
    }));
  });
});

describe('maker-checker · hold (escalate)', () => {
  it('holds the item for senior review, keeping it in the queue with its reason', async () => {
    const user = await renderTab();

    await decide(user, 'Refund KES 48,000 to Nyeri Traders', 'Escalate', 'Above my limit — needs the FD');

    await waitFor(() => expect(row('mc_1').status).toBe('escalated'));
    expect(row('mc_1')).toMatchObject({ escalation_reason: 'Above my limit — needs the FD' });
    expect(row('mc_1').escalated_at).toEqual(expect.any(String));

    // Escalated is a HOLD, not a resolution: it stays on the queue.
    expect(await screen.findByText('Refund KES 48,000 to Nyeri Traders')).toBeInTheDocument();
    expect(row('mc_1').resolved_at).toBeUndefined();
  });

  it('BUG: a hold neither records who it went to nor notifies anyone', async () => {
    // handleEscalate writes escalation_reason and escalated_at only. The
    // escalated_to column stays null, so nothing addresses the hold to a person,
    // and unlike approve/reject it fires no notification — the item simply sits
    // in the queue looking the same as an unread one.
    const user = await renderTab();

    await decide(user, 'Refund KES 48,000 to Nyeri Traders', 'Escalate', 'Above my limit');

    await waitFor(() => expect(row('mc_1').status).toBe('escalated'));
    expect(row('mc_1').escalated_to).toBeUndefined();
    expect(db.functions.invoke).not.toHaveBeenCalled();
  });
});

describe('maker-checker · bulk approval', () => {
  const bulkSet = () => [
    queued({ id: 'mc_1', title: 'Refund A', is_bulk_eligible: true,  priority: 'low' }),
    queued({ id: 'mc_2', title: 'Refund B', is_bulk_eligible: true,  priority: 'low' }),
    queued({ id: 'mc_3', title: 'Refund C', is_bulk_eligible: false, priority: 'critical',
             action_type: 'high_value_transaction' }),
  ];

  it('settles every selected item in one write, with the shared comment on each', async () => {
    db = seed(bulkSet());
    db.functions = { invoke: vi.fn(async () => ({ data: null, error: null })) };
    const user = userEvent.setup();
    render(<MakerCheckerTab />);
    await screen.findByText('Refund A');

    await bulkApprove(user, 'Month-end batch, all reconciled');

    await waitFor(() => expect(row('mc_1').status).toBe('approved'));
    expect(row('mc_2').status).toBe('approved');
    expect(row('mc_1').checker_comment).toBe('Month-end batch, all reconciled');

    // The non-eligible critical item is untouched.
    expect(row('mc_3').status).toBe('pending');

    // One statement, not N — the whole point of the bulk path.
    const updates = db._writes.filter((w) => w.table === 'maker_checker_queue' && w.op === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].ids.sort()).toEqual(['mc_1', 'mc_2']);
  });

  it('BUG: bulk approval sends no notifications, unlike a single approval', async () => {
    // handleBulkApprove sets notification_sent: true but never calls
    // sendNotification, so makers are told nothing and the row claims they were.
    db = seed(bulkSet());
    db.functions = { invoke: vi.fn(async () => ({ data: null, error: null })) };
    const user = userEvent.setup();
    render(<MakerCheckerTab />);
    await screen.findByText('Refund A');

    await bulkApprove(user, 'Batch');

    await waitFor(() => expect(row('mc_1').status).toBe('approved'));
    expect(row('mc_1').notification_sent).toBe(true);
    expect(db.functions.invoke).not.toHaveBeenCalled();
  });
});

describe('maker-checker · audit trail', () => {
  it('BUG: the checker is recorded as the literal "Current User"', async () => {
    // checker_name is hardcoded in all four handlers and checker_id is never
    // written at all, so the queue cannot say who approved what. Unlike the
    // withdrawal path there is no audit_logs entry either, so this row IS the
    // only record — and it does not name a person.
    const user = await renderTab();

    await decide(user, 'Refund KES 48,000 to Nyeri Traders', 'Approve', 'Checked');

    await waitFor(() => expect(row('mc_1').status).toBe('approved'));
    expect(row('mc_1').checker_name).toBe('Current User');
    expect(row('mc_1').checker_id).toBeUndefined();
    expect(db._rows('audit_logs')).toHaveLength(0);
  });
});

describe('maker-checker · failed decision write', () => {
  it('keeps the item pending and surfaces the error instead of reporting success', async () => {
    db = seed([queued()], {
      'maker_checker_queue.update': { code: '42501', message: 'permission denied for table maker_checker_queue' },
    });
    db.functions = { invoke: vi.fn(async () => ({ data: null, error: null })) };
    const user = userEvent.setup();
    render(<MakerCheckerTab />);
    await screen.findByText('Refund KES 48,000 to Nyeri Traders');

    await decide(user, 'Refund KES 48,000 to Nyeri Traders', 'Approve', 'Verified');

    expect(await screen.findByText(/permission denied/i)).toBeInTheDocument();
    expect(row('mc_1').status).toBe('pending');
    expect(screen.getByText('Refund KES 48,000 to Nyeri Traders')).toBeInTheDocument();
  });
});

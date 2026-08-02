import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ContributionsTab from './ContributionsTab';

// The treasurer's side. These cover the controls that stop money being quietly
// rewritten: settled entries can only be reversed, a reversal needs a reason,
// and the search actually narrows the ledger.

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const member = (id, name, no) => ({ id, full_name: name, member_no: no, monthly_contribution: 1000 });

const row = (over = {}) => ({
  id: 'c1', txn_no: 'CTR-00000001', member_id: 'm1',
  member: { id: 'm1', full_name: 'Jane Wanjiku', member_no: 'MEM-001' },
  amount: 1000, contribution_type: 'monthly', account: 'deposits',
  payment_method: 'cash', status: 'completed', channel: 'admin',
  paid_at: '2026-08-01T09:00:00Z', paid_date: '2026-08-01', period_month: '2026-08-01',
  reference: 'SLIP-1', received_by_name: 'Treasurer', penalty_amount: 0,
  created_at: '2026-08-01T09:00:00Z',
  ...over,
});

const buildCtx = (over = {}) => ({
  contributions: [row()],
  members: [member('m1', 'Jane Wanjiku', 'MEM-001'), member('m2', 'Peter Otieno', 'MEM-002')],
  contributionTypes: [],
  contributionAudit: [],
  recordContribution: vi.fn(),
  approveContribution: vi.fn(),
  reverseContribution: vi.fn(),
  editContribution: vi.fn(),
  createContributionType: vi.fn(),
  updateContributionType: vi.fn(),
  exportCSV: vi.fn(),
  getCollections: vi.fn().mockResolvedValue([]),
  getDefaulters: vi.fn().mockResolvedValue([]),
  getMemberContributionStats: vi.fn().mockResolvedValue(null),
  ...over,
});

describe('sacco dashboard — contributions ledger', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the receipt number, officer and method on every entry', () => {
    render(<ContributionsTab ctx={buildCtx()} />);
    expect(screen.getByText('CTR-00000001')).toBeInTheDocument();
    expect(screen.getByText('Treasurer')).toBeInTheDocument();
    expect(screen.getByText('SLIP-1')).toBeInTheDocument();
  });

  it('offers Approve only on pending entries, and never Edit on settled money', () => {
    const ctx = buildCtx({
      contributions: [
        row(),                                                        // completed
        row({ id: 'c2', txn_no: 'CTR-2', status: 'pending', channel: 'member_portal' }),
      ],
    });
    render(<ContributionsTab ctx={ctx} />);

    // One Approve (the pending row) and one Edit (also the pending row).
    expect(screen.getAllByText('Approve')).toHaveLength(1);
    expect(screen.getAllByText('Edit')).toHaveLength(1);
    // Reverse is available on both, because neither is already reversed.
    expect(screen.getAllByText('Reverse')).toHaveLength(2);
  });

  it('will not reverse without a reason, and passes the reason through when given', async () => {
    const ctx = buildCtx();
    render(<ContributionsTab ctx={ctx} />);

    fireEvent.click(screen.getByText('Reverse'));
    fireEvent.click(screen.getByText('Reverse contribution'));
    await waitFor(() => expect(ctx.reverseContribution).not.toHaveBeenCalled());

    fireEvent.change(screen.getByPlaceholderText(/Cheque bounced/), {
      target: { value: 'Posted to the wrong member' },
    });
    fireEvent.click(screen.getByText('Reverse contribution'));
    await waitFor(() =>
      expect(ctx.reverseContribution).toHaveBeenCalledWith('c1', 'Posted to the wrong member'));
  });

  it('approves a member declaration with the method and reference the treasurer confirms', async () => {
    const ctx = buildCtx({
      contributions: [row({ status: 'pending', channel: 'member_portal', reference: '' })],
    });
    render(<ContributionsTab ctx={ctx} />);

    fireEvent.click(screen.getByText('Approve'));
    fireEvent.change(screen.getByPlaceholderText('Receipt / slip no.'), { target: { value: 'BNK-42' } });
    fireEvent.click(screen.getByText('Confirm received'));

    await waitFor(() => expect(ctx.approveContribution).toHaveBeenCalled());
    expect(ctx.approveContribution.mock.calls[0][1]).toMatchObject({ reference: 'BNK-42' });
  });

  it('searches the ledger by member, reference and transaction number', () => {
    const ctx = buildCtx({
      contributions: [
        row(),
        row({
          id: 'c2', txn_no: 'CTR-00000002', member_id: 'm2', reference: 'MPX99',
          member: { id: 'm2', full_name: 'Peter Otieno', member_no: 'MEM-002' },
        }),
      ],
    });
    render(<ContributionsTab ctx={ctx} />);
    const search = screen.getByPlaceholderText(/Search transaction no/);

    fireEvent.change(search, { target: { value: 'Peter' } });
    expect(screen.getByText('CTR-00000002')).toBeInTheDocument();
    expect(screen.queryByText('CTR-00000001')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'MPX99' } });
    expect(screen.getByText('CTR-00000002')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'CTR-00000001' } });
    expect(screen.getByText('CTR-00000001')).toBeInTheDocument();
    expect(screen.queryByText('CTR-00000002')).not.toBeInTheDocument();
  });

  it('filters by payment method and only totals settled money', () => {
    const ctx = buildCtx({
      contributions: [
        row(),                                                                  // cash, completed, 1000
        row({ id: 'c2', txn_no: 'CTR-2', payment_method: 'mpesa', amount: 2500 }),
        row({ id: 'c3', txn_no: 'CTR-3', payment_method: 'mpesa', amount: 9999, status: 'pending' }),
      ],
    });
    render(<ContributionsTab ctx={ctx} />);

    fireEvent.change(screen.getByDisplayValue('Any method'), { target: { value: 'mpesa' } });
    // Two M-Pesa rows are shown...
    expect(screen.getByText(/settled across 2 entries/)).toBeInTheDocument();
    expect(screen.queryByText('CTR-00000001')).not.toBeInTheDocument();
    // ...but the 9,999 pending row is excluded from the settled total.
    const summary = screen.getByText(/settled across 2 entries/).closest('span');
    expect(summary).toHaveTextContent('KES 2,500');
    expect(summary).not.toHaveTextContent('12,499');
  });

  it('renders the audit log with the before and after values', () => {
    const ctx = buildCtx({
      contributionAudit: [{
        id: 'a1', txn_no: 'CTR-00000001', action: 'reversed',
        actor_name: 'Grace Mwangi', actor_role: 'sacco_admin',
        changed_fields: ['status'],
        old_values: { status: 'completed' }, new_values: { status: 'reversed' },
        reason: 'Cheque bounced', created_at: '2026-08-01T10:00:00Z',
      }],
    });
    render(<ContributionsTab ctx={ctx} />);
    fireEvent.click(screen.getByText('Audit log'));

    expect(screen.getByText('Grace Mwangi')).toBeInTheDocument();
    expect(screen.getByText('Cheque bounced')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getAllByText('reversed').length).toBeGreaterThan(0);
  });

  it('runs the collections and defaulters reports when the Reports tab opens', async () => {
    const ctx = buildCtx({
      getCollections: vi.fn().mockResolvedValue([
        { bucket: '2026-08-01', entries: 2, members: 2, total: 3500, cash: 1000, bank: 0, mpesa: 2500, card: 0, deposits: 3500, share_capital: 0 },
      ]),
      getDefaulters: vi.fn().mockResolvedValue([
        { member_id: 'm2', member_no: 'MEM-002', full_name: 'Peter Otieno', phone: '0700', monthly_contribution: 1000, expected: 5000, contributed: 1000, outstanding: 4000, missed_months: 4, last_paid_at: null },
      ]),
    });
    render(<ContributionsTab ctx={ctx} />);
    fireEvent.click(screen.getByText('Reports'));

    await waitFor(() => expect(ctx.getCollections).toHaveBeenCalled());
    expect(ctx.getCollections.mock.calls[0][0]).toMatchObject({ bucket: 'day' });

    // Peter also appears in the member-statements list, so scope to the card.
    const defaultersCard = (await screen.findByText('Defaulters')).closest('.bg-card');
    expect(within(defaultersCard).getByText('Peter Otieno')).toBeInTheDocument();
    expect(within(defaultersCard).getByText('KES 4,000')).toBeInTheDocument();
    expect(within(defaultersCard).getByText('4')).toBeInTheDocument(); // missed months

    // Switching the bucket re-runs the report at the new granularity.
    fireEvent.click(screen.getByText('Annual'));
    await waitFor(() =>
      expect(ctx.getCollections.mock.calls.at(-1)[0]).toMatchObject({ bucket: 'year' }));
  });

  it('exports what the filters are actually showing, not the whole table', () => {
    const ctx = buildCtx({
      contributions: [
        row(),
        row({ id: 'c2', txn_no: 'CTR-2', member_id: 'm2', member: { id: 'm2', full_name: 'Peter Otieno', member_no: 'MEM-002' } }),
      ],
    });
    render(<ContributionsTab ctx={ctx} />);

    fireEvent.change(screen.getByPlaceholderText(/Search transaction no/), { target: { value: 'Peter' } });
    fireEvent.click(within(screen.getByText('Contributions ledger').closest('div').parentElement).getByText('Export'));

    const [exported] = ctx.exportCSV.mock.calls[0];
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({ transaction_no: 'CTR-2', member: 'Peter Otieno' });
  });
});

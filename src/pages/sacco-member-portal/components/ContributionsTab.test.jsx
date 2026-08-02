import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ContributionsTab from './ContributionsTab';

// The member's side of the contributions engine. These cover the rules the
// feature actually rests on: a member can start a payment, a declared payment
// does NOT count as savings until the sacco confirms it, and an M-Pesa payment
// settles by itself.

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const me = {
  id: 'm1', full_name: 'Jane Wanjiku', member_no: 'MEM-001', phone: '0712345678',
  monthly_contribution: 1000, deposit_account_no: 'MEM-001-DEP',
  share_capital_account_no: 'MEM-001-SC',
};

const contribution = (over = {}) => ({
  id: 'c1', txn_no: 'CTR-00000001', member_id: 'm1', amount: 1000,
  contribution_type: 'monthly', account: 'deposits', payment_method: 'cash',
  status: 'completed', paid_at: '2026-08-01T09:00:00Z', paid_date: '2026-08-01',
  period_month: '2026-08-01', reference: 'SLIP-1', received_by_name: 'Treasurer',
  created_at: '2026-08-01T09:00:00Z', channel: 'admin',
  ...over,
});

const buildCtx = (over = {}) => {
  const contributions = over.contributions ?? [contribution()];
  const settled = contributions.filter((c) => ['completed', 'paid'].includes(c.status));
  const sum = (r) => r.reduce((s, c) => s + Number(c.amount || 0), 0);
  return {
    me,
    contributions,
    contributionTypes: [],
    contributionStats: { missed_month_list: [] },
    stats: {
      totalSavings: sum(settled),
      totalDeposits: sum(settled.filter((c) => (c.account || 'deposits') === 'deposits')),
      totalShareCapital: sum(settled.filter((c) => c.account === 'share_capital')),
      lastContribution: settled[0] || null,
      thisMonth: sum(settled),
      monthlyTarget: 1000,
      outstanding: 0,
      missedMonths: 0,
      nextDueDate: '2026-09-30',
      pendingContributions: contributions.filter((c) => c.status === 'pending').length,
    },
    exportCSV: vi.fn(),
    submitContribution: vi.fn(),
    cancelContribution: vi.fn(),
    payContributionByMpesa: vi.fn(),
    checkMpesaContribution: vi.fn(),
    ...over,
  };
};

describe('member portal — contributions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the savings, deposit and share-capital positions the BRS asks for', () => {
    const ctx = buildCtx({
      contributions: [
        contribution(),
        contribution({ id: 'c2', txn_no: 'CTR-2', amount: 5000, account: 'share_capital' }),
      ],
    });
    render(<ContributionsTab ctx={ctx} />);

    expect(screen.getByText('Total savings')).toBeInTheDocument();
    expect(screen.getByText('KES 6,000')).toBeInTheDocument();   // total savings
    // 5,000 shows on the share-capital card and again on its ledger row.
    expect(screen.getAllByText('KES 5,000').length).toBeGreaterThan(0);
    expect(screen.getByText('MEM-001-DEP')).toBeInTheDocument();
    expect(screen.getByText('MEM-001-SC')).toBeInTheDocument();
    expect(screen.getByText('CTR-00000001')).toBeInTheDocument();
  });

  it('records a cash payment as a declaration, not as settled savings', async () => {
    const ctx = buildCtx({ contributions: [] });
    ctx.submitContribution.mockResolvedValue({ id: 'new', txn_no: 'CTR-9', amount: 750 });

    render(<ContributionsTab ctx={ctx} />);
    fireEvent.click(screen.getByText('Make a contribution'));

    fireEvent.change(screen.getByPlaceholderText('1000'), { target: { value: '750' } });
    fireEvent.change(screen.getByDisplayValue('M-Pesa (pay now)'), { target: { value: 'cash' } });
    fireEvent.click(screen.getByText('Submit for confirmation'));

    await waitFor(() => expect(ctx.submitContribution).toHaveBeenCalled());
    expect(ctx.submitContribution.mock.calls[0][0]).toMatchObject({
      amount: 750, payment_method: 'cash', account: 'deposits',
    });
    // A declaration must never trigger a payment request.
    expect(ctx.payContributionByMpesa).not.toHaveBeenCalled();
  });

  it('creates the pending row first, then pushes M-Pesa against that exact row', async () => {
    const ctx = buildCtx({ contributions: [] });
    const pendingRow = { id: 'new', txn_no: 'CTR-9', amount: 1000, status: 'pending' };
    ctx.submitContribution.mockResolvedValue(pendingRow);
    ctx.payContributionByMpesa.mockResolvedValue({ checkoutRequestId: 'ws_CO_1' });

    render(<ContributionsTab ctx={ctx} />);
    fireEvent.click(screen.getByText('Make a contribution'));
    fireEvent.click(screen.getByText('Pay with M-Pesa'));

    await waitFor(() => expect(ctx.payContributionByMpesa).toHaveBeenCalled());
    const [row, phone] = ctx.payContributionByMpesa.mock.calls[0];
    expect(row).toBe(pendingRow);            // bound to the row we just created
    expect(phone).toBe('0712345678');
    expect(await screen.findByText('Check your phone')).toBeInTheDocument();
  });

  it('refuses an M-Pesa payment without a valid Safaricom number', async () => {
    const ctx = buildCtx({ contributions: [] });
    render(<ContributionsTab ctx={ctx} />);
    fireEvent.click(screen.getByText('Make a contribution'));
    fireEvent.change(screen.getByPlaceholderText('0712 345 678'), { target: { value: '123' } });
    fireEvent.click(screen.getByText('Pay with M-Pesa'));

    await waitFor(() => expect(ctx.submitContribution).not.toHaveBeenCalled());
  });

  it('lets a member withdraw a declaration the treasurer has not confirmed', async () => {
    const ctx = buildCtx({
      contributions: [contribution({ id: 'p1', txn_no: 'CTR-P', status: 'pending', paid_at: null })],
    });
    render(<ContributionsTab ctx={ctx} />);

    expect(screen.getByText('Awaiting confirmation')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Withdraw'));
    await waitFor(() => expect(ctx.cancelContribution).toHaveBeenCalledWith('p1'));
  });

  it('keeps a reversed contribution visible with its reason, and out of the totals', () => {
    const ctx = buildCtx({
      contributions: [contribution({ status: 'reversed', reversal_reason: 'Cheque bounced' })],
    });
    render(<ContributionsTab ctx={ctx} />);

    expect(screen.getByText('CTR-00000001')).toBeInTheDocument();
    expect(screen.getByText('Cheque bounced')).toBeInTheDocument();
    expect(ctx.stats.totalSavings).toBe(0);
  });

  it('warns the member when they are in arrears', () => {
    const ctx = buildCtx();
    ctx.stats.missedMonths = 3;
    ctx.stats.outstanding = 3000;
    ctx.contributionStats = { missed_month_list: ['2026-05-01', '2026-06-01', '2026-07-01'] };

    render(<ContributionsTab ctx={ctx} />);
    expect(screen.getByText(/You have missed/)).toBeInTheDocument();
    expect(screen.getByText('KES 3,000')).toBeInTheDocument();
  });
});

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ReceiptsTab from './ReceiptsTab';
import { usePagedQuery } from '../../../hooks/usePagedQuery';

vi.mock('../../../components/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../../hooks/usePagedQuery', () => ({ usePagedQuery: vi.fn() }));

const me = { id: 'm1', full_name: 'Mary Member', member_no: 'MEM-001' };
const ctx = { me, sacco: { id: 's1', name: 'Umoja Sacco' } };

const page = (over = {}) => ({
  rows: [], total: 0, page: 0, pageCount: 1, from: 0, to: 0, loading: false, error: null,
  setPage: vi.fn(), refresh: vi.fn(), ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('member ReceiptsTab', () => {
  it('reads only this member\'s receipts and lists them as issued', () => {
    usePagedQuery.mockReturnValue(page({
      total: 1, from: 1, to: 1,
      rows: [{
        id: 'rc1', receipt_no: 'RCT-2026-000014', receipt_type: 'loan_repayment', amount: 20400.54,
        payment_method: 'mpesa', payment_reference: 'QHX7Y8Z9AB', paid_on: '2026-09-24',
        description: 'Repayment of Development Loan LN-1A2B3C4D, instalments 1, 2 of 3',
      }],
    }));
    render(<ReceiptsTab ctx={ctx} />);

    expect(screen.getByText('RCT-2026-000014')).toBeInTheDocument();
    expect(screen.getByText('Loan repayment')).toBeInTheDocument();
    expect(screen.getByText('KES 20,400.54')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download receipt RCT-2026-000014' })).toBeInTheDocument();

    // RLS limits the rows already; the query says so explicitly too.
    const opts = usePagedQuery.mock.calls.at(-1)[0];
    const eq = vi.fn(() => 'filtered');
    expect(opts.applyFilters({ eq })).toBe('filtered');
    expect(eq).toHaveBeenCalledWith('member_id', 'm1');
    expect(opts.table).toBe('sacco_receipts');
  });

  it('tells a member plainly when there is nothing yet', () => {
    usePagedQuery.mockReturnValue(page());
    render(<ReceiptsTab ctx={ctx} />);
    expect(screen.getByText('No receipts yet')).toBeInTheDocument();
  });

  it('does not show a raw schema error while the receipt book is not set up', () => {
    usePagedQuery.mockReturnValue(page({ error: "Could not find the table 'public.sacco_receipts' in the schema cache" }));
    render(<ReceiptsTab ctx={ctx} />);
    expect(screen.getByText('Receipts are not available yet')).toBeInTheDocument();
    expect(screen.queryByText(/schema cache/)).toBeNull();
  });
});

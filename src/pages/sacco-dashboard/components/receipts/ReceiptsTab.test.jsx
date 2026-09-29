import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ReceiptsTab from './ReceiptsTab';
import * as service from '../../../../services/saccoReceiptService';
import { usePagedQuery } from '../../../../hooks/usePagedQuery';

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../../../../components/Toast', () => ({ useToast: () => toast }));

vi.mock('../../../../hooks/usePagedQuery', () => ({ usePagedQuery: vi.fn() }));

vi.mock('../../../../services/saccoReceiptService', () => ({
  fetchReceiptSummary: vi.fn(),
  fetchPendingSharePurchases: vi.fn(),
  fetchReceipt: vi.fn(),
  fetchActiveLoans: vi.fn(),
  fetchUnpaidInstalments: vi.fn(),
  recordLoanRepayment: vi.fn(),
  recordSharePurchasePayment: vi.fn(),
}));

const receipt = {
  id: 'rc1', receipt_no: 'RCT-2026-000001', receipt_type: 'loan_repayment', member_id: 'm1',
  member_name: 'Mary Member', member_no: 'MEM-001', amount: 20400.54, payment_method: 'mpesa',
  payment_reference: 'QHX7Y8Z9AB', paid_on: '2026-09-24', loan_id: 'aaaa1111-0000',
  balance_after: 10100.45, instalments_left: 1, description: 'Repayment of Development Loan LN-AAAA1111, instalments 1, 2 of 3',
  received_by_name: 'Tom Treasurer', created_at: '2026-09-25T08:15:00Z',
};

const page = (over = {}) => ({
  rows: [receipt], total: 1, page: 0, pageCount: 1, from: 1, to: 1, loading: false, error: null,
  setPage: vi.fn(), refresh: vi.fn(), ...over,
});

const ctx = { sacco: { id: 's1', name: 'Umoja Sacco' }, exportCSV: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  usePagedQuery.mockReturnValue(page());
  service.fetchReceiptSummary.mockResolvedValue([
    { receipt_type: 'loan_repayment', payment_method: 'mpesa', receipts: 2, amount: '30601.99' },
    { receipt_type: 'share_purchase', payment_method: 'cash', receipts: 1, amount: '6060.00' },
  ]);
  service.fetchPendingSharePurchases.mockResolvedValue([{
    share_txn_id: 't6', txn_no: 'SHT-0000006', bought_at: '2026-09-25T10:00:00Z', member_id: 'm2',
    member_name: 'John Seller', member_no: 'MEM-002', shares: 20, price_per_share: 50,
    consideration: 1000, fee: 0, amount_due: 1000, seller: 'SACCO treasury',
  }]);
  service.fetchReceipt.mockResolvedValue({ ...receipt, lines: [] });
});

describe('ReceiptsTab', () => {
  it('totals the period from the server, never from the page on screen', async () => {
    render(<ReceiptsTab ctx={ctx} />);

    // String amounts from PostgREST are added as numbers, not concatenated.
    expect(await screen.findByText('KES 36,661.99')).toBeInTheDocument();
    // Loan repayments card, and the M-Pesa takings chip — all of it was M-Pesa.
    expect(screen.getAllByText('KES 30,601.99')).toHaveLength(2);
    expect(screen.getByText('3 receipts', { exact: false })).toBeInTheDocument();
    // The register is scoped to this sacco and to the chosen period.
    const opts = usePagedQuery.mock.calls.at(-1)[0];
    expect(opts.table).toBe('sacco_receipts');
    expect(opts.deps[0]).toBe('s1');
    expect(service.fetchReceiptSummary).toHaveBeenCalledWith({
      from: expect.stringMatching(/-01$/), to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  it('lists share purchases still owed, and receipts one from its row', async () => {
    render(<ReceiptsTab ctx={ctx} />);

    const card = (await screen.findByText('Share purchases awaiting payment')).closest('div.bg-card');
    expect(within(card).getByText('SHT-0000006')).toBeInTheDocument();
    expect(screen.getByText('1 share purchase')).toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: 'Receipt payment' }));
    expect(await screen.findByRole('heading', { name: 'Receive a payment' })).toBeInTheDocument();
    // Opened on that purchase: no type switch, and no loan lookup for nothing.
    expect(screen.queryByRole('radiogroup', { name: 'Payment for' })).toBeNull();
    await waitFor(() => expect(screen.getByPlaceholderText('0.00')).toHaveValue(1000));
    expect(service.fetchActiveLoans).not.toHaveBeenCalled();
  });

  it('shows each receipt with its number, method, reference and who took it', async () => {
    render(<ReceiptsTab ctx={ctx} />);

    expect(screen.getByText('RCT-2026-000001')).toBeInTheDocument();
    expect(screen.getByText('QHX7Y8Z9AB')).toBeInTheDocument();
    expect(screen.getByText('Tom Treasurer')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    await waitFor(() => expect(service.fetchReceipt).toHaveBeenCalledWith('rc1'));
    expect(await screen.findByRole('heading', { name: 'Receipt RCT-2026-000001' })).toBeInTheDocument();
  });

  it('says plainly when the database has no receipt book yet', async () => {
    usePagedQuery.mockReturnValue(page({
      rows: [], total: 0,
      error: "Could not find the table 'public.sacco_receipts' in the schema cache",
    }));
    render(<ReceiptsTab ctx={ctx} />);
    expect(await screen.findByText('The receipt book is not set up on the server yet')).toBeInTheDocument();
  });
});

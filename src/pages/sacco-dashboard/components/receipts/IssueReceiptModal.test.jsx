import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import IssueReceiptModal from './IssueReceiptModal';
import * as service from '../../../../services/saccoReceiptService';

// The receipt desk as a cashier meets it. The database issues the receipt and
// re-checks everything; what is tested here is that the desk only offers what
// can be paid, asks for what the RPC will demand, and sends exactly what the
// cashier chose.

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../../../../components/Toast', () => ({ useToast: () => toast }));

vi.mock('../../../../services/saccoReceiptService', () => ({
  recordLoanRepayment: vi.fn(),
  recordSharePurchasePayment: vi.fn(),
  fetchActiveLoans: vi.fn(),
  fetchUnpaidInstalments: vi.fn(),
  fetchPendingSharePurchases: vi.fn(),
}));

const mary = { id: 'm1', full_name: 'Mary Member', member_no: 'MEM-001' };
const john = { id: 'm2', full_name: 'John Borrower', member_no: 'MEM-002' };

const loans = [
  { id: 'aaaa1111-0000-0000-0000-000000000000', member_id: 'm1', principal: 30000, product: { name: 'Development Loan' }, member: mary },
  { id: 'bbbb2222-0000-0000-0000-000000000000', member_id: 'm2', principal: 5000, product: null, member: john },
  { id: 'cccc3333-0000-0000-0000-000000000000', member_id: 'm2', principal: 8000, product: null, member: john },
];

const instalments = [
  { id: 's1', loan_id: loans[0].id, period_no: 1, due_date: '2026-07-01', principal: 9900.10, interest: 300, payment: 10200.10 },
  { id: 's2', loan_id: loans[0].id, period_no: 2, due_date: '2026-08-01', principal: 9999.45, interest: 200.99, payment: 10200.44 },
  { id: 's3', loan_id: loans[0].id, period_no: 3, due_date: '2099-09-01', principal: 10100.45, interest: 101, payment: 10201.45 },
];

const purchase = {
  share_txn_id: 't1', txn_no: 'SHT-0000001', bought_at: '2026-09-23T10:00:00Z', member_id: 'm1',
  member_name: 'Mary Member', member_no: 'MEM-001', shares: 120, price_per_share: 50,
  consideration: 6000, fee: 60, amount_due: 6060, seller: 'SACCO treasury',
};

const issuedReceipt = { id: 'rc1', receipt_no: 'RCT-2026-000001', amount: 20400.54 };

const amountBox = () => screen.getByPlaceholderText('0.00');
const issue = () => fireEvent.click(screen.getByRole('button', { name: /issue receipt/i }));

beforeEach(() => {
  vi.clearAllMocks();
  service.fetchActiveLoans.mockResolvedValue(loans);
  service.fetchUnpaidInstalments.mockResolvedValue(instalments);
  service.fetchPendingSharePurchases.mockResolvedValue([purchase]);
  service.recordLoanRepayment.mockResolvedValue(issuedReceipt);
  service.recordSharePurchasePayment.mockResolvedValue({ id: 'rc3', receipt_no: 'RCT-2026-000003', amount: 6060 });
});

describe('IssueReceiptModal — loan repayment', () => {
  const preset = { type: 'loan_repayment', memberId: 'm1', loanId: loans[0].id, scheduleIds: ['s2'] };

  it('opens on the instalment it was asked for, with the amount it costs', async () => {
    render(<IssueReceiptModal open preset={preset} onClose={vi.fn()} onIssued={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText('Instalment 2')).toBeChecked());
    expect(screen.getByLabelText('Instalment 1')).not.toBeChecked();
    // Principal + interest, not the payment column.
    expect(amountBox()).toHaveValue(10200.44);
    // An instalment whose due date has passed says so.
    expect(screen.getAllByText('overdue')).toHaveLength(2);
  });

  it('settles every instalment ticked, for the amount they total', async () => {
    const onIssued = vi.fn();
    render(<IssueReceiptModal open preset={preset} onClose={vi.fn()} onIssued={onIssued} />);
    await waitFor(() => expect(screen.getByLabelText('Instalment 2')).toBeChecked());

    fireEvent.click(screen.getByLabelText('Instalment 1'));
    await waitFor(() => expect(amountBox()).toHaveValue(20400.54));
    issue();

    await waitFor(() => expect(service.recordLoanRepayment).toHaveBeenCalled());
    const sent = service.recordLoanRepayment.mock.calls[0][0];
    expect(sent.scheduleIds.sort()).toEqual(['s1', 's2']);
    expect(sent).toMatchObject({ amount: 20400.54, method: 'cash', reference: '', notes: '' });
    expect(sent.paidOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(onIssued).toHaveBeenCalledWith(issuedReceipt);
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('RCT-2026-000001'), 'Payment recorded');
  });

  it('refuses an amount that does not match what is ticked, before asking the server', async () => {
    render(<IssueReceiptModal open preset={preset} onClose={vi.fn()} onIssued={vi.fn()} />);
    await waitFor(() => expect(amountBox()).toHaveValue(10200.44));

    fireEvent.change(amountBox(), { target: { value: '10000' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('must equal what is being settled (KES 10,200.44)');
    issue();
    expect(service.recordLoanRepayment).not.toHaveBeenCalled();
  });

  it('asks for the M-Pesa code, and sends it in capitals', async () => {
    render(<IssueReceiptModal open preset={preset} onClose={vi.fn()} onIssued={vi.fn()} />);
    await waitFor(() => expect(amountBox()).toHaveValue(10200.44));

    fireEvent.change(screen.getByDisplayValue('Cash'), { target: { value: 'mpesa' } });
    issue();
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the M-Pesa code.');
    expect(service.recordLoanRepayment).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('e.g. QHX7Y8Z9AB'), { target: { value: 'qhx7y8z9ab' } });
    issue();
    await waitFor(() => expect(service.recordLoanRepayment).toHaveBeenCalled());
    expect(service.recordLoanRepayment.mock.calls[0][0]).toMatchObject({ method: 'mpesa', reference: 'QHX7Y8Z9AB' });
  });

  it('shows the database refusal as the cashier should read it', async () => {
    service.recordLoanRepayment.mockRejectedValue({ code: 'P0001', message: 'Instalment 2 is already paid' });
    const onIssued = vi.fn();
    render(<IssueReceiptModal open preset={preset} onClose={vi.fn()} onIssued={onIssued} />);
    await waitFor(() => expect(amountBox()).toHaveValue(10200.44));

    issue();
    expect(await screen.findByRole('alert')).toHaveTextContent('Instalment 2 is already paid');
    expect(onIssued).not.toHaveBeenCalled();
  });

  it('offers only borrowers with an active loan, and picks the loan when there is only one', async () => {
    render(<IssueReceiptModal open preset={{}} onClose={vi.fn()} onIssued={vi.fn()} />);

    const borrower = await screen.findByDisplayValue('Select member');
    await waitFor(() => expect(screen.getByRole('option', { name: /John Borrower · MEM-002 \(2\)/ })).toBeInTheDocument());
    fireEvent.change(borrower, { target: { value: 'm1' } });

    await waitFor(() => expect(service.fetchUnpaidInstalments).toHaveBeenCalledWith(loans[0].id));
    // Nothing preset, so the oldest unpaid instalment is ticked.
    await waitFor(() => expect(screen.getByLabelText('Instalment 1')).toBeChecked());
    expect(amountBox()).toHaveValue(10200.1);
  });
});

describe('IssueReceiptModal — share purchase', () => {
  it('receipts a purchase awaiting payment for its price plus the fee', async () => {
    const onIssued = vi.fn();
    render(
      <IssueReceiptModal
        open
        preset={{ type: 'share_purchase', memberId: 'm1', shareTxnId: 't1' }}
        onClose={vi.fn()}
        onIssued={onIssued}
      />,
    );

    expect(await screen.findByText(/120 shares at KES 50.00 from SACCO treasury/)).toBeInTheDocument();
    await waitFor(() => expect(amountBox()).toHaveValue(6060));
    fireEvent.change(screen.getByDisplayValue('Cash'), { target: { value: 'bank' } });
    fireEvent.change(screen.getByPlaceholderText('Slip or transfer reference'), { target: { value: 'EQ-88812' } });
    issue();

    await waitFor(() => expect(service.recordSharePurchasePayment).toHaveBeenCalled());
    expect(service.recordSharePurchasePayment.mock.calls[0][0]).toMatchObject({
      shareTxnId: 't1', amount: 6060, method: 'bank', reference: 'EQ-88812',
    });
    expect(service.recordLoanRepayment).not.toHaveBeenCalled();
    expect(onIssued).toHaveBeenCalled();
  });
});

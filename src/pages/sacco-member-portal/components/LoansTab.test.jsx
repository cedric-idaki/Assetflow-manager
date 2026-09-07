import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LoansTab from './LoansTab';

// The borrowing multiple as the member meets it: what they are told they may
// borrow, and whether the portal lets them ask for more.
//
// Every figure here comes from sacco_member_borrowing_capacity() — the same
// function the insert trigger judges an application by — so these tests are
// about the portal DISPLAYING the server's answer and never inventing one of
// its own. The refusal is enforced server-side regardless; what is tested here
// is that the member is told before they submit, not after.

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../../../components/Toast', () => ({
  useToast: () => toast,
}));

const me = { id: 'm1', full_name: 'Jane Wanjiku', member_no: 'MEM-001', sacco_id: 's1' };

// 500 shares at KES 200 = KES 100,000 of shares; at 3x that is a 300,000
// ceiling, of which 100,000 is already borrowed, leaving 200,000.
const capacity = (over = {}) => ({
  shares_held: 500,
  share_price: 200,
  share_value: 100000,
  deposits: 40000,
  security: 100000,
  multiple: 3,
  ceiling: 300000,
  existing_exposure: 100000,
  available: 200000,
  limit_enforced: true,
  counts_deposits: false,
  nets_off_loans: true,
  ...over,
});

const product = {
  id: 'p1', name: 'Development Loan', annual_interest_rate: 12,
  amortization_method: 'reducing_balance', max_term_months: 36,
};

const buildCtx = (over = {}) => ({
  me,
  sacco: { id: 's1', name: 'Ararat Sacco' },
  loans: [],
  schedules: [],
  loanProducts: [product],
  borrowingCapacity: capacity(),
  applyLoan: vi.fn().mockResolvedValue({ id: 'loan_1' }),
  pledgeCollateral: vi.fn().mockResolvedValue({ id: 'col_1' }),
  exportCSV: vi.fn(),
  ...over,
});

const openApplyForm = async (amount) => {
  fireEvent.click(screen.getByRole('button', { name: /apply for a loan/i }));
  // The trigger button and the modal heading carry the same words, so the
  // heading is what identifies the dialog.
  const heading = await screen.findByRole('heading', { name: 'Apply for a loan' });
  const modal = heading.closest('div[class*="fixed"]') || document.body;
  fireEvent.change(within(modal).getByPlaceholderText('50000'), { target: { value: amount } });
  return modal;
};

describe('LoansTab — borrowing multiple', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the member what they may borrow, net of what they already owe', async () => {
    render(<LoansTab ctx={buildCtx()} />);

    // The headline figure is the headroom, not the gross ceiling: a member
    // with a live loan cannot borrow the whole entitlement again.
    expect(screen.getAllByText('KES 200,000').length).toBeGreaterThan(0);
    expect(screen.getByText(/3x your shares/i)).toBeInTheDocument();

    const modal = await openApplyForm('150000');
    expect(within(modal).getByText(/what you may borrow/i)).toBeInTheDocument();
    expect(within(modal).getByText('Maximum eligible')).toBeInTheDocument();
    expect(within(modal).getByText(/KES 100,000 of your KES 300,000 entitlement is committed/i))
      .toBeInTheDocument();
  });

  it('refuses to submit an application above an enforced limit', async () => {
    const ctx = buildCtx();
    render(<LoansTab ctx={ctx} />);

    const modal = await openApplyForm('250000');
    // The form now carries a second select (the security type), so the
    // product picker has to be named rather than assumed to be the only one.
    fireEvent.change(within(modal).getByLabelText(/loan product/i), { target: { value: 'p1' } });

    expect(within(modal).getByText(/KES 50,000 above your limit/i)).toBeInTheDocument();

    const submit = within(modal).getByRole('button', { name: /submit application/i });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    await waitFor(() => expect(ctx.applyLoan).not.toHaveBeenCalled());
  });

  it('lets an over-limit application through when the society does not enforce it', async () => {
    const ctx = buildCtx({ borrowingCapacity: capacity({ limit_enforced: false }) });
    render(<LoansTab ctx={ctx} />);

    const modal = await openApplyForm('250000');
    // The form now carries a second select (the security type), so the
    // product picker has to be named rather than assumed to be the only one.
    fireEvent.change(within(modal).getByLabelText(/loan product/i), { target: { value: 'p1' } });

    // Advice, not a refusal — the loans officer still gets to decide.
    expect(within(modal).getByText(/You can still apply/i)).toBeInTheDocument();

    const submit = within(modal).getByRole('button', { name: /submit application/i });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    await waitFor(() => expect(ctx.applyLoan).toHaveBeenCalledTimes(1));
  });

  it('explains an empty share register instead of quoting a zero limit', async () => {
    const ctx = buildCtx({
      borrowingCapacity: capacity({
        shares_held: 0, share_value: 0, security: 0, ceiling: 0,
        existing_exposure: 0, available: 0,
      }),
    });
    render(<LoansTab ctx={ctx} />);

    const modal = await openApplyForm('50000');
    expect(within(modal).getByText(/none are recorded against your membership yet/i))
      .toBeInTheDocument();
    expect(within(modal).queryByText('Maximum eligible')).not.toBeInTheDocument();
  });

  it('says nothing about a limit when the society has no policy to report', async () => {
    render(<LoansTab ctx={buildCtx({ borrowingCapacity: null })} />);

    // Pre-feature behaviour: no ceiling shown, nothing blocked.
    expect(screen.queryByText('Maximum eligible')).not.toBeInTheDocument();

    const modal = await openApplyForm('900000');
    expect(within(modal).queryByText(/what you may borrow/i)).not.toBeInTheDocument();
    expect(within(modal).getByRole('button', { name: /submit application/i })).not.toBeDisabled();
  });
});


/* ────────────────────────────────────────────────────────────────────────────
   SECURITY

   A pledge is optional, and the interesting cases are the two that lose
   information: a half-filled pledge that would record an unenforceable charge,
   and an upload failure that must NOT take the loan application down with it.
   ──────────────────────────────────────────────────────────────────────────── */
describe('LoansTab — pledging security', () => {
  beforeEach(() => vi.clearAllMocks());

  const fillPledge = (modal, { type = 'vehicle', ref = 'KAA 123B', value = '750000' } = {}) => {
    if (type) fireEvent.change(within(modal).getByLabelText(/asset type/i), { target: { value: type } });
    if (ref !== null) {
      fireEvent.change(within(modal).getByPlaceholderText(/KAA 123B/i), { target: { value: ref } });
    }
    if (value !== null) {
      fireEvent.change(within(modal).getByPlaceholderText('750000'), { target: { value } });
    }
  };

  const submit = (modal) =>
    fireEvent.click(within(modal).getByRole('button', { name: /submit application/i }));

  it('applies with no security at all, because most loans need none', async () => {
    const ctx = buildCtx();
    render(<LoansTab ctx={ctx} />);
    const modal = await openApplyForm('50000');
    fireEvent.change(within(modal).getByLabelText(/loan product/i), { target: { value: 'p1' } });

    submit(modal);
    await waitFor(() => expect(ctx.applyLoan).toHaveBeenCalled());
    expect(ctx.pledgeCollateral).not.toHaveBeenCalled();
  });

  it('records the pledge against the loan the application just created', async () => {
    const ctx = buildCtx();
    render(<LoansTab ctx={ctx} />);
    const modal = await openApplyForm('50000');
    fireEvent.change(within(modal).getByLabelText(/loan product/i), { target: { value: 'p1' } });
    fillPledge(modal);

    submit(modal);
    await waitFor(() => expect(ctx.pledgeCollateral).toHaveBeenCalled());

    const [loanId, pledge] = ctx.pledgeCollateral.mock.calls[0];
    expect(loanId).toBe('loan_1');
    expect(pledge).toMatchObject({ assetType: 'vehicle', reference: 'KAA 123B', value: '750000' });
  });

  it('refuses a pledge with a reference but no value, rather than recording half a charge', async () => {
    const ctx = buildCtx();
    render(<LoansTab ctx={ctx} />);
    const modal = await openApplyForm('50000');
    fireEvent.change(within(modal).getByLabelText(/loan product/i), { target: { value: 'p1' } });
    fillPledge(modal, { value: '' });

    submit(modal);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/what the pledged asset is worth/i),
    ));
    // Nothing was submitted at all — the application is still on screen to fix.
    expect(ctx.applyLoan).not.toHaveBeenCalled();
  });

  it('refuses a value with no reference', async () => {
    const ctx = buildCtx();
    render(<LoansTab ctx={ctx} />);
    const modal = await openApplyForm('50000');
    fireEvent.change(within(modal).getByLabelText(/loan product/i), { target: { value: 'p1' } });
    fillPledge(modal, { ref: '' });

    submit(modal);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/reference for the asset/i),
    ));
    expect(ctx.applyLoan).not.toHaveBeenCalled();
  });

  it('keeps the application when the security fails to attach, and says which half went in', async () => {
    const ctx = buildCtx({
      pledgeCollateral: vi.fn().mockRejectedValue(new Error('The ownership document could not be uploaded.')),
    });
    render(<LoansTab ctx={ctx} />);
    const modal = await openApplyForm('50000');
    fireEvent.change(within(modal).getByLabelText(/loan product/i), { target: { value: 'p1' } });
    fillPledge(modal);

    submit(modal);

    // The loan IS in. Telling the member only "failed" would have them
    // resubmit and burn a second application against their ceiling.
    await waitFor(() => expect(ctx.applyLoan).toHaveBeenCalled());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/Application submitted, but the security was not attached/i),
    ));
    expect(toast.success).not.toHaveBeenCalled();
  });
});

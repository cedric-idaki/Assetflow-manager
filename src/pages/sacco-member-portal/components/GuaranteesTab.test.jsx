import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import GuaranteesTab from './GuaranteesTab';

// The two-step acceptance is the whole point of this tab, so these cover the
// sequence rather than the styling: a request cannot be confirmed until it has
// been read, reading is gated on an explicit acknowledgement, the confirmation
// carries the same terms hash the member was shown, and terms that moved
// underneath a reader send them back to step 1 instead of binding them.
//
// The server enforces all of this too (sacco_loan_guarantee_review /
// _confirm). These tests are about the portal never PRESENTING a shortcut.

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const me = { id: 'me', full_name: 'Jane Wanjiku', member_no: 'MEM-001' };

const TERMS_HASH = 'a1b2c3d4e5f6';

const terms = (over = {}) => ({
  guarantee_id: 'g1',
  ref_no: 'GT-000001',
  version: 'GT-1.0',
  hash: TERMS_HASH,
  status: 'requested',
  sacco_name: 'Ararat Sacco',
  amount_guaranteed: 25000,
  reviewed_at: null,
  accepted_at: null,
  terms_changed_since_review: false,
  loan: {
    id: 'l1', ref: 'LN-ABCD1234', product: 'Development Loan',
    principal: 100000, rate: 12, term_months: 12, method: 'reducing_balance',
    purpose: 'School fees', status: 'pending',
  },
  borrower:  { name: 'Peter Otieno', member_no: 'MEM-002' },
  guarantor: { name: 'Jane Wanjiku', member_no: 'MEM-001' },
  capacity: { deposits: 40000, share_value: 20000, already_committed: 0, security: 60000 },
  cap: {
    enforced: true, multiple: 1, counts_shares: true,
    limit: 60000, headroom: 60000, active_count: 0, max_active: 0,
  },
  blocked_reason: null,
  clauses: [
    { heading: 'What you are undertaking', body: 'The Guarantor guarantees repayment of the Borrower’s facility.' },
    { heading: 'If the borrower defaults', body: 'The Sacco may recover from the Guarantor’s deposits and shares.' },
  ],
  ...over,
});

const guarantee = (over = {}) => ({
  id: 'g1',
  ref_no: 'GT-000001',
  loan_id: 'l1',
  borrower_member_id: 'b1',
  guarantor_member_id: 'me',
  amount_guaranteed: 25000,
  status: 'requested',
  reviewed_at: null,
  accepted_at: null,
  signature_name: null,
  created_at: '2026-09-04T08:00:00Z',
  borrower:  { id: 'b1', full_name: 'Peter Otieno', member_no: 'MEM-002' },
  guarantor: { id: 'me', full_name: 'Jane Wanjiku', member_no: 'MEM-001' },
  loan: { id: 'l1', principal: 100000, term_months: 12, status: 'pending' },
  ...over,
});

const buildCtx = (over = {}) => ({
  me,
  members: [{ id: 'b1', full_name: 'Peter Otieno', member_no: 'MEM-002', status: 'active' }],
  loans: [{ id: 'l1', principal: 100000, status: 'pending' }],
  guarantees: [guarantee()],
  getGuaranteeTerms: vi.fn().mockResolvedValue(terms()),
  requestGuarantee: vi.fn().mockResolvedValue({}),
  reviewGuarantee: vi.fn().mockResolvedValue(
    guarantee({ status: 'under_review', reviewed_at: new Date().toISOString() }),
  ),
  confirmGuarantee: vi.fn().mockResolvedValue({}),
  declineGuarantee: vi.fn().mockResolvedValue({}),
  waitOnGuarantee: vi.fn().mockResolvedValue({}),
  cancelGuarantee: vi.fn().mockResolvedValue({}),
  ...over,
});

describe('member portal — loan guarantees', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers only "read the agreement" on an unread request — never a confirm shortcut', () => {
    render(<GuaranteesTab ctx={buildCtx()} />);
    expect(screen.getByRole('button', { name: /read the agreement/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm the guarantee/i })).not.toBeInTheDocument();
  });

  it('holds step 1 shut until the member acknowledges what they have read', async () => {
    const ctx = buildCtx();
    render(<GuaranteesTab ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: /read the agreement/i }));

    await waitFor(() => expect(ctx.getGuaranteeTerms).toHaveBeenCalledWith('g1'));
    const cont = await screen.findByRole('button', { name: /i have read this/i });
    expect(cont).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(cont).toBeEnabled();
  });

  it('records the review against the hash it displayed, then moves to step 2', async () => {
    const ctx = buildCtx();
    render(<GuaranteesTab ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: /read the agreement/i }));

    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /i have read this/i }));

    await waitFor(() => expect(ctx.reviewGuarantee).toHaveBeenCalledWith('g1', TERMS_HASH));
    expect(await screen.findByText(/step 2 of 2/i)).toBeInTheDocument();
    // Still not bound — the confirmation has not been made.
    expect(ctx.confirmGuarantee).not.toHaveBeenCalled();
  });

  it('will not finalize without a signature, and confirms against the reviewed hash', async () => {
    const ctx = buildCtx();
    render(<GuaranteesTab ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: /read the agreement/i }));
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /i have read this/i }));

    const confirm = await screen.findByRole('button', { name: /confirm — this is final/i });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Jane Wanjiku'), { target: { value: 'Jane Wanjiku' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(ctx.confirmGuarantee)
      .toHaveBeenCalledWith('g1', TERMS_HASH, 'Jane Wanjiku'));
  });

  it('sends a reviewer back to step 1 when the agreement moved under them', async () => {
    const ctx = buildCtx({
      guarantees: [guarantee({ status: 'under_review', reviewed_at: new Date().toISOString() })],
      getGuaranteeTerms: vi.fn().mockResolvedValue(terms({ terms_changed_since_review: true })),
    });
    render(<GuaranteesTab ctx={ctx} />);

    // The row offers the confirmation, but opening it lands on the terms again.
    fireEvent.click(screen.getByRole('button', { name: /^confirm the guarantee$/i }));
    expect(await screen.findByText(/step 1 of 2/i)).toBeInTheDocument();
    expect(screen.getByText(/these terms have changed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm — this is final/i })).not.toBeInTheDocument();
  });

  it('sends an expired reading back to step 1 rather than confirming it', async () => {
    const stale = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    const ctx = buildCtx({
      guarantees: [guarantee({ status: 'under_review', reviewed_at: stale })],
    });
    render(<GuaranteesTab ctx={ctx} />);

    expect(screen.getByText(/your reading has expired/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /read the agreement again/i }));
    expect(await screen.findByText(/step 1 of 2/i)).toBeInTheDocument();
  });

  it('refuses a request that would take the member past their exposure cap', async () => {
    const ctx = buildCtx({
      getGuaranteeTerms: vi.fn().mockResolvedValue(terms({
        amount_guaranteed: 80000,
        capacity: { deposits: 40000, share_value: 20000, already_committed: 0, security: 60000 },
        cap: { enforced: true, multiple: 1, counts_shares: true,
               limit: 60000, headroom: 60000, active_count: 0, max_active: 0 },
        blocked_reason: 'This would take what you guarantee to KES 80,000.00, past your limit of KES 60,000.00. You have KES 60,000.00 left to give.',
      })),
    });
    render(<GuaranteesTab ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: /read the agreement/i }));

    expect(await screen.findByText(/you cannot take this guarantee on/i)).toBeInTheDocument();
    expect(screen.getByText(/past your limit of KES 60,000\.00/i)).toBeInTheDocument();
    // The way forward is shut, and there is nothing to acknowledge.
    expect(screen.getByRole('button', { name: /i have read this/i })).toBeDisabled();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('never records a review for a member who is over the cap', async () => {
    const ctx = buildCtx({
      getGuaranteeTerms: vi.fn().mockResolvedValue(terms({
        blocked_reason: 'You have nothing left to give.',
      })),
    });
    render(<GuaranteesTab ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: /read the agreement/i }));

    await screen.findByText(/you cannot take this guarantee on/i);
    fireEvent.click(screen.getByRole('button', { name: /i have read this/i }));
    expect(ctx.reviewGuarantee).not.toHaveBeenCalled();
  });

  it('stops a confirmation when the cap bites between the two steps', async () => {
    // Reviewed cleanly, but their position moved before they came back to sign.
    // Re-reading cannot fix being over the cap, so they stay on step 2 and are
    // told plainly why it will not go through.
    const ctx = buildCtx({
      guarantees: [guarantee({ status: 'under_review', reviewed_at: new Date().toISOString() })],
      getGuaranteeTerms: vi.fn().mockResolvedValue(terms({
        blocked_reason: 'You already guarantee 3 loans, which is the most Ararat Sacco allows one member to carry.',
      })),
    });
    render(<GuaranteesTab ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: /^confirm the guarantee$/i }));

    expect(await screen.findByText(/your position has changed/i)).toBeInTheDocument();
    expect(screen.getByText(/you already guarantee 3 loans/i)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Jane Wanjiku'), { target: { value: 'Jane Wanjiku' } });
    expect(screen.getByRole('button', { name: /confirm — this is final/i })).toBeDisabled();
    expect(ctx.confirmGuarantee).not.toHaveBeenCalled();
  });

  it('shows the society limit and remaining room when the member is within it', async () => {
    const ctx = buildCtx();
    render(<GuaranteesTab ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: /read the agreement/i }));

    expect(await screen.findByText(/KES 60,000 left to give/i)).toBeInTheDocument();
    expect(screen.getByText(/up to the value of their own savings and shares/i)).toBeInTheDocument();
    expect(screen.queryByText(/you cannot take this guarantee on/i)).not.toBeInTheDocument();
  });

  it('shows a confirmed guarantee as final, with no way to take it back', () => {
    const ctx = buildCtx({
      guarantees: [guarantee({
        status: 'accepted',
        reviewed_at: '2026-09-04T09:00:00Z',
        accepted_at: '2026-09-04T09:05:00Z',
        signature_name: 'Jane Wanjiku',
      })],
    });
    render(<GuaranteesTab ctx={ctx} />);

    expect(screen.getByText(/this guarantee is final/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /decline/i })).not.toBeInTheDocument();
  });
});

// "Not yet" is the answer most people asked to guarantee a loan can honestly
// give on the day, and until it existed the portal forced them to say yes, say
// no, or say nothing — which the borrower could not tell apart from "hasn't
// looked". These cover the three things that makes it worth having: it is
// offered, it carries the member's own words, and it commits nobody.
describe('member portal — loan guarantees, the "not yet" answer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers a third answer alongside reading and declining', () => {
    render(<GuaranteesTab ctx={buildCtx()} />);
    expect(screen.getByRole('button', { name: /^not yet$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /read the agreement/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^decline$/i })).toBeInTheDocument();
  });

  it('sends the deferral with the note the member typed, and binds them to nothing', async () => {
    const ctx = buildCtx();
    render(<GuaranteesTab ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: /^not yet$/i }));

    fireEvent.change(await screen.findByPlaceholderText(/ask me again after the 5th/i), {
      target: { value: 'Ask me again after payday.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send this answer/i }));

    await waitFor(() => expect(ctx.waitOnGuarantee)
      .toHaveBeenCalledWith('g1', 'Ask me again after payday.'));
    // Deferring is not a decision either way.
    expect(ctx.declineGuarantee).not.toHaveBeenCalled();
    expect(ctx.confirmGuarantee).not.toHaveBeenCalled();
  });

  it('lets the member send it with no note at all', async () => {
    const ctx = buildCtx();
    render(<GuaranteesTab ctx={ctx} />);
    fireEvent.click(screen.getByRole('button', { name: /^not yet$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /send this answer/i }));

    await waitFor(() => expect(ctx.waitOnGuarantee).toHaveBeenCalledWith('g1', ''));
  });

  it('stops counting a deferred request as awaiting an answer, without hiding it', () => {
    const ctx = buildCtx({
      guarantees: [guarantee({
        waited_at: '2026-09-04T10:00:00Z',
        wait_note: 'Ask me again once my salary is in.',
      })],
    });
    render(<GuaranteesTab ctx={ctx} />);

    // The tile — and so the tab badge, which counts the same set — reads zero.
    const tile = screen.getByText('Awaiting your answer').closest('div').parentElement;
    expect(within(tile).getByText('0')).toBeInTheDocument();
    expect(screen.getByText(/1 more you asked for time on/i)).toBeInTheDocument();

    // But the request is still there, still answerable, with what they said.
    expect(screen.getByText(/you asked for more time/i)).toBeInTheDocument();
    expect(screen.getByText(/once my salary is in/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /read the agreement/i })).toBeInTheDocument();
  });

  it('tells the borrower they are waiting on a person, not on silence', () => {
    const ctx = buildCtx({
      guarantees: [guarantee({
        borrower_member_id: 'me',
        guarantor_member_id: 'g2',
        guarantor: { id: 'g2', full_name: 'Peter Otieno', member_no: 'MEM-002' },
        waited_at: '2026-09-04T10:00:00Z',
        wait_note: 'Ask me again once my salary is in.',
      })],
    });
    render(<GuaranteesTab ctx={ctx} />);

    expect(screen.getByText(/asked for more time on/i)).toBeInTheDocument();
    expect(screen.getByText(/once my salary is in/i)).toBeInTheDocument();
    // Still open, so the borrower can still pull it.
    expect(screen.getByRole('button', { name: /withdraw/i })).toBeInTheDocument();
  });
});

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The approval chain as the operator meets it. Turn order, the OTP check and
// the final loan transition are all decided by the database (see migration
// 20260930140000, exercised against Postgres); these tests are about the
// screen offering the right buttons and relaying the server's verdict.

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../../../../components/Toast', () => ({ useToast: () => toast }));

let liveLoan = { status: 'pending', approval_mode: 'sequential' };
vi.mock('../../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: liveLoan, error: null }) }) }),
    }),
  },
}));

const svc = vi.hoisted(() => ({
  fetchLoanSteps: vi.fn(),
  startApproval: vi.fn(),
  sendApprovalOtp: vi.fn(),
  decideApprovalStep: vi.fn(),
}));
vi.mock('../../../../services/loanApprovalService', async (orig) => ({
  ...(await orig()),
  ...svc,
}));

import LoanApprovalModal from './LoanApprovalModal';
import { actionableStepIds, approvalProgress } from '../../../../services/loanApprovalService';

const step = (n, over = {}) => ({
  id: `s${n}`, level_no: n, level_name: ['Credit Officer', 'Manager', 'Committee'][n - 1],
  approver_name: ['Jane', 'Peter', 'Mary'][n - 1], approver_email: `a${n}@x.com`, approver_phone: null,
  status: 'pending', comment: null, verified_via: null, decided_at: null, ...over,
});

const loan = { id: 'L1', status: 'pending', approval_mode: 'sequential', principal: 50000, member: { full_name: 'John' } };

describe('actionableStepIds', () => {
  const steps = [step(1, { status: 'approved', decided_at: 'x', verified_via: 'email' }), step(2), step(3)];
  it('sequential: only the first level not yet approved', () => {
    expect([...actionableStepIds(steps, 'sequential')]).toEqual(['s2']);
  });
  it('parallel: every pending level', () => {
    expect([...actionableStepIds(steps, 'parallel')]).toEqual(['s2', 's3']);
  });
  it('sequential after a rejection: nobody', () => {
    expect(actionableStepIds([step(1, { status: 'rejected' }), step(2)], 'sequential').size).toBe(0);
  });
  it('progress counts approvals', () => {
    expect(approvalProgress(steps)).toEqual({ approved: 1, total: 3 });
  });
});

describe('LoanApprovalModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    liveLoan = { status: 'pending', approval_mode: 'sequential' };
  });

  it('sequential: offers a code only to level 1 and tells level 2 it is waiting', async () => {
    svc.fetchLoanSteps.mockResolvedValue([step(1), step(2)]);
    render(<LoanApprovalModal loan={loan} onClose={() => {}} />);
    expect(await screen.findByText('Jane')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /email code/i })).toHaveLength(1);
    expect(screen.getByText(/waiting for credit officer to approve first/i)).toBeTruthy();
  });

  it('parallel: every pending level can request a code', async () => {
    liveLoan = { status: 'pending', approval_mode: 'parallel' };
    svc.fetchLoanSteps.mockResolvedValue([step(1), step(2)]);
    render(<LoanApprovalModal loan={{ ...loan, approval_mode: 'parallel' }} onClose={() => {}} />);
    await screen.findByText('Peter');
    await waitFor(() => expect(screen.getAllByRole('button', { name: /email code/i })).toHaveLength(2));
  });

  it('sends the code, relays a wrong-code verdict, then records the approval', async () => {
    svc.fetchLoanSteps.mockResolvedValue([step(1)]);
    svc.sendApprovalOtp.mockResolvedValue({ ok: true, channel: 'email', destination: 'a1•••@x.com', expires_minutes: 10 });
    const onChanged = vi.fn();
    render(<LoanApprovalModal loan={loan} onClose={() => {}} onChanged={onChanged} />);

    fireEvent.click(await screen.findByRole('button', { name: /email code/i }));
    await waitFor(() => expect(svc.sendApprovalOtp).toHaveBeenCalledWith('s1', 'email'));
    const input = await screen.findByLabelText('Verification code');

    svc.decideApprovalStep.mockResolvedValueOnce({ ok: false, error: 'That code is not correct.', attempts_left: 4 });
    fireEvent.change(input, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('That code is not correct. 4 attempt(s) left.'));
    expect(onChanged).not.toHaveBeenCalled();

    svc.decideApprovalStep.mockResolvedValueOnce({ ok: true, step_status: 'approved', loan_status: 'approved' });
    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    await waitFor(() => expect(svc.decideApprovalStep).toHaveBeenLastCalledWith('s1', '123456', 'approved', ''));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('will not send a rejection without a reason', async () => {
    svc.fetchLoanSteps.mockResolvedValue([step(1)]);
    svc.sendApprovalOtp.mockResolvedValue({ ok: true, channel: 'email', destination: 'x' });
    render(<LoanApprovalModal loan={loan} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /email code/i }));
    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^reject$/i }));
    expect(toast.error).toHaveBeenCalledWith('Give a reason for rejecting.');
    expect(svc.decideApprovalStep).not.toHaveBeenCalled();
  });

  it('a pre-existing loan with no chain can be started', async () => {
    svc.fetchLoanSteps.mockResolvedValueOnce([]).mockResolvedValue([step(1)]);
    svc.startApproval.mockResolvedValue(1);
    render(<LoanApprovalModal loan={loan} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /start approval workflow/i }));
    await waitFor(() => expect(svc.startApproval).toHaveBeenCalledWith('L1'));
    expect(await screen.findByText('Jane')).toBeTruthy();
  });
});

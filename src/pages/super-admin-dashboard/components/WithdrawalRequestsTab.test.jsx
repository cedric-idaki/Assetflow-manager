import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The tab reports outcomes through the app-wide toast provider mounted in
// App.jsx. Mocked rather than wrapped so the assertions read against what the
// super admin would actually be shown.
const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
vi.mock('../../../components/Toast', () => ({ useToast: () => toast }));

const WithdrawalRequestsTab = (await import('./WithdrawalRequestsTab')).default;

const request = (o = {}) => ({
  id: 'w-1',
  agent_id: 'agent-1',
  total_withdrawn: 25000,
  description: 'Monthly payout',
  created_at: '2026-08-12T12:00:00.000Z',
  status: 'pending',
  agent: { full_name: 'Jane Doe', agent_code: 'AGT-100', email: 'jane@example.com' },
  ...o,
});

const renderTab = (props = {}) => {
  const handlers = {
    onExport:  vi.fn(),
    onApprove: vi.fn(),
    onReject:  vi.fn(),
    ...props,
  };
  render(<WithdrawalRequestsTab requests={[request()]} {...handlers} />);
  return { user: userEvent.setup(), ...handlers };
};

beforeEach(() => vi.clearAllMocks());

describe('WithdrawalRequestsTab', () => {
  it('shows the withdrawal requests from sales agents', () => {
    renderTab();

    expect(screen.getByText('Withdrawal Requests')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('AGT-100')).toBeInTheDocument();
    expect(screen.getByText('KES 25,000')).toBeInTheDocument();
  });

  it('calls the approve and reject handlers for a pending request', async () => {
    const { user, onApprove, onReject } = renderTab();

    await user.click(screen.getByRole('button', { name: /approve/i }));
    await user.click(screen.getByRole('button', { name: /reject/i }));

    expect(onApprove).toHaveBeenCalledWith('w-1');
    expect(onReject).toHaveBeenCalledWith('w-1');
  });
});

/**
 * Regression tests for the silent failure.
 *
 * Both buttons used to be `onClick={() => onApprove?.(req.id)}` — the promise
 * was neither awaited nor caught. Before migration 20260904120000 the approve
 * threw on EVERY click (agent_wallets had no `status` column), the rejection
 * went unhandled, and the screen showed nothing whatsoever. These tests fail if
 * that wiring ever comes back.
 */
describe('WithdrawalRequestsTab — the outcome reaches the user', () => {
  it('surfaces the failure, using the message the hook raised', async () => {
    const onApprove = vi.fn().mockRejectedValue(
      new Error('column agent_wallets.status does not exist'),
    );
    const { user } = renderTab({ onApprove });

    await user.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('column agent_wallets.status does not exist'),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('falls back to a plain message when the failure carries none', async () => {
    const onReject = vi.fn().mockRejectedValue({});
    const { user } = renderTab({ onReject });

    await user.click(screen.getByRole('button', { name: /reject/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Nothing was changed'));
  });

  it('confirms a successful approval, naming the amount', async () => {
    const { user } = renderTab();

    await user.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('KES 25,000'));
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('approved'));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('cannot be double-submitted while the round trip is in flight', async () => {
    // Two audit entries and two notifications for one decision, if this ever
    // regresses. The button is disabled AND the handler guards, because a slow
    // approval is exactly when someone clicks again.
    let release;
    const onApprove = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const { user } = renderTab({ onApprove });

    const button = screen.getByRole('button', { name: /approve/i });
    await user.click(button);

    expect(onApprove).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveTextContent(/working/i);

    await user.click(button);
    expect(onApprove).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
  });
});

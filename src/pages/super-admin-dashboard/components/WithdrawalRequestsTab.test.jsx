import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import WithdrawalRequestsTab from './WithdrawalRequestsTab';

describe('WithdrawalRequestsTab', () => {
  it('shows the withdrawal requests from sales agents', () => {
    render(
      <WithdrawalRequestsTab
        requests={[
          {
            id: 'w-1',
            agent_id: 'agent-1',
            total_withdrawn: 25000,
            description: 'Monthly payout',
            created_at: '2026-08-12T12:00:00.000Z',
            status: 'pending',
            agent: {
              full_name: 'Jane Doe',
              agent_code: 'AGT-100',
              email: 'jane@example.com',
            },
          },
        ]}
        onExport={vi.fn()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText('Withdrawal Requests')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('AGT-100')).toBeInTheDocument();
    expect(screen.getByText('KES 25,000')).toBeInTheDocument();
  });

  it('calls the approve and reject handlers for a pending request', async () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const user = userEvent.setup();

    render(
      <WithdrawalRequestsTab
        requests={[
          {
            id: 'w-1',
            agent_id: 'agent-1',
            total_withdrawn: 25000,
            description: 'Monthly payout',
            created_at: '2026-08-12T12:00:00.000Z',
            status: 'pending',
            agent: {
              full_name: 'Jane Doe',
              agent_code: 'AGT-100',
              email: 'jane@example.com',
            },
          },
        ]}
        onExport={vi.fn()}
        onApprove={onApprove}
        onReject={onReject}
      />
    );

    await user.click(screen.getByRole('button', { name: /approve/i }));
    await user.click(screen.getByRole('button', { name: /reject/i }));

    expect(onApprove).toHaveBeenCalledWith('w-1');
    expect(onReject).toHaveBeenCalledWith('w-1');
  });
});

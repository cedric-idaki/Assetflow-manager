import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import ClientsPanel from './ClientsPanel';

const client = (overrides = {}) => ({
  id: 'c1',
  name: 'Acme Ltd',
  contactName: 'Jane Doe',
  email: 'jane@acme.co.ke',
  phone: '0712345678',
  bucket: 'active',
  statusLabel: 'Active · 40 days left',
  daysRemaining: 40,
  planName: 'starter',
  seats: 5,
  endDate: '2026-09-22T00:00:00.000Z',
  renewals: 1,
  lead: null,
  ...overrides,
});

const BOOK = [
  client({ id: 'c1', name: 'Acme Ltd',    bucket: 'active',   statusLabel: 'Active · 40 days left' }),
  client({ id: 'c2', name: 'Bolt Motors', bucket: 'expired',  statusLabel: 'Expired 5 days ago',  daysRemaining: -5 }),
  client({ id: 'c3', name: 'Cove Sacco',  bucket: 'expiring', statusLabel: 'Expires in 3 days',   daysRemaining: 3 }),
];

const COUNTS = { all: 3, active: 1, expired: 1, expiring: 1, pending: 0, attention: 0, unknown: 0 };

const setup = (props = {}) => render(
  <ClientsPanel
    clients={BOOK}
    counts={COUNTS}
    tracksSubscriptions
    enabled
    onFollowUp={vi.fn()}
    {...props}
  />
);

describe('ClientsPanel', () => {
  it('leads with how many clients need chasing', () => {
    setup();
    expect(screen.getByText(/2 of your 3 clients need following up/i)).toBeInTheDocument();
    expect(screen.getByText(/1 already expired/i)).toBeInTheDocument();
  });

  it('shows each client with its subscription standing', () => {
    setup();
    expect(screen.getByText('Acme Ltd')).toBeInTheDocument();
    expect(screen.getByText('Expired 5 days ago')).toBeInTheDocument();
    expect(screen.getByText('Expires in 3 days')).toBeInTheDocument();
  });

  it('narrows the list to one bucket when its chip is picked', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /Expired 1/i }));

    expect(screen.getByText('Bolt Motors')).toBeInTheDocument();
    expect(screen.queryByText('Acme Ltd')).not.toBeInTheDocument();
    expect(screen.queryByText('Cove Sacco')).not.toBeInTheDocument();
  });

  it('searches across name and contact details', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText('Search clients'), 'bolt');

    expect(screen.getByText('Bolt Motors')).toBeInTheDocument();
    expect(screen.queryByText('Acme Ltd')).not.toBeInTheDocument();
  });

  it('offers a way back when a filter matches nothing', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText('Search clients'), 'nobody');

    expect(screen.getByText(/No clients match that filter/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Clear filters/i }));
    expect(screen.getByText('Acme Ltd')).toBeInTheDocument();
  });

  it('hands the whole client to the follow-up handler', async () => {
    const user = userEvent.setup();
    const onFollowUp = vi.fn();
    setup({ onFollowUp });

    await user.click(screen.getAllByRole('button', { name: /Follow up/i })[0]);
    expect(onFollowUp).toHaveBeenCalledWith(expect.objectContaining({ name: expect.any(String) }));
  });

  it('says status is unreadable rather than implying nobody has subscribed', () => {
    setup({
      subscriptionsBlocked: true,
      clients: [client({ bucket: 'unknown', statusLabel: 'Subscription not visible', daysRemaining: null })],
      counts: { all: 1, unknown: 1 },
    });
    expect(screen.getByText(/Subscription records could not be read/i)).toBeInTheDocument();
    expect(screen.getByText('Subscription not visible')).toBeInTheDocument();
  });

  it('drops the subscription line for client-mode agents', () => {
    setup({
      tracksSubscriptions: false,
      clients: [client({ planName: null, seats: null, endDate: null, statusLabel: 'Owes KES 12,500', bucket: 'attention' })],
      counts: { all: 1, attention: 1 },
    });
    expect(screen.getByText('Owes KES 12,500')).toBeInTheDocument();
    expect(screen.queryByText(/starter plan/i)).not.toBeInTheDocument();
  });

  it('points a brand new agent at registering someone', () => {
    setup({ clients: [], counts: { all: 0 }, onRegister: vi.fn(), registerNoun: 'company' });
    expect(screen.getByText(/No clients yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Register a company/i })).toBeInTheDocument();
  });
});

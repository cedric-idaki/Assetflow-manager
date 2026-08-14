import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import DeviceBlockedScreen from './DeviceBlockedScreen';

const blockedOnComputer = {
  status:           'blocked',
  reason:           'slot_occupied',
  slot:             'computer',
  deviceType:       'tablet',
  changesRemaining: 2,
  occupiedBy: {
    id:         'dev-1',
    deviceType: 'laptop',
    deviceName: 'Chrome on Windows',
    lastSeenAt: '2026-08-12T09:30:00.000Z',
  },
};

describe('DeviceBlockedScreen', () => {
  it('names the slot that is full and the device holding it', () => {
    render(
      <DeviceBlockedScreen deviceCheck={blockedOnComputer} onClaim={vi.fn()} onSignOut={vi.fn()} />
    );

    expect(screen.getByText("This device isn't registered")).toBeInTheDocument();
    // The emphasised slot name, not the sentence in the header that also
    // mentions it — the point is that the user is told which slot is full.
    expect(screen.getByText('laptop or tablet')).toBeInTheDocument();
    expect(screen.getByText('Chrome on Windows')).toBeInTheDocument();
    expect(screen.getByText(/Last used/)).toBeInTheDocument();
  });

  it('offers the takeover and reports how many changes are left', async () => {
    const onClaim = vi.fn().mockResolvedValue({ allowed: true });
    const user = userEvent.setup();

    render(
      <DeviceBlockedScreen deviceCheck={blockedOnComputer} onClaim={onClaim} onSignOut={vi.fn()} />
    );

    expect(screen.getByText(/2 device changes left this month/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /use this device instead/i }));
    expect(onClaim).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /use this device instead/i })).toBeEnabled()
    );
  });

  it('withdraws the takeover once the change quota is spent', () => {
    render(
      <DeviceBlockedScreen
        deviceCheck={{ ...blockedOnComputer, reason: 'change_limit_reached', changesRemaining: 0 }}
        onClaim={vi.fn()}
        onSignOut={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: /use this device instead/i })).not.toBeInTheDocument();
    expect(screen.getByText(/ask your administrator/i)).toBeInTheDocument();
  });

  it('always leaves a way out', async () => {
    const onSignOut = vi.fn();
    const user = userEvent.setup();

    render(
      <DeviceBlockedScreen deviceCheck={blockedOnComputer} onClaim={vi.fn()} onSignOut={onSignOut} />
    );

    await user.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DevicesCard from './DevicesCard';
import { DEVICE_ID_STORAGE_KEY } from '../../../utils/deviceIdentity';

vi.mock('../../../services/deviceService', () => ({
  listDevices:         vi.fn(),
  revokeDevice:        vi.fn(),
  getChangesRemaining: vi.fn(),
}));

import { listDevices, revokeDevice, getChangesRemaining } from '../../../services/deviceService';

const THIS_DEVICE = 'device-id-for-this-browser';

const phone = {
  id: 'row-phone',
  device_id: 'device-id-for-the-phone',
  device_slot: 'mobile',
  device_type: 'phone',
  device_name: 'Safari on iOS',
  first_seen_at: '2026-07-01T08:00:00.000Z',
  last_seen_at: '2026-08-12T18:00:00.000Z',
  revoked_at: null,
};

const laptop = {
  id: 'row-laptop',
  device_id: THIS_DEVICE,
  device_slot: 'computer',
  device_type: 'laptop',
  device_name: 'Chrome on Windows',
  first_seen_at: '2026-07-01T08:00:00.000Z',
  last_seen_at: '2026-08-13T09:00:00.000Z',
  revoked_at: null,
};

describe('DevicesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, THIS_DEVICE);
    getChangesRemaining.mockResolvedValue({ changesRemaining: 3, error: null });
  });

  it('shows both slots and marks the browser you are on', async () => {
    listDevices.mockResolvedValue({ devices: [phone, laptop], error: null });

    render(<DevicesCard />);

    expect(await screen.findByText('Safari on iOS')).toBeInTheDocument();
    expect(screen.getByText('Chrome on Windows')).toBeInTheDocument();
    expect(screen.getByText('Mobile phone')).toBeInTheDocument();
    expect(screen.getByText('Laptop or tablet')).toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();
    expect(screen.getByText('3 changes left')).toBeInTheDocument();
  });

  it('says a slot is free when nothing holds it', async () => {
    listDevices.mockResolvedValue({ devices: [phone], error: null });

    render(<DevicesCard />);

    expect(await screen.findByText(/No device registered/)).toBeInTheDocument();
  });

  it('asks for confirmation before removing, then removes', async () => {
    listDevices.mockResolvedValue({ devices: [phone], error: null });
    revokeDevice.mockResolvedValue({ revoked: true, reason: null, error: null });
    const user = userEvent.setup();

    render(<DevicesCard />);
    await screen.findByText('Safari on iOS');

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(revokeDevice).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(revokeDevice).toHaveBeenCalledWith('row-phone'));
    expect(await screen.findByText(/slot is now free/i)).toBeInTheDocument();
    // The card reloads itself after a removal; let that settle.
    await waitFor(() => expect(listDevices).toHaveBeenCalledTimes(2));
  });

  it('explains the refusal when the change quota is spent', async () => {
    listDevices.mockResolvedValue({ devices: [phone], error: null });
    revokeDevice.mockResolvedValue({ revoked: false, reason: 'change_limit_reached', error: null });
    const user = userEvent.setup();

    render(<DevicesCard />);
    await screen.findByText('Safari on iOS');

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(/used all your device changes/i)).toBeInTheDocument();
    // The device is still there — a refused removal must not look like a success.
    expect(screen.getByText('Safari on iOS')).toBeInTheDocument();
  });
});

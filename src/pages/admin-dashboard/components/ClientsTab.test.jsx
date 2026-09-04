import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The admin's Clients tab, from the outside.
 *
 * Two things are being pinned down here, and they are the two halves of direct
 * client registration on the staff side:
 *
 *   1. The signup panel — the company's own front door. It is OFF by default,
 *      and the difference between switching it off and rotating the code is the
 *      whole reason both controls exist.
 *   2. The acquisition column — whether a client reads as won by an agent or
 *      won directly, which is what a commission conversation runs on.
 *
 * The context is mocked because this file is about the tab, not about the
 * dashboard's modal plumbing. The vocabulary is NOT mocked: a fixture-driven
 * badge would prove the cell renders whatever it is handed and nothing about
 * whether 'agent' actually reaches the screen as "Sales agent".
 */

const openModal = vi.fn();
const closeModal = vi.fn();

vi.mock('../../../contexts/AdminDashboardContext', () => ({
  useAdminDashboardContext: () => ({ modals: {}, openModal, closeModal }),
}));

import ClientsTab from './ClientsTab';

const PROFILE_ON = {
  admin_id: 'admin-1',
  company_name: 'Acme Motors Ltd',
  signup_code: 'K7M2PQR4',
  self_signup_enabled: true,
};
const PROFILE_OFF = { ...PROFILE_ON, self_signup_enabled: false };

// One of each shape the acquisition columns can hold.
const CLIENTS = [
  { id: 'c1', full_name: 'Jane Mwangi', account_number: 'AF-2026-000001', email: 'jane@x.test',
    client_status: 'active', kyc_status: 'verified', outstanding_balance: '0',
    acquisition_channel: 'agent', registration_source: 'agent_portal' },
  { id: 'c2', full_name: 'Peter Otieno', account_number: 'AF-2026-000002', email: 'peter@x.test',
    client_status: 'active', kyc_status: 'verified', outstanding_balance: '0',
    acquisition_channel: 'direct', registration_source: 'staff' },
  { id: 'c3', full_name: 'Grace Wanjiru', account_number: 'AF-2026-000003', email: 'grace@x.test',
    client_status: 'pending', kyc_status: 'unverified', outstanding_balance: '0',
    acquisition_channel: 'direct', registration_source: 'self_service' },
  // An admin-invited client also sits at 'pending'. This is the row that makes
  // a plain status filter the wrong answer.
  { id: 'c4', full_name: 'Samuel Kiptoo', account_number: 'AF-2026-000004', email: 'sam@x.test',
    client_status: 'pending', kyc_status: 'unverified', outstanding_balance: '0',
    acquisition_channel: 'direct', registration_source: 'staff' },
];

const onSetSelfSignup = vi.fn();
const onRotateSignupCode = vi.fn();
const onExport = vi.fn();
const onInvite = vi.fn();

const renderTab = (over = {}) =>
  render(
    <ClientsTab
      clients={CLIENTS}
      agents={[]}
      onInvite={onInvite}
      onExport={onExport}
      companyProfile={PROFILE_ON}
      onSetSelfSignup={onSetSelfSignup}
      onRotateSignupCode={onRotateSignupCode}
      {...over}
    />,
  );

/** The row for one client, so a badge assertion cannot match a different row. */
const rowFor = (name) => screen.getByText(name).closest('tr');

const writeText = vi.fn();

/** Must be called AFTER userEvent.setup(), which installs a clipboard of its own. */
const stubClipboard = () => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText }, configurable: true, writable: true,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the signup panel', () => {
  it('is not rendered at all when the tenant has no company profile', () => {
    // A sacco, or a half-finished registration. There is nothing to switch on,
    // and a panel wired to undefined would throw on the first click.
    renderTab({ companyProfile: null });

    expect(screen.queryByText('Direct client registration')).not.toBeInTheDocument();
  });

  it('shows no code or link while self-signup is switched off', () => {
    // Off is the default for every tenant, including ones that existed before
    // the feature shipped. Showing a live-looking code under an off switch is
    // how somebody hands one out that does not work.
    renderTab({ companyProfile: PROFILE_OFF });

    expect(screen.getByText(/Switched off/)).toBeInTheDocument();
    expect(screen.queryByText('K7M2PQR4')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument();
  });

  it('reports the switch state to assistive tech, not just to the eye', () => {
    const { unmount } = renderTab({ companyProfile: PROFILE_OFF });
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    unmount();

    renderTab();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('asks to turn self-signup on', async () => {
    const user = userEvent.setup();
    renderTab({ companyProfile: PROFILE_OFF });

    await user.click(screen.getByRole('switch'));

    expect(onSetSelfSignup).toHaveBeenCalledWith(true);
  });

  it('asks to turn it off again', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole('switch'));

    expect(onSetSelfSignup).toHaveBeenCalledWith(false);
  });

  it('copies the code and the registration link the client actually opens', async () => {
    const user = userEvent.setup();
    stubClipboard();
    renderTab();

    await user.click(screen.getByRole('button', { name: /copy code/i }));
    expect(writeText).toHaveBeenCalledWith('K7M2PQR4');

    await user.click(screen.getByRole('button', { name: /copy link/i }));
    // The shape the registration page parses its ?code= out of. If this drifts,
    // every card and poster already printed points at a 404.
    expect(writeText).toHaveBeenLastCalledWith(
      expect.stringContaining('/user-registration-screen?code=K7M2PQR4'),
    );
  });

  it('will not rotate the code on a single click', async () => {
    // Rotating invalidates every card, poster and link already handed out.
    // That is the right remedy for a leaked code and the wrong thing to do by
    // brushing against a button.
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole('button', { name: /new code/i }));

    expect(onRotateSignupCode).not.toHaveBeenCalled();
    expect(screen.getByText(/Links and cards\s+already printed with it stop working/)).toBeInTheDocument();
  });

  it('rotates once the warning is confirmed', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole('button', { name: /new code/i }));
    await user.click(screen.getByRole('button', { name: /yes, replace it/i }));

    expect(onRotateSignupCode).toHaveBeenCalledTimes(1);
  });

  it('backs out of a rotation without calling anything', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole('button', { name: /new code/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onRotateSignupCode).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /new code/i })).toBeInTheDocument();
  });

  it('surfaces a failure instead of leaving the switch looking like it worked', async () => {
    // The RPC raises when RLS declines or the tenant has no profile row. A
    // silent failure here is the exact trap the RPCs exist to avoid.
    onSetSelfSignup.mockRejectedValueOnce(new Error('only an administrator may change registration settings'));

    const user = userEvent.setup();
    renderTab({ companyProfile: PROFILE_OFF });

    await user.click(screen.getByRole('switch'));

    expect(await screen.findByText('only an administrator may change registration settings'))
      .toBeInTheDocument();
  });
});

describe('the acquisition column', () => {
  it('separates a client an agent won from one who came directly', () => {
    renderTab();

    expect(within(rowFor('Jane Mwangi')).getByText('Sales agent')).toBeInTheDocument();
    expect(within(rowFor('Peter Otieno')).getByText('Direct')).toBeInTheDocument();
  });

  it('marks a self-registered client apart from a walk-in staff typed in', () => {
    // Both are 'direct'. Only one of them has never been met by anybody, which
    // is the distinction registration_source exists to carry.
    renderTab();

    expect(within(rowFor('Grace Wanjiru')).getByText('Self-registered')).toBeInTheDocument();
    expect(within(rowFor('Peter Otieno')).queryByText('Self-registered')).not.toBeInTheDocument();
  });

  it('carries both facts into the export', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole('button', { name: /export/i }));

    const [rows] = onExport.mock.calls[0];
    expect(rows.find((r) => r.name === 'Jane Mwangi').acquired_via).toBe('Sales agent');
    expect(rows.find((r) => r.name === 'Grace Wanjiru').registered_by).toBe('Self-registered');
  });
});

describe('the self-registered filter', () => {
  it('counts only strangers waiting for activation', () => {
    renderTab();

    // Grace only. Samuel is pending too, but an admin invited him.
    expect(screen.getByText(/1 awaiting activation/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Self-registered (1)' })).toBeInTheDocument();
  });

  it('excludes an admin-invited client who is also pending', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole('button', { name: /^Self-registered/ }));

    expect(screen.getByText('Grace Wanjiru')).toBeInTheDocument();
    expect(screen.queryByText('Samuel Kiptoo')).not.toBeInTheDocument();
    expect(screen.queryByText('Jane Mwangi')).not.toBeInTheDocument();
  });

  it('still lists both of them under the plain pending filter', async () => {
    // The two filters answer different questions and must not collapse into one.
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole('button', { name: 'pending' }));

    expect(screen.getByText('Grace Wanjiru')).toBeInTheDocument();
    expect(screen.getByText('Samuel Kiptoo')).toBeInTheDocument();
  });

  it('says nobody is waiting rather than "no clients found"', async () => {
    const user = userEvent.setup();
    renderTab({ clients: CLIENTS.filter((c) => c.registration_source !== 'self_service') });

    await user.click(screen.getByRole('button', { name: /^Self-registered/ }));

    expect(screen.getByText('Nobody is waiting for activation')).toBeInTheDocument();
  });
});

describe('clients written before the feature existed', () => {
  it('reads a row with no acquisition columns as unrecorded, not as direct', () => {
    // Until the migration runs, every row is missing both columns. Rendering
    // them as "Direct" would be a claim the data does not support.
    renderTab({
      clients: [{ id: 'old', full_name: 'Legacy Client', account_number: 'AF-2019-000001',
        client_status: 'active', kyc_status: 'verified', outstanding_balance: '0' }],
    });

    expect(within(rowFor('Legacy Client')).getByText('Unrecorded')).toBeInTheDocument();
  });
});

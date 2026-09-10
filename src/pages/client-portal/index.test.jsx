import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * What a client sees at the top of their portal.
 *
 * The banners are the whole subject. A self-registered client arrives `pending`
 * — the company has never met them — so their portal is legitimately empty. Left
 * unexplained that reads as a broken system, and the client rings the office.
 * These tests pin down that the explanation appears when it should, does NOT
 * appear when the account is live, and does not crowd out the KYC prompt, which
 * is the one thing they can actually get on with while they wait.
 *
 * MainLayout and the tab bodies are stubbed: both drag in Supabase hooks of
 * their own, and neither is what this file is about.
 */

vi.mock('../../layouts/MainLayout', () => ({
  default: ({ children }) => <div data-testid="layout">{children}</div>,
}));

vi.mock('./components/AccountSummary', () => ({
  default: () => <div data-testid="overview">account summary</div>,
}));

const mockAuth = vi.fn();
const mockPortal = vi.fn();

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockAuth(),
}));

vi.mock('../../contexts/ClientPortalContext', () => ({
  useClientPortalContext: () => mockPortal(),
}));

import ClientPortal from './index';

const portalState = (clientProfile, over = {}) => ({
  clientProfile,
  myAssets: [],
  browseAssets: [],
  payments: [],
  installmentPlans: [],
  enquiries: [],
  loading: false,
  connectionStatus: 'connected',
  refetch: vi.fn(),
  sendEnquiry: vi.fn(),
  initiateMpesaPayment: vi.fn(),
  exportPayments: vi.fn(),
  ...over,
});

const renderPortal = (clientProfile, over) => {
  mockAuth.mockReturnValue({ userProfile: { id: 'u1', role: 'client' } });
  mockPortal.mockReturnValue(portalState(clientProfile, over));
  return render(<MemoryRouter initialEntries={['/client-portal']}><ClientPortal /></MemoryRouter>);
};

const PENDING = { id: 'c1', full_name: 'Grace Wanjiru', client_status: 'pending', kyc_status: 'unverified' };
const ACTIVE  = { id: 'c2', full_name: 'Jane Mwangi',   client_status: 'active',  kyc_status: 'verified' };

const banner = () => screen.queryByText('Account awaiting activation');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the awaiting-activation banner', () => {
  it('explains why a pending account looks empty', () => {
    renderPortal(PENDING);

    expect(banner()).toBeInTheDocument();
    expect(screen.getByText(/with the company for review/)).toBeInTheDocument();
  });

  it('points at KYC, the one thing they can get on with while they wait', () => {
    renderPortal(PENDING);

    expect(screen.getByText(/uploading your KYC documents/i)).toBeInTheDocument();
  });

  it('is gone once the company activates the account', () => {
    renderPortal(ACTIVE);

    expect(banner()).not.toBeInTheDocument();
  });

  it('does not flash while the profile is still loading', () => {
    // clientProfile is null on the first render. A banner that appears and
    // vanishes reads as a glitch.
    renderPortal(null, { loading: true });

    expect(banner()).not.toBeInTheDocument();
  });

  it('stays hidden when there is no client row at all', () => {
    renderPortal(null);

    expect(banner()).not.toBeInTheDocument();
  });
});

describe('the two banners together', () => {
  it('shows activation above KYC, because activation is the blocking one', () => {
    // A self-registered client hits both at once. Order matters: KYC is what
    // they can act on, activation is what they are waiting for, and the thing
    // they cannot change should not be buried under the thing they can.
    renderPortal(PENDING);

    const activation = screen.getByText('Account awaiting activation');
    const kyc = screen.getByText('KYC verification required');

    expect(kyc).toBeInTheDocument();
    // Node.compareDocumentPosition: 4 means `kyc` follows `activation`.
    expect(activation.compareDocumentPosition(kyc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('leaves the KYC prompt alone for an activated client who has not verified', () => {
    renderPortal({ ...ACTIVE, kyc_status: 'unverified' });

    expect(banner()).not.toBeInTheDocument();
    expect(screen.getByText('KYC verification required')).toBeInTheDocument();
  });

  it('shows neither to a live, verified client', () => {
    renderPortal(ACTIVE);

    expect(banner()).not.toBeInTheDocument();
    expect(screen.queryByText('KYC verification required')).not.toBeInTheDocument();
    expect(screen.getByTestId('overview')).toBeInTheDocument();
  });
});

describe('a client suspended rather than pending', () => {
  it('does not tell them their account is awaiting activation', () => {
    // 'suspended' is a different fact with a different remedy. Telling somebody
    // who has been suspended that they are merely awaiting review is worse than
    // saying nothing.
    renderPortal({ ...ACTIVE, client_status: 'suspended' });

    expect(banner()).not.toBeInTheDocument();
  });
});

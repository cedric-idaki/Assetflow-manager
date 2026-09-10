import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The admin CRM shell, from the outside.
 *
 * The hook is mocked so these assertions are about what reaches the screen —
 * but the DERIVATIONS are the real ones (importActual), because a book built by
 * a hand-written fixture would prove the panel renders whatever it is handed
 * and nothing about whether "gone quiet" and "overdue" actually arrive there.
 *
 * CrmOversightTab is stubbed: it is a shipped screen with its own Supabase
 * hook, and this file is about the four views around it.
 */

const mockCrm = vi.fn();

vi.mock('../../hooks/useAdminCrm', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useAdminCrm: (...a) => mockCrm(...a), default: (...a) => mockCrm(...a) };
});

vi.mock('./CrmOversightTab', () => ({
  default: () => <div data-testid="oversight">agent oversight</div>,
}));

import AdminCrmTab from './AdminCrmTab';
import { deriveClientBook, bucketFollowUps, summariseAdminCrm, isTenantOwned } from '../../hooks/useAdminCrm';

const DAY = 86400000;
const at = (days) => new Date(Date.now() + days * DAY).toISOString();

const clients = [
  { id: 'c1', full_name: 'Jane Mwangi', account_number: 'AC-001', phone: '+254712000000',
    client_status: 'active', outstanding_balance: '45000', interaction_count: 2, last_contact_at: at(-60) },
  { id: 'c2', full_name: 'Peter Otieno', account_number: 'AC-002',
    client_status: 'active', outstanding_balance: '0', interaction_count: 1, last_contact_at: at(-2) },
  { id: 'c3', full_name: 'Grace Wanjiru', account_number: 'AC-003',
    client_status: 'active', outstanding_balance: '0', interaction_count: 0, last_contact_at: null },
];

const interactions = [
  { id: 'i1', agent_id: null, client_id: 'c1', contact_name: 'Jane Mwangi', interaction_type: 'call',
    direction: 'outbound', outcome: 'needs_info', occurred_at: at(-60),
    summary: 'Discussed the arrears and a payment plan.', next_step: 'Send the plan by Friday' },
  { id: 'i2', agent_id: 'a1', client_id: 'c2', contact_name: 'Peter Otieno', interaction_type: 'whatsapp',
    direction: 'inbound', outcome: 'interested', occurred_at: at(-2), summary: 'Asked about a second unit.' },
];

const followUps = [
  { id: 'f1', agent_id: null, client_id: 'c1', lead_name: 'Jane Mwangi', appointment_type: 'call',
    scheduled_at: at(-3), is_completed: false, notes: 'Chase the payment plan' },
  { id: 'f2', agent_id: 'a1', client_id: 'c2', lead_name: 'Peter Otieno', appointment_type: 'site_visit',
    scheduled_at: at(2), is_completed: false },
];

const state = (o = {}) => {
  const book = deriveClientBook({ clients, interactions, followUps });
  return {
    canView: true,
    adminId: 'admin-1',
    userId: 'user-1',
    clients,
    book,
    interactions,
    followUps,
    ownFollowUps: followUps.filter(isTenantOwned),
    diary: bucketFollowUps(followUps.filter(isTenantOwned)),
    teamDiary: bucketFollowUps(followUps),
    summary: summariseAdminCrm({ book, interactions, followUps }),
    loading: false,
    saving: false,
    error: null,
    clientName: (row) => clients.find(c => c.id === row?.client_id)?.full_name || '',
    logContact: vi.fn().mockResolvedValue({ data: {} }),
    scheduleFollowUp: vi.fn().mockResolvedValue({ data: {} }),
    updateFollowUp: vi.fn(),
    completeFollowUp: vi.fn().mockResolvedValue({}),
    rescheduleFollowUp: vi.fn().mockResolvedValue({}),
    deleteFollowUp: vi.fn().mockResolvedValue({}),
    updateInteraction: vi.fn(),
    deleteInteraction: vi.fn().mockResolvedValue({}),
    saveClientNote: vi.fn().mockResolvedValue({ data: {} }),
    refetch: vi.fn(),
    ...o,
  };
};

beforeEach(() => {
  mockCrm.mockReset();
  mockCrm.mockReturnValue(state());
});

describe('AdminCrmTab', () => {
  it('opens on the client book with the neglected accounts first', () => {
    render(<AdminCrmTab />);

    const rows = screen.getAllByText(/^(Jane Mwangi|Peter Otieno|Grace Wanjiru)$/);
    // Longest quiet is the default order, and never-contacted outranks late.
    expect(rows[0].textContent).toBe('Grace Wanjiru');
    // Twice over: once as the filter chip, once as the badge on Grace's row.
    expect(screen.getAllByText('Never contacted').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Gone quiet').length).toBeGreaterThan(0);
  });

  it('filters the book down to the customers nobody has ever called', () => {
    render(<AdminCrmTab />);

    // Scoped to the controls card: the row badges carry the same words, so an
    // unscoped query would be choosing between a filter and a label.
    const controls = screen.getByPlaceholderText(/Search by name/).closest('.bg-card');
    fireEvent.click(within(controls).getByRole('button', { name: /Never contacted/ }));

    expect(screen.getByText('Grace Wanjiru')).toBeInTheDocument();
    expect(screen.queryByText('Peter Otieno')).not.toBeInTheDocument();
  });

  it('shows an overdue office appointment in the diary and lets it be closed off', async () => {
    const s = state();
    mockCrm.mockReturnValue(s);
    render(<AdminCrmTab />);

    fireEvent.click(screen.getByRole('button', { name: /Follow-ups/ }));

    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('Chase the payment plan')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Mark done'));
    // The confirm button is the one with the words on it; the icon above it
    // carries the same accessible name from its title.
    fireEvent.click(screen.getByText('Mark done'));

    expect(s.completeFollowUp).toHaveBeenCalledWith('f1', '');
  });

  it('does not offer to edit an agent-owned appointment', () => {
    render(<AdminCrmTab />);
    fireEvent.click(screen.getByRole('button', { name: /Follow-ups/ }));

    // The office diary holds only f1; the agent's f2 is not actionable here.
    expect(screen.getAllByTitle('Mark done')).toHaveLength(1);
    expect(screen.queryByText('Peter Otieno')).not.toBeInTheDocument();
  });

  it('opens a client record showing the whole tenant history, agents included', () => {
    render(<AdminCrmTab />);

    fireEvent.click(screen.getByText('Jane Mwangi'));

    const drawer = screen.getByText('Contact history').closest('div').parentElement;
    expect(within(drawer).getByText(/Discussed the arrears/)).toBeInTheDocument();
    expect(screen.getByText('Send the plan by Friday')).toBeInTheDocument();
    // The standing note is separate from the timeline, and says so.
    expect(screen.getByText(/This overwrites/)).toBeInTheDocument();
  });

  it('logs a contact through the shared form, prefilled with the client', async () => {
    const s = state();
    mockCrm.mockReturnValue(s);
    render(<AdminCrmTab />);

    fireEvent.click(screen.getAllByTitle('Log a contact')[0]);

    expect(screen.getByText('Log a Contact')).toBeInTheDocument();
    // Leads are not offered: an admin's book is clients, not the agents' pipeline.
    expect(screen.queryByText('— Select a lead —')).not.toBeInTheDocument();
    expect(screen.getByText('— or an existing client —')).toBeInTheDocument();
  });

  it('reports coverage as the share of the book actually reached', () => {
    render(<AdminCrmTab />);
    fireEvent.click(screen.getByRole('button', { name: /Reports/ }));

    expect(screen.getByText('Reached this month')).toBeInTheDocument();
    expect(screen.getByText('33%')).toBeInTheDocument();      // 1 of 3 recent
    expect(screen.getByText('Quiet customers who owe money')).toBeInTheDocument();
    expect(screen.getByText('KES 45,000')).toBeInTheDocument();
  });

  it('keeps the agent oversight screen reachable and unchanged', () => {
    render(<AdminCrmTab />);
    fireEvent.click(screen.getByRole('button', { name: /Sales team/ }));
    expect(screen.getByTestId('oversight')).toBeInTheDocument();
  });

  it('marks who logged each contact in the activity record', () => {
    render(<AdminCrmTab />);
    fireEvent.click(screen.getByRole('button', { name: /Activity/ }));

    // The office contact here is two months old, and the log opens on the last
    // 30 days — so widening the window is also the proof that it narrows.
    expect(screen.queryByText('Office')).not.toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('Last 30 days'), { target: { value: 'all' } });

    expect(screen.getByText('Office')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
    // Only the office's own row can be removed.
    expect(screen.getAllByTitle('Remove this entry')).toHaveLength(1);
  });

  it('tells a role without CRM rights why the screen is empty', () => {
    mockCrm.mockReturnValue(state({ canView: false }));
    render(<AdminCrmTab />);
    expect(screen.getByText(/not available for your role/)).toBeInTheDocument();
  });

  it('surfaces a load failure without hiding the rest of the screen', () => {
    mockCrm.mockReturnValue(state({ error: 'Some CRM records could not be loaded: boom' }));
    render(<AdminCrmTab />);
    expect(screen.getByText(/could not be loaded: boom/)).toBeInTheDocument();
    expect(screen.getByText('Jane Mwangi')).toBeInTheDocument();
  });
});

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The super administrator's CRM shell, from the outside.
 *
 * Both hooks are mocked so these assertions are about what reaches the screen —
 * but the DERIVATIONS are the real ones (importActual), because a pipeline built
 * from a hand-written summary would prove the panel renders whatever it is
 * handed and nothing about whether "never contacted" and the weighted forecast
 * actually arrive there.
 *
 * CrmOversightTab is stubbed: it is a shipped screen with its own Supabase hook,
 * and this file is about the six views around it.
 */

const mockCrm  = vi.fn();
const mockPipe = vi.fn();

vi.mock('../../hooks/useAdminCrm', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useAdminCrm: (...a) => mockCrm(...a), default: (...a) => mockCrm(...a) };
});

vi.mock('../../hooks/useSupervisorLeads', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useSupervisorLeads: (...a) => mockPipe(...a), default: (...a) => mockPipe(...a) };
});

vi.mock('./CrmOversightTab', () => ({
  default: () => <div data-testid="oversight">agent oversight</div>,
}));

import SuperAdminCrmTab from './SuperAdminCrmTab';
import { deriveClientBook, bucketFollowUps, summariseAdminCrm, isTenantOwned } from '../../hooks/useAdminCrm';
import { groupByStage, summariseLeadBook } from '../../hooks/useSupervisorLeads';

const DAY = 86400000;
const at = (days) => new Date(Date.now() + days * DAY).toISOString();

const clients = [
  { id: 'c1', full_name: 'Jane Mwangi', account_number: 'AC-001', client_status: 'active',
    outstanding_balance: '0', interaction_count: 1, last_contact_at: at(-2) },
];

const interactions = [
  { id: 'i1', agent_id: null, client_id: 'c1', contact_name: 'Jane Mwangi', interaction_type: 'call',
    direction: 'outbound', outcome: 'interested', occurred_at: at(-2), summary: 'Talked about renewal.' },
];

const followUps = [
  { id: 'f1', agent_id: null, client_id: 'c1', lead_name: 'Jane Mwangi', appointment_type: 'call',
    scheduled_at: at(-3), is_completed: false, notes: 'Chase the renewal' },
];

// One priced opportunity, one prospect nobody has touched. Both are needed:
// the first makes the forecast a number and the second makes the nag appear.
const leads = [
  { id: 'l1', agent_id: null, full_name: 'Kilimo Sacco', phone: '0722111222', stage: 'proposal_sent',
    priority: 'high', deal_value: 2000000, win_probability: null, converted_at: null,
    interaction_count: 4, last_contact_at: at(-1), created_at: at(-20) },
  { id: 'l2', agent_id: null, full_name: 'Tumaini Holdings', phone: '0733444555', stage: 'new_lead',
    priority: 'medium', deal_value: null, converted_at: null,
    interaction_count: 0, last_contact_at: null, created_at: at(-5) },
];

const crmState = (o = {}) => {
  const book = deriveClientBook({ clients, interactions, followUps });
  return {
    canView: true,
    adminId: 'super-1',
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

const pipeState = (o = {}) => ({
  canView: true,
  adminId: 'super-1',
  leads,
  board: groupByStage(leads),
  summary: summariseLeadBook(leads),
  opportunity: {},
  pickable: leads.map(l => ({ id: l.id, full_name: l.full_name, phone: l.phone })),
  leadName: (row) => leads.find(l => l.id === row?.lead_id)?.full_name || '',
  loading: false,
  saving: false,
  error: null,
  createLead: vi.fn().mockResolvedValue({ data: {} }),
  updateLead: vi.fn().mockResolvedValue({ data: {} }),
  moveLeadStage: vi.fn().mockResolvedValue({ data: {} }),
  recordLostReason: vi.fn().mockResolvedValue({ data: {} }),
  saveDeal: vi.fn().mockResolvedValue({ data: {} }),
  deleteLead: vi.fn().mockResolvedValue({}),
  refetch: vi.fn(),
  ...o,
});

beforeEach(() => {
  mockCrm.mockReset();
  mockPipe.mockReset();
  mockCrm.mockReturnValue(crmState());
  mockPipe.mockReturnValue(pipeState());
});

describe('SuperAdminCrmTab', () => {
  it('opens on the super administrator own pipeline, not on agent oversight', () => {
    render(<SuperAdminCrmTab />);

    expect(screen.getByText('Kilimo Sacco')).toBeInTheDocument();
    expect(screen.getByText('Tumaini Holdings')).toBeInTheDocument();
    expect(screen.queryByTestId('oversight')).not.toBeInTheDocument();
  });

  it('offers every view a CRM is asked for', () => {
    render(<SuperAdminCrmTab />);

    for (const label of ['Pipeline', 'Opportunities', 'Clients', 'Follow-ups', 'Activity', 'Reports', 'Sales team']) {
      expect(screen.getByRole('button', { name: new RegExp(label, 'i') })).toBeInTheDocument();
    }
  });

  it('puts the pipeline value and the weighted forecast on the pipeline header', () => {
    render(<SuperAdminCrmTab />);

    // 2M stated at proposal_sent (60%) = 1.2M weighted. Scoped to the tiles
    // because the board's stage column prints its own total in the same format.
    const tile = (label) => screen.getByText(label).closest('.bg-card');

    expect(within(tile('Pipeline value')).getByText('KES 2.0M')).toBeInTheDocument();
    expect(within(tile('Weighted forecast')).getByText('KES 1.2M')).toBeInTheDocument();
  });

  it('flags the prospect nobody has contacted', () => {
    render(<SuperAdminCrmTab />);
    expect(screen.getByText(/1 never contacted/i)).toBeInTheDocument();
  });

  it('keeps agent oversight read-only and one click away', () => {
    render(<SuperAdminCrmTab />);
    fireEvent.click(screen.getByRole('button', { name: /Sales team/i }));

    expect(screen.getByTestId('oversight')).toBeInTheDocument();
    expect(screen.queryByText('Kilimo Sacco')).not.toBeInTheDocument();
  });

  /** The drop zone under a stage column header. */
  const dropZone = (stageLabel) =>
    screen.getByText(stageLabel).closest('div.flex.flex-col').children[1];

  const dropLead = (leadId, stageLabel) => fireEvent.drop(dropZone(stageLabel), {
    dataTransfer: { getData: () => leadId },
  });

  it('asks why a deal died before closing it, rather than closing silently', async () => {
    const pipe = pipeState();
    mockPipe.mockReturnValue(pipe);
    render(<SuperAdminCrmTab />);

    dropLead('l1', 'Closed');

    // The prompt comes first and nothing is written until it is answered: asked
    // at the moment of closing the reason is known, asked later it is a guess.
    expect(await screen.findByText(/Closing without a sale/i)).toBeInTheDocument();
    expect(screen.getByText(/Kilimo Sacco — what happened\?/i)).toBeInTheDocument();
    expect(pipe.moveLeadStage).not.toHaveBeenCalled();
  });

  it('closes the deal once the reason is given', async () => {
    const pipe = pipeState();
    mockPipe.mockReturnValue(pipe);
    render(<SuperAdminCrmTab />);

    dropLead('l1', 'Closed');
    fireEvent.click(await screen.findByRole('button', { name: /Price/i }));
    fireEvent.click(screen.getByRole('button', { name: /Close lead/i }));

    await screen.findByText('Kilimo Sacco');
    expect(pipe.moveLeadStage).toHaveBeenCalledWith('l1', 'closed', { reason: 'price', notes: '' });
  });

  it('lets a close go through with the reason skipped', async () => {
    const pipe = pipeState();
    mockPipe.mockReturnValue(pipe);
    render(<SuperAdminCrmTab />);

    dropLead('l1', 'Closed');
    fireEvent.click(await screen.findByRole('button', { name: /Skip & close/i }));

    // Skippable on purpose: closing forty stale prospects must not be held up
    // by a form, and the reason can still be added from the record afterwards.
    await screen.findByText('Kilimo Sacco');
    expect(pipe.moveLeadStage).toHaveBeenCalledWith('l1', 'closed', null);
  });

  it('moves a deal between open stages without stopping to ask anything', async () => {
    const pipe = pipeState();
    mockPipe.mockReturnValue(pipe);
    render(<SuperAdminCrmTab />);

    dropLead('l2', 'Qualified');

    expect(pipe.moveLeadStage).toHaveBeenCalledWith('l2', 'qualified');
  });

  it('shows the customer book on the clients view', () => {
    render(<SuperAdminCrmTab />);
    fireEvent.click(screen.getByRole('button', { name: /Clients/i }));

    expect(screen.getByText('Jane Mwangi')).toBeInTheDocument();
  });

  // Every view is switched into at least once, because a panel that throws on
  // mount is invisible until somebody clicks its tab — and six of these seven
  // are panels this component only composes rather than owns.
  it.each([
    ['Opportunities', /pipeline/i],
    ['Activity',      /Talked about renewal/i],
    ['Reports',       /Clients/i],
  ])('renders the %s view without falling over', (label, expected) => {
    render(<SuperAdminCrmTab />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }));

    expect(screen.getAllByText(expected).length).toBeGreaterThan(0);
  });

  it('prices a deal from the opportunities view', async () => {
    const pipe = pipeState();
    mockPipe.mockReturnValue(pipe);
    render(<SuperAdminCrmTab />);
    fireEvent.click(screen.getByRole('button', { name: /^Opportunities$/i }));

    // The unpriced prospect is the one this panel exists to get a figure onto.
    fireEvent.click(screen.getByRole('button', { name: /Set value/i }));
    // By placeholder: the panel's labels are not wired to their inputs.
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '450000' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await screen.findByRole('button', { name: /^Opportunities$/i });
    // Parsed, not the raw input string — the panel does the conversion.
    expect(pipe.saveDeal).toHaveBeenCalledWith('l2', expect.objectContaining({ dealValue: 450000 }));
  });

  it('names a follow-up booked against a lead, not just against a client', () => {
    const crm = crmState({
      diary: bucketFollowUps([
        { id: 'f2', agent_id: null, lead_id: 'l1', appointment_type: 'call',
          scheduled_at: at(-1), is_completed: false },
      ]),
    });
    mockCrm.mockReturnValue(crm);
    render(<SuperAdminCrmTab />);
    fireEvent.click(screen.getByRole('button', { name: /Follow-ups/i }));

    expect(screen.getByText('Kilimo Sacco')).toBeInTheDocument();
  });

  it('surfaces a pipeline load failure without blanking the rest of the CRM', () => {
    mockPipe.mockReturnValue(pipeState({ error: 'permission denied for table leads' }));
    render(<SuperAdminCrmTab />);

    expect(screen.getByText(/permission denied for table leads/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });

  it('refuses the whole tab for a role that has no CRM', () => {
    mockCrm.mockReturnValue(crmState({ canView: false }));
    render(<SuperAdminCrmTab />);

    expect(screen.getByText(/not available for your role/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pipeline/i })).not.toBeInTheDocument();
  });

  it('offers an empty pipeline a way to start rather than a blank panel', () => {
    mockPipe.mockReturnValue(pipeState({ leads: [], board: groupByStage([]), summary: summariseLeadBook([]) }));
    render(<SuperAdminCrmTab />);

    expect(screen.getByText(/No leads of your own yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add your first lead/i })).toBeInTheDocument();
  });

  it('opens the lead form from the empty state', () => {
    mockPipe.mockReturnValue(pipeState({ leads: [], board: groupByStage([]), summary: summariseLeadBook([]) }));
    render(<SuperAdminCrmTab />);

    fireEvent.click(screen.getByRole('button', { name: /Add your first lead/i }));
    expect(screen.getByText(/Register New Lead/i)).toBeInTheDocument();
  });

  it('switches the pipeline to the worklist and puts the untouched deal first', () => {
    render(<SuperAdminCrmTab />);
    fireEvent.click(screen.getByRole('button', { name: /^list$/i }));

    const table = screen.getByRole('table');
    const names = within(table).getAllByText(/Kilimo Sacco|Tumaini Holdings/);
    // Never contacted outranks contacted yesterday — the list is a worklist.
    expect(names[0]).toHaveTextContent('Tumaini Holdings');
  });
});

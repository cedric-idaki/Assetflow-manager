import React from 'react';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The org-chart screen, from the outside.
 *
 * The Supabase hook is mocked — but the DERIVATIONS are the real ones
 * (buildOrgChart and summariseTeam, imported for real), because a chart built
 * by a hand-written fixture would only prove that the panel renders whatever it
 * is handed, and nothing about whether an unassigned agent actually reaches the
 * screen.
 *
 * The three things asserted here are the three that would be quiet, costly bugs
 * rather than obvious ones:
 *
 *   1. An agent with no manager is SURFACED, not filtered out. Their work rolls
 *      up to nobody, and a chart that hides them looks complete when it is not.
 *   2. A non-administrator sees no controls. The database refuses their writes
 *      either way, so this is about not offering an action that always fails.
 *   3. Unassigning asks first, and says what it costs. It ends a manager's
 *      sight of a book, which is not obvious from a button labelled "Unassign".
 */

const mockHierarchy = vi.fn();

vi.mock('../../hooks/useSalesHierarchy', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useSalesHierarchy: (...a) => mockHierarchy(...a),
    default: (...a) => mockHierarchy(...a),
  };
});

import SalesTeamPanel from './SalesTeamPanel';
import { buildOrgChart, summariseTeam } from '../../config/salesHierarchy';

const TENANT = 'tenant-a';

const M1 = {
  id: 'm1', full_name: 'Grace Mwangi', agent_code: 'AGT-M1', agent_role: 'manager',
  admin_id: TENANT, agent_status: 'active', region: 'Nairobi', total_sales: 0,
};
const A1 = {
  id: 'a1', full_name: 'Jane Wanjiru', agent_code: 'AGT-A1', agent_role: 'agent',
  admin_id: TENANT, agent_status: 'active', region: 'Nairobi',
  manager_id: 'm1', total_sales: 400000,
};
const A2 = {
  id: 'a2', full_name: 'Peter Kimani', agent_code: 'AGT-A2', agent_role: 'agent',
  admin_id: TENANT, agent_status: 'active', region: 'Mombasa',
  manager_id: null, total_sales: 90000,
};

const LINK = {
  id: 'link-1', agent_id: 'a1', manager_id: 'm1', admin_id: TENANT,
  is_primary: true, is_active: true, assigned_at: '2026-09-01T08:00:00.000Z',
};

const STATS = [{
  manager_id: 'm1', agent_id: 'a1', agent_code: 'AGT-A1', full_name: 'Jane Wanjiru',
  agent_status: 'active', is_primary: true, assignment_id: 'link-1',
  assigned_at: '2026-09-01T08:00:00.000Z',
  leads_total: 10, leads_open: 4, leads_won: 5, leads_lost: 1,
  pipeline_value: 300000, clients_total: 3,
  sales_total: 400000, commission_total: 20000, target_amount: 500000,
}];

const setLinkActive = vi.fn(() => Promise.resolve({}));
const setAgentRole  = vi.fn(() => Promise.resolve({}));
const assignManager = vi.fn(() => Promise.resolve({}));

const state = (o = {}) => {
  const agents = o.agents || [M1, A1, A2];
  const liveLinks = o.liveLinks || [LINK];
  const stats = o.teamStats || STATS;
  const byManager = new Map();
  for (const r of stats) {
    if (!byManager.has(r.manager_id)) byManager.set(r.manager_id, []);
    byManager.get(r.manager_id).push(r);
  }
  const statsFor = (id) => (id ? (byManager.get(id) || []) : stats);

  return {
    canManage: true,
    adminId: TENANT,
    agents,
    managers: agents.filter(a => a.agent_role === 'manager'),
    fieldAgents: agents.filter(a => a.agent_role !== 'manager'),
    assignments: liveLinks,
    liveLinks,
    history: [],
    orgChart: buildOrgChart(agents, liveLinks),
    teamStats: stats,
    loading: false,
    saving: false,
    error: null,
    assignManager,
    setLinkActive,
    setAgentRole,
    statsFor,
    summaryFor: (id) => summariseTeam(statsFor(id)),
    teamSizeOf: (id) => liveLinks.filter(l => l.manager_id === id && l.is_primary).length,
    managersForAgent: () => [],
    historyForAgent: () => [],
    primaryManagerOf: (agent) => agents.find(a => a.id === agent?.manager_id) || null,
    refetch: vi.fn(),
    ...o,
  };
};

describe('SalesTeamPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHierarchy.mockReturnValue(state());
  });

  it('shows each manager with their team and the team roll-up', () => {
    render(<SalesTeamPanel onExport={vi.fn()} />);

    expect(screen.getByText('Grace Mwangi')).toBeInTheDocument();
    expect(screen.getByText('Jane Wanjiru')).toBeInTheDocument();

    // The roll-up comes from summariseTeam over the stat rows, not from the
    // agents array — 400,000 sold against a 500,000 target is 80%. It appears
    // twice on purpose: once for the team, once for the floor, which with a
    // single team are the same number.
    expect(screen.getAllByText('80%')).toHaveLength(2);
    expect(screen.getByText('KES 300,000')).toBeInTheDocument();   // team pipeline
  });

  it('surfaces the agents nobody manages rather than hiding them', () => {
    render(<SalesTeamPanel onExport={vi.fn()} />);

    const unassigned = screen.getByText('Agents without a manager').closest('.bg-card');
    expect(within(unassigned).getByText('Peter Kimani')).toBeInTheDocument();
    expect(within(unassigned).getByRole('button', { name: /assign manager/i })).toBeInTheDocument();

    // Jane is on a team, so she must NOT also be listed here.
    expect(within(unassigned).queryByText('Jane Wanjiru')).not.toBeInTheDocument();
  });

  it('says so plainly when there is no manager to assign anyone to', () => {
    mockHierarchy.mockReturnValue(state({ agents: [A2], liveLinks: [], teamStats: [] }));
    render(<SalesTeamPanel onExport={vi.fn()} />);

    expect(screen.getByText('No sales managers yet')).toBeInTheDocument();
  });

  it('offers no controls to somebody who cannot use them', () => {
    // The database refuses their writes anyway; the point is not to render a
    // button whose only outcome is an error.
    mockHierarchy.mockReturnValue(state({ canManage: false }));
    render(<SalesTeamPanel onExport={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /assign manager/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new sales manager/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /step down/i })).not.toBeInTheDocument();
    // …but the chart itself is still readable.
    expect(screen.getByText('Grace Mwangi')).toBeInTheDocument();
  });

  it('asks before unassigning, and says what the manager loses', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SalesTeamPanel onExport={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /^unassign$/i }));

    expect(confirm).toHaveBeenCalledTimes(1);
    const question = confirm.mock.calls[0][0];
    expect(question).toMatch(/Jane Wanjiru/);
    expect(question).toMatch(/report to nobody/i);
    expect(question).toMatch(/lose sight of their pipeline/i);
    // Declined, so nothing was written.
    expect(setLinkActive).not.toHaveBeenCalled();

    confirm.mockRestore();
  });

  it('unassigns once the question is answered', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SalesTeamPanel onExport={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^unassign$/i }));
    });

    expect(setLinkActive).toHaveBeenCalledWith('link-1', false, expect.any(String));
    confirm.mockRestore();
  });

  it('warns how many agents a demotion would leave unassigned', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SalesTeamPanel onExport={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /step down/i }));

    const question = confirm.mock.calls[0][0];
    expect(question).toMatch(/1 agent currently reports to them/i);
    expect(question).toMatch(/left unassigned/i);
    expect(setAgentRole).not.toHaveBeenCalled();

    confirm.mockRestore();
  });

  it('marks an authorised second manager as shared rather than counting it as headcount', () => {
    const shared = { ...LINK, id: 'link-2', agent_id: 'a2', manager_id: 'm1', is_primary: false,
                     authorized_by: 'admin-1', authorization_note: 'Coast cover for Q4' };
    mockHierarchy.mockReturnValue(state({ liveLinks: [LINK, shared] }));
    render(<SalesTeamPanel onExport={vi.fn()} />);

    expect(screen.getByText('Shared')).toBeInTheDocument();
    // One agent on the team, one shared — the header must not read "2 agents".
    expect(screen.getByText(/1 agent · 1 shared/)).toBeInTheDocument();
  });
});

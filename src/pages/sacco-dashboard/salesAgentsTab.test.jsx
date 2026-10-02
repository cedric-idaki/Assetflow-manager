import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The sacco dashboard's Sales Agents tab is the company admin's register,
// reused. These pin the two things that make it the SACCO's: the tab is on the
// sacco dashboard, and creating an agent goes through the same tenant-scoped
// createAgent the company admin uses (create-staff-user derives the tenant from
// the caller's session, so the agent lands in this sacco).

const shared = vi.hoisted(() => ({
  agents: [],
  salesAnalytics: [],
  createAgent: null,
  exportCSV: null,
  loading: false,
}));

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: { id: 'sacco-admin-1' } } }) } },
}));

vi.mock('../../layouts/MainLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'sacco-admin-1' }, userProfile: { full_name: 'Grace Admin', role: 'sacco_admin' } }),
}));

vi.mock('../../contexts/SaccoDashboardContext', () => ({
  useSaccoDashboardContext: () => ({
    sacco: { id: 's1', name: 'Umoja Sacco' },
    stats: { tier: { name: 'Starter' }, totalMembers: 12 },
    loading: false,
    connectionStatus: 'connected',
    refetch: () => {},
  }),
}));

// Real modal state, per caller: AgentsTab opens and reads its own create modal.
vi.mock('../../contexts/AdminDashboardContext', async () => {
  const { useState } = await import('react');
  return {
    useAdminDashboardContext: () => {
      const [modals, setModals] = useState({ createAgent: false });
      return {
        ...shared,
        modals,
        openModal:  (name) => setModals(m => ({ ...m, [name]: true })),
        closeModal: (name) => setModals(m => ({ ...m, [name]: false })),
      };
    },
  };
});

// The org chart reads the hierarchy RPCs; its own behaviour is not under test.
vi.mock('../../components/sales/SalesTeamPanel', () => ({
  default: () => <div>team structure panel</div>,
}));

const { default: SaccoDashboard } = await import('./index');

const renderAt = (tab) => render(
  <MemoryRouter initialEntries={[`/sacco-dashboard?tab=${tab}`]}>
    <SaccoDashboard />
  </MemoryRouter>,
);

beforeEach(() => {
  shared.agents = [{
    id: 'a1', full_name: 'Peter Otieno', email: 'peter@umoja.co.ke',
    agent_code: 'AGT-1', region: 'Kisumu', commission_rate: 5,
    total_sales: 0, total_commission: 0, target_amount: 100000,
    agent_status: 'active', agent_role: 'agent', manager_id: null,
  }];
  shared.salesAnalytics = [];
  shared.createAgent = vi.fn(async () => ({ id: 'a2' }));
  shared.exportCSV = vi.fn();
  shared.loading = false;
});

describe('sacco dashboard — sales agent register', () => {
  it('offers a Sales Agents tab in the dashboard tab bar', () => {
    renderAt('agents');
    expect(screen.getByRole('button', { name: /sales agents/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^members$/i })).toBeInTheDocument();
  });

  it("lists the sacco's agents in sacco wording", () => {
    renderAt('agents');
    expect(screen.getByText('Peter Otieno')).toBeInTheDocument();
    expect(screen.getByText('1 agent under your sacco')).toBeInTheDocument();
  });

  it('creates an agent through the shared tenant-scoped createAgent', async () => {
    renderAt('agents');
    fireEvent.click(screen.getByRole('button', { name: /new agent/i }));
    expect(screen.getByText('Agent will work under your sacco')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Jane Wanjiru'), { target: { value: 'Mary Achieng' } });
    fireEvent.change(screen.getByPlaceholderText('jane@example.com'), { target: { value: 'mary@umoja.co.ke' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'Str0ng!Pass' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. 500000'), { target: { value: '250000' } });
    fireEvent.click(screen.getByRole('button', { name: /create agent/i }));

    await waitFor(() => expect(shared.createAgent).toHaveBeenCalledTimes(1));
    expect(shared.createAgent).toHaveBeenCalledWith(expect.objectContaining({
      fullName: 'Mary Achieng', email: 'mary@umoja.co.ke', targetAmount: 250000,
    }));
  });

  it('shows the team structure view on the same tab', () => {
    renderAt('agents');
    fireEvent.click(screen.getByRole('button', { name: /team structure/i }));
    expect(screen.getByText('team structure panel')).toBeInTheDocument();
  });

  it('waits for the agent register to load instead of showing an empty one', () => {
    shared.loading = true;
    shared.agents = [];
    renderAt('agents');
    expect(screen.queryByText(/no sales agents yet/i)).not.toBeInTheDocument();
  });
});

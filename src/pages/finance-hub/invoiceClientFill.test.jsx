/**
 * New Invoice: choosing a client fills the lines from what is linked to them
 * (assets and active service engagements), and the Service picker fills a line
 * the way the Asset picker does. Driven through the real page with the hub's
 * data mocked at the context.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn(), auth: { getSession: vi.fn(), getUser: vi.fn() }, rpc: vi.fn() },
  getCurrentUser: vi.fn(),
  invokeSupabaseFunction: vi.fn(),
}));
vi.mock('../../layouts/MainLayout', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'admin-1' }, userProfile: { role: 'admin' }, getRoleRedirectPath: () => '/' }),
}));

const hub = vi.hoisted(() => ({ value: null }));
vi.mock('../../contexts/FinanceHubContext', () => ({ useFinanceHubContext: () => hub.value }));

const { default: FinanceHubRoute } = await import('./index');

const clients = [
  { id: 'c1', full_name: 'Acme Ltd', email: 'acme@example.com', account_number: 'ACC-1' },
  { id: 'c2', full_name: 'Beta Co', email: 'beta@example.com', account_number: 'ACC-2' },
];
const truck = { id: 'a1', description: 'Isuzu FRR', asset_code: 'AST-7', plate_number: 'KDA 123X', selling_price: 4500000, linked_client_id: 'c1' };
const retainer = {
  id: 'e1', pricing_model: 'retainer', amount: 50000, billing_period: 'monthly', status: 'active',
  service: { name: 'Tax Advisory' }, cost_structure: { label: 'Monthly retainer' },
};
const linkedTo = {
  c1: { assets: [truck], engagements: [retainer] },
  c2: { assets: [], engagements: [] },
};

const serviceCatalogue = [{
  id: 's1', name: 'Bookkeeping', is_active: true,
  consultancy_cost_structures: [{ id: 'cs1', pricing_model: 'hourly', amount: 3000, label: 'Per hour', sort_order: 0 }],
}];

beforeEach(() => {
  hub.value = {
    invoices: [], journalEntries: [], automatedEntries: [], chartOfAccounts: [],
    payrollRecords: [], employees: [], clients, assets: [truck], serviceCatalogue,
    financialSummary: { pendingInvoices: 0, overdueInvoices: 0 },
    companyProfile: { company_name: 'Test Co' }, loading: false, error: null,
    createInvoice: vi.fn(), updateInvoiceStatus: vi.fn(), deleteInvoice: vi.fn(),
    refetch: vi.fn(), refreshClients: vi.fn(), TRIGGER_LABELS: {},
    refreshServiceCatalogue: vi.fn(async () => {}),
    fetchClientBillables: vi.fn(async (id) => linkedTo[id]),
  };
});

const openForm = () => {
  render(
    <MemoryRouter initialEntries={['/finance-hub?tab=invoices']}>
      <FinanceHubRoute />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: /New Invoice/ }));
};

const lineDescriptions = () =>
  screen.getAllByPlaceholderText('Description of goods or service').map(i => i.value);

const selectByLabel = (label) => {
  let el = screen.getByText(label);
  while (el && !el.querySelector('select')) el = el.parentElement;
  return el.querySelector('select');
};

describe('New Invoice — filled from the client', () => {
  it('fills a line for the client\'s linked asset and active service when the client is chosen', async () => {
    openForm();
    expect(hub.value.refreshServiceCatalogue).toHaveBeenCalled();

    fireEvent.change(selectByLabel('Client *'), { target: { value: 'c1' } });

    await waitFor(() => expect(lineDescriptions()).toEqual([
      'Isuzu FRR (AST-7 · KDA 123X)',
      'Tax Advisory — Monthly retainer (KES 50,000 per month)',
    ]));
    expect(hub.value.fetchClientBillables).toHaveBeenCalledWith('c1');
    expect(screen.getByText(/1 asset and 1 active service/)).toBeTruthy();
    // The client's one linked asset is chosen in the Asset picker too.
    expect(selectByLabel('Asset (optional — fills a line)').value).toBe('a1');
  });

  it('swaps the lines when another client is chosen, keeping what the user typed', async () => {
    openForm();
    fireEvent.change(selectByLabel('Client *'), { target: { value: 'c1' } });
    await waitFor(() => expect(lineDescriptions()).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: /Add line/ }));
    const inputs = screen.getAllByPlaceholderText('Description of goods or service');
    fireEvent.change(inputs[2], { target: { value: 'Delivery' } });

    fireEvent.change(selectByLabel('Client *'), { target: { value: 'c2' } });
    await waitFor(() => expect(lineDescriptions()).toEqual(['Delivery']));
    expect(selectByLabel('Asset (optional — fills a line)').value).toBe('');
    expect(screen.getByText(/Nothing is linked to this client yet/)).toBeTruthy();
  });

  it('offers the client\'s agreed services ahead of the catalogue, and fills a line from either', async () => {
    openForm();
    fireEvent.change(selectByLabel('Client *'), { target: { value: 'c2' } });
    await waitFor(() => expect(screen.getByText(/Nothing is linked/)).toBeTruthy());

    const service = selectByLabel('Service (optional — fills a line)');
    expect(within(service).queryByRole('group', { name: /Agreed with/ })).toBeNull();
    fireEvent.change(service, { target: { value: 'svc:s1:cs1' } });
    expect(lineDescriptions()).toEqual(['Bookkeeping — Per hour (KES 3,000 per hour)']);
    expect(screen.getAllByPlaceholderText('Unit price')[0].value).toBe('3000');

    fireEvent.change(selectByLabel('Client *'), { target: { value: 'c1' } });
    await waitFor(() => expect(within(service).getByRole('group', { name: 'Agreed with Acme Ltd' })).toBeTruthy());
    // The picked catalogue line is the user's own, so it stays ahead of the filled ones.
    expect(lineDescriptions()[0]).toBe('Bookkeeping — Per hour (KES 3,000 per hour)');
  });
});

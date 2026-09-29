import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import ServicesTab from './ServicesTab';

const SERVICES = [
  { id: 'svc-tax',   name: 'Tax Advisory',   service_code: 'SVC-00001', category: 'Tax', description: 'Returns and planning', is_active: true },
  { id: 'svc-plan',  name: 'Business Plans', service_code: 'SVC-00002', category: 'Strategy', description: null, is_active: true },
  { id: 'svc-old',   name: 'Payroll Bureau', service_code: 'SVC-00003', category: null, description: null, is_active: false },
];
const OPTIONS = [
  { id: 'opt-h', service_id: 'svc-tax', pricing_model: 'hourly', amount: '5000.00', is_default: true },
  { id: 'opt-r', service_id: 'svc-tax', pricing_model: 'retainer', amount: '30000.00', billing_period: 'monthly', label: 'Gold', is_default: false },
];
const client = (id, name) => ({ id, full_name: name, account_number: `ACC-${id}` });
const ENGAGEMENTS = [
  // On the list price.
  { id: 'e1', service_id: 'svc-tax', client_id: 'c1', cost_structure_id: 'opt-h', status: 'active',
    pricing_model: 'hourly', amount: '5000.00', start_date: '2026-09-01', client: client('c1', 'Wanjiru Holdings') },
  // Came from the retainer, then negotiated down.
  { id: 'e2', service_id: 'svc-tax', client_id: 'c2', cost_structure_id: 'opt-r', status: 'proposed',
    pricing_model: 'retainer', amount: '25000.00', billing_period: 'monthly', client: client('c2', 'Otieno Traders') },
  // Never on the price list.
  { id: 'e3', service_id: 'svc-old', client_id: 'c3', cost_structure_id: null, status: 'completed',
    pricing_model: 'fixed_fee', amount: '90000.00', client: client('c3', 'Kamau & Sons') },
];

const group = (rows, key) => rows.reduce((acc, r) => { (acc[r[key]] = acc[r[key]] || []).push(r); return acc; }, {});

const consultancy = (over = {}) => ({
  services: SERVICES,
  costStructures: OPTIONS,
  engagements: ENGAGEMENTS,
  optionsByService: group(OPTIONS, 'service_id'),
  engagementsByService: group(ENGAGEMENTS, 'service_id'),
  categories: ['Strategy', 'Tax'],
  summary: { activeServices: 2, retiredServices: 1, priceOptions: 2, currentMappings: 2, clientsServed: 2 },
  loading: false,
  error: null,
  saveService: vi.fn(),
  setServiceActive: vi.fn().mockResolvedValue(undefined),
  deleteService: vi.fn().mockResolvedValue(undefined),
  saveEngagement: vi.fn(),
  deleteEngagement: vi.fn(),
  ...over,
});

const choose = (fieldName, optionLabel) => {
  fireEvent.click(screen.getByRole('button', { name: fieldName }));
  fireEvent.click(screen.getAllByText(optionLabel).find(el => el.tagName !== 'OPTION'));
};

describe('ServicesTab — the catalogue', () => {
  it('lists offered services with their price options and current clients', () => {
    render(<ServicesTab consultancy={consultancy()} clients={[]} />);
    const cards = screen.getAllByTestId('service-card');
    expect(cards).toHaveLength(2);                           // the retired one is hidden by default

    const tax = cards.find(c => within(c).queryByText('Tax Advisory'));
    expect(within(tax).getByText('KES 5,000 per hour')).toBeInTheDocument();
    expect(within(tax).getByText('KES 30,000 per month')).toBeInTheDocument();
    expect(within(tax).getByText('Clients (2)')).toBeInTheDocument();
    expect(within(tax).getByText('Wanjiru Holdings')).toBeInTheDocument();
    // A service clients are on can be retired, never deleted.
    expect(within(tax).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();

    const plans = cards.find(c => within(c).queryByText('Business Plans'));
    expect(within(plans).getByText('No price set — priced per client when mapped')).toBeInTheDocument();
    expect(within(plans).getByRole('button', { name: 'Delete Business Plans' })).toBeInTheDocument();
  });

  it('shows retired services on request', () => {
    render(<ServicesTab consultancy={consultancy()} clients={[]} />);
    choose(/^Offered$/, 'All services');
    const cards = screen.getAllByTestId('service-card');
    expect(cards).toHaveLength(3);
    const old = cards.find(c => within(c).queryByText('Payroll Bureau'));
    expect(within(old).getByText('Retired')).toBeInTheDocument();
    expect(within(old).queryByRole('button', { name: /Map client/ })).not.toBeInTheDocument();
    expect(within(old).getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('searches by name, code and category', () => {
    render(<ServicesTab consultancy={consultancy()} clients={[]} />);
    fireEvent.change(screen.getByPlaceholderText('Search services…'), { target: { value: 'strategy' } });
    expect(screen.getAllByTestId('service-card')).toHaveLength(1);
    expect(screen.getByText('Business Plans')).toBeInTheDocument();
  });

  it('retires only after confirmation', async () => {
    const c = consultancy();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<ServicesTab consultancy={c} clients={[]} />);
    const tax = screen.getAllByTestId('service-card').find(el => within(el).queryByText('Tax Advisory'));

    fireEvent.click(within(tax).getByRole('button', { name: 'Retire' }));
    expect(c.setServiceActive).not.toHaveBeenCalled();
    fireEvent.click(within(tax).getByRole('button', { name: 'Retire' }));
    await waitFor(() => expect(c.setServiceActive).toHaveBeenCalledWith('svc-tax', false));
    confirm.mockRestore();
  });

  it('shows why a delete was refused', async () => {
    const c = consultancy({ deleteService: vi.fn().mockRejectedValue(new Error('Clients are mapped to this service.')) });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ServicesTab consultancy={c} clients={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Business Plans' }));
    expect(await screen.findByText('Clients are mapped to this service.')).toBeInTheDocument();
    confirm.mockRestore();
  });

  it('invites the first service when there are none', () => {
    render(<ServicesTab consultancy={consultancy({ services: [], engagements: [], costStructures: [] })} clients={[]} />);
    expect(screen.getByText('No services yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Map Client/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Add your first service/ }));
    expect(screen.getByRole('dialog', { name: 'Add Service' })).toBeInTheDocument();
  });
});

describe('ServicesTab — client mappings', () => {
  it('lists current mappings with the terms each client agreed, and where they came from', () => {
    render(<ServicesTab consultancy={consultancy()} clients={[]} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Client mappings' }));

    const rows = screen.getAllByTestId('mapping-row');
    expect(rows).toHaveLength(2);                            // completed work is not "current"
    const negotiated = rows.find(r => within(r).queryByText('Otieno Traders'));
    expect(within(negotiated).getByText('KES 25,000 per month')).toBeInTheDocument();
    expect(within(negotiated).getByText('Negotiated')).toBeInTheDocument();
    const listPrice = rows.find(r => within(r).queryByText('Wanjiru Holdings'));
    expect(within(listPrice).queryByText('Negotiated')).not.toBeInTheDocument();
  });

  it('opens every mapping of one service from its card, closed ones included', () => {
    render(<ServicesTab consultancy={consultancy()} clients={[]} />);
    choose(/^Offered$/, 'All services');
    const old = screen.getAllByTestId('service-card').find(el => within(el).queryByText('Payroll Bureau'));
    fireEvent.click(within(old).getByRole('button', { name: /View all 1 mapping/ }));

    const rows = screen.getAllByTestId('mapping-row');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('Kamau & Sons')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Custom')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Completed')).toBeInTheDocument();
  });

  it('opens the mapping when a row is clicked', () => {
    render(<ServicesTab consultancy={consultancy()} clients={[]} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Client mappings' }));
    fireEvent.click(screen.getAllByTestId('mapping-row')[0]);
    expect(screen.getByRole('dialog', { name: 'Client Service Mapping' })).toBeInTheDocument();
  });
});

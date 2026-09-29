import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import EngagementFormModal from './EngagementFormModal';

const SERVICES = [
  { id: 'svc-tax',   name: 'Tax Advisory', service_code: 'SVC-00001', category: 'Tax', is_active: true },
  { id: 'svc-grant', name: 'Grant Writing', service_code: 'SVC-00002', category: null, is_active: true },
  { id: 'svc-old',   name: 'Payroll Bureau', service_code: 'SVC-00003', category: null, is_active: false },
];

const RETAINER = {
  id: 'opt-retainer', service_id: 'svc-tax', pricing_model: 'retainer', label: 'Gold',
  amount: '30000.00', billing_period: 'monthly', included_hours: '8.00', is_default: true,
};
const HOURLY = { id: 'opt-hourly', service_id: 'svc-tax', pricing_model: 'hourly', amount: '5000.00', is_default: false };

const OPTIONS = { 'svc-tax': [HOURLY, RETAINER] };

// The page's own client objects: `_id` is the database UUID, `id` the account number.
const CLIENTS = [
  { _id: 'client-uuid-1', id: 'ACC-001', fullName: 'Wanjiru Holdings', accountNumber: 'ACC-001', email: 'w@example.com' },
  { _id: 'client-uuid-2', id: 'ACC-002', fullName: 'Otieno Traders', accountNumber: 'ACC-002' },
];

const choose = (fieldLabel, optionLabel) => {
  fireEvent.click(screen.getByRole('button', { name: fieldLabel }));
  fireEvent.click(screen.getAllByText(optionLabel).find(el => el.tagName !== 'OPTION'));
};

const renderForm = (props = {}) => {
  const onSave = vi.fn().mockResolvedValue('eng-1');
  const onClose = vi.fn();
  render(
    <EngagementFormModal
      services={SERVICES}
      optionsByService={OPTIONS}
      clients={CLIENTS}
      onSave={onSave}
      onDelete={vi.fn()}
      onClose={onClose}
      {...props}
    />,
  );
  return { onSave, onClose };
};

describe('EngagementFormModal — mapping a client', () => {
  it('starts from the service\'s default price option and saves its terms as agreed', async () => {
    const { onSave, onClose } = renderForm({ presetServiceId: 'svc-tax' });

    expect(screen.getByText('KES 30,000 per month')).toBeInTheDocument();
    choose(/^Client/, 'Wanjiru Holdings (ACC-001)');
    fireEvent.click(screen.getByRole('button', { name: 'Map client' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0];
    expect(saved).toMatchObject({
      service_id: 'svc-tax',
      client_id: 'client-uuid-1',        // the UUID, never the account number
      cost_structure_id: 'opt-retainer',
      status: 'active',
    });
    expect(saved.terms).toMatchObject({ pricing_model: 'retainer', amount: '30000.00', billing_period: 'monthly' });
    expect(saved.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('records a negotiated rate against the option it came from', async () => {
    const { onSave } = renderForm({ presetServiceId: 'svc-tax' });

    choose(/^Client/, 'Otieno Traders (ACC-002)');
    choose(/^Price option/, 'Per-hour cost');
    expect(screen.getByText('KES 5,000 per hour')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Adjust for this client' }));
    fireEvent.change(screen.getByLabelText(/Rate per hour/), { target: { value: '4500' } });
    expect(screen.getByText(/Negotiated — differs from the listed price \(KES 5,000 per hour\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Map client' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({
      cost_structure_id: 'opt-hourly',
      terms: expect.objectContaining({ pricing_model: 'hourly', amount: '4500' }),
    });
  });

  it('prices a client on custom terms when the service has no price list', async () => {
    const { onSave } = renderForm({ presetServiceId: 'svc-grant' });

    choose(/^Client/, 'Wanjiru Holdings (ACC-001)');
    fireEvent.click(screen.getByRole('button', { name: 'Map client' }));
    expect(await screen.findByText('Choose how this option is priced.')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();

    choose(/^Pricing/, 'Success / performance fee');
    fireEvent.change(screen.getByLabelText(/Success fee/), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/Percentage of/), { target: { value: 'grant awarded' } });
    expect(screen.getByText('5% of grant awarded')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Map client' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({
      service_id: 'svc-grant',
      cost_structure_id: null,
      terms: expect.objectContaining({ pricing_model: 'success_fee', success_pct: '5', success_basis: 'grant awarded' }),
    });
  });

  it('asks for a service and a client, and refuses an end before the start', async () => {
    const { onSave } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Map client' }));
    expect(await screen.findByText('Choose a service.')).toBeInTheDocument();
    expect(screen.getByText('Choose a client.')).toBeInTheDocument();

    choose(/^Service/, 'Tax Advisory (SVC-00001)');
    choose(/^Client/, 'Wanjiru Holdings (ACC-001)');
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Map client' }));
    expect(await screen.findByText('The end date cannot be before the start date.')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not offer a retired service for a new mapping', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: /^Service/ }));
    expect(screen.queryByText('Payroll Bureau (SVC-00003)')).not.toBeInTheDocument();
    expect(screen.getAllByText('Tax Advisory (SVC-00001)').length).toBeGreaterThan(0);
  });

  it('warns before a second current mapping of the same client on the same service', () => {
    renderForm({
      presetServiceId: 'svc-tax',
      engagementsByService: {
        'svc-tax': [{ id: 'eng-0', client_id: 'client-uuid-1', status: 'active', pricing_model: 'hourly', amount: 5000 }],
      },
    });
    choose(/^Client/, 'Wanjiru Holdings (ACC-001)');
    expect(screen.getByText(/already has a current mapping on\s+this service \(KES 5,000 per hour\)/)).toBeInTheDocument();
  });
});

describe('EngagementFormModal — an existing mapping', () => {
  const ENGAGEMENT = {
    id: 'eng-9', service_id: 'svc-tax', client_id: 'client-uuid-2', cost_structure_id: null,
    pricing_model: 'fixed_fee', amount: '120000.00', deposit_pct: '40.000', status: 'on_hold',
    start_date: '2026-08-01', end_date: null, notes: 'Phase 1',
    client: { id: 'client-uuid-2', full_name: 'Otieno Traders', account_number: 'ACC-002' },
  };

  it('opens on the terms the client agreed, not the current price list', () => {
    renderForm({ engagement: ENGAGEMENT });
    expect(screen.getByRole('button', { name: /^Price option/ })).toHaveTextContent('Custom terms for this client');
    expect(screen.getByLabelText(/Project fee/)).toHaveValue(120000);
    expect(screen.getByLabelText(/Deposit/)).toHaveValue(40);
    expect(screen.getByRole('button', { name: /^Status/ })).toHaveTextContent('On hold');
  });

  it('saves changes to the same row', async () => {
    const { onSave } = renderForm({ engagement: ENGAGEMENT });
    choose(/^Status/, 'Completed');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ id: 'eng-9', status: 'completed', cost_structure_id: null, notes: 'Phase 1' });
  });

  it('removes the mapping only after confirmation', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderForm({ engagement: ENGAGEMENT, onDelete });

    fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('eng-9'));
    confirm.mockRestore();
  });
});

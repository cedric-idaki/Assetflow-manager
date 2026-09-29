import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import ServiceFormModal from './ServiceFormModal';
import { PRICING_MODELS } from '../../../../config/consultancyPricing';

const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

// A shadcn-style Select: open it by its label, then click the row — not the
// sr-only native <option> that mirrors it.
const choose = (within_, fieldLabel, optionLabel) => {
  fireEvent.click(within_.getByRole('button', { name: fieldLabel }));
  fireEvent.click(within_.getAllByText(optionLabel).find(el => el.tagName !== 'OPTION'));
};

const pick = (modelLabel) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${modelLabel}`) }));

describe('ServiceFormModal — a new service', () => {
  it('offers all seven ways to price before anything is chosen', () => {
    render(<ServiceFormModal onSave={vi.fn()} onClose={vi.fn()} />);
    PRICING_MODELS.forEach((m) => {
      expect(screen.getByRole('button', { name: new RegExp(`^${m.label.replace(/[()/]/g, '.')}`) })).toBeInTheDocument();
    });
  });

  it('saves the service with its whole price list, the first option leading', async () => {
    const onSave = vi.fn().mockResolvedValue('svc-1');
    const onClose = vi.fn();
    render(<ServiceFormModal categories={['Tax']} onSave={onSave} onClose={onClose} />);

    type(/Service name/, 'Tax Advisory');
    type(/Category/, 'Tax');

    pick('Retainer');
    type(/Retainer fee/, '30000');
    type(/Hours covered/, '8');

    fireEvent.click(screen.getByRole('button', { name: /Add price option/ }));
    pick('Per-hour cost');
    type(/Rate per hour/, '5000');

    expect(screen.getByText('KES 30,000 per month')).toBeInTheDocument();
    expect(screen.getByText('KES 5,000 per hour')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save service' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const { service, costStructures } = onSave.mock.calls[0][0];
    expect(service).toMatchObject({ name: 'Tax Advisory', category: 'Tax', is_active: true });
    expect(costStructures).toHaveLength(2);
    expect(costStructures[0]).toMatchObject({
      id: null, pricing_model: 'retainer', amount: '30000', billing_period: 'monthly', included_hours: '8', is_default: true,
    });
    expect(costStructures[1]).toMatchObject({ id: null, pricing_model: 'hourly', amount: '5000', is_default: false });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('refuses to send terms the database would refuse, in the same words', async () => {
    const onSave = vi.fn();
    render(<ServiceFormModal onSave={onSave} onClose={vi.fn()} />);

    type(/Service name/, 'Grant writing');
    pick('Success / performance fee');
    type(/Minimum fee/, '50000');
    type(/Fee cap/, '10000');
    fireEvent.click(screen.getByRole('button', { name: 'Save service' }));

    expect(await screen.findByText('Enter a success percentage, a fixed success bonus, or both.')).toBeInTheDocument();

    type(/Success fee/, '5');
    fireEvent.click(screen.getByRole('button', { name: 'Save service' }));
    expect(await screen.findByText('The fee cap cannot be lower than the minimum fee.')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('asks for a name', async () => {
    const onSave = vi.fn();
    render(<ServiceFormModal onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save service' }));
    expect(await screen.findByText('Give the service a name.')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows the server refusal and stays open', async () => {
    const onClose = vi.fn();
    const onSave = vi.fn().mockRejectedValue(new Error('A service with that name already exists.'));
    render(<ServiceFormModal onSave={onSave} onClose={onClose} />);
    type(/Service name/, 'Audit');
    fireEvent.click(screen.getByRole('button', { name: 'Save service' }));
    expect(await screen.findByText('A service with that name already exists.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('ServiceFormModal — editing', () => {
  const SERVICE = { id: 'svc-1', name: 'Tax Advisory', service_code: 'SVC-00001', category: 'Tax', description: null, is_active: true };
  const OPTIONS = [
    { id: 'opt-h', service_id: 'svc-1', pricing_model: 'hourly', amount: '5000.00', label: 'Standard', is_default: false },
    { id: 'opt-r', service_id: 'svc-1', pricing_model: 'retainer', amount: '30000.00', billing_period: 'monthly', is_default: true },
  ];

  it('keeps ids, moves the default, and drops a removed option from the list it sends', async () => {
    const onSave = vi.fn().mockResolvedValue('svc-1');
    render(
      <ServiceFormModal service={SERVICE} options={OPTIONS} clientsByOption={{ 'opt-r': 2 }} onSave={onSave} onClose={vi.fn()} />,
    );

    expect(screen.getByText(/2 clients were mapped on this option/)).toBeInTheDocument();

    const [hourly, retainer] = screen.getAllByTestId('price-option');
    fireEvent.click(within(hourly).getByRole('button', { name: 'Make default' }));
    fireEvent.change(within(hourly).getByLabelText(/Rate per hour/), { target: { value: '6000' } });
    fireEvent.click(within(retainer).getByRole('button', { name: /Remove Retainer/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const { service, costStructures } = onSave.mock.calls[0][0];
    expect(service.id).toBe('svc-1');
    expect(costStructures).toEqual([
      expect.objectContaining({ id: 'opt-h', pricing_model: 'hourly', amount: '6000', label: 'Standard', is_default: true }),
    ]);
  });

  it('switches an option to another model and asks for that model\'s terms', () => {
    render(<ServiceFormModal service={SERVICE} options={[OPTIONS[0]]} onSave={vi.fn()} onClose={vi.fn()} />);
    const row = screen.getByTestId('price-option');
    choose(within(row), /^Pricing/, 'Hourly billing package');
    expect(within(row).getByLabelText(/Package price/)).toHaveValue(5000);
    expect(within(row).getByLabelText(/Hours included/)).toHaveValue(null);
    expect(within(row).getByRole('button', { name: /^Billed/ })).toHaveTextContent('Monthly');
  });
});

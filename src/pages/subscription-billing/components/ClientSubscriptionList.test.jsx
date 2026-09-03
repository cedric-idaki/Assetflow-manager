import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import ClientSubscriptionList from './ClientSubscriptionList';
import EditSubscriptionModal from './EditSubscriptionModal';
import { CLIENT_TYPE, quoteSubscription } from '../../../config/subscriptionPricing';

const money = (n) =>
  `KES ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

describe('ClientSubscriptionList', () => {
  it('prices every row through the engine and shows the VAT split', () => {
    render(<ClientSubscriptionList />);

    // Sunrise SACCO — 240 members. Gold: 900 base + 240 x 27, no installation.
    const expected = quoteSubscription({
      clientType: CLIENT_TYPE.SACCO,
      seats: 240,
      storageGb: 12,
      chargeInstallation: false,
    });
    const row = screen.getByText('Sunrise SACCO').closest('tr');
    expect(row).toHaveTextContent(money(expected.total));
    expect(row).toHaveTextContent(money(expected.vatAmount));
    expect(row).toHaveTextContent(money(expected.subtotal));

    // The tier badge is derived from headcount, so it agrees with the price:
    // 240 members is Gold, not the Silver the old mock row asserted.
    expect(row).toHaveTextContent('Gold');
  });

  it('totals the book as taxable value, VAT and gross', () => {
    render(<ClientSubscriptionList />);
    // Scoped to the footer: "VAT" is also a column header.
    const footer = screen.getByText(/Recurring monthly revenue/).closest('div');
    expect(within(footer).getByText('Taxable')).toBeInTheDocument();
    expect(within(footer).getByText('VAT')).toBeInTheDocument();
  });

  it('hands the edit modal a client it can price', async () => {
    const user = userEvent.setup();
    let picked = null;
    render(<ClientSubscriptionList onEditClient={(c) => { picked = c; }} />);

    await user.click(screen.getAllByTitle('Edit subscription')[0]);
    expect(picked).toMatchObject({ name: 'Acme Kenya Ltd', type: CLIENT_TYPE.CORPORATE, seats: 35 });
  });
});

describe('EditSubscriptionModal', () => {
  const client = {
    id: 1,
    name: 'Acme Kenya Ltd',
    type: CLIENT_TYPE.CORPORATE,
    tier: 'gold',
    seats: 35,
    storageGb: 0,
  };

  it('previews the renewal invoice, itemised and without installation', () => {
    render(<EditSubscriptionModal client={client} onClose={() => {}} onSave={() => {}} />);

    const expected = quoteSubscription({
      clientType: CLIENT_TYPE.CORPORATE,
      seats: 35,
      chargeInstallation: false,
    });
    expect(screen.getByText(/Licensed user charges/)).toBeInTheDocument();
    expect(screen.getByText(/Taxable value/)).toBeInTheDocument();
    expect(screen.getByText(/VAT @ 16%/)).toBeInTheDocument();
    // One charge line, so this figure is both the line amount and the total.
    expect(screen.getAllByText(money(expected.total)).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Installation & onboarding/)).not.toBeInTheDocument();
    expect(screen.getByText(/the one-time installation fee is not re-charged/)).toBeInTheDocument();
  });

  it('saves the tier the engine actually priced', async () => {
    const user = userEvent.setup();
    let saved = null;
    render(<EditSubscriptionModal client={client} onClose={() => {}} onSave={(c) => { saved = c; }} />);

    await user.click(screen.getByText('Save Changes'));
    // The handler simulates a round trip before calling back.
    // 35 users resolves to Gold (17+) on its own.
    await waitFor(() => expect(saved).toMatchObject({ tier: 'gold', seats: 35 }));
  });
});

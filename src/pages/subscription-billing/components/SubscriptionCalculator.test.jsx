import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach } from 'vitest';
import SubscriptionCalculator from './SubscriptionCalculator';
import PricingOverview from './PricingOverview';
import { COMPANY_PLANS, INSTALLATION_FEE as COMPANY_INSTALL } from '../../../config/companyPlans';
import { SACCO_TIERS } from '../../../config/saccoTiers';

/**
 * What was broken: this screen priced off a table of its own — corporate at
 * KES 240/320/390 against a catalogue charging 305/360/267, saccos at a
 * 200/300/400 base with a flat 50 per member against a real 500/700/900 with
 * 44/36/27 — and its "total" was the subscription alone. Installation and VAT,
 * two of the five components of a real bill, appeared nowhere on the page.
 *
 * So these assertions are about the figures a super admin actually reads off
 * the screen, not about the engine (systemBilling.test.js covers that).
 */

const bronze = COMPANY_PLANS.find((p) => p.id === 'bronze'); // 6–16 users @ 360
const gold = SACCO_TIERS.find((t) => t.id === 'gold');       // 111+ members, 900 + 27

const money = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

describe('SubscriptionCalculator — the bill a super admin reads', () => {
  beforeEach(() => render(<SubscriptionCalculator />));

  it('itemises the corporate default at catalogue rates, with installation and VAT', () => {
    // Defaults: corporate, 10 users, first invoice.
    const bill = screen.getByText('Itemised bill').closest('div').parentElement;

    // User charges at the REAL rate — 10 x 360, not the old 10 x 320.
    expect(within(bill).getByText(/Licensed user charges/)).toBeInTheDocument();
    expect(within(bill).getByText(`10 × KES ${money(bronze.pricePerUser)}`)).toBeInTheDocument();
    expect(within(bill).getByText(`KES ${money(10 * bronze.pricePerUser)}`)).toBeInTheDocument();

    // Installation — a component the page never used to show at all.
    expect(within(bill).getByText(/Installation & onboarding/)).toBeInTheDocument();
    expect(within(bill).getByText(`KES ${money(COMPANY_INSTALL)}`)).toBeInTheDocument();

    // VAT — likewise absent before.
    expect(within(bill).getByText(/Taxable value/)).toBeInTheDocument();
    expect(within(bill).getByText(/VAT @ 16%/)).toBeInTheDocument();

    // And the total is the two charges together.
    expect(
      within(bill).getByText(`KES ${money(10 * bronze.pricePerUser + COMPANY_INSTALL)}`),
    ).toBeInTheDocument();
  });

  it('drops installation when quoting a renewal', async () => {
    const user = userEvent.setup();
    await user.click(screen.getByText(/First invoice — charge installation/));

    expect(screen.queryByText(/Installation & onboarding/)).not.toBeInTheDocument();
    // With installation gone the only charge is the user line, so that figure
    // is both the line amount and the total — which is the point.
    expect(screen.getAllByText(`KES ${money(10 * bronze.pricePerUser)}`)).toHaveLength(2);
    expect(screen.getByText('Recurring monthly invoice.')).toBeInTheDocument();
  });

  it('prices a sacco on base + per-member at catalogue rates', async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /SACCO/ }));

    const members = screen.getByLabelText(/Active SACCO Members/);
    await user.clear(members);
    await user.type(members, '240');

    // 240 members is Gold: a 900 base plus 240 x 27.
    expect(screen.getByText(/Base system price — Gold tier/)).toBeInTheDocument();
    expect(screen.getByText(`KES ${money(gold.baseFee)}`)).toBeInTheDocument();
    expect(screen.getByText(`240 × KES ${money(gold.perMemberFee)}`)).toBeInTheDocument();
    expect(screen.getByText(/Active member charges/)).toBeInTheDocument();
  });

  it('says on the page when the minimum lifted the headcount', async () => {
    const user = userEvent.setup();
    const users = screen.getByLabelText(/Licensed Users/);
    await user.clear(users);
    await user.type(users, '1');

    // A one-person company is billed as two, and the invoice has to explain
    // itself on the page rather than in an email.
    expect(screen.getByText(/2-user minimum/)).toBeInTheDocument();
    expect(screen.getByText(/Billed on 2 users — the minimum/)).toBeInTheDocument();
  });

  it('accounts for additional modules even though they are bundled', () => {
    // The corporate preset bundles everything it enables, so there is nothing
    // extra; ticking a non-bundled module has to show up as an accounted line.
    expect(screen.getByText(/0 beyond the plan bundle/)).toBeInTheDocument();
  });
});

describe('PricingOverview — the published rate card', () => {
  beforeEach(() => render(<PricingOverview />));

  it('publishes catalogue prices, not the drifted ones', () => {
    COMPANY_PLANS.forEach((p) => {
      expect(screen.getByText(`KES ${p.pricePerUser.toLocaleString()}`)).toBeInTheDocument();
    });
    // The figures the page used to advertise are gone.
    ['KES 240', 'KES 320', 'KES 390'].forEach((old) => {
      expect(screen.queryByText(old)).not.toBeInTheDocument();
    });
  });

  it('states installation, modules, the minimum and VAT for both models', () => {
    expect(screen.getAllByText(/Installation & onboarding \(one-time, first invoice\)/)).toHaveLength(2);
    expect(screen.getAllByText(/Additional modules/)).toHaveLength(2);
    expect(screen.getAllByText('VAT')).toHaveLength(2);
    expect(screen.getAllByText(/16% — included in every price above/)).toHaveLength(2);
    expect(screen.getByText('2 users')).toBeInTheDocument();
    expect(screen.getByText('5 members')).toBeInTheDocument();
  });

  it('no longer advertises an external-signing quota or overage', () => {
    expect(screen.queryByText(/signing/i)).not.toBeInTheDocument();
  });
});

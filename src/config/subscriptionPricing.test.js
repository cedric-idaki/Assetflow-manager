import { describe, it, expect } from 'vitest';
import {
  CLIENT_TYPE,
  CORPORATE_TIERS,
  SACCO_TIERS,
  tiersFor,
  defaultTierFor,
  productLineFor,
  installationFeeFor,
  quoteSubscription,
  calcCorporateTotal,
  calcSaccoTotal,
} from './subscriptionPricing';
import { COMPANY_PLANS, MIN_BILLABLE_USERS, INSTALLATION_FEE as COMPANY_INSTALL } from './companyPlans';
import {
  SACCO_TIERS as SACCO_CATALOGUE,
  MIN_BILLABLE_MEMBERS,
  INSTALLATION_FEE as SACCO_INSTALL,
} from './saccoTiers';
import { buildSystemInvoice } from './systemBilling';
import * as pricing from './subscriptionPricing';

/**
 * The Subscription & Billing screen used to price off its own table — corporate
 * at 240/320/390 against a catalogue charging 305/360/267, saccos at a
 * 200/300/400 base with a flat 50 per member against a real 500/700/900 with
 * 44/36/27 — and it showed neither installation nor VAT. These tests exist to
 * make that class of drift impossible rather than merely fixed.
 */
describe('subscriptionPricing — projection of the real catalogue', () => {
  it('projects every corporate tier from companyPlans, unchanged', () => {
    expect(Object.keys(CORPORATE_TIERS)).toEqual(COMPANY_PLANS.map((p) => p.id));
    COMPANY_PLANS.forEach((plan) => {
      const tier = CORPORATE_TIERS[plan.id];
      expect(tier.pricePerUser).toBe(plan.pricePerUser);
      expect(tier.baseFee).toBe(plan.baseFee || 0);
      expect(tier.storageGb).toBe(plan.storageGb);
      expect(tier.range).toBe(plan.userRange);
      expect(tier.label).toBe(plan.name);
    });
  });

  it('projects every sacco tier from saccoTiers, unchanged', () => {
    expect(Object.keys(SACCO_TIERS)).toEqual(SACCO_CATALOGUE.map((t) => t.id));
    SACCO_CATALOGUE.forEach((cat) => {
      const tier = SACCO_TIERS[cat.id];
      expect(tier.baseFee).toBe(cat.baseFee);
      expect(tier.perMemberFee).toBe(cat.perMemberFee);
      expect(tier.storageGb).toBe(cat.storageGb);
      expect(tier.range).toBe(cat.memberRange);
      expect(tier.label).toBe(cat.name);
    });
  });

  it('keeps catalogue order, so the entry-level tier renders first', () => {
    expect(defaultTierFor(CLIENT_TYPE.CORPORATE)).toBe(COMPANY_PLANS[0].id);
    expect(defaultTierFor(CLIENT_TYPE.SACCO)).toBe(SACCO_CATALOGUE[0].id);
  });

  it('no longer exports the invented external-signing charges', () => {
    // Neither existed anywhere else in the codebase, in any migration, or on
    // any invoice the platform has raised.
    expect(pricing.EXTRA_SIGNING_COST).toBeUndefined();
    Object.values(CORPORATE_TIERS).forEach((t) => expect(t.externalSignings).toBeUndefined());
    Object.values(SACCO_TIERS).forEach((t) => expect(t.externalSignings).toBeUndefined());
  });

  it('maps client types onto the engine product lines', () => {
    expect(productLineFor(CLIENT_TYPE.CORPORATE)).toBe('company');
    expect(productLineFor(CLIENT_TYPE.SACCO)).toBe('sacco');
    expect(tiersFor(CLIENT_TYPE.SACCO)).toBe(SACCO_TIERS);
    expect(tiersFor(CLIENT_TYPE.CORPORATE)).toBe(CORPORATE_TIERS);
  });
});

describe('quoteSubscription — the engine, not a second opinion', () => {
  it('returns exactly what buildSystemInvoice returns for the same inputs', () => {
    const args = { seats: 24, storageGb: 8, modules: ['clients', 'pos'], chargeInstallation: true };
    expect(quoteSubscription({ clientType: CLIENT_TYPE.CORPORATE, ...args })).toEqual(
      buildSystemInvoice({ productLine: 'company', ...args }),
    );
    expect(quoteSubscription({ clientType: CLIENT_TYPE.SACCO, ...args })).toEqual(
      buildSystemInvoice({ productLine: 'sacco', ...args }),
    );
  });

  it('itemises all five components on a first corporate invoice', () => {
    const q = quoteSubscription({
      clientType: CLIENT_TYPE.CORPORATE,
      seats: 10,
      chargeInstallation: true,
    });
    // 10 users lands on Bronze (6–16) at 360.
    expect(q.tier.id).toBe('bronze');
    expect(q.usageFee).toBe(10 * 360);
    expect(q.installationFee).toBe(COMPANY_INSTALL);
    expect(q.baseFee).toBe(0); // corporate prices entirely per seat today
    expect(q.moduleFee).toBe(0); // every module is bundled
    expect(q.vatAmount).toBeGreaterThan(0);
    expect(q.total).toBe(10 * 360 + COMPANY_INSTALL);
  });

  it('itemises base fee, member charges and VAT on a sacco invoice', () => {
    const q = quoteSubscription({ clientType: CLIENT_TYPE.SACCO, seats: 240 });
    expect(q.tier.id).toBe('gold'); // 111+
    expect(q.baseFee).toBe(900);
    expect(q.usageFee).toBe(240 * 27);
    expect(q.installationFee).toBe(0); // renewal
    expect(q.total).toBe(900 + 240 * 27);
  });

  it('discloses VAT such that taxable value + VAT === total', () => {
    [1, 5, 10, 50, 240, 600].forEach((seats) => {
      [CLIENT_TYPE.CORPORATE, CLIENT_TYPE.SACCO].forEach((clientType) => {
        [true, false].forEach((chargeInstallation) => {
          const q = quoteSubscription({ clientType, seats, chargeInstallation });
          expect(Math.round((q.subtotal + q.vatAmount) * 100) / 100).toBe(q.total);
          expect(q.vatRate).toBeGreaterThan(0);
        });
      });
    });
  });

  it('charges installation only when asked, and never on a renewal', () => {
    const first = quoteSubscription({ clientType: CLIENT_TYPE.SACCO, seats: 60, chargeInstallation: true });
    const renewal = quoteSubscription({ clientType: CLIENT_TYPE.SACCO, seats: 60 });
    expect(first.installationFee).toBe(SACCO_INSTALL);
    expect(renewal.installationFee).toBe(0);
    expect(first.total - renewal.total).toBe(SACCO_INSTALL);
    expect(installationFeeFor(CLIENT_TYPE.SACCO)).toBe(SACCO_INSTALL);
    expect(installationFeeFor(CLIENT_TYPE.CORPORATE)).toBe(COMPANY_INSTALL);
  });

  it('applies each product line minimum to the usage charge only', () => {
    const oneUser = quoteSubscription({ clientType: CLIENT_TYPE.CORPORATE, seats: 1 });
    expect(oneUser.billedSeats).toBe(MIN_BILLABLE_USERS);
    expect(oneUser.minimumApplied).toBe(true);

    const tinyChama = quoteSubscription({ clientType: CLIENT_TYPE.SACCO, seats: 3 });
    expect(tinyChama.billedSeats).toBe(MIN_BILLABLE_MEMBERS);
    expect(tinyChama.minimumApplied).toBe(true);
    // The floor lifts members, never the base fee.
    expect(tinyChama.baseFee).toBe(SACCO_CATALOGUE[0].baseFee);
  });

  it('bills an empty form nothing', () => {
    const q = quoteSubscription({ clientType: CLIENT_TYPE.CORPORATE, seats: 0, chargeInstallation: true });
    expect(q.billedSeats).toBe(0);
    expect(q.usageFee).toBe(0);
    expect(q.total).toBe(0);
  });

  it('derives the tier from headcount, and honours an explicit override', () => {
    expect(quoteSubscription({ clientType: CLIENT_TYPE.CORPORATE, seats: 3 }).tier.id).toBe('silver');
    expect(quoteSubscription({ clientType: CLIENT_TYPE.CORPORATE, seats: 30 }).tier.id).toBe('gold');
    expect(
      quoteSubscription({ clientType: CLIENT_TYPE.CORPORATE, seats: 30, tierId: 'silver' }).tier.id,
    ).toBe('silver');
  });

  it('prices the printed line as qty x unit, exactly', () => {
    const q = quoteSubscription({ clientType: CLIENT_TYPE.SACCO, seats: 240 });
    q.lines.forEach((l) => {
      expect(Math.round(l.qty * l.unit * 100) / 100).toBe(l.gross);
    });
  });

  it('keeps the back-compat wrappers on the engine', () => {
    expect(calcCorporateTotal('bronze', 10).total).toBe(
      quoteSubscription({ clientType: CLIENT_TYPE.CORPORATE, tierId: 'bronze', seats: 10 }).total,
    );
    expect(calcSaccoTotal('silver', 80).total).toBe(
      quoteSubscription({ clientType: CLIENT_TYPE.SACCO, tierId: 'silver', seats: 80 }).total,
    );
  });
});

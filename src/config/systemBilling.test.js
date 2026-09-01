/**
 * The system billing engine — what a platform invoice costs and how it splits.
 *
 * Two things are being protected here.
 *
 * THE MONEY DID NOT MOVE. Itemising an invoice and adding a VAT line is
 * paperwork; it must not change what anybody pays. Prices are VAT-inclusive
 * (VAT_INCLUSIVE_PRICES), so every total below is asserted against the formula
 * the wizard used before this engine existed — base + seats × rate + install.
 * If a total shifts by a shilling, a live tenant's bill shifted with it and
 * mpesa-stk-push starts refusing signups it used to accept.
 *
 * THE ARITHMETIC ON THE PAGE ADDS UP. subtotal + VAT === total, and the line
 * amounts sum to the subtotal, exactly, at every seat count — not to within a
 * rounding error. A tax invoice whose columns disagree is the one document a
 * customer will always check.
 */

import { describe, it, expect } from 'vitest';
import {
  buildSystemInvoice,
  registrationTotal,
  monthlyTotal,
  VAT_RATE,
  MODULE_FEES,
  includedModules,
  moduleFeeFor,
} from './systemBilling';
import { COMPANY_PLANS, planForUsers, INSTALLATION_FEE as COMPANY_FEE } from './companyPlans';
import { SACCO_TIERS, tierForMembers, INSTALLATION_FEE as SACCO_FEE, EXCESS_STORAGE_PER_GB } from './saccoTiers';

const cents = (n) => Math.round(n * 100) / 100;
const sumLines = (bill) => cents(bill.lines.reduce((s, l) => s + l.amount, 0));
const lineFor = (bill, fragment) => bill.lines.find((l) => l.label.includes(fragment));

/** What the wizard charged before this engine existed. */
const legacyCompanyTotal = (seats, withInstall) =>
  seats * planForUsers(seats).pricePerUser + (withInstall ? COMPANY_FEE : 0);
const legacySaccoTotal = (members, withInstall) => {
  const t = tierForMembers(members);
  return t.baseFee + members * t.perMemberFee + (withInstall ? SACCO_FEE : 0);
};

const SEATS = Array.from({ length: 120 }, (_, i) => i + 1);

// ─────────────────────────────────────────────────────────────────────────────
describe('nobody’s bill changed', () => {
  it('company registration still costs exactly what it did, at every seat count', () => {
    const moved = SEATS
      .map((n) => ({ n, now: registrationTotal({ productLine: 'company', seats: n }), before: legacyCompanyTotal(n, true) }))
      .filter((r) => r.now !== r.before);
    expect(moved).toEqual([]);
  });

  it('company renewals still cost what they did — and never re-charge installation', () => {
    const moved = SEATS
      .map((n) => ({ n, now: monthlyTotal({ productLine: 'company', seats: n }), before: legacyCompanyTotal(n, false) }))
      .filter((r) => r.now !== r.before);
    expect(moved).toEqual([]);
  });

  it('sacco registration and renewal still cost what they did', () => {
    const moved = SEATS.flatMap((n) => [
      { n, kind: 'reg', now: registrationTotal({ productLine: 'sacco', seats: n }), before: legacySaccoTotal(n, true) },
      { n, kind: 'renew', now: monthlyTotal({ productLine: 'sacco', seats: n }), before: legacySaccoTotal(n, false) },
    ]).filter((r) => r.now !== r.before);
    expect(moved).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the five components the business bills on', () => {
  const bill = buildSystemInvoice({ productLine: 'sacco', seats: 60, storageGb: 14, chargeInstallation: true });

  it('prices the base system fee from the tier', () => {
    const tier = tierForMembers(60);
    expect(bill.baseFee).toBe(tier.baseFee);
    expect(lineFor(bill, 'Base system price').gross).toBe(tier.baseFee);
  });

  it('prices member charges as members × the tier rate', () => {
    const tier = tierForMembers(60);
    expect(bill.usageFee).toBe(60 * tier.perMemberFee);
    expect(lineFor(bill, 'Active member charges').qty).toBe(60);
  });

  it('prices storage only above the tier’s free quota', () => {
    // Silver covers 10 GB free; 14 used leaves 4 chargeable.
    expect(bill.storageFee).toBe(4 * EXCESS_STORAGE_PER_GB);
    expect(buildSystemInvoice({ productLine: 'sacco', seats: 60, storageGb: 3 }).storageFee).toBe(0);
  });

  it('charges installation once, and only when asked', () => {
    expect(bill.installationFee).toBe(SACCO_FEE);
    expect(buildSystemInvoice({ productLine: 'sacco', seats: 60 }).installationFee).toBe(0);
    expect(bill.lines.filter((l) => l.label.startsWith('Installation'))).toHaveLength(1);
  });

  it('prices licensed users for a company, not members', () => {
    const co = buildSystemInvoice({ productLine: 'company', seats: 8 });
    expect(co.usageFee).toBe(8 * planForUsers(8).pricePerUser);
    expect(lineFor(co, 'Licensed user charges')).toBeTruthy();
    expect(lineFor(co, 'Active member charges')).toBeUndefined();
  });

  it('suppresses a zero component rather than printing a KES 0 line', () => {
    // The corporate line has no base fee today, so no base line should print.
    const co = buildSystemInvoice({ productLine: 'company', seats: 3 });
    expect(co.baseFee).toBe(0);
    expect(lineFor(co, 'Base system price')).toBeUndefined();
    expect(lineFor(co, 'Storage excess')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('additional modules', () => {
  // Every shipped fee is 0, so give the engine a rate card to price against.
  const RATE_CARD = { payroll: 500, accounting: 750, hr: 300 };

  it('charges nothing while every module is bundled', () => {
    expect(Object.values(MODULE_FEES).every((f) => f === 0)).toBe(true);
    const bill = buildSystemInvoice({ productLine: 'company', seats: 10, modules: ['payroll', 'hr', 'accounting'] });
    expect(bill.moduleFee).toBe(0);
  });

  it('bills only what the plan does not already include', () => {
    const included = includedModules('company');
    expect(included).toContain('crm');   // bundled — must not be billed
    expect(included).not.toContain('payroll');

    const bill = buildSystemInvoice({
      productLine: 'company', seats: 10,
      modules: ['crm', 'payroll', 'hr'],
      moduleFees: RATE_CARD,
    });
    expect(bill.moduleFee).toBe(500 + 300);
    expect(lineFor(bill, 'CRM')).toBeUndefined();
    expect(lineFor(bill, 'Payroll').gross).toBe(500);
  });

  it('bills the same module differently by product line, because bundles differ', () => {
    // accounting is in the sacco preset but not the company one.
    const co = buildSystemInvoice({ productLine: 'company', seats: 10, modules: ['accounting'], moduleFees: RATE_CARD });
    const sacco = buildSystemInvoice({ productLine: 'sacco', seats: 10, modules: ['accounting'], moduleFees: RATE_CARD });
    expect(co.moduleFee).toBe(750);
    expect(sacco.moduleFee).toBe(0);
  });

  it('falls back to the default fee for a key with no rate', () => {
    expect(moduleFeeFor('not_a_module', RATE_CARD)).toBe(0);
  });

  it('adds the module charge to the total', () => {
    const without = buildSystemInvoice({ productLine: 'company', seats: 10 });
    const with_ = buildSystemInvoice({ productLine: 'company', seats: 10, modules: ['payroll'], moduleFees: RATE_CARD });
    expect(cents(with_.total - without.total)).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('VAT', () => {
  it('backs the tax out of an inclusive price, leaving the total alone', () => {
    const bill = buildSystemInvoice({ productLine: 'company', seats: 5, chargeInstallation: true });
    expect(bill.total).toBe(legacyCompanyTotal(5, true));
    expect(cents(bill.subtotal + bill.vatAmount)).toBe(bill.total);
    expect(bill.vatRate).toBe(VAT_RATE);
    // 16% of the net, not 16% of the gross — the classic way to get this wrong.
    expect(bill.vatAmount).toBe(cents(bill.subtotal * 0.16));
  });

  it('adds the tax on top when prices are exclusive', () => {
    const gross = legacyCompanyTotal(5, true);
    const bill = buildSystemInvoice({ productLine: 'company', seats: 5, chargeInstallation: true, vatInclusive: false });
    expect(bill.subtotal).toBe(gross);
    expect(bill.vatAmount).toBe(cents(gross * 0.16));
    expect(bill.total).toBe(cents(gross * 1.16));
  });

  it('charges nothing at a zero rate, and the subtotal is then the total', () => {
    const bill = buildSystemInvoice({ productLine: 'sacco', seats: 40, vatRate: 0 });
    expect(bill.vatAmount).toBe(0);
    expect(bill.subtotal).toBe(bill.total);
    expect(bill.total).toBe(legacySaccoTotal(40, false));
  });

  it('subtotal + VAT === total for every company seat count, to the cent', () => {
    const broken = SEATS
      .map((n) => buildSystemInvoice({ productLine: 'company', seats: n, chargeInstallation: true }))
      .filter((b) => cents(b.subtotal + b.vatAmount) !== b.total);
    expect(broken).toEqual([]);
  });

  it('subtotal + VAT === total for every sacco member count, to the cent', () => {
    const broken = SEATS
      .map((n) => buildSystemInvoice({ productLine: 'sacco', seats: n, storageGb: 30, chargeInstallation: true }))
      .filter((b) => cents(b.subtotal + b.vatAmount) !== b.total);
    expect(broken).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the printed lines add up', () => {
  it('net line amounts sum to the subtotal at every company seat count', () => {
    const broken = SEATS
      .map((n) => ({ n, bill: buildSystemInvoice({ productLine: 'company', seats: n, chargeInstallation: true }) }))
      .filter(({ bill }) => sumLines(bill) !== bill.subtotal);
    expect(broken).toEqual([]);
  });

  it('net line amounts sum to the subtotal at every sacco member count', () => {
    const broken = SEATS
      .map((n) => ({ n, bill: buildSystemInvoice({ productLine: 'sacco', seats: n, storageGb: 22, chargeInstallation: true }) }))
      .filter(({ bill }) => sumLines(bill) !== bill.subtotal);
    expect(broken).toEqual([]);
  });

  it('gross line amounts sum to the total', () => {
    const bill = buildSystemInvoice({ productLine: 'sacco', seats: 75, storageGb: 18, chargeInstallation: true });
    expect(cents(bill.lines.reduce((s, l) => s + l.gross, 0))).toBe(bill.total);
  });

  it('states a unit price that multiplies back to the printed line, exactly', () => {
    // This is why the item table stays VAT-inclusive: qty x the advertised rate
    // reproduces the printed amount with no residual. The net equivalent cannot
    // — 60 members at a net 31.034 is out by 0.27 however it is rounded.
    const bill = buildSystemInvoice({ productLine: 'sacco', seats: 60, storageGb: 20, chargeInstallation: true });
    expect(bill.lines.length).toBeGreaterThan(0);
    bill.lines.forEach((l) => {
      expect(l.qty * l.unit, l.label).toBe(l.gross);
    });
  });

  it('quotes the advertised rate, not a back-computed one', () => {
    const members = lineFor(buildSystemInvoice({ productLine: 'sacco', seats: 60 }), 'Active member charges');
    expect(members.unit).toBe(tierForMembers(60).perMemberFee);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('edges', () => {
  it('prices nothing for a company with no seats, rather than guessing a tier', () => {
    const bill = buildSystemInvoice({ productLine: 'company', seats: 0, chargeInstallation: true });
    expect(bill.tier).toBeNull();
    expect(bill.total).toBe(0);
    expect(bill.lines).toEqual([]);
    // No tier means no installation either — there is nothing to install.
    expect(bill.installationFee).toBe(0);
  });

  it('keeps the sacco quirk that a sub-minimum chama still bills as Bronze', () => {
    const bill = buildSystemInvoice({ productLine: 'sacco', seats: 3 });
    expect(bill.tier.id).toBe('bronze');
    expect(bill.total).toBe(legacySaccoTotal(3, false));
  });

  it('treats a chama as a sacco for pricing but not for what its plan bundles', () => {
    const bill = buildSystemInvoice({ productLine: 'chama', seats: 20 });
    expect(bill.isSacco).toBe(true);
    expect(bill.total).toBe(legacySaccoTotal(20, false));
    expect(includedModules('chama')).toContain('mgr');
  });

  it('honours an explicit tier over the one the seat count implies', () => {
    const forced = buildSystemInvoice({ productLine: 'company', seats: 3, tierId: 'gold' });
    expect(forced.tier.id).toBe('gold');
    expect(forced.usageFee).toBe(3 * COMPANY_PLANS.find((p) => p.id === 'gold').pricePerUser);
  });

  it('falls back to the seat-derived tier when the stored tier id is unknown', () => {
    const bill = buildSystemInvoice({ productLine: 'sacco', seats: 60, tierId: 'platinum' });
    expect(bill.tier.id).toBe(tierForMembers(60).id);
  });

  it('ignores a negative or non-numeric seat count instead of billing backwards', () => {
    [-5, NaN, null, undefined, 'abc'].forEach((seats) => {
      expect(buildSystemInvoice({ productLine: 'company', seats }).total, `seats=${seats}`).toBe(0);
    });
  });

  it('covers every sacco tier boundary without a price jump on the wrong side', () => {
    [4, 5, 50, 51, 110, 111].forEach((n) => {
      expect(monthlyTotal({ productLine: 'sacco', seats: n }), `members=${n}`).toBe(legacySaccoTotal(n, false));
      expect(SACCO_TIERS.some((t) => t.id === buildSystemInvoice({ productLine: 'sacco', seats: n }).tier.id)).toBe(true);
    });
  });
});

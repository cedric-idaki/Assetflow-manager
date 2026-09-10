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
 * The deliberate exceptions are the two minimum-billing floors: a company is
 * priced on at least MIN_BILLABLE_USERS seats and a sacco on at least
 * MIN_BILLABLE_MEMBERS members, so the sub-minimum cases — and ONLY those —
 * cost more than they used to. The legacy formulas below bill the floored
 * count for exactly that reason, and each floor's effect is pinned separately
 * so it cannot widen unnoticed.
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
import { COMPANY_PLANS, planForUsers, billableUsers, MIN_BILLABLE_USERS, INSTALLATION_FEE as COMPANY_FEE } from './companyPlans';
import {
  SACCO_TIERS,
  tierForMembers,
  billableMembers,
  MIN_BILLABLE_MEMBERS,
  INSTALLATION_FEE as SACCO_FEE,
  EXCESS_STORAGE_PER_GB,
} from './saccoTiers';

const cents = (n) => Math.round(n * 100) / 100;
const sumLines = (bill) => cents(bill.lines.reduce((s, l) => s + l.amount, 0));
const lineFor = (bill, fragment) => bill.lines.find((l) => l.label.includes(fragment));

/**
 * What the wizard charged before this engine existed, on the seat count the
 * business actually bills — which is never below the 2-user minimum.
 */
const legacyCompanyTotal = (seats, withInstall) => {
  const billed = billableUsers(seats);
  return billed * planForUsers(billed).pricePerUser + (withInstall ? COMPANY_FEE : 0);
};
const legacySaccoTotal = (members, withInstall) => {
  const billed = billableMembers(members);
  const t = tierForMembers(billed);
  return t.baseFee + billed * t.perMemberFee + (withInstall ? SACCO_FEE : 0);
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
describe('the Business 2-user minimum', () => {
  const PER_USER = planForUsers(MIN_BILLABLE_USERS).pricePerUser;

  it('bills a one-user company for two users', () => {
    const bill = buildSystemInvoice({ productLine: 'company', seats: 1 });
    expect(bill.billedSeats).toBe(MIN_BILLABLE_USERS);
    expect(bill.usageFee).toBe(MIN_BILLABLE_USERS * PER_USER);
    expect(lineFor(bill, 'Licensed user charges').qty).toBe(MIN_BILLABLE_USERS);
  });

  it('adds installation on top of the minimum, not instead of it', () => {
    const bill = buildSystemInvoice({ productLine: 'company', seats: 1, chargeInstallation: true });
    expect(bill.installationFee).toBe(COMPANY_FEE);
    expect(bill.total).toBe(MIN_BILLABLE_USERS * PER_USER + COMPANY_FEE);
  });

  it('carries the other applicable charges on top of the minimum too', () => {
    // A minimum floors the USER charge; it is not a cap on the invoice.
    const bill = buildSystemInvoice({
      productLine: 'company',
      seats: 1,
      modules: ['payroll'],
      moduleFees: { payroll: 500 },
      chargeInstallation: true,
    });
    expect(bill.total).toBe(MIN_BILLABLE_USERS * PER_USER + 500 + COMPANY_FEE);
  });

  it('says on the invoice why a one-person company is billed for two', () => {
    const floored = lineFor(buildSystemInvoice({ productLine: 'company', seats: 1 }), 'Licensed user charges');
    expect(floored.label).toContain(`${MIN_BILLABLE_USERS}-user minimum`);
    // ...and stays quiet when the tenant is above the floor anyway.
    const normal = lineFor(buildSystemInvoice({ productLine: 'company', seats: 4 }), 'Licensed user charges');
    expect(normal.label).not.toContain('minimum');
  });

  it('leaves every seat count above the minimum exactly where it was', () => {
    const moved = SEATS.filter((n) => n > MIN_BILLABLE_USERS)
      .map((n) => ({ n, bill: buildSystemInvoice({ productLine: 'company', seats: n }) }))
      .filter(({ n, bill }) => bill.billedSeats !== n || bill.minimumApplied);
    expect(moved).toEqual([]);
  });

  it('does not bill an empty form — zero seats is still zero, not a minimum', () => {
    const bill = buildSystemInvoice({ productLine: 'company', seats: 0, chargeInstallation: true });
    expect(bill.billedSeats).toBe(0);
    expect(bill.total).toBe(0);
  });

  it('governs the Business line only — a sacco is priced by its own rules', () => {
    // MIN_BILLABLE_USERS must never reach the sacco line. Well above any floor
    // of the sacco line's own, a sacco bills its actual members, untouched.
    [20, 60, 200].forEach((n) => {
      ['sacco', 'chama'].forEach((productLine) => {
        const bill = buildSystemInvoice({ productLine, seats: n });
        expect(bill.billedSeats, `${productLine} members=${n}`).toBe(n);
        expect(bill.minimumApplied, `${productLine} members=${n}`).toBe(false);
        expect(lineFor(bill, 'Active member charges').qty).toBe(n);
      });
    });
    // And a small sacco follows saccoTiers.js — billableMembers(), whatever it
    // says — never the Business seat minimum.
    [1, 2, 3].forEach((n) => {
      const bill = buildSystemInvoice({ productLine: 'sacco', seats: n });
      expect(bill.billedSeats, `sacco members=${n}`).toBe(billableMembers(n));
    });
  });

  it('keeps the printed arithmetic adding up when the floor applies', () => {
    const bill = buildSystemInvoice({ productLine: 'company', seats: 1, chargeInstallation: true });
    expect(sumLines(bill)).toBe(bill.subtotal);
    expect(cents(bill.subtotal + bill.vatAmount)).toBe(bill.total);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the sacco 5-member minimum', () => {
  const BRONZE = tierForMembers(MIN_BILLABLE_MEMBERS);
  const FLOOR_USAGE = MIN_BILLABLE_MEMBERS * BRONZE.perMemberFee;

  it('bills a three-member chama for five members', () => {
    const bill = buildSystemInvoice({ productLine: 'sacco', seats: 3 });
    expect(bill.seats).toBe(3);                          // what the sacco has
    expect(bill.billedSeats).toBe(MIN_BILLABLE_MEMBERS); // what it pays for
    expect(bill.usageFee).toBe(FLOOR_USAGE);
    expect(lineFor(bill, 'Active member charges').qty).toBe(MIN_BILLABLE_MEMBERS);
  });

  it('leaves the tier base fee alone — the floor is on the member charge only', () => {
    const bill = buildSystemInvoice({ productLine: 'sacco', seats: 1 });
    expect(bill.baseFee).toBe(BRONZE.baseFee);
    expect(bill.total).toBe(BRONZE.baseFee + FLOOR_USAGE);
  });

  it('adds installation on top of the minimum, not instead of it', () => {
    const bill = buildSystemInvoice({ productLine: 'sacco', seats: 2, chargeInstallation: true });
    expect(bill.installationFee).toBe(SACCO_FEE);
    expect(bill.total).toBe(BRONZE.baseFee + FLOOR_USAGE + SACCO_FEE);
  });

  it('carries the other applicable charges on top of the minimum too', () => {
    // A minimum floors the MEMBER charge; it is not a cap on the invoice.
    const bill = buildSystemInvoice({
      productLine: 'sacco',
      seats: 2,
      storageGb: BRONZE.storageGb + 3,
      modules: ['payroll'],
      moduleFees: { payroll: 500 },
      chargeInstallation: true,
    });
    expect(bill.storageFee).toBe(3 * EXCESS_STORAGE_PER_GB);
    expect(bill.moduleFee).toBe(500);
    expect(bill.total).toBe(
      BRONZE.baseFee + FLOOR_USAGE + 3 * EXCESS_STORAGE_PER_GB + 500 + SACCO_FEE,
    );
  });

  it('says on the invoice why a small sacco is billed for five', () => {
    const floored = lineFor(buildSystemInvoice({ productLine: 'sacco', seats: 3 }), 'Active member charges');
    expect(floored.label).toContain(`${MIN_BILLABLE_MEMBERS}-member minimum`);
    // qty × unit still multiplies out to the printed amount — the one sum a
    // customer checks by hand.
    expect(floored.gross).toBe(floored.qty * floored.unit);
    // ...and it stays quiet when the sacco is above the floor anyway.
    const normal = lineFor(buildSystemInvoice({ productLine: 'sacco', seats: 40 }), 'Active member charges');
    expect(normal.label).not.toContain('minimum');
  });

  it('leaves every member count above the minimum exactly where it was', () => {
    const moved = SEATS.filter((n) => n > MIN_BILLABLE_MEMBERS)
      .flatMap((n) => ['sacco', 'chama'].map((productLine) => ({
        n, productLine, bill: buildSystemInvoice({ productLine, seats: n }),
      })))
      .filter(({ n, bill }) => bill.billedSeats !== n || bill.minimumApplied);
    expect(moved).toEqual([]);
  });

  it('does not bill an empty form — zero members is still zero, not a minimum', () => {
    const bill = buildSystemInvoice({ productLine: 'sacco', seats: 0 });
    expect(bill.billedSeats).toBe(0);
    expect(bill.usageFee).toBe(0);
    expect(bill.minimumApplied).toBe(false);
    expect(lineFor(bill, 'Active member charges')).toBeUndefined();
  });

  it('applies to chamas too — they are priced off the same sacco tiers', () => {
    const bill = buildSystemInvoice({ productLine: 'chama', seats: 1 });
    expect(bill.billedSeats).toBe(MIN_BILLABLE_MEMBERS);
    expect(bill.usageFee).toBe(FLOOR_USAGE);
  });

  it('governs the sacco line only — a company is priced by its own rules', () => {
    // Below the sacco floor but above the Business one: a 3-user company bills
    // 3 seats, never MIN_BILLABLE_MEMBERS of them.
    const bill = buildSystemInvoice({ productLine: 'company', seats: 3 });
    expect(bill.billedSeats).toBe(3);
    expect(bill.minimumApplied).toBe(false);
  });

  it('keeps the printed arithmetic adding up when the floor applies', () => {
    [1, 2, 3, 4].forEach((n) => {
      const bill = buildSystemInvoice({ productLine: 'sacco', seats: n, chargeInstallation: true });
      expect(sumLines(bill), `members=${n}`).toBe(bill.subtotal);
      expect(cents(bill.subtotal + bill.vatAmount), `members=${n}`).toBe(bill.total);
    });
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

  it('keeps a sub-minimum chama on Bronze — and on Bronze’s minimum quantity', () => {
    const bill = buildSystemInvoice({ productLine: 'sacco', seats: 3 });
    expect(bill.tier.id).toBe('bronze');
    expect(bill.billedSeats).toBe(MIN_BILLABLE_MEMBERS);
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

// ─────────────────────────────────────────────────────────────────────────────
/**
 * REGULATORY BILLING — the tax on a bill is the tax that was law when the bill
 * was raised.
 *
 * The rate is no longer a constant in this file: it is resolved from the
 * billing date out of src/config/taxRegulations.js. Three things have to hold
 * for that to be safe.
 *
 *   1. Nothing moved today. The current regime must price exactly as the
 *      constant did — every assertion above already pins that, and these add
 *      the disclosure.
 *   2. History prices at its own rate. An invoice raised under a 14% regime
 *      discloses 14%, whether it is rendered in 2020 or in 2030.
 *   3. A new levy is an addition and nothing else: it raises the total by its
 *      own amount, cannot compound, and cannot break the arithmetic on the
 *      page.
 */
describe('the bill is taxed under the regulations in force when it was raised', () => {
  const COVID = '2020-06-15';    // LN 35/2020 — standard rate 14%
  const NOW   = '2026-09-02';    // LN 206/2020 — back to 16%

  it('discloses the rate that was in force, not today’s', () => {
    expect(buildSystemInvoice({ productLine: 'company', seats: 5, asOf: COVID }).vatRate).toBe(14);
    expect(buildSystemInvoice({ productLine: 'company', seats: 5, asOf: NOW }).vatRate).toBe(16);
  });

  it('leaves the amount payable untouched when a rate changes, because prices include tax', () => {
    // This is what makes a rate change safe to ship: only the split moves. If
    // this ever fails, a live tenant's bill moved and mpesa-stk-push will start
    // refusing signups it used to accept.
    SEATS.forEach((n) => {
      const covid = buildSystemInvoice({ productLine: 'company', seats: n, asOf: COVID });
      const now   = buildSystemInvoice({ productLine: 'company', seats: n, asOf: NOW });
      expect(covid.total, `seats=${n}`).toBe(now.total);
      expect(covid.vatAmount, `seats=${n} vat`).not.toBe(now.vatAmount);
    });
  });

  it('still adds up on the page at a historical rate', () => {
    [1, 5, 17, 60].forEach((n) => {
      const bill = buildSystemInvoice({ productLine: 'sacco', seats: n, asOf: COVID, chargeInstallation: true });
      expect(cents(bill.subtotal + bill.vatAmount), `members=${n}`).toBe(bill.total);
      expect(sumLines(bill), `members=${n} lines`).toBe(bill.subtotal);
    });
  });

  it('names the instrument that priced the bill', () => {
    // "Charged 14%" is a number; "charged under LN 35/2020, which set 14%" is
    // an answer. The row can store the version, and the invoice can cite it.
    const bill = buildSystemInvoice({ productLine: 'company', seats: 5, asOf: COVID });
    expect(bill.taxRegime.version).toBe('2020-04-01');
    expect(bill.taxRegime.instrument).toContain('LN 35/2020');
    expect(bill.taxRegime.beforeHistory).toBe(false);
  });

  it('bills a date it has no schedule for at the earliest rate, and says so', () => {
    const bill = buildSystemInvoice({ productLine: 'company', seats: 5, asOf: '2001-01-01' });
    expect(bill.taxRegime.beforeHistory).toBe(true);
  });

  it('defaults to today when no billing date is given', () => {
    const quoted = buildSystemInvoice({ productLine: 'company', seats: 5 });
    expect(quoted.vatRate).toBe(VAT_RATE);
    expect(quoted.total).toBe(buildSystemInvoice({ productLine: 'company', seats: 5, asOf: NOW }).total);
  });

  it('lets an explicit rate override the regime — exempt supplies still exist', () => {
    // A tenant who is not registered for VAT, or a zero-rated supply, is not a
    // rate change. Passing 0 must mean 0, not "fall back to the standard rate".
    const exempt = buildSystemInvoice({ productLine: 'company', seats: 5, vatRate: 0 });
    expect(exempt.vatRate).toBe(0);
    expect(exempt.vatAmount).toBe(0);
    expect(exempt.subtotal).toBe(exempt.total);
  });
});

describe('a statutory levy is an addition, not a re-slicing', () => {
  const DST = [{ key: 'dst', label: 'Digital service tax', rate: 0.015, basis: 'net', taxable: true }];
  const FLAT = [{ key: 'reg', label: 'Regulator levy', rate: 0.02, basis: 'gross', taxable: false }];

  it('charges nothing while the schedule carries no levies', () => {
    const bill = buildSystemInvoice({ productLine: 'company', seats: 10 });
    expect(bill.levies).toEqual([]);
    expect(bill.levyTotal).toBe(0);
    expect(bill.total).toBe(legacyCompanyTotal(10, false));
  });

  it('raises the total by the levy and the tax on it, and by nothing else', () => {
    const without = buildSystemInvoice({ productLine: 'company', seats: 10 });
    const with_   = buildSystemInvoice({ productLine: 'company', seats: 10, levies: DST });

    const levy = cents(without.subtotal * 0.015);
    expect(with_.levyTotal).toBe(levy);
    expect(with_.total).toBe(cents(without.total + levy * 1.16));
    expect(with_.subtotal).toBe(cents(without.subtotal + levy));
  });

  it('leaves a levy outside the VAT base out of the VAT', () => {
    const without = buildSystemInvoice({ productLine: 'company', seats: 10 });
    const with_   = buildSystemInvoice({ productLine: 'company', seats: 10, levies: FLAT });

    // Charged on the advertised price, and no tax on top of it.
    const levy = cents(cents(10 * planForUsers(10).pricePerUser) * 0.02);
    expect(with_.levyTotal).toBe(levy);
    expect(with_.vatAmount).toBe(without.vatAmount);
    expect(with_.total).toBe(cents(without.total + levy));
  });

  it('prints the levy as its own line, with the authority for it attached', () => {
    const bill = buildSystemInvoice({ productLine: 'company', seats: 10, levies: DST });
    const line = lineFor(bill, 'Digital service tax');
    expect(line).toBeDefined();
    expect(line.levy.key).toBe('dst');
    expect(line.levy.rate).toBe(0.015);
  });

  it('keeps the page adding up once levies are on it', () => {
    [[], DST, FLAT, [...DST, ...FLAT]].forEach((levies, i) => {
      [1, 10, 40].forEach((n) => {
        const bill = buildSystemInvoice({ productLine: 'company', seats: n, levies, chargeInstallation: true });
        expect(cents(bill.subtotal + bill.vatAmount), `case ${i} seats=${n}`).toBe(bill.total);
        expect(sumLines(bill), `case ${i} seats=${n} lines`).toBe(bill.subtotal);
      });
    });
  });

  it('never lets one levy compound on another', () => {
    // Two 10% levies on the same bill come to 10% + 10%, not 10% + 11%. If they
    // compounded, the total would depend on the order of the array.
    const ten = [
      { key: 'a', label: 'Levy A', rate: 0.10, basis: 'net', taxable: true },
      { key: 'b', label: 'Levy B', rate: 0.10, basis: 'net', taxable: true },
    ];
    const base = buildSystemInvoice({ productLine: 'company', seats: 10 });
    const bill = buildSystemInvoice({ productLine: 'company', seats: 10, levies: ten });
    const reversed = buildSystemInvoice({ productLine: 'company', seats: 10, levies: [...ten].reverse() });

    // Each levy is its own charge and rounds to the cent on its own line, so
    // the total is the sum of two rounded tenths — not one rounded fifth. What
    // matters is that both bit on the SAME base.
    const each = cents(base.subtotal * 0.10);
    expect(bill.levies.map((l) => l.amount)).toEqual([each, each]);
    expect(bill.levyTotal).toBe(cents(each * 2));
    expect(reversed.total).toBe(bill.total);
  });
});

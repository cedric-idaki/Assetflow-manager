/**
 * Pricing lives in three places and they must agree:
 *
 *   src/config/companyPlans.js              — the company catalogue
 *   src/config/saccoTiers.js                — the sacco catalogue
 *   supabase/functions/_shared/plans.ts     — the server-side price check
 *
 * src/config/systemBilling.js is the fourth file but not a fourth copy: it
 * reads the two catalogues above and is what the wizard, both invoice
 * renderers and the quote all price through. plans.ts mirrors ITS rules —
 * VAT treatment, module fees, what each plan bundles — as well as the numbers.
 *
 * The third copy exists because mpesa-stk-push has to verify that the amount a
 * browser posted is actually what the plan costs, and a Deno edge function
 * cannot import the frontend bundle. That check is only as good as its numbers:
 * if the server catalog drifts, it either waves through underpayments or (once
 * enforcement is switched on) rejects legitimate signups.
 *
 * So this test reads the TypeScript catalog as text and asserts it still matches
 * the JS ones. Change a price in one file and this fails until you change it in
 * all three — which is the point.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { COMPANY_PLANS, INSTALLATION_FEE as COMPANY_INSTALLATION_FEE, planForUsers, MIN_BILLABLE_USERS } from './companyPlans';
import {
  SACCO_TIERS,
  INSTALLATION_FEE as SACCO_INSTALLATION_FEE,
  tierForMembers,
  MIN_BILLABLE_MEMBERS,
} from './saccoTiers';
import {
  expectedSubscriptionPrice,
  acceptableSubscriptionPrices,
  priceSystemInvoice as serverPriceSystemInvoice,
  resolveTaxRegime as serverResolveTaxRegime,
  VAT_RATE as serverVatRate,
  VAT_INCLUSIVE_PRICES as serverVatInclusive,
} from '../../supabase/functions/_shared/plans.ts';
import {
  buildSystemInvoice,
  registrationTotal,
  VAT_RATE,
  VAT_INCLUSIVE_PRICES,
  DEFAULT_MODULE_FEE,
  MODULE_FEES,
} from './systemBilling';
import { TAX_REGIMES, resolveTaxRegime } from './taxRegulations';
import { PRESETS } from './modules';

const SERVER_CATALOG = resolve(process.cwd(), 'supabase/functions/_shared/plans.ts');

/** Pull the object literals following a marker out of the .ts source. */
function parseCatalog(source, marker) {
  const from = source.indexOf(marker);
  if (from === -1) throw new Error(`Marker not found in plans.ts: ${marker}`);
  const body = source.slice(from);
  const end = body.indexOf('\n];');
  const list = body.slice(0, end === -1 ? body.length : end);

  return [...list.matchAll(/\{([^{}]*)\}/gs)].map((match) => {
    const fields = match[1];
    const num = (key) => {
      const hit = new RegExp(`${key}\\s*:\\s*(-?\\d+)`).exec(fields);
      return hit ? Number(hit[1]) : null;
    };
    const id = /id\s*:\s*'(\w+)'/.exec(fields);
    return {
      id: id ? id[1] : null,
      pricePerUser: num('pricePerUser'),
      minUsers: num('minUsers'),
      baseFee: num('baseFee'),
      perMemberFee: num('perMemberFee'),
      minMembers: num('minMembers'),
    };
  });
}

/**
 * Pull the TAX_REGIMES table out of the .ts source as text.
 *
 * Read as SOURCE rather than imported so a regime that only exists in the
 * frontend table cannot be papered over by the import resolving — the point is
 * to compare two files, not to compare a file with itself.
 */
function parseRegimes(source) {
  const from = source.indexOf('export const TAX_REGIMES');
  if (from === -1) throw new Error('plans.ts has no TAX_REGIMES table');
  const body = source.slice(from);
  const list = body.slice(0, body.indexOf('\n];'));

  // Each regime is one brace pair containing a nested `levies: [...]`, so the
  // outer objects are split on the entry marker rather than matched as braces.
  return list
    .split(/\n\s*\{\n/)
    .slice(1)
    .map((entry) => {
      const str = (key) => new RegExp(`${key}\\s*:\\s*'([^']*)'`).exec(entry)?.[1] ?? null;
      const levies = /levies\s*:\s*\[([^\]]*)\]/.exec(entry)?.[1] ?? '';
      return {
        version: str('version'),
        effectiveFrom: str('effectiveFrom'),
        vatRate: Number(/vatRate\s*:\s*([\d.]+)/.exec(entry)?.[1]),
        pricesIncludeTax: /pricesIncludeTax\s*:\s*(true|false)/.exec(entry)?.[1] === 'true',
        levyCount: (levies.match(/\bkey\s*:/g) || []).length,
      };
    });
}

const source = readFileSync(SERVER_CATALOG, 'utf8');

describe('server price catalog matches the frontend catalogs', () => {
  it('company plans agree on id, price per user and tier boundary', () => {
    const server = parseCatalog(source, 'const COMPANY_PLANS');

    expect(server).toHaveLength(COMPANY_PLANS.length);
    expect(server.map((p) => p.id)).toEqual(COMPANY_PLANS.map((p) => p.id));

    server.forEach((row, i) => {
      expect(row.pricePerUser, `${row.id} pricePerUser`).toBe(COMPANY_PLANS[i].pricePerUser);
      expect(row.minUsers, `${row.id} minUsers`).toBe(COMPANY_PLANS[i].minUsers);
      // 0 today — the corporate line is purely per-seat. It is asserted anyway
      // so that giving the plans a base fee cannot land on one side only.
      expect(row.baseFee, `${row.id} baseFee`).toBe(COMPANY_PLANS[i].baseFee);
    });
  });

  it('sacco tiers agree on id, base fee, per-member fee and tier boundary', () => {
    const server = parseCatalog(source, 'const SACCO_TIERS');

    expect(server).toHaveLength(SACCO_TIERS.length);
    expect(server.map((t) => t.id)).toEqual(SACCO_TIERS.map((t) => t.id));

    server.forEach((row, i) => {
      expect(row.baseFee, `${row.id} baseFee`).toBe(SACCO_TIERS[i].baseFee);
      expect(row.perMemberFee, `${row.id} perMemberFee`).toBe(SACCO_TIERS[i].perMemberFee);
      expect(row.minMembers, `${row.id} minMembers`).toBe(SACCO_TIERS[i].minMembers);
    });
  });

  it('installation fee agrees across all three', () => {
    const fee = Number(/INSTALLATION_FEE\s*=\s*(\d+)/.exec(source)[1]);
    expect(fee).toBe(COMPANY_INSTALLATION_FEE);
    expect(fee).toBe(SACCO_INSTALLATION_FEE);
  });

  it('the minimum billed user and member counts agree on both sides', () => {
    // Drift here is invisible in the catalogue — the plans and prices still
    // match — but every signup below a floor would be quoted one figure by the
    // browser and refused at another by the server.
    const users = Number(/MIN_BILLABLE_USERS\s*=\s*(\d+)/.exec(source)[1]);
    expect(users).toBe(MIN_BILLABLE_USERS);

    const members = Number(/MIN_BILLABLE_MEMBERS\s*=\s*(\d+)/.exec(source)[1]);
    expect(members).toBe(MIN_BILLABLE_MEMBERS);
    // The sacco floor is Bronze's own advertised minimum. Re-cut the tier and
    // the floor has to move with it, or the tier card promises one price and
    // the invoice charges another.
    expect(members).toBe(SACCO_TIERS[0].minMembers);
  });
});

/**
 * The catalog comparison above checks the NUMBERS agree. This checks the
 * FORMULAS do, which is what actually decides whether a registration is let
 * through: mpesa-stk-push now REFUSES a subscription push whose amount is not
 * exactly expectedSubscriptionPrice(). If the wizard's arithmetic and the
 * server's ever diverge — a rounding change, a fee applied in one place only —
 * every signup at the affected seat count starts failing at the payment step.
 *
 * So: recompute the wizard's total the way admin-registration/index.jsx does,
 * and require it to equal the server's figure at every seat count.
 */
describe('wizard total equals the server expected price', () => {
  /**
   * The wizard no longer does its own arithmetic — it calls the engine, so the
   * test calls the same entry point rather than re-deriving the formula and
   * hoping the copy stays faithful.
   */
  const wizardTotal = (isSacco, seats) =>
    registrationTotal({ productLine: isSacco ? 'sacco' : 'company', seats });

  const seatCounts = Array.from({ length: 200 }, (_, i) => i + 1);

  it('agrees for every company seat count from 1 to 200', () => {
    const disagreements = seatCounts
      .map((n) => ({ n, wizard: wizardTotal(false, n), server: expectedSubscriptionPrice({ isSacco: false, seats: n }) }))
      .filter((row) => row.wizard !== row.server);

    expect(disagreements).toEqual([]);
  });

  it('agrees for every sacco member count from 1 to 200', () => {
    const disagreements = seatCounts
      .map((n) => ({ n, wizard: wizardTotal(true, n), server: expectedSubscriptionPrice({ isSacco: true, seats: n }) }))
      .filter((row) => row.wizard !== row.server);

    expect(disagreements).toEqual([]);
  });

  it('crosses the company tier boundaries at the same seat counts', () => {
    // 5→6 (bronze→silver) and 16→17 (silver→gold) are where an off-by-one in
    // either catalog would show up as a price jump on the wrong side.
    [5, 6, 16, 17].forEach((n) => {
      expect(wizardTotal(false, n), `company seats=${n}`).toBe(
        expectedSubscriptionPrice({ isSacco: false, seats: n }),
      );
    });
  });

  it('crosses the sacco tier boundaries at the same member counts', () => {
    [4, 5, 50, 51, 110, 111].forEach((n) => {
      expect(wizardTotal(true, n), `sacco members=${n}`).toBe(
        expectedSubscriptionPrice({ isSacco: true, seats: n }),
      );
    });
  });

  it('agrees on the 2-user minimum for a one-person company', () => {
    // The seat count the browser posts is untrusted, so the floor has to be
    // applied server-side too, not merely displayed in the wizard.
    const plan = planForUsers(MIN_BILLABLE_USERS);
    const expected = MIN_BILLABLE_USERS * plan.pricePerUser + COMPANY_INSTALLATION_FEE;
    expect(expectedSubscriptionPrice({ isSacco: false, seats: 1 })).toBe(expected);
    expect(wizardTotal(false, 1)).toBe(expected);
  });

  it('agrees on the 5-member minimum for a sub-minimum sacco', () => {
    // The same hole on the sacco side: the member count is posted by the
    // browser, so a chama that types 1 has to be priced on MIN_BILLABLE_MEMBERS
    // by the server too, or enforcement refuses the very signups the floor
    // was written to cover.
    const tier = tierForMembers(MIN_BILLABLE_MEMBERS);
    const expected = tier.baseFee + MIN_BILLABLE_MEMBERS * tier.perMemberFee + SACCO_INSTALLATION_FEE;

    [1, 2, 3, 4].forEach((n) => {
      expect(expectedSubscriptionPrice({ isSacco: true, seats: n }), `server members=${n}`).toBe(expected);
      expect(wizardTotal(true, n), `wizard members=${n}`).toBe(expected);
    });
  });

  it('does not price any plan at KES 1 — the hole enforcement closes', () => {
    // /admin-registration is a public route and the amount used to be taken on
    // trust, so KES 1 bought a month. Nothing legitimate costs that.
    seatCounts.forEach((n) => {
      expect(expectedSubscriptionPrice({ isSacco: false, seats: n })).toBeGreaterThan(1);
      expect(expectedSubscriptionPrice({ isSacco: true, seats: n })).toBeGreaterThan(1);
    });
  });

  it('returns null for a seat count no tier covers, so the push is refused', () => {
    [0, -1, NaN].forEach((n) => {
      expect(expectedSubscriptionPrice({ isSacco: false, seats: n }), `seats=${n}`).toBeNull();
      expect(expectedSubscriptionPrice({ isSacco: true, seats: n }), `seats=${n}`).toBeNull();
    });
  });
});

/**
 * The catalogues agree on PRICE. These check the two sides agree on the RULES
 * that turn a price into an amount — the VAT treatment, what a module costs,
 * and what a plan already bundles. Any one of them drifting moves the total on
 * exactly one side of the wire, and mpesa-stk-push then refuses every signup
 * with a PRICE MISMATCH that names no cause.
 */
describe('server mirrors the billing rules, not just the numbers', () => {
  it('agrees on the whole tax schedule, entry for entry', () => {
    // Not just today's rate: the schedule is resolved BY DATE on both sides,
    // so a regime that exists in one file and not the other prices a bill
    // differently the day it comes into force. Comparing the tables entry for
    // entry is what makes adding a rate change a two-file edit that fails
    // loudly when only one lands.
    const server = parseRegimes(source);

    expect(server).toHaveLength(TAX_REGIMES.length);
    server.forEach((row, i) => {
      const local = TAX_REGIMES[i];
      expect(row.version, `regime ${i} version`).toBe(local.version);
      expect(row.effectiveFrom, `${local.version} effectiveFrom`).toBe(local.effectiveFrom);
      expect(row.vatRate, `${local.version} vatRate`).toBe(local.vatRate);
      expect(row.pricesIncludeTax, `${local.version} pricesIncludeTax`).toBe(local.pricesIncludeTax);
      // Every regime's levy list is empty today. Asserting it anyway means a
      // levy priced on one side only cannot reach production: it would raise
      // the browser's total and not the server's, and every signup would be
      // refused with a mismatch that names no cause.
      expect(row.levyCount, `${local.version} levies`).toBe((local.levies || []).length);
    });
  });

  it('resolves the same regime for the same date on both sides', () => {
    // The tables can match while the lookup rules drift — an inclusive vs
    // exclusive boundary comparison would put a bill raised ON a changeover
    // date under different regimes on the two sides.
    const dates = [
      '2013-09-01', '2013-09-02',           // before / on the earliest entry
      '2020-03-31', '2020-04-01', '2020-12-31',
      '2021-01-01', '2026-09-02',
      '2026-09',                             // a 'YYYY-MM' period → month end
    ];
    dates.forEach((d) => {
      expect(serverResolveTaxRegime(d).version, `asOf ${d}`).toBe(resolveTaxRegime(d).version);
    });
  });

  it('agrees on today’s rate and whether prices include it', () => {
    // The constants both files derive from their schedules — what an
    // invoice raised right now is charged at.
    expect(serverVatRate).toBe(VAT_RATE);
    expect(serverVatInclusive).toBe(VAT_INCLUSIVE_PRICES);
  });

  it('accepts exactly one price per plan while no rate change is landing today', () => {
    // acceptableSubscriptionPrices() widens to two figures ONLY on the day a
    // new tax regime comes into force, so a page loaded under the old rate can
    // still pay. Any other day it must be a single number, or the check has
    // quietly stopped being a check.
    const changingToday = TAX_REGIMES.some((r) => r.effectiveFrom === new Date().toISOString().slice(0, 10));

    [1, 2, 5, 6, 17, 60, 120].forEach((n) => {
      [false, true].forEach((isSacco) => {
        const accepted = acceptableSubscriptionPrices({ isSacco, seats: n });
        expect(accepted[0], `seats=${n} sacco=${isSacco}`).toBe(expectedSubscriptionPrice({ isSacco, seats: n }));
        if (!changingToday) {
          expect(accepted, `seats=${n} sacco=${isSacco}`).toHaveLength(1);
        } else {
          // On a changeover day, never more than one regime back.
          expect(accepted.length, `seats=${n} sacco=${isSacco}`).toBeLessThanOrEqual(2);
        }
      });
    });
  });

  it('refuses a malformed claim rather than accepting any price for it', () => {
    [0, -1, NaN].forEach((n) => {
      expect(acceptableSubscriptionPrices({ isSacco: false, seats: n }), `seats=${n}`).toBeNull();
      expect(acceptableSubscriptionPrices({ isSacco: true, seats: n }), `seats=${n}`).toBeNull();
    });
  });

  it('prices a statutory levy identically on both sides, before one ever ships', () => {
    // There are no levies today, so nothing exercises this arithmetic in
    // production — which is exactly why it is exercised here. The day a levy
    // is added to the schedule it lands on both sides at once, and a rounding
    // or basis difference between the two engines would refuse every signup
    // with a mismatch of a few shillings and no stated cause. Both bases and
    // both taxabilities are covered, since they take different paths.
    const cases = [
      [{ key: 'dst', label: 'Digital service tax', instrument: 'x', rate: 0.015, basis: 'net', taxable: true }],
      [{ key: 'reg', label: 'Regulator levy', instrument: 'x', rate: 0.02, basis: 'gross', taxable: false }],
      [
        { key: 'a', label: 'A', instrument: 'x', rate: 0.015, basis: 'net', taxable: true },
        { key: 'b', label: 'B', instrument: 'x', rate: 0.005, basis: 'gross', taxable: false },
      ],
    ];

    cases.forEach((levies, i) => {
      [1, 2, 5, 6, 17, 60, 137].forEach((n) => {
        [false, true].forEach((isSacco) => {
          const productLine = isSacco ? 'sacco' : 'company';
          const browser = buildSystemInvoice({ productLine, seats: n, chargeInstallation: true, levies });
          const server = serverPriceSystemInvoice({ isSacco, seats: n, productLine, chargeInstallation: true, levies });
          const where = `case ${i} seats=${n} sacco=${isSacco}`;

          expect(server, where).not.toBeNull();
          expect(server.levyTotal, `${where} levyTotal`).toBe(browser.levyTotal);
          expect(server.subtotal, `${where} subtotal`).toBe(browser.subtotal);
          expect(server.vatAmount, `${where} vat`).toBe(browser.vatAmount);
          expect(Math.round(server.total), `${where} total`).toBe(Math.round(browser.total));
        });
      });
    });
  });

  it('agrees on the default module fee', () => {
    const fee = Number(/DEFAULT_MODULE_FEE\s*=\s*(\d+)/.exec(source)[1]);
    expect(fee).toBe(DEFAULT_MODULE_FEE);
  });

  it('agrees on what each product line already bundles', () => {
    const block = source.slice(source.indexOf('export const PRESETS'));
    Object.entries(PRESETS).forEach(([line, keys]) => {
      const hit = new RegExp(`${line}:\\s*\\[([^\\]]*)\\]`).exec(block);
      expect(hit, `plans.ts has no PRESETS.${line}`).not.toBeNull();
      const serverKeys = [...hit[1].matchAll(/'([\w_]+)'/g)].map((m) => m[1]);
      expect(serverKeys, `PRESETS.${line}`).toEqual(keys);
    });
  });

  it('prices every module at zero on both sides — modules are bundled today', () => {
    // The engine computes the line whatever the fee is; this records that no
    // module is chargeable yet, so pricing one is a deliberate, visible change
    // on BOTH sides rather than a silent bill increase on one.
    expect(Object.values(MODULE_FEES).every((f) => f === 0)).toBe(true);
    expect(/export const MODULE_FEES: Record<string, number> = \{\};/.test(source)).toBe(true);
  });
});

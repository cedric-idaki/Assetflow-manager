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
import { COMPANY_PLANS, INSTALLATION_FEE as COMPANY_INSTALLATION_FEE, planForUsers } from './companyPlans';
import { SACCO_TIERS, INSTALLATION_FEE as SACCO_INSTALLATION_FEE, tierForMembers } from './saccoTiers';
import { expectedSubscriptionPrice } from '../../supabase/functions/_shared/plans.ts';
import {
  registrationTotal,
  VAT_RATE,
  VAT_INCLUSIVE_PRICES,
  DEFAULT_MODULE_FEE,
  MODULE_FEES,
} from './systemBilling';
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
    // 5→6 (silver→bronze) and 16→17 (bronze→gold) are where an off-by-one in
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
  it('agrees on the VAT rate and whether prices include it', () => {
    const rate = Number(/VAT_RATE\s*=\s*(\d+)/.exec(source)[1]);
    const inclusive = /VAT_INCLUSIVE_PRICES\s*=\s*(true|false)/.exec(source)[1] === 'true';
    expect(rate).toBe(VAT_RATE);
    expect(inclusive).toBe(VAT_INCLUSIVE_PRICES);
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

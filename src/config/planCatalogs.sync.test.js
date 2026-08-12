/**
 * Pricing lives in three places and they must agree:
 *
 *   src/config/companyPlans.js              — the company registration wizard
 *   src/config/saccoTiers.js                — the sacco registration wizard
 *   supabase/functions/_shared/plans.ts     — the server-side price check
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
import { COMPANY_PLANS, INSTALLATION_FEE as COMPANY_INSTALLATION_FEE } from './companyPlans';
import { SACCO_TIERS, INSTALLATION_FEE as SACCO_INSTALLATION_FEE } from './saccoTiers';

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

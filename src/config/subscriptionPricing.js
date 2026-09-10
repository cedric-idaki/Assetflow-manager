/**
 * SUBSCRIPTION & BILLING PAGE — presentation adapter over the real catalogue.
 *
 * WHY THIS FILE NO LONGER HOLDS ANY PRICES
 * It used to declare its own. Corporate tiers were KES 240 / 320 / 390 per user
 * against a catalogue that charges 305 / 360 / 267; sacco tiers were a 200/300/
 * 400 base with a flat KES 50 per member against a real 500/700/900 base with
 * 44/36/27. It knew nothing about the installation fee, nothing about modules
 * and nothing about VAT, and it billed a flat rate for "external document
 * signings" — a charge that exists in no other file, no migration and no
 * invoice the platform has ever raised.
 *
 * So the super admin's pricing screen quoted numbers the business does not
 * charge, and a total missing two of the five components of a real bill. This
 * file now declares NO number of its own. Tiers are projected from
 * companyPlans.js / saccoTiers.js, and every total is priced by
 * buildSystemInvoice() — the same engine behind the registration quote, both
 * invoice renderers and the server-side price check. Drift is not fixed here;
 * it is made impossible, because there is nothing left to drift.
 *
 * What remains is presentation: the page wants tiers keyed by id and a colour
 * per tier, which the catalogue has no business carrying.
 *
 * @see src/config/systemBilling.js  — the pricing engine
 * @see src/config/taxRegulations.js — VAT and levies, by date
 */

import {
  COMPANY_PLANS,
  INSTALLATION_FEE as COMPANY_INSTALLATION_FEE,
} from './companyPlans';
import {
  SACCO_TIERS as SACCO_TIER_LIST,
  INSTALLATION_FEE as SACCO_INSTALLATION_FEE,
} from './saccoTiers';
import { buildSystemInvoice } from './systemBilling';

export const CLIENT_TYPE = {
  CORPORATE: 'corporate',
  SACCO: 'sacco',
};

export const TIER = {
  SILVER: 'silver',
  BRONZE: 'bronze',
  GOLD: 'gold',
};

/**
 * The engine speaks product lines, the page speaks client types. A sacco and a
 * chama price identically off the sacco tiers; this screen only distinguishes
 * corporate from sacco, so 'chama' never reaches it.
 */
export const productLineFor = (clientType) =>
  clientType === CLIENT_TYPE.SACCO ? 'sacco' : 'company';

/** One-time onboarding fee for a client type — first invoice only. */
export const installationFeeFor = (clientType) =>
  clientType === CLIENT_TYPE.SACCO ? SACCO_INSTALLATION_FEE : COMPANY_INSTALLATION_FEE;

// ── Presentation ─────────────────────────────────────────────────────────────
/**
 * Colour per tier. The ONLY thing this file is entitled to decide: a plan
 * catalogue should not carry hex codes, and a badge should not carry prices.
 */
const TIER_CHROME = {
  bronze: { color: '#92400E', bg: '#FEF3C7', accent: '#D97706', icon: 'Award' },
  silver: { color: '#374151', bg: '#F3F4F6', accent: '#6B7280', icon: 'Shield' },
  gold:   { color: '#78350F', bg: '#FEF9C3', accent: '#CA8A04', icon: 'Crown' },
};

const chromeFor = (id) => TIER_CHROME[id] || TIER_CHROME.silver;

/**
 * Project a catalogue array into the id-keyed map the page renders from.
 * Insertion order is preserved, so Object.entries() walks the tiers in
 * catalogue order (entry level first) rather than alphabetically.
 */
const keyBy = (list, project) =>
  Object.freeze(
    list.reduce((acc, entry) => {
      acc[entry.id] = Object.freeze({ ...project(entry), ...chromeFor(entry.id) });
      return acc;
    }, {}),
  );

/** Corporate tiers — per licensed user, per month. Numbers from companyPlans.js. */
export const CORPORATE_TIERS = keyBy(COMPANY_PLANS, (p) => ({
  id: p.id,
  label: p.name,
  pricePerUser: p.pricePerUser,
  baseFee: p.baseFee || 0,
  storageGb: p.storageGb,
  range: p.userRange,
  minUsers: p.minUsers,
  maxUsers: p.maxUsers,
  internalStaff: 'Unlimited',
}));

/** SACCO tiers — monthly base + per active member. Numbers from saccoTiers.js. */
export const SACCO_TIERS = keyBy(SACCO_TIER_LIST, (t) => ({
  id: t.id,
  label: t.name,
  baseFee: t.baseFee,
  perMemberFee: t.perMemberFee,
  storageGb: t.storageGb,
  range: t.memberRange,
  minMembers: t.minMembers,
  maxMembers: t.maxMembers,
}));

/** The tier map for a client type. */
export const tiersFor = (clientType) =>
  clientType === CLIENT_TYPE.SACCO ? SACCO_TIERS : CORPORATE_TIERS;

/** The tier a client type defaults to — the entry-level one in the catalogue. */
export const defaultTierFor = (clientType) => Object.keys(tiersFor(clientType))[0];

// ── Pricing ──────────────────────────────────────────────────────────────────
/**
 * Price one subscription for the page, itemised.
 *
 * Everything is delegated: this is buildSystemInvoice() with the page's
 * vocabulary translated into the engine's, so a quote on this screen and the
 * invoice the tenant is actually sent are the same arithmetic.
 *
 * @param {string}   clientType          CLIENT_TYPE.CORPORATE | CLIENT_TYPE.SACCO
 * @param {string}  [tierId]             force a tier; otherwise derived from the count
 * @param {number}  [seats]              licensed users, or active members for a sacco
 * @param {string[]}[modules]            module keys enabled beyond the plan's bundle
 * @param {number}  [storageGb]          storage used, for the excess charge
 * @param {boolean} [chargeInstallation] true for a first invoice, false for a renewal
 * @param {string|Date} [asOf]           billing date — picks the VAT regime
 */
export function quoteSubscription({
  clientType = CLIENT_TYPE.CORPORATE,
  tierId = null,
  seats = 0,
  modules = null,
  storageGb = 0,
  chargeInstallation = false,
  asOf = null,
} = {}) {
  return buildSystemInvoice({
    productLine: productLineFor(clientType),
    tierId,
    seats,
    modules,
    storageGb,
    chargeInstallation,
    asOf,
  });
}

/**
 * Recurring monthly total for a corporate client, VAT included — what a
 * renewal costs, so no installation fee.
 */
export const calcCorporateTotal = (tierId, users = 0, opts = {}) =>
  quoteSubscription({ ...opts, clientType: CLIENT_TYPE.CORPORATE, tierId, seats: users });

/** Recurring monthly total for a sacco client, VAT included. */
export const calcSaccoTotal = (tierId, members = 0, opts = {}) =>
  quoteSubscription({ ...opts, clientType: CLIENT_TYPE.SACCO, tierId, seats: members });

export { COMPANY_INSTALLATION_FEE, SACCO_INSTALLATION_FEE };

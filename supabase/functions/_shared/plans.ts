// Server-side subscription pricing.
//
// WHY THIS FILE EXISTS: the amount an admin pays for portal access arrives from
// their browser (admin-registration computes `totalPrice` and posts it to
// mpesa-stk-push). Nothing server-side has ever checked it, and
// /admin-registration is a public route — so the price was whatever the payer
// said it was.
//
// SOURCE OF TRUTH WARNING: these numbers mirror src/config/companyPlans.js,
// src/config/saccoTiers.js and src/config/systemBilling.js. Deno cannot import
// those (different bundle), and public.subscription_plans is only ever read for
// its `id` — the app stores no price there. So this is a third copy, and a
// third copy drifts. If subscription_plans is given real price columns, replace
// the tables below with a read from it and delete them. Until then, any price
// change must be made in all three places.
//
// The formula matches src/config/systemBilling.js exactly:
//   base system price + user/member charges + additional modules + installation
// where the usage charge is floored at MIN_BILLABLE_USERS seats for a company
// and MIN_BILLABLE_MEMBERS members for a sacco / chama,
// with VAT then either backed out of that (prices tax-inclusive, the current
// setting, total unchanged) or added on top of it.
// The installation fee is first-registration only; renewals must not re-charge
// it, which is why chargeInstallation is a parameter rather than an assumption.

export const INSTALLATION_FEE = 4000; // KES, both product lines

/**
 * BUSINESS MINIMUM BILLING. Mirrors MIN_BILLABLE_USERS in
 * src/config/companyPlans.js: a Business (company) subscription is priced on at
 * least this many licensed users, so a one-person signup pays for two. Sacco
 * and chama tenants have their own floor — MIN_BILLABLE_MEMBERS, below.
 *
 * The floor is applied to the user charge only — installation and any other
 * applicable charge are added on top of it, exactly as before.
 *
 * If this number ever disagrees with the browser's, every registration at the
 * affected seat count is refused with SUBSCRIPTION_PRICE_MISMATCH. Change one,
 * change both; src/config/planCatalogs.sync.test.js fails until you do.
 */
export const MIN_BILLABLE_USERS = 2;

/** Mirrors billableUsers() in companyPlans.js. Idempotent. */
export function billableUsers(n: number): number {
  const seats = Math.max(0, Math.floor(Number(n) || 0));
  return seats < 1 ? 0 : Math.max(seats, MIN_BILLABLE_USERS);
}

/**
 * SACCO MINIMUM BILLING. Mirrors MIN_BILLABLE_MEMBERS in
 * src/config/saccoTiers.js: a sacco / chama subscription is priced on at least
 * this many active members, so a three-member chama pays for five. It is the
 * count Bronze already advertises as its floor.
 *
 * As with the Business floor, it lifts the per-member charge only — the tier's
 * base fee, installation and any other applicable charge are added on top of it
 * unchanged.
 *
 * If this number ever disagrees with the browser's, every sacco registration
 * below the floor is refused with SUBSCRIPTION_PRICE_MISMATCH. Change one,
 * change both; src/config/planCatalogs.sync.test.js fails until you do.
 */
export const MIN_BILLABLE_MEMBERS = 5;

/** Mirrors billableMembers() in saccoTiers.js. Idempotent. */
export function billableMembers(n: number): number {
  const members = Math.max(0, Math.floor(Number(n) || 0));
  return members < 1 ? 0 : Math.max(members, MIN_BILLABLE_MEMBERS);
}

// ─────────────────────────────────────────────────────────────────────────────
// TAX REGIMES — mirrors src/config/taxRegulations.js.
//
// VAT is not a constant on either side any more: it is set by an instrument
// with a date on it, so the rate, whether catalogue prices already contain it,
// and any other statutory levy are all resolved from the date the bill is
// raised. That is what lets a rate change take effect by date rather than by
// deploy, and what stops a reprinted invoice being restated at today's rate.
//
// This table must stay identical to the frontend one. If it drifts, and a
// regime is not tax-inclusive, the browser quotes one total and this check
// expects another — every signup is refused with SUBSCRIPTION_PRICE_MISMATCH.
// src/config/planCatalogs.sync.test.js compares the two and fails first.
// ─────────────────────────────────────────────────────────────────────────────

/** Percentage of the VAT-exclusive value of the supply. */
export const BASIS_NET = 'net';
/** Percentage of the advertised, VAT-inclusive price. */
export const BASIS_GROSS = 'gross';

export interface TaxLevy {
  key: string;
  label: string;
  instrument?: string;
  rate: number;
  basis: string;
  taxable: boolean;
}

export interface TaxRegime {
  version: string;
  label: string;
  instrument: string;
  effectiveFrom: string;
  vatRate: number;
  pricesIncludeTax: boolean;
  levies: TaxLevy[];
}

export const TAX_REGIMES: TaxRegime[] = [
  {
    version: '2013-09-02',
    label: 'VAT Act 2013 — standard rate 16%',
    instrument: 'Value Added Tax Act, 2013 (No. 35 of 2013), s.5(2)(b)',
    effectiveFrom: '2013-09-02',
    vatRate: 16,
    pricesIncludeTax: true,
    levies: [],
  },
  {
    version: '2020-04-01',
    label: 'COVID-19 rate reduction — standard rate 14%',
    instrument: 'Value Added Tax (Amendment of the Rate of Tax) Order, 2020 (LN 35/2020)',
    effectiveFrom: '2020-04-01',
    vatRate: 14,
    pricesIncludeTax: true,
    levies: [],
  },
  {
    version: '2021-01-01',
    label: 'Rate reduction revoked — standard rate back to 16%',
    instrument: 'Value Added Tax (Amendment of the Rate of Tax) (Revocation) Order, 2020 (LN 206/2020)',
    effectiveFrom: '2021-01-01',
    vatRate: 16,
    pricesIncludeTax: true,
    levies: [],
  },
  // NEXT REGIME GOES HERE — and in src/config/taxRegulations.js, same entry.
];

/** Mirrors today() in taxRegulations.js. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Mirrors asOfDate() in taxRegulations.js. */
function asOfDate(value: string | Date | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, m] = s.split('-').map(Number);
    if (m < 1 || m > 12) return null;
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** Mirrors resolveTaxRegime() in taxRegulations.js. */
export function resolveTaxRegime(asOf?: string | Date | null): TaxRegime {
  const date = asOfDate(asOf ?? null);
  const newest = TAX_REGIMES[TAX_REGIMES.length - 1];
  if (!date) return newest;
  const inForce = TAX_REGIMES.filter((r) => r.effectiveFrom <= date);
  return inForce.length === 0 ? TAX_REGIMES[0] : inForce[inForce.length - 1];
}

/** The regime in force immediately before the one governing `asOf`, if any. */
export function previousTaxRegime(asOf?: string | Date | null): TaxRegime | null {
  const current = resolveTaxRegime(asOf);
  const i = TAX_REGIMES.findIndex((r) => r.version === current.version);
  return i > 0 ? TAX_REGIMES[i - 1] : null;
}

/** TODAY's standard rate — for a price being quoted right now. */
export const VAT_RATE = resolveTaxRegime(today()).vatRate;

/**
 * Whether TODAY's catalogue figures already contain VAT. True means the
 * payable total is unchanged by a rate change and the tax is only disclosed on
 * the invoice; false makes the catalogue net and adds the tax on top.
 */
export const VAT_INCLUSIVE_PRICES = resolveTaxRegime(today()).pricesIncludeTax;

/**
 * Monthly fee for a module beyond what the plan bundles. Mirrors MODULE_FEES in
 * src/config/systemBilling.js, where every module is 0 because every module is
 * currently included. A key absent here falls back to DEFAULT_MODULE_FEE.
 */
export const DEFAULT_MODULE_FEE = 0;
export const MODULE_FEES: Record<string, number> = {};

/**
 * What each product line's plan already covers. Mirrors PRESETS in
 * src/config/modules.js — a module NOT in this list is an extra and is billed.
 */
export const PRESETS: Record<string, string[]> = {
  company: ['clients', 'assets', 'pos', 'hire_purchase', 'payments', 'mpesa', 'kyc', 'esign', 'contracts', 'crm', 'reports'],
  sacco: ['members', 'clients', 'contributions', 'loans', 'shares', 'voting', 'payments', 'mpesa', 'accounting', 'esign', 'reports', 'fixed_assets'],
  chama: ['members', 'clients', 'contributions', 'mgr', 'welfare', 'payments', 'mpesa', 'reports'],
  custom: ['clients', 'payments'],
};

interface CompanyPlan {
  id: string;
  pricePerUser: number;
  baseFee: number;
  minUsers: number;
  maxUsers: number | null;
}

interface SaccoTier {
  id: string;
  baseFee: number;
  perMemberFee: number;
  minMembers: number;
  maxMembers: number | null;
}

const COMPANY_PLANS: CompanyPlan[] = [
  { id: 'silver', pricePerUser: 305, baseFee: 0, minUsers: 1, maxUsers: 5 },
  { id: 'bronze', pricePerUser: 360, baseFee: 0, minUsers: 6, maxUsers: 16 },
  { id: 'gold', pricePerUser: 267, baseFee: 0, minUsers: 17, maxUsers: null },
];

const SACCO_TIERS: SaccoTier[] = [
  { id: 'bronze', baseFee: 500, perMemberFee: 44, minMembers: 5, maxMembers: 50 },
  { id: 'silver', baseFee: 700, perMemberFee: 36, minMembers: 51, maxMembers: 110 },
  { id: 'gold', baseFee: 900, perMemberFee: 27, minMembers: 111, maxMembers: null },
];

/** Mirrors planForUsers() in companyPlans.js. */
function companyPlanForUsers(n: number): CompanyPlan | null {
  if (!n || n < 1) return null;
  return COMPANY_PLANS.find((p) => n >= p.minUsers && (p.maxUsers == null || n <= p.maxUsers)) ?? null;
}

/**
 * Mirrors tierForMembers() in saccoTiers.js — including the deliberate quirk
 * that a sacco below the Bronze minimum still bills as Bronze. Callers pass the
 * BILLED member count, so below the floor that is Bronze's own minimum.
 */
function saccoTierForMembers(n: number): SaccoTier {
  const count = Number(n) || 0;
  if (count < 1) return SACCO_TIERS[0];
  return (
    SACCO_TIERS.find((t) => count >= t.minMembers && (t.maxMembers == null || count <= t.maxMembers)) ??
    SACCO_TIERS[0]
  );
}

/** Mirrors moduleFeeFor() in systemBilling.js. */
function moduleFeeFor(key: string): number {
  return (Object.prototype.hasOwnProperty.call(MODULE_FEES, key) ? MODULE_FEES[key] : DEFAULT_MODULE_FEE) || 0;
}

/**
 * Total for the modules a tenant runs beyond what its plan bundles. Mirrors
 * the "additional modules" component of buildSystemInvoice().
 */
export function additionalModuleFees(productLine: string, modules: string[] | null | undefined): number {
  if (!modules?.length) return 0;
  const included = PRESETS[productLine] ?? PRESETS.custom;
  return modules
    .filter((k) => !included.includes(k))
    .reduce((sum, k) => sum + moduleFeeFor(k), 0);
}

export interface PriceBreakdown {
  baseFee: number;
  usageFee: number;
  moduleFee: number;
  installationFee: number;
  levyTotal: number;
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  taxRegime: string;
}

/**
 * The full itemised price of one platform invoice, so a caller can log or
 * store the same breakdown the printed invoice shows. Mirrors
 * buildSystemInvoice() in src/config/systemBilling.js.
 *
 * Storage excess is deliberately absent: it is metered after the fact and is
 * never part of the amount a registration pushes for.
 *
 * Returns null when no tier covers the request, which means the claim itself is
 * malformed and no amount can be verified against it.
 */
export function priceSystemInvoice(
  { isSacco, seats, productLine, modules, chargeInstallation = true, asOf = null, vatRate = null, vatInclusive = null, levies = null }: {
    isSacco: boolean;
    seats: number;
    productLine?: string;
    modules?: string[] | null;
    chargeInstallation?: boolean;
    asOf?: string | Date | null;
    vatRate?: number | null;
    vatInclusive?: boolean | null;
    levies?: TaxLevy[] | null;
  },
): PriceBreakdown | null {
  const n = Math.floor(Number(seats));
  if (!Number.isFinite(n) || n < 1) return null;

  // The regulations in force on the billing date. Defaults to today, which is
  // the right answer for a price being charged right now — which is the only
  // thing this file is ever asked about.
  const regime = resolveTaxRegime(asOf ?? today());
  const effectiveRate = vatRate == null ? regime.vatRate : vatRate;
  const effectiveInclusive = vatInclusive == null ? regime.pricesIncludeTax : vatInclusive;

  const line = productLine ?? (isSacco ? 'sacco' : 'company');
  const rate = Math.max(0, Number(effectiveRate) || 0) / 100;
  const installationFee = chargeInstallation ? INSTALLATION_FEE : 0;
  const moduleFee = additionalModuleFees(line, modules);

  let baseFee: number;
  let usageFee: number;

  if (isSacco) {
    // The 5-member minimum, applied before the tier is chosen so the bracket
    // and the charged quantity agree — exactly as buildSystemInvoice() does it.
    const billed = billableMembers(n);
    const tier = saccoTierForMembers(billed);
    baseFee = tier.baseFee;
    usageFee = billed * tier.perMemberFee;
  } else {
    // The 2-user minimum, applied before the tier is chosen so the bracket and
    // the charged quantity agree — exactly as buildSystemInvoice() does it.
    const billed = billableUsers(n);
    const plan = companyPlanForUsers(billed);
    if (!plan) return null;
    baseFee = plan.baseFee;
    usageFee = billed * plan.pricePerUser;
  }

  const gross = baseFee + usageFee + moduleFee + installationFee;

  // Every component above is standard-rated, so the split is on the whole sum.
  const netCharges = effectiveInclusive ? round2(gross / (1 + rate)) : gross;
  const vatOnCharges = effectiveInclusive ? round2(gross - netCharges) : round2(gross * rate);

  // Statutory levies, charged on the supply itself and never on each other, so
  // the order they are listed in cannot change the total. Each is computed
  // tax-exclusive and the taxable ones then attract VAT once, with the
  // charges. There are none today — mirrors computeLevies() in
  // src/config/taxRegulations.js.
  const priced = (levies ?? regime.levies ?? []).map((levy) => {
    const base = levy.basis === BASIS_GROSS ? gross : netCharges;
    return { taxable: levy.taxable !== false, amount: round2(base * (Number(levy.rate) || 0)) };
  }).filter((l) => l.amount !== 0);

  const levyTotal = round2(priced.reduce((s, l) => s + l.amount, 0));
  const vatOnLevies = round2(priced.filter((l) => l.taxable).reduce((s, l) => s + l.amount, 0) * rate);

  const subtotal = round2(netCharges + levyTotal);
  const vatAmount = round2(vatOnCharges + vatOnLevies);
  const total = round2(subtotal + vatAmount);

  return {
    baseFee,
    usageFee,
    moduleFee,
    installationFee,
    levyTotal,
    subtotal,
    vatRate: Number(effectiveRate) || 0,
    vatAmount,
    total,
    taxRegime: regime.version,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * What a registration for `seats` should cost, in whole shillings.
 *
 * Note the seat count itself is caller-supplied and therefore untrusted — that
 * is fine and intended. The check this feeds enforces "you paid the right price
 * for what you claimed", and max_users then bounds what the account actually
 * gets. Someone can still buy the smallest plan there is — which is now the
 * 2-user minimum for a company and the 5-member minimum for a sacco, never one
 * of either; they cannot buy 50 seats for the price of it. The same holds for
 * `modules`: it decides what the extras cost, and tenant_modules bounds what
 * the account can actually open.
 *
 * Returns null when no tier covers the request, which means the claim itself is
 * malformed and no amount can be verified against it.
 */
export function expectedSubscriptionPrice(
  { isSacco, seats, productLine, modules, chargeInstallation = true, asOf = null }: {
    isSacco: boolean;
    seats: number;
    productLine?: string;
    modules?: string[] | null;
    chargeInstallation?: boolean;
    asOf?: string | Date | null;
  },
): number | null {
  const priced = priceSystemInvoice({ isSacco, seats, productLine, modules, chargeInstallation, asOf });
  return priced === null ? null : Math.round(priced.total);
}

/**
 * Every amount this registration may legitimately have been quoted, canonical
 * price first.
 *
 * Normally that is one figure. On the DAY a new tax regime comes into force it
 * is two: an admin who loaded the registration page before midnight was quoted
 * under the old regime and authorises the push under the new one, through no
 * fault of theirs. Refusing that payment would turn a rate change into an
 * outage for everybody mid-checkout.
 *
 * The grace is deliberately the narrowest thing that closes it — only on the
 * changeover date itself, and only ever one regime back, so it cannot become a
 * standing licence to pay last year's price. It is also inert under the
 * current settings: while prices are tax-inclusive a rate change moves the
 * disclosed tax and not the total, so both figures are the same number and the
 * list collapses to one entry.
 */
export function acceptableSubscriptionPrices(
  opts: {
    isSacco: boolean;
    seats: number;
    productLine?: string;
    modules?: string[] | null;
    chargeInstallation?: boolean;
  },
): number[] | null {
  const now = today();
  const expected = expectedSubscriptionPrice({ ...opts, asOf: now });
  if (expected === null) return null;

  const regime = resolveTaxRegime(now);
  if (regime.effectiveFrom !== now) return [expected];

  const previous = previousTaxRegime(now);
  if (!previous) return [expected];

  const under = priceSystemInvoice({
    ...opts,
    asOf: now,
    vatRate: previous.vatRate,
    vatInclusive: previous.pricesIncludeTax,
    levies: previous.levies,
  });
  const prior = under === null ? null : Math.round(under.total);
  return prior === null || prior === expected ? [expected] : [expected, prior];
}

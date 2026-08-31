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
// with VAT then either backed out of that (prices tax-inclusive, the current
// setting, total unchanged) or added on top of it.
// The installation fee is first-registration only; renewals must not re-charge
// it, which is why chargeInstallation is a parameter rather than an assumption.

export const INSTALLATION_FEE = 4000; // KES, both product lines

/** Kenya standard rate. Mirrors VAT_RATE in src/config/systemBilling.js. */
export const VAT_RATE = 16;

/**
 * Mirrors VAT_INCLUSIVE_PRICES in src/config/systemBilling.js. TRUE means the
 * catalogue figures already contain VAT, so the payable total is unchanged and
 * the tax is only disclosed on the invoice. Flip both files together or the
 * browser and this check will disagree by 16% and every signup will be refused.
 */
export const VAT_INCLUSIVE_PRICES = true;

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
 * that a sacco below the Bronze minimum still bills as Bronze.
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
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
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
  { isSacco, seats, productLine, modules, chargeInstallation = true, vatRate = VAT_RATE, vatInclusive = VAT_INCLUSIVE_PRICES }: {
    isSacco: boolean;
    seats: number;
    productLine?: string;
    modules?: string[] | null;
    chargeInstallation?: boolean;
    vatRate?: number;
    vatInclusive?: boolean;
  },
): PriceBreakdown | null {
  const n = Math.floor(Number(seats));
  if (!Number.isFinite(n) || n < 1) return null;

  const line = productLine ?? (isSacco ? 'sacco' : 'company');
  const rate = Math.max(0, Number(vatRate) || 0) / 100;
  const installationFee = chargeInstallation ? INSTALLATION_FEE : 0;
  const moduleFee = additionalModuleFees(line, modules);

  let baseFee: number;
  let usageFee: number;

  if (isSacco) {
    const tier = saccoTierForMembers(n);
    baseFee = tier.baseFee;
    usageFee = n * tier.perMemberFee;
  } else {
    const plan = companyPlanForUsers(n);
    if (!plan) return null;
    baseFee = plan.baseFee;
    usageFee = n * plan.pricePerUser;
  }

  const gross = baseFee + usageFee + moduleFee + installationFee;

  // Every component above is standard-rated, so the split is on the whole sum.
  const subtotal = vatInclusive ? round2(gross / (1 + rate)) : gross;
  const vatAmount = vatInclusive ? round2(gross - subtotal) : round2(gross * rate);
  const total = vatInclusive ? gross : round2(gross + vatAmount);

  return { baseFee, usageFee, moduleFee, installationFee, subtotal, vatRate: Number(vatRate) || 0, vatAmount, total };
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
 * gets. Someone can still buy a 1-seat plan; they cannot buy 50 seats for the
 * price of one. The same holds for `modules`: it decides what the extras cost,
 * and tenant_modules bounds what the account can actually open.
 *
 * Returns null when no tier covers the request, which means the claim itself is
 * malformed and no amount can be verified against it.
 */
export function expectedSubscriptionPrice(
  { isSacco, seats, productLine, modules, chargeInstallation = true }: {
    isSacco: boolean;
    seats: number;
    productLine?: string;
    modules?: string[] | null;
    chargeInstallation?: boolean;
  },
): number | null {
  const priced = priceSystemInvoice({ isSacco, seats, productLine, modules, chargeInstallation });
  return priced === null ? null : Math.round(priced.total);
}

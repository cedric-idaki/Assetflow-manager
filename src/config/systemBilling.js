/**
 * SYSTEM BILLING ENGINE — the one place a platform invoice is priced.
 *
 * WHY THIS FILE EXISTS
 * An invoice for portal access used to be a single opaque number. The company
 * line printed "Silver plan subscription — KES 5,525" straight from
 * company_subscriptions.price_paid, which on a first registration silently had
 * the KES 4,000 installation fee folded into it: the invoice overstated the
 * monthly subscription by the install fee and no line said so. The sacco line
 * itemised base / per-member / storage but knew nothing about installation,
 * and neither line had ever shown VAT — which a Kenyan tax invoice must.
 *
 * So both renderers now call buildSystemInvoice() and print what it returns.
 * The five components the business bills on are computed here, once:
 *
 *   1. base system price   — the flat monthly platform fee for the tier
 *   2. user / member       — seats x per-user, or members x per-member
 *   3. additional modules  — anything enabled beyond what the plan bundles
 *   4. installation        — one-time, FIRST INVOICE ONLY
 *   5. VAT                 — on the standard-rated portion of the above
 *
 * (Storage excess rides along with the usage charges; it predates this file
 * and is carried through rather than dropped.)
 *
 * ── KEEP IN SYNC ───────────────────────────────────────────────────────────
 * supabase/functions/_shared/plans.ts prices the same invoice server-side so
 * mpesa-stk-push can refuse a payment whose amount the browser made up. If the
 * two disagree, every signup fails at the payment step. Change one, change
 * both — src/config/planCatalogs.sync.test.js fails until you do.
 */

import {
  COMPANY_PLANS,
  planForUsers,
  planById,
  INSTALLATION_FEE as COMPANY_INSTALLATION_FEE,
} from './companyPlans';
import {
  SACCO_TIERS,
  tierForMembers,
  tierById,
  EXCESS_STORAGE_PER_GB,
  INSTALLATION_FEE as SACCO_INSTALLATION_FEE,
} from './saccoTiers';
import { PRESETS, MODULES } from './modules';

// ── VAT ──────────────────────────────────────────────────────────────────────
/** Kenya standard rate. Matches company_invoices.vat_rate DEFAULT 16. */
export const VAT_RATE = 16;

/**
 * Are the published prices VAT-INCLUSIVE?
 *
 * TRUE (current): the KES 305/user, KES 500 base and KES 4,000 install already
 * contain VAT. The invoice back-computes the tax element and prints it, and
 * WHAT A TENANT PAYS DOES NOT CHANGE — which is why this is the default. Every
 * existing subscription, every quoted total and the server-side price check
 * keep their present numbers; only the paperwork gains a VAT line.
 *
 * FALSE: the same figures are treated as net and 16% is added on top. That is
 * a real 16% increase to every tenant's bill, so flipping it is a commercial
 * decision, not a code cleanup. The arithmetic below already handles it, and
 * the server catalog reads this same flag.
 */
export const VAT_INCLUSIVE_PRICES = true;

// ── Additional-module pricing ────────────────────────────────────────────────
/**
 * Monthly fee for a module a tenant runs BEYOND what its plan bundles.
 *
 * Every module is 0 today because every module has always been included — the
 * tenant_modules table is a freeze/unfreeze switch, never a paywall, and
 * turning any of these positive raises live tenants' bills. The engine
 * computes the line regardless, so pricing a module is a number in this map
 * and nothing else: the registration quote, both invoice renderers and the
 * server-side price check all pick it up together.
 *
 * A key absent from this map falls back to DEFAULT_MODULE_FEE.
 */
export const DEFAULT_MODULE_FEE = 0; // KES / month

export const MODULE_FEES = Object.freeze(
  MODULES.reduce((acc, m) => {
    acc[m.key] = DEFAULT_MODULE_FEE;
    return acc;
  }, {}),
);

/** What a product line's plan already covers — anything else is billable. */
export const includedModules = (productLine) => PRESETS[productLine] || PRESETS.custom;

/**
 * Monthly fee for one module key. `fees` exists so a caller can price against
 * something other than the shipped catalogue — a negotiated rate card, or a
 * test that needs a non-zero fee while every shipped fee is still 0.
 */
export const moduleFeeFor = (key, fees = MODULE_FEES) =>
  (Object.prototype.hasOwnProperty.call(fees, key) ? fees[key] : DEFAULT_MODULE_FEE) || 0;

const moduleLabel = (key) => MODULES.find((m) => m.key === key)?.label || key;

// ── Rounding ─────────────────────────────────────────────────────────────────
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const whole = (n) => Math.round(Number(n) || 0);

/**
 * Restate VAT-inclusive line grosses as net amounts that still add up to
 * exactly `netTotal`. Rounding each line on its own loses or invents a cent or
 * two; the largest line absorbs the residual, so subtotal + VAT === total
 * always holds on the printed page.
 */
const distributeNet = (taxableLines, netTotal, rate) => {
  if (!taxableLines.length) return;
  let running = 0;
  taxableLines.forEach((l) => {
    l.amount = money(l.gross / (1 + rate));
    running = money(running + l.amount);
  });
  const residual = money(netTotal - running);
  if (residual === 0) return;
  const biggest = taxableLines.reduce((a, b) => (b.gross > a.gross ? b : a), taxableLines[0]);
  biggest.amount = money(biggest.amount + residual);
};

// ── The engine ───────────────────────────────────────────────────────────────
/**
 * Price one platform invoice.
 *
 * @param {object}    opts
 * @param {string}    opts.productLine         'company' | 'sacco' | 'chama' | 'custom'
 * @param {number}    opts.seats               licensed users (company) or active members (sacco)
 * @param {string}   [opts.tierId]             force a tier; otherwise derived from seats
 * @param {number}   [opts.storageGb]          storage used, for the excess charge
 * @param {string[]} [opts.modules]            module keys the tenant has enabled
 * @param {object}   [opts.moduleFees]         override the module rate card
 * @param {boolean}  [opts.chargeInstallation] first invoice only — never on a renewal
 * @param {number}   [opts.vatRate]            percent; pass 0 for exempt / not registered
 * @param {boolean}  [opts.vatInclusive]       are the catalogue prices tax-inclusive?
 *
 * @returns {object} Each line carries both figures, and they are for different
 *   jobs. `gross` is what the line costs at the ADVERTISED rate — qty x unit,
 *   exactly, which is what a customer checks by hand, so it is what the item
 *   table prints. `amount` is the same line VAT-exclusive; the amounts sum to
 *   `subtotal` to the cent, which is what an accounting export needs. A net
 *   amount cannot always be written as qty x a 2dp unit price (60 members at a
 *   net 31.034 is out by 0.27), so the printed table stays inclusive and the
 *   tax is disclosed beneath it instead.
 */
export function buildSystemInvoice({
  productLine = 'company',
  seats = 0,
  tierId = null,
  storageGb = 0,
  modules = null,
  moduleFees = MODULE_FEES,
  chargeInstallation = false,
  vatRate = VAT_RATE,
  vatInclusive = VAT_INCLUSIVE_PRICES,
} = {}) {
  const isSacco = productLine === 'sacco' || productLine === 'chama';
  const count = Math.max(0, whole(seats));
  const rate = Math.max(0, Number(vatRate) || 0) / 100;

  const tier = isSacco
    ? (tierId ? (tierById(tierId) || tierForMembers(count)) : tierForMembers(count))
    : (tierId ? (planById(tierId) || planForUsers(count)) : planForUsers(count));

  const lines = [];
  const push = (label, qty, unit, gross, taxable = true) => {
    if (!gross) return;
    lines.push({
      label,
      qty,
      unit: money(unit),
      gross: money(gross),
      amount: money(gross),
      taxable,
    });
  };

  // 1 ─ Base system price. The sacco line has always had one; the corporate
  //     line prices entirely per-seat, so its baseFee is 0 and the line is
  //     suppressed. Give the company plans a base fee and it appears here.
  const baseFee = tier ? (tier.baseFee || 0) : 0;
  push(`Base system price — ${tier?.name || '—'} ${isSacco ? 'tier' : 'plan'}`, 1, baseFee, baseFee);

  // 2 ─ User / member charges.
  const perUnit = tier ? (isSacco ? tier.perMemberFee : tier.pricePerUser) : 0;
  const usageFee = tier ? count * perUnit : 0;
  push(isSacco ? 'Active member charges' : 'Licensed user charges', count, perUnit, usageFee);

  // 3 ─ Storage above the tier's free quota.
  const freeGb = tier?.storageGb || 0;
  const excessGb = Math.max(0, Math.ceil((Number(storageGb) || 0) - freeGb));
  const storageFee = excessGb * EXCESS_STORAGE_PER_GB;
  push(`Storage excess — ${excessGb} GB over ${freeGb} GB`, excessGb, EXCESS_STORAGE_PER_GB, storageFee);

  // 4 ─ Additional modules: what is enabled beyond what the plan bundles.
  const included = includedModules(productLine);
  const extras = (modules || [])
    .filter((k) => !included.includes(k))
    .map((k) => ({ key: k, fee: moduleFeeFor(k, moduleFees) }))
    .filter((m) => m.fee > 0);
  const moduleFeeTotal = extras.reduce((s, m) => s + m.fee, 0);
  extras.forEach((m) => push(`Additional module — ${moduleLabel(m.key)}`, 1, m.fee, m.fee));

  // 5 ─ Installation. One-time, first invoice only; a renewal must never
  //     re-charge it, which is why the caller has to ask for it.
  const installationFee = chargeInstallation && tier
    ? (isSacco ? SACCO_INSTALLATION_FEE : COMPANY_INSTALLATION_FEE)
    : 0;
  push('Installation & onboarding (one-time)', 1, installationFee, installationFee);

  // ── VAT ──────────────────────────────────────────────────────────────────
  const grossTaxable = money(lines.filter((l) => l.taxable).reduce((s, l) => s + l.gross, 0));
  const grossExempt = money(lines.filter((l) => !l.taxable).reduce((s, l) => s + l.gross, 0));

  let subtotal;
  let vatAmount;
  let total;

  if (vatInclusive) {
    // Prices already contain the tax: back it out, so the customer's total is
    // untouched and the invoice merely discloses the element.
    const netTaxable = money(grossTaxable / (1 + rate));
    vatAmount = money(grossTaxable - netTaxable);
    subtotal = money(netTaxable + grossExempt);
    total = money(grossTaxable + grossExempt);
    distributeNet(lines.filter((l) => l.taxable), netTaxable, rate);
  } else {
    // Prices are net: tax is added on top.
    subtotal = money(grossTaxable + grossExempt);
    vatAmount = money(grossTaxable * rate);
    total = money(subtotal + vatAmount);
  }

  return {
    lines,
    subtotal,
    vatRate: Number(vatRate) || 0,
    vatAmount,
    total,
    tier,
    isSacco,
    seats: count,
    baseFee: money(baseFee),
    usageFee: money(usageFee),
    storageFee: money(storageFee),
    moduleFee: money(moduleFeeTotal),
    installationFee: money(installationFee),
  };
}

/**
 * What a registration must pay today, in whole shillings — the figure the
 * M-Pesa push is raised for. Mirrors expectedSubscriptionPrice() in
 * supabase/functions/_shared/plans.ts; the sync test holds the two together.
 */
export const registrationTotal = (opts) =>
  whole(buildSystemInvoice({ ...opts, chargeInstallation: true }).total);

/** Recurring monthly total — the same invoice without the one-time install. */
export const monthlyTotal = (opts) =>
  whole(buildSystemInvoice({ ...opts, chargeInstallation: false }).total);

export {
  COMPANY_PLANS,
  SACCO_TIERS,
  COMPANY_INSTALLATION_FEE,
  SACCO_INSTALLATION_FEE,
  EXCESS_STORAGE_PER_GB,
};

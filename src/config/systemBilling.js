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
 *   2. user / member       — seats x per-user, or members x per-member, on at
 *                            least MIN_BILLABLE_USERS seats (companyPlans.js)
 *                            or MIN_BILLABLE_MEMBERS members (saccoTiers.js)
 *   3. additional modules  — anything enabled beyond what the plan bundles
 *   4. installation        — one-time, FIRST INVOICE ONLY
 *   5. statutory levies    — any other regulated charge on the bill
 *   6. VAT                 — on the standard-rated portion of the above
 *
 * (Storage excess rides along with the usage charges; it predates this file
 * and is carried through rather than dropped.)
 *
 * Components 5 and 6 are not fixed in this file. They are read from the tax
 * regime in force ON THE BILLING DATE — see src/config/taxRegulations.js — so
 * a rate change or a new levy takes effect by date rather than by deploy, and
 * an old invoice re-renders at the rate it was actually charged at.
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
  billableUsers,
  MIN_BILLABLE_USERS,
  INSTALLATION_FEE as COMPANY_INSTALLATION_FEE,
} from './companyPlans';
import {
  SACCO_TIERS,
  tierForMembers,
  tierById,
  billableMembers,
  MIN_BILLABLE_MEMBERS,
  EXCESS_STORAGE_PER_GB,
  INSTALLATION_FEE as SACCO_INSTALLATION_FEE,
} from './saccoTiers';
import { PRESETS, MODULES } from './modules';
import {
  TAX_REGIMES,
  resolveTaxRegime,
  computeLevies,
  vatRateOn,
  VAT_RATE,
  VAT_INCLUSIVE_PRICES,
} from './taxRegulations';

// ── Tax ──────────────────────────────────────────────────────────────────────
/**
 * THE RATE IS NOT A CONSTANT HERE ANY MORE.
 *
 * VAT, and any other statutory charge on a bill, is set by an instrument with
 * a date on it, so it lives in src/config/taxRegulations.js versioned by the
 * date it came into force. buildSystemInvoice() resolves the regime from the
 * BILLING DATE (`asOf`), which means a rate change is one entry in that table
 * and re-rendering an old invoice reproduces the rate it was actually charged
 * at rather than today's.
 *
 * `VAT_RATE` and `VAT_INCLUSIVE_PRICES` survive as TODAY's values, for the
 * callers that genuinely only mean now — a fresh quote, a default on a blank
 * form. Anything restating a bill that already exists must pass `asOf`.
 *
 * VAT_INCLUSIVE_PRICES is true, so the KES 305/user, KES 500 base and KES
 * 4,000 install already contain the tax: the invoice backs the element out and
 * discloses it, and WHAT A TENANT PAYS DOES NOT CHANGE. A regime that sets
 * `pricesIncludeTax: false` treats the same figures as net and adds the tax on
 * top — a real increase to every tenant's bill, and a commercial decision
 * rather than a code cleanup. The arithmetic below handles both, and the
 * server catalog resolves through its own mirror of the same schedule.
 */

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
 * @param {number}    opts.seats               licensed users (company) or active members (sacco).
 *                                             PRICED on at least MIN_BILLABLE_USERS
 *                                             of them, or MIN_BILLABLE_MEMBERS for a sacco.
 * @param {string}   [opts.tierId]             force a tier; otherwise derived from seats
 * @param {number}   [opts.storageGb]          storage used, for the excess charge
 * @param {string[]} [opts.modules]            module keys the tenant has enabled
 * @param {object}   [opts.moduleFees]         override the module rate card
 * @param {boolean}  [opts.chargeInstallation] first invoice only — never on a renewal
 * @param {string|Date} [opts.asOf]            THE BILLING DATE. Decides which tax regime
 *                                             applies — rate, whether prices include it, and
 *                                             any statutory levy. Defaults to today, which is
 *                                             right for a quote and wrong for anything
 *                                             restating a bill that already exists.
 * @param {number}   [opts.vatRate]            percent, overriding the regime. Pass 0 for an
 *                                             exempt or zero-rated supply, or a tenant not
 *                                             registered for VAT.
 * @param {boolean}  [opts.vatInclusive]       override whether catalogue prices include tax
 * @param {Array}    [opts.levies]             override the regime's statutory levies
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
  asOf = null,
  vatRate = null,
  vatInclusive = null,
  levies = null,
} = {}) {
  // The regulations in force when this bill is raised. Everything tax-shaped
  // below comes from here; the explicit arguments stay as overrides for the
  // cases law does not cover — an exempt supply, a tenant who is not
  // registered, a negotiated treatment.
  const regime = resolveTaxRegime(asOf);
  const effectiveRate = vatRate == null ? regime.vatRate : vatRate;
  const effectiveInclusive = vatInclusive == null ? regime.pricesIncludeTax : vatInclusive;
  const effectiveLevies = levies == null ? (regime.levies || []) : levies;

  const isSacco = productLine === 'sacco' || productLine === 'chama';
  const count = Math.max(0, whole(seats));
  // MINIMUM BILLING. Each product line prices on at least its own floor: a
  // Business subscription on MIN_BILLABLE_USERS seats, so a one-person signup
  // is billed as two; a sacco or chama on MIN_BILLABLE_MEMBERS members, so a
  // three-member chama is billed as five. Both floors move the usage charge
  // only — the base fee, modules and installation are added on top, unchanged.
  // Zero stays zero, which keeps an empty form worth nothing rather than a
  // minimum.
  const billedSeats = isSacco ? billableMembers(count) : billableUsers(count);
  const minimumApplied = billedSeats > count;
  const rate = Math.max(0, Number(effectiveRate) || 0) / 100;

  // The tier is picked on the BILLED seats so the bracket and the quantity on
  // the printed line can never disagree.
  const tier = isSacco
    ? (tierId ? (tierById(tierId) || tierForMembers(billedSeats)) : tierForMembers(billedSeats))
    : (tierId ? (planById(tierId) || planForUsers(billedSeats)) : planForUsers(billedSeats));

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

  // 2 ─ User / member charges, on the billed seat count. When the minimum has
  //     lifted it, the line says so: an invoice for two users to a one-person
  //     company must explain itself on the page, not in an email.
  const perUnit = tier ? (isSacco ? tier.perMemberFee : tier.pricePerUser) : 0;
  const usageFee = tier ? billedSeats * perUnit : 0;
  const usageLabel = isSacco
    ? `Active member charges${minimumApplied ? ` (${MIN_BILLABLE_MEMBERS}-member minimum)` : ''}`
    : `Licensed user charges${minimumApplied ? ` (${MIN_BILLABLE_USERS}-user minimum)` : ''}`;
  push(usageLabel, billedSeats, perUnit, usageFee);

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

  // ── Tax ──────────────────────────────────────────────────────────────────
  // The charge lines, split into what the tax bites on and what it does not.
  const grossTaxable = money(lines.filter((l) => l.taxable).reduce((s, l) => s + l.gross, 0));
  const grossExempt = money(lines.filter((l) => !l.taxable).reduce((s, l) => s + l.gross, 0));

  // Where the advertised price already contains the tax, the net value is
  // backed out of it and the VAT element is the remainder — computed as a
  // difference, not as a percentage, so the disclosed tax and the taxable
  // value always add back to the price the customer was quoted. Where prices
  // are net, the tax is a percentage added on top.
  const netTaxable = effectiveInclusive ? money(grossTaxable / (1 + rate)) : grossTaxable;
  const vatOnCharges = effectiveInclusive ? money(grossTaxable - netTaxable) : money(grossTaxable * rate);
  // Only inclusive prices need restating: on a net catalogue each line's
  // amount already IS its net amount, as pushed.
  if (effectiveInclusive) distributeNet(lines.filter((l) => l.taxable), netTaxable, rate);

  // 6 ─ Statutory levies. Each is a percentage of the supply itself — never of
  //     another levy — and is charged ON TOP of the catalogue price, because a
  //     levy is a new charge rather than a re-slicing of an existing one. There
  //     are none today, so this adds nothing to any current bill; the whole
  //     point is that introducing one is a dated entry in the schedule and not
  //     a change to this file.
  const priced = computeLevies({ netBase: netTaxable, grossBase: grossTaxable, levies: effectiveLevies });
  priced.forEach((l) => {
    const gross = l.taxable ? money(l.amount * (1 + rate)) : l.amount;
    lines.push({
      label: l.label,
      qty: 1,
      unit: gross,
      gross,
      amount: l.amount,
      taxable: l.taxable,
      levy: { key: l.key, rate: l.rate, basis: l.basis, instrument: l.instrument },
    });
  });

  const levyNet = money(priced.reduce((s, l) => s + l.amount, 0));
  const vatOnLevies = money(priced.filter((l) => l.taxable).reduce((s, l) => s + l.amount, 0) * rate);

  const subtotal = money(netTaxable + grossExempt + levyNet);
  const vatAmount = money(vatOnCharges + vatOnLevies);
  const total = money(subtotal + vatAmount);

  return {
    lines,
    subtotal,
    vatRate: Number(effectiveRate) || 0,
    vatAmount,
    total,
    // Which regulations priced this bill. Worth storing on the row: it is the
    // difference between "this invoice charged 14%" and "this invoice was
    // charged under LN 35/2020, which set 14%".
    taxRegime: {
      version: regime.version,
      label: regime.label,
      instrument: regime.instrument,
      effectiveFrom: regime.effectiveFrom,
      beforeHistory: Boolean(regime.beforeHistory),
    },
    vatInclusive: effectiveInclusive,
    levies: priced,
    levyTotal: levyNet,
    tier,
    isSacco,
    seats: count,          // what the tenant asked for
    billedSeats,           // what it is priced on — >= the product line's floor
    minimumApplied,        // true when the floor lifted the seat count
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
  MIN_BILLABLE_USERS,
  billableUsers,
  MIN_BILLABLE_MEMBERS,
  billableMembers,
};

// Re-exported so a caller that already imports the billing engine does not
// have to reach past it for the rate that priced what the engine returned.
export { TAX_REGIMES, resolveTaxRegime, vatRateOn, VAT_RATE, VAT_INCLUSIVE_PRICES };

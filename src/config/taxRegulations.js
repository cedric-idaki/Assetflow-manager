/**
 * REGULATORY TAX SCHEDULE FOR BILLING — the rate that was lawful when the bill
 * was raised, not the rate that is lawful today.
 *
 * WHY THIS FILE EXISTS
 * VAT was a constant. `VAT_RATE = 16` sat in src/config/systemBilling.js, a
 * mirror of it sat in supabase/functions/_shared/plans.ts, and a third, fourth
 * and fifth `16` were typed into the Finance Hub invoice form, the POS and the
 * asset registration form. A rate change is an Act or a Legal Notice with a
 * date on it, so a constant gets two things wrong at once:
 *
 *   1. It cannot be changed without a code edit in five places, and the day
 *      one of them is missed the platform charges one rate and prints another.
 *   2. It re-prices HISTORY. Reprinting an April 2020 invoice at today's 16%
 *      would show a tax figure that was never charged and never filed — the
 *      same defect the payroll engine was built to fix (see
 *      src/utils/kenyaPayroll.js, which versions PAYE by pay month).
 *
 * So rates are versioned by the date the instrument came into force and every
 * calculation resolves its regime from the BILLING DATE. Re-rendering an old
 * invoice reproduces what was lawful then; a rate change is one new entry in
 * the table below and nothing else.
 *
 * ── SCOPE ──────────────────────────────────────────────────────────────────
 * This is the schedule for CONSUMPTION taxes and levies charged ON a bill —
 * VAT and any statutory levy that rides on an invoice. Employment taxes (PAYE,
 * NSSF, SHIF, the housing levy) have their own versioned schedule in
 * src/utils/kenyaPayroll.js and are resolved from the pay month. Two different
 * bodies of law, two tables, same rule: never inline a rate at a call site.
 *
 * ── KEEP IN SYNC ───────────────────────────────────────────────────────────
 * supabase/functions/_shared/plans.ts carries a mirror of TAX_REGIMES so the
 * server-side price check resolves the same regime for the same date. If the
 * two disagree on a rate, and prices are not tax-inclusive, every signup fails
 * with SUBSCRIPTION_PRICE_MISMATCH. src/config/planCatalogs.sync.test.js fails
 * first — change one, change both.
 */

// ─────────────────────────────────────────────────────────────────────────────
// LEVY BASIS
//
// What a levy's percentage bites on. A levy is NEVER computed on another levy:
// the base is always the chargeable supply itself, so levies cannot compound
// and the order they are listed in cannot change anybody's bill.
// ─────────────────────────────────────────────────────────────────────────────
/** Percentage of the VAT-exclusive value of the supply. */
export const BASIS_NET = 'net';
/** Percentage of the advertised, VAT-inclusive price. */
export const BASIS_GROSS = 'gross';

// ─────────────────────────────────────────────────────────────────────────────
// THE SCHEDULE
//
// Ordered oldest → newest. `effectiveFrom` is the date the instrument came
// into force, as 'YYYY-MM-DD'.
//
// Each regime states, for bills raised while it was in force:
//   vatRate           the standard rate, as a percentage
//   pricesIncludeTax  whether the published catalogue price already contains
//                     the tax (see VAT_INCLUSIVE_PRICES in systemBilling.js —
//                     this is where that decision now lives, because it is a
//                     decision that can change on a date like any other)
//   levies            any other statutory charge on the bill (see below)
//
// The history starts at the VAT Act 2013 because that is the Act still in
// force; nothing on this platform predates it, so the two 2020 entries are
// here to prove the mechanism resolves by date and to keep the answer honest
// if a historical figure is ever quoted, not because a tenant was billed then.
// ─────────────────────────────────────────────────────────────────────────────
export const TAX_REGIMES = [
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
  // ───────────────────────────────────────────────────────────────────────────
  // NEXT REGIME GOES HERE.
  //
  // A rate change, or a new levy, is ONE entry copied from the block above with
  // `version` / `label` / `instrument` / `effectiveFrom` set and the changed
  // field edited. Nothing else in the codebase has to move: the registration
  // quote, both platform invoice renderers, the Finance Hub invoice form, the
  // POS and the server-side price check all resolve through this table.
  //
  // Two things to know before adding one:
  //
  //   * `pricesIncludeTax: true` means the published price is the total, so a
  //     RATE change moves the tax disclosed on the invoice and NOT what anyone
  //     pays. Setting it false makes the catalogue net and adds the tax on top
  //     — a real increase to every tenant's bill, and a commercial decision.
  //
  //   * A new levy is an entry in `levies`, shaped:
  //
  //       {
  //         key:        'digital_services',        // stable id, stored on the row
  //         label:      'Digital service tax',     // what prints on the invoice
  //         instrument: 'Finance Act 20XX, s.NN',  // the authority for it
  //         rate:       0.015,                     // a fraction, not a percent
  //         basis:      BASIS_NET,                 // what the rate bites on
  //         taxable:    true,                      // does VAT then apply to it?
  //       }
  //
  //     `taxable: true` is right for a levy that forms part of the taxable
  //     value of the supply (excise duty does); false for one charged outside
  //     the VAT base. Either way the levy is added ON TOP of the catalogue
  //     price — a levy is a new charge, not a re-slicing of an existing one —
  //     so adding one raises live bills by exactly its own amount. That is the
  //     point of it, and it is worth saying out loud before the entry lands.
  //
  //     There are no levies today. Every product the platform sells is a
  //     standard-rated supply of services and nothing else attaches to it.
  // ───────────────────────────────────────────────────────────────────────────
];

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise anything date-shaped to 'YYYY-MM-DD', or null if it isn't a date.
 *
 * Accepts a Date, an ISO timestamp, a 'YYYY-MM-DD' string, or a 'YYYY-MM'
 * period — a monthly billing run identifies its period that way, and a bill
 * for a month is raised at the END of it, so 'YYYY-MM' resolves against the
 * month's last day. A rate that came in mid-month therefore governs that
 * month's bill, which is the same rule the payroll engine applies to a pay
 * month.
 */
export const asOfDate = (value) => {
  if (value == null || value === '') return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }

  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, m] = s.split('-').map(Number);
    if (m < 1 || m > 12) return null;
    // Day 0 of the following month is the last day of this one.
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }

  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};

/** Today, in the same 'YYYY-MM-DD' shape the schedule is keyed on. */
export const today = () => new Date().toISOString().slice(0, 10);

/**
 * The tax regime in force on a date.
 *
 * A missing or unparseable date resolves to the CURRENT regime — that is the
 * "bill it now" case and it is by far the most common caller. A date before
 * the schedule starts resolves to the earliest regime and is flagged
 * `beforeHistory`, so a caller can tell "we know this was 16%" from "this
 * predates anything we can stand behind".
 *
 * @param {string|Date} [asOf] the billing date
 * @returns {object} the regime, plus `beforeHistory`
 */
export const resolveTaxRegime = (asOf) => {
  const date = asOfDate(asOf);
  const newest = TAX_REGIMES[TAX_REGIMES.length - 1];
  if (!date) return { ...newest, beforeHistory: false };

  const inForce = TAX_REGIMES.filter((r) => r.effectiveFrom <= date);
  if (inForce.length === 0) return { ...TAX_REGIMES[0], beforeHistory: true };
  return { ...inForce[inForce.length - 1], beforeHistory: false };
};

/**
 * The regime in force immediately BEFORE the one governing `asOf`, or null at
 * the start of the schedule.
 *
 * Exists for one job: a payment authorised under the rate a page quoted a
 * moment ago, on the day a new rate came in. See the changeover grace in
 * supabase/functions/_shared/plans.ts.
 */
export const previousTaxRegime = (asOf) => {
  const current = resolveTaxRegime(asOf);
  const i = TAX_REGIMES.findIndex((r) => r.version === current.version);
  return i > 0 ? { ...TAX_REGIMES[i - 1], beforeHistory: false } : null;
};

/** The standard VAT rate, as a percentage, on a date. */
export const vatRateOn = (asOf) => resolveTaxRegime(asOf).vatRate;

/** Are catalogue prices tax-inclusive under the regime in force on a date? */
export const pricesIncludeTaxOn = (asOf) => resolveTaxRegime(asOf).pricesIncludeTax;

/** The statutory levies applying to a bill raised on a date. */
export const leviesOn = (asOf) => resolveTaxRegime(asOf).levies || [];

/** The regime in force today. Resolved per call — a process can outlive a date. */
export const currentTaxRegime = () => resolveTaxRegime(today());

/**
 * TODAY's standard rate, for the places that genuinely only mean "now" — a
 * blank invoice form's default, a price quote for a signup happening this
 * second. Anything rendering or re-rendering a bill that already exists must
 * resolve from that bill's own date instead.
 */
export const VAT_RATE = currentTaxRegime().vatRate;

/** Whether TODAY's catalogue prices are tax-inclusive. */
export const VAT_INCLUSIVE_PRICES = currentTaxRegime().pricesIncludeTax;

// ─────────────────────────────────────────────────────────────────────────────
// LEVIES
// ─────────────────────────────────────────────────────────────────────────────
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Price the statutory levies for one bill.
 *
 * Both bases are supplied by the caller because only it knows which of its
 * lines are chargeable. Each levy is computed on the SUPPLY — never on another
 * levy — and the amount returned is always tax-exclusive, so the caller adds
 * VAT to the taxable ones exactly once, in one place.
 *
 * @param {object} opts
 * @param {number} opts.netBase    VAT-exclusive value of the chargeable lines
 * @param {number} opts.grossBase  VAT-inclusive value of the same lines
 * @param {Array}  [opts.levies]   from the resolved regime
 * @returns {Array} one entry per levy that comes to something
 */
export const computeLevies = ({ netBase = 0, grossBase = 0, levies = [] } = {}) =>
  (levies || [])
    .map((levy) => {
      const base = levy.basis === BASIS_GROSS ? grossBase : netBase;
      return {
        key: levy.key,
        label: levy.label,
        instrument: levy.instrument || null,
        rate: Number(levy.rate) || 0,
        basis: levy.basis === BASIS_GROSS ? BASIS_GROSS : BASIS_NET,
        taxable: levy.taxable !== false,
        base: money(base),
        amount: money((Number(base) || 0) * (Number(levy.rate) || 0)),
      };
    })
    .filter((l) => l.amount !== 0);

/**
 * KRA eTIMS CODE TABLES — the vocabulary an invoice has to be written in.
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * eTIMS does not accept an invoice in the shape this system already holds one.
 * A sale here is a price, a VAT amount and a boolean "VAT applicable" toggle
 * (src/pages/pos-module/index.jsx). KRA wants, per line, a tax TYPE code, a
 * quantity unit code, a packaging unit code, an item classification code and an
 * item type code — and it rejects the whole document if any of them is a string
 * it does not recognise.
 *
 * So every code this system sends is named here once, with the meaning it
 * carries, and nothing constructs a code literal at a call site.
 *
 * ── THE ONE THING TO UNDERSTAND ABOUT TAX CODES ─────────────────────────────
 * `vatApplicable: false` is NOT a tax code. It is three different tax codes
 * wearing one boolean:
 *
 *     A  Exempt        — the supply is outside VAT by law (Sch. 1, VAT Act)
 *     C  Zero-rated    — VAT applies AT 0% (Sch. 2 — exports, and others)
 *     D  Non-VAT       — not a VAT supply at all
 *
 * All three charge the customer nothing, which is why one toggle could stand in
 * for them at the till. They are NOT interchangeable to KRA: exempt and
 * zero-rated sit on different lines of a VAT return, and a zero-rated supplier
 * may reclaim input tax where an exempt one may not. Filing one as the other
 * misstates the return.
 *
 * Nothing here guesses between them. An item with no classification recorded is
 * refused by the builder (src/utils/etimsInvoice.js) rather than defaulted, and
 * the tenant is told which items need classifying. A wrong return filed
 * automatically is worse than an invoice that did not transmit.
 *
 * ── RATES ARE NOT STORED HERE ───────────────────────────────────────────────
 * `B` is "the standard rate", not "16". The number comes from
 * src/config/taxRegulations.js, resolved from the date of supply, exactly as
 * the POS and the receipt already resolve it. A standard-rate change is one
 * entry in that table and this file does not move. Writing 16 here would
 * recreate the constant that file was built to delete.
 *
 * ── WHY SOME LISTS ARE SHORT ────────────────────────────────────────────────
 * KRA publishes the full code lists from the API itself (`/selectCodeList`,
 * `/selectItemClsList`) and revises them — the item classification list alone
 * runs to thousands of UNSPSC-derived entries. Pinning a full copy here would
 * go stale silently, which is the failure this codebase avoids elsewhere by
 * versioning rather than freezing.
 *
 * So: the classification list is FETCHED and cached per tenant
 * (etims_code_lists, migration 20260902160000), and what lives here is only the
 * small set of structural codes that the payload's own shape depends on — tax
 * types, receipt types, payment types and the common units. Those are the codes
 * this system must know at build time to construct a document at all.
 */

import { vatRateOn } from './taxRegulations';

// ─────────────────────────────────────────────────────────────────────────────
// TAX TYPES (taxTyCd)
//
// `rate` is a fixed percentage where the law fixes one, or null where the code
// means "whatever the standard rate is" — resolved by date, never stored.
// ─────────────────────────────────────────────────────────────────────────────
export const TAX_CODES = [
  {
    code: 'A',
    label: 'Exempt',
    rate: 0,
    reclaimsInputTax: false,
    desc: 'Outside VAT by law — First Schedule, VAT Act 2013. Input tax on exempt supplies is not reclaimable.',
  },
  {
    code: 'B',
    label: 'Standard rated',
    rate: null, // resolved from taxRegulations by date of supply
    reclaimsInputTax: true,
    desc: 'The standard rate in force on the date of supply. The default for ordinary taxable goods and services.',
  },
  {
    code: 'C',
    label: 'Zero rated',
    rate: 0,
    reclaimsInputTax: true,
    desc: 'Taxable at 0% — Second Schedule, VAT Act 2013 (exports and listed supplies). Input tax IS reclaimable.',
  },
  {
    code: 'D',
    label: 'Non-VAT',
    rate: 0,
    reclaimsInputTax: false,
    desc: 'Not a VAT supply at all. Used by a business that is not VAT registered.',
  },
  {
    code: 'E',
    label: 'Reduced rate (8%)',
    rate: 8,
    reclaimsInputTax: true,
    desc: 'The reduced rate applied to specified petroleum supplies.',
  },
];

export const TAX_CODE_KEYS = TAX_CODES.map((t) => t.code);

const TAX_BY_CODE = TAX_CODES.reduce((acc, t) => { acc[t.code] = t; return acc; }, {});

/** The tax type record for a code, or null if the code is not one KRA defines. */
export const taxCode = (code) => TAX_BY_CODE[String(code || '').toUpperCase()] || null;

export const isTaxCode = (code) => Boolean(taxCode(code));

/**
 * The rate a tax code carries, as a PERCENTAGE, on a given date.
 *
 * Only 'B' varies: it is the standard rate resolved from the regime table, so a
 * document re-rendered for an old period states the rate that was lawful then.
 * Everything else is fixed by the code's own definition.
 *
 * Returns null for an unknown code — callers must treat that as "cannot build
 * this line", never as zero. A silent zero would file a taxable supply as
 * untaxed.
 */
export const taxRateFor = (code, asOf = null) => {
  const t = taxCode(code);
  if (!t) return null;
  return t.rate === null ? vatRateOn(asOf) : t.rate;
};

/** The same rate as a fraction, for arithmetic. */
export const taxFractionFor = (code, asOf = null) => {
  const pct = taxRateFor(code, asOf);
  return pct === null ? null : pct / 100;
};

/**
 * The tax code the till's boolean implies, where it is safe to imply one.
 *
 * ON is unambiguous: charging the standard rate IS code B. OFF is not, so it
 * returns null and the caller must resolve it from the item's recorded
 * classification. See the header.
 */
export const taxCodeFromVatToggle = (vatApplicable) => (vatApplicable ? 'B' : null);

// ─────────────────────────────────────────────────────────────────────────────
// RECEIPT / TRANSACTION TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** rcptTyCd — what kind of document this is. */
export const RECEIPT_TYPES = {
  SALE: 'S',
  /** A credit note. Reverses an earlier sale and must reference its invoice. */
  CREDIT_NOTE: 'R',
  PROFORMA: 'P',
  TRAINING: 'T',
};

/** salesSttsCd — the state the document is transmitted in. */
export const SALE_STATUS = {
  PENDING_APPROVAL: '01',
  APPROVED: '02',
  CREDIT_NOTE_PENDING: '03',
  CREDIT_NOTE_APPROVED: '04',
  CANCELLED: '05',
};

/**
 * pmtTyCd — how the customer paid.
 *
 * Keyed by this system's own payment_method enum so the mapping lives in one
 * place instead of a switch inside the payload builder.
 */
export const PAYMENT_TYPE_CODES = {
  cash: '01',
  credit: '02',
  cash_credit: '03',
  cheque: '04',
  card: '05',
  mpesa: '06',
  bank_transfer: '06', // mobile/bank transfer — KRA has no distinct bank code
  other: '07',
};

/** The KRA payment code for one of this system's payment methods. */
export const paymentTypeCode = (method) =>
  PAYMENT_TYPE_CODES[String(method || '').toLowerCase()] || PAYMENT_TYPE_CODES.other;

// ─────────────────────────────────────────────────────────────────────────────
// UNITS
//
// The subset in daily use. A tenant selling in a unit not listed picks from the
// fetched code list instead — these are the defaults the UI offers, not a
// closed set the builder validates against.
// ─────────────────────────────────────────────────────────────────────────────

/** qtyUnitCd — the unit the quantity is counted in. */
export const QUANTITY_UNITS = [
  { code: 'U',   label: 'Item / piece' },
  { code: 'KG',  label: 'Kilogram' },
  { code: 'GRM', label: 'Gram' },
  { code: 'LTR', label: 'Litre' },
  { code: 'MTR', label: 'Metre' },
  { code: 'CMT', label: 'Centimetre' },
  { code: 'MTQ', label: 'Cubic metre' },
  { code: 'SET', label: 'Set' },
  { code: 'PR',  label: 'Pair' },
  { code: 'DZN', label: 'Dozen' },
  { code: 'HR',  label: 'Hour' },
  { code: 'DAY', label: 'Day' },
];

/** pkgUnitCd — how it is packed. 'NT' means it is not packed at all. */
export const PACKAGING_UNITS = [
  { code: 'NT', label: 'No packaging' },
  { code: 'BX', label: 'Box' },
  { code: 'CT', label: 'Carton' },
  { code: 'BG', label: 'Bag' },
  { code: 'BZ', label: 'Bundle' },
  { code: 'CA', label: 'Can' },
  { code: 'DR', label: 'Drum' },
  { code: 'JR', label: 'Jar' },
  { code: 'PK', label: 'Packet' },
  { code: 'RL', label: 'Roll' },
  { code: 'TN', label: 'Tin' },
];

/** itemTyCd — what the line is. */
export const ITEM_TYPES = [
  { code: '1', label: 'Raw material' },
  { code: '2', label: 'Finished goods' },
  { code: '3', label: 'Service' },
];

/** The safe defaults for a business selling whole items off a shelf. */
export const DEFAULT_QUANTITY_UNIT = 'U';
export const DEFAULT_PACKAGING_UNIT = 'NT';
export const DEFAULT_ITEM_TYPE = '2';

/**
 * itemNoCd origin — where the goods came from. Two digits, ISO-ish country
 * code; 'KE' for locally produced. Only the two this system can determine are
 * listed; anything else is entered by the tenant.
 */
export const ORIGIN_LOCAL = 'KE';

// ─────────────────────────────────────────────────────────────────────────────
// KRA PIN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A KRA PIN is a letter, nine digits and a check letter — 'P051234567X' for a
 * non-individual, 'A' for an individual.
 *
 * Validated before anything is transmitted because KRA rejects the whole
 * document on a malformed PIN, and a queue full of documents that can never
 * succeed is indistinguishable from an outage until somebody reads the errors.
 */
export const KRA_PIN_PATTERN = /^[AP]\d{9}[A-Z]$/;

export const isValidKraPin = (pin) => KRA_PIN_PATTERN.test(normaliseKraPin(pin));

/** Upper-cased and stripped of the spaces people type into the field. */
export function normaliseKraPin(pin) {
  return String(pin || '').replace(/\s+/g, '').toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// ENVIRONMENTS
//
// The sandbox is a real, separate KRA system with its own device registration.
// A tenant that "went live" without changing this transmits every invoice to a
// test server and files nothing — which is why the environment is shown on the
// settings screen and stamped on every queued document.
// ─────────────────────────────────────────────────────────────────────────────
export const ETIMS_ENVIRONMENTS = {
  sandbox: {
    key: 'sandbox',
    label: 'Sandbox (testing)',
    baseUrl: 'https://etims-api-sbx.kra.go.ke/etims-api',
  },
  production: {
    key: 'production',
    label: 'Production (live filing)',
    baseUrl: 'https://etims-api.kra.go.ke/etims-api',
  },
};

export const etimsBaseUrl = (environment) =>
  (ETIMS_ENVIRONMENTS[environment] || ETIMS_ENVIRONMENTS.sandbox).baseUrl;

/**
 * The branch a single-location business is registered under. KRA issues branch
 * IDs per outlet; '00' is head office and is what a one-shop tenant uses.
 */
export const HEAD_OFFICE_BRANCH = '00';

export default TAX_CODES;

/**
 * eTIMS SALES DOCUMENT BUILDER — the one implementation of the arithmetic that
 * decides what a tenant files with KRA.
 *
 * ── WHY THIS IS HERE AND NOT IN src/ ────────────────────────────────────────
 * The figures on a tax document must not be assertable by the browser. If the
 * client built the payload, a tampered or merely buggy page could file a
 * different taxable amount than the one it charged the customer, and the tenant
 * — not us — carries that liability. So the document is built server-side, from
 * the database, by the function that transmits it.
 *
 * It is nevertheless pure, with no Deno globals and no remote imports, because
 * the test suite imports this file directly (src/utils/etimsDocument.test.js).
 * That is an established route in this repo — src/config/planCatalogs.sync.test.js
 * already imports _shared/plans.ts — and it means the arithmetic that produces a
 * VAT return is exercised by ordinary `npm test` rather than only by making a
 * live call to KRA.
 *
 * The browser gets src/utils/etimsReadiness.js instead, which answers "can this
 * sale be filed?" and computes no money at all. Two files, one set of figures.
 *
 * ── THE ARITHMETIC, AND WHY IT IS DONE IN THIS ORDER ────────────────────────
 * KRA validates a document against itself: the header's totTaxblAmt, totTaxAmt
 * and totAmt must equal the sums of the lines, and the per-code buckets
 * (taxblAmtA..E / taxAmtA..E) must equal the sums of the lines carrying each
 * code. A document that fails its own cross-check is rejected outright.
 *
 * The trap is rounding. Compute a header total from the order value and the
 * lines from unit prices, and the two disagree by cents on any order with a
 * repeating division — three items at a third of a shilling. So:
 *
 *     every figure in the header is a SUM OF ALREADY-ROUNDED LINE FIGURES.
 *
 * Nothing is computed twice by two routes. The header cannot drift from the
 * lines because it is derived from nothing else.
 *
 * ── TAX-INCLUSIVE VS TAX-EXCLUSIVE ──────────────────────────────────────────
 * Both exist in this codebase and they are not interchangeable:
 *
 *   the POS is EXCLUSIVE — src/pages/pos-module/index.jsx computes
 *   `totalAmount = priceAfterDiscount + vatAmount`, so the price captured is
 *   net and the tax is added on top.
 *
 *   platform billing is INCLUSIVE — taxRegulations.js carries
 *   `pricesIncludeTax: true`, so the catalogue price already contains the tax.
 *
 * Getting this backwards on a 16% supply misstates the tax by 16% of itself in
 * one direction or 13.8% in the other, silently, on every line. So it is a
 * required argument with no default: a caller that does not say is refused.
 *
 * ── WHAT THIS REFUSES TO GUESS ──────────────────────────────────────────────
 * A line with no tax code is not defaulted to standard rated, and a zero-tax
 * line is not defaulted to exempt. Exempt, zero-rated and non-VAT all charge
 * the customer nothing and are different lines of a VAT return — see the header
 * of src/config/etimsCodes.js. `problems` names every such line and `ok` is
 * false. A document that cannot be built correctly does not get built.
 */

import { resolveTaxRegime } from "./plans.ts";

// ===========================================================================
// CODES
//
// Mirrored for the UI in src/config/etimsCodes.js, which carries the labels the
// settings and classification screens render. src/utils/etimsCodes.sync.test.js
// fails if the two disagree on a code or a rate — change one, change both.
//
// Rates are NOT stored here. 'B' means "the standard rate", resolved from the
// regime table by date of supply, exactly as the POS and the receipt resolve
// it. Writing 16 here would recreate the constant taxRegulations.js exists to
// delete.
// ===========================================================================

export type TaxCodeKey = "A" | "B" | "C" | "D" | "E";

export const TAX_CODE_KEYS: TaxCodeKey[] = ["A", "B", "C", "D", "E"];

/** Fixed percentage where the law fixes one; null means "the standard rate". */
const FIXED_TAX_RATES: Record<TaxCodeKey, number | null> = {
  A: 0, // Exempt — First Schedule, VAT Act 2013
  B: null, // Standard rated — resolved by date
  C: 0, // Zero rated — Second Schedule (input tax IS reclaimable)
  D: 0, // Non-VAT — not a VAT supply
  E: 8, // Reduced rate — specified petroleum supplies
};

export const isTaxCode = (code: unknown): code is TaxCodeKey =>
  typeof code === "string" && (TAX_CODE_KEYS as string[]).includes(code.toUpperCase());

/**
 * The rate a tax code carries, as a PERCENTAGE, on a given date.
 *
 * Returns null for an unknown code. Callers must treat that as "cannot build
 * this line", never as zero — a silent zero files a taxable supply as untaxed.
 */
export function taxRateFor(code: string, asOf?: string | Date | null): number | null {
  if (!isTaxCode(code)) return null;
  const fixed = FIXED_TAX_RATES[code.toUpperCase() as TaxCodeKey];
  return fixed === null ? resolveTaxRegime(asOf ?? null).vatRate : fixed;
}

/** rcptTyCd */
export const RECEIPT_TYPES = { SALE: "S", CREDIT_NOTE: "R", PROFORMA: "P", TRAINING: "T" } as const;

/** salesSttsCd */
export const SALE_STATUS = {
  PENDING_APPROVAL: "01",
  APPROVED: "02",
  CREDIT_NOTE_PENDING: "03",
  CREDIT_NOTE_APPROVED: "04",
  CANCELLED: "05",
} as const;

/** pmtTyCd, keyed by this system's own payment_method values. */
export const PAYMENT_TYPE_CODES: Record<string, string> = {
  cash: "01",
  credit: "02",
  cash_credit: "03",
  cheque: "04",
  card: "05",
  mpesa: "06",
  bank_transfer: "06", // KRA has no distinct bank-transfer code
  other: "07",
};

export const paymentTypeCode = (method?: string | null): string =>
  PAYMENT_TYPE_CODES[String(method ?? "").toLowerCase()] ?? PAYMENT_TYPE_CODES.other;

export const DEFAULT_QUANTITY_UNIT = "U";
export const DEFAULT_PACKAGING_UNIT = "NT";
export const DEFAULT_ITEM_TYPE = "2";
export const HEAD_OFFICE_BRANCH = "00";

/**
 * A KRA PIN is a letter, nine digits and a check letter — 'P051234567X' for a
 * non-individual, 'A…' for an individual.
 *
 * Validated before anything is transmitted because KRA rejects the whole
 * document on a malformed PIN, and a queue full of documents that can never
 * succeed is indistinguishable from an outage until somebody reads the errors.
 */
export const KRA_PIN_PATTERN = /^[AP]\d{9}[A-Z]$/;

export const normaliseKraPin = (pin?: string | null): string =>
  String(pin ?? "").replace(/\s+/g, "").toUpperCase();

export const isValidKraPin = (pin?: string | null): boolean =>
  KRA_PIN_PATTERN.test(normaliseKraPin(pin));

export const ETIMS_BASE_URLS: Record<string, string> = {
  sandbox: "https://etims-api-sbx.kra.go.ke/etims-api",
  production: "https://etims-api.kra.go.ke/etims-api",
};

export const etimsBaseUrl = (environment?: string | null): string =>
  ETIMS_BASE_URLS[String(environment ?? "")] ?? ETIMS_BASE_URLS.sandbox;

// ===========================================================================
// MONEY
// ===========================================================================

/**
 * Two decimal places, half-up, and never -0.
 *
 * `Number.EPSILON` is added before rounding because binary floating point puts
 * values like 1.005 fractionally below the halfway point, where Math.round
 * takes them DOWN — a cent lost per line, systematically, always in the
 * taxpayer's favour, which is the direction KRA notices.
 */
export function round2(n: number): number {
  const v = Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

// ===========================================================================
// DATES
//
// KRA timestamps are yyyyMMddHHmmss with no separators and no timezone, read as
// East Africa Time.
//
// The conversion is explicit rather than via toISOString(), which renders a UTC
// wall clock: a sale at 01:30 EAT on the 2nd would transmit as 22:30 on the
// 1st, landing it in the previous day's — and, at a month boundary, the
// previous MONTH's — filing period.
// ===========================================================================

const EAT_OFFSET_MINUTES = 3 * 60;

const pad = (n: number): string => String(n).padStart(2, "0");

function eatParts(value: string | Date) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const s = new Date(d.getTime() + EAT_OFFSET_MINUTES * 60 * 1000);
  return {
    y: s.getUTCFullYear(),
    m: s.getUTCMonth() + 1,
    d: s.getUTCDate(),
    hh: s.getUTCHours(),
    mm: s.getUTCMinutes(),
    ss: s.getUTCSeconds(),
  };
}

/** 'yyyyMMddHHmmss' in East Africa Time. */
export function etimsDateTime(value: string | Date = new Date()): string | null {
  const p = eatParts(value);
  return p ? `${p.y}${pad(p.m)}${pad(p.d)}${pad(p.hh)}${pad(p.mm)}${pad(p.ss)}` : null;
}

/** 'yyyyMMdd' in East Africa Time. */
export function etimsDate(value: string | Date = new Date()): string | null {
  const p = eatParts(value);
  return p ? `${p.y}${pad(p.m)}${pad(p.d)}` : null;
}

// ===========================================================================
// TYPES
// ===========================================================================

export interface EtimsLineInput {
  description?: string | null;
  itemCode?: string | null;
  classificationCode?: string | null;
  taxCode?: string | null;
  quantity?: number | string | null;
  unitPrice?: number | string | null;
  discountAmount?: number | string | null;
  quantityUnit?: string | null;
  packagingUnit?: string | null;
  packageCount?: number | string | null;
  itemType?: string | null;
  barcode?: string | null;
}

export interface EtimsSeller {
  pin?: string | null;
  branchId?: string | null;
  name?: string | null;
  address?: string | null;
  receiptTopMessage?: string | null;
  receiptBottomMessage?: string | null;
}

export interface EtimsBuyer {
  pin?: string | null;
  name?: string | null;
  phone?: string | null;
}

export interface BuildDocumentInput {
  docType?: "sale" | "credit_note";
  invoiceNumber?: number | null;
  originalInvoiceNumber?: number | null;
  seller?: EtimsSeller;
  buyer?: EtimsBuyer;
  lines?: EtimsLineInput[];
  /** Required. See the header — there is deliberately no default. */
  pricesIncludeTax?: boolean;
  paymentMethod?: string | null;
  saleDate?: string | Date;
  operator?: { id?: string | null; name?: string | null };
  remark?: string | null;
  refundReasonCode?: string | null;
}

export interface BuildDocumentResult {
  ok: boolean;
  problems: string[];
  payload: Record<string, unknown>;
  totals: {
    taxable: number;
    tax: number;
    total: number;
    byCode: Record<TaxCodeKey, { taxable: number; tax: number; rate: number | null }>;
  };
}

// ===========================================================================
// ONE LINE
// ===========================================================================

/**
 * Price a single line and produce its KRA item entry.
 *
 * `problems` is returned rather than thrown: a caller wants EVERY unclassified
 * item named in one pass, not the first one, or fixing a ten-line invoice takes
 * ten round trips.
 */
export function buildLine(
  { line, seq, pricesIncludeTax, asOf }: {
    line: EtimsLineInput;
    seq: number;
    pricesIncludeTax: boolean;
    asOf: string | Date | null;
  },
) {
  const problems: string[] = [];
  const label = line?.description || `line ${seq}`;

  const code = String(line?.taxCode ?? "").toUpperCase();
  const known = isTaxCode(code);
  if (!known) {
    problems.push(
      code
        ? `"${label}" carries tax code "${code}", which KRA does not define.`
        : `"${label}" has no KRA tax classification. Classify it as exempt, zero-rated, standard or non-VAT before this invoice can be filed.`,
    );
  }

  if (!line?.classificationCode) {
    problems.push(`"${label}" has no KRA item classification code.`);
  }

  const quantity = num(line?.quantity);
  if (quantity <= 0) problems.push(`"${label}" has a quantity of ${quantity}.`);

  const unitPrice = num(line?.unitPrice);
  const discount = round2(Math.max(0, num(line?.discountAmount)));

  // The gross value of the line before discount, at the price actually charged.
  const supplyAmount = round2(quantity * unitPrice);

  if (discount > supplyAmount) {
    problems.push(`"${label}" has a discount of ${discount} against a line value of ${supplyAmount}.`);
  }

  // What the line is worth after discount — the figure tax is derived from,
  // whichever direction it is derived in.
  const chargeable = round2(supplyAmount - discount);

  const ratePct = known ? taxRateFor(code, asOf) : null;
  const fraction = ratePct === null ? null : ratePct / 100;

  let taxableAmount: number;
  let taxAmount: number;
  if (fraction === null) {
    // Unknown code: the line is already a problem. Zero rather than NaN, so the
    // rest of the document still builds and every other fault is reported too.
    taxableAmount = chargeable;
    taxAmount = 0;
  } else if (pricesIncludeTax) {
    // The charge already contains the tax: strip it out.
    taxableAmount = round2(chargeable / (1 + fraction));
    // Subtracted, not computed, so taxable + tax is EXACTLY the charge. Doing
    // both by multiplication leaves a cent unaccounted for on half of all lines.
    taxAmount = round2(chargeable - taxableAmount);
  } else {
    taxableAmount = chargeable;
    taxAmount = round2(chargeable * fraction);
  }

  const totalAmount = round2(taxableAmount + taxAmount);

  return {
    problems,
    taxCode: code as TaxCodeKey,
    figures: { supplyAmount, discount, taxableAmount, taxAmount, totalAmount },
    item: {
      itemSeq: seq,
      itemCd: line?.itemCode ?? "",
      itemClsCd: line?.classificationCode ?? "",
      itemNm: label,
      bcd: line?.barcode ?? null,
      pkgUnitCd: line?.packagingUnit ?? DEFAULT_PACKAGING_UNIT,
      pkg: num(line?.packageCount) || 1,
      qtyUnitCd: line?.quantityUnit ?? DEFAULT_QUANTITY_UNIT,
      qty: quantity,
      prc: unitPrice,
      splyAmt: supplyAmount,
      // Discount is sent as a rate AND an amount. The rate is derived from the
      // amount rather than carried alongside it, so the two cannot disagree.
      dcRt: supplyAmount > 0 ? round2((discount / supplyAmount) * 100) : 0,
      dcAmt: discount,
      // Insurance fields. Not applicable to any supply this system records, but
      // required keys — omitting them fails schema validation at KRA.
      isrccCd: null,
      isrccNm: null,
      isrcRt: null,
      isrcAmt: null,
      taxTyCd: code,
      taxblAmt: taxableAmount,
      taxAmt: taxAmount,
      totAmt: totalAmount,
      itemTyCd: line?.itemType ?? DEFAULT_ITEM_TYPE,
    },
  };
}

// ===========================================================================
// THE DOCUMENT
// ===========================================================================

/**
 * Build the document for `saveTrnsSalesOsdc`.
 *
 * Returns `{ ok, problems, payload, totals }`. When `ok` is false the payload is
 * still returned — the transmission queue stores it so an operator can see what
 * would have been sent — but nothing may transmit it.
 *
 * `invoiceNumber` is the DEVICE's own sequence, not this system's invoice
 * string. KRA requires an integer that only ever increases per device; it is
 * allocated by etims_next_invoice_number() under a row lock, never derived from
 * a timestamp or a count. See migration 20260902160000.
 */
export function buildEtimsSalesDocument(input: BuildDocumentInput = {}): BuildDocumentResult {
  const {
    docType = "sale",
    invoiceNumber = null,
    originalInvoiceNumber = null,
    seller = {},
    buyer = {},
    lines = [],
    pricesIncludeTax,
    paymentMethod = "cash",
    saleDate = new Date(),
    operator = {},
    remark = null,
    refundReasonCode = null,
  } = input;

  const problems: string[] = [];
  const isCreditNote = docType === "credit_note";

  // ── Preconditions the whole document depends on ───────────────────────────
  if (typeof pricesIncludeTax !== "boolean") {
    problems.push(
      "Whether the prices on this sale include tax was not stated, so the tax cannot be worked out either way.",
    );
  }

  const sellerPin = normaliseKraPin(seller.pin);
  if (!isValidKraPin(sellerPin)) {
    problems.push(
      sellerPin
        ? `The seller's KRA PIN "${sellerPin}" is not a valid PIN.`
        : "No seller KRA PIN is configured for eTIMS.",
    );
  }

  const branchId = String(seller.branchId ?? HEAD_OFFICE_BRANCH);

  if (!Number.isInteger(invoiceNumber) || (invoiceNumber as number) <= 0) {
    problems.push("No eTIMS invoice sequence number was allocated for this document.");
  }

  if (isCreditNote && !Number.isInteger(originalInvoiceNumber)) {
    problems.push("A credit note must reference the eTIMS invoice number it reverses.");
  }

  // A buyer PIN is optional — a walk-in customer has no reason to give one —
  // but a malformed one is worse than none: KRA rejects the document, where an
  // absent PIN files cleanly as a sale to an unidentified customer.
  const buyerPin = normaliseKraPin(buyer.pin);
  if (buyerPin && !isValidKraPin(buyerPin)) {
    problems.push(`The customer's KRA PIN "${buyerPin}" is not a valid PIN.`);
  }

  if (!Array.isArray(lines) || lines.length === 0) {
    problems.push("The document has no lines.");
  }

  const confirmedAt = etimsDateTime(saleDate);
  const suppliedOn = etimsDate(saleDate);
  if (!confirmedAt || !suppliedOn) problems.push("The sale has no usable date.");

  // ── Lines ─────────────────────────────────────────────────────────────────
  const inclusive = pricesIncludeTax === true;
  const asOf = suppliedOn ? saleDate : null;
  const built = (Array.isArray(lines) ? lines : []).map((line, i) =>
    buildLine({ line, seq: i + 1, pricesIncludeTax: inclusive, asOf })
  );
  built.forEach((b) => problems.push(...b.problems));

  // ── Buckets ───────────────────────────────────────────────────────────────
  // One taxable/tax pair per KRA tax code, each the SUM OF ROUNDED LINE
  // FIGURES. A code with no lines transmits as zero rather than being omitted:
  // KRA's schema requires all five pairs to be present.
  const buckets = {} as Record<TaxCodeKey, { taxable: number; tax: number; rate: number | null }>;
  for (const c of TAX_CODE_KEYS) {
    buckets[c] = { taxable: 0, tax: 0, rate: taxRateFor(c, asOf) };
  }

  let totalTaxable = 0;
  let totalTax = 0;
  let totalAmount = 0;

  for (const b of built) {
    const bucket = buckets[b.taxCode];
    if (bucket) {
      bucket.taxable = round2(bucket.taxable + b.figures.taxableAmount);
      bucket.tax = round2(bucket.tax + b.figures.taxAmount);
    }
    totalTaxable = round2(totalTaxable + b.figures.taxableAmount);
    totalTax = round2(totalTax + b.figures.taxAmount);
    totalAmount = round2(totalAmount + b.figures.totalAmount);
  }

  // ── Sign ──────────────────────────────────────────────────────────────────
  // A credit note is the same document with every money figure negated. Done
  // here, once, after the buckets are summed, rather than by negating the
  // inputs — negative quantities would make every line-level check above
  // ("quantity of -1") fire on a perfectly valid reversal.
  const sign = isCreditNote ? -1 : 1;
  const signed = (n: number) => round2(n * sign);

  const items = built.map((b) => ({
    ...b.item,
    qty: signed(b.item.qty),
    splyAmt: signed(b.item.splyAmt),
    dcAmt: signed(b.item.dcAmt),
    taxblAmt: signed(b.item.taxblAmt),
    taxAmt: signed(b.item.taxAmt),
    totAmt: signed(b.item.totAmt),
  }));

  const totals: BuildDocumentResult["totals"] = {
    taxable: signed(totalTaxable),
    tax: signed(totalTax),
    total: signed(totalAmount),
    byCode: TAX_CODE_KEYS.reduce((acc, c) => {
      acc[c] = { taxable: signed(buckets[c].taxable), tax: signed(buckets[c].tax), rate: buckets[c].rate };
      return acc;
    }, {} as BuildDocumentResult["totals"]["byCode"]),
  };

  const bucketFields: Record<string, number | null> = {};
  for (const c of TAX_CODE_KEYS) {
    bucketFields[`taxblAmt${c}`] = totals.byCode[c].taxable;
    bucketFields[`taxRt${c}`] = totals.byCode[c].rate;
    bucketFields[`taxAmt${c}`] = totals.byCode[c].tax;
  }

  const payload: Record<string, unknown> = {
    tin: sellerPin,
    bhfId: branchId,
    invcNo: invoiceNumber,
    // KRA reads 0 as "this document reverses nothing".
    orgInvcNo: isCreditNote ? originalInvoiceNumber ?? 0 : 0,
    custTin: buyerPin || null,
    custNm: buyer.name ?? null,
    salesTyCd: "N", // a normal sale, as opposed to a copy or a training document
    rcptTyCd: isCreditNote ? RECEIPT_TYPES.CREDIT_NOTE : RECEIPT_TYPES.SALE,
    pmtTyCd: paymentTypeCode(paymentMethod),
    salesSttsCd: isCreditNote ? SALE_STATUS.CREDIT_NOTE_APPROVED : SALE_STATUS.APPROVED,
    cfmDt: confirmedAt,
    salesDt: suppliedOn,
    // The date stock left the premises: the same day for an over-the-counter
    // sale, null on a credit note where nothing is released.
    stockRlsDt: isCreditNote ? null : confirmedAt,
    cnclReqDt: null,
    cnclDt: null,
    rfdDt: isCreditNote ? confirmedAt : null,
    rfdRsnCd: isCreditNote ? refundReasonCode ?? "05" : null, // 05 = other
    totItemCnt: items.length,
    ...bucketFields,
    totTaxblAmt: totals.taxable,
    totTaxAmt: totals.tax,
    totAmt: totals.total,
    // Whether the purchaser accepted the invoice in eTIMS. 'N' — this system
    // issues the document, it does not ask the customer to confirm it.
    prchrAcptcYn: "N",
    remark: remark ?? null,
    regrId: operator.id ?? "system",
    regrNm: operator.name ?? "Ararat",
    modrId: operator.id ?? "system",
    modrNm: operator.name ?? "Ararat",
    receipt: {
      custTin: buyerPin || null,
      custMblNo: buyer.phone ?? null,
      rptNo: invoiceNumber,
      trdeNm: seller.name ?? null,
      adrs: seller.address ?? null,
      topMsg: seller.receiptTopMessage ?? null,
      btmMsg: seller.receiptBottomMessage ?? null,
      prchrAcptcYn: "N",
    },
    itemList: items,
  };

  return { ok: problems.length === 0, problems, payload, totals };
}

// ===========================================================================
// INTEGRITY CHECK
// ===========================================================================

/**
 * Re-derive a stored payload's header from its own lines and report any
 * disagreement.
 *
 * The transmit function runs this on every document immediately before posting,
 * including ones it built itself moments earlier. That is not paranoia about
 * this file: a queued payload can sit in the database for days across a
 * redeploy, and a document whose header does not match its lines is rejected by
 * KRA in a way that looks identical to an outage. Catching it here names the
 * real fault instead of burning the retry budget on it.
 */
export function verifyDocumentTotals(payload: Record<string, any>): string[] {
  const faults: string[] = [];
  const items: any[] = Array.isArray(payload?.itemList) ? payload.itemList : [];

  if (items.length === 0) {
    faults.push("The document has no lines.");
    return faults;
  }

  if (num(payload.totItemCnt) !== items.length) {
    faults.push(`Header item count ${payload.totItemCnt} does not match ${items.length} lines.`);
  }

  const sumOf = (key: string, from: any[] = items) =>
    round2(from.reduce((s, it) => s + num(it?.[key]), 0));

  const checks: Array<[string, number, number]> = [
    ["totTaxblAmt", num(payload.totTaxblAmt), sumOf("taxblAmt")],
    ["totTaxAmt", num(payload.totTaxAmt), sumOf("taxAmt")],
    ["totAmt", num(payload.totAmt), sumOf("totAmt")],
  ];

  for (const c of TAX_CODE_KEYS) {
    const lines = items.filter((it) => String(it?.taxTyCd ?? "").toUpperCase() === c);
    checks.push([`taxblAmt${c}`, num(payload[`taxblAmt${c}`]), sumOf("taxblAmt", lines)]);
    checks.push([`taxAmt${c}`, num(payload[`taxAmt${c}`]), sumOf("taxAmt", lines)]);
  }

  for (const [field, header, derived] of checks) {
    if (round2(header) !== derived) {
      faults.push(`${field} is ${header} but the lines sum to ${derived}.`);
    }
  }

  // Each line must also add up on its own terms.
  for (const it of items) {
    const expected = round2(num(it?.taxblAmt) + num(it?.taxAmt));
    if (round2(num(it?.totAmt)) !== expected) {
      faults.push(
        `Line ${it?.itemSeq ?? "?"} totals ${it?.totAmt} but its taxable and tax amounts sum to ${expected}.`,
      );
    }
  }

  return faults;
}

// ===========================================================================
// READING KRA'S ANSWER BACK
// ===========================================================================

export interface EtimsReceiptData {
  receiptSignature: string;
  internalData: string | null;
  kraInvoiceNumber: number | null;
  totalReceiptNumber: number | null;
  controlUnitId: string | null;
  controlUnitDateTime: string | null;
}

/**
 * The parts of a successful eTIMS response that must appear on the customer's
 * receipt, pulled out of the envelope KRA wraps them in.
 *
 * A receipt that omits these is not a valid tax invoice however correct its
 * figures are: the signature and the control-unit number are what let anyone
 * verify the document was actually filed. They are stored on the transmission
 * row so a reprint reproduces them rather than re-transmitting.
 *
 * Tolerant of shape by design. The OSCU and VSCU flavours of the API, and the
 * sandbox and production deployments, nest this differently; a receipt is worth
 * printing whenever the signature is recoverable at all.
 */
export function readEtimsReceipt(response: any): EtimsReceiptData | null {
  const d = response?.data ?? response ?? {};
  const inner = d?.rcptSign ? d : (d?.receipt ?? d?.result ?? d);

  const signature = inner?.rcptSign ?? inner?.receiptSignature ?? null;
  if (!signature) return null;

  const asInt = (v: unknown) => {
    const n = parseInt(String(v ?? ""), 10);
    return Number.isFinite(n) ? n : null;
  };

  return {
    receiptSignature: String(signature),
    internalData: inner?.intrlData ?? inner?.internalData ?? null,
    // KRA's own receipt number for the document, which differs from the device
    // sequence we sent.
    kraInvoiceNumber: asInt(inner?.curRcptNo ?? inner?.rcptNo),
    totalReceiptNumber: asInt(inner?.totRcptNo),
    controlUnitId: inner?.sdcId ?? d?.sdcId ?? null,
    controlUnitDateTime: inner?.vsdcRcptPbctDate ?? inner?.sdcDateTime ?? null,
  };
}

/**
 * The receipt-verification URL printed as a QR code.
 *
 * Composed from the parts rather than trusting the response to carry one, so a
 * receipt always has a QR to print — KRA returns the link on some deployments
 * and not others, and it encodes the same three values either way.
 */
export function etimsVerificationUrl(
  { pin, branchId, receiptSignature, environment = "production" }: {
    pin?: string | null;
    branchId?: string | null;
    receiptSignature?: string | null;
    environment?: string | null;
  },
): string | null {
  if (!pin || !receiptSignature) return null;
  const host = environment === "production" ? "https://etims.kra.go.ke" : "https://etims-sbx.kra.go.ke";
  const branch = branchId || HEAD_OFFICE_BRANCH;
  return `${host}/common/link/etims/receipt/indexEtimsReceiptData?Data=${
    normaliseKraPin(pin)
  }${branch}${receiptSignature}`;
}

// ===========================================================================
// STOCK
//
// KRA wants two unrelated statements about stock and the difference matters:
//
//   insertStockIO    a MOVEMENT, sequenced per device by sarNo the way an
//                    invoice is sequenced by invcNo.
//   saveStockMaster  a BALANCE. Not a movement -- the declared quantity now.
//
// Both are built here so the arithmetic is the one the invoice already uses:
// buildLine() prices a stock line exactly as it prices a sales line, which is
// what keeps a movement's tax consistent with the document that caused it.
// ===========================================================================

/**
 * sarTyCd -- why stock moved.
 *
 * KRA's authoritative list comes from selectCodeList, which nothing fetches
 * yet, so these are the four this system actually needs and no more. They are
 * defaults, not assertions: every movement row carries its own overridable
 * movement_code, so a tenant whose KRA agent gives them a different code can
 * use it. See migration 20260905140000.
 */
export const STOCK_MOVEMENT_CODES = {
  SALE: "11",
  PURCHASE: "02",
  ADJUST_IN: "06",
  ADJUST_OUT: "16",
} as const;

/**
 * The code to use when a movement carries none.
 *
 * Incoming defaults to purchase and outgoing to sale because those are the two
 * that arrive automatically. An adjustment is always raised by hand, and the
 * hand that raises it chooses the reason.
 */
export const defaultStockMovementCode = (direction?: string | null): string =>
  direction === "in" ? STOCK_MOVEMENT_CODES.PURCHASE : STOCK_MOVEMENT_CODES.SALE;

export interface BuildStockInput {
  sarNumber?: number | null;
  seller?: EtimsSeller;
  direction?: "in" | "out";
  movementCode?: string | null;
  line?: EtimsLineInput;
  /** Required, exactly as for a sale -- there is no safe default. */
  pricesIncludeTax?: boolean;
  occurredAt?: string | Date;
  /** 'A' when a sale produced it, 'M' when a person did. */
  registrationType?: string | null;
  operator?: { id?: string | null; name?: string | null };
  remark?: string | null;
}

/**
 * Build the payload for `insertStockIO`.
 *
 * Quantities stay POSITIVE in both directions. Unlike a credit note -- which is
 * a negated sale -- a stock movement says which way it went in sarTyCd, and a
 * negative quantity alongside an outgoing code would state the direction twice,
 * in two places that can then disagree.
 */
export function buildStockMovementDocument(input: BuildStockInput = {}): BuildDocumentResult {
  const {
    sarNumber = null,
    seller = {},
    direction = "out",
    movementCode = null,
    line = {},
    pricesIncludeTax,
    occurredAt = new Date(),
    registrationType = "M",
    operator = {},
    remark = null,
  } = input;

  const problems: string[] = [];

  if (typeof pricesIncludeTax !== "boolean") {
    problems.push(
      "Whether the recorded price includes tax was not stated, so the tax on this movement cannot be worked out either way.",
    );
  }

  const sellerPin = normaliseKraPin(seller.pin);
  if (!isValidKraPin(sellerPin)) {
    problems.push(
      sellerPin
        ? `The seller's KRA PIN "${sellerPin}" is not a valid PIN.`
        : "No seller KRA PIN is configured for eTIMS.",
    );
  }

  if (!Number.isInteger(sarNumber) || (sarNumber as number) <= 0) {
    problems.push("No eTIMS stock sequence number was allocated for this movement.");
  }

  if (direction !== "in" && direction !== "out") {
    problems.push(`"${direction}" is not a stock direction.`);
  }

  const occurredOn = etimsDate(occurredAt);
  if (!occurredOn) problems.push("The movement has no usable date.");

  const built = buildLine({
    line,
    seq: 1,
    pricesIncludeTax: pricesIncludeTax === true,
    asOf: occurredAt,
  });
  problems.push(...built.problems);

  const totals: BuildDocumentResult["totals"] = {
    taxable: built.figures.taxableAmount,
    tax: built.figures.taxAmount,
    total: built.figures.totalAmount,
    byCode: TAX_CODE_KEYS.reduce((acc, c) => {
      const mine = c === built.taxCode;
      acc[c] = {
        taxable: mine ? built.figures.taxableAmount : 0,
        tax: mine ? built.figures.taxAmount : 0,
        rate: mine ? taxRateFor(c, occurredAt) : null,
      };
      return acc;
    }, {} as BuildDocumentResult["totals"]["byCode"]),
  };

  const payload: Record<string, unknown> = {
    tin: sellerPin,
    bhfId: String(seller.branchId ?? HEAD_OFFICE_BRANCH),
    sarNo: sarNumber,
    // KRA reads 0 as "this movement reverses nothing".
    orgSarNo: 0,
    regTyCd: registrationType ?? "M",
    // A movement of a tenant's own stock has no counterparty. Present as
    // explicit nulls because omitting the keys fails schema validation.
    custTin: null,
    custNm: null,
    custBhfId: null,
    sarTyCd: movementCode ?? defaultStockMovementCode(direction),
    ocrnDt: occurredOn,
    totItemCnt: 1,
    totTaxblAmt: totals.taxable,
    totTaxAmt: totals.tax,
    totAmt: totals.total,
    remark: remark ?? null,
    regrId: operator.id ?? "system",
    regrNm: operator.name ?? "Ararat",
    modrId: operator.id ?? "system",
    modrNm: operator.name ?? "Ararat",
    itemList: [built.item],
  };

  return { ok: problems.length === 0, problems, payload, totals };
}

/**
 * Build the payload for `saveStockMaster` -- the declared quantity of one item.
 *
 * This is the call that actually keeps KRA's stock position right. A tenant who
 * never records a single manual adjustment still has a correct balance here,
 * because the quantity comes from assets.quantity_available, which the POS
 * itself maintains on every sale.
 */
export function buildStockMasterPayload(
  { seller = {}, itemCode, remainingQuantity, operator = {} }: {
    seller?: EtimsSeller;
    itemCode?: string | null;
    remainingQuantity?: number | string | null;
    operator?: { id?: string | null; name?: string | null };
  },
): { ok: boolean; problems: string[]; payload: Record<string, unknown> } {
  const problems: string[] = [];
  const pin = normaliseKraPin(seller.pin);

  if (!isValidKraPin(pin)) problems.push("No valid seller KRA PIN is configured for eTIMS.");
  if (!itemCode) problems.push("A stock balance needs an item code.");

  const qty = round2(num(remainingQuantity));
  if (qty < 0) problems.push("A stock balance cannot be negative.");

  return {
    ok: problems.length === 0,
    problems,
    payload: {
      tin: pin,
      bhfId: String(seller.branchId ?? HEAD_OFFICE_BRANCH),
      itemCd: itemCode ?? "",
      rsdQty: qty,
      regrId: operator.id ?? "system",
      regrNm: operator.name ?? "Ararat",
      modrId: operator.id ?? "system",
      modrNm: operator.name ?? "Ararat",
    },
  };
}

// ===========================================================================
// PURCHASES
//
// Everything here came from KRA. Nothing in this section computes a purchase
// figure -- see the header of migration 20260905150000. The two functions below
// are a flattening on the way in and an echo on the way out.
// ===========================================================================

/** pchsSttsCd. Defaults, for the same reason as the stock codes above. */
export const PURCHASE_STATUS_CODES = { APPROVED: "02", REJECTED: "05" } as const;

export interface NormalisedPurchase {
  supplierPin: string;
  supplierName: string | null;
  supplierBranch: string | null;
  supplierInvoiceNo: number;
  supplierSdcId: string | null;
  supplierMrcNo: string | null;
  receiptType: string | null;
  paymentType: string | null;
  purchaseDate: string | null;
  totalTaxable: number;
  totalTax: number;
  totalAmount: number;
  source: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
}

/**
 * Flatten one record from `selectTrnsPurchaseSalesList` into the columns the
 * review screen reads.
 *
 * Returns null for anything missing the two fields that IDENTIFY a purchase --
 * the supplier's PIN and their invoice number. Those are the key KRA
 * reconciles on, so a record without them can be neither filed back nor
 * deduplicated; it is skipped rather than stored as a half-record.
 *
 * Tolerant of shape for the same reason readEtimsReceipt is: the OSCU and VSCU
 * flavours nest and name these differently.
 */
export function normalisePurchase(record: any): NormalisedPurchase | null {
  if (!record) return null;

  const supplierPin = normaliseKraPin(record.spplrTin ?? record.supplierTin ?? null);
  const invoiceNo = parseInt(String(record.spplrInvcNo ?? record.invcNo ?? ""), 10);
  if (!supplierPin || !Number.isFinite(invoiceNo)) return null;

  const rawItems: any[] = Array.isArray(record.itemList) ? record.itemList : [];

  return {
    supplierPin,
    supplierName: record.spplrNm ?? null,
    supplierBranch: record.spplrBhfId ?? null,
    supplierInvoiceNo: invoiceNo,
    supplierSdcId: record.spplrSdcId ?? record.sdcId ?? null,
    supplierMrcNo: record.spplrMrcNo ?? record.mrcNo ?? null,
    receiptType: record.rcptTyCd ?? null,
    paymentType: record.pmtTyCd ?? null,
    // KRA sends yyyyMMdd. Anything else is left null rather than guessed at.
    purchaseDate: typeof record.salesDt === "string" && /^\d{8}$/.test(record.salesDt)
      ? `${record.salesDt.slice(0, 4)}-${record.salesDt.slice(4, 6)}-${record.salesDt.slice(6, 8)}`
      : null,
    totalTaxable: num(record.totTaxblAmt),
    totalTax: num(record.totTaxAmt),
    totalAmount: num(record.totAmt),
    source: record,
    items: rawItems.map((it, i) => ({
      item_seq: parseInt(String(it?.itemSeq ?? i + 1), 10) || i + 1,
      item_code: it?.itemCd ?? null,
      classification_code: it?.itemClsCd ?? null,
      item_name: it?.itemNm ?? null,
      quantity: num(it?.qty),
      quantity_unit: it?.qtyUnitCd ?? null,
      packaging_unit: it?.pkgUnitCd ?? null,
      unit_price: num(it?.prc),
      supply_amount: num(it?.splyAmt),
      discount_amount: num(it?.totDcAmt ?? it?.dcAmt),
      tax_code: it?.taxTyCd ?? null,
      taxable_amount: num(it?.taxblAmt),
      tax_amount: num(it?.taxAmt),
      total_amount: num(it?.totAmt),
    })),
  };
}

/**
 * Build the payload for `insertTrnsPurchase`.
 *
 * DELIBERATELY AN ECHO. KRA's own record of the supplier's filing is spread
 * first and only the fields that are genuinely ours are overridden: who we are,
 * our sequence number, our verdict, and who recorded it. Rebuilding the
 * document from the flattened columns instead would let this system's
 * arithmetic disagree with the supplier's filing, and a disagreement between
 * the two sides of one transaction is a reconciliation failure on somebody's
 * VAT return.
 */
export function buildPurchaseDocument(
  { source, seller = {}, invoiceNumber = null, accepted, operator = {}, remark = null }: {
    source?: Record<string, unknown> | null;
    seller?: EtimsSeller;
    invoiceNumber?: number | null;
    accepted?: boolean;
    operator?: { id?: string | null; name?: string | null };
    remark?: string | null;
  },
): { ok: boolean; problems: string[]; payload: Record<string, unknown> } {
  const problems: string[] = [];
  const pin = normaliseKraPin(seller.pin);

  if (!isValidKraPin(pin)) problems.push("No valid KRA PIN is configured for eTIMS.");
  if (!source || typeof source !== "object") {
    problems.push("This purchase has no record from KRA to file back.");
  }
  if (!Number.isInteger(invoiceNumber) || (invoiceNumber as number) <= 0) {
    problems.push("No eTIMS sequence number was allocated for this purchase.");
  }
  if (typeof accepted !== "boolean") {
    problems.push("This purchase has not been accepted or rejected.");
  }

  return {
    ok: problems.length === 0,
    problems,
    payload: {
      ...(source ?? {}),
      tin: pin,
      bhfId: String(seller.branchId ?? HEAD_OFFICE_BRANCH),
      invcNo: invoiceNumber,
      orgInvcNo: 0,
      pchsSttsCd: accepted ? PURCHASE_STATUS_CODES.APPROVED : PURCHASE_STATUS_CODES.REJECTED,
      cfmDt: etimsDateTime(new Date()),
      remark: remark ?? (source as any)?.remark ?? null,
      regrId: operator.id ?? "system",
      regrNm: operator.name ?? "Ararat",
      modrId: operator.id ?? "system",
      modrNm: operator.name ?? "Ararat",
    },
  };
}

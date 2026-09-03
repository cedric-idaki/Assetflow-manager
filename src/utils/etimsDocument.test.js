/**
 * Tests for the eTIMS document builder.
 *
 * The builder lives in supabase/functions/_shared/etims.ts because a browser
 * must not be able to assert the figures on a tax document. It is imported
 * here directly — the same route src/config/planCatalogs.sync.test.js already
 * takes into _shared/plans.ts — so the arithmetic that produces a tenant's VAT
 * return is exercised by `npm test` rather than only by calling KRA.
 *
 * What these tests are actually protecting:
 *
 *   1. The header can never disagree with the lines. KRA rejects a document
 *      that fails its own cross-check, and the failure mode looks exactly like
 *      an outage.
 *   2. Tax-inclusive and tax-exclusive produce DIFFERENT, individually correct
 *      figures. Confusing them misstates every line silently.
 *   3. Nothing is ever guessed. An unclassified item stops the document.
 */

import { describe, it, expect } from 'vitest';
import {
  buildEtimsSalesDocument,
  verifyDocumentTotals,
  readEtimsReceipt,
  etimsVerificationUrl,
  etimsDate,
  etimsDateTime,
  taxRateFor,
  round2,
  isValidKraPin,
  paymentTypeCode,
} from '../../supabase/functions/_shared/etims.ts';

const SELLER = { pin: 'P051234567X', branchId: '00', name: 'Ararat Traders', address: 'Nairobi' };

/** A standard-rated line, fully classified. */
const line = (over = {}) => ({
  description: 'Widget',
  itemCode: 'W-1',
  classificationCode: '5059230800',
  taxCode: 'B',
  quantity: 1,
  unitPrice: 1000,
  ...over,
});

const build = (over = {}) =>
  buildEtimsSalesDocument({
    invoiceNumber: 1,
    seller: SELLER,
    lines: [line()],
    pricesIncludeTax: false,
    saleDate: '2026-09-02T09:30:00.000Z',
    ...over,
  });

describe('preconditions', () => {
  it('builds cleanly when everything is present', () => {
    const r = build();
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('refuses a sale that does not say whether prices include tax', () => {
    const r = build({ pricesIncludeTax: undefined });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/include tax/i);
  });

  it('refuses an invalid seller PIN', () => {
    expect(build({ seller: { ...SELLER, pin: 'NOTAPIN' } }).problems.join(' '))
      .toMatch(/not a valid PIN/);
    expect(build({ seller: { ...SELLER, pin: '' } }).problems.join(' '))
      .toMatch(/No seller KRA PIN/);
  });

  it('accepts a sale with no buyer PIN but refuses a malformed one', () => {
    expect(build({ buyer: { name: 'Walk-in' } }).ok).toBe(true);
    expect(build({ buyer: { pin: 'P123' } }).problems.join(' ')).toMatch(/not a valid PIN/);
  });

  it('refuses a document with no allocated sequence number', () => {
    expect(build({ invoiceNumber: null }).problems.join(' ')).toMatch(/sequence number/);
    expect(build({ invoiceNumber: 0 }).problems.join(' ')).toMatch(/sequence number/);
  });

  it('refuses a document with no lines', () => {
    expect(build({ lines: [] }).problems.join(' ')).toMatch(/no lines/);
  });
});

describe('classification is never guessed', () => {
  it('refuses a line with no tax code rather than assuming standard rate', () => {
    const r = build({ lines: [line({ taxCode: null })] });
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/no KRA tax classification/);
  });

  it('refuses a tax code KRA does not define', () => {
    expect(build({ lines: [line({ taxCode: 'Z' })] }).problems.join(' '))
      .toMatch(/which KRA does not define/);
  });

  it('refuses a line with no item classification code', () => {
    expect(build({ lines: [line({ classificationCode: null })] }).problems.join(' '))
      .toMatch(/no KRA item classification code/);
  });

  it('names EVERY faulty line in one pass, not just the first', () => {
    const r = build({
      lines: [
        line({ description: 'One', taxCode: null }),
        line({ description: 'Two', classificationCode: null }),
        line({ description: 'Three', quantity: 0 }),
      ],
    });
    const joined = r.problems.join(' ');
    expect(joined).toMatch(/"One"/);
    expect(joined).toMatch(/"Two"/);
    expect(joined).toMatch(/"Three"/);
  });
});

describe('tax-exclusive pricing (the POS)', () => {
  it('adds tax on top of the captured price', () => {
    const { payload, totals } = build({ lines: [line({ unitPrice: 1000, quantity: 1 })] });
    expect(totals.taxable).toBe(1000);
    expect(totals.tax).toBe(160);
    expect(totals.total).toBe(1160);
    expect(payload.itemList[0].taxblAmt).toBe(1000);
    expect(payload.itemList[0].taxAmt).toBe(160);
  });

  it('takes the discount off before taxing', () => {
    const { totals } = build({
      lines: [line({ unitPrice: 1000, quantity: 1, discountAmount: 100 })],
    });
    expect(totals.taxable).toBe(900);
    expect(totals.tax).toBe(144);
    expect(totals.total).toBe(1044);
  });

  it('derives the discount rate from the amount so the two cannot disagree', () => {
    const { payload } = build({
      lines: [line({ unitPrice: 200, quantity: 2, discountAmount: 40 })],
    });
    expect(payload.itemList[0].dcAmt).toBe(40);
    expect(payload.itemList[0].dcRt).toBe(10); // 40 of 400
  });
});

describe('tax-inclusive pricing (platform billing)', () => {
  it('strips the tax out of the charge instead of adding to it', () => {
    const { totals } = build({
      pricesIncludeTax: true,
      lines: [line({ unitPrice: 1160, quantity: 1 })],
    });
    expect(totals.taxable).toBe(1000);
    expect(totals.tax).toBe(160);
    // The customer still pays exactly what was charged.
    expect(totals.total).toBe(1160);
  });

  it('never loses a cent: taxable + tax is EXACTLY the charge', () => {
    // 999.99 inclusive of 16% does not divide evenly.
    const { totals } = build({
      pricesIncludeTax: true,
      lines: [line({ unitPrice: 999.99, quantity: 1 })],
    });
    expect(round2(totals.taxable + totals.tax)).toBe(999.99);
    expect(totals.total).toBe(999.99);
  });

  it('produces different figures from the exclusive reading of the same price', () => {
    const inclusive = build({ pricesIncludeTax: true, lines: [line({ unitPrice: 1000 })] });
    const exclusive = build({ pricesIncludeTax: false, lines: [line({ unitPrice: 1000 })] });
    expect(inclusive.totals.tax).not.toBe(exclusive.totals.tax);
    expect(inclusive.totals.total).toBe(1000);
    expect(exclusive.totals.total).toBe(1160);
  });
});

describe('the header can never disagree with the lines', () => {
  it('sums rounded line figures rather than recomputing the total', () => {
    // Three lines that each round, at a price that does not divide evenly.
    const r = build({
      lines: [
        line({ description: 'A', unitPrice: 333.33, quantity: 3 }),
        line({ description: 'B', unitPrice: 16.67, quantity: 7 }),
        line({ description: 'C', unitPrice: 0.01, quantity: 99 }),
      ],
    });
    expect(verifyDocumentTotals(r.payload)).toEqual([]);
  });

  it('holds across a mix of tax codes', () => {
    const r = build({
      lines: [
        line({ description: 'Standard', taxCode: 'B', unitPrice: 1000 }),
        line({ description: 'Exempt', taxCode: 'A', unitPrice: 500 }),
        line({ description: 'Zero rated', taxCode: 'C', unitPrice: 250 }),
        line({ description: 'Fuel', taxCode: 'E', unitPrice: 100 }),
      ],
    });
    expect(r.ok).toBe(true);
    expect(verifyDocumentTotals(r.payload)).toEqual([]);

    // Each bucket carries only its own code's lines.
    expect(r.payload.taxblAmtB).toBe(1000);
    expect(r.payload.taxAmtB).toBe(160);
    expect(r.payload.taxblAmtA).toBe(500);
    expect(r.payload.taxAmtA).toBe(0);
    expect(r.payload.taxblAmtC).toBe(250);
    expect(r.payload.taxAmtC).toBe(0);
    expect(r.payload.taxblAmtE).toBe(100);
    expect(r.payload.taxAmtE).toBe(8);
    // A code with no lines is present and zero, not omitted.
    expect(r.payload.taxblAmtD).toBe(0);
    expect(r.payload.taxAmtD).toBe(0);
  });

  it('reports a header that has been tampered with', () => {
    const r = build();
    const faults = verifyDocumentTotals({ ...r.payload, totTaxAmt: 1 });
    expect(faults.join(' ')).toMatch(/totTaxAmt is 1 but the lines sum to 160/);
  });

  it('reports a line that does not add up on its own terms', () => {
    const r = build();
    const broken = structuredClone(r.payload);
    broken.itemList[0].totAmt = 999;
    expect(verifyDocumentTotals(broken).join(' ')).toMatch(/Line 1 totals 999/);
  });
});

describe('credit notes', () => {
  const creditNote = (over = {}) =>
    build({ docType: 'credit_note', originalInvoiceNumber: 7, invoiceNumber: 8, ...over });

  it('negates every money figure', () => {
    const { payload, totals } = creditNote();
    expect(totals.total).toBe(-1160);
    expect(totals.tax).toBe(-160);
    expect(payload.itemList[0].qty).toBe(-1);
    expect(payload.itemList[0].totAmt).toBe(-1160);
    expect(payload.taxblAmtB).toBe(-1000);
  });

  it('still passes its own cross-check once negated', () => {
    expect(verifyDocumentTotals(creditNote().payload)).toEqual([]);
  });

  it('does not fire the positive-quantity check on a valid reversal', () => {
    expect(creditNote().problems).toEqual([]);
    expect(creditNote().ok).toBe(true);
  });

  it('must reference the invoice it reverses', () => {
    expect(creditNote({ originalInvoiceNumber: null }).problems.join(' '))
      .toMatch(/must reference the eTIMS invoice number/);
  });

  it('carries the credit-note receipt type and the original invoice number', () => {
    const { payload } = creditNote();
    expect(payload.rcptTyCd).toBe('R');
    expect(payload.orgInvcNo).toBe(7);
    expect(payload.stockRlsDt).toBeNull(); // nothing leaves the premises
    expect(payload.rfdDt).not.toBeNull();
  });

  it('a plain sale references nothing', () => {
    expect(build().payload.orgInvcNo).toBe(0);
    expect(build().payload.rcptTyCd).toBe('S');
  });
});

describe('dates are East Africa Time', () => {
  it('does not roll a small-hours sale back into the previous day', () => {
    // 01:30 EAT on the 2nd is 22:30 UTC on the 1st.
    expect(etimsDate('2026-09-01T22:30:00.000Z')).toBe('20260902');
    expect(etimsDateTime('2026-09-01T22:30:00.000Z')).toBe('20260902013000');
  });

  it('formats without separators', () => {
    expect(etimsDate('2026-09-02T09:00:00.000Z')).toBe('20260902');
    expect(etimsDateTime('2026-09-02T09:00:00.000Z')).toBe('20260902120000');
  });

  it('returns null on an unusable date rather than a wrong one', () => {
    expect(etimsDate('not a date')).toBeNull();
    expect(build({ saleDate: 'not a date' }).problems.join(' ')).toMatch(/no usable date/);
  });
});

describe('rates come from the regime table, not a constant', () => {
  it('resolves the standard rate by date of supply', () => {
    // The COVID-19 reduction was in force for supplies made in 2020.
    expect(taxRateFor('B', '2020-06-01')).toBe(14);
    expect(taxRateFor('B', '2026-09-02')).toBe(16);
  });

  it('taxes an old sale at the rate that was lawful then', () => {
    const { totals } = build({
      saleDate: '2020-06-01T09:00:00.000Z',
      lines: [line({ unitPrice: 1000 })],
    });
    expect(totals.tax).toBe(140);
  });

  it('holds fixed-rate codes steady across regimes', () => {
    expect(taxRateFor('A', '2020-06-01')).toBe(0);
    expect(taxRateFor('E', '2020-06-01')).toBe(8);
  });

  it('returns null for an unknown code rather than zero', () => {
    expect(taxRateFor('Z')).toBeNull();
  });
});

describe('payment methods map to KRA codes', () => {
  it('maps the methods this system records', () => {
    expect(paymentTypeCode('cash')).toBe('01');
    expect(paymentTypeCode('mpesa')).toBe('06');
    expect(paymentTypeCode('card')).toBe('05');
    expect(paymentTypeCode('cheque')).toBe('04');
  });

  it('falls back to "other" for anything unrecognised', () => {
    expect(paymentTypeCode('barter')).toBe('07');
    expect(paymentTypeCode(null)).toBe('07');
  });
});

describe('KRA PIN validation', () => {
  it.each(['P051234567X', 'A012345678B'])('accepts %s', (pin) => {
    expect(isValidKraPin(pin)).toBe(true);
  });

  it.each(['', 'P05123456X', 'X051234567X', 'P0512345678', 'P05123 4567X!'])(
    'rejects %s',
    (pin) => expect(isValidKraPin(pin)).toBe(false),
  );

  it('tolerates the spaces and lower case people type', () => {
    expect(isValidKraPin(' p051234567x ')).toBe(true);
  });
});

describe('reading KRA back', () => {
  const response = {
    resultCd: '000',
    data: {
      rcptSign: 'ABCD1234EFGH5678',
      intrlData: 'WXYZ9876STUV5432',
      curRcptNo: 42,
      totRcptNo: 1337,
      sdcId: 'KRACU0100000001',
      vsdcRcptPbctDate: '20260902093000',
    },
  };

  it('pulls out what the receipt has to print', () => {
    const r = readEtimsReceipt(response);
    expect(r.receiptSignature).toBe('ABCD1234EFGH5678');
    expect(r.internalData).toBe('WXYZ9876STUV5432');
    expect(r.kraInvoiceNumber).toBe(42);
    expect(r.controlUnitId).toBe('KRACU0100000001');
  });

  it('accepts the response unwrapped, as some deployments return it', () => {
    expect(readEtimsReceipt(response.data)?.receiptSignature).toBe('ABCD1234EFGH5678');
  });

  it('returns null when there is no signature to print', () => {
    expect(readEtimsReceipt({ resultCd: '001', data: null })).toBeNull();
    expect(readEtimsReceipt(null)).toBeNull();
  });

  it('composes a verification URL from the parts', () => {
    const url = etimsVerificationUrl({
      pin: 'P051234567X',
      branchId: '00',
      receiptSignature: 'ABCD1234EFGH5678',
      environment: 'production',
    });
    expect(url).toContain('etims.kra.go.ke');
    expect(url).toContain('P051234567X00ABCD1234EFGH5678');
  });

  it('has no URL to offer without a signature', () => {
    expect(etimsVerificationUrl({ pin: 'P051234567X' })).toBeNull();
  });
});

describe('rounding', () => {
  it('rounds half up, where floating point would round down', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
  });

  it('never produces negative zero', () => {
    expect(Object.is(round2(-0.001), 0)).toBe(true);
  });
});

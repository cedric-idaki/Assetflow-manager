/**
 * Tests for the eTIMS stock and purchase builders.
 *
 * Imported straight out of supabase/functions/_shared/etims.ts, the same route
 * etimsDocument.test.js takes, because none of this can be exercised against
 * KRA from a test run — there is no sandbox call in CI. These tests are the
 * only thing standing between a wrong payload and a wrong tax filing.
 *
 * What they are actually protecting:
 *
 *   1. A movement and a balance stay DIFFERENT things. Sending one where the
 *      other is meant either double-counts stock or fails to correct it.
 *   2. Direction is stated once. A negative quantity alongside an outgoing
 *      code would say it twice, in two places that can disagree.
 *   3. A purchase is never recalculated. Every figure filed back is the
 *      supplier's own, or the two sides of one transaction stop reconciling.
 */

import { describe, it, expect } from 'vitest';
import {
  buildStockMovementDocument,
  buildStockMasterPayload,
  buildPurchaseDocument,
  normalisePurchase,
  defaultStockMovementCode,
  STOCK_MOVEMENT_CODES,
  PURCHASE_STATUS_CODES,
} from '../../supabase/functions/_shared/etims.ts';

const SELLER = { pin: 'P051234567X', branchId: '00' };

const line = (over = {}) => ({
  description: 'Widget',
  itemCode: 'W-1',
  classificationCode: '5059230800',
  taxCode: 'B',
  quantity: 2,
  unitPrice: 100,
  quantityUnit: 'U',
  packagingUnit: 'NT',
  itemType: '2',
  ...over,
});

const movement = (over = {}) =>
  buildStockMovementDocument({
    sarNumber: 3,
    seller: SELLER,
    direction: 'out',
    pricesIncludeTax: false,
    occurredAt: '2026-09-05T09:00:00.000Z',
    line: line(),
    ...over,
  });

describe('stock movements', () => {
  it('builds a complete movement', () => {
    const { ok, problems, payload } = movement();
    expect(problems).toEqual([]);
    expect(ok).toBe(true);
    expect(payload.sarNo).toBe(3);
    expect(payload.tin).toBe('P051234567X');
    expect(payload.itemList).toHaveLength(1);
  });

  it('keeps quantities positive going out, because sarTyCd already says which way', () => {
    const { payload } = movement({ direction: 'out' });
    expect(payload.itemList[0].qty).toBe(2);
    expect(payload.sarTyCd).toBe(STOCK_MOVEMENT_CODES.SALE);
  });

  it('keeps quantities positive coming in too', () => {
    const { payload } = movement({ direction: 'in' });
    expect(payload.itemList[0].qty).toBe(2);
    expect(payload.sarTyCd).toBe(STOCK_MOVEMENT_CODES.PURCHASE);
  });

  it('uses the movement code it was given over the default', () => {
    expect(movement({ movementCode: '16' }).payload.sarTyCd).toBe('16');
  });

  it('reverses nothing', () => {
    expect(movement().payload.orgSarNo).toBe(0);
  });

  it('taxes a movement exactly as the invoice would', () => {
    // Two at 100 net, standard rated: 200 taxable, 32 tax at 16%.
    const { payload, totals } = movement();
    expect(totals.taxable).toBe(200);
    expect(payload.totTaxblAmt).toBe(200);
    expect(payload.totTaxAmt).toBe(totals.tax);
    expect(payload.totAmt).toBe(totals.taxable + totals.tax);
  });

  it('refuses to guess whether the price included tax', () => {
    expect(movement({ pricesIncludeTax: undefined }).problems.join(' '))
      .toMatch(/includes tax was not stated/);
  });

  it('refuses a movement with no allocated sequence number', () => {
    expect(movement({ sarNumber: null }).problems.join(' '))
      .toMatch(/no eTIMS stock sequence number/i);
  });

  it('refuses an unclassified item, rather than filing it as something', () => {
    expect(movement({ line: line({ taxCode: null }) }).problems.join(' '))
      .toMatch(/no KRA tax classification/);
  });

  it('marks a sale-driven movement automatic and a hand-raised one manual', () => {
    expect(movement({ registrationType: 'A' }).payload.regTyCd).toBe('A');
    expect(movement().payload.regTyCd).toBe('M');
  });

  it('defaults in to purchase and out to sale', () => {
    expect(defaultStockMovementCode('in')).toBe('02');
    expect(defaultStockMovementCode('out')).toBe('11');
  });
});

describe('stock balances', () => {
  it('is a balance, not a movement — no sequence number, no direction', () => {
    const { ok, payload } = buildStockMasterPayload({
      seller: SELLER,
      itemCode: 'W-1',
      remainingQuantity: 9,
    });
    expect(ok).toBe(true);
    expect(payload).toMatchObject({ tin: 'P051234567X', bhfId: '00', itemCd: 'W-1', rsdQty: 9 });
    expect(payload.sarNo).toBeUndefined();
    expect(payload.sarTyCd).toBeUndefined();
  });

  it('declares zero rather than omitting a sold-out item', () => {
    expect(buildStockMasterPayload({ seller: SELLER, itemCode: 'W-1', remainingQuantity: 0 }).payload.rsdQty)
      .toBe(0);
  });

  it('refuses a negative balance', () => {
    expect(buildStockMasterPayload({ seller: SELLER, itemCode: 'W-1', remainingQuantity: -1 }).problems.join(' '))
      .toMatch(/cannot be negative/);
  });

  it('refuses to build without an item code', () => {
    expect(buildStockMasterPayload({ seller: SELLER, remainingQuantity: 1 }).problems.join(' '))
      .toMatch(/needs an item code/);
  });
});

// ── Purchases ────────────────────────────────────────────────────────────────

const KRA_PURCHASE = {
  spplrTin: 'P098765432Z',
  spplrNm: 'Acme Supplies Ltd',
  spplrBhfId: '00',
  spplrInvcNo: 4412,
  spplrSdcId: 'SDC0010',
  rcptTyCd: 'S',
  pmtTyCd: '01',
  salesDt: '20260901',
  totTaxblAmt: 1000,
  totTaxAmt: 160,
  totAmt: 1160,
  itemList: [
    {
      itemSeq: 1,
      itemCd: 'ACME-1',
      itemClsCd: '5059230800',
      itemNm: 'Bolts',
      qty: 10,
      qtyUnitCd: 'U',
      prc: 100,
      splyAmt: 1000,
      taxTyCd: 'B',
      taxblAmt: 1000,
      taxAmt: 160,
      totAmt: 1160,
    },
  ],
};

describe('reading a purchase from KRA', () => {
  it('flattens the record the review screen shows', () => {
    const p = normalisePurchase(KRA_PURCHASE);
    expect(p.supplierPin).toBe('P098765432Z');
    expect(p.supplierInvoiceNo).toBe(4412);
    expect(p.purchaseDate).toBe('2026-09-01');
    expect(p.totalTax).toBe(160);
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ item_code: 'ACME-1', tax_code: 'B', tax_amount: 160 });
  });

  it('keeps KRA record verbatim as the source of truth', () => {
    expect(normalisePurchase(KRA_PURCHASE).source).toBe(KRA_PURCHASE);
  });

  it('skips a record with no supplier PIN — it can never be reconciled', () => {
    expect(normalisePurchase({ ...KRA_PURCHASE, spplrTin: null })).toBeNull();
  });

  it('skips a record with no supplier invoice number', () => {
    expect(normalisePurchase({ ...KRA_PURCHASE, spplrInvcNo: null, invcNo: null })).toBeNull();
  });

  it('leaves an unparseable date null rather than inventing one', () => {
    expect(normalisePurchase({ ...KRA_PURCHASE, salesDt: 'last Tuesday' }).purchaseDate).toBeNull();
  });
});

describe('filing a purchase back', () => {
  const filed = (over = {}) =>
    buildPurchaseDocument({
      source: KRA_PURCHASE,
      seller: SELLER,
      invoiceNumber: 12,
      accepted: true,
      ...over,
    });

  it('echoes the supplier figures untouched', () => {
    const { payload } = filed();
    expect(payload.totTaxblAmt).toBe(1000);
    expect(payload.totTaxAmt).toBe(160);
    expect(payload.totAmt).toBe(1160);
    expect(payload.itemList).toEqual(KRA_PURCHASE.itemList);
  });

  it('keeps the supplier identity from KRA and writes our own over the top', () => {
    const { payload } = filed();
    expect(payload.spplrTin).toBe('P098765432Z');
    expect(payload.spplrInvcNo).toBe(4412);
    expect(payload.tin).toBe('P051234567X');
    expect(payload.invcNo).toBe(12);
  });

  it('carries the verdict', () => {
    expect(filed({ accepted: true }).payload.pchsSttsCd).toBe(PURCHASE_STATUS_CODES.APPROVED);
    expect(filed({ accepted: false }).payload.pchsSttsCd).toBe(PURCHASE_STATUS_CODES.REJECTED);
  });

  it('refuses to file a purchase nobody ruled on', () => {
    expect(filed({ accepted: undefined }).problems.join(' '))
      .toMatch(/not been accepted or rejected/);
  });

  it('refuses to file without KRA record to echo', () => {
    expect(filed({ source: null }).problems.join(' ')).toMatch(/no record from KRA/);
  });

  it('refuses to file without an allocated sequence number', () => {
    expect(filed({ invoiceNumber: null }).problems.join(' '))
      .toMatch(/no eTIMS sequence number/i);
  });
});

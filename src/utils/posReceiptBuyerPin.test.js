/**
 * The buyer's KRA PIN on a POS receipt.
 *
 * WHAT MATTERS HERE IS THE SNAPSHOT, not the rendering. A receipt that names
 * the buyer is a tax invoice they can claim input tax on; one that does not is
 * a till slip. So the number printed has to be the number THAT SALE was issued
 * with — and a reprint two years later must reproduce it even if the client
 * record has since been corrected, replaced or deleted.
 *
 * The failure this file exists to catch is the tempting shortcut: joining to
 * `clients` at print time and printing whatever it says today.
 */

import { describe, it, expect } from 'vitest';
import { posReceiptDocument, reprintArgsFromSale, THERMAL, A4 } from './posReceiptDocument';

const COMPANY = { company_name: 'Ararat Motors Ltd', kra_pin: 'P051234567X' };
const ASSET   = { description: 'Toyota Prado TX 2019', asset_code: 'AST-0001', asset_type: 'vehicle' };

const SALE = {
  pricingModel: 'cash',
  sellingPrice: 100000,
  discountAmount: 0,
  vatAmount: 16000,
  vatPercent: 16,
  totalAmount: 116000,
  depositAmount: 0,
  financeBalance: 0,
  paymentMethod: 'mpesa',
  mpesaRef: 'QGH7X21LMN',
};

const build = (args, format = THERMAL) =>
  posReceiptDocument({ format, saleData: SALE, asset: ASSET, companyProfile: COMPANY, ...args });

describe('buyer KRA PIN on the printed receipt', () => {
  it('prints the PIN captured for this sale on both papers', () => {
    const args = {
      client: { full_name: 'Jane Wanjiru', account_number: 'ACC-001' },
      buyerKraPin: 'A001234567B',
      receiptNo: 'RCP-1',
    };
    expect(build(args, THERMAL)).toContain('A001234567B');
    expect(build(args, A4)).toContain('A001234567B');
  });

  it('falls back to the PIN on the client record when the sale carries none', () => {
    const out = build({
      client: { full_name: 'Jane Wanjiru', account_number: 'ACC-001', kra_pin: 'A009876543C' },
      receiptNo: 'RCP-2',
    });
    expect(out).toContain('A009876543C');
  });

  it('prefers the sale PIN over the client record, because that is what was issued', () => {
    const out = build({
      client: { full_name: 'Jane Wanjiru', kra_pin: 'A009876543C' },
      buyerKraPin: 'A001234567B',
      receiptNo: 'RCP-3',
    });
    expect(out).toContain('A001234567B');
    expect(out).not.toContain('A009876543C');
  });

  it('prints no PIN line at all when neither has one', () => {
    const out = build({ client: { full_name: 'Walk-in' }, receiptNo: 'RCP-4' });
    // The seller's PIN is still there; the buyer's must not appear as a blank
    // labelled row, which reads as a missing field rather than an absent one.
    expect(out).toContain('P051234567X');
    expect(out).not.toMatch(/KRA PIN:\s*<\/div>/);
  });

  it('still shows the seller PIN, which is what makes it a receipt at all', () => {
    expect(build({ client: { full_name: 'Walk-in' }, receiptNo: 'RCP-5' }, A4))
      .toContain('P051234567X');
  });
});

describe('buyer KRA PIN on a reprint', () => {
  const storedSale = {
    invoice_number: 'INV-77',
    receipt_number: 'RCP-77',
    pricing_model: 'cash',
    selling_price: 100000,
    discount_amount: 0,
    vat_amount: 16000,
    vat_percent: 16,
    total_amount: 116000,
    deposit_amount: 0,
    finance_balance: 0,
    payment_method: 'mpesa',
    sale_date: '2026-03-01',
    buyer_kra_pin: 'A001234567B',
  };

  it('reproduces the PIN the receipt was issued with, not the one on file now', () => {
    const args = reprintArgsFromSale({
      sale: storedSale,
      // The client record was corrected after the sale. The reprint must not
      // adopt the new number: the customer is holding paper with the old one.
      client: { full_name: 'Jane Wanjiru', kra_pin: 'A0PATCHED99Z' },
      asset: ASSET,
      companyProfile: COMPANY,
    });

    expect(args.buyerKraPin).toBe('A001234567B');
    const out = posReceiptDocument({ format: THERMAL, ...args });
    expect(out).toContain('A001234567B');
    expect(out).not.toContain('A0PATCHED99Z');
  });

  it('falls back to the client record for a sale predating the column', () => {
    const { buyer_kra_pin: _omitted, ...legacy } = storedSale;
    const args = reprintArgsFromSale({
      sale: legacy,
      client: { full_name: 'Jane Wanjiru', kra_pin: 'A009876543C' },
      asset: ASSET,
      companyProfile: COMPANY,
    });

    // Nothing was recorded for that document, so the best available answer is
    // the record — stated as a fallback rather than invented.
    expect(args.buyerKraPin).toBeNull();
    expect(posReceiptDocument({ format: THERMAL, ...args })).toContain('A009876543C');
  });
});

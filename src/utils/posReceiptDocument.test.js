import { describe, it, expect } from 'vitest';
import {
  posReceiptDocument, buildPosReceipt, reprintArgsFromSale, THERMAL, A4,
} from './posReceiptDocument';
import { vatRateOn } from '../config/taxRegulations';

const company = {
  company_name: 'Ararat Motors Ltd',
  physical_address: 'Kimathi Street, Nairobi',
  phone: '+254700000000',
  kra_pin: 'P051234567X',
};

const client = { full_name: 'Grace Wanjiru', account_number: 'ACC-0091', phone: '0722000111' };
const asset  = { description: 'Toyota Probox 2016', asset_code: 'VEH-014', asset_type: 'Vehicle' };

// A cash sale: 100,000 net, 16% VAT, paid in full.
const cashSale = {
  pricingModel: 'cash',
  sellingPrice: 100000,
  discountAmount: 0,
  vatAmount: 16000,
  vatPercent: 16,
  totalAmount: 116000,
  paymentMethod: 'mpesa',
  mpesaRef: 'SJK4H7T9QW',
};

// A hire purchase: same asset, 30,000 down, 12 months.
const hpSale = {
  ...cashSale,
  pricingModel: 'installment',
  depositAmount: 30000,
  financeBalance: 86000,
  interestRate: 12,
  tenureMonths: 12,
  startDate: '2026-10-02',
  monthlyInstallment: 7639.5,
  totalPayable: 121674,
  paymentMethod: 'cash',
  mpesaRef: '',
};

const schedule = [
  { installmentNo: 1,  dueDate: '2026-10-02', openingBalance: 86000, installmentAmount: 7639.5, principalPortion: 6779.5, interestPortion: 860, closingBalance: 79220.5 },
  { installmentNo: 12, dueDate: '2027-09-02', openingBalance: 7564,  installmentAmount: 7639.5, principalPortion: 7564,   interestPortion: 75.5, closingBalance: 0 },
];

const render = (overrides = {}) => posReceiptDocument({
  format: THERMAL,
  saleData: cashSale,
  client, asset, companyProfile: company,
  invoiceNo: 'INV-0007', receiptNo: 'RCP-0007',
  cashier: 'John Otieno',
  issuedAt: '2026-09-02T09:15:00.000Z',
  ...overrides,
});

// Strip tags so an assertion on a figure is not defeated by the markup around it.
const text = (markup) => markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('buildPosReceipt', () => {
  it('receipts only the money taken today, not the whole sale, on a hire purchase', () => {
    // The bug this guards: printing the total on a financed sale hands the
    // customer written proof of a payment they have not made.
    const r = buildPosReceipt({ saleData: hpSale, client, asset, companyProfile: company });
    expect(r.amounts.amountPaid).toBe(30000);
    expect(r.amounts.balance).toBe(86000);
  });

  it('receipts the full total on a cash sale and leaves no balance', () => {
    const r = buildPosReceipt({ saleData: cashSale, client, asset, companyProfile: company });
    expect(r.amounts.amountPaid).toBe(116000);
    expect(r.amounts.balance).toBe(0);
    expect(r.plan).toBeNull();
  });

  it('carries the rate the sale was taxed at, not the rate in force today', () => {
    // A receipt reprinted after a VAT change must still state the rate its own
    // figures were computed with.
    const r = buildPosReceipt({
      saleData: { ...cashSale, vatPercent: 14, vatAmount: 14000 },
      client, asset, companyProfile: company,
    });
    expect(r.amounts.vatPercent).toBe(14);
  });

  it('is an official receipt, not a tax receipt, when no VAT was charged', () => {
    const r = buildPosReceipt({
      saleData: { ...cashSale, vatAmount: 0, totalAmount: 100000 },
      client, asset, companyProfile: company,
    });
    expect(r.isTaxReceipt).toBe(false);
  });
});

describe('posReceiptDocument', () => {
  it('prints the seller, the customer, the item and the money taken', () => {
    const out = text(render());
    expect(out).toContain('Ararat Motors Ltd');
    expect(out).toContain('KRA PIN: P051234567X');
    expect(out).toContain('Grace Wanjiru');
    expect(out).toContain('ACC-0091');
    expect(out).toContain('Toyota Probox 2016');
    expect(out).toContain('VEH-014');
    expect(out).toContain('RCP-0007');
    expect(out).toContain('INV-0007');
    expect(out).toContain('Served by John Otieno');
    expect(out).toContain('M-Pesa');
    expect(out).toContain('SJK4H7T9QW');
  });

  it('shows subtotal, VAT at its own rate, and the total', () => {
    const out = text(render());
    expect(out).toContain('VAT (16%)');
    expect(out).toContain('KES 16,000.00');
    expect(out).toContain('KES 116,000.00');
    expect(out).toContain('TAX RECEIPT');
  });

  it('shows a discount only when one was given', () => {
    expect(text(render())).not.toContain('Discount');
    const out = text(render({ saleData: { ...cashSale, discountAmount: 5000, discountPct: 5 } }));
    expect(out).toContain('Discount (5%)');
    expect(out).toContain('- KES 5,000.00');
  });

  it('shows the deposit and the outstanding balance on a hire purchase', () => {
    const out = text(render({ saleData: hpSale }));
    expect(out).toContain('Deposit Paid Today');
    expect(out).toContain('KES 30,000.00');
    expect(out).toContain('Balance');
    expect(out).toContain('KES 86,000.00');
    expect(out).toContain('Monthly installment');
    expect(out).toContain('KES 7,639.50');
    expect(out).toContain('12 months');
  });

  it('sizes the roll so a thermal printer does not feed a blank A4 sheet', () => {
    expect(render()).toContain('@page { size: 80mm auto; margin: 0; }');
  });

  it('keeps the amortisation schedule off the roll and puts it on A4', () => {
    const roll = text(render({ saleData: hpSale, schedule }));
    expect(roll).not.toContain('Installment Repayment Schedule');

    const sheet = text(render({ format: A4, saleData: hpSale, schedule }));
    expect(sheet).toContain('Installment Repayment Schedule');
    expect(sheet).toContain('02 Oct 2026');
    // ICU abbreviates September as either "Sep" or "Sept" depending on the
    // build; the assertion is that the final due date is on the sheet, not
    // which abbreviation the runtime happens to ship.
    expect(sheet).toMatch(/02 Sept? 2027/);
    expect(sheet).toContain('Customer Signature');
    expect(sheet).toContain('@page { size: A4; margin: 14mm; }');
  });

  it('stamps every copy after the first as a duplicate', () => {
    expect(text(render())).not.toContain('DUPLICATE');
    expect(text(render({ copyNo: 2 }))).toContain('DUPLICATE — COPY 2');
  });

  it('escapes tenant-supplied text — the print window runs on the app origin', () => {
    const out = render({
      client: { full_name: '<img src=x onerror="alert(1)">', account_number: 'A&B' },
      companyProfile: { company_name: '<script>steal()</script>' },
    });
    expect(out).not.toContain('<script>steal()');
    expect(out).not.toContain('onerror="alert(1)"');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('A&amp;B');
  });
});

// ── Reprint ──────────────────────────────────────────────────────────────────
// A stored sale, shaped as public.sales actually holds it.
const storedSale = {
  id: 'sale-1',
  invoice_number: 'INV-0007',
  receipt_number: 'RCP-0007',
  pricing_model: 'installment',
  selling_price: 100000,
  discount_amount: 5000,
  vat_amount: 15200,
  vat_percent: 16,
  total_amount: 110200,
  deposit_amount: 30000,
  finance_balance: 80200,
  interest_rate: 12,
  tenure_months: 2,
  payment_start_date: '2026-10-02',
  payment_method: 'mpesa',
  mpesa_reference: 'SJK4H7T9QW',
  sale_date: '2026-09-02',
};

const storedSchedule = [
  { installment_no: 1, due_date: '2026-10-02', opening_balance: 80200, installment_amount: 40502, principal_portion: 39700, interest_portion: 802, closing_balance: 40500 },
  { installment_no: 2, due_date: '2026-11-02', opening_balance: 40500, installment_amount: 40502, principal_portion: 40095, interest_portion: 407, closing_balance: 0 },
];

describe('reprintArgsFromSale', () => {
  const args = (over = {}) => reprintArgsFromSale({
    sale: { ...storedSale, ...(over.sale || {}) },
    client, asset, companyProfile: company,
    schedule: over.schedule ?? storedSchedule,
    payment: over.payment,
    cashier: over.cashier,
  });

  it('renames the stored schedule into what the document reads', () => {
    const r = args().schedule;
    expect(r[0]).toMatchObject({
      installmentNo: 1, dueDate: '2026-10-02', openingBalance: 80200,
      installmentAmount: 40502, principalPortion: 39700, interestPortion: 802, closingBalance: 40500,
    });
  });

  it('takes the plan figures off the stored schedule, not a fresh calculation', () => {
    // The stored rows are what the customer's contract says; recomputing could
    // print a plan that disagrees with the contract they signed.
    const s = args().saleData;
    expect(s.monthlyInstallment).toBe(40502);
    expect(s.totalPayable).toBe(40502 * 2 + 30000);
  });

  it('omits the plan figures when the schedule never persisted', () => {
    // The schedule insert only warns on failure, so a financed sale can exist
    // with no rows. Better to leave the lines off than invent an installment.
    const s = args({ schedule: [] }).saleData;
    expect(s.monthlyInstallment).toBe(0);
    expect(s.totalPayable).toBe(0);
    const out = text(posReceiptDocument({ ...args({ schedule: [] }), format: THERMAL }));
    expect(out).not.toContain('Monthly installment');
  });

  it('resolves the VAT rate from the sale date when the sale did not record one', () => {
    // Older rows predate vat_percent. The rate that applied is the one in force
    // on the day of supply — never the one in force when it is reprinted.
    const s = args({ sale: { vat_percent: null } }).saleData;
    expect(s.vatPercent).toBe(vatRateOn('2026-09-02'));
    expect(s.vatPercent).toBeGreaterThan(0);
  });

  it('prefers the payment timestamp over the sale date for when money changed hands', () => {
    expect(args({ payment: { payment_date: '2026-09-02T09:15:00Z' } }).issuedAt)
      .toBe('2026-09-02T09:15:00Z');
    expect(args().issuedAt).toBe('2026-09-02');
  });

  it('falls back to the invoice number when no receipt number was stored', () => {
    // Nothing can recover the number a legacy sale was issued under, so the
    // copy must not assert one.
    const out = text(posReceiptDocument({
      ...args({ sale: { receipt_number: null } }), format: THERMAL, copyNo: 2,
    }));
    expect(out).toContain('Invoice INV-0007');
    expect(out).not.toContain('Receipt RCP');
    expect(out).toContain('DUPLICATE');
  });
});

import { describe, it, expect } from 'vitest';
import {
  RECEIPT_METHODS, methodMeta, methodLabel, receiptTypeLabel,
  instalmentDue, instalmentsDue, purchaseDue, loanRef, localToday,
  validateReceiptPayment, isReceiptBookMissing, describeReceiptError,
} from './saccoReceipts';

const ok = { due: 10200.10, amount: '10200.10', method: 'cash', reference: '', paidOn: '2026-09-20', today: '2026-09-25' };

describe('what a payment settles', () => {
  it('prices an instalment as principal plus interest, not the rounded payment column', () => {
    // principal 1234.57 + interest 100.01 = 1334.58, while `payment` was
    // rounded on its own to 1334.57. The RPC checks against the two parts.
    expect(instalmentDue({ principal: 1234.57, interest: 100.01, payment: 1334.57 })).toBe(1334.58);
  });

  it('totals several instalments without floating-point dust', () => {
    expect(instalmentsDue([
      { principal: 9900.10, interest: 300 },
      { principal: 9999.45, interest: 200.99 },
    ])).toBe(20400.54);
    expect(instalmentsDue([])).toBe(0);
  });

  it('adds the buyer fee to a share purchase', () => {
    expect(purchaseDue({ consideration: 6000, fee: 60 })).toBe(6060);
    expect(purchaseDue({ amount: 1000, fee: 0 })).toBe(1000);
  });

  it('quotes a loan by the same slice of its id the receipt prints', () => {
    expect(loanRef('1a2b3c4d-0000-0000-0000-000000000000')).toBe('LN-1A2B3C4D');
  });
});

describe('validateReceiptPayment', () => {
  it('passes a complete cash payment', () => {
    expect(validateReceiptPayment(ok)).toBeNull();
  });

  it('asks for something to settle first', () => {
    expect(validateReceiptPayment({ ...ok, due: 0 })).toMatch(/choose what this payment settles/i);
  });

  it('refuses an amount that is not what is being settled, to the cent', () => {
    expect(validateReceiptPayment({ ...ok, amount: '10200' }))
      .toBe('The amount received (KES 10,200.00) must equal what is being settled (KES 10,200.10).');
    expect(validateReceiptPayment({ ...ok, amount: '' })).toMatch(/enter the amount/i);
  });

  it('demands the reference for M-Pesa, bank and cheque but not cash', () => {
    expect(validateReceiptPayment({ ...ok, method: 'mpesa' })).toBe('Enter the M-Pesa code.');
    expect(validateReceiptPayment({ ...ok, method: 'bank', reference: '  ' })).toBe('Enter the bank reference.');
    expect(validateReceiptPayment({ ...ok, method: 'cheque' })).toBe('Enter the cheque number.');
    expect(validateReceiptPayment({ ...ok, method: 'card' })).toBeNull();
  });

  it('checks the shape of an M-Pesa code, whatever case it was typed in', () => {
    expect(validateReceiptPayment({ ...ok, method: 'mpesa', reference: 'QHX7Y8' })).toMatch(/10 letters and digits/);
    expect(validateReceiptPayment({ ...ok, method: 'mpesa', reference: 'qhx7y8z9ab' })).toBeNull();
  });

  it('refuses an unknown method and a date in the future', () => {
    expect(validateReceiptPayment({ ...ok, method: 'barter' })).toMatch(/how the member paid/i);
    expect(validateReceiptPayment({ ...ok, paidOn: '2026-09-26' })).toMatch(/future/);
    expect(validateReceiptPayment({ ...ok, paidOn: '' })).toMatch(/date the member paid/);
  });
});

describe('localToday', () => {
  it('reads the local calendar, not UTC', () => {
    // 01:30 on 25 Sept in local time is still the 25th, whatever UTC says.
    expect(localToday(new Date(2026, 8, 25, 1, 30))).toBe('2026-09-25');
  });
});

describe('vocabulary', () => {
  it('labels methods and receipt kinds', () => {
    expect(methodLabel('mpesa')).toBe('M-Pesa');
    expect(methodLabel('unknown')).toBe('unknown');
    expect(receiptTypeLabel('share_purchase')).toBe('Share purchase');
    expect(methodMeta('cash').required).toBeUndefined();
    expect(RECEIPT_METHODS.filter((m) => m.required).map((m) => m.value)).toEqual(['mpesa', 'bank', 'cheque']);
  });
});

describe('errors', () => {
  it('recognises a database without the receipt book', () => {
    expect(isReceiptBookMissing({ code: 'PGRST202', message: 'Could not find the function public.sacco_receipt_summary' })).toBe(true);
    expect(isReceiptBookMissing("Could not find the table 'public.sacco_receipts' in the schema cache")).toBe(true);
    expect(isReceiptBookMissing(null)).toBe(false);
    expect(describeReceiptError({ code: 'PGRST202', message: 'x' })).toMatch(/20260925163000/);
  });

  it('turns the race-condition constraint errors into sentences, and keeps the RPC\'s own', () => {
    expect(describeReceiptError({ code: '23505', message: 'duplicate key value violates unique constraint "uq_sacco_receipts_mpesa_ref"' }))
      .toBe('That M-Pesa code is already on another receipt.');
    expect(describeReceiptError({ code: '23505', message: 'M-Pesa code QHX7Y8Z9AB is already receipted on RCT-2026-000001' }))
      .toBe('M-Pesa code QHX7Y8Z9AB is already receipted on RCT-2026-000001');
    expect(describeReceiptError({ code: 'P0001', message: 'Instalment 3 is already paid' })).toBe('Instalment 3 is already paid');
  });
});

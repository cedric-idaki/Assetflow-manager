import { describe, it, expect } from 'vitest';
import { classifyVatAccount, vatAccountIndex, computeVatReturn } from './vatLedger';

const coa = [
  { account_code: '1100', account_name: 'Cash at Bank',   account_type: 'current_asset' },
  { account_code: '1400', account_name: 'Input VAT',      account_type: 'current_asset' },
  { account_code: '2100', account_name: 'VAT Payable',    account_type: 'current_liability' },
  { account_code: '7000', account_name: 'Office Supplies', account_type: 'operating_expense' },
];

const je = (over = {}) => ({
  status: 'posted', entry_date: '2026-08-15', amount: 0,
  debit_account: null, credit_account: null, ...over,
});

describe('classifyVatAccount', () => {
  it('places the unambiguous names by role', () => {
    expect(classifyVatAccount('Input VAT')).toBe('input');
    expect(classifyVatAccount('VAT Receivable')).toBe('input');
    expect(classifyVatAccount('VAT Recoverable')).toBe('input');
    expect(classifyVatAccount('Purchase VAT')).toBe('input');
    expect(classifyVatAccount('Output VAT')).toBe('output');
    expect(classifyVatAccount('VAT Payable')).toBe('output');
    expect(classifyVatAccount('VAT on Sales')).toBe('output');
  });

  it('ignores accounts that are not VAT at all', () => {
    expect(classifyVatAccount('Cash at Bank')).toBeNull();
    expect(classifyVatAccount('Salaries')).toBeNull();
    expect(classifyVatAccount('')).toBeNull();
    // "Advantage" contains "vat" as a substring — a word-boundary test, not a
    // substring test, is what keeps it out of the return.
    expect(classifyVatAccount('Advantage Fees')).toBeNull();
  });

  it('falls back to the account type when the name is ambiguous', () => {
    expect(classifyVatAccount({ account_name: 'VAT Control', account_type: 'current_asset' })).toBe('input');
    expect(classifyVatAccount({ account_name: 'VAT Control', account_type: 'current_liability' })).toBe('output');
    // No name hint and no usable type — reported, never guessed.
    expect(classifyVatAccount({ account_name: 'VAT Control', account_type: 'operating_expense' })).toBeNull();
  });

  it('reads "Value Added Tax" spelled out', () => {
    expect(classifyVatAccount({ account_name: 'Value Added Tax Payable', account_type: 'current_liability' })).toBe('output');
  });
});

describe('vatAccountIndex', () => {
  it('indexes the VAT accounts and reports the ones it cannot place', () => {
    const { index, unclassified } = vatAccountIndex([
      ...coa,
      { account_name: 'VAT Suspense', account_type: 'operating_expense' },
    ]);
    expect(index).toEqual({ 'Input VAT': 'input', 'VAT Payable': 'output' });
    expect(unclassified).toEqual(['VAT Suspense']);
  });
});

describe('computeVatReturn', () => {
  // A month with one sale and one purchase.
  const journals = [
    // Sale of 500,000 + 80,000 VAT
    je({ amount: 500000, debit_account: 'Cash at Bank', credit_account: 'Sales Revenue' }),
    je({ amount: 80000,  debit_account: 'Cash at Bank', credit_account: 'VAT Payable' }),
    // Purchase of 100,000 + 16,000 VAT
    je({ amount: 100000, debit_account: 'Office Supplies', credit_account: 'Cash at Bank' }),
    je({ amount: 16000,  debit_account: 'Input VAT',       credit_account: 'Cash at Bank' }),
  ];

  it('takes input VAT off the ledger, not off a percentage of output', () => {
    const v = computeVatReturn({ journals, chartOfAccounts: coa, period: '2026-08' });
    expect(v.outputVAT).toBe(80000);
    expect(v.inputVAT).toBe(16000);           // the real purchase, not 80,000 * 0.4
    expect(v.netVAT).toBe(64000);
  });

  it('nets a credit note off output VAT instead of ignoring it', () => {
    const withCreditNote = [
      ...journals,
      je({ amount: 8000, debit_account: 'VAT Payable', credit_account: 'Cash at Bank' }),
    ];
    const v = computeVatReturn({ journals: withCreditNote, chartOfAccounts: coa, period: '2026-08' });
    expect(v.outputVAT).toBe(72000);
    expect(v.netVAT).toBe(56000);
  });

  it('nets a returned purchase off input VAT', () => {
    const withReturn = [
      ...journals,
      je({ amount: 4000, debit_account: 'Cash at Bank', credit_account: 'Input VAT' }),
    ];
    expect(computeVatReturn({ journals: withReturn, chartOfAccounts: coa, period: '2026-08' }).inputVAT).toBe(12000);
  });

  it('reports zero input VAT rather than inventing it when none was posted', () => {
    const salesOnly = journals.slice(0, 2);
    const v = computeVatReturn({ journals: salesOnly, chartOfAccounts: coa, period: '2026-08' });
    expect(v.inputVAT).toBe(0);
    expect(v.netVAT).toBe(80000);             // the whole 80,000 is owed
    expect(v.diagnostics.hasInputVatAccount).toBe(true);
    expect(v.diagnostics.inputEntryCount).toBe(0);
  });

  it('distinguishes a missing account from an unused one', () => {
    const noInputAccount = coa.filter(a => a.account_name !== 'Input VAT');
    const v = computeVatReturn({ journals, chartOfAccounts: noInputAccount, period: '2026-08' });
    expect(v.diagnostics.hasInputVatAccount).toBe(false);
    // The journal still names "Input VAT", so the bare-name fallback catches it.
    expect(v.inputVAT).toBe(16000);
  });

  it('confines the return to its period — a return is filed for one month', () => {
    const twoMonths = [
      ...journals,
      je({ amount: 32000, entry_date: '2026-07-10', debit_account: 'Cash at Bank', credit_account: 'VAT Payable' }),
    ];
    expect(computeVatReturn({ journals: twoMonths, chartOfAccounts: coa, period: '2026-08' }).outputVAT).toBe(80000);
    expect(computeVatReturn({ journals: twoMonths, chartOfAccounts: coa, period: '2026-07' }).outputVAT).toBe(32000);
    // No period given: everything, for a running total.
    expect(computeVatReturn({ journals: twoMonths, chartOfAccounts: coa }).outputVAT).toBe(112000);
  });

  it('ignores unposted drafts', () => {
    const withDraft = [...journals, je({ amount: 50000, status: 'draft', credit_account: 'VAT Payable' })];
    expect(computeVatReturn({ journals: withDraft, chartOfAccounts: coa, period: '2026-08' }).outputVAT).toBe(80000);
  });

  it('counts an automated sale once, not twice', () => {
    // The entry both credits the output account AND carries the trigger. The
    // safety net for un-charted accounts must not double it.
    const automated = [je({
      amount: 16000, debit_account: 'Cash at Bank', credit_account: 'VAT Payable',
      trigger_event: 'vat_on_cash_sale',
    })];
    expect(computeVatReturn({ journals: automated, chartOfAccounts: coa, period: '2026-08' }).outputVAT).toBe(16000);
  });

  it('still catches an automated sale posted to an account not in the chart', () => {
    const automated = [je({
      amount: 16000, debit_account: 'Cash', credit_account: 'Tax Collected',
      trigger_event: 'vat_on_cash_sale',
    })];
    expect(computeVatReturn({ journals: automated, chartOfAccounts: coa, period: '2026-08' }).outputVAT).toBe(16000);
  });

  it('does not read a credit to Input VAT as output VAT', () => {
    // The old substring test counted this as output and inflated the liability.
    const clearing = [je({ amount: 16000, debit_account: 'VAT Payable', credit_account: 'Input VAT' })];
    const v = computeVatReturn({ journals: clearing, chartOfAccounts: coa, period: '2026-08' });
    expect(v.outputVAT).toBe(-16000);
    expect(v.inputVAT).toBe(-16000);
    expect(v.netVAT).toBe(0);      // clearing one against the other nets to nil
  });

  it('grosses the tax back up to the value it was charged on', () => {
    const v = computeVatReturn({ journals, chartOfAccounts: coa, period: '2026-08' });
    expect(v.taxableSales).toBe(500000);
    expect(v.taxablePurchases).toBe(100000);
  });

  it('is safe on an empty ledger', () => {
    const v = computeVatReturn({ journals: [], chartOfAccounts: [], period: '2026-08' });
    expect(v).toMatchObject({ outputVAT: 0, inputVAT: 0, netVAT: 0 });
    expect(v.diagnostics.hasInputVatAccount).toBe(false);
  });

  it('is safe when called with nothing at all', () => {
    expect(() => computeVatReturn()).not.toThrow();
  });
});

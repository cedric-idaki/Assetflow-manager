import { describe, it, expect } from 'vitest';
import {
  normaliseJournalRows, normaliseSaccoEntry, normaliseIssuer,
  buildJournalVoucher, buildInvoiceDocument, buildPaymentReceipt,
  buildPayrollVoucher, buildContributionReceipt, buildLoanRepaymentReceipt,
  buildShareTransactionReceipt, buildDividendStatement,
} from './accountingDocument';
import { resolvePayrollRecord } from './kenyaPayroll';

const company = {
  company_name: 'Ararat Ltd',
  kra_pin: 'P051234567X',
  business_registration_number: 'PVT-ABC123',
  location: 'Westlands', city: 'Nairobi',
  phone: '+254700000000', email: 'accounts@ararat.co.ke',
};

// A finance-hub entry as the database holds it: paired rows, one amount each.
const rows = [
  { id: 'r1', entry_no: 'JE-20260902-0001', entry_date: '2026-09-02', description: 'Cash sale — vehicle KDA 001A',
    reference: 'POS-88', entry_type: 'sale', status: 'posted',
    debit_account: '1000 — Cash at Bank', credit_account: '4000 — Sales Revenue', amount: 100000 },
  { id: 'r2', entry_no: 'JE-20260902-0001', entry_date: '2026-09-02', description: 'Cash sale — vehicle KDA 001A',
    reference: 'POS-88', entry_type: 'sale', status: 'posted',
    debit_account: '1000 — Cash at Bank', credit_account: '2100 — VAT Payable', amount: 16000 },
];

describe('normaliseJournalRows', () => {
  it('unwinds paired rows into debit and credit legs', () => {
    const entry = normaliseJournalRows(rows);
    const credits = entry.lines.filter((l) => l.credit > 0).map((l) => l.account);
    expect(credits).toEqual(['4000 — Sales Revenue', '2100 — VAT Payable']);
  });

  it('aggregates an account that is hit twice into one leg', () => {
    // Both rows debit the bank. A voucher shows one bank line of 116,000 —
    // not two half-lines that mirror how the rows happened to be written.
    const bank = normaliseJournalRows(rows).lines.filter((l) => l.account === '1000 — Cash at Bank');
    expect(bank).toHaveLength(1);
    expect(bank[0].debit).toBe(116000);
  });

  it('reads reversed if any row of the entry is reversed', () => {
    const entry = normaliseJournalRows([rows[0], { ...rows[1], status: 'reversed' }]);
    expect(entry.status).toBe('reversed');
  });

  it('falls back to the row id when an entry predates entry_no', () => {
    const entry = normaliseJournalRows([{ ...rows[0], entry_no: null, id: 'abc123def456' }]);
    expect(entry.entryNo).toBe('JE-DEF456');
  });

  it('accepts a single row as well as an array', () => {
    expect(normaliseJournalRows(rows[0]).lines).toHaveLength(2);
  });

  it('survives an empty entry rather than throwing', () => {
    expect(normaliseJournalRows([]).lines).toEqual([]);
  });
});

describe('buildJournalVoucher', () => {
  const voucher = (entry) => buildJournalVoucher({ entry, company });

  it('carries the double entry and totals both sides', () => {
    const v = voucher(normaliseJournalRows(rows));
    expect(v.title).toBe('JOURNAL VOUCHER');
    expect(v.docNo).toBe('JE-20260902-0001');
    expect(v.table.footer).toMatchObject({
      account: 'TOTALS', debit: 'KES 116,000.00', credit: 'KES 116,000.00',
    });
  });

  it('prints an amount on one side of a line only', () => {
    const sales = voucher(normaliseJournalRows(rows)).table.rows
      .find((r) => r.account === '4000 — Sales Revenue');
    expect(sales).toMatchObject({ debit: '', credit: 'KES 100,000.00' });
  });

  it('says on the face of the voucher when an entry does not balance', () => {
    const broken = normaliseJournalRows([{ ...rows[0], credit_account: null }]);
    const v = voucher(broken);
    expect(v.notes.join(' ')).toContain('out of balance by KES 100,000.00');
  });

  it('warns that a reversed entry is retained for the trail only', () => {
    const v = voucher({ ...normaliseJournalRows(rows), status: 'reversed' });
    expect(v.notes.join(' ')).toContain('REVERSED');
  });

  it('records whether the system or a person posted the entry', () => {
    const auto = voucher(normaliseJournalRows([{ ...rows[0], is_automated: true, trigger_event: 'cash_sale_completed' }]));
    expect(auto.meta).toContainEqual({ label: 'Source', value: 'Posted by the system' });
    expect(auto.meta).toContainEqual({ label: 'Trigger', value: 'cash_sale_completed' });
    expect(voucher(normaliseJournalRows(rows)).meta)
      .toContainEqual({ label: 'Source', value: 'Posted manually' });
  });

  it('names the file after the entry', () => {
    expect(voucher(normaliseJournalRows(rows)).filename).toBe('Journal_Voucher_JE-20260902-0001.pdf');
  });
});

describe('normaliseSaccoEntry', () => {
  const entry = {
    entry_no: 'SJ-0007', entry_date: '2026-09-01', description: 'Monthly contribution',
    reference: 'MPESA-XYZ', template_code: 'MEM_CONTRIB', status: 'posted', is_automated: true,
    member: { full_name: 'Grace Wanjiru', member_no: 'M-014' },
    lines: [
      { line_no: 2, account_code: '2100', account_name: 'Member savings', debit: 0, credit: 5000 },
      { line_no: 1, account_code: '1000', account_name: 'Cash at bank',   debit: 5000, credit: 0 },
    ],
  };

  it('keeps the lines in the order they were posted', () => {
    expect(normaliseSaccoEntry(entry).lines.map((l) => l.account))
      .toEqual(['1000 — Cash at bank', '2100 — Member savings']);
  });

  it('names the member whose money moved', () => {
    const v = buildJournalVoucher({ entry: normaliseSaccoEntry(entry), company: { name: 'Umoja Sacco' } });
    expect(v.party).toMatchObject({ heading: 'Member', name: 'Grace Wanjiru' });
    expect(v.party.lines).toContain('Member No: M-014');
  });

  it('prints the society currency rather than assuming shillings', () => {
    const v = buildJournalVoucher({ entry: normaliseSaccoEntry(entry), company: {}, currency: 'UGX' });
    expect(v.table.footer.debit).toBe('UGX 5,000.00');
  });

  it('leaves out the party box for an entry with no member', () => {
    expect(normaliseSaccoEntry({ ...entry, member: null }).party).toBeNull();
  });
});

describe('buildInvoiceDocument', () => {
  const invoice = {
    invoice_no: 'INV-2000', date: '2026-08-30', due_date: '2026-09-29',
    client_name: 'Otieno Odhiambo', account_no: 'AC-0091', client_email: 'o@example.com',
    amount: 50000, vat_amount: 8000, vat_rate: 16, total: 58000,
    method: 'M-Pesa', reference: 'QK12AB34CD', status: 'pending',
    asset: 'Toyota Hiace 2019', asset_code: 'AST-12', plate_number: 'KDA 001A',
  };

  it('prints as a tax invoice while the money is owed', () => {
    const d = buildInvoiceDocument({ invoice, company });
    expect(d.title).toBe('TAX INVOICE');
    expect(d.party.heading).toBe('Bill To');
    expect(d.summary.at(-1)).toMatchObject({ label: 'TOTAL DUE', value: 'KES 58,000.00' });
  });

  it('prints as an official receipt once it is settled', () => {
    const d = buildInvoiceDocument({ invoice: { ...invoice, status: 'paid' }, company });
    expect(d.title).toBe('OFFICIAL RECEIPT');
    expect(d.party.heading).toBe('Received From');
    expect(d.summary.at(-1)).toMatchObject({ label: 'AMOUNT PAID' });
    expect(d.signatures).toEqual([]);
  });

  it('states the VAT rate the invoice was actually raised at', () => {
    // Not a literal 16: an invoice raised under a different rate must keep it.
    const d = buildInvoiceDocument({ invoice: { ...invoice, vat_rate: 14, vat_amount: 7000 }, company });
    expect(d.summary.find((s) => s.label.startsWith('VAT'))).toMatchObject({
      label: 'VAT (14%)', value: 'KES 7,000.00',
    });
  });

  it('bills the line items when the invoice was raised by hand', () => {
    const d = buildInvoiceDocument({
      invoice: { ...invoice, items: [{ description: 'Consultancy', quantity: 2, unit_price: 25000, line_total: 50000 }] },
      company,
    });
    expect(d.table.rows).toEqual([{
      description: 'Consultancy', quantity: '2', unit: 'KES 25,000.00', amount: 'KES 50,000.00',
    }]);
  });

  it('computes a line total the raiser left blank', () => {
    const d = buildInvoiceDocument({
      invoice: { ...invoice, items: [{ description: 'Consultancy', quantity: 3, unit_price: 1500 }] },
      company,
    });
    expect(d.table.rows[0].amount).toBe('KES 4,500.00');
  });

  it('falls back to the asset line for a payment-derived invoice', () => {
    const d = buildInvoiceDocument({ invoice, company });
    expect(d.table.rows[0].description).toContain('Toyota Hiace 2019');
    expect(d.table.rows[0].description).toContain('AST-12 · KDA 001A');
  });

  it('carries the hire-purchase terms onto the client copy', () => {
    const d = buildInvoiceDocument({
      invoice: { ...invoice, plan: { monthly_installment: 12000, tenure_months: 24, financed: 240000, plan_total: 288000 } },
      company,
    });
    expect(d.summary).toContainEqual({ label: 'Monthly installment', value: 'KES 12,000.00' });
    expect(d.summary).toContainEqual({ label: 'Tenure', value: '24 months' });
  });

  it('keeps the filename usable on every OS', () => {
    const d = buildInvoiceDocument({ invoice: { ...invoice, invoice_no: 'INV/2000:A', client_name: 'Otieno Odhiambo' }, company });
    expect(d.filename).toBe('Invoice_INV2000A_Otieno_Odhiambo.pdf');
  });
});

describe('buildPaymentReceipt', () => {
  const txn = {
    transactionId: 'TXN-4411', clientName: 'Grace Wanjiru', accountNumber: 'AC-0031',
    clientPhone: '+254711000000', date: '2026-09-01', time: '14:05',
    paymentMethod: 'bank_transfer', reference: 'FT2609', amount: 25000,
    status: 'completed', assetName: 'Installment 4 of 24', assetCode: 'AST-12',
  };

  it('receipts a completed payment', () => {
    const d = buildPaymentReceipt({ txn, company });
    expect(d.title).toBe('OFFICIAL RECEIPT');
    expect(d.summary[0]).toMatchObject({ label: 'AMOUNT PAID', value: 'KES 25,000.00' });
    expect(d.meta).toContainEqual({ label: 'Method', value: 'bank transfer' });
  });

  it('bills a payment that has not landed', () => {
    const d = buildPaymentReceipt({ txn: { ...txn, status: 'pending' }, company });
    expect(d.title).toBe('INVOICE');
    expect(d.summary[0].label).toBe('TOTAL DUE');
  });

  it('leaves the account line out when there is no account number', () => {
    const d = buildPaymentReceipt({ txn: { ...txn, accountNumber: '-' }, company });
    expect(d.party.lines.join(' ')).not.toContain('Account:');
  });
});

describe('buildPayrollVoucher', () => {
  const data = resolvePayrollRecord({
    pay_month: '2026-08', basic_salary: 85000, housing_allowance: 15000, transport_allowance: 10000,
    rate_version: '2025-07',
  });
  const args = {
    record: { pay_month: '2026-08', status: 'approved' },
    employee: { full_name: 'Grace Wanjiru', department: 'Finance', email: 'g@ararat.co.ke' },
    month: '2026-08', data, company,
  };

  it('pays gross less the statutory deductions and lands on net', () => {
    const v = buildPayrollVoucher(args);
    expect(v.title).toBe('PAYROLL PAYMENT VOUCHER');
    expect(v.table.footer).toMatchObject({ description: 'NET PAY' });
    expect(v.table.footer.amount).toBe(`KES ${data.netPay.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  });

  it('lists every statutory deduction as a deduction', () => {
    const v = buildPayrollVoucher(args);
    const labels = v.table.rows.map((r) => r.description);
    expect(labels).toEqual(expect.arrayContaining(['PAYE (income tax)', 'NSSF (Tier I & II)', 'SHIF', 'Affordable Housing Levy']));
    expect(v.table.rows.find((r) => r.description === 'SHIF').amount).toMatch(/^\(KES/);
  });

  it('shows anything withheld beyond the statutory four, so gross less deductions equals net', () => {
    const withLoan = resolvePayrollRecord({
      pay_month: '2026-08', basic_salary: 85000, loan_deduction: 4000, rate_version: '2025-07',
    });
    const v = buildPayrollVoucher({ ...args, data: withLoan });
    expect(v.table.rows.find((r) => r.description === 'Other deductions').amount).toBe('(KES 4,000.00)');
  });

  it('leaves the other-deductions line out when there is nothing to explain', () => {
    expect(buildPayrollVoucher(args).table.rows.map((r) => r.description))
      .not.toContain('Other deductions');
  });

  it('says so when the row was priced on a basis nobody recorded', () => {
    const legacy = resolvePayrollRecord({ pay_month: '2026-08', gross_salary: 60000 });
    expect(buildPayrollVoucher({ ...args, data: legacy }).notes.join(' '))
      .toContain('never recorded');
  });
});

describe('buildContributionReceipt', () => {
  const contribution = {
    id: 'c1', txn_no: 'CTR-0042', amount: 5000, penalty_amount: 0,
    contribution_type: 'monthly', account: 'deposits', payment_method: 'mpesa',
    reference: 'QK12AB34CD', received_by_name: 'Jane Njeri',
    paid_at: '2026-09-01T09:30:00Z', status: 'completed',
    member: { full_name: 'Grace Wanjiru', member_no: 'M-014' },
  };
  const sacco = { name: 'Umoja Sacco', registration_no: 'CS/1234', location: 'Nakuru' };

  it('receipts a settled contribution', () => {
    const d = buildContributionReceipt({ contribution, sacco });
    expect(d.title).toBe('OFFICIAL RECEIPT');
    expect(d.issuer.name).toBe('Umoja Sacco');
    expect(d.issuer.lines).toContain('Reg No: CS/1234');
    expect(d.summary[0]).toMatchObject({ label: 'AMOUNT RECEIVED', value: 'KES 5,000.00' });
  });

  it('refuses to call an unsettled contribution a receipt', () => {
    // A pending slip must not be usable as proof of payment.
    const d = buildContributionReceipt({ contribution: { ...contribution, status: 'pending' }, sacco });
    expect(d.title).toBe('CONTRIBUTION ACKNOWLEDGEMENT');
    expect(d.subject).toContain('not proof of payment');
    expect(d.summary[0].label).toBe('AMOUNT DUE');
    expect(d.signatures).toEqual([]);
  });

  it('bills a late penalty as its own line and adds it to the total', () => {
    const d = buildContributionReceipt({ contribution: { ...contribution, penalty_amount: 250 }, sacco });
    expect(d.table.rows.map((r) => r.description)).toContain('Late-payment penalty');
    expect(d.summary[0].value).toBe('KES 5,250.00');
  });

  it('names the member account the money credits', () => {
    const d = buildContributionReceipt({ contribution: { ...contribution, account: 'share_capital' }, sacco });
    expect(d.table.rows[0].description).toContain('Share capital');
  });

  it('credits an automatic M-Pesa collection to M-Pesa rather than to nobody', () => {
    const d = buildContributionReceipt({
      contribution: { ...contribution, received_by_name: null, channel: 'mpesa_auto' }, sacco,
    });
    expect(d.meta).toContainEqual({ label: 'Received By', value: 'M-Pesa (automatic)' });
  });
});

describe('buildLoanRepaymentReceipt', () => {
  const loan = {
    id: 'l1', loan_no: 'LN-0009', principal: 200000,
    member: { full_name: 'Otieno Odhiambo', member_no: 'M-021' },
  };
  const installment = {
    id: 's4', period_no: 4, due_date: '2026-09-01', paid_date: '2026-08-31',
    opening_balance: 160000, interest: 1600, principal: 15000, payment: 16600,
    closing_balance: 145000, paid: true,
  };
  const sacco = { name: 'Umoja Sacco' };

  it('splits the payment into interest and principal', () => {
    // Without the split a borrower cannot see why a 16,600 payment moved the
    // balance by only 15,000.
    const d = buildLoanRepaymentReceipt({ installment, loan, sacco });
    expect(d.title).toBe('LOAN REPAYMENT RECEIPT');
    expect(d.table.rows).toEqual([
      { description: 'Interest', amount: 'KES 1,600.00' },
      { description: 'Principal reduction', amount: 'KES 15,000.00' },
    ]);
    expect(d.table.footer).toMatchObject({ description: 'AMOUNT RECEIVED', amount: 'KES 16,600.00' });
  });

  it('leads with the balance the borrower is left owing', () => {
    expect(buildLoanRepaymentReceipt({ installment, loan, sacco }).summary[0])
      .toMatchObject({ label: 'BALANCE AFTER THIS INSTALLMENT', value: 'KES 145,000.00' });
  });

  it('is a notice, not a receipt, while the installment is unpaid', () => {
    const d = buildLoanRepaymentReceipt({ installment: { ...installment, paid: false }, loan, sacco });
    expect(d.title).toBe('LOAN INSTALLMENT NOTICE');
    expect(d.table.footer.description).toBe('AMOUNT DUE');
    expect(d.footNote).toContain('Not a receipt');
  });

  it('names the borrower and numbers the installment', () => {
    const d = buildLoanRepaymentReceipt({ installment, loan, sacco });
    expect(d.party).toMatchObject({ heading: 'Borrower', name: 'Otieno Odhiambo' });
    expect(d.docNo).toBe('LR-LN-0009-4');
  });

  it('reads a preview schedule row, which is camelCase', () => {
    const d = buildLoanRepaymentReceipt({
      installment: { periodNo: 2, dueDate: '2026-07-01', interest: 900, principal: 4100, payment: 5000, closingBalance: 30000 },
      loan, sacco,
    });
    expect(d.summary[0].value).toBe('KES 30,000.00');
  });
});

describe('buildShareTransactionReceipt', () => {
  const sacco = { name: 'Umoja Sacco' };
  const member = { full_name: 'Otieno Odhiambo', member_no: 'M-0042' };
  // amount is the gross consideration; fee is that party's own trading fee.
  const purchase = {
    id: 'st1', txn_no: 'SHT-0000123', txn_type: 'purchase', created_at: '2026-09-02',
    shares: 100, price_per_share: 135, amount: 13500, fee: 135,
    balance_after: 600, realized_gain: 0,
  };

  it('adds the trading fee to what a buyer paid', () => {
    // amount alone (13,500) is not what left the buyer's pocket — the fee sits
    // on top of it, and the slip is kept for exactly that number.
    const d = buildShareTransactionReceipt({ txn: purchase, member, sacco });
    expect(d.title).toBe('SHARE PURCHASE RECEIPT');
    expect(d.table.footer).toMatchObject({ description: 'TOTAL PAID', amount: 'KES 13,635.00' });
  });

  it('deducts the trading fee from what a seller received', () => {
    const d = buildShareTransactionReceipt({
      txn: { ...purchase, txn_type: 'sale', shares: -100, fee: 200, realized_gain: 1300, balance_after: 400 },
      member, sacco,
    });
    expect(d.title).toBe('SHARE DISPOSAL ADVICE');
    expect(d.table.footer).toMatchObject({ description: 'NET PROCEEDS', amount: 'KES 13,300.00' });
  });

  it('leads a disposal with the gain the member realised', () => {
    const d = buildShareTransactionReceipt({
      txn: { ...purchase, txn_type: 'sale', shares: -100, realized_gain: 1300 }, member, sacco,
    });
    expect(d.summary[0]).toMatchObject({ label: 'REALISED GAIN', value: 'KES 1,300.00' });
  });

  it('calls a loss a loss', () => {
    const d = buildShareTransactionReceipt({
      txn: { ...purchase, txn_type: 'sale', shares: -100, realized_gain: -450 }, member, sacco,
    });
    expect(d.summary[0]).toMatchObject({ label: 'REALISED LOSS', value: 'KES 450.00' });
  });

  it('is an advice, not a receipt, when no money moved', () => {
    // A transfer moves shares and nothing else. Titling it a receipt would let
    // it be waved about as evidence of a payment that never happened.
    const d = buildShareTransactionReceipt({
      txn: { ...purchase, txn_type: 'transfer_in', amount: 0, fee: 0, price_per_share: 0 },
      member, sacco,
    });
    expect(d.title).toBe('SHARE TRANSFER ADVICE');
    expect(d.kind).toBe('advice');
    expect(d.table.footer).toBeNull();
    expect(d.footNote).toContain('not a receipt');
    expect(d.signatures).toEqual([]);
  });

  it('reports the holding the member is left with', () => {
    const d = buildShareTransactionReceipt({ txn: purchase, member, sacco });
    expect(d.summary.at(-1)).toMatchObject({
      label: 'SHAREHOLDING AFTER THIS MOVEMENT', value: '600 shares',
    });
  });

  it('names the member and numbers the transaction', () => {
    const d = buildShareTransactionReceipt({ txn: purchase, member, sacco });
    expect(d.party).toMatchObject({ heading: 'Received From', name: 'Otieno Odhiambo' });
    expect(d.docNo).toBe('SHT-0000123');
  });

  it('omits the fee line entirely when no fee was charged', () => {
    const d = buildShareTransactionReceipt({ txn: { ...purchase, fee: 0 }, member, sacco });
    expect(d.table.rows).toHaveLength(1);
    expect(d.table.footer.amount).toBe('KES 13,500.00');
  });
});

describe('buildDividendStatement', () => {
  const sacco = { name: 'Umoja Sacco' };
  const member = { full_name: 'Otieno Odhiambo', member_no: 'M-0042' };
  const declaration = {
    period_label: 'FY2025', basis: 'per_share', dividend_per_share: 2.5,
    record_date: '2026-01-31', payment_date: '2026-03-15',
  };
  const allocation = {
    id: 'da1', shares_at_record: 600, gross_amount: 1500, tax_amount: 75,
    net_amount: 1425, status: 'paid', paid_at: '2026-03-15', payment_ref: 'MPX-77',
  };

  it('shows gross, the tax withheld and the net actually paid', () => {
    // The member is taxed on the gross but paid the net. A slip showing only
    // the net leaves them unable to account for the tax at all.
    const d = buildDividendStatement({ allocation, declaration, member, sacco });
    expect(d.title).toBe('DIVIDEND PAYMENT ADVICE');
    expect(d.table.rows[1]).toMatchObject({ description: 'Less: withholding tax', amount: 'KES 75.00' });
    expect(d.table.footer).toMatchObject({ description: 'NET DIVIDEND PAID', amount: 'KES 1,425.00' });
    expect(d.summary).toEqual([
      { label: 'GROSS DIVIDEND', value: 'KES 1,500.00' },
      { label: 'WITHHOLDING TAX', value: 'KES 75.00' },
      { label: 'NET PAID', value: 'KES 1,425.00', emphasis: true },
    ]);
  });

  it('states the basis the dividend was declared on', () => {
    expect(buildDividendStatement({ allocation, declaration, member, sacco })
      .meta.find((m) => m.label === 'Basis').value).toBe('KES 2.50 per share');
    expect(buildDividendStatement({
      allocation, declaration: { ...declaration, basis: 'profit_percent', dividend_percent: 8 }, member, sacco,
    }).meta.find((m) => m.label === 'Basis').value).toBe('8% of profit');
  });

  it('is an entitlement advice, not a payment advice, until it is paid', () => {
    const d = buildDividendStatement({
      allocation: { ...allocation, status: 'pending', paid_at: null }, declaration, member, sacco,
    });
    expect(d.title).toBe('DIVIDEND ENTITLEMENT ADVICE');
    expect(d.table.footer.description).toBe('NET DIVIDEND DUE');
    expect(d.footNote).toContain('Not a payment advice');
    expect(d.signatures).toEqual([]);
  });

  it('says so when an allocation was cancelled', () => {
    const d = buildDividendStatement({
      allocation: { ...allocation, status: 'cancelled' }, declaration, member, sacco,
    });
    expect(d.title).toBe('DIVIDEND CANCELLATION NOTICE');
    expect(d.footNote).toContain('no payment is due');
  });

  it('leaves the tax line out when nothing was withheld', () => {
    const d = buildDividendStatement({
      allocation: { ...allocation, tax_amount: 0, net_amount: 1500 }, declaration, member, sacco,
    });
    expect(d.table.rows).toHaveLength(1);
    expect(d.summary.map((s) => s.label)).toEqual(['GROSS DIVIDEND', 'NET PAID']);
  });

  it('reads the declaration nested on the allocation, as the portal loads it', () => {
    const d = buildDividendStatement({ allocation: { ...allocation, declaration }, member, sacco });
    expect(d.meta.find((m) => m.label === 'Period').value).toBe('FY2025');
  });
});

describe('normaliseIssuer', () => {
  it('reads a company profile row', () => {
    const issuer = normaliseIssuer(company);
    expect(issuer.name).toBe('Ararat Ltd');
    expect(issuer.lines).toContain('KRA PIN: P051234567X');
    expect(issuer.lines).toContain('Westlands, Nairobi');
  });

  it('reads an already-resolved seller', () => {
    const issuer = normaliseIssuer({ name: 'Mwangi Motors', reg_no: 'BN-77', address: 'Thika Road' });
    expect(issuer.name).toBe('Mwangi Motors');
    expect(issuer.lines).toContain('Reg No: BN-77');
  });

  it('falls back to the app name rather than printing a blank letterhead', () => {
    expect(normaliseIssuer(null).name).toBe('Ararat');
    expect(normaliseIssuer(null).lines).toEqual([]);
  });
});

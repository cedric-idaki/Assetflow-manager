import { describe, it, expect } from 'vitest';
import { amountInWords, buildSaccoPaymentReceipt, fmtDate } from './accountingDocument';
import { archiveMetaFor } from './documentArchive';

// Rows exactly as sacco_receipt_loan_repayment / sacco_receipt_share_purchase
// return them (the scenario run against the migration produced these).
const loanReceipt = {
  id: 'rc1', receipt_no: 'RCT-2026-000001', receipt_type: 'loan_repayment',
  member_id: 'm1', member_name: 'Mary Member', member_no: 'MEM-001',
  amount: 20400.54, payment_method: 'mpesa', payment_reference: 'QHX7Y8Z9AB',
  paid_on: '2026-09-24', loan_id: '1a000000-0000-0000-0000-000000000001',
  balance_after: 10100.45, instalments_left: 1, shares_after: null,
  description: 'Repayment of Development Loan LN-1A000000, instalments 1, 2 of 3',
  notes: 'Paid at the counter', received_by_name: 'Tom Treasurer',
  created_at: '2026-09-25T08:15:00Z',
};
const loanLines = [
  { id: 'l2', line_no: 2, period_no: 2, due_date: '2026-08-26', description: 'Instalment 2 of 3', principal: 9999.45, interest: 200.99, amount: 10200.44 },
  { id: 'l1', line_no: 1, period_no: 1, due_date: '2026-07-27', description: 'Instalment 1 of 3', principal: 9900.10, interest: 300.00, amount: 10200.10 },
];

const shareReceipt = {
  id: 'rc3', receipt_no: 'RCT-2026-000003', receipt_type: 'share_purchase',
  member_id: 'm1', member_name: 'Mary Member', member_no: 'MEM-001',
  amount: 6060, payment_method: 'cash', payment_reference: null, paid_on: '2026-09-25',
  loan_id: null, balance_after: null, instalments_left: null, shares_after: 120,
  description: 'Purchase of 120 shares at KES 50.00 each from the SACCO treasury',
  notes: null, received_by_name: 'Tom Treasurer', created_at: '2026-09-25T09:00:00Z',
};
const shareLines = [{
  id: 's1', line_no: 1, share_txn_id: 't1', shares: 120, price_per_share: 50,
  consideration: 6000, fee: 60, amount: 6060,
  description: 'Purchase of 120 shares at KES 50.00 each from the SACCO treasury (SHT-0000001)',
}];

const sacco = { name: 'Umoja Sacco', registration_no: 'CS/1234', phone: '+254700000001' };

describe('amountInWords', () => {
  it('writes shillings and cents the way a receipt book does', () => {
    expect(amountInWords(8700.5)).toBe('Kenya Shillings Eight Thousand Seven Hundred and Fifty Cents Only');
    expect(amountInWords(20400.54)).toBe('Kenya Shillings Twenty Thousand Four Hundred and Fifty-Four Cents Only');
  });

  it('puts "and" where British usage does', () => {
    expect(amountInWords(1005)).toBe('Kenya Shillings One Thousand and Five Only');
    expect(amountInWords(115)).toBe('Kenya Shillings One Hundred and Fifteen Only');
    expect(amountInWords(2500000)).toBe('Kenya Shillings Two Million Five Hundred Thousand Only');
    expect(amountInWords(1000001)).toBe('Kenya Shillings One Million and One Only');
  });

  it('survives zero and junk', () => {
    expect(amountInWords(0)).toBe('Kenya Shillings Zero Only');
    expect(amountInWords('abc')).toBe('Kenya Shillings Zero Only');
    expect(amountInWords(0.07)).toBe('Kenya Shillings Zero and Seven Cents Only');
  });
});

describe('buildSaccoPaymentReceipt — loan repayment', () => {
  const doc = buildSaccoPaymentReceipt({ receipt: loanReceipt, lines: loanLines, sacco });

  it('is headed with the stored receipt number and the date the money was paid', () => {
    expect(doc.title).toBe('LOAN REPAYMENT RECEIPT');
    expect(doc.docNo).toBe('RCT-2026-000001');
    expect(doc.dateLabel).toBe(fmtDate('2026-09-24'));
    expect(doc.status).toBe('paid');
    expect(doc.issuer.name).toBe('Umoja Sacco');
  });

  it('says who paid, how much in words and figures, and for what', () => {
    expect(doc.party).toEqual({ heading: 'Received From', name: 'Mary Member', lines: ['Member No: MEM-001'] });
    expect(doc.subject).toBe(
      'Received with thanks the sum of Kenya Shillings Twenty Thousand Four Hundred and Fifty-Four Cents Only '
      + '(KES 20,400.54), being repayment of Development Loan LN-1A000000, instalments 1, 2 of 3.',
    );
  });

  it('lists the instalments in order with the interest / principal split and totals', () => {
    expect(doc.table.rows.map((r) => r.description)).toEqual(['Instalment 1 of 3', 'Instalment 2 of 3']);
    expect(doc.table.rows[0]).toMatchObject({ interest: '300.00', principal: '9,900.10', amount: '10,200.10' });
    expect(doc.table.footer).toMatchObject({ interest: '500.99', principal: '19,899.55', amount: '20,400.54' });
  });

  it('carries the payment trail and what is left to pay', () => {
    const meta = Object.fromEntries(doc.meta.map((m) => [m.label, m.value]));
    expect(meta).toMatchObject({
      'Receipt No': 'RCT-2026-000001', Method: 'M-Pesa', Reference: 'QHX7Y8Z9AB',
      'Received By': 'Tom Treasurer', Loan: 'LN-1A000000', 'Payment For': 'Loan repayment',
    });
    expect(doc.summary[0]).toEqual({ label: 'AMOUNT RECEIVED', value: 'KES 20,400.54', emphasis: true });
    expect(doc.summary.map((s) => s.value)).toContain('KES 10,100.45');
    expect(doc.notes).toEqual(['Paid at the counter']);
  });

  it('says so when the payment clears the loan', () => {
    const last = buildSaccoPaymentReceipt({
      receipt: { ...loanReceipt, balance_after: 0, instalments_left: 0, notes: null }, lines: loanLines, sacco,
    });
    expect(last.notes).toEqual(['This payment clears the loan in full.']);
  });

  it('files itself as a sacco receipt against the member, with its real timestamp', () => {
    expect(archiveMetaFor(doc)).toMatchObject({
      docType: 'receipt', module: 'sacco', reference: 'RCT-2026-000001',
      memberId: 'm1', amount: 20400.54, issuedAt: '2026-09-25T08:15:00Z',
    });
    expect(doc.filename).toBe('Receipt_RCT-2026-000001_Mary_Member.pdf');
  });
});

describe('buildSaccoPaymentReceipt — share purchase', () => {
  const doc = buildSaccoPaymentReceipt({ receipt: shareReceipt, lines: shareLines, sacco });

  it('shows the price of the shares and the fee separately, totalling what was received', () => {
    expect(doc.title).toBe('SHARE PURCHASE RECEIPT');
    expect(doc.table.rows).toEqual([
      { description: 'Purchase of 120 shares at KES 50.00 each from the SACCO treasury (SHT-0000001)', amount: 'KES 6,000.00' },
      { description: 'Trading fee', amount: 'KES 60.00' },
    ]);
    expect(doc.table.footer).toEqual({ description: 'TOTAL RECEIVED', amount: 'KES 6,060.00' });
  });

  it('reads as payment for the purchase, and gives the holding after it', () => {
    expect(doc.subject).toMatch(/being payment for the purchase of 120 shares at KES 50.00 each from the SACCO treasury\.$/);
    expect(doc.summary.map((s) => s.value)).toContain('120 shares');
    const meta = Object.fromEntries(doc.meta.map((m) => [m.label, m.value]));
    expect(meta.Reference).toBe('—');
    expect(meta.Loan).toBeUndefined();
    expect(archiveMetaFor(doc).module).toBe('sacco');
  });

  it('prints no fee line when there was no fee', () => {
    const noFee = buildSaccoPaymentReceipt({
      receipt: { ...shareReceipt, amount: 6000 }, lines: [{ ...shareLines[0], fee: 0, amount: 6000 }], sacco,
    });
    expect(noFee.table.rows).toHaveLength(1);
  });
});

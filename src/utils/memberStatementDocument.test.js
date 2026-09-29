import { describe, it, expect } from 'vitest';
import { memberStatementDocument } from './memberStatementDocument';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const letterhead = {
  tenantId: 's1', kind: 'sacco', name: 'Umoja Sacco', motto: 'Together we grow',
  phone: '0711 000 000', email: 'info@umoja.co.ke', website: '', physicalAddress: 'Nyeri',
  postalAddress: '', registrationNo: 'CS/1234', kraPin: '',
  logo: { src: PNG, width: 100, height: 100 },
};

const rows = [
  { date: '2026-09-01', ref: 'CT-001', section: 'Contribution', detail: 'monthly contribution · MPESA', amount: 2000, status: 'completed' },
  { date: '2026-09-10', ref: '', section: 'Loan repayment', detail: 'Instalment 3', amount: 5400, status: 'paid' },
];

describe('memberStatementDocument', () => {
  it('is a real document: society letterhead, member, period and rows', () => {
    const out = memberStatementDocument({
      letterhead, member: { full_name: 'Jane Wanjiru', member_no: 'M-0042' },
      title: 'Combined statement', from: '2026-09-01', to: '2026-09-30', reference: 'ST-M0042-20260925', rows,
    });
    expect(out).toContain(`src="${PNG}"`);
    expect(out).toContain('Umoja Sacco');
    expect(out).toContain('Together we grow');
    expect(out).toContain('COMBINED STATEMENT');
    expect(out).toContain('Jane Wanjiru');
    expect(out).toContain('Member No: M-0042');
    expect(out).toMatch(/01 Sept? 2026 to 30 Sept? 2026/);
    expect(out).toContain('CT-001');
    expect(out).toContain('KES 5,400.00');
    expect(out).toContain('Tel: 0711 000 000');
  });

  it('says so when the period is empty rather than printing a bare table', () => {
    expect(memberStatementDocument({ rows: [] })).toContain('No transactions in this period.');
  });

  it('falls back to the sacco row when there is no letterhead', () => {
    const out = memberStatementDocument({ sacco: { name: 'Plain Sacco', registration_no: 'CS/9' }, rows });
    expect(out).toContain('Plain Sacco');
    expect(out).not.toContain('<img class="lh-logo"');
  });

  it('escapes narrations and names', () => {
    const out = memberStatementDocument({
      member: { full_name: '<script>x()</script>' },
      rows: [{ ...rows[0], detail: '"><img src=x onerror=alert(1)>' }],
    });
    expect(out).not.toContain('<script>x()');
    expect(out).not.toContain('<img src=x');
  });
});

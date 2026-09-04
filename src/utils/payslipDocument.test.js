import { describe, it, expect } from 'vitest';
import { payslipDocument, payslipBody } from './payslipDocument';
import { computePayroll } from './kenyaPayroll';

const data = computePayroll({
  payMonth: '2026-08', basic: 85000, housingAllowance: 15000, transportAllowance: 10000,
});

const slip = (name, id) => ({
  company: { company_name: 'Ararat Ltd', kra_pin: 'P051234567X' },
  employee: { id, full_name: name, department: 'Finance' },
  month: '2026-08',
  data,
});

describe('payslipDocument', () => {
  it('puts every employee in one document', () => {
    const doc = payslipDocument([slip('Grace Wanjiru', 'e1'), slip('Otieno Odhiambo', 'e2')]);
    expect(doc).toContain('Grace Wanjiru');
    expect(doc).toContain('Otieno Odhiambo');
    expect(doc.match(/class="payslip"/g)).toHaveLength(2);
  });

  it('breaks a page between slips so one can be handed to one employee', () => {
    const doc = payslipDocument([slip('A', 'e1'), slip('B', 'e2')]);
    expect(doc).toContain('page-break-after: always');
  });

  it('titles a batch by its size and a single slip by its employee', () => {
    expect(payslipDocument([slip('Grace Wanjiru', 'e1')]))
      .toContain('<title>Payslip — Grace Wanjiru — August 2026</title>');
    expect(payslipDocument([slip('A', 'e1'), slip('B', 'e2'), slip('C', 'e3')]))
      .toContain('<title>Payslips — August 2026 — 3 employees</title>');
  });

  it('accepts a bare object as well as an array', () => {
    expect(payslipDocument(slip('Grace Wanjiru', 'e1'))).toContain('Grace Wanjiru');
  });

  it('renders an empty batch as a valid page rather than throwing', () => {
    expect(() => payslipDocument([])).not.toThrow();
  });

  it('escapes an employee name instead of letting it become markup', () => {
    const doc = payslipDocument([slip('<img src=x onerror=alert(1)>', 'e1')]);
    expect(doc).not.toContain('<img src=x');
    expect(doc).toContain('&lt;img');
  });

  it('carries the KRA PIN when the employee has one on file', () => {
    const withPin = { ...slip('Grace', 'e1') };
    withPin.employee.kra_pin = 'A001234567X';
    expect(payslipBody(withPin)).toContain('A001234567X');
    // and omits the line entirely when they do not
    expect(payslipBody(slip('Grace', 'e1'))).not.toContain('KRA PIN: undefined');
  });
});

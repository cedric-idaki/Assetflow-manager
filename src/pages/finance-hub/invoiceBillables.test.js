import { describe, it, expect } from 'vitest';
import {
  emptyInvoiceLine, assetInvoiceLine, serviceInvoiceLine, catalogueServiceOptions,
  engagementServiceOption, serviceOptionText, clientLinkedLines, withClientLines, fillFirstEmptyLine,
} from './invoiceBillables';

const truck = { id: 'a1', description: 'Isuzu FRR', asset_code: 'AST-7', plate_number: 'KDA 123X', selling_price: 4500000 };

const retainer = {
  id: 'e1', pricing_model: 'retainer', amount: 50000, billing_period: 'monthly',
  service: { name: 'Tax Advisory' }, cost_structure: { label: 'Monthly retainer' },
};

describe('invoice lines from assets and services', () => {
  it('bills an asset at its selling price, named with its code and plate', () => {
    expect(assetInvoiceLine(truck)).toEqual({
      description: 'Isuzu FRR (AST-7 · KDA 123X)', quantity: 1, unit_price: 4500000,
    });
  });

  it('bills a service at the amount its terms name, and says what the terms are', () => {
    expect(serviceInvoiceLine(engagementServiceOption(retainer))).toEqual({
      description: 'Tax Advisory — Monthly retainer (KES 50,000 per month)', quantity: 1, unit_price: 50000,
    });
  });

  it('leaves the price blank when the terms carry no fixed amount', () => {
    const line = serviceInvoiceLine({
      name: 'Grant Writing', label: 'Success fee',
      terms: { pricing_model: 'success_fee', success_pct: 5, success_basis: 'funds raised' },
    });
    expect(line.unit_price).toBe('');
    expect(line.description).toBe('Grant Writing — Success fee (5% of funds raised)');
  });

  it('names an engagement by its model when it was not copied from a price option', () => {
    const o = engagementServiceOption({ id: 'e2', pricing_model: 'hourly', amount: 5000, service: { name: 'Audit' } });
    expect(o.label).toBe('Per-hour cost');
    expect(serviceOptionText(o)).toBe('Audit · Per-hour cost — KES 5,000 per hour');
  });

  it('offers every price option of an offered service, default first, and skips retired services', () => {
    const options = catalogueServiceOptions([
      { id: 's1', name: 'Payroll', is_active: true, consultancy_cost_structures: [
        { id: 'c1', pricing_model: 'unit', amount: 300, unit_label: 'payslip', sort_order: 0 },
        { id: 'c2', pricing_model: 'retainer', amount: 20000, billing_period: 'monthly', is_default: true, sort_order: 1 },
      ] },
      { id: 's2', name: 'Old service', is_active: false, consultancy_cost_structures: [] },
      { id: 's3', name: 'Ad hoc', is_active: true, consultancy_cost_structures: [] },
    ]);
    expect(options.map(o => o.key)).toEqual(['svc:s1:c2', 'svc:s1:c1', 'svc:s3']);
    expect(serviceOptionText(options[2])).toBe('Ad hoc — price set on the invoice');
  });
});

describe('filling the invoice from a client', () => {
  it('fills a line for each linked asset and each active engagement', () => {
    const lines = clientLinkedLines({ assets: [truck], engagements: [retainer] });
    expect(lines.map(l => [l.description, l.unit_price, l.origin])).toEqual([
      ['Isuzu FRR (AST-7 · KDA 123X)', 4500000, 'client'],
      ['Tax Advisory — Monthly retainer (KES 50,000 per month)', 50000, 'client'],
    ]);
  });

  it('swaps the previous client\'s lines for the new client\'s and keeps what the user added', () => {
    const typed = { description: 'Delivery', quantity: 1, unit_price: 2000 };
    const before = [...clientLinkedLines({ assets: [truck] }), typed, emptyInvoiceLine()];
    const after = withClientLines(before, clientLinkedLines({ engagements: [retainer] }));
    expect(after.map(l => l.description)).toEqual([
      'Delivery', 'Tax Advisory — Monthly retainer (KES 50,000 per month)',
    ]);
  });

  it('leaves one blank line when the new client has nothing linked and nothing was typed', () => {
    expect(withClientLines(clientLinkedLines({ assets: [truck] }), [])).toEqual([emptyInvoiceLine()]);
  });

  it('puts a picked item in the first blank line, or adds one', () => {
    const line = { description: 'X', quantity: 1, unit_price: 1 };
    expect(fillFirstEmptyLine([emptyInvoiceLine()], line)).toEqual([line]);
    const full = [{ description: 'Y', quantity: 1, unit_price: 2 }];
    expect(fillFirstEmptyLine(full, line)).toEqual([...full, line]);
  });
});

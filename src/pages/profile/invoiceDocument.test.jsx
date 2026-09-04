/**
 * The printed platform invoice — the document a tenant downloads.
 *
 * The engine's arithmetic is covered in src/config/systemBilling.test.js. What
 * is checked here is that the DOCUMENT says the same thing: that every
 * component reaches the page, that the totals block agrees with the item
 * table, and that a tenant-supplied name still cannot inject script into a
 * window that runs on this app's origin.
 */

import { describe, it, expect } from 'vitest';
import { buildInvoiceHtml as buildCompanyInvoice } from './index';
import { buildInvoiceHtml as buildSaccoInvoice } from '../sacco-dashboard/components/BillingTab';
import { INSTALLATION_FEE as COMPANY_FEE, planForUsers } from '../../config/companyPlans';
import { tierForMembers } from '../../config/saccoTiers';

const BILL_TO = { name: 'Kilimo Traders Ltd', email: 'ops@kilimo.co.ke', phone: '+254700000000' };

/** Every "KES 1,234.56" in the document, as numbers, in order. */
const amounts = (doc) =>
  [...doc.matchAll(/KES\s([\d,]+\.\d{2})/g)].map((m) => Number(m[1].replace(/,/g, '')));

const rowCount = (doc) => (doc.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1].match(/<tr>/g) || []).length;

// ─────────────────────────────────────────────────────────────────────────────
describe('company platform invoice', () => {
  const seats = 5;
  const paid = seats * planForUsers(seats).pricePerUser + COMPANY_FEE;
  const row = {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    plan_name: 'silver', max_users: seats, price_paid: paid,
    status: 'active', start_date: '2026-08-01', end_date: '2026-08-31',
  };

  const doc = buildCompanyInvoice(row, BILL_TO);

  it('is labelled a tax invoice', () => {
    expect(doc).toContain('Tax Invoice');
    expect(doc).toContain('INVOICE');
  });

  it('carries the Ararat wordmark, not the retired AssetFlow one', () => {
    // The letterhead is the PLATFORM billing the tenant, so the brand is ours
    // and hardcoded — unlike payslips or tenant invoices, which take the
    // tenant's own company_name. It had been left on the old name while the
    // footer of the same page already said Ararat.
    expect(doc).toContain('>Ararat<');
    expect(doc).not.toMatch(/AssetFlow|Asset<span>Flow/);
  });

  it('itemises the user charge and the one-time installation separately', () => {
    expect(doc).toContain('Licensed user charges');
    expect(doc).toContain('Installation &amp; onboarding (one-time)');
    // The old invoice was a single line for the whole amount — that is the bug.
    expect(rowCount(doc)).toBe(2);
  });

  it('discloses the taxable value, the rate and the tax', () => {
    expect(doc).toContain('Taxable value (excl. VAT)');
    expect(doc).toContain('VAT @ 16%');
    expect(doc).toContain('<strong>Total (incl. VAT)</strong>');
  });

  it('totals to exactly what the tenant paid', () => {
    const figures = amounts(doc);
    expect(figures[figures.length - 1]).toBe(paid);
  });

  it('has an item table that adds up to the total, and taxable value + VAT = total', () => {
    // [unit, amount] per row, then taxable value, VAT, total. The item column
    // is VAT-inclusive, so it sums to the TOTAL — which is the figure the page
    // states beside it.
    const figures = amounts(doc);
    const [taxable, vat, total] = figures.slice(-3);
    const lineAmounts = figures.slice(0, -3).filter((_, i) => i % 2 === 1);
    expect(Math.round(lineAmounts.reduce((a, b) => a + b, 0) * 100) / 100).toBe(total);
    expect(Math.round((taxable + vat) * 100) / 100).toBe(total);
  });

  it('states the seat count and plan in the footer', () => {
    expect(doc).toContain(`${seats} licensed user(s)`);
    expect(doc).toContain('Silver plan');
  });

  it('omits the installation line on a renewal', () => {
    const renewal = buildCompanyInvoice({ ...row, price_paid: seats * planForUsers(seats).pricePerUser }, BILL_TO);
    expect(renewal).not.toContain('Installation &amp; onboarding');
    expect(rowCount(renewal)).toBe(1);
  });

  it('prints a stored breakdown, including the additional-modules line', () => {
    const stored = {
      ...row,
      base_fee: 0, user_fee: 1525, module_fee: 250, installation_fee: 4000,
      subtotal: 5000, vat_rate: 16, vat_amount: 775, price_paid: 5775,
    };
    const withModules = buildCompanyInvoice(stored, BILL_TO);
    expect(withModules).toContain('Additional modules');
    expect(rowCount(withModules)).toBe(3);
    expect(amounts(withModules).slice(-3)).toEqual([5000, 775, 5775]);
    // The item column is inclusive, so it sums to the total, not the taxable value.
    const items = amounts(withModules).slice(0, -3).filter((_, i) => i % 2 === 1);
    expect(Math.round(items.reduce((a, b) => a + b, 0) * 100) / 100).toBe(5775);
  });

  it('escapes a tenant-supplied name rather than letting it run as script', () => {
    const hostile = buildCompanyInvoice(row, { ...BILL_TO, name: '<script>alert(1)</script>' });
    expect(hostile).not.toContain('<script>alert(1)</script>');
    expect(hostile).toContain('&lt;script&gt;');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('sacco platform invoice', () => {
  const members = 60;
  const tier = tierForMembers(members);
  const row = {
    id: 'ffffffff-1111-2222-3333-444444444444',
    tier: 'silver', active_members: members, period: '2026-08-01', status: 'paid',
    base_fee: tier.baseFee,
    per_member_fee_total: members * tier.perMemberFee,
    storage_fee: 40,
    total: tier.baseFee + members * tier.perMemberFee + 40,
  };
  const sacco = { name: 'Umoja Sacco', registration_no: 'CS/1234', email: 'sacco@umoja.co.ke', phone: '+254711111111' };

  const doc = buildSaccoInvoice(row, sacco);

  it('carries the Ararat wordmark, not the retired AssetFlow one', () => {
    expect(doc).toContain('>Ararat<');
    expect(doc).not.toMatch(/AssetFlow|Asset<span>Flow/);
  });

  it('itemises base, members and storage as separate lines', () => {
    expect(doc).toContain('Base system price');
    expect(doc).toContain('Active member charges');
    expect(doc).toContain('Storage excess');
    expect(rowCount(doc)).toBe(3);
  });

  it('shows the VAT block and totals to the amount billed', () => {
    expect(doc).toContain('Taxable value (excl. VAT)');
    expect(doc).toContain('VAT @ 16%');
    const figures = amounts(doc);
    expect(figures[figures.length - 1]).toBe(row.total);
  });

  it('has an item table that adds up to the total, and taxable value + VAT = total', () => {
    const figures = amounts(doc);
    const [taxable, vat, total] = figures.slice(-3);
    const lineAmounts = figures.slice(0, -3).filter((_, i) => i % 2 === 1);
    expect(Math.round(lineAmounts.reduce((a, b) => a + b, 0) * 100) / 100).toBe(total);
    expect(Math.round((taxable + vat) * 100) / 100).toBe(total);
  });

  it('shows the per-member unit rate so the charge can be checked by hand', () => {
    expect(doc).toContain(`KES ${tier.perMemberFee.toFixed(2)}`);
  });

  it('escapes a tenant-supplied sacco name', () => {
    const hostile = buildSaccoInvoice(row, { ...sacco, name: '<img src=x onerror=alert(1)>' });
    expect(hostile).not.toContain('<img src=x');
    expect(hostile).toContain('&lt;img');
  });
});

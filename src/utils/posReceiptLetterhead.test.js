/**
 * The tenant letterhead on the POS till receipt (80mm roll and A4).
 *
 * The POS's own company row is usually empty at a cashier's till —
 * company_profiles is readable only by the tenant owner — so the letterhead is
 * what names the seller on the paper the customer walks away with.
 */
import { describe, it, expect } from 'vitest';
import { posReceiptDocument, buildPosReceipt, THERMAL, A4 } from './posReceiptDocument';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const letterhead = {
  tenantId: 'tenant-a',
  name: 'Rift Valley Motors Ltd',
  motto: 'Driven by trust',
  phone: '0720 000 111',
  email: 'sales@rvm.co.ke',
  website: 'www.rvm.co.ke',
  physicalAddress: 'Enterprise Road, Nairobi',
  postalAddress: '',
  registrationNo: '',
  kraPin: 'P051234567X',
  logo: { src: PNG, width: 400, height: 200 },
};

const sale = {
  saleData: { pricingModel: 'cash', sellingPrice: 1000, vatAmount: 160, vatPercent: 16, totalAmount: 1160, paymentMethod: 'cash' },
  client: null,
  asset: { description: 'Service call' },
  receiptNo: 'RCP-1',
  invoiceNo: 'INV-1',
};

describe('POS receipt letterhead', () => {
  it.each([THERMAL, A4])('prints the logo, name, motto and contacts on %s', (format) => {
    const out = posReceiptDocument({ ...sale, format, letterhead, companyProfile: null });
    expect(out).toContain(`src="${PNG}"`);
    expect(out).toContain('Rift Valley Motors Ltd');
    expect(out).toContain('Driven by trust');
    expect(out).toContain('Tel: 0720 000 111');
    expect(out).toContain('KRA PIN: P051234567X');
    expect(out).toContain('.lh-logo');   // the letterhead styles came along
  });

  it('uses the seller PIN from the letterhead for the tax line', () => {
    const r = buildPosReceipt({ ...sale, letterhead, companyProfile: null });
    expect(r.issuer.kraPin).toBe('P051234567X');
    expect(r.isTaxReceipt).toBe(true);
    expect(posReceiptDocument({ ...sale, letterhead, format: THERMAL })).toContain('PIN P051234567X');
  });

  it('lets the record fill what the letterhead leaves blank', () => {
    const r = buildPosReceipt({
      ...sale,
      letterhead: { ...letterhead, kraPin: '' },
      companyProfile: { admin_id: 'tenant-a', company_name: 'Rift Valley Motors Ltd', kra_pin: 'P099999999Z' },
    });
    expect(r.issuer.kraPin).toBe('P099999999Z');
  });

  it('never prints another tenant\'s branding over the seller', () => {
    const r = buildPosReceipt({
      ...sale,
      letterhead,
      companyProfile: { admin_id: 'tenant-b', company_name: 'Other Seller Ltd' },
    });
    expect(r.issuer.name).toBe('Other Seller Ltd');
    expect(r.issuer.letterhead.logo).toBeNull();
  });

  it('prints as it always did with no letterhead', () => {
    const out = posReceiptDocument({ ...sale, format: A4, companyProfile: { company_name: 'Plain Co' } });
    expect(out).toContain('Plain Co');
    expect(out).not.toContain('<img class="lh-logo"');
  });

  it('escapes a motto — the print frame shares the app origin', () => {
    const out = posReceiptDocument({
      ...sale, format: THERMAL, letterhead: { ...letterhead, motto: '<img src=x onerror=alert(1)>' },
    });
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;img src=x');
  });
});

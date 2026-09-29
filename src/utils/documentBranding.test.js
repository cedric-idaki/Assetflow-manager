/**
 * The tenant letterhead on every jsPDF document.
 *
 * jsPDF is swapped for a recorder (test-utils/fakeJsPdf.js) and the letterhead
 * lookup for a stub, so each generator runs end to end and what it drew — the
 * logo, the business name, the motto — can be asserted on. Two properties
 * matter beyond "the logo is there":
 *
 *   • the lookup is scoped to the document's OWN tenant, and a letterhead from
 *     a different tenant is never drawn over it;
 *   • a certificate's signature fields do not move when a letterhead is added —
 *     SignNow places its boxes at those coordinates.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FakeJsPDF } from '../test-utils/fakeJsPdf';

vi.mock('./jsPdfLoader', async (importOriginal) => ({
  ...(await importOriginal()),
  loadJsPDF: vi.fn(async () => FakeJsPDF),
}));

vi.mock('../lib/letterhead', () => ({
  fetchLetterhead: vi.fn(async () => null),
  currentLetterhead: vi.fn(() => null),
}));

const { fetchLetterhead } = await import('../lib/letterhead');
const {
  buildPaymentReceipt, buildContributionReceipt, renderAccountingDocument, brandIssuer, normaliseIssuer,
} = await import('./accountingDocument');
const { generateReceiptPDF } = await import('./generateReceiptPDF');
const {
  buildShareCertificatePdf, buildSettlementCertificatePdf, buildAssetValuationPdf, buildGuaranteeAgreementPdf,
} = await import('./certificatePdf');
const { generateContractPDF } = await import('./generateContractPDF');
const { generateSaccoLoanContractPDF } = await import('./generateSaccoLoanContractPDF');
const { buildDocumentModel, renderReportPDF } = await import('./reportExport');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const tenantA = {
  tenantId: 'tenant-a',
  kind: 'company',
  name: 'Rift Valley Motors Ltd',
  motto: 'Driven by trust',
  registrationNo: 'PVT-9XABC12',
  kraPin: 'P051234567X',
  phone: '0720 000 111',
  email: 'sales@rvm.co.ke',
  website: 'www.rvm.co.ke',
  physicalAddress: 'Enterprise Road, Nairobi',
  postalAddress: 'P.O. Box 123-00100',
  logo: { src: PNG, width: 400, height: 200, format: 'PNG' },
};

const txn = {
  transactionId: 'TXN-1', status: 'completed', amount: 5000, date: '2026-09-25',
  clientName: 'Grace Wanjiru', paymentMethod: 'mpesa',
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchLetterhead.mockResolvedValue(null);
  FakeJsPDF.reset();
});

describe('accounting documents', () => {
  it('draws the tenant logo, name and motto, fetched for the signed-in tenant', async () => {
    fetchLetterhead.mockResolvedValue(tenantA);
    // A cashier: company_profiles came back empty, so the builder had nothing.
    const doc = await renderAccountingDocument(buildPaymentReceipt({ txn, company: null }));

    expect(fetchLetterhead).toHaveBeenCalledWith({ tenantId: null });
    expect(doc.images).toHaveLength(1);
    expect(doc.images[0].src).toBe(PNG);
    const text = doc.allText();
    expect(text).toContain('Rift Valley Motors Ltd');
    expect(text).toContain('Driven by trust');
    expect(text).toContain('KRA PIN: P051234567X');
    // The placeholder never reaches the page once the tenant is known.
    expect(text).not.toMatch(/^Ararat$/m);
  });

  it('looks the letterhead up for the tenant the document belongs to', async () => {
    fetchLetterhead.mockResolvedValue(tenantA);
    await renderAccountingDocument(buildContributionReceipt({
      contribution: { amount: 100, status: 'completed', member: { full_name: 'M' } },
      sacco: { admin_id: 'tenant-a', name: 'Rift Valley Motors Ltd' },
    }));
    expect(fetchLetterhead).toHaveBeenCalledWith({ tenantId: 'tenant-a' });
  });

  it('keeps the document\'s own issuer when the letterhead is another tenant\'s', async () => {
    fetchLetterhead.mockResolvedValue({ ...tenantA, tenantId: 'tenant-b', name: 'Somebody Else Ltd' });
    const doc = await renderAccountingDocument(buildPaymentReceipt({
      txn, company: { admin_id: 'tenant-a', company_name: 'The Real Seller Ltd' },
    }));
    expect(doc.allText()).toContain('The Real Seller Ltd');
    expect(doc.allText()).not.toContain('Somebody Else Ltd');
    expect(doc.images).toHaveLength(0);
  });

  it('prints exactly as built when there is no letterhead, and never fails for want of one', async () => {
    fetchLetterhead.mockRejectedValue(new Error('offline'));
    const doc = await renderAccountingDocument(buildPaymentReceipt({ txn, company: { company_name: 'Plain Co' } }));
    expect(doc.allText()).toContain('Plain Co');
    expect(doc.images).toHaveLength(0);
  });

  it('takes an explicit letterhead without looking one up', async () => {
    const doc = await renderAccountingDocument(buildPaymentReceipt({ txn, company: null }), { letterhead: tenantA });
    expect(fetchLetterhead).not.toHaveBeenCalled();
    expect(doc.images).toHaveLength(1);
  });

  it('shrinks and clips a very long business name instead of running it under the title', async () => {
    const long = { ...tenantA, name: 'The Extraordinarily Long Name Of A Business That Nobody Can Fit On One Line Limited' };
    const doc = await renderAccountingDocument(buildPaymentReceipt({ txn, company: null }), { letterhead: long });
    const drawn = doc.texts.find((t) => t.text.startsWith('The Extraordinarily'));
    expect(drawn.text.endsWith('…')).toBe(true);
    expect(drawn.size).toBeLessThan(16);
  });

  it('brandIssuer does not let the builder\'s placeholder outrank the tenant name', async () => {
    const issuer = await brandIssuer(normaliseIssuer(null), { letterhead: tenantA });
    expect(issuer.name).toBe('Rift Valley Motors Ltd');
    expect(issuer.logo.src).toBe(PNG);
  });
});

describe('POS receipt PDF', () => {
  it('heads the receipt with the letterhead', async () => {
    fetchLetterhead.mockResolvedValue(tenantA);
    const filename = await generateReceiptPDF({
      saleData: { pricingModel: 'cash', sellingPrice: 100, totalAmount: 100, paymentMethod: 'cash' },
      client: null, asset: { description: 'Service' }, companyProfile: null,
      schedule: [], invoiceNo: 'INV-1', receiptNo: 'RCP-1',
    });
    expect(filename).toBe('Receipt_INV-1_WalkIn.pdf');
    expect(fetchLetterhead).toHaveBeenCalledWith({ tenantId: null });
    const doc = FakeJsPDF.last();
    expect(doc.images).toHaveLength(1);
    expect(doc.allText()).toContain('Rift Valley Motors Ltd');
    expect(doc.allText()).toContain('Driven by trust');
    // Empty fields are left out, not printed as a dash under the name.
    expect(doc.texts.filter((t) => t.text === '—' && t.y < 42)).toHaveLength(0);
  });
});

describe('certificates', () => {
  const signers = [{ role: 'Chairperson', name: 'A' }, { role: 'Treasurer', name: 'B' }];

  it.each([
    ['share certificate', () => buildShareCertificatePdf({ cert: { shares: 10, par_value: 100, certificate_no: 'C-1' }, saccoName: 'Umoja', memberName: 'M', signers })],
    ['settlement certificate', () => buildSettlementCertificatePdf({ plan: { plan_name: 'P' }, client: { full_name: 'C' }, asset: {}, company: { admin_id: 'tenant-a', company_name: 'Co' }, signers })],
    ['asset valuation', () => buildAssetValuationPdf({ asset: { asset_name: 'Land' }, saccoName: 'Umoja', signers })],
    ['guarantee agreement', () => buildGuaranteeAgreementPdf({ terms: { clauses: [] }, saccoName: 'Umoja', signers })],
  ])('the %s carries the logo and keeps its signature fields where they were', async (_name, build) => {
    fetchLetterhead.mockResolvedValue(null);
    const plain = await build();
    const plainDoc = FakeJsPDF.last();
    fetchLetterhead.mockResolvedValue(tenantA);
    const branded = await build();
    const brandedDoc = FakeJsPDF.last();

    expect(plainDoc.images).toHaveLength(0);
    expect(brandedDoc.images).toHaveLength(1);
    expect(brandedDoc.allText()).toContain('Rift Valley Motors Ltd');
    expect(brandedDoc.allText()).toContain('Driven by trust');
    expect(branded.fields).toEqual(plain.fields);
    expect(branded.blob).toBeInstanceOf(Blob);
  });
});

describe('contracts', () => {
  it('fills the vendor from the letterhead when the company record is empty', async () => {
    fetchLetterhead.mockResolvedValue(tenantA);
    const out = await generateContractPDF({
      sale: { pricing_model: 'cash', invoice_number: 'INV-9' },
      client: { full_name: 'Buyer' }, asset: {}, company: null, schedule: [],
    });
    expect(out.filename).toBeTruthy();
    expect(fetchLetterhead).toHaveBeenCalledWith({ tenantId: null });
    const doc = FakeJsPDF.last();
    expect(doc.images).toHaveLength(1);
    // The agreement's own vendor particulars, not just the banner.
    expect(doc.allText()).toContain('P051234567X');
    expect(doc.allText()).toContain('RIFT VALLEY MOTORS LTD');
  });

  it('brands the sacco loan agreement with the society letterhead', async () => {
    fetchLetterhead.mockResolvedValue({ ...tenantA, tenantId: 's1', kind: 'sacco', name: 'Umoja Sacco' });
    const out = await generateSaccoLoanContractPDF({
      loan: { id: 'l1', principal: 1000 }, member: { full_name: 'M' },
      sacco: { admin_id: 's1', name: 'Umoja Sacco' }, schedule: [], download: false,
    });
    expect(out.blob).toBeInstanceOf(Blob);
    expect(fetchLetterhead).toHaveBeenCalledWith({ tenantId: 's1' });
  });
});

describe('report builder PDF', () => {
  it('puts the logo and name in the band on every page', async () => {
    fetchLetterhead.mockResolvedValue(tenantA);
    const model = buildDocumentModel({
      title: 'Collections',
      sections: [{ columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }] }],
      company: null,
    });
    const doc = await renderReportPDF(model);
    expect(doc.images.length).toBeGreaterThanOrEqual(1);
    expect(doc.allText()).toContain('Rift Valley Motors Ltd');
  });
});

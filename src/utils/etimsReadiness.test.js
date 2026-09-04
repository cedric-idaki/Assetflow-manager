/**
 * Tests for the browser-side readiness check and for the eTIMS block on the
 * printed receipt.
 *
 * The two are tested together because they answer the same question at two
 * moments: "is this business actually filing?" — once on the compliance screen
 * before anything is sold, and once on the paper a customer is handed.
 *
 * The cases that matter most here are the ones where something looks fine and
 * is not: a sandbox device (files nothing, shows green), and a receipt printed
 * before its document reached KRA (looks like a compliant receipt, is not one).
 */

import { describe, it, expect } from 'vitest';
import {
  etimsReadiness,
  classificationStatus,
  suggestTaxCode,
  taxCodeOptions,
  BLOCKER,
  WARNING,
} from './etimsReadiness';
import { buildPosReceipt, thermalBody, a4Body } from './posReceiptDocument';

const liveConfig = (over = {}) => ({
  configured: true,
  kraPin: 'P051234567X',
  branchId: '00',
  isActive: true,
  isSandbox: false,
  encryptionReady: true,
  lastError: null,
  ...over,
});

const codesOf = (r) => r.issues.map((i) => i.code);

describe('readiness', () => {
  it('is ready when a live device is registered and nothing is outstanding', () => {
    const r = etimsReadiness({ config: liveConfig() });
    expect(r.ready).toBe(true);
    expect(r.filing).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('reports an unconfigured account as a blocker and stops there', () => {
    const r = etimsReadiness({ config: null });
    expect(r.ready).toBe(false);
    expect(r.filing).toBe(false);
    // Every other check is downstream of having a device at all — one clear
    // instruction beats five.
    expect(codesOf(r)).toEqual(['not_configured']);
  });

  it('treats the sandbox as a WARNING, not a blocker — it works, it just files nothing', () => {
    const r = etimsReadiness({ config: liveConfig({ isSandbox: true }) });
    expect(r.ready).toBe(true);
    expect(r.filing).toBe(true);
    const sandbox = r.issues.find((i) => i.code === 'sandbox');
    expect(sandbox.severity).toBe(WARNING);
    expect(sandbox.message).toMatch(/do not reach the live system/i);
  });

  it('blocks when KRA has not accepted the device, and quotes what KRA said', () => {
    const r = etimsReadiness({
      config: liveConfig({ isActive: false, lastError: 'Invalid device serial number.' }),
    });
    expect(r.ready).toBe(false);
    expect(r.filing).toBe(false);
    expect(r.issues.find((i) => i.code === 'not_active').message)
      .toMatch(/Invalid device serial number/);
  });

  it('blocks on an invalid PIN', () => {
    const r = etimsReadiness({ config: liveConfig({ kraPin: 'NOPE' }) });
    expect(codesOf(r)).toContain('bad_pin');
  });

  it('blocks when the platform has no encryption key for device keys', () => {
    const r = etimsReadiness({ config: liveConfig({ encryptionReady: false }) });
    expect(r.issues.find((i) => i.code === 'no_encryption_key').severity).toBe(BLOCKER);
  });

  it('blocks on unclassified items and counts them', () => {
    const r = etimsReadiness({ config: liveConfig(), unclassifiedCount: 3 });
    const issue = r.issues.find((i) => i.code === 'unclassified_items');
    expect(issue.severity).toBe(BLOCKER);
    expect(issue.message).toMatch(/3 items/);
  });

  it('gets the singular right, because "1 items" reads as a bug', () => {
    const r = etimsReadiness({ config: liveConfig(), unclassifiedCount: 1 });
    const message = r.issues.find((i) => i.code === 'unclassified_items').message;
    expect(message).toMatch(/1 item sold has no KRA classification/);
    expect(message).toMatch(/its invoice cannot be filed/);
    expect(message).not.toMatch(/items|their|have/);
  });

  it('blocks on documents whose fate is unknown, and says to check the KRA portal', () => {
    const r = etimsReadiness({ config: liveConfig(), queue: { uncertain: 2 } });
    const issue = r.issues.find((i) => i.code === 'uncertain');
    expect(issue.severity).toBe(BLOCKER);
    expect(issue.fix).toMatch(/KRA eTIMS portal/);
  });

  it('blocks on rejections', () => {
    const r = etimsReadiness({ config: liveConfig(), queue: { rejected: 1 } });
    expect(codesOf(r)).toContain('rejected');
  });

  it('separates "switched on" from "filing correctly"', () => {
    // Filing, but wrongly — the distinction the banner is built on.
    const r = etimsReadiness({ config: liveConfig(), unclassifiedCount: 5 });
    expect(r.filing).toBe(true);
    expect(r.ready).toBe(false);
  });
});

describe('classification status', () => {
  const complete = {
    tax_code: 'B',
    classification_code: '5059230800',
    quantity_unit: 'U',
    registered_at: '2026-09-02T00:00:00Z',
  };

  it('is complete when tax code, classification and unit are present', () => {
    expect(classificationStatus(complete).complete).toBe(true);
  });

  it('names what is missing rather than just saying no', () => {
    const s = classificationStatus({ ...complete, tax_code: null, classification_code: null });
    expect(s.complete).toBe(false);
    expect(s.missing).toContain('tax code');
    expect(s.missing).toContain('KRA classification code');
  });

  it('treats registration with KRA as separate from being classified', () => {
    // The first sale registers it; a classified-but-unregistered item is ready.
    const s = classificationStatus({ ...complete, registered_at: null });
    expect(s.complete).toBe(true);
    expect(s.registered).toBe(false);
  });

  it('rejects an unknown tax code rather than accepting the string', () => {
    expect(classificationStatus({ ...complete, tax_code: 'Z' }).complete).toBe(false);
  });

  it('handles a missing row without throwing', () => {
    expect(classificationStatus(null).complete).toBe(false);
  });
});

describe('suggesting a tax code', () => {
  it('infers standard rated when tax was actually charged', () => {
    expect(suggestTaxCode({ vatAmount: 160, sellingPrice: 1000 })).toBe('B');
  });

  it('refuses to choose when no tax was charged', () => {
    // Exempt, zero-rated and non-VAT all charge nothing. Guessing between them
    // misstates a VAT return, so this returns null and the tenant picks.
    expect(suggestTaxCode({ vatAmount: 0, sellingPrice: 1000 })).toBeNull();
  });

  it('has nothing to suggest for a zero-value line', () => {
    expect(suggestTaxCode({ vatAmount: 0, sellingPrice: 0 })).toBeNull();
  });
});

describe('the options a classification form offers', () => {
  it('explains the difference that actually matters commercially', () => {
    const options = taxCodeOptions();
    const exempt = options.find((o) => o.value === 'A');
    const zero = options.find((o) => o.value === 'C');
    // Both charge 0%. Only one lets the tenant reclaim input tax — which is the
    // whole reason picking the wrong one costs them money.
    expect(exempt.reclaimsInputTax).toBe(false);
    expect(zero.reclaimsInputTax).toBe(true);
  });

  it('carries a description for every code', () => {
    expect(taxCodeOptions().every((o) => o.desc && o.label)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const receipt = (etims, over = {}) =>
  buildPosReceipt({
    saleData: {
      pricingModel: 'cash',
      sellingPrice: 1000,
      vatAmount: 160,
      vatPercent: 16,
      totalAmount: 1160,
      paymentMethod: 'cash',
    },
    client: { full_name: 'A Customer' },
    asset: { description: 'Widget' },
    companyProfile: { company_name: 'Ararat Traders', kra_pin: 'P051234567X' },
    invoiceNo: 'INV-2026-000001',
    receiptNo: 'RCP-2026-000001',
    etims,
    ...over,
  });

const FILED = {
  status: 'sent',
  invoice_number: 42,
  kra_invoice_number: 1337,
  receipt_signature: 'ABCD1234EFGH5678',
  internal_data: 'WXYZ9876STUV5432',
  control_unit_id: 'KRACU0100000001',
  control_unit_at: '20260902093000',
  qr_url: 'https://etims.kra.go.ke/common/link/etims/receipt/indexEtimsReceiptData?Data=P051234567X00ABCD1234EFGH5678',
  environment: 'production',
};

describe('the eTIMS block on the receipt', () => {
  it('is absent entirely for a tenant not running the module', () => {
    const r = receipt(null);
    expect(r.etims).toBeNull();
    expect(thermalBody(r)).not.toMatch(/eTIMS/i);
    expect(a4Body(r)).not.toMatch(/eTIMS/i);
  });

  it('prints the signature, internal data and control unit once filed', () => {
    const html = thermalBody(receipt(FILED));
    expect(html).toMatch(/ABCD1234EFGH5678/);
    expect(html).toMatch(/WXYZ9876STUV5432/);
    expect(html).toMatch(/KRACU0100000001/);
    // KRA's own number, not our device sequence, is what the customer quotes.
    expect(html).toMatch(/1337/);
  });

  it('prints on BOTH papers — the A4 file copy is a tax document too', () => {
    expect(a4Body(receipt(FILED))).toMatch(/ABCD1234EFGH5678/);
  });

  it('says so, loudly, when the sale has not been filed yet', () => {
    // The receipt handed over at the till is normally printed before the
    // document reaches KRA. Omitting the block silently would make it
    // indistinguishable from a compliant one.
    const html = thermalBody(receipt({ ...FILED, status: 'pending', receipt_signature: null }));
    expect(html).toMatch(/filing pending/i);
    expect(html).toMatch(/reprint/i);
    expect(html).not.toMatch(/ABCD1234EFGH5678/);
  });

  it('derives "filed" from the signature, not from the status field', () => {
    // A status can be set by any code path; a signature can only come from KRA.
    const r = receipt({ ...FILED, status: 'sent', receipt_signature: null });
    expect(r.etims.filed).toBe(false);
  });

  it('marks a sandbox filing as a test rather than passing it off as real', () => {
    const html = thermalBody(receipt({ ...FILED, environment: 'sandbox' }));
    expect(html).toMatch(/NOT FILED WITH KRA/i);
  });

  it('prints the verification URL as text even when the QR could not be drawn', () => {
    // The QR only encodes this. A CDN failure costs the image, not the ability
    // to verify the receipt.
    const html = thermalBody(receipt(FILED));
    expect(html).toMatch(/etims\.kra\.go\.ke/);
    expect(html).not.toMatch(/<img/);
  });

  it('includes the QR image when one was rendered', () => {
    const r = receipt(FILED, { qrImage: 'data:image/gif;base64,R0lGOD' });
    expect(thermalBody(r)).toMatch(/<img src="data:image\/gif;base64,R0lGOD"/);
  });

  it('escapes what it prints — KRA text reaches the print window unfiltered otherwise', () => {
    const html = thermalBody(receipt({ ...FILED, receipt_signature: '<script>alert(1)</script>' }));
    expect(html).not.toMatch(/<script>alert/);
    expect(html).toMatch(/&lt;script&gt;/);
  });
});

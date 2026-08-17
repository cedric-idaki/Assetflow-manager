import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn(), auth: { getSession: vi.fn(), getUser: vi.fn() }, rpc: vi.fn() },
  getCurrentUser: vi.fn(),
  invokeSupabaseFunction: vi.fn(),
}));

const { printInvoice } = await import('./index');

// printInvoice writes into a window it opens; capture what it wrote.
const openPrintWindow = (args) => {
  let written = '';
  const w = {
    document: { write: (s) => { written += s; }, close: () => {} },
    focus: () => {},
    print: () => {},
  };
  vi.spyOn(window, 'open').mockReturnValue(w);
  printInvoice(args);
  return written;
};

const invoice = (overrides = {}) => ({
  invoice_no: 'INV-2026-000123',
  date: '2026-08-01',
  due_date: '2026-08-31',
  client_name: 'Grace Wanjiru',
  client_email: 'grace@example.com',
  account_no: 'ACC-0001',
  asset: 'Toyota Hiace 2019',
  asset_code: 'AST-014',
  plate_number: 'KDA 123X',
  amount: 200000,
  vat_amount: 32000,
  vat_rate: 16,
  method: 'mpesa',
  reference: 'SFG7H2K9',
  notes: '',
  items: null,
  plan: null,
  seller: null,
  ...overrides,
});

// The company the asset belongs to, as read off company_profiles.
const seller = (overrides = {}) => ({
  company_name: 'Rift Valley Motors Ltd',
  business_registration_number: 'PVT-9XABC12',
  kra_pin: 'P051234567X',
  physical_address: 'Enterprise Road, Industrial Area, Nairobi',
  email: 'sales@riftvalleymotors.co.ke',
  phone: '0720000111',
  ...overrides,
});

const plan = (overrides = {}) => ({
  tenure_months: 24,
  monthly_installment: 47073.47,
  deposit: 200000,
  financed: 1000000,
  interest_rate: 12,
  start_date: '2026-09-01',
  final_due_date: '2028-08-01',
  plan_total: 1329763.28,
  ...overrides,
});

beforeEach(() => { vi.restoreAllMocks(); });

describe('printInvoice — selling company', () => {
  it('heads the invoice with the company the asset came from, not the signed-in tenant', () => {
    const out = openPrintWindow({
      company: { company_name: 'Head Office Holdings', kra_pin: 'P0000000A' },
      invoice: invoice({ seller: seller() }),
    });
    expect(out).toContain('Rift Valley Motors Ltd');
    expect(out).toContain('Reg No: PVT-9XABC12');
    expect(out).toContain('KRA PIN: P051234567X');
    expect(out).toContain('Enterprise Road, Industrial Area, Nairobi');
    expect(out).toContain('0720000111 · sales@riftvalleymotors.co.ke');
    expect(out).not.toContain('Head Office Holdings');
  });

  it('names the selling company in the document title', () => {
    const out = openPrintWindow({ company: {}, invoice: invoice({ seller: seller() }) });
    expect(out).toContain('<title>Rift Valley Motors Ltd — Invoice INV-2026-000123 — Grace Wanjiru</title>');
  });

  it('falls back to the tenant profile when the asset carries no company of its own', () => {
    const out = openPrintWindow({
      company: { company_name: 'Head Office Holdings', kra_pin: 'P0000000A' },
      invoice: invoice({ seller: null }),
    });
    expect(out).toContain('Head Office Holdings');
    expect(out).toContain('KRA PIN: P0000000A');
  });

  it('builds the address from location and city when there is no physical address', () => {
    const out = openPrintWindow({
      company: {},
      invoice: invoice({ seller: seller({ physical_address: null, location: 'Kimathi Street', city: 'Nyeri' }) }),
    });
    expect(out).toContain('Kimathi Street, Nyeri');
  });

  it('omits the contact line entirely when the company has no phone or email', () => {
    const out = openPrintWindow({
      company: {},
      invoice: invoice({ seller: seller({ phone: null, email: null }) }),
    });
    expect(out).toContain('Rift Valley Motors Ltd');
    expect(out).not.toContain('· </div>');
  });
});

describe('printInvoice — payment plan', () => {
  it('states the monthly installment and the duration in months and years', () => {
    const out = openPrintWindow({ company: { company_name: 'Ararat Ltd' }, invoice: invoice({ plan: plan() }) });
    expect(out).toContain('Payment Plan');
    expect(out).toContain('Monthly Installment');
    expect(out).toContain('KES 47,073');
    expect(out).toContain('Payment Duration');
    expect(out).toContain('24 months (2 years)');
  });

  it('spells a part-year tenure out in years and months', () => {
    const out = openPrintWindow({ company: {}, invoice: invoice({ plan: plan({ tenure_months: 18 }) }) });
    expect(out).toContain('18 months (1 year 6 mo)');
  });

  it('leaves a short tenure in months alone', () => {
    const out = openPrintWindow({ company: {}, invoice: invoice({ plan: plan({ tenure_months: 6 }) }) });
    expect(out).toContain('6 months');
    expect(out).not.toContain('0 years');
  });

  it('carries the deposit, financed balance, rate and both due dates', () => {
    const out = openPrintWindow({ company: {}, invoice: invoice({ plan: plan() }) });
    expect(out).toContain('Deposit paid');
    expect(out).toContain('Balance financed');
    expect(out).toContain('12% p.a.');
    expect(out).toContain('First installment due');
    expect(out).toMatch(/01 Sept? 2026/);   // en-GB abbreviates September as Sep or Sept by ICU version
    expect(out).toContain('Final installment due');
    expect(out).toContain('01 Aug 2028');
    expect(out).toContain('Total payable over the plan');
  });

  it('prints no plan block for a cash sale or a hand-raised invoice', () => {
    const out = openPrintWindow({ company: {}, invoice: invoice({ plan: null }) });
    expect(out).not.toContain('Payment Plan');
    expect(out).toContain('TOTAL DUE');   // the rest of the invoice is unchanged
  });
});

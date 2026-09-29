import { describe, it, expect } from 'vitest';
import {
  normaliseLetterhead, letterheadFromRecord, mergeLetterhead, letterheadLines,
  letterheadContactLine, letterheadHtml, isUsableLogo, displayWebsite,
} from './letterhead';

// A 1×1 PNG, as the loader would hand it over.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const logo = { src: PNG, width: 400, height: 200 };

const rpcRow = {
  admin_id: 'tenant-a',
  kind: 'company',
  name: 'Rift Valley Motors Ltd',
  registration_no: 'PVT-9XABC12',
  motto: 'Driven by trust',
  phone: '0720 000 111',
  email: 'sales@rvm.co.ke',
  website: 'https://www.rvm.co.ke/',
  physical_address: 'Enterprise Road, Nairobi',
  postal_address: 'P.O. Box 123-00100',
  kra_pin: 'p051234567x',
  logo_path: 'tenant-a/logo-1.png',
  configured: true,
};

describe('normaliseLetterhead', () => {
  it('shapes the RPC payload', () => {
    const lh = normaliseLetterhead({ ...rpcRow, logo });
    expect(lh).toMatchObject({
      tenantId: 'tenant-a',
      name: 'Rift Valley Motors Ltd',
      motto: 'Driven by trust',
      website: 'www.rvm.co.ke',
      kraPin: 'P051234567X',
      physicalAddress: 'Enterprise Road, Nairobi',
      postalAddress: 'P.O. Box 123-00100',
      logoPath: 'tenant-a/logo-1.png',
    });
    expect(lh.logo).toMatchObject({ src: PNG, width: 400, height: 200, format: 'PNG' });
  });

  it('is idempotent — a letterhead passed through twice loses nothing', () => {
    const once = normaliseLetterhead({ ...rpcRow, logo });
    expect(normaliseLetterhead(once)).toEqual(once);
  });

  it('returns null for nothing at all', () => {
    expect(normaliseLetterhead(null)).toBeNull();
    expect(normaliseLetterhead('x')).toBeNull();
  });
});

describe('logo safety — the print window shares the app origin', () => {
  it('accepts only an embedded PNG or JPEG with a size', () => {
    expect(isUsableLogo(logo)).toBe(true);
    expect(isUsableLogo({ ...logo, src: PNG.replace('image/png', 'image/jpeg') })).toBe(true);
  });

  it.each([
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a remote tracker', 'https://evil.example/pixel.png'],
    ['an SVG, which can carry script', 'data:image/svg+xml;base64,PHN2Zz4='],
    ['markup smuggled into the payload', 'data:image/png;base64,AAAA" onerror="alert(1)'],
  ])('rejects %s', (_label, src) => {
    expect(isUsableLogo({ src, width: 10, height: 10 })).toBe(false);
    expect(normaliseLetterhead({ name: 'X', logo: { src, width: 10, height: 10 } }).logo).toBeNull();
  });

  it('rejects a logo with no dimensions — it could not be laid out', () => {
    expect(isUsableLogo({ src: PNG, width: 0, height: 10 })).toBe(false);
  });
});

describe('letterheadFromRecord', () => {
  it('reads a company_profiles row', () => {
    const lh = letterheadFromRecord({
      admin_id: 'tenant-a', company_name: 'Acme', business_registration_number: 'PVT-1',
      location: 'Westlands', city: 'Nairobi', phone: '0700', email: 'a@b.co',
    });
    expect(lh).toMatchObject({
      tenantId: 'tenant-a', name: 'Acme', registrationNo: 'PVT-1',
      physicalAddress: 'Westlands, Nairobi', phone: '0700', email: 'a@b.co',
    });
  });

  it('does not print the city twice when the location already names it', () => {
    expect(letterheadFromRecord({ company_name: 'X', location: 'Westlands,Nairobi', city: 'Nairobi' }).physicalAddress)
      .toBe('Westlands,Nairobi');
    expect(letterheadFromRecord({ company_name: 'X', location: '', city: 'Nyeri' }).physicalAddress).toBe('Nyeri');
  });

  it('reads a saccos row', () => {
    const lh = letterheadFromRecord({ admin_id: 's1', name: 'Umoja Sacco', registration_no: 'CS/1234', sasra_licence_no: null });
    expect(lh).toMatchObject({ tenantId: 's1', kind: 'sacco', name: 'Umoja Sacco', registrationNo: 'CS/1234' });
  });

  it('reads the finance hub\'s already-resolved seller', () => {
    const lh = letterheadFromRecord({ name: 'Mwangi Motors', reg_no: 'BN-77', address: 'Thika Road' });
    expect(lh).toMatchObject({ name: 'Mwangi Motors', registrationNo: 'BN-77', physicalAddress: 'Thika Road' });
  });
});

describe('mergeLetterhead', () => {
  const tenant = normaliseLetterhead({ ...rpcRow, logo });

  it('lets the tenant letterhead lead and the record fill its gaps', () => {
    const merged = mergeLetterhead(
      { ...tenant, phone: '' },
      { admin_id: 'tenant-a', company_name: 'Old Name', phone: '0799 999 999' },
    );
    expect(merged.name).toBe('Rift Valley Motors Ltd');
    expect(merged.phone).toBe('0799 999 999');
    expect(merged.logo.src).toBe(PNG);
  });

  it('never lays one tenant\'s branding over another tenant\'s document', () => {
    const other = { admin_id: 'tenant-b', company_name: 'Other Business Ltd', kra_pin: 'P000000000B' };
    const merged = mergeLetterhead(tenant, letterheadFromRecord(other));
    expect(merged.name).toBe('Other Business Ltd');
    expect(merged.logo).toBeNull();
    expect(merged.motto).toBe('');
  });

  it('falls back to whichever side exists', () => {
    expect(mergeLetterhead(null, { name: 'Only Record' }).name).toBe('Only Record');
    expect(mergeLetterhead(tenant, null).name).toBe('Rift Valley Motors Ltd');
    expect(mergeLetterhead(null, null)).toBeNull();
  });
});

describe('letterheadLines', () => {
  const lh = normaliseLetterhead(rpcRow);

  it('stacks one fact per line on a page', () => {
    expect(letterheadLines(lh)).toEqual([
      'Enterprise Road, Nairobi · P.O. Box 123-00100',
      'Tel: 0720 000 111 · sales@rvm.co.ke · www.rvm.co.ke',
      'Reg No: PVT-9XABC12',
      'KRA PIN: P051234567X',
    ]);
  });

  it('packs registration and PIN together on the compact layout', () => {
    expect(letterheadLines(lh, { layout: 'compact' })).toEqual([
      'Enterprise Road, Nairobi · P.O. Box 123-00100',
      'Tel: 0720 000 111 · sales@rvm.co.ke',
      'www.rvm.co.ke',
      'Reg No: PVT-9XABC12 · KRA PIN: P051234567X',
    ]);
  });

  it('prints no empty or dangling lines', () => {
    const bare = normaliseLetterhead({ name: 'Bare', phone: '0700' });
    expect(letterheadLines(bare)).toEqual(['Tel: 0700']);
    expect(letterheadLines(null)).toEqual([]);
  });

  it('gives one contact line for footers', () => {
    expect(letterheadContactLine(lh)).toBe('Tel: 0720 000 111 · sales@rvm.co.ke · www.rvm.co.ke');
    expect(letterheadContactLine(null)).toBe('');
  });
});

describe('letterheadHtml', () => {
  it('renders the logo, name, motto and lines', () => {
    const out = letterheadHtml(normaliseLetterhead({ ...rpcRow, logo }));
    expect(out).toContain(`<img class="lh-logo" src="${PNG}"`);
    expect(out).toContain('Rift Valley Motors Ltd');
    expect(out).toContain('<div class="lh-motto">Driven by trust</div>');
    expect(out).toContain('KRA PIN: P051234567X');
    expect(out).toContain('lh-page');
  });

  it('uses the centred roll variant for the 80mm receipt', () => {
    expect(letterheadHtml(rpcRow, { variant: 'roll' })).toContain('lh-roll');
  });

  it('escapes every tenant-supplied value', () => {
    const out = letterheadHtml({
      name: '<script>steal()</script>',
      motto: '"><img src=x onerror=alert(1)>',
      physical_address: 'A & B',
    });
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('A &amp; B');
  });

  it('only lets a plain hex colour into the style attribute', () => {
    expect(letterheadHtml(rpcRow, { accent: '#1A56DB' })).toContain('style="color:#1A56DB"');
    expect(letterheadHtml(rpcRow, { accent: 'red;background:url(x)' })).not.toContain('style=');
  });

  it('falls back to a name rather than printing a blank header', () => {
    expect(letterheadHtml(null)).toContain('>Ararat<');
    expect(letterheadHtml(null, { fallbackName: 'Society' })).toContain('>Society<');
  });
});

describe('displayWebsite', () => {
  it('prints a website the way people write it', () => {
    expect(displayWebsite('https://acme.co.ke/')).toBe('acme.co.ke');
    expect(displayWebsite('HTTP://www.acme.co.ke')).toBe('www.acme.co.ke');
    expect(displayWebsite(null)).toBe('');
  });
});

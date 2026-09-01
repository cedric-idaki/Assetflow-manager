import { describe, it, expect } from 'vitest';
import { certificateHtml } from './_util';

const cert = {
  id: 'a1b2c3d4-0000-0000-0000-000000000000',
  certificate_no: 'CERT-000412',
  serial: 'ARA-SHR-2026-000412-7QK3',
  shares: 2500,
  par_value: 200,
  issue_date: '2026-09-01',
  status: 'active',
};

const meta = {
  saccoName: 'Mwangaza Savings & Credit Co-operative',
  memberName: 'Achieng Otieno',
  memberNo: 'MEM-0148',
  marketValue: 260,
};

describe('certificateHtml', () => {
  it('prints the platform serial, not just the society number', () => {
    // CERT-000412 is unique only within one society — every sacco on the
    // platform issues one. The serial is what identifies the document.
    const doc = certificateHtml(cert, meta);
    expect(doc).toContain('ARA-SHR-2026-000412-7QK3');
    expect(doc).toContain('CERT-000412');
    expect(doc).toMatch(/Verify serial/i);
  });

  it('falls back to the old short reference when a certificate has no serial', () => {
    // Certificates sealed before serials existed must still print.
    const doc = certificateHtml({ ...cert, serial: null }, meta);
    expect(doc).not.toContain('ARA-SHR');
    expect(doc).toContain('a1b2c3d4');           // the legacy short reference
    expect(doc).toContain('CERT-000412');
  });

  it('states the holding it certifies', () => {
    const doc = certificateHtml(cert, meta);
    expect(doc).toContain('Achieng Otieno');
    expect(doc).toContain('MEM-0148');
    expect(doc).toContain('2,500 ordinary shares');
  });

  it('escapes what the society and member supplied', () => {
    // The certificate is written into a window that shares this app's origin.
    const doc = certificateHtml(
      { ...cert, certificate_no: '<img src=x onerror=alert(1)>' },
      { ...meta, memberName: '<script>alert(1)</script>' },
    );
    expect(doc).not.toContain('<script>alert(1)</script>');
    expect(doc).not.toContain('<img src=x');
    expect(doc).toContain('&lt;script&gt;');
  });

  it('stamps a superseded certificate so a stale copy cannot pass as current', () => {
    expect(certificateHtml({ ...cert, status: 'superseded' }, meta)).toContain('SUPERSEDED');
    expect(certificateHtml(cert, meta)).not.toContain('class="void"');
  });
});

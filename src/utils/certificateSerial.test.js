import { describe, it, expect } from 'vitest';
import {
  normalizeSerial, formatSerial, isSerialShaped, certTypeLabel, verdictOf,
} from './certificateSerial';

const SERIAL = 'ARA-SHR-2026-000412-7QK3';

describe('normalizeSerial', () => {
  it('reduces a printed serial to its lookup key', () => {
    expect(normalizeSerial(SERIAL)).toBe('ARASHR20260004127QK3');
  });

  it('forgives how a person retypes it off paper', () => {
    // Same certificate, four ways someone might enter it.
    const key = normalizeSerial(SERIAL);
    expect(normalizeSerial('ara-shr-2026-000412-7qk3')).toBe(key);
    expect(normalizeSerial('ARA SHR 2026 000412 7QK3')).toBe(key);
    expect(normalizeSerial('  ARA–SHR–2026–000412–7QK3  ')).toBe(key); // en dashes
    expect(normalizeSerial('ARASHR20260004127QK3')).toBe(key);
  });

  it('is empty for nothing', () => {
    expect(normalizeSerial('')).toBe('');
    expect(normalizeSerial(null)).toBe('');
    expect(normalizeSerial(undefined)).toBe('');
  });
});

describe('formatSerial', () => {
  it('puts a bare key back into printed groups', () => {
    expect(formatSerial('ARASHR20260004127QK3')).toBe(SERIAL);
    expect(formatSerial('arashr20260004127qk3')).toBe(SERIAL);
  });

  it('leaves an already-grouped serial alone', () => {
    expect(formatSerial(SERIAL)).toBe(SERIAL);
    expect(formatSerial('ara-shr-2026-000412-7qk3')).toBe(SERIAL);
  });

  it('does not force an unfamiliar shape into groups', () => {
    // A serial from a format we do not mint is still shown, not mangled.
    expect(formatSerial('LEGACY123')).toBe('LEGACY123');
    expect(formatSerial('')).toBe('');
  });
});

describe('isSerialShaped', () => {
  it('accepts a full serial however it was typed', () => {
    expect(isSerialShaped(SERIAL)).toBe(true);
    expect(isSerialShaped('ara shr 2026 000412 7qk3')).toBe(true);
  });

  it('rejects entries too short to be worth a round trip', () => {
    expect(isSerialShaped('')).toBe(false);
    expect(isSerialShaped('ARA-SHR')).toBe(false);
    expect(isSerialShaped('----')).toBe(false);
  });
});

describe('certTypeLabel', () => {
  it('names the three kinds the system issues', () => {
    expect(certTypeLabel('share')).toBe('Share certificate');
    expect(certTypeLabel('settlement')).toBe('Settlement & ownership transfer');
    expect(certTypeLabel('esignature')).toBe('Electronic signature');
  });

  it('falls back rather than showing a raw key', () => {
    expect(certTypeLabel('something_new')).toBe('Certificate');
    expect(certTypeLabel(undefined)).toBe('Certificate');
  });
});

describe('verdictOf', () => {
  const ok = { certificate_status: 'active', digest_ok: true };

  it('confirms a live, unaltered certificate', () => {
    expect(verdictOf(ok).tone).toBe('valid');
  });

  it('reports nothing found when there is no result', () => {
    expect(verdictOf(null).tone).toBe('unknown');
    expect(verdictOf(undefined).tone).toBe('unknown');
  });

  it('distinguishes superseded from revoked', () => {
    expect(verdictOf({ ...ok, certificate_status: 'superseded' }).tone).toBe('superseded');
    expect(verdictOf({ ...ok, certificate_status: 'revoked' }).tone).toBe('revoked');
  });

  it('names the certificate that replaced a superseded one', () => {
    const v = verdictOf({ ...ok, certificate_status: 'superseded', superseded_by_serial: 'ARASHR20260004137MN5' });
    expect(v.detail).toContain('ARA-SHR-2026-000413-7MN5');
  });

  it('shows the issuer reason on a revocation', () => {
    const v = verdictOf({ ...ok, certificate_status: 'revoked', revoked_reason_text: 'Issued to the wrong member' });
    expect(v.detail).toBe('Issued to the wrong member');
  });

  it('a broken seal outranks every other status', () => {
    // A tampered record must never read as "verified", whatever its status
    // column now says — that column is part of what an attacker would edit.
    expect(verdictOf({ certificate_status: 'active',     digest_ok: false }).tone).toBe('tampered');
    expect(verdictOf({ certificate_status: 'revoked',    digest_ok: false }).tone).toBe('tampered');
    expect(verdictOf({ certificate_status: 'superseded', digest_ok: false }).tone).toBe('tampered');
  });
});

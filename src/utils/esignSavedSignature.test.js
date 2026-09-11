import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  signerFingerprint,
  getSavedCapture,
  setSavedCapture,
  clearSavedCaptures,
  SAVED_TTL_MS,
} from './esignSavedSignature';

const SIG = { type: 'drawn', data: 'data:image/png;base64,AAAA' };
const OTHER = { type: 'typed', data: 'Jane Wanjiru', font: 'Caveat' };

// Two different tenants on the same shop-floor machine.
const saccoKey   = signerFingerprint('admin-sacco-1', 'user-a');
const companyKey = signerFingerprint('admin-company-2', 'user-b');

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });

describe('signerFingerprint', () => {
  it('gives different signers different buckets', () => {
    expect(saccoKey).not.toBe(companyKey);
  });

  it('is stable for the same identity and ignores case and padding', () => {
    expect(signerFingerprint('Admin-1', ' USER-A ')).toBe(signerFingerprint('admin-1', 'user-a'));
  });

  it('is empty when nothing identifies the signer', () => {
    expect(signerFingerprint()).toBe('');
    expect(signerFingerprint(null, undefined, '  ')).toBe('');
  });
});

describe('saved signature scoping', () => {
  it('gives a signer back their own signature', () => {
    setSavedCapture('signature', SIG, saccoKey);
    expect(getSavedCapture('signature', saccoKey)).toEqual(SIG);
  });

  // The defect this store exists to fix: a new SACCO or company account used to
  // find the previous account's ink waiting for it and stamp it as its own.
  it('never hands one account another account signature', () => {
    setSavedCapture('signature', SIG, saccoKey);
    expect(getSavedCapture('signature', companyKey)).toBeNull();
  });

  it('keeps signatures and initials apart', () => {
    setSavedCapture('signature', SIG, saccoKey);
    expect(getSavedCapture('initials', saccoKey)).toBeNull();
    setSavedCapture('initials', OTHER, saccoKey);
    expect(getSavedCapture('initials', saccoKey)).toEqual(OTHER);
    expect(getSavedCapture('signature', saccoKey)).toEqual(SIG);
  });

  it('refuses to store or return anything for an unidentified signer', () => {
    expect(setSavedCapture('signature', SIG, '')).toBe(false);
    expect(getSavedCapture('signature', '')).toBeNull();
    expect(localStorage.getItem('ararat_esign_saved_v2')).toBeNull();
  });

  it('forgets a signer on request', () => {
    setSavedCapture('signature', SIG, saccoKey);
    setSavedCapture('signature', OTHER, companyKey);
    clearSavedCaptures(saccoKey);
    expect(getSavedCapture('signature', saccoKey)).toBeNull();
    expect(getSavedCapture('signature', companyKey)).toEqual(OTHER);
  });

  it('expires, so nothing on the device is permanent', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T08:00:00Z'));
    setSavedCapture('signature', SIG, saccoKey);
    vi.setSystemTime(Date.now() + SAVED_TTL_MS + 1000);
    expect(getSavedCapture('signature', saccoKey)).toBeNull();
  });

  it('drops the old device-wide entry instead of reusing it', () => {
    localStorage.setItem('ararat_esign_saved_v1', JSON.stringify({ signature: SIG }));
    expect(getSavedCapture('signature', saccoKey)).toBeNull();
    expect(localStorage.getItem('ararat_esign_saved_v1')).toBeNull();
  });

  it('does not write a signature image too large for the device store', () => {
    const huge = { type: 'drawn', data: 'data:image/png;base64,' + 'A'.repeat(600 * 1024) };
    expect(setSavedCapture('signature', huge, saccoKey)).toBe(false);
    expect(getSavedCapture('signature', saccoKey)).toBeNull();
  });

  it('survives a store that has been corrupted', () => {
    localStorage.setItem('ararat_esign_saved_v2', 'not json');
    expect(getSavedCapture('signature', saccoKey)).toBeNull();
    expect(setSavedCapture('signature', SIG, saccoKey)).toBe(true);
    expect(getSavedCapture('signature', saccoKey)).toEqual(SIG);
  });
});

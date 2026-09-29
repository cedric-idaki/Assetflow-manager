/**
 * Proof of payment — the parts that fail silently if they drift.
 *
 *   THE PATH. storage_path_is_own_tenant() reads the first folder and
 *   attach_payment_proof() checks the second is the uploader. A path in any
 *   other shape is a refused upload the user only sees as "could not upload".
 *
 *   THE FILE CHECK mirrors the bucket's limits; if it lets through what the
 *   bucket refuses, the user waits for a round trip to be told no.
 */

import { describe, it, expect } from 'vitest';
import {
  buildProofPath, validateProofFile, proofMimeType, PROOF_MAX_BYTES,
} from './paymentProofs';

const file = (name, type, size = 2048) => ({ name, type, size });

describe('buildProofPath', () => {
  it('files under <tenant>/<uploader>/', () => {
    const path = buildProofPath('admin-1', 'user-9', 'slip.pdf', 1700000000000);
    expect(path).toBe('admin-1/user-9/1700000000000_slip.pdf');
    expect(path.split('/').slice(0, 2)).toEqual(['admin-1', 'user-9']);
  });

  it('cannot smuggle extra folders through the file name', () => {
    const path = buildProofPath('admin-1', 'user-9', '../other/Bank Slip (1).jpg', 1);
    expect(path.split('/')).toHaveLength(3);
    expect(path).toBe('admin-1/user-9/1_.._other_Bank_Slip_1_.jpg');
  });

  it('refuses to build a path with no tenant or no uploader', () => {
    expect(() => buildProofPath(null, 'user-9', 'a.pdf')).toThrow();
    expect(() => buildProofPath('admin-1', undefined, 'a.pdf')).toThrow();
  });
});

describe('validateProofFile', () => {
  it('accepts PDFs and photos', () => {
    expect(validateProofFile(file('slip.pdf', 'application/pdf'))).toBeNull();
    expect(validateProofFile(file('slip.jpg', 'image/jpeg'))).toBeNull();
    expect(validateProofFile(file('slip.png', 'image/png'))).toBeNull();
  });

  it('falls back to the extension when the browser gives no type', () => {
    expect(proofMimeType(file('IMG_0001.HEIC', ''))).toBe('image/heic');
    expect(validateProofFile(file('IMG_0001.HEIC', ''))).toBeNull();
  });

  it('refuses other formats, empty files and files over the bucket limit', () => {
    expect(validateProofFile(null)).toMatch(/choose a file/i);
    expect(validateProofFile(file('slip.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).toMatch(/PDF or an image/);
    expect(validateProofFile(file('slip.pdf', 'application/pdf', 0))).toMatch(/empty/);
    expect(validateProofFile(file('slip.pdf', 'application/pdf', PROOF_MAX_BYTES + 1))).toMatch(/10 MB/);
  });
});

// @vitest-environment node
//
// The node environment is required: jsdom's `crypto` has no `subtle`, and this
// module is nothing but WebCrypto.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module reads Deno.env at call time, so a plain stub set before import is
// enough — and lets a test change the key mid-run to prove key separation.
const env: Record<string, string | undefined> = {
  MPESA_CRED_ENC_KEY: 'mpesa-key-for-tests',
  PII_ENC_KEY: 'pii-key-for-tests',
};
(globalThis as unknown as { Deno: unknown }).Deno = {
  env: { get: (k: string) => env[k] },
};

const {
  DecryptError,
  MissingKeyError,
  decryptSecret,
  encryptSecret,
  keyConfigured,
  resetKeyCache,
} = await import('./crypto.ts');

beforeEach(() => {
  env.MPESA_CRED_ENC_KEY = 'mpesa-key-for-tests';
  env.PII_ENC_KEY = 'pii-key-for-tests';
  resetKeyCache();
});

describe('round trip', () => {
  it('returns exactly what was sealed', async () => {
    const secret = '01123456789012';
    expect(await decryptSecret(await encryptSecret(secret, 'pii'), 'pii')).toBe(secret);
  });

  it('survives non-ASCII and long values', async () => {
    const value = 'Mũthoni wa Kamau — 東京 — ' + 'x'.repeat(50_000);
    expect(await decryptSecret(await encryptSecret(value, 'pii'), 'pii')).toBe(value);
  });

  it('handles the empty string without collapsing it to null', async () => {
    const sealed = await encryptSecret('', 'pii');
    expect(sealed).not.toBe('');
    expect(await decryptSecret(sealed, 'pii')).toBe('');
  });

  it('emits the versioned envelope', async () => {
    expect(await encryptSecret('x', 'pii')).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  });
});

describe('IV reuse', () => {
  it('never produces the same ciphertext twice for the same input', async () => {
    // A fixed IV under one key is the classic GCM break: it leaks the XOR of the
    // plaintexts and voids the auth tag's guarantees. Distinct ciphertexts are
    // the observable symptom of a fresh IV per call.
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) seen.add(await encryptSecret('same-account-number', 'pii'));
    expect(seen.size).toBe(25);
  });
});

describe('tamper detection', () => {
  it('rejects a flipped bit in the ciphertext', async () => {
    const [v, iv, ct] = (await encryptSecret('1234567890', 'pii')).split(':');
    const bytes = Uint8Array.from(atob(ct), (c) => c.charCodeAt(0));
    bytes[0] ^= 0x01;
    const tampered = `${v}:${iv}:${btoa(String.fromCharCode(...bytes))}`;

    await expect(decryptSecret(tampered, 'pii')).rejects.toBeInstanceOf(DecryptError);
  });

  it('rejects a swapped IV', async () => {
    const a = (await encryptSecret('account-a', 'pii')).split(':');
    const b = (await encryptSecret('account-b', 'pii')).split(':');

    await expect(decryptSecret(`v1:${a[1]}:${b[2]}`, 'pii')).rejects.toBeInstanceOf(DecryptError);
  });

  it.each([
    ['not-ciphertext-at-all'],
    ['v1:only-two-parts'],
    ['v1::'],
    [''],
  ])('rejects malformed input %j', async (bad) => {
    await expect(decryptSecret(bad, 'pii')).rejects.toBeInstanceOf(DecryptError);
  });

  it('refuses an unknown version rather than guessing', async () => {
    const [, iv, ct] = (await encryptSecret('x', 'pii')).split(':');
    await expect(decryptSecret(`v9:${iv}:${ct}`, 'pii')).rejects.toThrow(/Unsupported ciphertext version/);
  });
});

describe('context binding', () => {
  const ctx = { recordId: 'employee-1', field: 'bank_account' };

  it('opens with the context it was sealed under', async () => {
    const sealed = await encryptSecret('111', 'pii', ctx);
    expect(await decryptSecret(sealed, 'pii', ctx)).toBe('111');
  });

  it('refuses ciphertext moved to another employee', async () => {
    // The attack this exists to stop: copy a colleague's sealed bank account
    // onto your own row and have payroll pay you at their account.
    const sealed = await encryptSecret('111', 'pii', ctx);
    await expect(
      decryptSecret(sealed, 'pii', { ...ctx, recordId: 'employee-2' }),
    ).rejects.toBeInstanceOf(DecryptError);
  });

  it('refuses ciphertext moved to another field', async () => {
    const sealed = await encryptSecret('111', 'pii', ctx);
    await expect(
      decryptSecret(sealed, 'pii', { ...ctx, field: 'nssf_number' }),
    ).rejects.toBeInstanceOf(DecryptError);
  });

  it('does not open a context-bound value without the context', async () => {
    const sealed = await encryptSecret('111', 'pii', ctx);
    await expect(decryptSecret(sealed, 'pii')).rejects.toBeInstanceOf(DecryptError);
  });
});

describe('key separation', () => {
  it('cannot open PII data with the M-Pesa key', async () => {
    const sealed = await encryptSecret('secret', 'pii');
    await expect(decryptSecret(sealed, 'mpesa')).rejects.toBeInstanceOf(DecryptError);
  });

  it('fails closed when the key changes under it', async () => {
    const sealed = await encryptSecret('secret', 'pii');
    env.PII_ENC_KEY = 'a-different-key';
    resetKeyCache();
    await expect(decryptSecret(sealed, 'pii')).rejects.toBeInstanceOf(DecryptError);
  });
});

describe('missing key', () => {
  it('throws MissingKeyError naming the secret, on both paths', async () => {
    env.PII_ENC_KEY = undefined;
    resetKeyCache();

    await expect(encryptSecret('x', 'pii')).rejects.toBeInstanceOf(MissingKeyError);
    await expect(encryptSecret('x', 'pii')).rejects.toThrow(/PII_ENC_KEY/);
    await expect(decryptSecret('v1:a:b', 'pii')).rejects.toThrow(/PII_ENC_KEY/);
    expect(keyConfigured('pii')).toBe(false);
  });

  it('recovers once the secret is set, without a redeploy', async () => {
    // A rejected key must not be cached: an instance that started before the
    // operator set the secret would otherwise fail for its whole lifetime.
    env.PII_ENC_KEY = undefined;
    resetKeyCache();
    await expect(encryptSecret('x', 'pii')).rejects.toBeInstanceOf(MissingKeyError);

    env.PII_ENC_KEY = 'set-a-moment-later';
    expect(await decryptSecret(await encryptSecret('x', 'pii'), 'pii')).toBe('x');
  });
});

describe('backward compatibility', () => {
  it('opens unversioned ciphertext written before this module existed', async () => {
    // Tenant Daraja secrets are stored as "base64(iv):base64(ct)". Reproduce
    // that exact legacy format and prove it still decrypts, because those rows
    // are live and are not re-encrypted by this change.
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(env.MPESA_CRED_ENC_KEY!),
    );
    const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
      'encrypt',
    ]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode('legacy-consumer-secret'),
    );
    const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
    const legacy = `${b64(iv)}:${b64(new Uint8Array(ct))}`;

    expect(await decryptSecret(legacy, 'mpesa')).toBe('legacy-consumer-secret');
  });
});

describe('mpesa re-export', () => {
  it('still round-trips through the old import path', async () => {
    vi.resetModules();
    const mpesa = await import('./mpesa.ts');
    expect(await mpesa.decryptSecret(await mpesa.encryptSecret('daraja'))).toBe('daraja');
  });
});

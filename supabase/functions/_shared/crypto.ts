/// <reference lib="deno.ns" />
/**
 * Application-level encryption for data that must be recoverable.
 *
 * WHY THIS EXISTS
 * ---------------
 * Supabase encrypts the disk, which defends against someone walking off with a
 * drive. It does NOT defend against the realistic failure here: a leaked
 * service-role key, a stolen logical backup, or an over-broad column grant —
 * in all three the attacker reads plaintext straight out of Postgres.
 *
 * So the fields that would actually hurt on release (bank account numbers,
 * NSSF numbers, next-of-kin ID numbers, tenant Daraja secrets) are stored as
 * AES-256-GCM ciphertext under a key that lives ONLY in Supabase function
 * secrets. The database holds ciphertext and never sees the key, so a database
 * compromise on its own yields nothing readable.
 *
 * This generalises the helpers that shipped inside _shared/mpesa.ts so PII and
 * Daraja secrets share one implementation rather than two divergent copies.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not a substitute for RLS or column grants. An attacker who can call the edge
 * functions as an authorised user still reads plaintext — that is the point of
 * the feature. This narrows the blast radius of a *database* compromise only.
 *
 * WIRE FORMAT
 * -----------
 *   v1:base64(iv):base64(ciphertext||tag)
 *
 * The `v1:` prefix is what makes a future key rotation or cipher change
 * possible without guessing at how an existing row was written. Ciphertext
 * produced before this module existed (tenant Daraja secrets) has no prefix and
 * is still accepted on read — see decryptSecret.
 */

/** Logical purpose → the function secret holding its key. */
export const KEY_NAMES = {
  /** Tenant Daraja credentials. Pre-dates this module; format is legacy. */
  mpesa: "MPESA_CRED_ENC_KEY",
  /** Employee payroll / identity PII on user_profiles. */
  pii: "PII_ENC_KEY",
} as const;

export type KeyPurpose = keyof typeof KEY_NAMES;

/**
 * Thrown when the key for a purpose is absent. Callers should surface this as a
 * configuration error (503), never as a generic failure — an operator needs to
 * know the secret is missing rather than see writes silently fall back to
 * plaintext.
 */
export class MissingKeyError extends Error {
  readonly envName: string;
  constructor(purpose: KeyPurpose) {
    const envName = KEY_NAMES[purpose];
    super(
      `${envName} is not set. Data protected by the "${purpose}" key cannot be read or written without it.`,
    );
    this.name = "MissingKeyError";
    this.envName = envName;
  }
}

/** Thrown when ciphertext is malformed, truncated, or fails its auth tag. */
export class DecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptError";
  }
}

// Importing a key runs a SHA-256 and an importKey per call, which is wasteful
// when backfilling thousands of rows on one warm instance. Keys are immutable
// for the life of the instance, so cache them per purpose.
const keyCache = new Map<KeyPurpose, Promise<CryptoKey>>();

function loadKey(purpose: KeyPurpose): Promise<CryptoKey> {
  const secret = Deno.env.get(KEY_NAMES[purpose]);
  if (!secret) return Promise.reject(new MissingKeyError(purpose));

  // Hash to exactly 32 bytes so an operator can use any passphrase length
  // without it silently becoming a weaker key.
  return crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(secret))
    .then((digest) =>
      crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
        "encrypt",
        "decrypt",
      ])
    );
}

function encryptionKey(purpose: KeyPurpose): Promise<CryptoKey> {
  const cached = keyCache.get(purpose);
  if (cached) return cached;
  const pending = loadKey(purpose);
  // Don't cache a rejection: a function instance that started before the secret
  // was set must recover once it is, instead of failing for its whole lifetime.
  pending.catch(() => keyCache.delete(purpose));
  keyCache.set(purpose, pending);
  return pending;
}

/** Test seam: drops cached keys so a changed env var takes effect. */
export function resetKeyCache(): void {
  keyCache.clear();
}

// btoa on a spread Uint8Array blows the call-stack argument limit on large
// inputs. Chunk it — PII values are short, but the backfill path is not the
// place to discover this.
function b64encode(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

function b64decode(s: string): Uint8Array {
  try {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  } catch {
    throw new DecryptError("Ciphertext is not valid base64.");
  }
}

/**
 * Binds ciphertext to where it belongs, as AES-GCM additional authenticated
 * data. Without this, ciphertext is portable: anyone able to write the table
 * could copy one employee's encrypted bank account onto another employee's row,
 * or move a value from `nssf_number_enc` into `bank_account_enc`, and it would
 * decrypt cleanly. With it, decryption fails unless the row id and column match
 * what was sealed.
 *
 * AAD is authenticated, not encrypted — it carries no secrets, only identifiers.
 */
export type EncryptionContext = { recordId: string; field: string };

const aadBytes = (ctx?: EncryptionContext): Uint8Array | undefined =>
  ctx ? new TextEncoder().encode(`${ctx.recordId}:${ctx.field}`) : undefined;

/**
 * Seals `plaintext`, returning "v1:base64(iv):base64(ct)".
 *
 * A fresh 96-bit IV is drawn per call — mandatory for GCM, where reusing an IV
 * under the same key leaks the XOR of the plaintexts and breaks the auth tag's
 * guarantees outright.
 */
export async function encryptSecret(
  plaintext: string,
  purpose: KeyPurpose = "mpesa",
  ctx?: EncryptionContext,
): Promise<string> {
  const key = await encryptionKey(purpose);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = aadBytes(ctx);
  const ct = await crypto.subtle.encrypt(
    aad ? { name: "AES-GCM", iv, additionalData: aad } : { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `v1:${b64encode(iv)}:${b64encode(new Uint8Array(ct))}`;
}

/**
 * Opens ciphertext written by encryptSecret.
 *
 * Accepts the unversioned "base64(iv):base64(ct)" form as well, because tenant
 * Daraja secrets were sealed that way before this module existed and must keep
 * decrypting. New writes always carry the version prefix.
 *
 * Throws DecryptError on a bad tag — which is the signal that the row was
 * tampered with, sealed under a different key, or moved from another
 * row/column. Never treat a failure here as "value is empty".
 */
export async function decryptSecret(
  stored: string,
  purpose: KeyPurpose = "mpesa",
  ctx?: EncryptionContext,
): Promise<string> {
  const parts = stored.split(":");
  let ivPart: string | undefined;
  let ctPart: string | undefined;

  if (parts.length === 3) {
    const [version, iv, ct] = parts;
    if (version !== "v1") {
      throw new DecryptError(`Unsupported ciphertext version "${version}".`);
    }
    ivPart = iv;
    ctPart = ct;
  } else if (parts.length === 2) {
    [ivPart, ctPart] = parts; // legacy, pre-versioning
  }

  if (!ivPart || !ctPart) throw new DecryptError("Malformed ciphertext.");

  const key = await encryptionKey(purpose);
  const aad = aadBytes(ctx);
  let pt: ArrayBuffer;
  try {
    pt = await crypto.subtle.decrypt(
      aad ? { name: "AES-GCM", iv: b64decode(ivPart), additionalData: aad } : {
        name: "AES-GCM",
        iv: b64decode(ivPart),
      },
      key,
      b64decode(ctPart),
    );
  } catch (err) {
    if (err instanceof DecryptError) throw err;
    // WebCrypto deliberately gives no detail on tag failure, and neither do we:
    // distinguishing "wrong key" from "tampered" is an oracle.
    throw new DecryptError(
      "Could not decrypt value: it was sealed with a different key, altered, or moved from another record.",
    );
  }
  return new TextDecoder().decode(pt);
}

/** True when the key for `purpose` is configured. For health/status responses. */
export const keyConfigured = (purpose: KeyPurpose): boolean =>
  Boolean(Deno.env.get(KEY_NAMES[purpose]));

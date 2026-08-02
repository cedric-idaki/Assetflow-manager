// Shared M-Pesa / Daraja helpers used by mpesa-stk-push, mpesa-callback and
// mpesa-status-query.
//
// The system runs THREE money flows and they use different credentials:
//
//   purpose='subscription' -> the platform owner's paybill, from the MPESA_*
//                             function secrets. This is how admins pay for
//                             portal access.
//   purpose='collection'   -> the tenant's OWN paybill, from their own Daraja
//                             app stored in mpesa_tenant_credentials. Opt-in;
//                             a tenant that has not completed Safaricom
//                             Go-Live simply cannot use this.
//
// Everything here is deliberately credential-agnostic: callers resolve a
// DarajaCreds and pass it in, so no code path can accidentally bill the wrong
// shortcode.

declare const Deno: { env: { get: (key: string) => string | undefined } };

export interface DarajaCreds {
  consumerKey: string;
  consumerSecret: string;
  /** Paybill number, or the till (store) number for Buy Goods. */
  shortcode: string;
  passkey: string;
  environment: 'sandbox' | 'production';
  accountType: 'paybill' | 'till';
  /**
   * Buy Goods only. STK for a till is authenticated against the HEAD OFFICE
   * shortcode while the money lands on the till, so the two numbers play
   * different roles in the request and cannot be collapsed into one. Ignored
   * for paybill, where a single number is both.
   */
  headOfficeShortcode?: string | null;
  /** Which flow these credentials belong to — recorded on the transaction. */
  source: 'platform' | 'tenant';
}

/**
 * The three request fields that differ between Paybill and Buy Goods. Getting
 * this wrong does not fail loudly — Daraja returns a generic error, or worse,
 * bills against the wrong shortcode.
 */
export function stkRouting(creds: DarajaCreds): {
  transactionType: string;
  businessShortCode: string;
  partyB: string;
} {
  if (creds.accountType === 'till') {
    return {
      transactionType: 'CustomerBuyGoodsOnline',
      businessShortCode: creds.headOfficeShortcode || creds.shortcode,
      partyB: creds.shortcode,
    };
  }
  return {
    transactionType: 'CustomerPayBillOnline',
    businessShortCode: creds.shortcode,
    partyB: creds.shortcode,
  };
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function baseUrl(environment: string): string {
  return environment === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

// ── Credential encryption ────────────────────────────────────────────────────
// Tenant Daraja secrets must be recoverable (we have to send them to Safaricom),
// so hashing is not an option — they are encrypted with AES-256-GCM under
// MPESA_CRED_ENC_KEY, which lives only in Supabase function secrets. The
// database stores ciphertext and never sees the key.

async function encryptionKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('MPESA_CRED_ENC_KEY');
  if (!secret) {
    throw new Error(
      'MPESA_CRED_ENC_KEY is not set. Tenant M-Pesa credentials cannot be read or written without it.',
    );
  }
  // Hash to exactly 32 bytes so any passphrase length works.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

const b64encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const b64decode = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Returns "base64(iv):base64(ciphertext)". */
export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${b64encode(iv)}:${b64encode(new Uint8Array(ct))}`;
}

export async function decryptSecret(stored: string): Promise<string> {
  const [ivPart, ctPart] = stored.split(':');
  if (!ivPart || !ctPart) throw new Error('Malformed encrypted credential');
  const key = await encryptionKey();
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64decode(ivPart) },
    key,
    b64decode(ctPart),
  );
  return new TextDecoder().decode(pt);
}

// ── Daraja primitives ────────────────────────────────────────────────────────

export async function getDarajaToken(creds: DarajaCreds): Promise<string> {
  const basic = btoa(`${creds.consumerKey}:${creds.consumerSecret}`);
  const res = await fetch(
    `${baseUrl(creds.environment)}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${basic}` } },
  );
  const data = await res.json().catch(() => ({}));
  if (!data?.access_token) {
    throw new Error(
      `Daraja rejected these credentials (${creds.source}/${creds.environment}): ${
        data?.errorMessage ?? res.status
      }`,
    );
  }
  return data.access_token;
}

/**
 * Daraja timestamps are East Africa Time (UTC+3), not UTC. The password is
 * derived from the same value we send, so a UTC timestamp still validates —
 * but production rejects timestamps it considers stale, so use real EAT.
 */
export function darajaTimestamp(now = new Date()): string {
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return eat.toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
}

export function stkPassword(shortcode: string, passkey: string, timestamp: string): string {
  return btoa(`${shortcode}${passkey}${timestamp}`);
}

/**
 * Accepts 07XXXXXXXX, 7XXXXXXXX, +2547XXXXXXXX, 2547XXXXXXXX (and the 011/01
 * Safaricom range) and returns the 2547…/2541… form Daraja requires.
 * Returns null when the number is not a valid Safaricom MSISDN.
 */
export function normalisePhone(raw: string): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  let n = digits;
  if (n.startsWith('254')) {
    // already international
  } else if (n.startsWith('0')) {
    n = `254${n.slice(1)}`;
  } else if (n.length === 9) {
    n = `254${n}`;
  }
  return /^254(7\d{8}|1\d{8})$/.test(n) ? n : null;
}

// ── Credential resolution ────────────────────────────────────────────────────

/** The platform owner's paybill — used for subscription collection. */
export function platformCreds(): DarajaCreds {
  const consumerKey = Deno.env.get('MPESA_CONSUMER_KEY') ?? '';
  const consumerSecret = Deno.env.get('MPESA_CONSUMER_SECRET') ?? '';
  const shortcode = Deno.env.get('MPESA_SHORTCODE') ?? '';
  const passkey = Deno.env.get('MPESA_PASSKEY') ?? '';
  const environment = (Deno.env.get('MPESA_ENV') ?? 'sandbox') as 'sandbox' | 'production';

  if (!consumerKey || !consumerSecret || !shortcode || !passkey) {
    throw new Error('Platform M-Pesa is not configured (missing MPESA_* secrets).');
  }
  return {
    consumerKey,
    consumerSecret,
    shortcode,
    passkey,
    environment,
    accountType: (Deno.env.get('MPESA_ACCOUNT_TYPE') ?? 'paybill') as 'paybill' | 'till',
    headOfficeShortcode: Deno.env.get('MPESA_HEAD_OFFICE_SHORTCODE') ?? null,
    source: 'platform',
  };
}

/**
 * A tenant's own Daraja app. Returns null when the tenant has not set one up —
 * callers should surface that as "M-Pesa not configured for this account"
 * rather than silently falling back to the platform paybill, which would send
 * a tenant's customer money to the platform owner.
 */
export async function tenantCreds(
  supabase: { from: (t: string) => any },
  adminId: string,
): Promise<DarajaCreds | null> {
  const { data } = await supabase
    .from('mpesa_tenant_credentials')
    .select(
      'shortcode, head_office_shortcode, account_type, environment, consumer_key_enc, consumer_secret_enc, passkey_enc, is_active',
    )
    .eq('admin_id', adminId)
    .maybeSingle();

  if (!data || !data.is_active) return null;

  return {
    consumerKey: await decryptSecret(data.consumer_key_enc),
    consumerSecret: await decryptSecret(data.consumer_secret_enc),
    passkey: await decryptSecret(data.passkey_enc),
    shortcode: data.shortcode,
    headOfficeShortcode: data.head_office_shortcode,
    accountType: data.account_type,
    environment: data.environment,
    source: 'tenant',
  };
}

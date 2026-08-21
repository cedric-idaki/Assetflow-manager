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

import {
  decryptSecret as decryptWithKey,
  encryptSecret as encryptWithKey,
} from './crypto.ts';

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

// The `corsHeaders` and `json()` helpers that lived here have been REMOVED, not
// moved. They hard-coded Access-Control-Allow-Origin: '*', and because four
// M-Pesa functions imported them, one wildcard was serving the whole payment
// surface. Headers now depend on the request — its Origin, its negotiated API
// version — so they cannot be a module constant.
//
// Use openRequest() from _shared/http.ts instead:
//
//     const api = await openRequest(req, { fn: 'mpesa-…', versions: API_VERSIONS });
//     if (api.halt) return api.halt;
//     const json = api.json;

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
//
// The implementation now lives in _shared/crypto.ts, shared with employee PII so
// there is one audited copy rather than two that can drift. These re-exports
// keep the existing call sites (mpesa-credentials, resolveTenantCreds below)
// unchanged, and the 'mpesa' purpose keeps them on MPESA_CRED_ENC_KEY.
//
// Credentials sealed before versioning have no "v1:" prefix; decryptSecret
// still accepts that form, so no re-encryption is needed.

export const encryptSecret = (plaintext: string): Promise<string> =>
  encryptWithKey(plaintext, 'mpesa');

export const decryptSecret = (stored: string): Promise<string> =>
  decryptWithKey(stored, 'mpesa');

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

/**
 * The credentials a given mpesa_transactions row was pushed with, so its outcome
 * can be queried against the same Daraja app that initiated it. Mirrors the
 * routing in mpesa-stk-push — keep the two in step.
 *
 * Returns null when they cannot be resolved (platform secrets unset, or the
 * tenant switched their integration off since the push). Callers must treat that
 * as "cannot verify", never as "failed".
 */
export async function credsForTransaction(
  supabase: { from: (t: string) => any },
  txn: { purpose?: string; admin_id?: string | null; shortcode?: string | null },
): Promise<DarajaCreds | null> {
  let creds: DarajaCreds | null = null;

  if (txn.purpose === 'collection') {
    creds = txn.admin_id ? await tenantCreds(supabase, txn.admin_id) : null;
  } else {
    try {
      creds = platformCreds();
    } catch (_) {
      creds = null;
    }
  }

  // A paybill rotated since the push means Daraja will not recognise the id
  // under these credentials. Worth saying out loud — the symptom otherwise is a
  // transaction that never resolves and no explanation anywhere.
  if (creds && txn.shortcode && creds.shortcode !== txn.shortcode) {
    console.warn(
      `Transaction was pushed on shortcode ${txn.shortcode} but current ${creds.source} credentials are for ${creds.shortcode}. Query will probably not match.`,
    );
  }

  return creds;
}

// ── Transaction status query ─────────────────────────────────────────────────

/**
 * What Safaricom itself says happened to a push.
 *
 * `unknown` is a first-class answer, not an error: Daraja returns
 * 500.001.1001 ("The transaction is being processed") for a push the customer
 * has not finished responding to, and transport failures are indistinguishable
 * from that here. Nothing may be settled on `unknown` — leave the row pending
 * and ask again later.
 */
export type StkOutcome =
  | { state: 'success'; resultCode: string; resultDesc: string }
  | { state: 'failed'; resultCode: string; resultDesc: string }
  | { state: 'unknown'; reason: string };

/**
 * Ask Daraja for the real outcome of a CheckoutRequestID.
 *
 * This is the authoritative answer. The STK callback is not: it arrives on a
 * public endpoint with no signature, so anything it claims has to be confirmed
 * here before money moves.
 */
export async function stkQuery(
  creds: DarajaCreds,
  checkoutRequestId: string,
): Promise<StkOutcome> {
  try {
    const timestamp = darajaTimestamp();
    // Must authenticate as the same shortcode the push did — for Buy Goods that
    // is the head office, not the till. See stkRouting.
    const shortcode = stkRouting(creds).businessShortCode;
    const token = await getDarajaToken(creds);

    const res = await fetch(`${baseUrl(creds.environment)}/mpesa/stkpushquery/v1/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: stkPassword(shortcode, creds.passkey, timestamp),
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      }),
    });

    const data = await res.json().catch(() => ({}));

    // 500.001.1001 is "still processing". Every other errorCode is a query we
    // could not complete — an invalid id, a rate limit, a rotated paybill. None
    // of them are evidence the payment failed, so all of them are 'unknown'.
    if (data?.errorCode) {
      return { state: 'unknown', reason: `${data.errorCode}: ${data.errorMessage ?? ''}`.trim() };
    }

    if (data?.ResultCode === undefined || data?.ResultCode === null) {
      return { state: 'unknown', reason: `Unrecognised query response (HTTP ${res.status})` };
    }

    const resultCode = String(data.ResultCode);
    const resultDesc = String(data.ResultDesc ?? '');
    return resultCode === '0'
      ? { state: 'success', resultCode, resultDesc }
      : { state: 'failed', resultCode, resultDesc };
  } catch (err) {
    // Network failure, bad credentials, Daraja down. Never a reason to settle.
    return { state: 'unknown', reason: (err as Error).message };
  }
}

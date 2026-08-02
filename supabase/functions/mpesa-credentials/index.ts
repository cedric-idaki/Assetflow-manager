// Tenant M-Pesa credentials — the write path for flow 2 (TENANT COLLECTION).
//
// A company or sacco collecting into its OWN paybill needs its OWN Daraja app.
// mpesa_tenant_credentials has RLS enabled with zero policies, so nothing in the
// browser can read or write it; this function is the only door, and it runs
// under the service role.
//
// Three rules this function exists to enforce:
//
//  1. SECRETS ARE ENCRYPTED BEFORE THEY TOUCH THE DATABASE. The consumer key,
//     secret and passkey are AES-256-GCM sealed with MPESA_CRED_ENC_KEY, which
//     lives only in function secrets. A database compromise alone does not
//     expose a tenant's Daraja app.
//
//  2. SECRETS ARE NEVER RETURNED. Not to the owner, not to a super admin. The
//     response says whether each one is *present*, never what it is. The
//     shortcode IS returned — it is printed on every receipt the business
//     issues, so it is not a secret, and showing it is how an operator confirms
//     they configured the right till.
//
//  3. CREDENTIALS ARE NOT TRUSTED UNTIL SAFARICOM ACCEPTS THEM. Saving performs
//     a live Daraja token fetch. is_active is set only when that succeeds, so
//     mpesa-stk-push (which skips inactive rows) can never route a member's
//     money at a paybill we have never authenticated against.
//
// verify_jwt = true: the caller's JWT is what establishes which tenant these
// credentials belong to. admin_id is never taken from the request body.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  corsHeaders,
  json,
  encryptSecret,
  decryptSecret,
  getDarajaToken,
  type DarajaCreds,
} from '../_shared/mpesa.ts';

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

/** Roles that own a tenant, and may therefore connect its paybill. */
const TENANT_OWNER_ROLES = ['admin', 'sacco_admin'];

type Row = {
  admin_id: string;
  shortcode: string;
  head_office_shortcode: string | null;
  account_type: string;
  environment: string;
  consumer_key_enc: string;
  consumer_secret_enc: string;
  passkey_enc: string;
  is_active: boolean;
  verified_at: string | null;
  last_error: string | null;
  updated_at: string | null;
};

/** The safe shape: everything an operator needs, nothing they could leak. */
const publicView = (row: Row | null, callbackUrl: string) => ({
  configured: !!row,
  shortcode: row?.shortcode ?? null,
  headOfficeShortcode: row?.head_office_shortcode ?? null,
  accountType: row?.account_type ?? 'paybill',
  environment: row?.environment ?? 'sandbox',
  isActive: row?.is_active ?? false,
  verifiedAt: row?.verified_at ?? null,
  lastError: row?.last_error ?? null,
  updatedAt: row?.updated_at ?? null,
  // Presence only — never the values.
  present: {
    consumerKey: Boolean(row?.consumer_key_enc),
    consumerSecret: Boolean(row?.consumer_secret_enc),
    passkey: Boolean(row?.passkey_enc),
  },
  // Safaricom's public sandbox shortcode. Seeing production-looking config
  // while still on 174379 is the commonest reason a "working" integration
  // moves no money.
  isSandboxDefault: row?.shortcode === '174379',
  callbackUrl,
  encryptionReady: Boolean(Deno.env.get('MPESA_CRED_ENC_KEY')),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const callbackUrl = `${supabaseUrl}/functions/v1/mpesa-callback`;

    // ── Identify the caller ──────────────────────────────────────────────────
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Not authenticated' }, 401);

    const { data: userData } = await admin.auth.getUser(jwt);
    const user = userData?.user;
    if (!user) return json({ error: 'Not authenticated' }, 401);

    const { data: profile } = await admin
      .from('user_profiles')
      .select('role, admin_id')
      .eq('id', user.id)
      .maybeSingle();

    if (!TENANT_OWNER_ROLES.includes(profile?.role ?? '')) {
      return json(
        { error: 'Only the account owner can connect M-Pesa for this organisation.' },
        403,
      );
    }

    // Mirrors public.current_admin_id(). Staff of a tenant resolve to their
    // owning admin, but the role gate above already excludes them.
    const adminId: string = profile?.admin_id ?? user.id;

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const action = body?.action ?? 'status';

    const loadRow = async (): Promise<Row | null> => {
      const { data } = await admin
        .from('mpesa_tenant_credentials')
        .select('*')
        .eq('admin_id', adminId)
        .maybeSingle();
      return (data as Row) ?? null;
    };

    // ── status ───────────────────────────────────────────────────────────────
    if (action === 'status') {
      return json(publicView(await loadRow(), callbackUrl));
    }

    // ── disable ──────────────────────────────────────────────────────────────
    // Stops collection without destroying the credentials, so turning it back
    // on does not mean re-keying three secrets from a Daraja portal.
    if (action === 'disable') {
      const existing = await loadRow();
      if (!existing) return json({ error: 'M-Pesa is not set up for this account.' }, 404);

      await admin
        .from('mpesa_tenant_credentials')
        .update({ is_active: false, last_error: 'Switched off by the account owner.' })
        .eq('admin_id', adminId);

      return json({ ...publicView(await loadRow(), callbackUrl), message: 'M-Pesa collection switched off.' });
    }

    // ── save ─────────────────────────────────────────────────────────────────
    if (action !== 'save') return json({ error: `Unknown action '${action}'` }, 400);

    if (!Deno.env.get('MPESA_CRED_ENC_KEY')) {
      return json(
        {
          error:
            'MPESA_CRED_ENC_KEY is not set on this project, so credentials cannot be stored securely. Set it in the Supabase function secrets first.',
          code: 'ENC_KEY_MISSING',
        },
        503,
      );
    }

    const existing = await loadRow();

    const shortcode = String(body.shortcode ?? '').replace(/\D/g, '');
    const accountType = body.accountType === 'till' ? 'till' : 'paybill';
    const environment = body.environment === 'production' ? 'production' : 'sandbox';
    const headOffice = String(body.headOfficeShortcode ?? '').replace(/\D/g, '') || null;

    if (!shortcode) return json({ error: 'Enter your paybill or till number.' }, 400);

    // Buy Goods authenticates against the head office shortcode while the money
    // lands on the till, so both numbers are genuinely needed — see stkRouting.
    if (accountType === 'till' && !headOffice && !existing?.head_office_shortcode) {
      return json(
        { error: 'Buy Goods needs the head office shortcode as well as the till number.' },
        400,
      );
    }

    // Blank means "keep what is already stored" — so an operator can switch
    // sandbox to production without re-pasting three secrets they may not have
    // to hand. A first-time save has nothing to keep, so all three are required.
    const rawKey = String(body.consumerKey ?? '').trim();
    const rawSecret = String(body.consumerSecret ?? '').trim();
    const rawPasskey = String(body.passkey ?? '').trim();

    if (!existing && (!rawKey || !rawSecret || !rawPasskey)) {
      return json(
        { error: 'Consumer key, consumer secret and passkey are all required the first time.' },
        400,
      );
    }

    const consumerKeyEnc = rawKey ? await encryptSecret(rawKey) : existing!.consumer_key_enc;
    const consumerSecretEnc = rawSecret ? await encryptSecret(rawSecret) : existing!.consumer_secret_enc;
    const passkeyEnc = rawPasskey ? await encryptSecret(rawPasskey) : existing!.passkey_enc;

    // ── Prove Safaricom accepts them BEFORE going live ───────────────────────
    const candidate: DarajaCreds = {
      consumerKey: rawKey || (await decryptSecret(existing!.consumer_key_enc)),
      consumerSecret: rawSecret || (await decryptSecret(existing!.consumer_secret_enc)),
      passkey: rawPasskey || (await decryptSecret(existing!.passkey_enc)),
      shortcode,
      headOfficeShortcode: headOffice ?? existing?.head_office_shortcode ?? null,
      accountType,
      environment,
      source: 'tenant',
    };

    let verified = false;
    let lastError: string | null = null;
    try {
      await getDarajaToken(candidate);
      verified = true;
    } catch (err) {
      lastError = (err as Error).message;
    }

    const { error: upsertErr } = await admin.from('mpesa_tenant_credentials').upsert(
      {
        admin_id: adminId,
        shortcode,
        head_office_shortcode: candidate.headOfficeShortcode,
        account_type: accountType,
        environment,
        consumer_key_enc: consumerKeyEnc,
        consumer_secret_enc: consumerSecretEnc,
        passkey_enc: passkeyEnc,
        // Only a live token makes these usable. mpesa-stk-push skips inactive
        // rows, so a failed check leaves collection safely off rather than
        // pointing members' money at a paybill we cannot authenticate against.
        is_active: verified,
        verified_at: verified ? new Date().toISOString() : existing?.verified_at ?? null,
        last_error: lastError,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'admin_id' },
    );

    if (upsertErr) {
      console.error('Failed to store tenant M-Pesa credentials:', upsertErr.message);
      return json({ error: 'Could not save the credentials. Please try again.' }, 500);
    }

    return json({
      ...publicView(await loadRow(), callbackUrl),
      verified,
      message: verified
        ? 'Safaricom accepted these credentials. M-Pesa collection is now on.'
        : 'Saved, but Safaricom rejected these credentials, so collection stays off.',
    });
  } catch (err) {
    console.error('mpesa-credentials error:', err);
    return json({ error: (err as Error).message || 'Internal server error' }, 500);
  }
});

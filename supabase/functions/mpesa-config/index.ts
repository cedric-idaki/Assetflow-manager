// M-Pesa configuration status + live credential check.
//
// Answers "is M-Pesa actually wired up, and does Safaricom accept our
// credentials?" without ever returning a credential. The consumer key, secret
// and passkey never leave this function — the response says only whether each
// is present and whether Daraja issued a token with them.
//
// The paybill shortcode IS returned: it is printed on every M-Pesa receipt the
// business issues, so it is not a secret, and showing it is how the operator
// confirms they configured the right till.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getDarajaToken, platformCreds } from '../_shared/mpesa.ts';
import { openRequest } from '../_shared/http.ts';

const API_VERSIONS = ['2026-08-21'];

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

Deno.serve(async (req) => {
  const api = await openRequest(req, {
    fn: 'mpesa-config',
    methods: 'POST, OPTIONS',
    versions: API_VERSIONS,
  });
  if (api.halt) return api.halt;

  // Shadows the json() previously imported from _shared/mpesa.ts.
  const json = api.json;

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Not authenticated' }, 401);

    const { data: userData } = await supabase.auth.getUser(jwt);
    const user = userData?.user;
    if (!user) return json({ error: 'Not authenticated' }, 401);

    // Each call reaches out to Safaricom for a Daraja token to prove the
    // platform credentials still work. That is a slow external round trip on
    // someone else's quota, so it must not be loopable. This backs one
    // super-admin settings screen; 20 a minute covers any amount of refreshing.
    const over = await api.enforceLimit({
      action: 'check',
      identity: `user:${user.id}`,
      limit: 20,
      windowSeconds: 60,
    });
    if (over) return over;

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.role !== 'super_admin') {
      return json({ error: 'Super admin only' }, 403);
    }

    // Presence check first, so a half-configured deployment reports exactly
    // which secret is missing instead of a vague failure.
    const present = {
      consumerKey: Boolean(Deno.env.get('MPESA_CONSUMER_KEY')),
      consumerSecret: Boolean(Deno.env.get('MPESA_CONSUMER_SECRET')),
      shortcode: Boolean(Deno.env.get('MPESA_SHORTCODE')),
      passkey: Boolean(Deno.env.get('MPESA_PASSKEY')),
      credEncKey: Boolean(Deno.env.get('MPESA_CRED_ENC_KEY')),
    };

    const missing = Object.entries(present)
      .filter(([, v]) => !v)
      .map(([k]) => k);

    const environment = Deno.env.get('MPESA_ENV') ?? 'sandbox';
    const shortcode = Deno.env.get('MPESA_SHORTCODE') ?? null;
    const accountType = Deno.env.get('MPESA_ACCOUNT_TYPE') ?? 'paybill';

    // Safaricom's public sandbox shortcode. Worth calling out explicitly:
    // seeing production-looking config while still on 174379 is the single
    // most common reason a "working" integration moves no money.
    const isSandboxDefault = shortcode === '174379';

    const callbackUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/mpesa-callback`;

    let credentialsValid = false;
    let credentialError: string | null = null;

    if (missing.filter((m) => m !== 'credEncKey').length === 0) {
      try {
        await getDarajaToken(platformCreds());
        credentialsValid = true;
      } catch (err) {
        credentialError = (err as Error).message;
      }
    }

    return json({
      environment,
      shortcode,
      accountType,
      headOfficeShortcode: Deno.env.get('MPESA_HEAD_OFFICE_SHORTCODE') ?? null,
      callbackUrl,
      present,
      missing,
      isSandboxDefault,
      credentialsValid,
      credentialError,
    });
  } catch (err) {
    return api.fail(err);
  }
});

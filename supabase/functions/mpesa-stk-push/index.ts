// STK Push initiator.
//
// Routes to the correct paybill by `purpose`:
//   'subscription'       -> the PLATFORM OWNER's paybill (MPESA_* secrets). An
//                           admin paying for portal access.
//   'collection'         -> the CALLING TENANT's own paybill
//                           (mpesa_tenant_credentials). A company/sacco
//                           collecting from its own client/member.
//   'sacco_contribution' -> the PLATFORM OWNER's paybill, collected on behalf of
//                           the sacco. A member paying their savings
//                           contribution from the member portal. The pending
//                           sacco_contributions row must already exist and is
//                           named by `contributionId`; the callback completes
//                           that exact row, so the money can never land against
//                           a contribution nobody asked for.
//
// Why sacco contributions collect centrally: saccos do not run their own Daraja
// apps here, so there is no per-sacco paybill to route to. The platform collects
// and the sacco's ledger records the member's credit — which means the platform
// owner HOLDS that cash and owes it onward to the sacco. That settlement is a
// business process, not something this function can do. Anyone changing this
// must keep that obligation in view.
//
// 'collection' still has NO fallback. If a company has not configured its own
// Daraja app, collection fails with a clear message — silently routing a
// company's customer's money to the platform owner would be a financial error,
// not a degraded experience. sacco_contribution is central BY DESIGN and says so
// on every screen; 'collection' would be central BY ACCIDENT.
//
// verify_jwt = true: the caller's JWT is what establishes which tenant this
// payment belongs to. Never take admin_id from the request body.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  baseUrl,
  getDarajaToken,
  darajaTimestamp,
  stkPassword,
  normalisePhone,
  platformCreds,
  tenantCreds,
  stkRouting,
  type DarajaCreds,
} from '../_shared/mpesa.ts';
import { expectedSubscriptionPrice } from '../_shared/plans.ts';
import { openRequest } from '../_shared/http.ts';

const API_VERSIONS = ['2026-08-21'];

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

Deno.serve(async (req) => {
  const api = await openRequest(req, {
    fn: 'mpesa-stk-push',
    methods: 'POST, OPTIONS',
    versions: API_VERSIONS,
  });
  if (api.halt) return api.halt;

  // Shadows the json() previously imported from _shared/mpesa.ts, so every
  // existing return below gains origin-checked CORS and the version header.
  const json = api.json;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

    // ── Identify the caller ──────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return json({ error: 'Not authenticated' }, 401);

    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    const user = userData?.user;
    if (userErr || !user) return json({ error: 'Not authenticated' }, 401);

    // Mirrors public.current_admin_id(): staff/agents resolve to their owning
    // admin, an admin resolves to themselves.
    const { data: profile } = await admin
      .from('user_profiles')
      .select('admin_id, role, email')
      .eq('id', user.id)
      .maybeSingle();
    let adminId: string = profile?.admin_id ?? user.id;

    // ── Budget ───────────────────────────────────────────────────────────────
    // Every accepted call makes a real phone ring with a real payment prompt,
    // and the payer's number is chosen by the caller. Unmetered, one signed-in
    // account can use Safaricom to harass an arbitrary number, and can burn the
    // Daraja request quota that every tenant's collections depend on.
    //
    // A person paying is a single deliberate act; the retry path is
    // mpesa-status-query polling, not another push. Five a minute leaves ample
    // room for a mistyped number and a genuine retry.
    const over = await api.enforceLimit({
      action: 'push',
      identity: `user:${user.id}`,
      limit: 5,
      windowSeconds: 60,
    });
    if (over) return over;

    // ── Validate input ───────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const {
      purpose = 'collection',
      phone,
      amount,
      accountRef,
      clientId = null,
      planId = null,
      chargeId = null,
      subscriptionId = null,
      contributionId = null,
    } = body ?? {};

    if (!['subscription', 'collection', 'test', 'sacco_contribution'].includes(purpose)) {
      return json(
        { error: "purpose must be 'subscription', 'collection', 'sacco_contribution' or 'test'" },
        400,
      );
    }

    // A test push spends real money on the platform paybill, so it is restricted
    // to the platform owner rather than being an open endpoint any tenant can
    // hammer against your Daraja rate limits.
    if (purpose === 'test' && profile?.role !== 'super_admin') {
      return json({ error: 'Only a super admin can send a test payment.' }, 403);
    }
    if (!phone || !amount || !accountRef) {
      return json({ error: 'phone, amount and accountRef are required' }, 400);
    }

    const msisdn = normalisePhone(phone);
    if (!msisdn) {
      return json({ error: 'Invalid Safaricom number. Use 07XXXXXXXX or 2547XXXXXXXX.' }, 400);
    }

    // Daraja only accepts whole shillings, and rejects zero/negative outright.
    const payable = Math.round(Number(amount));
    if (!Number.isFinite(payable) || payable < 1) {
      return json({ error: 'Amount must be at least KES 1' }, 400);
    }

    // ── Sacco contribution: bind the push to a real pending row ──────────────
    // The contribution must already exist (created by
    // sacco_member_submit_contribution under the member's own JWT), and the
    // caller must be either the member it belongs to or staff of their sacco.
    // Taking the sacco from THIS row rather than from the request body is what
    // stops a member of sacco A from pushing money onto sacco B's paybill.
    let memberId: string | null = null;
    if (purpose === 'sacco_contribution') {
      if (!contributionId) {
        return json({ error: 'contributionId is required for a sacco contribution' }, 400);
      }

      const { data: contribution } = await admin
        .from('sacco_contributions')
        .select('id, admin_id, member_id, amount, status, payment_method')
        .eq('id', contributionId)
        .maybeSingle();

      if (!contribution) return json({ error: 'Contribution not found' }, 404);
      if (contribution.status !== 'pending') {
        return json({ error: `This contribution is already ${contribution.status}.` }, 409);
      }

      const { data: member } = await admin
        .from('sacco_members')
        .select('id, user_id, admin_id')
        .eq('id', contribution.member_id)
        .maybeSingle();

      const isOwner = member?.user_id === user.id;
      const isTheirStaff =
        profile?.role !== 'sacco_member' &&
        profile?.role !== 'client' &&
        adminId === contribution.admin_id;

      if (!isOwner && !isTheirStaff) {
        return json({ error: 'Not authorised to pay this contribution' }, 403);
      }

      // The amount is the recorded one, not whatever the browser posted.
      if (Math.round(Number(contribution.amount)) !== payable) {
        return json({ error: 'Amount does not match the recorded contribution' }, 400);
      }

      adminId = contribution.admin_id;
      memberId = contribution.member_id;
    }

    // ── Subscription: is this the right price for the plan? ──────────────────
    // ENFORCED. The expected figure is recomputed server-side from
    // _shared/plans.ts, a third copy of pricing that
    // src/config/planCatalogs.sync.test.js fails on if it drifts from the two
    // frontend catalogs.
    //
    // Everything the payer controls fails CLOSED — a missing, unknown or
    // foreign subscriptionId, a seat count no tier covers, or a wrong amount
    // all stop the push. That is the whole point: settleSubscription activates
    // on txn.admin_id alone and never reads subscriptionId, so a push that
    // skipped this check would still open the portal at whatever price it
    // named. Only an unexpected exception fails open, and it says so loudly.
    if (purpose === 'subscription') {
      const verdict = await verifySubscriptionPrice(admin, { subscriptionId, adminId, payable });
      if (!verdict.ok) return json({ error: verdict.error, code: verdict.code }, verdict.status);
    }

    // ── Resolve credentials for this flow ────────────────────────────────────
    let creds: DarajaCreds;
    if (purpose === 'subscription' || purpose === 'test' || purpose === 'sacco_contribution') {
      // Sacco contributions collect centrally — see the header note. The
      // transaction row still carries admin_id + member_id, so which sacco the
      // money is owed to is never ambiguous.
      try {
        creds = platformCreds();
      } catch (_) {
        return json(
          {
            error:
              purpose === 'sacco_contribution'
                ? 'M-Pesa is not available right now. Pay by cash, bank or card and record it here for your treasurer to confirm.'
                : 'Platform M-Pesa is not configured (missing MPESA_* secrets).',
            code: 'MPESA_NOT_CONFIGURED',
          },
          503,
        );
      }
    } else {
      const tc = await tenantCreds(admin, adminId);
      if (!tc) {
        return json(
          {
            error:
              'M-Pesa is not set up for this account. Add your own Daraja credentials under Settings → M-Pesa before collecting payments.',
            code: 'TENANT_MPESA_NOT_CONFIGURED',
          },
          409,
        );
      }
      creds = tc;
    }

    // ── Initiate ─────────────────────────────────────────────────────────────
    const timestamp = darajaTimestamp();
    const token = await getDarajaToken(creds);
    const route = stkRouting(creds);

    const stkRes = await fetch(`${baseUrl(creds.environment)}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: route.businessShortCode,
        // The password is derived from the shortcode the request authenticates
        // as, which for Buy Goods is the head office, not the till.
        Password: stkPassword(route.businessShortCode, creds.passkey, timestamp),
        Timestamp: timestamp,
        TransactionType: route.transactionType,
        Amount: payable,
        PartyA: msisdn,
        PartyB: route.partyB,
        PhoneNumber: msisdn,
        CallBackURL: `${supabaseUrl}/functions/v1/mpesa-callback`,
        // Daraja truncates these hard; send something the payer can recognise
        // on their statement rather than a silently cut UUID.
        AccountReference: String(accountRef).slice(0, 12),
        TransactionDesc: String(accountRef).slice(0, 13),
      }),
    });

    const stk = await stkRes.json().catch(() => ({}));

    if (stk.ResponseCode !== '0') {
      const message = stk.errorMessage || stk.ResponseDescription || 'STK push failed';
      console.error('STK push rejected', { purpose, shortcode: creds.shortcode, message });
      return json({ error: message }, 400);
    }

    // ── Record the attempt ───────────────────────────────────────────────────
    // This row is the ONLY thing that makes the callback trustworthy: the
    // callback endpoint is public, so it only acts on a CheckoutRequestID it
    // finds here.
    const { error: dbErr } = await admin.from('mpesa_transactions').insert({
      checkout_request_id: stk.CheckoutRequestID,
      merchant_request_id: stk.MerchantRequestID,
      phone_number: msisdn,
      amount: payable,
      account_reference: accountRef,
      admin_id: adminId,
      purpose,
      client_id: clientId,
      plan_id: planId,
      charge_id: chargeId,
      member_id: memberId,
      contribution_id: purpose === 'sacco_contribution' ? contributionId : null,
      shortcode: creds.shortcode,
      environment: creds.environment,
      status: 'pending',
    });

    if (dbErr) {
      // The customer's phone is already ringing, but we have nowhere to record
      // the result — better to fail loudly than to take money we cannot match.
      console.error('Failed to record STK attempt:', dbErr.message);
      return json(
        { error: 'Payment was initiated but could not be recorded. Do not retry — contact support.' },
        500,
      );
    }

    if (purpose === 'subscription') {
      await admin.from('mpesa_subscription_payments').insert({
        admin_id: adminId,
        subscription_id: subscriptionId,
        phone_number: msisdn,
        amount: payable,
        merchant_request_id: stk.MerchantRequestID,
        checkout_request_id: stk.CheckoutRequestID,
        status: 'pending',
      });
    }

    return json({
      success: true,
      checkoutRequestId: stk.CheckoutRequestID,
      message: 'STK push sent. Waiting for the customer to confirm on their phone.',
    });
  } catch (err) {
    return api.fail(err);
  }
});

/** The answer from verifySubscriptionPrice: proceed, or refuse with this reason. */
type PriceVerdict =
  | { ok: true }
  | { ok: false; error: string; code: string; status: number };

/**
 * Check what was posted against what the plan should cost, and refuse the push
 * when they disagree.
 *
 * The seat count comes from the subscription row, which the browser also wrote,
 * and that is fine: this enforces "the price is right for what you claimed",
 * while max_users bounds what the account actually gets. Buying a 1-seat plan
 * is legitimate; buying 50 seats for the price of one is not.
 *
 * FAILS CLOSED on every branch the payer can influence. The previous version
 * logged all of them and let the payment through, which verified nothing in
 * practice: the registration page only sends subscriptionId when it has one, so
 * omitting it skipped the check entirely and KES 1 still bought a month.
 */
async function verifySubscriptionPrice(
  admin: any,
  { subscriptionId, adminId, payable }: {
    subscriptionId: string | null;
    adminId: string;
    payable: number;
  },
): Promise<PriceVerdict> {
  try {
    if (!subscriptionId) {
      console.error(
        `Subscription push with no subscriptionId (admin ${adminId}, KES ${payable}) — refused.`,
      );
      return {
        ok: false,
        error:
          'This payment is missing its subscription reference, so its price cannot be confirmed. '
          + 'Reload the registration page and try again.',
        code: 'SUBSCRIPTION_REQUIRED',
        status: 400,
      };
    }

    const { data: sub } = await admin
      .from('company_subscriptions')
      .select('id, admin_id, max_users, plan_name')
      .eq('id', subscriptionId)
      .maybeSingle();

    if (!sub) {
      console.error(`Subscription ${subscriptionId} not found — refused.`);
      return {
        ok: false,
        error: 'That subscription no longer exists. Reload the registration page and try again.',
        code: 'SUBSCRIPTION_NOT_FOUND',
        status: 404,
      };
    }

    // Paying against somebody else's subscription is never legitimate — the
    // registration wizard is the only caller and always pays for the row it
    // just created. It could not activate their account either way
    // (settleSubscription keys off the transaction's own admin_id), but it
    // would write a bogus row into mpesa_subscription_payments.
    if (sub.admin_id !== adminId) {
      console.error(
        `Subscription ${subscriptionId} belongs to ${sub.admin_id}, not the caller ${adminId} — refused.`,
      );
      return {
        ok: false,
        error: 'That subscription belongs to another account.',
        code: 'SUBSCRIPTION_NOT_YOURS',
        status: 403,
      };
    }

    // Company and sacco catalogs share the ids 'bronze'/'silver'/'gold' with
    // different prices, so plan_name alone cannot say which one applies. The
    // presence of a saccos row for this admin is what distinguishes them, and
    // registration writes that row before it creates the subscription.
    const { data: sacco } = await admin
      .from('saccos')
      .select('id')
      .eq('admin_id', adminId)
      .maybeSingle();

    // Additional modules are part of the price now, so the check has to know
    // which ones this tenant runs. Reading them here rather than trusting a
    // posted list keeps the rule intact: the amount is verified against what
    // the account actually holds. Every module fee is 0 today, so this cannot
    // change any current total — it is what stops the check going stale the
    // day one of them is priced.
    const { data: enabledModules } = await admin
      .from('tenant_modules')
      .select('module_key')
      .eq('admin_id', adminId)
      .eq('status', 'enabled');

    const expected = expectedSubscriptionPrice({
      isSacco: Boolean(sacco),
      seats: Number(sub.max_users),
      productLine: sacco ? 'sacco' : 'company',
      modules: (enabledModules ?? []).map((m: { module_key: string }) => m.module_key),
    });

    // Only reachable when max_users is absent or below 1, which the wizard
    // never produces — so this is a malformed claim, not an unpriceable one.
    if (expected === null) {
      console.error(
        `No tier covers max_users=${sub.max_users} on subscription ${subscriptionId} — refused.`,
      );
      return {
        ok: false,
        error: 'That plan has an invalid number of seats, so its price cannot be confirmed.',
        code: 'SUBSCRIPTION_SEATS_INVALID',
        status: 400,
      };
    }

    if (expected !== payable) {
      console.error('SUBSCRIPTION PRICE MISMATCH (refused)', {
        subscriptionId,
        adminId,
        isSacco: Boolean(sacco),
        seats: sub.max_users,
        planName: sub.plan_name,
        posted: payable,
        expected,
      });
      return {
        ok: false,
        error:
          `This plan costs KES ${expected}, but KES ${payable} was submitted. `
          + 'Reload the registration page to pick up the current price.',
        code: 'SUBSCRIPTION_PRICE_MISMATCH',
        status: 400,
      };
    }

    return { ok: true };
  } catch (err) {
    // Genuinely unexpected — a service-role read failing, not anything the
    // payer chose. Let it through rather than block a real customer at the till,
    // but make it loud: this is the one path where an unpriced push still goes.
    console.error('SUBSCRIPTION PRICE CHECK FAILED OPEN:', (err as Error).message);
    return { ok: true };
  }
}

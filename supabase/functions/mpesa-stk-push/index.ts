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
  corsHeaders,
  json,
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

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

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
    // LOG ONLY, DELIBERATELY. The expected figure is recomputed server-side
    // from _shared/plans.ts, which is a third copy of pricing that already
    // lives in two frontend files (see that file). Rejecting on a mismatch
    // today would turn any drift between those copies into failed
    // registrations. So: record every mismatch, let the payment through, and
    // switch to enforcing once the logs have been clean for a while.
    if (purpose === 'subscription') {
      await auditSubscriptionPrice(admin, { subscriptionId, adminId, payable });
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
    console.error('STK push error:', err);
    return json({ error: (err as Error).message || 'Internal server error' }, 500);
  }
});

/**
 * Check what was posted against what the plan should cost, and record the
 * answer. Does NOT block the payment — see the call site.
 *
 * The seat count comes from the subscription row, which the browser also wrote,
 * and that is fine: this enforces "the price is right for what you claimed",
 * while max_users bounds what the account actually gets. Buying a 1-seat plan
 * is legitimate; buying 50 seats for the price of one is not.
 *
 * Every path here is best-effort. A failure to verify must never stop somebody
 * paying — it just means this particular push goes unchecked, and says so.
 */
async function auditSubscriptionPrice(
  admin: any,
  { subscriptionId, adminId, payable }: {
    subscriptionId: string | null;
    adminId: string;
    payable: number;
  },
): Promise<void> {
  try {
    if (!subscriptionId) {
      console.warn(
        `Subscription push with no subscriptionId (admin ${adminId}, KES ${payable}) — price not verifiable.`,
      );
      return;
    }

    const { data: sub } = await admin
      .from('company_subscriptions')
      .select('id, admin_id, max_users, plan_name')
      .eq('id', subscriptionId)
      .maybeSingle();

    if (!sub) {
      console.warn(`Subscription ${subscriptionId} not found — price not verifiable.`);
      return;
    }

    // Paying against somebody else's subscription is never legitimate. It
    // cannot currently activate their account — settleSubscription keys off the
    // transaction's own admin_id — but it does write a bogus row into
    // mpesa_subscription_payments, and it should be visible.
    if (sub.admin_id !== adminId) {
      console.error(
        `Subscription ${subscriptionId} belongs to ${sub.admin_id}, not the caller ${adminId}.`,
      );
      return;
    }

    // Company and sacco catalogs share the ids 'bronze'/'silver'/'gold' with
    // different prices, so plan_name alone cannot say which one applies. The
    // presence of a saccos row for this admin is what distinguishes them.
    const { data: sacco } = await admin
      .from('saccos')
      .select('id')
      .eq('admin_id', adminId)
      .maybeSingle();

    const expected = expectedSubscriptionPrice({
      isSacco: Boolean(sacco),
      seats: Number(sub.max_users),
    });

    if (expected === null) {
      console.warn(
        `No tier covers max_users=${sub.max_users} on subscription ${subscriptionId} — price not verifiable.`,
      );
      return;
    }

    if (expected !== payable) {
      console.error('SUBSCRIPTION PRICE MISMATCH (not enforced)', {
        subscriptionId,
        adminId,
        isSacco: Boolean(sacco),
        seats: sub.max_users,
        planName: sub.plan_name,
        posted: payable,
        expected,
      });
    }
  } catch (err) {
    console.error('Subscription price audit failed:', (err as Error).message);
  }
}

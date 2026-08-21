// Daraja STK callback receiver.
//
// This endpoint is PUBLIC (verify_jwt = false) because Safaricom sends no auth
// header of any kind — and mpesa-stk-push hands the CheckoutRequestID straight
// back to the payer's own browser. So anyone who has ever started a payment can
// POST a convincing "success" here for their own pending push.
//
// Therefore THE BODY DECIDES NOTHING. It is treated purely as a hint that a
// particular transaction is worth asking about:
//
//   1. The CheckoutRequestID must match a pending row in mpesa_transactions —
//      a row only mpesa-stk-push can create, under a signed-in user's tenant.
//   2. The outcome is then confirmed with Safaricom directly (stkpushquery),
//      using the same credentials the push went out on. Only Daraja's answer
//      settles anything.
//   3. The amount banked is always txn.amount, the figure we pushed. STK is
//      fixed-amount, so this equals what a genuine callback reports.
//
// A forged callback is now worth nothing: Daraja will say the payment never
// completed, and nothing is written.
//
// When Daraja cannot answer — "still processing", a transport failure, a rotated
// paybill — the row is deliberately LEFT PENDING and mpesa-status-query resolves
// it later. That makes the reconciler load-bearing: if it is not scheduled,
// payments whose confirmation was slow will sit unsettled. Run it every ~2
// minutes, inside the 3-minute window the client polls for.
//
// Safaricom retries callbacks, and the reconciler may run concurrently. Every
// side effect is guarded by an atomic claim on `settled_at` in _shared/
// mpesa-settle.ts, so whoever gets there first wins and the rest are no-ops.
//
// Always returns HTTP 200: a non-200 makes Safaricom retry indefinitely.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { credsForTransaction, stkQuery } from '../_shared/mpesa.ts';
import { consumeRateLimit, hashedIp } from '../_shared/http.ts';
import { settleFailure, settleSuccess } from '../_shared/mpesa-settle.ts';

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

/**
 * Confirming with Daraja costs a request against your rate limit, and this
 * endpoint is unauthenticated — so replaying one callback a thousand times must
 * not turn into a thousand Daraja calls. A genuine callback arrives once
 * (Safaricom's own retries are minutes apart), so a short window here is never
 * hit by real traffic.
 */
const QUERY_THROTTLE_MS = 10_000;

const ack = (desc = 'Accepted') =>
  new Response(JSON.stringify({ ResultCode: 0, ResultDesc: desc }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return ack('Ignored');

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const body = await req.json().catch(() => null);
    const stk = body?.Body?.stkCallback;
    if (!stk?.CheckoutRequestID) return ack('Ignored');

    const checkoutRequestId: string = stk.CheckoutRequestID;

    // ── Budget, keyed on the transaction rather than the caller ──────────────
    // This endpoint is deliberately unauthenticated: Safaricom POSTs here with
    // no credential of any kind. That rules out limiting by IP the way every
    // other function does — EVERY genuine callback in the system arrives from
    // the same handful of Safaricom addresses, so an IP budget would throttle
    // real payments under exactly the load that matters most.
    //
    // The transaction id is the honest key. Legitimate traffic sends each id a
    // small number of times (the first callback plus Safaricom's retries); a
    // replay storm sends one id endlessly. Limiting per id catches the storm
    // and cannot touch distinct real callbacks, however many arrive at once.
    const perTxn = await consumeRateLimit(
      `mpesa-callback:txn:${checkoutRequestId.slice(0, 64)}`, 20, 300,
    );
    if (!perTxn.allowed) {
      console.warn('Callback rate limit hit for CheckoutRequestID:', checkoutRequestId);
      return ack('Ignored');
    }

    const { data: txn } = await supabase
      .from('mpesa_transactions')
      .select('*')
      .eq('checkout_request_id', checkoutRequestId)
      .maybeSingle();

    // Not a payment we initiated — nothing to ask Safaricom about.
    if (!txn) {
      console.warn('Callback for unknown CheckoutRequestID:', checkoutRequestId);
      // Safaricom does not send us ids we never issued, so a caller producing
      // unknown ids is fuzzing, and here an IP budget is safe precisely because
      // real traffic never reaches this branch.
      const unknown = await consumeRateLimit(
        `mpesa-callback:unknown:${await hashedIp(req, 'mpesa-callback')}`, 20, 300,
      );
      if (!unknown.allowed) {
        console.warn('Sustained unknown-callback traffic; ignoring without lookup.');
      }
      return ack('Ignored');
    }

    if (txn.settled_at) {
      // Safaricom retry after we already applied this result.
      return ack('Already processed');
    }

    // The receipt is the one thing only the callback carries — Daraja's query
    // response does not include it. It is used solely for labelling, and only
    // once the query has independently confirmed the payment succeeded.
    const items: Array<{ Name: string; Value?: string | number }> =
      stk.CallbackMetadata?.Item ?? [];
    const field = (name: string) => items.find((i) => i.Name === name)?.Value;
    const receipt = String(field('MpesaReceiptNumber') ?? '');
    const phone = String(field('PhoneNumber') ?? txn.phone_number ?? '');

    if (txn.last_query_at && Date.now() - new Date(txn.last_query_at).getTime() < QUERY_THROTTLE_MS) {
      // Asked very recently. mpesa-status-query will carry it from here.
      return ack('Accepted');
    }

    const creds = await credsForTransaction(supabase, txn);
    if (!creds) {
      // Cannot verify, so cannot settle. Left pending on purpose — the
      // reconciler retries once credentials resolve again.
      console.error(
        `No usable credentials to verify ${checkoutRequestId} (purpose ${txn.purpose}, admin ${txn.admin_id}). Left pending.`,
      );
      return ack('Accepted');
    }

    await supabase
      .from('mpesa_transactions')
      .update({ last_query_at: new Date().toISOString() })
      .eq('checkout_request_id', checkoutRequestId);

    const outcome = await stkQuery(creds, checkoutRequestId);

    if (outcome.state === 'unknown') {
      // Commonly 500.001.1001 — the customer has not finished responding on the
      // handset. Not evidence of anything; leave it for the reconciler.
      console.info(`Daraja could not confirm ${checkoutRequestId} yet: ${outcome.reason}`);
      return ack('Accepted');
    }

    // Worth knowing about: the caller claimed one thing and Safaricom says
    // another. On a genuine callback these always agree.
    const claimedSuccess = Number(stk.ResultCode) === 0;
    if (claimedSuccess !== (outcome.state === 'success')) {
      console.error('Callback outcome contradicts Daraja', {
        checkoutRequestId,
        callbackSaid: stk.ResultCode,
        darajaSaid: outcome.resultCode,
        purpose: txn.purpose,
        adminId: txn.admin_id,
      });
    }

    if (outcome.state === 'success') {
      await settleSuccess(supabase, txn, { receipt, phone, resultDesc: outcome.resultDesc });
    } else {
      await settleFailure(supabase, txn, {
        resultCode: outcome.resultCode,
        resultDesc: outcome.resultDesc,
      });
    }

    return ack();
  } catch (err) {
    // Swallow and acknowledge: an error here must not put Safaricom into an
    // infinite retry loop. The transaction stays unsettled, and
    // mpesa-status-query picks it up.
    console.error('Callback error:', err);
    return ack('Accepted');
  }
});

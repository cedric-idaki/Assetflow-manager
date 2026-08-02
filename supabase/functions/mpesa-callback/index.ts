// Daraja STK callback receiver.
//
// This endpoint is PUBLIC (verify_jwt = false) because Safaricom sends no auth
// header of any kind. It is safe because it trusts nothing in the request body:
// the only thing it accepts is a CheckoutRequestID that matches a pending row
// in mpesa_transactions — a row that only mpesa-stk-push can create, under a
// signed-in user's tenant. A forged callback for an unknown id is ignored, and
// a forged callback for a known id can only deliver the outcome of a payment we
// ourselves initiated.
//
// Safaricom retries callbacks. Every side effect is therefore guarded by an
// atomic claim on `settled_at`, so a replayed callback is a no-op rather than a
// duplicate payment.
//
// Always returns HTTP 200: a non-200 makes Safaricom retry indefinitely.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

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
    const resultCode = Number(stk.ResultCode);
    const resultDesc: string = stk.ResultDesc ?? '';

    const { data: txn } = await supabase
      .from('mpesa_transactions')
      .select('*')
      .eq('checkout_request_id', checkoutRequestId)
      .maybeSingle();

    // Not a payment we initiated — nothing to do. This is the check that makes
    // a public endpoint acceptable.
    if (!txn) {
      console.warn('Callback for unknown CheckoutRequestID:', checkoutRequestId);
      return ack('Ignored');
    }

    if (txn.settled_at) {
      // Safaricom retry after we already applied this result.
      return ack('Already processed');
    }

    // ── Failure / cancellation ───────────────────────────────────────────────
    if (resultCode !== 0) {
      const status = resultCode === 1032 ? 'cancelled' : 'failed';
      await supabase
        .from('mpesa_transactions')
        .update({
          status,
          result_code: String(resultCode),
          result_desc: resultDesc,
          settled_at: new Date().toISOString(),
        })
        .eq('checkout_request_id', checkoutRequestId)
        .is('settled_at', null);

      if (txn.purpose === 'subscription') {
        await supabase
          .from('mpesa_subscription_payments')
          .update({ status, result_code: String(resultCode), result_desc: resultDesc })
          .eq('checkout_request_id', checkoutRequestId);
      }

      // A declined or cancelled contribution must not sit "pending" forever in
      // the member's portal — close it out with the reason Safaricom gave.
      if (txn.purpose === 'sacco_contribution' && txn.contribution_id) {
        await supabase
          .from('sacco_contributions')
          .update({
            status: 'failed',
            failure_reason: resultDesc || (status === 'cancelled' ? 'Cancelled on the phone' : 'Payment failed'),
            updated_at: new Date().toISOString(),
          })
          .eq('id', txn.contribution_id)
          .eq('status', 'pending');
      }
      return ack();
    }

    // ── Success ──────────────────────────────────────────────────────────────
    const items: Array<{ Name: string; Value?: string | number }> = stk.CallbackMetadata?.Item ?? [];
    const field = (name: string) => items.find((i) => i.Name === name)?.Value;

    const receipt = String(field('MpesaReceiptNumber') ?? '');
    const amount = Number(field('Amount') ?? txn.amount);
    const phone = String(field('PhoneNumber') ?? txn.phone_number);

    // Atomically claim this transaction. If another concurrent delivery of the
    // same callback already claimed it, `claimed` comes back empty and we skip
    // every side effect below.
    const { data: claimed } = await supabase
      .from('mpesa_transactions')
      .update({
        status: 'completed',
        mpesa_receipt_number: receipt,
        result_code: '0',
        result_desc: resultDesc,
        completed_at: new Date().toISOString(),
        settled_at: new Date().toISOString(),
      })
      .eq('checkout_request_id', checkoutRequestId)
      .is('settled_at', null)
      .select('id')
      .maybeSingle();

    if (!claimed) return ack('Already processed');

    // A 'test' push is proof the paybill works and nothing more — it must never
    // create a payment record or activate anything. Claiming it above is the
    // entire side effect.
    if (txn.purpose === 'subscription') {
      await settleSubscription(supabase, txn, { receipt, amount, resultDesc });
    } else if (txn.purpose === 'collection') {
      await settleCollection(supabase, txn, { receipt, amount, phone });
    } else if (txn.purpose === 'sacco_contribution') {
      await settleSaccoContribution(supabase, txn, { receipt, amount, phone });
    }

    return ack();
  } catch (err) {
    // Swallow and acknowledge: an error here must not put Safaricom into an
    // infinite retry loop. The transaction stays unsettled, and the
    // status-query reconciler will pick it up.
    console.error('Callback error:', err);
    return ack('Accepted');
  }
});

/** Platform subscription paid — grant the admin portal access. */
async function settleSubscription(
  supabase: any,
  txn: Record<string, any>,
  { receipt, amount, resultDesc }: { receipt: string; amount: number; resultDesc: string },
) {
  await supabase
    .from('mpesa_subscription_payments')
    .update({
      status: 'completed',
      mpesa_receipt_number: receipt,
      result_code: '0',
      result_desc: resultDesc,
      transaction_date: new Date().toISOString(),
    })
    .eq('checkout_request_id', txn.checkout_request_id);

  if (!txn.admin_id) return;

  const now = new Date();
  const end = new Date(now);
  end.setMonth(end.getMonth() + 1);

  // Activate the subscription the admin was paying for. Access gating reads
  // company_subscriptions.status, so this is what actually opens the portal.
  const { error } = await supabase
    .from('company_subscriptions')
    .update({
      status: 'active',
      price_paid: amount,
      start_date: now.toISOString(),
      end_date: end.toISOString(),
    })
    .eq('admin_id', txn.admin_id)
    .in('status', ['pending', 'expired', 'suspended']);

  if (error) console.error('Failed to activate subscription:', error.message);
}

/** Tenant collected from its own client — record the payment against them. */
async function settleCollection(
  supabase: any,
  txn: Record<string, any>,
  { receipt, amount, phone }: { receipt: string; amount: number; phone: string },
) {
  // payments.transaction_id is UNIQUE, so a duplicate here is rejected by the
  // database rather than silently double-crediting the client. We surface the
  // error instead of ignoring the insert result.
  const { error } = await supabase.from('payments').insert({
    client_id: txn.client_id,
    admin_id: txn.admin_id,
    amount,
    payment_method: 'mpesa',
    payment_status: 'completed',
    transaction_id: receipt,
    reference_number: receipt,
    payment_date: new Date().toISOString(),
    notes: `M-Pesa payment from ${phone}. Ref: ${receipt}`,
  });

  if (error && !/duplicate key/i.test(error.message)) {
    console.error('Failed to record payment:', error.message);
  }

  if (txn.charge_id) {
    await supabase
      .from('installment_charges')
      .update({ charge_status: 'paid', paid_date: new Date().toISOString() })
      .eq('id', txn.charge_id);
  }
}

/**
 * Sacco member paid their contribution from the member portal.
 *
 * The row already exists as 'pending' — mpesa-stk-push refuses to push without
 * one — so this only has to complete it. That is deliberate: it means the money
 * is matched to a member, an account and a contribution type that were decided
 * before the payment, rather than being guessed from the callback.
 *
 * Duplicate protection is layered:
 *   1. `settled_at` on the transaction, claimed atomically by the caller above,
 *      makes a replayed callback a no-op.
 *   2. `.eq('status', 'pending')` means only the first update can settle it.
 *   3. A partial unique index on (admin_id, upper(reference)) for M-Pesa rows
 *      makes the same receipt landing on a second contribution a hard error.
 */
async function settleSaccoContribution(
  supabase: any,
  txn: Record<string, any>,
  { receipt, amount, phone }: { receipt: string; amount: number; phone: string },
) {
  if (!txn.contribution_id) {
    console.error('sacco_contribution callback with no contribution_id:', txn.checkout_request_id);
    return;
  }

  const now = new Date().toISOString();
  const { data: settled, error } = await supabase
    .from('sacco_contributions')
    .update({
      status: 'completed',
      amount,
      payment_method: 'mpesa',
      channel: 'mpesa_auto',
      reference: receipt,
      paid_at: now,
      paid_date: now.slice(0, 10),
      mpesa_transaction_id: txn.id,
      notes: `M-Pesa ${receipt} from ${phone}`,
      updated_at: now,
    })
    .eq('id', txn.contribution_id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();

  if (error) {
    // The duplicate-receipt index firing here means Safaricom sent us a receipt
    // we have already banked against another contribution. Leave the row
    // pending for a human rather than crediting the member twice.
    console.error('Failed to settle sacco contribution:', error.message);
    return;
  }
  if (!settled) {
    console.warn('Sacco contribution was no longer pending:', txn.contribution_id);
  }
}

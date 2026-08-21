// What happens to the books once a push has a confirmed outcome.
//
// Two callers reach this module and they must behave identically:
//   * mpesa-callback     — Safaricom told us, and we confirmed it with Daraja.
//   * mpesa-status-query — nobody told us, so we asked Daraja ourselves.
//
// Keeping one implementation is the point. Two copies of "credit the member"
// drift, and the drift is only discovered when the two disagree about somebody's
// money.
//
// NOTHING HERE VERIFIES ANYTHING. Callers must already hold an authoritative
// outcome from stkQuery before calling settle(); this module assumes that
// question is settled and only writes the consequences.

/** Daraja result codes that mean something other than a plain failure. */
export function failureStatus(resultCode: string | number): 'cancelled' | 'timeout' | 'failed' {
  const code = String(resultCode);
  if (code === '1032') return 'cancelled'; // declined on the handset
  if (code === '1037') return 'timeout'; // handset never responded
  return 'failed';
}

/**
 * Close out a push that did not succeed.
 *
 * Guarded by the same `settled_at` claim as the success path, so a replayed
 * callback and the reconciler cannot both write it.
 */
export async function settleFailure(
  supabase: any,
  txn: Record<string, any>,
  { resultCode, resultDesc }: { resultCode: string; resultDesc: string },
): Promise<void> {
  const status = failureStatus(resultCode);

  const { data: claimed } = await supabase
    .from('mpesa_transactions')
    .update({
      status,
      result_code: String(resultCode),
      result_desc: resultDesc,
      settled_at: new Date().toISOString(),
    })
    .eq('checkout_request_id', txn.checkout_request_id)
    .is('settled_at', null)
    .select('id')
    .maybeSingle();

  if (!claimed) return;

  if (txn.purpose === 'subscription') {
    await supabase
      .from('mpesa_subscription_payments')
      .update({ status, result_code: String(resultCode), result_desc: resultDesc })
      .eq('checkout_request_id', txn.checkout_request_id);
  }

  // A declined or cancelled contribution must not sit "pending" forever in the
  // member's portal — close it out with the reason Safaricom gave.
  if (txn.purpose === 'sacco_contribution' && txn.contribution_id) {
    await supabase
      .from('sacco_contributions')
      .update({
        status: 'failed',
        failure_reason:
          resultDesc || (status === 'cancelled' ? 'Cancelled on the phone' : 'Payment failed'),
        updated_at: new Date().toISOString(),
      })
      .eq('id', txn.contribution_id)
      .eq('status', 'pending');
  }
}

/**
 * Bank a confirmed successful push.
 *
 * The amount is ALWAYS txn.amount — the figure we pushed — never anything a
 * caller passes in. STK is fixed-amount: Daraja charges exactly what was
 * requested, so this is the same number a genuine callback reports, and using
 * ours means a forged one cannot inflate it.
 *
 * Returns true if this call is the one that claimed the transaction. A false
 * return means somebody else got there first and no side effects were applied.
 */
export async function settleSuccess(
  supabase: any,
  txn: Record<string, any>,
  { receipt, phone, resultDesc }: { receipt: string; phone: string; resultDesc: string },
): Promise<boolean> {
  const amount = Number(txn.amount);
  const now = new Date().toISOString();

  // Daraja's stkpushquery does NOT return the M-Pesa receipt — only the result
  // code — so a payment confirmed by the reconciler arrives here with no
  // receipt at all. It still has to be banked: Safaricom has confirmed the money
  // moved. Fall back to a reference derived from the CheckoutRequestID so the
  // row is unique (payments.transaction_id is UNIQUE, and '' would collide
  // across every such payment) and still traceable back to a Safaricom
  // statement line by a human.
  const reference = receipt || `STK-${txn.checkout_request_id}`;

  // Atomically claim. If a concurrent callback or reconciler pass already
  // claimed it, `claimed` comes back empty and every side effect below is
  // skipped.
  const { data: claimed } = await supabase
    .from('mpesa_transactions')
    .update({
      status: 'completed',
      mpesa_receipt_number: receipt || null,
      result_code: '0',
      result_desc: resultDesc,
      completed_at: now,
      settled_at: now,
    })
    .eq('checkout_request_id', txn.checkout_request_id)
    .is('settled_at', null)
    .select('id')
    .maybeSingle();

  if (!claimed) return false;

  // A 'test' push is proof the paybill works and nothing more — it must never
  // create a payment record or activate anything. Claiming it above is the
  // entire side effect.
  if (txn.purpose === 'subscription') {
    await settleSubscription(supabase, txn, { receipt: reference, amount, resultDesc });
  } else if (txn.purpose === 'collection') {
    await settleCollection(supabase, txn, { receipt: reference, amount, phone });
  } else if (txn.purpose === 'sacco_contribution') {
    await settleSaccoContribution(supabase, txn, { receipt: reference, amount, phone });
  }

  return true;
}

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

  // The customer paid for portal access and did not get it. Same class of
  // failure as an unrecorded payment: confirmed money, no delivery, no retry.
  if (error) {
    await reportUnbankedMoney(supabase, txn, {
      kind: 'subscription_not_activated',
      summary: 'SUBSCRIPTION PAID BUT NOT ACTIVATED — the admin was charged and the portal stayed shut',
      reason: error.message,
      receipt,
      amount,
    });
  }
}

/** Tenant collected from its own client — record the payment against them. */
async function settleCollection(
  supabase: any,
  txn: Record<string, any>,
  { receipt, amount, phone }: { receipt: string; amount: number; phone: string },
) {
  // payments.transaction_id is UNIQUE, so a duplicate here is rejected by the
  // database rather than silently double-crediting the client.
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
    // The transaction is already claimed, so nothing will retry this. Money has
    // been taken and there is no payments row for it — that needs a human.
    await reportUnbankedMoney(supabase, txn, {
      kind: 'unrecorded_payment',
      summary: 'UNRECORDED M-PESA PAYMENT — money received but no payment record was created',
      reason: error.message,
      receipt,
      amount,
    });
  }

  if (txn.charge_id) {
    const { error: chargeErr } = await supabase
      .from('installment_charges')
      .update({ charge_status: 'paid', paid_date: new Date().toISOString() })
      .eq('id', txn.charge_id);

    if (chargeErr) {
      await reportUnbankedMoney(supabase, txn, {
        kind: 'installment_charge_not_closed',
        summary: `Payment banked but installment charge ${txn.charge_id} was not marked paid`,
        reason: chargeErr.message,
        receipt,
        amount,
      });
    }
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
 *   1. `settled_at` on the transaction, claimed atomically by settleSuccess,
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
    // mpesa-stk-push refuses to push a contribution without one, so reaching
    // here means the transaction row lost it — the member has paid and there is
    // nothing to credit it to.
    await reportUnbankedMoney(supabase, txn, {
      kind: 'contribution_unlinked',
      summary: 'SACCO CONTRIBUTION PAID BUT UNLINKED — the transaction carries no contribution_id',
      reason: 'txn.contribution_id is null',
      receipt,
      amount,
    });
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
    // pending rather than crediting the member twice — and tell the human whose
    // job it is to reconcile it, because the member's money has already moved.
    await reportUnbankedMoney(supabase, txn, {
      kind: 'contribution_not_settled',
      summary: `SACCO CONTRIBUTION PAID BUT NOT CREDITED — contribution ${txn.contribution_id} is still pending`,
      reason: error.message,
      receipt,
      amount,
    });
    return;
  }
  if (!settled) {
    console.warn('Sacco contribution was no longer pending:', txn.contribution_id);
  }
}

/**
 * A customer's money moved but the books did not follow.
 *
 * Every caller of this is a path where Safaricom has confirmed the payment and
 * `settled_at` is already claimed, so nothing will retry on its own. Until now
 * the only trace was a console.error in the function logs, which nobody reads
 * until a customer complains — by which time the receipt is hard to match.
 *
 * So write it somewhere a human actually looks:
 *   * `audit_logs`, scoped to the tenant's admin_id, severity 'critical' — this
 *     is the one the affected admin can see in their own Audit Trail.
 *   * `payment_alerts_log`, the payments-domain ops log.
 *
 * Each write is independent and best-effort: this function runs at the exact
 * moment something has already gone wrong, so it must never throw and must
 * never let one failed insert hide the other. The console.error stays as the
 * last resort if both tables are unreachable.
 */
async function reportUnbankedMoney(
  supabase: any,
  txn: Record<string, any>,
  { kind, summary, reason, receipt, amount }: {
    kind: string;
    summary: string;
    reason: string;
    receipt: string;
    amount: number;
  },
): Promise<void> {
  console.error(
    `${summary} — receipt ${receipt || '(none)'}, KES ${amount}, purpose ${txn.purpose}, `
    + `checkout ${txn.checkout_request_id}, client ${txn.client_id ?? '-'}, admin ${txn.admin_id ?? '-'}: ${reason}`,
  );

  const detail = {
    kind,
    reason,
    receipt: receipt || null,
    amount,
    purpose: txn.purpose ?? null,
    checkout_request_id: txn.checkout_request_id ?? null,
    client_id: txn.client_id ?? null,
    admin_id: txn.admin_id ?? null,
    phone_number: txn.phone_number ?? null,
    occurred_at: new Date().toISOString(),
  };

  try {
    await supabase.from('audit_logs').insert({
      action: 'create',
      admin_id: txn.admin_id ?? null,
      client_id: txn.client_id ?? null,
      table_name: 'mpesa_transactions',
      record_id: txn.id ?? null,
      severity: 'critical',
      change_type: kind,
      description: `${summary}. M-Pesa receipt ${receipt || '(none)'}, KES ${amount}. ${reason}`,
      metadata: detail,
    });
  } catch (err) {
    console.error(`Could not write the audit record for ${kind}: ${(err as Error).message}`);
  }

  try {
    await supabase.from('payment_alerts_log').insert({
      alert_type: 'settlement_failure',
      event_type: kind,
      amount,
      transaction_id: txn.checkout_request_id ?? null,
      recipient_phone: txn.phone_number ?? null,
      subject: summary,
      message: `${summary}. M-Pesa receipt ${receipt || '(none)'}, KES ${amount}.`,
      error_message: reason,
      metadata: detail,
    });
  } catch (err) {
    console.error(`Could not write the payment alert for ${kind}: ${(err as Error).message}`);
  }
}

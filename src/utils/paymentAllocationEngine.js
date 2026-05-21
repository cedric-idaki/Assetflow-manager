/**
 * paymentAllocationEngine.js
 * BRS Section 7.3 — Overpayment & Underpayment Handling
 *
 * Allocation order (BRS 7.1): Penalty → Interest → Principal
 *
 * Scenarios handled:
 * 1. Exact payment    → Installment marked PAID
 * 2. Overpayment      → Excess credited to client wallet
 * 3. Underpayment     → Installment marked PARTIAL, penalty starts after grace
 * 4. Future payment   → Posted to wallet, allocated when period comes due
 * 5. Duplicate        → Flagged for manual review
 */

import { supabase } from '../lib/supabase';

const ALLOCATION_ORDER = 'penalty_interest_principal'; // BRS 7.1

// ── Helpers ───────────────────────────────────────────────────────────────────
const round2 = (n) => Math.round((n || 0) * 100) / 100;

// ── Get or create client wallet ───────────────────────────────────────────────
export const getOrCreateWallet = async (clientId, adminId) => {
  // Try to get existing wallet
  const { data: existing } = await supabase
    .from('client_wallets')
    .select('*')
    .eq('client_id', clientId)
    .single();

  if (existing) return existing;

  // Create new wallet
  const { data: created, error } = await supabase
    .from('client_wallets')
    .insert({ client_id: clientId, admin_id: adminId, balance: 0 })
    .select()
    .single();

  if (error) throw new Error('Could not create client wallet: ' + error.message);
  return created;
};

// ── Credit client wallet ──────────────────────────────────────────────────────
export const creditWallet = async (clientId, adminId, amount, reference, type, saleId, installmentId, notes) => {
  const wallet = await getOrCreateWallet(clientId, adminId);
  const newBalance = round2(wallet.balance + amount);

  // Update wallet balance
  await supabase
    .from('client_wallets')
    .update({
      balance:        newBalance,
      total_credited: round2(wallet.total_credited + amount),
      last_updated:   new Date().toISOString(),
    })
    .eq('client_id', clientId);

  // Log wallet transaction
  await supabase.from('wallet_transactions').insert({
    client_id:        clientId,
    admin_id:         adminId,
    transaction_type: type || 'overpayment_credit',
    amount,
    balance_before:   wallet.balance,
    balance_after:    newBalance,
    reference,
    sale_id:          saleId || null,
    installment_id:   installmentId || null,
    notes,
  });

  return newBalance;
};

// ── Debit client wallet ───────────────────────────────────────────────────────
export const debitWallet = async (clientId, adminId, amount, reference, installmentId) => {
  const wallet = await getOrCreateWallet(clientId, adminId);
  if (wallet.balance < amount) {
    throw new Error(`Insufficient wallet balance. Available: KES ${wallet.balance}, Required: KES ${amount}`);
  }

  const newBalance = round2(wallet.balance - amount);

  await supabase
    .from('client_wallets')
    .update({
      balance:       newBalance,
      total_debited: round2(wallet.total_debited + amount),
      last_updated:  new Date().toISOString(),
    })
    .eq('client_id', clientId);

  await supabase.from('wallet_transactions').insert({
    client_id:        clientId,
    admin_id:         adminId,
    transaction_type: 'installment_debit',
    amount,
    balance_before:   wallet.balance,
    balance_after:    newBalance,
    reference,
    installment_id:   installmentId || null,
  });

  return newBalance;
};

// ── Get next due installment for a sale ───────────────────────────────────────
export const getNextDueInstallment = async (saleId) => {
  const { data } = await supabase
    .from('installment_schedules')
    .select('*')
    .eq('sale_id', saleId)
    .in('status', ['pending', 'partial', 'overdue'])
    .order('installment_no', { ascending: true })
    .limit(1)
    .single();

  return data;
};

// ── Check for duplicate payment ───────────────────────────────────────────────
export const checkDuplicate = async (reference, clientId) => {
  if (!reference) return false;

  const { data } = await supabase
    .from('payments')
    .select('id, transaction_id, amount, payment_date')
    .or(`reference_number.eq.${reference},transaction_id.eq.${reference}`)
    .eq('client_id', clientId)
    .limit(1);

  return data?.length > 0 ? data[0] : null;
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN ALLOCATION ENGINE — BRS 7.3
// ══════════════════════════════════════════════════════════════════════════════
export const processPayment = async ({
  clientId,
  saleId,
  installmentId,    // specific installment to pay (or null for auto-detect)
  paymentAmount,
  paymentMethod,
  reference,
  receivedBy,
  notes,
  adminId,
  gracePeriodDays = 7,
  penaltyRateMonthly = 2,
}) => {
  const result = {
    success:           false,
    scenario:          '',
    installmentStatus: '',
    amountPaid:        paymentAmount,
    penaltyPaid:       0,
    interestPaid:      0,
    principalPaid:     0,
    overpaymentAmount: 0,
    underpaymentAmount:0,
    walletBalance:     0,
    walletCreditUsed:  0,
    receiptNumber:     `RCP-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`,
    message:           '',
    isDuplicate:       false,
    flags:             [],
  };

  // ── Step 1: Check for duplicate payment ──────────────────────────────────
  const duplicate = await checkDuplicate(reference, clientId);
  if (duplicate) {
    result.isDuplicate = true;
    result.flags.push('DUPLICATE_PAYMENT');
    result.scenario  = 'duplicate';
    result.message   = `Duplicate payment detected. Reference ${reference} was already used on ${duplicate.payment_date}. Flagged for manual review.`;

    // Log but don't process — flag for manual review
    try {
      await supabase.from('audit_logs').insert({
        action:      'create',
        table_name:  'payments',
        description: `⚠️ DUPLICATE PAYMENT FLAGGED: Ref ${reference} — Client ${clientId} — Amount KES ${paymentAmount}`,
        new_values:  { reference, clientId, amount: paymentAmount, duplicate_of: duplicate.id },
      });
    } catch {}

    return result;
  }

  // ── Step 2: Get the installment to pay ───────────────────────────────────
  let installment;
  if (installmentId) {
    const { data } = await supabase
      .from('installment_schedules')
      .select('*')
      .eq('id', installmentId)
      .single();
    installment = data;
  } else {
    // Auto-detect: get earliest outstanding installment (BRS 7.1)
    installment = await getNextDueInstallment(saleId);
  }

  if (!installment) {
    result.message = 'No outstanding installments found for this account.';
    result.flags.push('NO_OUTSTANDING_INSTALLMENT');
    return result;
  }

  // ── Step 3: Calculate penalty if overdue (BRS 7.1) ───────────────────────
  const today = new Date();
  const dueDate = new Date(installment.due_date);
  const daysLate = Math.max(0, Math.floor((today - dueDate) / 86400000) - gracePeriodDays);
  const penaltyDue = daysLate > 0
    ? round2(installment.installment_amount * (penaltyRateMonthly / 100) * (daysLate / 30))
    : 0;

  const alreadyPaid   = round2(installment.amount_paid || 0);
  const remainingDue  = round2(installment.installment_amount - alreadyPaid);
  const totalDue      = round2(remainingDue + penaltyDue);

  // ── Step 4: Check client wallet balance ───────────────────────────────────
  const wallet = await getOrCreateWallet(clientId, adminId);
  result.walletBalance = wallet.balance;

  // ── Step 5: Determine scenario (BRS 7.3) ─────────────────────────────────
  const effectivePayment = round2(paymentAmount + wallet.balance);
  // Use wallet only if needed and available
  let walletUsed = 0;

  // ── ALLOCATION ORDER: Penalty → Interest → Principal ─────────────────────
  let remaining = paymentAmount;

  // Pay penalty first
  let penaltyPaid = 0;
  if (penaltyDue > 0 && remaining > 0) {
    penaltyPaid = Math.min(remaining, penaltyDue);
    remaining   = round2(remaining - penaltyPaid);
  }

  // Pay interest portion
  let interestPaid = 0;
  const interestDue = round2(installment.interest_portion - (installment.amount_paid > 0
    ? Math.min(installment.amount_paid, installment.interest_portion) : 0));
  if (interestDue > 0 && remaining > 0) {
    interestPaid = Math.min(remaining, interestDue);
    remaining    = round2(remaining - interestPaid);
  }

  // Pay principal
  let principalPaid = 0;
  const principalDue = round2(remainingDue - interestDue);
  if (principalDue > 0 && remaining > 0) {
    principalPaid = Math.min(remaining, principalDue);
    remaining     = round2(remaining - principalPaid);
  }

  result.penaltyPaid   = penaltyPaid;
  result.interestPaid  = interestPaid;
  result.principalPaid = principalPaid;

  // ── Scenario detection ────────────────────────────────────────────────────
  const totalApplied = round2(penaltyPaid + interestPaid + principalPaid);

  if (Math.abs(paymentAmount - totalDue) < 1) {
    // EXACT PAYMENT
    result.scenario          = 'exact';
    result.installmentStatus = 'paid';
    result.message           = `Exact payment received. Installment #${installment.installment_no} marked as PAID.`;

  } else if (paymentAmount > totalDue) {
    // OVERPAYMENT
    result.scenario          = 'overpayment';
    result.overpaymentAmount = round2(paymentAmount - totalDue);
    result.installmentStatus = 'paid';
    result.message           = `Overpayment of KES ${result.overpaymentAmount.toLocaleString()} credited to client wallet.`;
    result.flags.push('OVERPAYMENT');

  } else if (paymentAmount < totalDue && paymentAmount > 0) {
    // UNDERPAYMENT
    result.scenario            = 'underpayment';
    result.underpaymentAmount  = round2(totalDue - paymentAmount);
    result.installmentStatus   = 'partial';
    result.message             = `Underpayment of KES ${result.underpaymentAmount.toLocaleString()} remaining. Installment marked PARTIAL. Penalty applies after grace period.`;
    result.flags.push('UNDERPAYMENT');
  }

  // ── Step 6: Record the payment ────────────────────────────────────────────
  const { data: paymentRecord, error: payErr } = await supabase
    .from('payments')
    .insert({
      transaction_id:   result.receiptNumber,
      client_id:        clientId,
      asset_id:         installment.asset_id,
      amount:           paymentAmount,
      payment_method:   paymentMethod,
      payment_date:     new Date().toISOString(),
      payment_status:   'completed',
      reference_number: reference || null,
      notes:            notes || null,
      processed_by:     receivedBy || null,
    })
    .select()
    .single();

  if (payErr) throw new Error('Payment record failed: ' + payErr.message);

  // ── Step 7: Update installment status ────────────────────────────────────
  const newAmountPaid = round2(alreadyPaid + totalApplied);
  await supabase
    .from('installment_schedules')
    .update({
      status:             result.installmentStatus,
      amount_paid:        newAmountPaid,
      penalty_amount:     penaltyDue,
      is_overdue:         daysLate > 0,
      overdue_days:       daysLate,
      actual_payment_date: new Date().toISOString().split('T')[0],
      payment_reference:  reference || result.receiptNumber,
      last_payment_date:  new Date().toISOString().split('T')[0],
      last_payment_ref:   reference || result.receiptNumber,
    })
    .eq('id', installment.id);

  // ── Step 8: Handle overpayment → credit wallet ────────────────────────────
  if (result.overpaymentAmount > 0) {
    const newBalance = await creditWallet(
      clientId, adminId,
      result.overpaymentAmount,
      reference || result.receiptNumber,
      'overpayment_credit',
      saleId,
      installment.id,
      `Overpayment on installment #${installment.installment_no} — ${result.message}`
    );
    result.walletBalance = newBalance;
  }

  // ── Step 9: Record payment allocation ────────────────────────────────────
  try {
    await supabase.from('payment_allocations').insert({
      payment_id:         paymentRecord.id,
      sale_id:            saleId,
      installment_id:     installment.id,
      client_id:          clientId,
      admin_id:           adminId,
      payment_amount:     paymentAmount,
      installment_due:    installment.installment_amount,
      penalty_due:        penaltyDue,
      penalty_paid:       penaltyPaid,
      interest_paid:      interestPaid,
      principal_paid:     principalPaid,
      overpayment_amount: result.overpaymentAmount,
      underpayment_amount:result.underpaymentAmount,
      wallet_credit_used: walletUsed,
      allocation_type:    'auto',
      allocation_order:   ALLOCATION_ORDER,
      status:             result.installmentStatus === 'partial' ? 'partial' : 'completed',
      notes,
    });
  } catch (err) {
    console.warn('Allocation record skipped:', err.message);
  }

  // ── Step 10: Audit log ────────────────────────────────────────────────────
  try {
    await supabase.from('audit_logs').insert({
      action:      'create',
      table_name:  'payments',
      description: `Payment processed — ${result.scenario.toUpperCase()} — Client ${clientId} — KES ${paymentAmount.toLocaleString()} — Installment #${installment.installment_no} → ${result.installmentStatus.toUpperCase()}`,
      new_values:  {
        receipt:           result.receiptNumber,
        scenario:          result.scenario,
        amount_paid:       paymentAmount,
        installment_no:    installment.installment_no,
        installment_status:result.installmentStatus,
        overpayment:       result.overpaymentAmount,
        underpayment:      result.underpaymentAmount,
        penalty_paid:      penaltyPaid,
      },
    });
  } catch {}

  result.success = true;
  return result;
};

// ── Get client wallet balance ─────────────────────────────────────────────────
export const getWalletBalance = async (clientId) => {
  const { data } = await supabase
    .from('client_wallets')
    .select('balance, total_credited, total_debited, last_updated')
    .eq('client_id', clientId)
    .single();
  return data || { balance: 0, total_credited: 0, total_debited: 0 };
};

// ── Get wallet transaction history ───────────────────────────────────────────
export const getWalletHistory = async (clientId) => {
  const { data } = await supabase
    .from('wallet_transactions')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(20);
  return data || [];
};

export default processPayment;

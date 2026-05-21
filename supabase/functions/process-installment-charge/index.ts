import Stripe from 'https://esm.sh/stripe@14.21.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addInterval(date: Date, frequency: string): Date {
  const d = new Date(date);
  switch (frequency) {
    case 'weekly':    d.setDate(d.getDate() + 7); break;
    case 'biweekly':  d.setDate(d.getDate() + 14); break;
    case 'monthly':   d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    default:          d.setMonth(d.getMonth() + 1);
  }
  return d;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2024-06-20',
    });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { chargeId, planId, paymentMethodId } = await req.json();

    if (!chargeId && !planId) {
      return new Response(
        JSON.stringify({ error: 'chargeId or planId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch the charge record
    let chargeQuery = supabase.from('installment_charges').select('*, installment_plans(*)');
    if (chargeId) {
      chargeQuery = chargeQuery.eq('id', chargeId);
    } else {
      // Process next due charge for the plan
      chargeQuery = chargeQuery
        .eq('plan_id', planId)
        .in('charge_status', ['scheduled', 'retrying'])
        .lte('scheduled_date', new Date().toISOString().split('T')[0])
        .order('installment_number', { ascending: true })
        .limit(1);
    }

    const { data: charges, error: fetchError } = await chargeQuery;
    if (fetchError || !charges || charges.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No eligible charge found', details: fetchError?.message }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const charge = charges[0];
    const plan = charge.installment_plans;

    if (!plan) {
      return new Response(
        JSON.stringify({ error: 'Installment plan not found for this charge' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (plan.plan_status === 'cancelled' || plan.plan_status === 'completed') {
      return new Response(
        JSON.stringify({ error: `Plan is ${plan.plan_status}, cannot process charge` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mark charge as processing
    await supabase
      .from('installment_charges')
      .update({ charge_status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', charge.id);

    // Determine payment method: use provided, or plan's saved method
    const pmId = paymentMethodId || plan.stripe_payment_method_id;

    let paymentIntent: Stripe.PaymentIntent;
    let chargeSucceeded = false;
    let failureReason = '';

    try {
      if (pmId) {
        // Off-session charge with saved payment method
        paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(charge.amount * 100),
          currency: plan.currency || 'usd',
          customer: plan.stripe_customer_id,
          payment_method: pmId,
          confirm: true,
          off_session: true,
          description: `${plan.plan_name} — Installment ${charge.installment_number} of ${plan.total_installments}`,
          metadata: {
            plan_id: plan.id,
            charge_id: charge.id,
            client_id: plan.client_id || '',
            installment_number: String(charge.installment_number),
          },
        });
        chargeSucceeded = paymentIntent.status === 'succeeded';
        if (!chargeSucceeded) {
          failureReason = `PaymentIntent status: ${paymentIntent.status}`;
        }
      } else {
        // No saved payment method — create a PaymentIntent requiring client confirmation
        paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(charge.amount * 100),
          currency: plan.currency || 'usd',
          customer: plan.stripe_customer_id,
          description: `${plan.plan_name} — Installment ${charge.installment_number} of ${plan.total_installments}`,
          metadata: {
            plan_id: plan.id,
            charge_id: charge.id,
            client_id: plan.client_id || '',
            installment_number: String(charge.installment_number),
          },
        });
        // Return client_secret for frontend confirmation
        await supabase
          .from('installment_charges')
          .update({
            charge_status: 'scheduled',
            payment_intent_id: paymentIntent.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', charge.id);

        return new Response(
          JSON.stringify({
            success: false,
            requiresAction: true,
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
            chargeId: charge.id,
            message: 'Payment method required — use clientSecret to confirm payment',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch (stripeError: any) {
      chargeSucceeded = false;
      failureReason = stripeError?.message || 'Stripe charge failed';
      paymentIntent = { id: `pi_failed_${Date.now()}` } as any;
    }

    const now = new Date();

    if (chargeSucceeded) {
      // Create a payment record in the payments table
      const transactionId = `TXN-INST-${Date.now()}`;
      const { data: paymentRecord } = await supabase
        .from('payments')
        .insert({
          transaction_id: transactionId,
          client_id: plan.client_id || null,
          asset_id: plan.asset_id || null,
          amount: charge.amount,
          payment_method: 'card',
          payment_status: 'completed',
          payment_intent_id: paymentIntent.id,
          stripe_customer_id: plan.stripe_customer_id,
          stripe_charge_id: (paymentIntent as any).latest_charge || null,
          installment_plan_id: plan.id,
          installment_number: charge.installment_number,
          notes: `Installment ${charge.installment_number}/${plan.total_installments} — ${plan.plan_name}`,
          payment_date: now.toISOString(),
        })
        .select()
        .single();

      // Update charge record
      await supabase
        .from('installment_charges')
        .update({
          charge_status: 'succeeded',
          payment_intent_id: paymentIntent.id,
          stripe_charge_id: (paymentIntent as any).latest_charge || null,
          payment_id: paymentRecord?.id || null,
          charged_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq('id', charge.id);

      // Update plan: increment installments_paid, set next_charge_date
      const newInstallmentsPaid = (plan.installments_paid || 0) + 1;
      const isCompleted = newInstallmentsPaid >= plan.total_installments;
      const nextChargeDate = isCompleted
        ? null
        : addInterval(new Date(charge.scheduled_date), plan.frequency).toISOString().split('T')[0];

      await supabase
        .from('installment_plans')
        .update({
          installments_paid: newInstallmentsPaid,
          next_charge_date: nextChargeDate,
          plan_status: isCompleted ? 'completed' : 'active',
          retry_count: 0,
          updated_at: now.toISOString(),
        })
        .eq('id', plan.id);

      // Audit log
      await supabase.from('audit_logs').insert({
        action: 'create',
        table_name: 'payments',
        record_id: paymentRecord?.id || null,
        description: `Installment charge succeeded: ${plan.plan_name} #${charge.installment_number} — $${charge.amount}`,
        severity: 'info',
        new_values: { plan_id: plan.id, charge_id: charge.id, payment_intent_id: paymentIntent.id },
      });

      return new Response(
        JSON.stringify({
          success: true,
          chargeStatus: 'succeeded',
          paymentIntentId: paymentIntent.id,
          paymentRecord,
          isCompleted,
          nextChargeDate,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      // Handle failure with retry logic
      const currentRetry = (charge.retry_attempt || 0) + 1;
      const maxRetries = plan.max_retries || 3;
      const retryIntervalDays = plan.retry_interval_days || 3;
      const canRetry = currentRetry <= maxRetries;
      const nextRetryDate = canRetry
        ? addDays(now, retryIntervalDays).toISOString().split('T')[0]
        : null;

      await supabase
        .from('installment_charges')
        .update({
          charge_status: canRetry ? 'retrying' : 'failed',
          payment_intent_id: paymentIntent.id,
          failure_reason: failureReason,
          retry_attempt: currentRetry,
          next_retry_date: nextRetryDate,
          updated_at: now.toISOString(),
        })
        .eq('id', charge.id);

      // Update plan retry count; mark failed if exhausted
      const newRetryCount = (plan.retry_count || 0) + 1;
      const planFailed = !canRetry;

      await supabase
        .from('installment_plans')
        .update({
          retry_count: newRetryCount,
          plan_status: planFailed ? 'failed' : 'active',
          updated_at: now.toISOString(),
        })
        .eq('id', plan.id);

      // Audit log
      await supabase.from('audit_logs').insert({
        action: 'update',
        table_name: 'installment_charges',
        record_id: charge.id,
        description: `Installment charge failed: ${plan.plan_name} #${charge.installment_number} — ${failureReason}. Retry ${currentRetry}/${maxRetries}`,
        severity: 'warning',
        new_values: { plan_id: plan.id, charge_id: charge.id, failure_reason: failureReason, retry_attempt: currentRetry },
      });

      return new Response(
        JSON.stringify({
          success: false,
          chargeStatus: canRetry ? 'retrying' : 'failed',
          failureReason,
          retryAttempt: currentRetry,
          maxRetries,
          nextRetryDate,
          planFailed,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('Process installment charge error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to process installment charge' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

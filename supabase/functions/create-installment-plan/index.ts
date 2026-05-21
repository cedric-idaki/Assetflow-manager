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

    const body = await req.json();
    const { planData, customerInfo } = body;

    // Validate required fields
    if (!planData?.totalAmount || planData.totalAmount <= 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid total amount' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (!planData?.totalInstallments || planData.totalInstallments < 1) {
      return new Response(
        JSON.stringify({ error: 'Invalid number of installments' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const installmentAmount = Math.round((planData.totalAmount / planData.totalInstallments) * 100) / 100;

    // Create or retrieve Stripe customer
    let stripeCustomer: Stripe.Customer;
    if (customerInfo?.stripeCustomerId) {
      stripeCustomer = await stripe.customers.update(customerInfo.stripeCustomerId, {
        email: customerInfo.email,
        name: `${customerInfo.firstName || ''} ${customerInfo.lastName || ''}`.trim() || undefined,
        metadata: { clientId: planData.clientId || '', userId: customerInfo.userId || 'guest' },
      }) as Stripe.Customer;
    } else {
      stripeCustomer = await stripe.customers.create({
        email: customerInfo?.email,
        name: `${customerInfo?.firstName || ''} ${customerInfo?.lastName || ''}`.trim() || undefined,
        metadata: { clientId: planData.clientId || '', userId: customerInfo?.userId || 'guest' },
      });
    }

    // Calculate start date and generate schedule
    const startDate = planData.startDate ? new Date(planData.startDate) : new Date();
    const frequency = planData.frequency || 'monthly';
    const totalInstallments = planData.totalInstallments;

    // Build charge schedule dates
    const scheduleDates: string[] = [];
    let currentDate = new Date(startDate);
    for (let i = 0; i < totalInstallments; i++) {
      scheduleDates.push(currentDate.toISOString().split('T')[0]);
      currentDate = addInterval(currentDate, frequency);
    }

    const nextChargeDate = scheduleDates[0];
    const endDate = scheduleDates[scheduleDates.length - 1];

    // Save installment plan to DB
    const { data: plan, error: planError } = await supabase
      .from('installment_plans')
      .insert({
        client_id: planData.clientId || null,
        asset_id: planData.assetId || null,
        plan_name: planData.planName || `${frequency} Installment Plan`,
        total_amount: planData.totalAmount,
        installment_amount: installmentAmount,
        total_installments: totalInstallments,
        installments_paid: 0,
        frequency,
        start_date: startDate.toISOString().split('T')[0],
        next_charge_date: nextChargeDate,
        end_date: endDate,
        stripe_customer_id: stripeCustomer.id,
        plan_status: 'active',
        max_retries: planData.maxRetries ?? 3,
        retry_interval_days: planData.retryIntervalDays ?? 3,
        currency: planData.currency || 'usd',
        notes: planData.notes || null,
        created_by: customerInfo?.userId || null,
      })
      .select()
      .single();

    if (planError) {
      console.error('Plan insert error:', planError);
      return new Response(
        JSON.stringify({ error: 'Failed to create installment plan: ' + planError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert all scheduled charges
    const chargeRows = scheduleDates.map((date, idx) => ({
      plan_id: plan.id,
      client_id: planData.clientId || null,
      installment_number: idx + 1,
      amount: installmentAmount,
      scheduled_date: date,
      charge_status: 'scheduled',
    }));

    const { error: chargesError } = await supabase
      .from('installment_charges')
      .insert(chargeRows);

    if (chargesError) {
      console.error('Charges insert error:', chargesError);
      // Non-fatal: plan created, charges can be regenerated
    }

    // Audit log
    await supabase.from('audit_logs').insert({
      action: 'create',
      table_name: 'installment_plans',
      record_id: plan.id,
      description: `Installment plan created: ${plan.plan_name} — ${totalInstallments}x $${installmentAmount} (${frequency})`,
      severity: 'info',
      new_values: { plan_id: plan.id, total_amount: planData.totalAmount, frequency },
    });

    return new Response(
      JSON.stringify({
        success: true,
        plan,
        schedule: scheduleDates,
        stripeCustomerId: stripeCustomer.id,
        installmentAmount,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Create installment plan error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to create installment plan' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

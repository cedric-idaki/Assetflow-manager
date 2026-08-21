import Stripe from 'https://esm.sh/stripe@14.21.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authenticateCaller } from '../_shared/auth.ts';
import { callerIdentity, openRequest } from '../_shared/http.ts';

const API_VERSIONS = ['2026-08-21'];

Deno.serve(async (req) => {
  const api = await openRequest(req, {
    fn: 'confirm-payment',
    methods: 'POST, OPTIONS',
    versions: API_VERSIONS,
  });
  if (api.halt) return api.halt;

  // Existing call sites spread `corsHeaders`; pointing it at the per-request
  // headers keeps them working while the values become origin-checked.
  const corsHeaders = api.headers;

  // Writes payment records with the service role, so the caller must be a real
  // session rather than anyone holding the public anon key.
  const auth = await authenticateCaller(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Each call hits Stripe and then writes a payment record. Confirming is a
  // single step at the end of a checkout, so a per-user ceiling well above one
  // retry still leaves no room for a loop against our Stripe account.
  const over = await api.enforceLimit({
    action: 'confirm',
    identity: callerIdentity(auth.caller),
    limit: 20,
    windowSeconds: 60,
  });
  if (over) return over;

  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2024-06-20',
    })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { paymentIntentId } = await req.json()

    if (!paymentIntentId) {
      return new Response(
        JSON.stringify({ error: 'paymentIntentId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Retrieve payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)

    const paymentStatus = paymentIntent.status === 'succeeded' ? 'completed' : 
                          paymentIntent.status === 'canceled' ? 'failed' : 'pending'

    // Update payment record in database
    const { data: record, error: dbError } = await supabase
      .from('payments')
      .update({
        payment_status: paymentStatus,
        stripe_charge_id: paymentIntent.latest_charge as string || null,
        updated_at: new Date().toISOString(),
      })
      .eq('payment_intent_id', paymentIntentId)
      .select()
      .single()

    if (dbError) {
      console.error('DB update error:', dbError)
      return new Response(
        JSON.stringify({ error: 'Failed to update payment record' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Log to audit_logs
    if (record) {
      await supabase.from('audit_logs').insert({
        action: 'create',
        table_name: 'payments',
        record_id: record.id,
        description: `Stripe card payment ${paymentStatus}: $${record.amount} (${paymentIntentId})`,
        severity: paymentStatus === 'completed' ? 'info' : 'warning',
        new_values: { payment_status: paymentStatus, payment_intent_id: paymentIntentId },
      })
    }

    return new Response(
      JSON.stringify({ success: true, record, paymentStatus }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    // Stripe errors name the account, the API version and the exact parameter
    // that failed. Those go to the log; the caller gets a request id.
    return api.fail(error)
  }
})

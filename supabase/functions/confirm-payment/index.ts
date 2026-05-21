import Stripe from 'https://esm.sh/stripe@14.21.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

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
    console.error('Payment confirmation error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to confirm payment' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

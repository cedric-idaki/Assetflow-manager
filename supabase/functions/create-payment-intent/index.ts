import Stripe from 'https://esm.sh/stripe@14.21.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

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

    const { paymentData, customerInfo } = await req.json()

    if (!paymentData?.amount || paymentData.amount <= 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid payment amount' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build customer data
    const customerData: Stripe.CustomerCreateParams = {
      email: customerInfo?.email,
      name: `${customerInfo?.firstName || ''} ${customerInfo?.lastName || ''}`.trim() || undefined,
      metadata: { userId: customerInfo?.userId || 'guest' },
    }

    if (customerInfo?.billing) {
      customerData.address = {
        line1: customerInfo.billing.address_line_1 || '',
        city: customerInfo.billing.city || '',
        state: customerInfo.billing.state || '',
        postal_code: customerInfo.billing.postal_code || '',
        country: customerInfo.billing.country || 'US',
      }
    }

    // Create or update Stripe customer
    let stripeCustomer: Stripe.Customer
    if (customerInfo?.stripeCustomerId) {
      stripeCustomer = await stripe.customers.update(customerInfo.stripeCustomerId, customerData) as Stripe.Customer
    } else {
      stripeCustomer = await stripe.customers.create(customerData)
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(paymentData.amount * 100),
      currency: paymentData.currency || 'usd',
      customer: stripeCustomer.id,
      description: paymentData.description || 'AssetFlow Payment',
      metadata: {
        clientId: paymentData.additionalFields?.clientId || '',
        assetId: paymentData.additionalFields?.assetId || '',
        userId: customerInfo?.userId || 'guest',
      },
    })

    // Save pending transaction to payments table
    const transactionId = `TXN-STRIPE-${Date.now()}`
    const { data: paymentRecord, error: dbError } = await supabase
      .from('payments')
      .insert({
        transaction_id: transactionId,
        client_id: paymentData.additionalFields?.clientId || null,
        asset_id: paymentData.additionalFields?.assetId || null,
        amount: paymentData.amount,
        payment_method: 'card',
        payment_status: 'pending',
        payment_intent_id: paymentIntent.id,
        stripe_customer_id: stripeCustomer.id,
        notes: paymentData.additionalFields?.notes || null,
        processed_by: customerInfo?.userId || null,
        payment_date: new Date().toISOString(),
      })
      .select()
      .single()

    if (dbError) {
      console.error('DB insert error:', dbError)
      // Don't fail the payment intent creation if DB insert fails
    }

    return new Response(
      JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        recordId: paymentRecord?.id || null,
        transactionId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Payment intent creation error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to create payment intent' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

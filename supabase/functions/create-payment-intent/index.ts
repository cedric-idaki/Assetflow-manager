import Stripe from 'https://esm.sh/stripe@14.21.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authenticateCaller } from '../_shared/auth.ts';
import { callerIdentity, openRequest } from '../_shared/http.ts';

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: {
    get: (key: string) => string | undefined;
  };
};

const API_VERSIONS = ['2026-08-21'];

Deno.serve(async (req) => {
  const api = await openRequest(req, {
    fn: 'create-payment-intent',
    methods: 'POST, OPTIONS',
    versions: API_VERSIONS,
  });
  if (api.halt) return api.halt;

  // Existing call sites spread `corsHeaders`; pointing it at the per-request
  // headers keeps them working while the values become origin-checked.
  const corsHeaders = api.headers;

  // Creates Stripe payment intents against your account — never anonymous.
  const auth = await authenticateCaller(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Every call creates a real object in the Stripe account. A loop leaves
  // thousands of abandoned intents behind, which is noise in the dashboard, a
  // dent in the account's authorisation-rate metrics, and free API burn.
  // Starting a checkout is one deliberate act.
  const over = await api.enforceLimit({
    action: 'create',
    identity: callerIdentity(auth.caller),
    limit: 10,
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
      description: paymentData.description || 'Ararat Payment',
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
    // Stripe errors name the account, the API version and the failing
    // parameter. Log them; hand the caller a request id.
    return api.fail(error)
  }
})

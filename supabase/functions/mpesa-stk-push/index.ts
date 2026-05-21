import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Generate Daraja access token
async function getDarajaToken(): Promise<string> {
  const consumerKey = Deno.env.get('MPESA_CONSUMER_KEY') ?? '';
  const consumerSecret = Deno.env.get('MPESA_CONSUMER_SECRET') ?? '';
  const credentials = btoa(`${consumerKey}:${consumerSecret}`);
  const env = Deno.env.get('MPESA_ENV') ?? 'sandbox';
  const baseUrl = env === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

  const res = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get Daraja access token');
  return data.access_token;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { phone, amount, accountRef, clientId, planId, chargeId } = await req.json();

    // Validate inputs
    if (!phone || !amount || !accountRef) {
      return new Response(JSON.stringify({ error: 'phone, amount, and accountRef are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Normalize phone: strip leading 0 or +254, ensure 254XXXXXXXXX
    const normalised = phone.replace(/\s+/g, '').replace(/^\+/, '').replace(/^0/, '254');
    if (!/^2547\d{8}$/.test(normalised)) {
      return new Response(JSON.stringify({ error: 'Invalid Safaricom number. Use format: 07XXXXXXXX or 2547XXXXXXXX' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const env = Deno.env.get('MPESA_ENV') ?? 'sandbox';
    const baseUrl = env === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';

    const shortcode = Deno.env.get('MPESA_SHORTCODE') ?? '';
    const passkey = Deno.env.get('MPESA_PASSKEY') ?? '';
    const callbackUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/mpesa-callback`;

    const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
    const password = btoa(`${shortcode}${passkey}${timestamp}`);

    const token = await getDarajaToken();

    // Initiate STK Push
    const stkRes = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount),
        PartyA: normalised,
        PartyB: shortcode,
        PhoneNumber: normalised,
        CallBackURL: callbackUrl,
        AccountReference: accountRef.slice(0, 12),
        TransactionDesc: `Payment for ${accountRef}`.slice(0, 13),
      }),
    });

    const stkData = await stkRes.json();

    if (stkData.ResponseCode !== '0') {
      return new Response(JSON.stringify({
        error: stkData.errorMessage || stkData.ResponseDescription || 'STK push failed',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Record pending payment in DB
    const checkoutRequestId = stkData.CheckoutRequestID;
    const { data: txn, error: dbErr } = await supabase
      .from('mpesa_transactions')
      .insert({
        checkout_request_id: checkoutRequestId,
        merchant_request_id: stkData.MerchantRequestID,
        phone_number: normalised,
        amount: Math.round(amount),
        account_reference: accountRef,
        client_id: clientId || null,
        plan_id: planId || null,
        charge_id: chargeId || null,
        status: 'pending',
      })
      .select()
      .single();

    if (dbErr) console.error('DB insert error:', dbErr.message);

    return new Response(JSON.stringify({
      success: true,
      checkoutRequestId,
      message: 'STK push sent. Waiting for customer to confirm on their phone.',
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('STK push error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

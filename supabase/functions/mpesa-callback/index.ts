import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response>) => void;
  env: { get: (key: string) => string | undefined };
};

Deno.serve(async (req) => {
  // Safaricom sends POST with no auth — just process it
  if (req.method !== 'POST') {
    return new Response('ok', { status: 200 });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json();
    const stk = body?.Body?.stkCallback;
    if (!stk) return new Response('ok', { status: 200 });

    const checkoutRequestId: string = stk.CheckoutRequestID;
    const resultCode: number = stk.ResultCode;
    const resultDesc: string = stk.ResultDesc;

    // Fetch our pending record
    const { data: txn } = await supabase
      .from('mpesa_transactions')
      .select('*')
      .eq('checkout_request_id', checkoutRequestId)
      .maybeSingle();

    if (!txn) {
      console.warn('Unknown checkout request:', checkoutRequestId);
      return new Response('ok', { status: 200 });
    }

    if (resultCode === 0) {
      // Payment successful — extract metadata from callback items
      const items: Array<{ Name: string; Value: string | number }> =
        stk.CallbackMetadata?.Item ?? [];
      const get = (name: string) => items.find(i => i.Name === name)?.Value;

      const mpesaRef = String(get('MpesaReceiptNumber') ?? '');
      const amount = Number(get('Amount') ?? txn.amount);
      const phone = String(get('PhoneNumber') ?? txn.phone_number);

      // Update mpesa_transactions
      await supabase
        .from('mpesa_transactions')
        .update({
          status: 'completed',
          mpesa_receipt_number: mpesaRef,
          result_desc: resultDesc,
          completed_at: new Date().toISOString(),
        })
        .eq('checkout_request_id', checkoutRequestId);

      // Create a payment record
      await supabase.from('payments').insert({
        client_id: txn.client_id,
        amount,
        payment_method: 'mpesa',
        payment_status: 'completed',
        transaction_id: mpesaRef,
        reference_number: mpesaRef,
        payment_date: new Date().toISOString(),
        notes: `M-Pesa payment from ${phone}. Ref: ${mpesaRef}`,
      });

      // Mark installment charge as paid if linked
      if (txn.charge_id) {
        await supabase
          .from('installment_charges')
          .update({ charge_status: 'paid', paid_date: new Date().toISOString() })
          .eq('id', txn.charge_id);
      }

    } else {
      // Payment failed or cancelled
      await supabase
        .from('mpesa_transactions')
        .update({ status: resultCode === 1032 ? 'cancelled' : 'failed', result_desc: resultDesc })
        .eq('checkout_request_id', checkoutRequestId);
    }

    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('Callback error:', err);
    return new Response('ok', { status: 200 }); // Always return 200 to Safaricom
  }
});

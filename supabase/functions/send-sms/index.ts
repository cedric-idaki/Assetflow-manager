/// <reference lib="deno.ns" />

import { authenticateCaller } from '../_shared/auth.ts';
import { callerIdentity, openRequest } from '../_shared/http.ts';

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');

const API_VERSIONS = ['2026-08-21'];

const buildPaymentReminderMessage = (data: any): string => {
  const { client, payment, asset, daysUntilDue, isOverdue } = data;
  const clientName = client?.name || client?.full_name || 'Valued Client';
  const assetName = asset?.description || asset?.name || 'your asset';
  const amount = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0 }).format(payment?.amount || 0);
  const dueDate = payment?.payment_date ? new Date(payment.payment_date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A';

  if (isOverdue) {
    const overdueDays = Math.abs(daysUntilDue);
    return `Ararat Alert: Hi ${clientName}, your installment of ${amount} for ${assetName} is OVERDUE by ${overdueDays} day(s) (was due ${dueDate}). Please make payment immediately to avoid penalties. Contact us for assistance.`;
  }

  if (daysUntilDue === 0) {
    return `Ararat Reminder: Hi ${clientName}, your installment of ${amount} for ${assetName} is DUE TODAY. Please ensure payment is made before end of day. Ref: ${payment?.reference_number || 'N/A'}.`;
  }

  if (daysUntilDue <= 3) {
    return `Ararat Reminder: Hi ${clientName}, your installment of ${amount} for ${assetName} is due in ${daysUntilDue} day(s) on ${dueDate}. Please arrange payment soon. Ref: ${payment?.reference_number || 'N/A'}.`;
  }

  return `Ararat Reminder: Hi ${clientName}, your upcoming installment of ${amount} for ${assetName} is due on ${dueDate} (${daysUntilDue} days away). Ref: ${payment?.reference_number || 'N/A'}.`;
};

const buildPaymentConfirmationMessage = (data: any): string => {
  const { transaction, client, asset, allocations } = data;
  const clientName = client?.name || client?.full_name || 'Valued Client';
  const assetName = asset?.name || asset?.description || 'your asset';
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(transaction?.amount || 0);
  const txnId = transaction?.transactionId || transaction?.transaction_id || 'N/A';
  const method = transaction?.paymentMethod || transaction?.payment_method || 'N/A';

  return `Ararat Confirmation: Hi ${clientName}, your payment of ${amount} for ${assetName} has been received successfully. Transaction ID: ${txnId}. Method: ${method}. Thank you!`;
};

Deno.serve(async (req) => {
  const api = await openRequest(req, {
    fn: 'send-sms',
    methods: 'POST, OPTIONS',
    versions: API_VERSIONS,
  });
  if (api.halt) return api.halt;

  // Existing call sites spread `corsHeaders` into their own header objects;
  // pointing it at the per-request headers keeps every one of them working
  // while the values behind it become origin-checked instead of "*".
  const corsHeaders = api.headers;

  // Twilio sends cost real money and the caller controls the destination
  // number, so this must never be reachable with the public anon key. Any
  // signed-in user may send (clients trigger e-sign and payment SMS from the
  // portal); other Edge Functions call in with the service-role key.
  const auth = await authenticateCaller(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Charged per user, after authentication, so the budget follows the account
  // rather than an address a whole office shares. A human sending reminders
  // from the portal sends them one at a time; the bulk paths (payment-alerts,
  // esign-reminders) come in with the service-role key and are exempt, so this
  // ceiling never touches a legitimate batch.
  const over = await api.enforceLimit({
    action: 'send',
    identity: callerIdentity(auth.caller),
    limit: 20,
    windowSeconds: 60,
  });
  if (over) return over;

  try {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
      return new Response(JSON.stringify({ error: 'Twilio credentials not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const body = await req.json();
    const { type, to, data } = body;

    if (!to) {
      return new Response(JSON.stringify({ error: 'Missing required field: to (phone number)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let message = '';

    if (type === 'payment_reminder') {
      message = buildPaymentReminderMessage(data);
    } else if (type === 'payment_confirmation') {
      message = buildPaymentConfirmationMessage(data);
    } else if (type === 'custom' && body.message) {
      message = body.message;
    } else {
      return new Response(JSON.stringify({ error: 'Invalid type. Use: payment_reminder, payment_confirmation, or custom' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const credentials = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

    const formData = new URLSearchParams({
      To: to,
      From: TWILIO_PHONE_NUMBER,
      Body: message
    });

    const response = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData
    });

    const result = await response.json();

    if (!response.ok) {
      // `result` is Twilio's raw error payload — it carries the account SID,
      // internal error codes and a moreInfo URL. That belongs in the log, not
      // in a response the caller reads.
      console.error('Twilio API error:', { requestId: api.requestId, result });
      return new Response(
        JSON.stringify({ error: 'Failed to send SMS.', requestId: api.requestId }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log('SMS sent successfully:', result.sid);
    return new Response(JSON.stringify({ success: true, messageSid: result.sid, status: result.status }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return api.fail(error);
  }
});

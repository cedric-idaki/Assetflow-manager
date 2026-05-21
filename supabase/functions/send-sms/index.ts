/// <reference lib="deno.ns" />

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*'
};

const buildPaymentReminderMessage = (data: any): string => {
  const { client, payment, asset, daysUntilDue, isOverdue } = data;
  const clientName = client?.name || client?.full_name || 'Valued Client';
  const assetName = asset?.description || asset?.name || 'your asset';
  const amount = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0 }).format(payment?.amount || 0);
  const dueDate = payment?.payment_date ? new Date(payment.payment_date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A';

  if (isOverdue) {
    const overdueDays = Math.abs(daysUntilDue);
    return `AssetFlow Alert: Hi ${clientName}, your installment of ${amount} for ${assetName} is OVERDUE by ${overdueDays} day(s) (was due ${dueDate}). Please make payment immediately to avoid penalties. Contact us for assistance.`;
  }

  if (daysUntilDue === 0) {
    return `AssetFlow Reminder: Hi ${clientName}, your installment of ${amount} for ${assetName} is DUE TODAY. Please ensure payment is made before end of day. Ref: ${payment?.reference_number || 'N/A'}.`;
  }

  if (daysUntilDue <= 3) {
    return `AssetFlow Reminder: Hi ${clientName}, your installment of ${amount} for ${assetName} is due in ${daysUntilDue} day(s) on ${dueDate}. Please arrange payment soon. Ref: ${payment?.reference_number || 'N/A'}.`;
  }

  return `AssetFlow Reminder: Hi ${clientName}, your upcoming installment of ${amount} for ${assetName} is due on ${dueDate} (${daysUntilDue} days away). Ref: ${payment?.reference_number || 'N/A'}.`;
};

const buildPaymentConfirmationMessage = (data: any): string => {
  const { transaction, client, asset, allocations } = data;
  const clientName = client?.name || client?.full_name || 'Valued Client';
  const assetName = asset?.name || asset?.description || 'your asset';
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(transaction?.amount || 0);
  const txnId = transaction?.transactionId || transaction?.transaction_id || 'N/A';
  const method = transaction?.paymentMethod || transaction?.payment_method || 'N/A';

  return `AssetFlow Confirmation: Hi ${clientName}, your payment of ${amount} for ${assetName} has been received successfully. Transaction ID: ${txnId}. Method: ${method}. Thank you!`;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

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
      console.error('Twilio API error:', result);
      return new Response(JSON.stringify({ error: 'Failed to send SMS', details: result }), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log('SMS sent successfully:', result.sid);
    return new Response(JSON.stringify({ success: true, messageSid: result.sid, status: result.status }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error sending SMS:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

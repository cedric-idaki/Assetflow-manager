// @ts-ignore: Deno global is available in Deno runtime
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: { env: { get(key: string): string | undefined } };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const formatCurrency = (val: number) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0 }).format(val || 0);

const formatDate = (d: string) =>
  d ? new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

// ─── Email Templates ──────────────────────────────────────────────────────────

const baseCard = `font-family:'Segoe UI',Arial,sans-serif;background:#f8fafc;margin:0;padding:0;`;
const card = `background:#ffffff;border-radius:12px;padding:32px;max-width:600px;margin:24px auto;box-shadow:0 1px 3px rgba(0,0,0,0.08);`;

const buildHeader = (gradient: string, icon: string, title: string, subtitle: string) => `
  <div style="background:${gradient};border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;">
    <div style="width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px;">
      <span style="font-size:28px;">${icon}</span>
    </div>
    <h1 style="margin:0;font-size:22px;font-weight:700;color:#fff;">${title}</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px;color:#fff;">${subtitle}</p>
  </div>`;

const buildFooter = () => `
  <div style="background:#f8fafc;border-radius:8px;padding:16px;text-align:center;margin-top:24px;">
    <p style="margin:0;font-size:12px;color:#94a3b8;">This is an automated notification from <strong>AssetFlow Management System</strong>.</p>
  </div>`;

const buildRow = (label: string, value: string, highlight = false) => `
  <tr>
    <td style="padding:9px 0;color:#6b7280;font-size:13px;border-bottom:1px solid #f3f4f6;">${label}</td>
    <td style="padding:9px 0;color:${highlight ? '#059669' : '#111827'};font-size:13px;font-weight:${highlight ? '700' : '600'};text-align:right;border-bottom:1px solid #f3f4f6;">${value}</td>
  </tr>`;

const buildPaymentSuccessEmail = (data: any) => {
  const { transaction, client, amount } = data;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="${baseCard}">
<div style="${card}">
  ${buildHeader('linear-gradient(135deg,#059669 0%,#10b981 100%)', '✅', 'Payment Successful', 'Your payment has been confirmed')}
  <div style="padding:28px 0 0;">
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:20px;text-align:center;margin-bottom:24px;">
      <p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Amount Paid</p>
      <p style="margin:0;font-size:32px;font-weight:800;color:#059669;">${formatCurrency(amount || 0)}</p>
    </div>
    <h3 style="font-size:13px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px;">Transaction Details</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      ${buildRow('Transaction ID', transaction?.transactionId || transaction?.transaction_id || 'N/A')}
      ${buildRow('Client', client?.name || client?.full_name || 'N/A')}
      ${buildRow('Payment Method', transaction?.paymentMethod || transaction?.payment_method || 'N/A')}
      ${buildRow('Date', formatDate(transaction?.payment_date || new Date().toISOString()))}
      ${buildRow('Status', '<span style="background:#d1fae5;color:#065f46;font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px;">SUCCESSFUL</span>')}
    </table>
    ${buildFooter()}
  </div>
</div></body></html>`;
};

const buildPaymentFailureEmail = (data: any) => {
  const { transaction, client, amount, failureReason, retryInstructions } = data;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="${baseCard}">
<div style="${card}">
  ${buildHeader('linear-gradient(135deg,#dc2626 0%,#ef4444 100%)', '❌', 'Payment Failed', 'Action required — please review and retry')}
  <div style="padding:28px 0 0;">
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:20px;text-align:center;margin-bottom:24px;">
      <p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Failed Amount</p>
      <p style="margin:0;font-size:32px;font-weight:800;color:#dc2626;">${formatCurrency(amount || 0)}</p>
    </div>
    <h3 style="font-size:13px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px;">Failure Details</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      ${buildRow('Transaction ID', transaction?.transactionId || transaction?.transaction_id || 'N/A')}
      ${buildRow('Client', client?.name || client?.full_name || 'N/A')}
      ${buildRow('Failure Reason', failureReason || 'Payment declined')}
      ${buildRow('Date', formatDate(transaction?.payment_date || new Date().toISOString()))}
      ${buildRow('Status', '<span style="background:#fee2e2;color:#991b1b;font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px;">FAILED</span>')}
    </table>
    ${retryInstructions ? `
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin-bottom:16px;">
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#92400e;">How to Retry</p>
      <p style="margin:0;font-size:13px;color:#78350f;">${retryInstructions}</p>
    </div>` : ''}
    ${buildFooter()}
  </div>
</div></body></html>`;
};

const buildDueDateReminderEmail = (data: any) => {
  const { client, installment, asset, daysUntilDue } = data;
  const isUrgent = daysUntilDue <= 3;
  const accentColor = isUrgent ? '#d97706' : '#1a56db';
  const bgColor = isUrgent ? '#fffbeb' : '#eff6ff';
  const borderColor = isUrgent ? '#fde68a' : '#bfdbfe';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="${baseCard}">
<div style="${card}">
  ${buildHeader(`linear-gradient(135deg,${accentColor} 0%,${isUrgent ? '#f59e0b' : '#3b82f6'} 100%)`, isUrgent ? '⚠️' : '📅', `Payment Due in ${daysUntilDue} Day${daysUntilDue !== 1 ? 's' : ''}`, 'Upcoming installment reminder')}
  <div style="padding:28px 0 0;">
    <div style="background:${bgColor};border:1px solid ${borderColor};border-radius:10px;padding:20px;text-align:center;margin-bottom:24px;">
      <p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Amount Due</p>
      <p style="margin:0;font-size:32px;font-weight:800;color:${accentColor};">${formatCurrency(installment?.amount || 0)}</p>
    </div>
    <h3 style="font-size:13px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px;">Installment Details</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      ${buildRow('Client', client?.name || client?.full_name || 'N/A')}
      ${buildRow('Asset', asset?.description || asset?.name || 'N/A')}
      ${buildRow('Due Date', formatDate(installment?.due_date || installment?.scheduled_date))}
      ${buildRow('Days Remaining', `<strong style="color:${accentColor};">${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''}</strong>`)}
      ${buildRow('Installment #', `${installment?.installment_number || 'N/A'}`)}
    </table>
    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px;margin-bottom:16px;">
      <p style="margin:0;font-size:13px;color:#0369a1;">Please ensure your payment is made on or before the due date to avoid late penalties. Contact us if you need assistance.</p>
    </div>
    ${buildFooter()}
  </div>
</div></body></html>`;
};

const buildThresholdBreachEmail = (data: any) => {
  const { client, transaction, amount, thresholdType, thresholdLimit, breachAmount } = data;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="${baseCard}">
<div style="${card}">
  ${buildHeader('linear-gradient(135deg,#7c3aed 0%,#8b5cf6 100%)', '🚨', 'Threshold Alert', `${thresholdType === 'transaction' ? 'Transaction' : 'Balance'} limit exceeded`)}
  <div style="padding:28px 0 0;">
    <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:10px;padding:20px;text-align:center;margin-bottom:24px;">
      <p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Amount Exceeding Threshold</p>
      <p style="margin:0;font-size:32px;font-weight:800;color:#7c3aed;">${formatCurrency(breachAmount || amount || 0)}</p>
      <p style="margin:6px 0 0;font-size:13px;color:#6b7280;">Configured limit: ${formatCurrency(thresholdLimit || 0)}</p>
    </div>
    <h3 style="font-size:13px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 12px;">Alert Details</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      ${buildRow('Alert Type', thresholdType === 'transaction' ? 'Single Transaction Limit' : 'Outstanding Balance Limit')}
      ${buildRow('Client', client?.name || client?.full_name || 'N/A')}
      ${buildRow('Transaction ID', transaction?.transactionId || transaction?.transaction_id || 'N/A')}
      ${buildRow('Amount', formatCurrency(amount || 0), true)}
      ${buildRow('Configured Limit', formatCurrency(thresholdLimit || 0))}
      ${buildRow('Date', formatDate(new Date().toISOString()))}
    </table>
    <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;padding:16px;margin-bottom:16px;">
      <p style="margin:0;font-size:13px;color:#6d28d9;">This alert requires admin review. Please verify the transaction and take appropriate action if necessary.</p>
    </div>
    ${buildFooter()}
  </div>
</div></body></html>`;
};

// ─── SMS Message Builders ─────────────────────────────────────────────────────

const buildSuccessSMS = (data: any) => {
  const { transaction, client, amount } = data;
  const name = client?.name || client?.full_name || 'Valued Client';
  const txnId = transaction?.transactionId || transaction?.transaction_id || 'N/A';
  return `AssetFlow: Hi ${name}, your payment of ${formatCurrency(amount || 0)} was received successfully. Txn ID: ${txnId}. Thank you!`;
};

const buildFailureSMS = (data: any) => {
  const { transaction, client, amount, failureReason } = data;
  const name = client?.name || client?.full_name || 'Valued Client';
  const txnId = transaction?.transactionId || transaction?.transaction_id || 'N/A';
  return `AssetFlow Alert: Hi ${name}, your payment of ${formatCurrency(amount || 0)} FAILED. Reason: ${failureReason || 'Declined'}. Txn: ${txnId}. Please retry or contact support.`;
};

const buildDueDateSMS = (data: any) => {
  const { client, installment, daysUntilDue } = data;
  const name = client?.name || client?.full_name || 'Valued Client';
  const amount = formatCurrency(installment?.amount || 0);
  const dueDate = installment?.due_date || installment?.scheduled_date
    ? new Date(installment.due_date || installment.scheduled_date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })
    : 'N/A';
  return `AssetFlow Reminder: Hi ${name}, your installment of ${amount} is due in ${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''} on ${dueDate}. Please arrange payment to avoid penalties.`;
};

const buildThresholdSMS = (data: any) => {
  const { client, amount, thresholdType, thresholdLimit } = data;
  const name = client?.name || client?.full_name || 'N/A';
  const typeLabel = thresholdType === 'transaction' ? 'transaction' : 'balance';
  return `AssetFlow Alert: ${typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)} threshold breached for ${name}. Amount: ${formatCurrency(amount || 0)} exceeds limit of ${formatCurrency(thresholdLimit || 0)}. Admin review required.`;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sendEmail = async (to: string, subject: string, html: string) => {
  if (!RESEND_API_KEY || !to) return { status: 'skipped', reason: !RESEND_API_KEY ? 'no_api_key' : 'no_recipient' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'AssetFlow <notifications@assetflow.com>', to: [to], subject, html }),
  });
  return res.ok ? { status: 'sent' } : { status: 'failed', reason: await res.text() };
};

const sendSMS = async (to: string, body: string) => {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER || !to) {
    return { status: 'skipped', reason: 'missing_credentials_or_recipient' };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const params = new URLSearchParams({ From: TWILIO_PHONE_NUMBER, To: to, Body: body });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  return res.ok ? { status: 'sent' } : { status: 'failed', reason: await res.text() };
};

// ─── Main Handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json();
    const { event_type, recipient_email, recipient_phone, recipient_name, data } = body;

    if (!event_type) {
      return new Response(JSON.stringify({ error: 'Missing event_type' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if alert type is enabled via Supabase
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Map event_type to config alert_type
    const configType = event_type === 'due_date_reminder'
      ? (data?.daysUntilDue <= 3 ? 'due_date_reminder_3' : 'due_date_reminder_7')
      : event_type === 'threshold_breach'
      ? (data?.thresholdType === 'transaction' ? 'threshold_breach_transaction' : 'threshold_breach_balance')
      : event_type;

    const { data: config } = await supabase
      .from('payment_alert_configs')
      .select('enabled')
      .eq('alert_type', configType)
      .single();

    if (config && !config.enabled) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'alert_type_disabled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let emailHtml = '';
    let emailSubject = '';
    let smsMessage = '';

    switch (event_type) {
      case 'payment_success':
        emailHtml = buildPaymentSuccessEmail(data);
        emailSubject = `✅ Payment Confirmed — ${formatCurrency(data?.amount || 0)}`;
        smsMessage = buildSuccessSMS(data);
        break;
      case 'payment_failure':
        emailHtml = buildPaymentFailureEmail(data);
        emailSubject = `❌ Payment Failed — Action Required`;
        smsMessage = buildFailureSMS(data);
        break;
      case 'due_date_reminder':
        emailHtml = buildDueDateReminderEmail(data);
        emailSubject = `📅 Payment Due in ${data?.daysUntilDue} Day${data?.daysUntilDue !== 1 ? 's' : ''} — ${formatCurrency(data?.installment?.amount || 0)}`;
        smsMessage = buildDueDateSMS(data);
        break;
      case 'threshold_breach':
        emailHtml = buildThresholdBreachEmail(data);
        emailSubject = `🚨 Threshold Alert — ${data?.thresholdType === 'transaction' ? 'Transaction' : 'Balance'} Limit Exceeded`;
        smsMessage = buildThresholdSMS(data);
        break;
      default:
        return new Response(JSON.stringify({ error: `Unknown event_type: ${event_type}` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const [emailResult, smsResult] = await Promise.all([
      sendEmail(recipient_email, emailSubject, emailHtml),
      sendSMS(recipient_phone, smsMessage),
    ]);

    // Log to payment_alerts_log
    await supabase.from('payment_alerts_log').insert({
      alert_type: configType,
      event_type,
      recipient_email: recipient_email || null,
      recipient_phone: recipient_phone || null,
      recipient_name: recipient_name || data?.client?.name || data?.client?.full_name || null,
      subject: emailSubject,
      message: smsMessage,
      amount: data?.amount || data?.installment?.amount || null,
      transaction_id: data?.transaction?.transactionId || data?.transaction?.transaction_id || null,
      payment_id: data?.payment_id || null,
      email_status: emailResult.status,
      sms_status: smsResult.status,
      error_message: emailResult.status === 'failed' ? emailResult.reason : smsResult.status === 'failed' ? smsResult.reason : null,
      metadata: data || {},
    });

    return new Response(JSON.stringify({ success: true, email: emailResult, sms: smsResult }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('payment-alerts error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

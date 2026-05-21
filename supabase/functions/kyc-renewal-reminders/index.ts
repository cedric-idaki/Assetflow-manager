/// <reference lib="deno.ns" />

declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')!;
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')!;
const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER')!;

const REMINDER_DAYS = [30, 14, 7];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

const formatDate = (d: string) =>
  d ? new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

// ─── Supabase helpers ─────────────────────────────────────────────────────────

const supabaseFetch = async (path: string, options: RequestInit = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Prefer': 'return=representation',
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  return { data, ok: res.ok, status: res.status };
};

// ─── Duplicate check ──────────────────────────────────────────────────────────

const hasReminderBeenSent = async (
  clientId: string,
  documentType: string,
  expiryDate: string,
  daysBefore: number,
  channel: string
): Promise<boolean> => {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabaseFetch(
    `/kyc_reminder_logs?client_id=eq.${clientId}&document_type=eq.${encodeURIComponent(documentType)}&expiry_date=eq.${expiryDate}&days_before_expiry=eq.${daysBefore}&channel=eq.${channel}&status=eq.sent&sent_at=gte.${today}T00:00:00Z`
  );
  return Array.isArray(data) && data.length > 0;
};

// ─── Log reminder ─────────────────────────────────────────────────────────────

const logReminder = async (
  clientId: string,
  documentId: string | null,
  documentType: string,
  expiryDate: string,
  daysBefore: number,
  channel: string,
  recipient: string,
  status: 'sent' | 'failed' | 'skipped',
  errorMessage?: string
) => {
  await supabaseFetch('/kyc_reminder_logs', {
    method: 'POST',
    body: JSON.stringify({
      client_id: clientId,
      document_id: documentId,
      document_type: documentType,
      expiry_date: expiryDate,
      days_before_expiry: daysBefore,
      channel,
      recipient,
      status,
      error_message: errorMessage || null,
    }),
  });
};

// ─── Email template ───────────────────────────────────────────────────────────

const buildKYCReminderEmail = (clientName: string, documentType: string, expiryDate: string, daysLeft: number): string => {
  const urgencyColor = daysLeft <= 7 ? '#dc2626' : daysLeft <= 14 ? '#d97706' : '#2563eb';
  const urgencyBg = daysLeft <= 7 ? '#fef2f2' : daysLeft <= 14 ? '#fffbeb' : '#eff6ff';
  const urgencyBorder = daysLeft <= 7 ? '#fecaca' : daysLeft <= 14 ? '#fde68a' : '#bfdbfe';
  const urgencyEmoji = daysLeft <= 7 ? '🔴' : daysLeft <= 14 ? '🟠' : '🟡';
  const urgencyLabel = daysLeft <= 7 ? 'CRITICAL – Action Required Immediately' : daysLeft <= 14 ? 'URGENT – Renew Soon' : 'Action Required – Renewal Due';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f8fafc;margin:0;padding:0">
<div style="background:#ffffff;border-radius:12px;padding:32px;max-width:600px;margin:24px auto;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
  <div style="background:linear-gradient(135deg,${urgencyColor} 0%,${daysLeft <= 7 ? '#b91c1c' : daysLeft <= 14 ? '#b45309' : '#1d4ed8'} 100%);border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;margin:-32px -32px 28px">
    <div style="font-size:40px;margin-bottom:8px">${urgencyEmoji}</div>
    <h1 style="margin:0;font-size:22px;font-weight:800;color:#fff">KYC Document Renewal Reminder</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px">${urgencyLabel}</p>
  </div>

  <p style="margin:0 0 20px;font-size:15px;color:#374151">Dear <strong>${clientName}</strong>,</p>
  <p style="margin:0 0 20px;font-size:14px;color:#6b7280;line-height:1.6">
    This is an automated reminder that your <strong>${documentType}</strong> is expiring soon.
    Please initiate the renewal process to maintain your KYC compliance and uninterrupted access to AssetFlow services.
  </p>

  <div style="background:${urgencyBg};border:1px solid ${urgencyBorder};border-radius:10px;padding:20px;margin-bottom:24px;text-align:center">
    <p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">Document Expiry</p>
    <p style="margin:0;font-size:28px;font-weight:800;color:${urgencyColor}">${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining</p>
    <p style="margin:6px 0 0;font-size:13px;color:#6b7280">Expires on: <strong>${formatDate(expiryDate)}</strong></p>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Document Type</td><td style="padding:8px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${documentType}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Expiry Date</td><td style="padding:8px 0;color:${urgencyColor};font-size:13px;font-weight:700;text-align:right">${formatDate(expiryDate)}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Days Remaining</td><td style="padding:8px 0;color:${urgencyColor};font-size:13px;font-weight:700;text-align:right">${daysLeft} day${daysLeft !== 1 ? 's' : ''}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Action Required</td><td style="padding:8px 0;color:#059669;font-size:13px;font-weight:600;text-align:right">Renew Document</td></tr>
  </table>

  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:20px">
    <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#065f46">📋 How to Renew:</p>
    <ol style="margin:0;padding-left:20px;font-size:13px;color:#374151;line-height:1.8">
      <li>Log in to your AssetFlow Client Portal</li>
      <li>Navigate to <strong>KYC Renewals</strong> section</li>
      <li>Upload your renewed document</li>
      <li>Submit for verification</li>
    </ol>
  </div>

  <div style="background:#f8fafc;border-radius:8px;padding:16px;text-align:center">
    <p style="margin:0;font-size:13px;color:#6b7280">This is an automated reminder from <strong>AssetFlow Management</strong>. Please do not reply to this email.</p>
  </div>
</div>
</body></html>`;
};

// ─── SMS message ──────────────────────────────────────────────────────────────

const buildKYCSMSMessage = (clientName: string, documentType: string, expiryDate: string, daysLeft: number): string => {
  const urgency = daysLeft <= 7 ? 'CRITICAL' : daysLeft <= 14 ? 'URGENT' : 'REMINDER';
  const formattedDate = new Date(expiryDate).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
  return `AssetFlow ${urgency}: Hi ${clientName}, your ${documentType} expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} (${formattedDate}). Log in to renew your KYC documents immediately to avoid service interruption.`;
};

// ─── Send email via Resend ────────────────────────────────────────────────────

const sendEmail = async (to: string, clientName: string, documentType: string, expiryDate: string, daysLeft: number): Promise<{ success: boolean; error?: string }> => {
  try {
    const subject = daysLeft <= 7
      ? `🔴 CRITICAL: ${documentType} expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} – Renew Now`
      : daysLeft <= 14
      ? `🟠 URGENT: ${documentType} expires in ${daysLeft} days – Action Required`
      : `🟡 Reminder: ${documentType} expires in ${daysLeft} days`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'onboarding@resend.dev',
        to: [to],
        subject,
        html: buildKYCReminderEmail(clientName, documentType, expiryDate, daysLeft),
      }),
    });
    const result = await res.json();
    if (!res.ok) return { success: false, error: result?.message || 'Resend API error' };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
};

// ─── Send SMS via Twilio ──────────────────────────────────────────────────────

const sendSMS = async (to: string, clientName: string, documentType: string, expiryDate: string, daysLeft: number): Promise<{ success: boolean; error?: string }> => {
  try {
    const message = buildKYCSMSMessage(clientName, documentType, expiryDate, daysLeft);
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const credentials = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const formData = new URLSearchParams({ To: to, From: TWILIO_PHONE_NUMBER, Body: message });

    const res = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
    });
    const result = await res.json();
    if (!res.ok) return { success: false, error: result?.message || 'Twilio API error' };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
};

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const results = {
    processed: 0,
    emailsSent: 0,
    smsSent: 0,
    skipped: 0,
    failed: 0,
    errors: [] as string[],
  };

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Build date targets for 30, 14, 7 days from now
    const targetDates = REMINDER_DAYS.map(days => {
      const d = new Date(today);
      d.setDate(d.getDate() + days);
      return { days, dateStr: d.toISOString().split('T')[0] };
    });

    // Query kyc_documents with client info for each target date
    for (const { days, dateStr } of targetDates) {
      const { data: docs, ok } = await supabaseFetch(
        `/kyc_documents?expiry_date=eq.${dateStr}&status=eq.active&select=id,client_id,document_type,expiry_date,clients(id,full_name,email,phone,kyc_status)`
      );

      if (!ok || !Array.isArray(docs)) {
        results.errors.push(`Failed to fetch documents for ${days}-day window`);
        continue;
      }

      for (const doc of docs) {
        const client = doc.clients;
        if (!client) continue;

        results.processed++;
        const clientName = client.full_name || 'Valued Client';
        const expiryDate = doc.expiry_date;
        const documentType = doc.document_type;

        // ── Email reminder ──
        if (client.email) {
          const alreadySent = await hasReminderBeenSent(client.id, documentType, expiryDate, days, 'email');
          if (alreadySent) {
            results.skipped++;
          } else {
            const emailResult = await sendEmail(client.email, clientName, documentType, expiryDate, days);
            await logReminder(
              client.id, doc.id, documentType, expiryDate, days, 'email',
              client.email, emailResult.success ? 'sent' : 'failed', emailResult.error
            );
            if (emailResult.success) results.emailsSent++;
            else {
              results.failed++;
              results.errors.push(`Email failed for ${clientName} (${documentType}): ${emailResult.error}`);
            }
          }
        }

        // ── SMS reminder ──
        if (client.phone) {
          const alreadySent = await hasReminderBeenSent(client.id, documentType, expiryDate, days, 'sms');
          if (alreadySent) {
            results.skipped++;
          } else {
            const smsResult = await sendSMS(client.phone, clientName, documentType, expiryDate, days);
            await logReminder(
              client.id, doc.id, documentType, expiryDate, days, 'sms',
              client.phone, smsResult.success ? 'sent' : 'failed', smsResult.error
            );
            if (smsResult.success) results.smsSent++;
            else {
              results.failed++;
              results.errors.push(`SMS failed for ${clientName} (${documentType}): ${smsResult.error}`);
            }
          }
        }
      }
    }

    console.log('KYC reminder run complete:', results);

    return new Response(JSON.stringify({ success: true, ...results }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('KYC reminder function error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message, ...results }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

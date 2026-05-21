import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// Declare Deno global for type safety
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { action_id, action_type, title, description, initiator_name, initiator_email, initiator_phone, checker_name, status, checker_comment, affected_entity } = await req.json();

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
    const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');

    const isApproved = status === 'approved';
    const statusLabel = isApproved ? 'APPROVED' : status === 'rejected' ? 'REJECTED' : 'ESCALATED';
    const statusColor = isApproved ? '#22c55e' : status === 'rejected' ? '#ef4444' : '#f59e0b';
    const statusEmoji = isApproved ? '✅' : status === 'rejected' ? '❌' : '⚠️';

    const results: { email?: string; sms?: string } = {};

    // Send email via Resend
    if (RESEND_API_KEY && initiator_email) {
      const emailBody = {
        from: 'AssetFlow <notifications@assetflow.com>',
        to: [initiator_email],
        subject: `${statusEmoji} Action ${statusLabel}: ${title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 20px;">
            <div style="background: white; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
              <div style="display: flex; align-items: center; margin-bottom: 24px;">
                <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #7c3aed, #6d28d9); border-radius: 12px; display: flex; align-items: center; justify-content: center; margin-right: 16px;">
                  <span style="color: white; font-size: 24px;">🏢</span>
                </div>
                <div>
                  <h1 style="margin: 0; font-size: 20px; color: #1e293b;">AssetFlow</h1>
                  <p style="margin: 0; color: #64748b; font-size: 14px;">Maker-Checker Notification</p>
                </div>
              </div>
              
              <div style="background: ${statusColor}15; border: 1px solid ${statusColor}30; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                <p style="margin: 0; font-size: 18px; font-weight: bold; color: ${statusColor};">${statusEmoji} Action ${statusLabel}</p>
              </div>

              <h2 style="color: #1e293b; font-size: 16px; margin-bottom: 8px;">${title}</h2>
              <p style="color: #64748b; font-size: 14px; margin-bottom: 24px;">${description}</p>

              <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
                <tr style="background: #f8fafc;">
                  <td style="padding: 10px 12px; font-size: 13px; color: #64748b; border-bottom: 1px solid #e2e8f0;">Action Type</td>
                  <td style="padding: 10px 12px; font-size: 13px; color: #1e293b; font-weight: 500; border-bottom: 1px solid #e2e8f0;">${action_type?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 12px; font-size: 13px; color: #64748b; border-bottom: 1px solid #e2e8f0;">Affected Entity</td>
                  <td style="padding: 10px 12px; font-size: 13px; color: #1e293b; font-weight: 500; border-bottom: 1px solid #e2e8f0;">${affected_entity || 'N/A'}</td>
                </tr>
                <tr style="background: #f8fafc;">
                  <td style="padding: 10px 12px; font-size: 13px; color: #64748b; border-bottom: 1px solid #e2e8f0;">Reviewed By</td>
                  <td style="padding: 10px 12px; font-size: 13px; color: #1e293b; font-weight: 500; border-bottom: 1px solid #e2e8f0;">${checker_name}</td>
                </tr>
                ${checker_comment ? `<tr>
                  <td style="padding: 10px 12px; font-size: 13px; color: #64748b;">Comment</td>
                  <td style="padding: 10px 12px; font-size: 13px; color: #1e293b; font-weight: 500;">${checker_comment}</td>
                </tr>` : ''}
              </table>

              <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 24px;">This is an automated notification from AssetFlow Management System</p>
            </div>
          </div>
        `,
      };

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(emailBody),
      });

      results.email = emailRes.ok ? 'sent' : 'failed';
    }

    // Send SMS via Twilio
    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER && initiator_phone) {
      const smsBody = `AssetFlow: Your action "${title}" has been ${statusLabel} by ${checker_name}.${checker_comment ? ` Comment: ${checker_comment}` : ''} Ref: ${action_id?.slice(0, 8)}`;

      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
      const twilioAuth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

      const smsParams = new URLSearchParams({
        From: TWILIO_PHONE_NUMBER,
        To: initiator_phone,
        Body: smsBody,
      });

      const smsRes = await fetch(twilioUrl, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${twilioAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: smsParams.toString(),
      });

      results.sms = smsRes.ok ? 'sent' : 'failed';
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

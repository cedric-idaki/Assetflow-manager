import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { authenticateCaller, requireStaff } from '../_shared/auth.ts';
import { callerIdentity, openRequest } from '../_shared/http.ts';

const API_VERSIONS = ['2026-08-21'];

// Declare Deno global for type safety
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

serve(async (req) => {
  const api = await openRequest(req, {
    fn: 'maker-checker-notify',
    methods: 'POST, OPTIONS',
    versions: API_VERSIONS,
  });
  if (api.halt) return api.halt;

  // Existing call sites spread `corsHeaders`; pointing it at the per-request
  // headers keeps them working while the values become origin-checked.
  const corsHeaders = api.headers;

  // initiator_email / initiator_phone / title / description / checker_comment are
  // all caller-supplied and go straight into the outgoing mail and SMS body, so
  // unauthenticated this was an arbitrary-content relay. Reached only from the
  // System Administration maker-checker panel: staff-only.
  const auth = await authenticateCaller(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const denied = requireStaff(auth.caller);
  if (denied) {
    return new Response(JSON.stringify({ error: denied.error }), {
      status: denied.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // One approval sends both an email and an SMS with caller-supplied text in
  // the body, so an unmetered loop here is a spam relay that also spends money.
  // Approvals are individual human decisions; 20 a minute is generous.
  const over = await api.enforceLimit({
    action: 'notify',
    identity: callerIdentity(auth.caller),
    limit: 20,
    windowSeconds: 60,
  });
  if (over) return over;

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
        from: 'Ararat <notifications@assetflow.com>',
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
                  <h1 style="margin: 0; font-size: 20px; color: #1e293b;">Ararat</h1>
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

              <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 24px;">This is an automated notification from Ararat Management System</p>
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
      const smsBody = `Ararat: Your action "${title}" has been ${statusLabel} by ${checker_name}.${checker_comment ? ` Comment: ${checker_comment}` : ''} Ref: ${action_id?.slice(0, 8)}`;

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
    return api.fail(error);
  }
});

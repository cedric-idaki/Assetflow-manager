import { supabase } from '../lib/supabase';

/**
 * Shared helpers for the "provision a login → email the temp credentials" flow
 * used across sacco members, clients, staff and sales agents.
 */

// Strong temporary password: >= 8 chars, one of each class, no ambiguous chars
// (same generator as the sacco/client provisioning flows).
export const generateTempPassword = () => {
  const pick = (s) => s[Math.floor(Math.random() * s.length)];
  const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', L = 'abcdefghijkmnpqrstuvwxyz', D = '23456789', SY = '@#$%';
  let password = pick(U) + pick(L) + pick(D) + pick(SY);
  for (let i = 0; i < 8; i++) password += pick(U + L + D + SY);
  return password;
};

/**
 * Email freshly-provisioned login credentials via the send-email Edge Function
 * (Resend). Non-fatal by design: callers may surface the result, but account
 * creation must never fail because of a mail problem.
 *
 * @param {object} opts
 * @param {string} opts.to        recipient email
 * @param {string} opts.type      'staff_welcome' | 'client_welcome' | 'sacco_member_welcome'
 * @param {object} opts.data      template data (fullName, email, password, role, …)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const emailLoginCredentials = async ({ to, type = 'staff_welcome', data }) => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;
    const rawUrl = import.meta.env.VITE_SUPABASE_URL || '';
    const supabaseUrl = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}.supabase.co`;

    const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        type,
        to,
        data: { portalUrl: `${window.location.origin}/login`, ...data },
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || 'Email failed');
    return { success: true };
  } catch (e) {
    console.error('Credentials email failed (non-fatal):', e?.message);
    return { success: false, error: e?.message };
  }
};

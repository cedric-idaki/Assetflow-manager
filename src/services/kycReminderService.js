import { supabase } from '../lib/supabase';

export const triggerKYCReminders = async () => {
  const { data, error } = await supabase?.functions?.invoke('kyc-renewal-reminders', {
    body: {},
  });
  if (error) throw new Error(error.message || 'Failed to trigger KYC reminders');
  return data;
};

export const fetchReminderLogs = async ({ limit = 50, clientId = null } = {}) => {
  let query = supabase
    ?.from('kyc_reminder_logs')
    ?.select('id, client_id, document_type, expiry_date, days_before_expiry, channel, recipient, status, error_message, sent_at, clients(full_name, account_number)')
    ?.order('sent_at', { ascending: false })
    ?.limit(limit);

  if (clientId) {
    query = query?.eq('client_id', clientId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
};

export const fetchReminderStats = async () => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo?.setDate(thirtyDaysAgo?.getDate() - 30);

  const { data, error } = await supabase
    ?.from('kyc_reminder_logs')
    ?.select('channel, status, days_before_expiry')
    ?.gte('sent_at', thirtyDaysAgo?.toISOString());

  if (error) throw new Error(error.message);

  const logs = data || [];
  return {
    totalSent: logs?.filter(l => l?.status === 'sent')?.length,
    totalFailed: logs?.filter(l => l?.status === 'failed')?.length,
    emailsSent: logs?.filter(l => l?.channel === 'email' && l?.status === 'sent')?.length,
    smsSent: logs?.filter(l => l?.channel === 'sms' && l?.status === 'sent')?.length,
    by30Days: logs?.filter(l => l?.days_before_expiry === 30 && l?.status === 'sent')?.length,
    by14Days: logs?.filter(l => l?.days_before_expiry === 14 && l?.status === 'sent')?.length,
    by7Days: logs?.filter(l => l?.days_before_expiry === 7 && l?.status === 'sent')?.length,
  };
};

import { supabase } from '../lib/supabase';

/**
 * Calls the send-sms Edge Function via Supabase
 */
const callSmsFunction = async (type, to, data) => {
  const { data: result, error } = await supabase?.functions?.invoke('send-sms', {
    body: { type, to, data },
  });

  if (error) throw new Error(error.message || 'Failed to invoke SMS function');
  if (result?.error) throw new Error(result.error);
  return result;
};

/**
 * Send payment confirmation SMS
 * @param {string} toPhone - Recipient phone number (E.164 format, e.g. +1234567890)
 * @param {{ transaction, client, asset, allocations }} data
 */
export const sendPaymentConfirmationSMS = async (toPhone, { transaction, client, asset, allocations }) => {
  return callSmsFunction('payment_confirmation', toPhone, { transaction, client, asset, allocations });
};

/**
 * Send payment reminder SMS
 * @param {string} toPhone - Recipient phone number (E.164 format)
 * @param {{ client, payment, asset, daysUntilDue, isOverdue }} data
 */
export const sendPaymentReminderSMS = async (toPhone, { client, payment, asset, daysUntilDue, isOverdue }) => {
  return callSmsFunction('payment_reminder', toPhone, { client, payment, asset, daysUntilDue, isOverdue });
};

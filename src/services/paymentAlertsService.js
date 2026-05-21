import { supabase } from '../lib/supabase';

/**
 * Invoke the payment-alerts edge function
 * @param {'payment_success'|'payment_failure'|'due_date_reminder'|'threshold_breach'} eventType
 * @param {string|null} recipientEmail
 * @param {string|null} recipientPhone
 * @param {string|null} recipientName
 * @param {object} data - Event-specific payload
 */
export const sendPaymentAlert = async (eventType, recipientEmail, recipientPhone, recipientName, data) => {
  const { data: result, error } = await supabase?.functions?.invoke('payment-alerts', {
    body: {
      event_type: eventType,
      recipient_email: recipientEmail || null,
      recipient_phone: recipientPhone || null,
      recipient_name: recipientName || null,
      data,
    },
  });
  if (error) throw new Error(error.message || 'Failed to invoke payment-alerts function');
  return result;
};

/**
 * Send payment success alert
 */
export const sendPaymentSuccessAlert = async (recipientEmail, recipientPhone, recipientName, { transaction, client, amount }) => {
  return sendPaymentAlert('payment_success', recipientEmail, recipientPhone, recipientName, { transaction, client, amount });
};

/**
 * Send payment failure alert
 */
export const sendPaymentFailureAlert = async (recipientEmail, recipientPhone, recipientName, { transaction, client, amount, failureReason, retryInstructions }) => {
  return sendPaymentAlert('payment_failure', recipientEmail, recipientPhone, recipientName, { transaction, client, amount, failureReason, retryInstructions });
};

/**
 * Send due date reminder alert
 */
export const sendDueDateReminderAlert = async (recipientEmail, recipientPhone, recipientName, { client, installment, asset, daysUntilDue }) => {
  return sendPaymentAlert('due_date_reminder', recipientEmail, recipientPhone, recipientName, { client, installment, asset, daysUntilDue });
};

/**
 * Send threshold breach alert
 */
export const sendThresholdBreachAlert = async (recipientEmail, recipientPhone, recipientName, { client, transaction, amount, thresholdType, thresholdLimit, breachAmount }) => {
  return sendPaymentAlert('threshold_breach', recipientEmail, recipientPhone, recipientName, { client, transaction, amount, thresholdType, thresholdLimit, breachAmount });
};

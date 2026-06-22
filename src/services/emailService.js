import { supabase } from '../lib/supabase';

/**
 * Calls the send-email Edge Function via Supabase
 */
const callEmailFunction = async (type, to, data) => {
  const { data: result, error } = await supabase?.functions?.invoke('send-email', {
    body: { type, to, data },
  });

  if (error) throw new Error(error.message || 'Failed to invoke email function');
  if (result?.error) throw new Error(result.error);
  return result;
};

/**
 * Send payment confirmation email
 * @param {string} toEmail - Recipient email
 * @param {{ transaction, client, asset, allocations }} data
 */
export const sendPaymentConfirmation = async (toEmail, { transaction, client, asset, allocations }) => {
  return callEmailFunction('payment_confirmation', toEmail, { transaction, client, asset, allocations });
};

/**
 * Send invoice email
 * @param {string} toEmail - Recipient email
 * @param {{ invoice, client, asset, lineItems }} data
 */
export const sendInvoiceEmail = async (toEmail, { invoice, client, asset, lineItems }) => {
  return callEmailFunction('invoice', toEmail, { invoice, client, asset, lineItems });
};

/**
 * Send account statement email
 * @param {string} toEmail - Recipient email
 * @param {{ client, assets, payments, period }} data
 */
export const sendStatementEmail = async (toEmail, { client, assets, payments, period }) => {
  return callEmailFunction('statement', toEmail, { client, assets, payments, period });
};

/**
 * Send payment reminder email
 * @param {string} toEmail - Recipient email
 * @param {{ client, payment, asset, daysUntilDue, isOverdue }} data
 */
export const sendPaymentReminder = async (toEmail, { client, payment, asset, daysUntilDue, isOverdue }) => {
  return callEmailFunction('payment_reminder', toEmail, { client, payment, asset, daysUntilDue, isOverdue });
};

/**
 * Send a one-time signing OTP code to a signer's email.
 * @param {string} toEmail - Recipient email
 * @param {{ signerName, code, documentName, expiresMinutes }} data
 */
export const sendSigningOtp = async (toEmail, { signerName, code, documentName, expiresMinutes }) => {
  return callEmailFunction('signing_otp', toEmail, { signerName, code, documentName, expiresMinutes });
};

/**
 * Send a security alert when a saved signature is applied to a document.
 * @param {string} toEmail - Recipient email
 * @param {{ ownerName, documentName, actor, time, ip, device }} data
 */
export const sendSignatureAlert = async (toEmail, { ownerName, documentName, actor, time, ip, device }) => {
  return callEmailFunction('esign_security_alert', toEmail, { ownerName, documentName, actor, time, ip, device });
};

/**
 * Invite an external signer with their secure one-time signing link.
 * @param {string} toEmail - Recipient email
 * @param {{ signerName, documentName, link, message, expiresAt }} data
 */
export const sendSigningInvite = async (toEmail, { signerName, documentName, link, message, expiresAt }) => {
  return callEmailFunction('signing_invite', toEmail, { signerName, documentName, link, message, expiresAt });
};

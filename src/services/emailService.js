import { supabase } from '../lib/supabase';

/**
 * Calls the send-email Edge Function via Supabase
 */
const callEmailFunction = async (type, to, data) => {
  const { data: result, error } = await supabase.functions.invoke('send-email', {
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
 * @param {{ invoice, client, asset, lineItems, plan, company }} data
 *   `plan` is the hire-purchase schedule behind the invoice (monthly
 *   installment, tenure, deposit) — omitted for cash sales.
 *   `company` is the selling company the asset came from, which heads the
 *   invoice.
 */
export const sendInvoiceEmail = async (toEmail, { invoice, client, asset, lineItems, plan, company }) => {
  return callEmailFunction('invoice', toEmail, { invoice, client, asset, lineItems, plan, company });
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
 * Confirm to a newly-registered admin that their company / sacco was created.
 * @param {string} toEmail - The admin's email
 * @param {{ adminName, entityName, entityType: 'company'|'sacco', planName, seats, regNumber, sasraLicence, location, city, registeredOn, portalUrl }} data
 */
export const sendAdminRegistrationConfirmation = async (toEmail, data) => {
  return callEmailFunction('admin_registration_confirmation', toEmail, data);
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
 * Tell a gold agent that a bronze agent has asked them for onboarding help.
 * @param {string} toEmail - The gold agent's email
 * @param {{ goldName, bronzeName, bronzeCode, bronzePhone, bronzeEmail, adminName, helpType, note, amount, portalUrl }} data
 */
export const sendAssistRequest = async (toEmail, data) => {
  return callEmailFunction('assist_request', toEmail, data);
};

/**
 * Tell the other party an assist changed hands — accepted, declined, completed
 * or cancelled.
 * @param {string} toEmail - The counterparty's email
 * @param {{ recipientName, actorName, actorCode, status, adminName, outcome, declineReason, amount, portalUrl }} data
 */
export const sendAssistUpdate = async (toEmail, data) => {
  return callEmailFunction('assist_update', toEmail, data);
};

/**
 * Tell an agent a ticket has been raised with them. Sent to the named agent, or
 * to every gold agent when the ticket was left for the pool.
 * @param {string} toEmail - The recipient agent's email
 * @param {{ toName, ticketNo, subject, body, category, priority, fromName, fromCode, fromTier, fromPhone, fromEmail, adminName, isPool, portalUrl }} data
 */
export const sendTicketOpened = async (toEmail, data) => {
  return callEmailFunction('ticket_opened', toEmail, data);
};

/**
 * Tell the other agent on a ticket that a reply has landed.
 * @param {string} toEmail - The counterparty's email
 * @param {{ toName, ticketNo, subject, body, fromName, fromCode, portalUrl }} data
 */
export const sendTicketReply = async (toEmail, data) => {
  return callEmailFunction('ticket_reply', toEmail, data);
};

/**
 * Tell the other agent a ticket changed state — claimed, resolved, closed or
 * reopened.
 * @param {string} toEmail - The counterparty's email
 * @param {{ toName, ticketNo, subject, status, note, actorName, actorCode, portalUrl }} data
 */
export const sendTicketStatus = async (toEmail, data) => {
  return callEmailFunction('ticket_status', toEmail, data);
};

/**
 * Invite an external signer with their secure one-time signing link.
 * @param {string} toEmail - Recipient email
 * @param {{ signerName, documentName, link, message, expiresAt }} data
 */
export const sendSigningInvite = async (toEmail, { signerName, documentName, link, message, expiresAt }) => {
  return callEmailFunction('signing_invite', toEmail, { signerName, documentName, link, message, expiresAt });
};

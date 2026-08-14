/**
 * Shareable listing links — the sales agent's side.
 *
 * An agent picks an item out of their tenant's catalogue and sends a buyer a
 * link. The link carries the agent's id, so when the buyer enquires the lead
 * lands on that agent and the commission is attributable. See
 * supabase/migrations/20260813140000_agent_asset_share_links.sql.
 *
 * Minting and revoking are RPCs — the tables have no INSERT/UPDATE policy, so
 * an agent cannot mint a link for another tenant's asset or edit their own
 * view counts. Nothing here decides attribution; the database does, from the
 * token.
 */

import { supabase } from '../lib/supabase';
import { logger } from '../utils/logger';

/** Public page for a token. Same origin as the portal — the route is in Routes.jsx. */
export const listingUrl = (token) =>
  token ? `${window.location.origin}/listing/${token}` : '';

/**
 * Kenyan MSISDN in the form wa.me wants: digits, country code, no '+'.
 * Returns null when there is nothing usable, so callers can hide the channel
 * rather than open WhatsApp on a broken number.
 */
export const toWhatsAppNumber = (raw) => {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('0')  && digits.length === 10) return `254${digits.slice(1)}`;
  if (digits.length === 9 && /^[17]/.test(digits))     return `254${digits}`;
  // Already international (some other country) — take it as given.
  if (digits.length >= 11) return digits;
  return null;
};

/** The message the agent sends. Deliberately short: it is read on a phone. */
export const buildShareMessage = ({ agentName, assetTitle, price, location, url, note }) => {
  const lines = [];
  if (assetTitle) lines.push(`*${assetTitle}*`);

  const facts = [];
  if (price)    facts.push(formatPrice(price));
  if (location) facts.push(location);
  if (facts.length) lines.push(facts.join(' · '));

  if (note) lines.push('', note);
  if (url)  lines.push('', url);
  if (agentName) lines.push('', `— ${agentName}`);

  return lines.join('\n');
};

export const formatPrice = (value) => {
  const n = Number(value || 0);
  if (!n) return '';
  return new Intl.NumberFormat('en-KE', {
    style: 'currency', currency: 'KES', minimumFractionDigits: 0,
  }).format(n);
};

export const whatsappHref = (phone, text) => {
  const msisdn = toWhatsAppNumber(phone);
  const q = `text=${encodeURIComponent(text || '')}`;
  return msisdn ? `https://wa.me/${msisdn}?${q}` : `https://wa.me/?${q}`;
};

export const smsHref = (phone, text) =>
  `sms:${String(phone || '').replace(/\s/g, '')}?body=${encodeURIComponent(text || '')}`;

/**
 * Mint (or reuse) a link for this asset and recipient.
 *
 * Re-sharing the same item with the same person returns the SAME token, so the
 * view and enquiry counts stay on one row instead of scattering across a dozen
 * near-identical links.
 *
 * @returns {Promise<{ link: object, url: string }>}
 */
export const createShareLink = async ({
  assetId,
  leadId = null,
  recipientName = null,
  recipientPhone = null,
  recipientEmail = null,
  channel = 'copy',
  note = null,
  expiresDays = 30,
} = {}) => {
  if (!assetId) throw new Error('Pick an item to share first.');

  const { data, error } = await supabase.rpc('create_asset_share_link', {
    p_asset_id:        assetId,
    p_lead_id:         leadId,
    p_recipient_name:  recipientName,
    p_recipient_phone: recipientPhone,
    p_recipient_email: recipientEmail,
    p_channel:         channel,
    p_note:            note,
    p_expires_days:    expiresDays,
  });

  if (error) {
    logger.error('[shareLinkService.createShareLink]', { message: error.message });
    throw new Error(error.message || 'Could not create the link.');
  }

  // The RPC returns the table row; PostgREST hands back either the row or a
  // single-element array depending on how it resolves the composite type.
  const link = Array.isArray(data) ? data[0] : data;
  if (!link?.token) throw new Error('The link could not be created.');

  return { link, url: listingUrl(link.token) };
};

/** Stop a link opening. Its stats survive so the agent's history stays honest. */
export const revokeShareLink = async (id) => {
  const { data, error } = await supabase.rpc('revoke_asset_share_link', { p_id: id });
  if (error) {
    logger.error('[shareLinkService.revokeShareLink]', { message: error.message });
    throw new Error(error.message || 'Could not withdraw the link.');
  }
  return data === true;
};

/**
 * Email the link to the buyer, through the same Edge Function the rest of the
 * app sends with. WhatsApp and SMS open the agent's own client instead — the
 * agent presses send there, which is what a buyer expects to receive.
 */
export const emailShareLink = async ({
  to, recipientName, agentName, agentPhone, assetName, price, location, note, url,
}) => {
  const { error } = await supabase.functions.invoke('send-email', {
    body: {
      type: 'listing_share',
      to,
      data: {
        recipientName, agentName, agentPhone,
        assetName, price, location, note,
        listingUrl: url,
      },
    },
  });

  if (error) {
    logger.error('[shareLinkService.emailShareLink]', { message: error.message });
    throw new Error('The link was created but the email did not send. Copy it and send it yourself.');
  }
  return true;
};

/** Copy helper that survives the non-secure contexts the portal gets opened in. */
export const copyText = async (text) => {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea path */
  }

  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
};

export default {
  listingUrl,
  toWhatsAppNumber,
  buildShareMessage,
  formatPrice,
  whatsappHref,
  smsHref,
  createShareLink,
  revokeShareLink,
  emailShareLink,
  copyText,
};

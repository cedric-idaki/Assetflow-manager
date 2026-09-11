/// <reference lib="deno.ns" />
/**
 * THE RESEND SENDER — ONE SPELLING OF WHO THE MAIL IS FROM.
 *
 * WHY THIS EXISTS
 * ---------------
 * Four functions post to Resend and each carried its own `from:` string, so
 * they drifted into two wrong answers:
 *
 *   payment-alerts, maker-checker-notify  `Ararat <notifications@assetflow.com>`
 *       — a domain the portal left behind when it moved to araratsbc.com
 *         (see docu/DOMAIN_MIGRATION.md).
 *   send-email, kyc-renewal-reminders     `onboarding@resend.dev`
 *       — Resend's sandbox address, which delivers ONLY to the Resend account
 *         owner. Those sends looked successful and reached no client.
 *         send-email at least read EMAIL_FROM first; kyc-renewal-reminders
 *         ignored the secret entirely and always used the sandbox.
 *
 * EMAIL_FROM, the Edge Function secret, still wins: the sender can be changed
 * without a deploy. What changed is the fallback. It is now a real Ararat
 * address rather than the sandbox one, so a deploy that forgot the secret
 * fails loudly at Resend instead of quietly delivering to a single inbox.
 *
 * BEFORE THIS SENDS: araratsbc.com must be verified in Resend — its DKIM and
 * SPF records published in the domain's DNS zone. Until then Resend rejects
 * every send from this address with a domain-not-verified error.
 */
export const EMAIL_FROM =
  Deno.env.get('EMAIL_FROM') || 'Ararat <notifications@araratsbc.com>';

import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { invokeSupabaseFunction } from '../../../lib/supabase';
import { toWhatsAppNumber } from '../../../services/shareLinkService';

/**
 * Send a POS receipt to the customer, by WhatsApp or by email.
 *
 * WHY THE TWO CHANNELS CARRY DIFFERENT THINGS, AND WHY THAT IS NOT A BUG.
 *
 *   Email gets the receipt. The send-email function renders it server-side
 *   from the same figures the paper does, so what lands in the inbox is the
 *   document, not a description of it.
 *
 *   WhatsApp gets a summary. wa.me is a link, not an API: it opens a chat with
 *   a pre-filled message and can carry TEXT and nothing else. There is no
 *   attachment slot to put a PDF in. Pretending otherwise — say, by linking to
 *   a "download your receipt" URL — would mean publishing every customer's
 *   receipt at a guessable address, which is a worse trade than a message that
 *   states the amount, the reference and where the full copy is.
 *
 * NEITHER CHANNEL IS A SUBSTITUTE FOR THE PAPER. A till still prints; this is
 * for the customer who would rather have it on their phone, and for the one
 * who is halfway to the car park when they remember to ask.
 *
 * SENDING IS NOT SILENT. Both buttons report what happened. A receipt the
 * customer never got, reported as sent, is worse than one that visibly failed:
 * the second gets retried.
 */
const ReceiptShare = ({
  client, asset, saleData = {}, companyProfile,
  receiptNo, invoiceNo, issuedAt, cashier, buyerKraPin,
}) => {
  const [email, setEmail]     = useState(client?.email || '');
  const [phone, setPhone]     = useState(client?.phone || '');
  const [open, setOpen]       = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus]   = useState(null); // { ok, message }

  const money = (n) =>
    `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const docRef  = receiptNo || invoiceNo || '';
  const balance = Number(saleData.financeBalance || 0);
  const paid    = balance > 0
    ? Number(saleData.depositAmount || 0)
    : Number(saleData.totalAmount || 0);

  /** The WhatsApp text. Short on purpose — it is read on a phone, in a queue. */
  const message = [
    `*${companyProfile?.company_name || 'Receipt'}*`,
    `Receipt ${docRef}`,
    '',
    asset?.description || '',
    `Total: ${money(saleData.totalAmount)}`,
    balance > 0 ? `Balance: ${money(balance)}` : 'Paid in full',
    '',
    'Thank you for your business.',
  ].join('\n');

  const waNumber = toWhatsAppNumber(phone);

  const sendWhatsApp = () => {
    if (!waNumber) {
      setStatus({ ok: false, message: 'That number is not one WhatsApp can open. Check it and try again.' });
      return;
    }
    window.open(
      `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`,
      '_blank', 'noopener,noreferrer',
    );
    // "Opened", not "sent": the message is not sent until the customer's
    // WhatsApp is on screen and somebody presses send. Claiming otherwise would
    // have a till reporting a delivery nobody made.
    setStatus({ ok: true, message: 'WhatsApp opened with the receipt summary. Press send there to deliver it.' });
  };

  const sendEmail = async () => {
    const to = email.trim();
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      setStatus({ ok: false, message: 'Enter a valid email address.' });
      return;
    }
    setSending(true);
    setStatus(null);
    try {
      const { error } = await invokeSupabaseFunction('send-email', {
        body: {
          type: 'pos_receipt',
          to,
          data: {
            receiptNo: docRef,
            issuedAt:  issuedAt || new Date().toISOString(),
            cashier:   cashier || '',
            company: {
              name:    companyProfile?.company_name || 'Ararat Management',
              kraPin:  companyProfile?.kra_pin || '',
              phone:   companyProfile?.phone || '',
              email:   companyProfile?.email || '',
              address: companyProfile?.address || '',
            },
            customer: {
              name:    client?.full_name || 'Walk-in Customer',
              account: client?.account_number || '',
              phone:   client?.phone || '',
              // The PIN captured for THIS sale, falling back to the one on
              // file — the same order the printed receipt resolves it in.
              kraPin:  buyerKraPin || client?.kra_pin || '',
            },
            item: {
              description: asset?.description || 'Asset',
              code:        asset?.asset_code || '',
            },
            amounts: {
              gross:    saleData.sellingPrice,
              discount: saleData.discountAmount,
              vat:      saleData.vatAmount,
              total:    saleData.totalAmount,
              paid,
              balance,
            },
            paymentMethod: saleData.paymentMethod || '',
            paymentRef:    saleData.mpesaRef || saleData.bankRef || '',
          },
        },
      });
      if (error) throw new Error(error.message || 'The email could not be sent.');
      setStatus({ ok: true, message: `Receipt emailed to ${to}.` });
    } catch (err) {
      setStatus({ ok: false, message: err?.message || 'The email could not be sent. The receipt has not gone out.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
      >
        <span className="flex items-center gap-2">
          <Icon name="Send" size={14} color="currentColor" />
          Send to customer
        </span>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} color="currentColor" />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1" htmlFor="receipt-share-email">
              Email
            </label>
            <div className="flex gap-2">
              <input
                id="receipt-share-email"
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="customer@example.com"
                className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-xl text-foreground"
              />
              <button
                type="button" onClick={sendEmail} disabled={sending}
                className="px-3 py-2 rounded-xl text-xs font-semibold bg-primary text-primary-foreground disabled:opacity-50"
              >
                {sending ? 'Sending…' : 'Email'}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1" htmlFor="receipt-share-phone">
              WhatsApp
            </label>
            <div className="flex gap-2">
              <input
                id="receipt-share-phone"
                type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                placeholder="07xx xxx xxx"
                className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-xl text-foreground"
              />
              <button
                type="button" onClick={sendWhatsApp}
                className="px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-600 text-white"
              >
                WhatsApp
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              WhatsApp carries a summary — the full receipt goes by email or on paper.
            </p>
          </div>

          {status && (
            <div className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${
              status.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                        : 'bg-red-50 border border-red-200 text-red-700'}`}>
              <Icon name={status.ok ? 'CheckCircle2' : 'AlertCircle'} size={13}
                color={status.ok ? '#059669' : '#dc2626'} />
              <span>{status.message}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ReceiptShare;

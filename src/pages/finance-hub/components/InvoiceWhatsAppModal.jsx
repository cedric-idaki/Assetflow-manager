import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { toWhatsAppNumber, whatsappHref } from '../../../services/shareLinkService';
import { buildInvoiceDocument } from '../../../utils/accountingDocument';
import { SHARE_LINK_DAYS } from '../../../utils/documentArchive';
import { loadJsPDF } from '../../../utils/jsPdfLoader';
import {
  buildInvoiceWhatsAppMessage, createInvoiceShareLink, displayMsisdn,
} from '../../../utils/invoiceWhatsApp';
import { S } from './_shared';

/**
 * "Send via WhatsApp" for one invoice.
 *
 * WHATSAPP DOES THE SENDING, NOT THIS DIALOG. wa.me opens the client's chat
 * with the message typed in, and it is not sent until somebody presses Send
 * there. So every status here says OPENED, never SENT — a finance screen
 * reporting a delivery nobody made is how an invoice sits unpaid for a month
 * with everyone sure it went out.
 *
 * THE NUMBER IS CONFIRMED, NOT ASSUMED. It is prefilled from the invoice, but a
 * client's WhatsApp is often not the phone on their record, and a hand-raised
 * invoice may carry no number at all.
 *
 * THE LINK IS MADE ON SEND, not when the dialog opens: opening it to look must
 * not file a copy of a document nobody sent.
 */

// Where the link will sit in the preview until there is one.
const LINK_PENDING = '[a link to the PDF is added here when WhatsApp opens]';

// *bold* the way WhatsApp will show it, so the preview reads like the message.
const WhatsAppText = ({ text }) => text.split('\n').map((line, i) => (
  <React.Fragment key={i}>
    {line.split(/(\*[^*\n]+\*)/g).map((part, j) => (
      /^\*[^*\n]+\*$/.test(part)
        ? <strong key={j}>{part.slice(1, -1)}</strong>
        : <React.Fragment key={j}>{part}</React.Fragment>
    ))}
    {'\n'}
  </React.Fragment>
));

const InvoiceWhatsAppModal = ({ invoice, company, onClose }) => {
  const [phone,    setPhone]    = useState(invoice?.client_phone || '');
  const [withLink, setWithLink] = useState(true);
  const [busy,     setBusy]     = useState(false);
  const [status,   setStatus]   = useState(null);   // { ok, message }
  const [blocked,  setBlocked]  = useState(null);   // a wa.me href the pop-up blocker stopped
  // The link made for this invoice as it stands. Pressing again — after a
  // blocked pop-up, or a WhatsApp tab closed too soon — reuses it instead of
  // filing a second copy. Keyed on the status too: once paid, the document is
  // a receipt, and the old link would open the unpaid invoice.
  const [link,     setLink]     = useState(null);   // { key, url }
  const phoneRef = useRef(null);

  const model   = useMemo(() => buildInvoiceDocument({ invoice, company }), [invoice, company]);
  const noun    = model.kind === 'receipt' ? 'receipt' : 'invoice';
  const msisdn  = toWhatsAppNumber(phone);
  const linkKey = `${invoice?.id}|${invoice?.status}`;
  const madeUrl = link?.key === linkKey ? link.url : null;

  const preview = useMemo(
    () => buildInvoiceWhatsAppMessage({ invoice, company, link: withLink ? (madeUrl || LINK_PENDING) : null }),
    [invoice, company, withLink, madeUrl],
  );

  // Fetch the PDF engine while the number is being checked. The first send
  // should not also be the first CDN download: the longer the wait after the
  // click, the likelier the browser treats the WhatsApp tab as a pop-up.
  useEffect(() => { loadJsPDF().catch(() => {}); }, []);

  useEffect(() => { phoneRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const reset = () => { setStatus(null); setBlocked(null); };

  const openWhatsApp = async () => {
    if (busy) return;
    if (!msisdn) {
      setStatus({ ok: false, message: 'Enter a number WhatsApp can open, e.g. 0712 345 678 or +254 712 345 678.' });
      phoneRef.current?.focus();
      return;
    }

    setBusy(true);
    reset();
    try {
      let url = null;
      if (withLink) {
        url = madeUrl;
        if (!url) {
          const made = await createInvoiceShareLink({ invoice, company });
          url = made.url;
          setLink({ key: linkKey, url });
        }
      }

      const href = whatsappHref(msisdn, buildInvoiceWhatsAppMessage({ invoice, company, link: url }));
      // Not 'noopener': with it window.open always returns null, so a blocked
      // pop-up could not be told from an opened one. The opener is cut by hand
      // instead, before WhatsApp's page has loaded.
      const tab = window.open(href, '_blank');
      if (tab) {
        try { tab.opener = null; } catch { /* already cross-origin */ }
        setStatus({
          ok: true,
          message: `WhatsApp opened a chat with ${displayMsisdn(msisdn)}. Press Send there to deliver the ${noun}.`,
        });
      } else {
        setBlocked(href);
        setStatus({ ok: false, message: 'Your browser stopped WhatsApp from opening. The message is ready — use “Open WhatsApp” below.' });
      }
    } catch (e) {
      setStatus({
        ok: false,
        message: `${e?.message || 'The PDF link could not be created.'} WhatsApp was not opened. Try again, or untick the PDF link to send the details on their own.`,
      });
    } finally {
      setBusy(false);
    }
  };

  const hint = !phone.trim()
    ? { tone: 'text-amber-600 dark:text-amber-400', text: 'No number on file for this client — type their WhatsApp number.' }
    : msisdn
      ? { tone: 'text-muted-foreground', text: `Opens a chat with ${displayMsisdn(msisdn)}` }
      : { tone: 'text-red-600 dark:text-red-400', text: 'WhatsApp cannot open that number — check the digits.' };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}
    >
      <div
        role="dialog" aria-modal="true" aria-labelledby="wa-invoice-title"
        className="w-full sm:max-w-lg max-h-[92vh] flex flex-col bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
              <Icon name="MessageCircle" size={17} color="#059669" />
            </div>
            <div className="min-w-0">
              <h2 id="wa-invoice-title" className="text-base font-semibold text-foreground">Send via WhatsApp</h2>
              <p className="text-xs text-muted-foreground truncate">
                {model.title} {model.docNo}{model.party?.name && model.party.name !== '—' ? ` · ${model.party.name}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button" onClick={onClose} disabled={busy} aria-label="Close"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <Icon name="X" size={16} color="currentColor" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div>
            <label htmlFor="wa-invoice-phone" className={S.label}>Client&apos;s WhatsApp number</label>
            <input
              id="wa-invoice-phone" ref={phoneRef}
              type="tel" inputMode="tel" autoComplete="off"
              className={S.input} placeholder="07xx xxx xxx"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); reset(); }}
              onKeyDown={(e) => { if (e.key === 'Enter') openWhatsApp(); }}
            />
            <p className={`text-xs mt-1.5 ${hint.tone}`}>{hint.text}</p>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox" checked={withLink}
              onChange={(e) => { setWithLink(e.target.checked); reset(); }}
              className="mt-0.5 rounded border-border text-emerald-600 focus:ring-emerald-500"
            />
            <span className="text-sm text-foreground">
              Include a link to the PDF {noun}
              <span className="block text-xs text-muted-foreground">
                A copy is filed in the Document Archive. The link stops working after {SHARE_LINK_DAYS} days.
              </span>
            </span>
          </label>

          <div>
            <p className={S.label}>Message</p>
            <div
              data-testid="wa-invoice-preview"
              className="rounded-xl border border-emerald-200/70 dark:border-emerald-800/50 bg-emerald-50/70 dark:bg-emerald-900/20 px-3.5 py-3 text-[13px] leading-relaxed text-foreground whitespace-pre-wrap break-words max-h-64 overflow-y-auto"
            >
              <WhatsAppText text={preview} />
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">You can still edit it in WhatsApp before you press Send.</p>
          </div>

          {status && (
            <div
              role={status.ok ? 'status' : 'alert'}
              className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${
                status.ok
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-300'
                  : 'bg-red-50 border border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300'}`}
            >
              <Icon name={status.ok ? 'CheckCircle2' : 'AlertCircle'} size={13} color="currentColor" className="mt-px shrink-0" />
              <span>{status.message}</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-3.5 border-t border-border">
          {blocked && (
            <a
              href={blocked} target="_blank" rel="noopener noreferrer"
              onClick={() => {
                setBlocked(null);
                setStatus({ ok: true, message: `WhatsApp opened a chat with ${displayMsisdn(msisdn)}. Press Send there to deliver the ${noun}.` });
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/20 transition-colors"
            >
              <Icon name="ExternalLink" size={14} color="currentColor" /> Open WhatsApp
            </a>
          )}
          <button type="button" className={S.btnSec} onClick={onClose} disabled={busy}>
            {status?.ok ? 'Done' : 'Cancel'}
          </button>
          <button
            type="button" onClick={openWhatsApp} disabled={busy}
            className="inline-flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-60"
          >
            {busy
              ? <><Icon name="Loader" size={14} color="currentColor" className="animate-spin" /> {withLink && !madeUrl ? 'Preparing the PDF…' : 'Opening…'}</>
              : <><Icon name="MessageCircle" size={14} color="currentColor" /> Open in WhatsApp</>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InvoiceWhatsAppModal;

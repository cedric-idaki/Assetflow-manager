/**
 * QR loader — for the KRA verification code a tax receipt has to carry.
 *
 * Modelled exactly on src/utils/jsPdfLoader.js, for the same reasons: the
 * library is only needed by the handful of screens that print a compliant
 * receipt, so it is fetched on first use rather than bundled; the load is ONE
 * promise every caller awaits, so a CDN failure rejects all of them instead of
 * leaving a polling timer running against a promise that never settles; and the
 * failed tag is dropped so the next attempt starts clean.
 *
 * ── WHY A QR AT ALL, AND WHY FAILING TO DRAW ONE IS NOT FATAL ───────────────
 * An eTIMS receipt carries a QR encoding the KRA verification URL, which is how
 * anyone holding the paper checks the sale was really filed. It is required.
 *
 * But it is a RENDERING of data the receipt already prints in full: the
 * verification URL, the receipt signature and the control unit id are all on
 * the document as text (see posReceiptDocument.js). So a receipt printed while
 * the CDN is unreachable is missing its QR and nothing else — every fact it
 * encodes is still legible and still verifiable by hand.
 *
 * That is the right trade at a till. The alternative — refusing to print until
 * a script downloads — would stop a shop handing customers receipts because of
 * a network fault, which is the same mistake the whole eTIMS design here exists
 * to avoid (see supabase/migrations/20260902160000_etims_integration.sql).
 */

const SRC = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
const TAG_ID = 'qrcode-script';

let pending = null;

const inject = () => new Promise((resolve, reject) => {
  const script = document.createElement('script');
  script.id = TAG_ID;
  script.src = SRC;
  script.onload = () => (typeof window.qrcode === 'function'
    ? resolve(window.qrcode)
    : reject(new Error('The QR library loaded but did not register.')));
  script.onerror = () => reject(new Error('Could not load the QR library.'));
  document.head.appendChild(script);
});

export const loadQrCode = () => {
  if (typeof window !== 'undefined' && typeof window.qrcode === 'function') {
    return Promise.resolve(window.qrcode);
  }
  if (!pending) {
    pending = inject().catch((e) => {
      pending = null;
      document.getElementById(TAG_ID)?.remove();
      throw e;
    });
  }
  return pending;
};

/**
 * Render `text` as a PNG data URI, or null if it cannot be drawn.
 *
 * Never throws. A caller is printing a receipt: it wants an image or nothing,
 * and it must not have to wrap this in a try/catch to keep a customer's paper
 * coming out of the printer.
 *
 * Type number 0 lets the library pick the smallest symbol that fits, and 'M'
 * (15% recovery) is the level KRA's own documentation uses — enough to survive
 * thermal print, not so much that the symbol grows past the width of an 80mm
 * roll.
 */
export const qrDataUri = async (text, { cellSize = 3, margin = 2 } = {}) => {
  if (!text) return null;
  try {
    const qrcode = await loadQrCode();
    const qr = qrcode(0, 'M');
    qr.addData(String(text));
    qr.make();
    return qr.createDataURL(cellSize, margin);
  } catch {
    // Deliberately silent — see the header. The receipt prints without it.
    return null;
  }
};

export default qrDataUri;

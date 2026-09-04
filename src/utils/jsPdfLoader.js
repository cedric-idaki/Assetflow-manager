/**
 * jsPDF loader — one script tag, shared by every PDF this app produces.
 *
 * The library is a few hundred KB and only a handful of screens ever ask for a
 * PDF, so it is fetched from the CDN on first use rather than bundled.
 *
 * Each generator used to carry its own copy of this loader, and every copy had
 * the same hole: a caller that arrived while the tag was still in flight polled
 * `window.jspdf` on an interval that nothing ever cleared, so a CDN failure
 * left a timer running and a promise that never settled — the download button
 * simply spun forever. Here the load is one promise every caller awaits, so a
 * failure rejects all of them, and the failed tag is dropped so the next
 * attempt starts clean instead of inheriting a dead one.
 */
const SRC = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const TAG_ID = 'jspdf-script';

let pending = null;

const inject = () => new Promise((resolve, reject) => {
  const script = document.createElement('script');
  script.id  = TAG_ID;
  script.src = SRC;
  script.onload = () => window.jspdf?.jsPDF
    ? resolve(window.jspdf.jsPDF)
    : reject(new Error('The PDF library loaded but did not register.'));
  script.onerror = () => reject(new Error('Could not load the PDF library. Check your connection and try again.'));
  document.head.appendChild(script);
});

export const loadJsPDF = () => {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
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
 * TEXT THE STANDARD PDF FONTS CAN ACTUALLY DRAW.
 *
 * jsPDF's built-in Helvetica is encoded WinAnsi (cp1252). Hand it anything
 * outside that and it does not fall back or drop the character — it mangles the
 * WHOLE string: "≤ 30 Days" came out of the KYC expiry report as
 * `"d    3 0    D a y s`. Silent, and only visible once somebody prints it.
 *
 * Two characters this app meets constantly are outside cp1252: the ≤ and ≥ in
 * every bucket label, and the ũ in Kenyan names like Wanjirũ. So symbols get an
 * ASCII spelling, and everything else is stripped back to its base letter
 * through NFD — Wanjirũ prints as Wanjiru, which is readable and wrong in a way
 * a reader can see past, rather than illegible and wrong in a way they cannot.
 *
 * Embedding a Unicode font would fix it properly and costs a ~300KB TTF on
 * every PDF; not worth it until something actually needs non-Latin script.
 */
const SYMBOLS = {
  '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~', '≡': '=',
  '→': '->', '←': '<-', '↔': '<->', '↑': '^', '↓': 'v',
  '−': '-', '‒': '-', '⁻': '-', '№': 'No.', '∞': 'inf',
  '☑': '[x]', '☐': '[ ]', '✓': 'v', '✗': 'x', '★': '*',
};

// Printable ASCII, Latin-1, and the punctuation cp1252 adds in 0x80-0x9F.
const DRAWABLE = /[\u0020-\u007e\u00a0-\u00ff\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178]/;

export const pdfSafeText = (value) => {
  const s = String(value ?? '');
  let out = '';
  for (const ch of s) {
    if (DRAWABLE.test(ch)) { out += ch; continue; }
    if (SYMBOLS[ch] !== undefined) { out += SYMBOLS[ch]; continue; }
    // Strip the accent and keep the letter; drop what is left if even the base
    // form is undrawable.
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
    out += [...base].filter((c) => DRAWABLE.test(c)).join('');
  }
  return out;
};

export default loadJsPDF;

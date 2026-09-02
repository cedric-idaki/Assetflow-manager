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

export default loadJsPDF;

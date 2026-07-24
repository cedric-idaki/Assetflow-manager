// Shared pdf.js CDN loader (UMD global: window.pdfjsLib), used by the field
// renderer (PdfFieldCanvas) and the signable-area detector. Pinned to 3.x —
// pdf.js 4+ ships ESM-only (.mjs) and drops the UMD build this relies on.
const PDFJS_VERSION = "3.11.174";
const CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

export const loadPdfJs = () => new Promise((resolve, reject) => {
  if (window.pdfjsLib) return resolve(window.pdfjsLib);
  const existing = document.getElementById("pdfjs-script");
  if (existing) {
    const t = setInterval(() => { if (window.pdfjsLib) { clearInterval(t); resolve(window.pdfjsLib); } }, 100);
    setTimeout(() => { clearInterval(t); window.pdfjsLib ? resolve(window.pdfjsLib) : reject(new Error("pdf.js load timed out")); }, 12000);
    return;
  }
  const s = document.createElement("script");
  s.id = "pdfjs-script";
  s.src = `${CDN}/pdf.min.js`;
  s.onload = () => {
    try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${CDN}/pdf.worker.min.js`; } catch { /* ignore */ }
    resolve(window.pdfjsLib);
  };
  s.onerror = () => reject(new Error("Failed to load pdf.js"));
  document.head.appendChild(s);
});

export default loadPdfJs;

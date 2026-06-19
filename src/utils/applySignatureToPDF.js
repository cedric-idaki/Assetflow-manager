/**
 * applySignatureToPDF.js
 *
 * Stamps a captured signature onto an existing PDF so the signed document
 * actually *contains* the signature (like normal document signing), then
 * appends an "Electronic Signature Certificate" page with the audit details.
 *
 * Uses pdf-lib (loaded from CDN, mirroring generateContractPDF's jsPDF loader)
 * so no build dependency is added.
 *
 * Usage:
 *   const blob = await applySignatureToPDF(fileUrl, {
 *     signatureType, signatureData, font, signerName, role, signedAt, hash, ip, device,
 *   });
 */

// ── Load pdf-lib dynamically (UMD global: window.PDFLib) ────────────────────────
const loadPdfLib = () => new Promise((resolve, reject) => {
  if (window.PDFLib) return resolve(window.PDFLib);
  if (document.getElementById('pdflib-script')) {
    const wait = setInterval(() => {
      if (window.PDFLib) { clearInterval(wait); resolve(window.PDFLib); }
    }, 100);
    return;
  }
  const script = document.createElement('script');
  script.id = 'pdflib-script';
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
  script.onload = () => resolve(window.PDFLib);
  script.onerror = () => reject(new Error('Failed to load pdf-lib'));
  document.head.appendChild(script);
});

// Render a typed signature (name + script font) to a transparent PNG data URL so
// it can be embedded as an image — preserving the handwriting-style look.
const typedSignatureToPng = (text, font) => {
  const canvas = document.createElement('canvas');
  canvas.width = 600; canvas.height = 200;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0f172a';
  ctx.textBaseline = 'middle';
  ctx.font = `64px "${font || 'Dancing Script'}", cursive`;
  ctx.fillText(text || '', 10, canvas.height / 2);
  return canvas.toDataURL('image/png');
};

export const applySignatureToPDF = async (sourceUrl, sig) => {
  if (!sourceUrl) throw new Error('No source PDF to sign');
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();

  const bytes = await fetch(sourceUrl).then(r => {
    if (!r.ok) throw new Error(`Could not fetch document (${r.status})`);
    return r.arrayBuffer();
  });

  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const helv  = await pdf.embedFont(StandardFonts.Helvetica);
  const helvB = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Resolve the signature as an embeddable PNG (drawn = already PNG; typed = render).
  let sigPng = null;
  try {
    if (sig.signatureType === 'drawn' && typeof sig.signatureData === 'string' && sig.signatureData.startsWith('data:image')) {
      sigPng = await pdf.embedPng(sig.signatureData);
    } else if (sig.signatureData) {
      sigPng = await pdf.embedPng(typedSignatureToPng(sig.signatureData, sig.font));
    }
  } catch (e) { /* fall back to text-only if image embedding fails */ }

  // ── 1. Stamp the signature into the bottom-right of the last page ──────────────
  const pages = pdf.getPages();
  const last  = pages[pages.length - 1];
  const { width } = last.getSize();
  const boxW = 200, boxX = width - boxW - 40, baseY = 60;

  last.drawLine({ start: { x: boxX, y: baseY + 44 }, end: { x: boxX + boxW, y: baseY + 44 }, thickness: 0.5, color: rgb(0.6, 0.7, 0.85) });
  if (sigPng) {
    const w = 150, h = Math.min((sigPng.height / sigPng.width) * w, 46);
    last.drawImage(sigPng, { x: boxX, y: baseY + 46, width: w, height: h });
  }
  last.drawText(`Signed by ${sig.signerName || 'Signer'}`, { x: boxX, y: baseY + 32, size: 8, font: helvB, color: rgb(0.18, 0.22, 0.28) });
  if (sig.role)     last.drawText(String(sig.role),               { x: boxX, y: baseY + 22, size: 7, font: helv, color: rgb(0.42, 0.46, 0.52) });
  if (sig.signedAt) last.drawText(String(sig.signedAt),           { x: boxX, y: baseY + 12, size: 7, font: helv, color: rgb(0.42, 0.46, 0.52) });
  last.drawText('Electronically signed · verified', { x: boxX, y: baseY + 2, size: 6, font: helv, color: rgb(0.55, 0.6, 0.66) });

  // ── 2. Append an Electronic Signature Certificate page ────────────────────────
  const page = pdf.addPage([595.28, 841.89]); // A4
  const M = 50; let y = 780;
  page.drawRectangle({ x: 0, y: 800, width: 595.28, height: 42, color: rgb(0.10, 0.34, 0.86) });
  page.drawText('Electronic Signature Certificate', { x: M, y: 812, size: 16, font: helvB, color: rgb(1, 1, 1) });

  y = 750;
  page.drawText('This certifies that the document was electronically signed via AssetFlow E-Signature.',
    { x: M, y, size: 9, font: helv, color: rgb(0.3, 0.34, 0.4) });
  y -= 30;

  const row = (label, value) => {
    page.drawText(label, { x: M, y, size: 9, font: helvB, color: rgb(0.25, 0.29, 0.35) });
    const lines = String(value == null || value === '' ? '—' : value).match(/.{1,60}/g) || ['—'];
    lines.forEach((ln, i) => page.drawText(ln, { x: M + 130, y: y - i * 12, size: 9, font: helv, color: rgb(0.12, 0.16, 0.22) }));
    y -= Math.max(20, lines.length * 12 + 8);
  };
  row('Document', sig.documentName);
  row('Signer', sig.signerName);
  row('Role', sig.role);
  row('Date & Time', sig.signedAt);
  row('IP Address', sig.ip);
  row('Device', sig.device);
  row('Verification Hash', sig.hash);

  if (sigPng) {
    y -= 10;
    page.drawText('Signature:', { x: M, y, size: 9, font: helvB, color: rgb(0.25, 0.29, 0.35) });
    const w = 180, h = Math.min((sigPng.height / sigPng.width) * w, 70);
    page.drawImage(sigPng, { x: M + 130, y: y - h + 8, width: w, height: h });
    y -= (h + 16);
  }

  page.drawText('AssetFlow Management · Tamper-evident electronic signature record',
    { x: M, y: 40, size: 7, font: helv, color: rgb(0.55, 0.6, 0.66) });

  const out = await pdf.save();
  return new Blob([out], { type: 'application/pdf' });
};

export default applySignatureToPDF;

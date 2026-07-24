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

// Stamp a compact signing footer on every original page, so each page — not
// just the appended certificate — carries the signature evidence (brand,
// document name, verification hash, "Page X of Y"). Call BEFORE appending the
// certificate page so the footer lands only on the document's own pages.
const stampPageFooters = (pages, { helv, helvB, rgb }, meta = {}) => {
  // total defaults to the pages passed, but callers stamp the document's own
  // pages while counting the appended certificate page too, so page numbering
  // (incl. the certificate) reads e.g. "Page 4 of 5".
  const total = meta.totalPages || pages.length;
  const name = meta.documentName ? String(meta.documentName) : '';
  const hash = meta.hash ? String(meta.hash) : '';
  const M = 40;
  pages.forEach((page, i) => {
    const { width: pw } = page.getSize();
    const right = pw - M;
    page.drawLine({ start: { x: M, y: 33 }, end: { x: right, y: 33 }, thickness: 0.5, color: rgb(0.78, 0.82, 0.9) });
    const brand = 'Electronically signed · Ararat E-Signature';
    page.drawText(brand, { x: M, y: 22, size: 6.5, font: helvB, color: rgb(0.24, 0.34, 0.55) });
    const pageLabel = `Page ${i + 1} of ${total}`;
    page.drawText(pageLabel, { x: right - helv.widthOfTextAtSize(pageLabel, 6.5), y: 22, size: 6.5, font: helv, color: rgb(0.45, 0.49, 0.56) });
    if (name) {
      const clipped = name.length > 74 ? name.slice(0, 73) + '…' : name;
      page.drawText(clipped, { x: M, y: 13, size: 6, font: helv, color: rgb(0.5, 0.54, 0.6) });
    }
    if (hash) {
      const vt = `Verified ${hash}`;
      page.drawText(vt, { x: right - helv.widthOfTextAtSize(vt, 6), y: 13, size: 6, font: helv, color: rgb(0.5, 0.54, 0.6) });
    }
  });
};

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

  // ── 1b. Stamp the signing footer on every page (appendix on each page) ────────
  const totalPages = pages.length + 1; // + the certificate page appended below
  stampPageFooters(pages, { helv, helvB, rgb }, { documentName: sig.documentName, hash: sig.hash, totalPages });

  // ── 2. Append an Electronic Signature Certificate page ────────────────────────
  const page = pdf.addPage([595.28, 841.89]); // A4
  const M = 50; let y = 780;
  page.drawRectangle({ x: 0, y: 800, width: 595.28, height: 42, color: rgb(0.10, 0.34, 0.86) });
  page.drawText('Electronic Signature Certificate', { x: M, y: 812, size: 16, font: helvB, color: rgb(1, 1, 1) });

  y = 750;
  page.drawText('This certifies that the document was electronically signed via Ararat E-Signature.',
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

  page.drawText('Ararat Management · Tamper-evident electronic signature record',
    { x: M, y: 40, size: 7, font: helv, color: rgb(0.55, 0.6, 0.66) });
  // Carry the same "Page X of Y" onto the certificate page (it's the last page).
  const certLabel = `Page ${totalPages} of ${totalPages}`;
  page.drawText(certLabel, { x: 595.28 - M - helv.widthOfTextAtSize(certLabel, 7), y: 40, size: 7, font: helv, color: rgb(0.55, 0.6, 0.66) });

  const out = await pdf.save();
  return new Blob([out], { type: 'application/pdf' });
};

// ── Field value helpers (shared by applyFieldsToPDF) ────────────────────────────
// A signature/initials field stores its capture as JSON: { type, data, font }.
// date/text store a plain string; checkbox stores "true"/"false".
const parseCapture = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { const o = JSON.parse(value); if (o && (o.data || o.type)) return o; } catch { /* not JSON */ }
  return { type: 'typed', data: String(value) };
};

// Embed a signature/initials capture as a pdf-lib PNG image (drawn = already a
// PNG data URL; typed = rendered through typedSignatureToPng).
const embedCapture = async (pdf, capture) => {
  if (!capture) return null;
  try {
    if (capture.type === 'drawn' && typeof capture.data === 'string' && capture.data.startsWith('data:image')) {
      return await pdf.embedPng(capture.data);
    }
    if (capture.data) return await pdf.embedPng(typedSignatureToPng(capture.data, capture.font));
  } catch { /* fall through → null */ }
  return null;
};

/**
 * applyFieldsToPDF — burn an array of positioned fields into a PDF.
 *
 * Each field carries NORMALIZED coordinates (0..1 of the page box):
 *   { field_type, page_index, pos_x, pos_y, width, height, value }
 * value is the SignatureCanvas JSON for signature/initials, a plain string for
 * date/text, or "true"/"false" for checkbox. Appends the same Electronic
 * Signature Certificate page as applySignatureToPDF, listing every signer.
 *
 *   const blob = await applyFieldsToPDF(fileUrl, fields, {
 *     documentName, signers:[{name,role,signedAt,ip,device}], hash,
 *   });
 */
export const applyFieldsToPDF = async (sourceUrl, fields = [], meta = {}) => {
  if (!sourceUrl) throw new Error('No source PDF to sign');
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();

  const bytes = await fetch(sourceUrl).then(r => {
    if (!r.ok) throw new Error(`Could not fetch document (${r.status})`);
    return r.arrayBuffer();
  });

  const pdf   = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const helv  = await pdf.embedFont(StandardFonts.Helvetica);
  const helvB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();

  // ── 1. Stamp each placed field at its page + normalized rect ──────────────────
  for (const f of (fields || [])) {
    const page = pages[f.page_index ?? 0];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();
    const boxW = Math.max(1, (f.width  || 0.2)  * pw);
    const boxH = Math.max(1, (f.height || 0.05) * ph);
    const x    = (f.pos_x || 0) * pw;
    const y    = ph - (f.pos_y || 0) * ph - boxH; // pdf-lib origin is bottom-left
    const type = f.field_type || 'signature';

    // Fields detected over {{anchor tags}}/glyphs: hide the source text first.
    if (f.mask) {
      page.drawRectangle({ x: x - 1, y: y - 1, width: boxW + 2, height: boxH + 2, color: rgb(1, 1, 1) });
    }

    if (type === 'signature' || type === 'initials') {
      const png = await embedCapture(pdf, parseCapture(f.value));
      if (png) {
        const scale = Math.min(boxW / png.width, boxH / png.height);
        const w = png.width * scale, h = png.height * scale;
        page.drawImage(png, { x: x + (boxW - w) / 2, y: y + (boxH - h) / 2, width: w, height: h });
      }
      page.drawLine({ start: { x, y }, end: { x: x + boxW, y }, thickness: 0.5, color: rgb(0.6, 0.7, 0.85) });
    } else if (type === 'checkbox') {
      const s = Math.min(boxW, boxH);
      page.drawRectangle({ x, y, width: s, height: s, borderWidth: 1, borderColor: rgb(0.4, 0.45, 0.5) });
      if (String(f.value) === 'true' || f.value === true) {
        page.drawText('X', { x: x + s * 0.18, y: y + s * 0.14, size: s * 0.7, font: helvB, color: rgb(0.06, 0.4, 0.13) });
      }
    } else { // date | text
      const text = f.value == null ? '' : String(f.value);
      const size = Math.min(13, Math.max(7, boxH * 0.55));
      page.drawText(text, { x: x + 2, y: y + (boxH - size) / 2 + 1, size, font: helv, color: rgb(0.1, 0.14, 0.2) });
    }
  }

  // ── 1b. Stamp the signing footer on every page (appendix on each page) ────────
  const totalPages = pages.length + 1; // + the certificate page appended below
  stampPageFooters(pages, { helv, helvB, rgb }, { documentName: meta.documentName, hash: meta.hash, totalPages });

  // ── 2. Append an Electronic Signature Certificate page ────────────────────────
  const page = pdf.addPage([595.28, 841.89]); // A4
  const M = 50; let y = 780;
  page.drawRectangle({ x: 0, y: 800, width: 595.28, height: 42, color: rgb(0.10, 0.34, 0.86) });
  page.drawText('Electronic Signature Certificate', { x: M, y: 812, size: 16, font: helvB, color: rgb(1, 1, 1) });

  y = 750;
  page.drawText('This certifies that the document was electronically signed via Ararat E-Signature.',
    { x: M, y, size: 9, font: helv, color: rgb(0.3, 0.34, 0.4) });
  y -= 26;

  const row = (label, value) => {
    page.drawText(label, { x: M, y, size: 9, font: helvB, color: rgb(0.25, 0.29, 0.35) });
    const lines = String(value == null || value === '' ? '—' : value).match(/.{1,60}/g) || ['—'];
    lines.forEach((ln, i) => page.drawText(ln, { x: M + 130, y: y - i * 12, size: 9, font: helv, color: rgb(0.12, 0.16, 0.22) }));
    y -= Math.max(20, lines.length * 12 + 6);
  };

  row('Document', meta.documentName);
  if (meta.hash) row('Verification Hash', meta.hash);
  y -= 6;
  page.drawText('Signers', { x: M, y, size: 10, font: helvB, color: rgb(0.15, 0.19, 0.25) });
  y -= 18;
  (meta.signers || []).forEach((s, i) => {
    page.drawText(`${i + 1}. ${s.name || '—'}${s.role ? ` · ${s.role}` : ''}`,
      { x: M, y, size: 9, font: helvB, color: rgb(0.12, 0.16, 0.22) });
    y -= 12;
    const line = [s.signedAt && `Signed ${s.signedAt}`, s.ip && `IP ${s.ip}`, s.device && `Device ${String(s.device).slice(0, 40)}`]
      .filter(Boolean).join('  ·  ');
    if (line) { page.drawText(line, { x: M + 12, y, size: 7.5, font: helv, color: rgb(0.42, 0.46, 0.52) }); y -= 14; }
    else y -= 4;
  });

  page.drawText('Ararat Management · Tamper-evident electronic signature record',
    { x: M, y: 40, size: 7, font: helv, color: rgb(0.55, 0.6, 0.66) });
  // Carry the same "Page X of Y" onto the certificate page (it's the last page).
  const certLabel = `Page ${totalPages} of ${totalPages}`;
  page.drawText(certLabel, { x: 595.28 - M - helv.widthOfTextAtSize(certLabel, 7), y: 40, size: 7, font: helv, color: rgb(0.55, 0.6, 0.66) });

  const out = await pdf.save();
  return new Blob([out], { type: 'application/pdf' });
};

export default applySignatureToPDF;

/**
 * PDF LETTERHEAD HELPERS
 *
 * The jsPDF generators each lay their own header out — a blue band on the
 * vouchers and the till receipt, a framed certificate, a plain contract page —
 * so this module does not impose one header. It provides the three things all
 * of them need and none of them had:
 *
 *   fitLogoBox()     the logo's size inside a box, aspect ratio kept
 *   drawLogo()       the logo, optionally on a white tile so any logo reads on
 *                    a coloured band; NEVER throws — a logo jsPDF cannot
 *                    decode costs the logo, not the document
 *   fitText()        a string shrunk, then clipped with an ellipsis, to fit a
 *                    width — a long business name used to run straight under
 *                    the document title beside it
 *
 * Units are whatever the document was created with (mm or pt); nothing here
 * assumes one.
 */

import { pdfSafeText } from './jsPdfLoader';
import { isUsableLogo } from './letterhead';

/** The logo's width and height inside a maxW × maxH box, aspect ratio kept. */
export const fitLogoBox = (logo, maxW, maxH) => {
  const w0 = Number(logo?.width) || 1;
  const h0 = Number(logo?.height) || 1;
  const r = Math.min(maxW / w0, maxH / h0);
  return { w: w0 * r, h: h0 * r };
};

/**
 * Draw `logo` centred in the box at (x, y, w, h).
 *
 *   tile     an RGB fill painted behind it first (e.g. white on a blue band),
 *            or null for none
 *   radius   the tile's corner radius
 *   padding  space between the tile's edge and the logo
 *   align    'center' (default) or 'left' — where the logo sits horizontally
 *            when it is narrower than the box
 *
 * Returns the rectangle actually covered by the logo, or null when nothing was
 * drawn.
 */
export const drawLogo = (doc, logo, {
  x, y, w, h, tile = null, radius = 0, padding = 0, align = 'center',
} = {}) => {
  if (!isUsableLogo(logo)) return null;
  try {
    const inner = fitLogoBox(logo, Math.max(1, w - padding * 2), Math.max(1, h - padding * 2));
    if (tile) {
      doc.setFillColor(...tile);
      if (radius > 0) doc.roundedRect(x, y, w, h, radius, radius, 'F');
      else doc.rect(x, y, w, h, 'F');
    }
    const lx = align === 'left' ? x + padding : x + (w - inner.w) / 2;
    const ly = y + (h - inner.h) / 2;
    doc.addImage(logo.src, logo.format || 'PNG', lx, ly, inner.w, inner.h, undefined, 'FAST');
    return { x: lx, y: ly, w: inner.w, h: inner.h };
  } catch {
    return null;
  }
};

/**
 * Set the font, then shrink it (down to `minSize`) until `text` fits
 * `maxWidth`, and clip it with an ellipsis if even that is too wide. Returns
 * the string to draw — already passed through pdfSafeText, since Helvetica
 * mangles anything outside cp1252 — with the font left set at the size chosen.
 */
export const fitText = (doc, text, maxWidth, {
  font = 'helvetica', style = 'normal', size = 10, minSize = size,
} = {}) => {
  const s = pdfSafeText(text);
  let current = size;
  doc.setFont(font, style);
  doc.setFontSize(current);
  while (current > minSize && doc.getTextWidth(s) > maxWidth) {
    current = Math.max(minSize, current - 0.5);
    doc.setFontSize(current);
  }
  if (doc.getTextWidth(s) <= maxWidth) return s;

  let cut = s;
  while (cut.length > 1 && doc.getTextWidth(`${cut}…`) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
};

export default drawLogo;

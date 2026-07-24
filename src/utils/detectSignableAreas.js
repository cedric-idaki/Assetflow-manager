/**
 * detectSignableAreas.js
 *
 * SignNow-style automatic field detection: scan a PDF's text layer and propose
 * signature fields where the document visibly expects them. Four detectors:
 *
 *   1. Anchor tags   — {{signature}}, {{s:2:date}}, {{1:initials}} … placed at
 *                      the tag, assigned to that signer index, and masked
 *                      (painted over) in the final sealed PDF.
 *   2. Underscore runs — "Signature: ________" → a field sitting on the line;
 *                      type inferred from nearby words.
 *   3. Bare labels   — "Signature:", "Date:", "Sign here:" with empty space
 *                      after them (no underscores) → a field after the label.
 *   4. Checkbox glyphs — "[ ]" or "☐" → a checkbox field.
 *
 * Returns [{ field_type, page_index, pos_x, pos_y, width, height, mask,
 *            signerIndex|null }] in NORMALIZED page coordinates (0..1,
 *            top-left origin) — the same convention as esign_fields.
 */
import { loadPdfJs } from "./pdfjsLoader";

// Default normalized field sizes per detected type.
const SIZE = {
  signature: { w: 0.22,  h: 0.050 },
  initials:  { w: 0.08,  h: 0.040 },
  date:      { w: 0.13,  h: 0.032 },
  text:      { w: 0.20,  h: 0.032 },
  checkbox:  { w: 0.028, h: 0.020 },
};

const TAG_RE      = /\{\{\s*(?:s\s*:\s*)?(\d+)?\s*:?\s*(signature|initials|date|text|checkbox)\s*\}\}/gi;
const UNDERSCORE_RE = /_{3,}/g;
const LABEL_RE    = /\b(signature|signed\s+by|sign\s+here|date|initials|name)\s*[:：]/gi;
const CHECKBOX_RE = /\[\s?\]|☐/g;

// Labels printed BELOW a ruled signing line — the classic contract signature
// block ("Authorised Signatory", "Name and Title", "Date" under a drawn line).
// Matched against a whole column-cluster of a line, no trailing colon (labels
// WITH colons are handled by LABEL_RE, which places the field after them).
const UNDER_LABEL_RE = /^\s*(authori[sz]ed\s*signatory|signatory|signature|sign\s*here|name\s*(?:and|&)\s*title|company\s*name(?:\s*and\s*date)?|full\s*name|name|title|date|witness|director)\s*$/i;

function underLabelType(label) {
  const l = label.toLowerCase();
  if (/(signat|sign\s*here|witness|director)/.test(l)) return "signature";
  if (/\bdate\b/.test(l) && !/(name|company)/.test(l)) return "date";
  return "text";
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Infer a field type from the words around a blank/underscore run.
function inferType(context) {
  const c = context.toLowerCase();
  if (/(signature|signed\s+by|sign\s+here|\bsign\b)/.test(c)) return "signature";
  if (/\bdate\b/.test(c)) return "date";
  if (/\binitials?\b/.test(c)) return "initials";
  return "text";
}

function labelToType(label) {
  const l = label.toLowerCase();
  if (/date/.test(l)) return "date";
  if (/initials?/.test(l)) return "initials";
  if (/name/.test(l)) return "text";
  return "signature"; // signature / signed by / sign here
}

// Group a page's text items into visual lines (same baseline ± tolerance) and
// build, per line, the concatenated string plus a char-offset → item map so
// regex matches can be projected back to x positions.
function buildLines(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.length) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const fontH = Math.abs(it.transform[3]) || Math.abs(it.height) || 10;
    let row = rows.find(r => Math.abs(r.y - y) <= Math.max(2, fontH * 0.3));
    if (!row) { row = { y, items: [] }; rows.push(row); }
    row.items.push({ str: it.str, x, y, w: it.width || 0, fontH });
  }
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    let text = "";
    const map = []; // per item: { start, end, x, w, strLen }
    for (const it of row.items) {
      map.push({ start: text.length, end: text.length + it.str.length, x: it.x, w: it.w, strLen: it.str.length });
      text += it.str + " "; // single space between items keeps word regexes working
    }
    row.text = text;
    row.map = map;
    row.fontH = Math.max(...row.items.map(i => i.fontH));
  }
  return rows;
}

// Project a char offset in the line string back to an x coordinate (points).
function offsetToX(row, offset) {
  for (const m of row.map) {
    if (offset <= m.end) {
      const within = clamp(offset - m.start, 0, m.strLen);
      return m.x + (m.strLen ? (within / m.strLen) * m.w : 0);
    }
  }
  const last = row.map[row.map.length - 1];
  return last ? last.x + last.w : 0;
}

// Build one suggestion in normalized coordinates. xPts is the field's left
// edge, baselineY the text baseline (PDF bottom-origin points).
function makeField(type, pageIndex, xPts, baselineY, pw, ph, { widthPts = null, mask = false, signerIndex = null } = {}) {
  const size = SIZE[type] || SIZE.text;
  const w = clamp(widthPts != null ? widthPts / pw : size.w, 0.02, 0.9);
  const h = size.h;
  const hPts = h * ph;
  return {
    field_type: type,
    page_index: pageIndex,
    pos_x: clamp(xPts / pw, 0, 1 - w),
    pos_y: clamp((ph - baselineY - hPts) / ph, 0, 1 - h), // field bottom sits on the baseline
    width: w,
    height: h,
    required: true,
    mask,
    signerIndex,
  };
}

export async function detectSignableAreas(fileUrl, { maxSuggestions = 40 } = {}) {
  const pdfjsLib = await loadPdfJs();
  const bytes = await fetch(fileUrl).then(r => {
    if (!r.ok) throw new Error(`Could not fetch document (${r.status})`);
    return r.arrayBuffer();
  });
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;

  const out = [];
  for (let p = 1; p <= pdf.numPages && out.length < maxSuggestions; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const pw = vp.width, ph = vp.height;
    const { items } = await page.getTextContent();
    const rows = buildLines(items);

    for (const row of rows) {
      const { text, y } = row;
      const taken = []; // x-ranges already claimed on this line (pts)
      const overlaps = (x0, x1) => taken.some(([a, b]) => x0 < b && x1 > a);
      const claim = (x0, x1) => taken.push([x0, x1]);

      // 1) Anchor tags — highest priority, may carry a signer index.
      let m;
      TAG_RE.lastIndex = 0;
      while ((m = TAG_RE.exec(text))) {
        const x0 = offsetToX(row, m.index);
        const x1 = offsetToX(row, m.index + m[0].length);
        const idx = m[1] ? Math.max(0, parseInt(m[1], 10) - 1) : null;
        out.push(makeField(m[2].toLowerCase(), p - 1, x0, y - row.fontH * 0.25, pw, ph, {
          widthPts: Math.max(x1 - x0, SIZE[m[2].toLowerCase()]?.w * pw * 0.6 || 40),
          mask: true, signerIndex: idx,
        }));
        claim(x0, x1);
      }

      // 2) Underscore runs — a drawn line waiting for ink.
      UNDERSCORE_RE.lastIndex = 0;
      while ((m = UNDERSCORE_RE.exec(text))) {
        const x0 = offsetToX(row, m.index);
        const x1 = offsetToX(row, m.index + m[0].length);
        if (overlaps(x0, x1)) continue;
        const type = inferType(text.slice(Math.max(0, m.index - 40), m.index) || text);
        out.push(makeField(type, p - 1, x0, y, pw, ph, { widthPts: x1 - x0 }));
        claim(x0, x1);
      }

      // 3) Bare labels with empty space after them (no underscores nearby).
      LABEL_RE.lastIndex = 0;
      while ((m = LABEL_RE.exec(text))) {
        const after = text.slice(m.index + m[0].length, m.index + m[0].length + 30);
        if (/[_{]|\S{12,}/.test(after.trim())) continue; // underscores/tag/real content follow — other rules own it
        const x0 = offsetToX(row, m.index + m[0].length) + 4;
        const type = labelToType(m[1]);
        const wPts = (SIZE[type].w * pw);
        if (overlaps(x0, x0 + wPts) || x0 + wPts * 0.5 > pw) continue;
        out.push(makeField(type, p - 1, x0, y - 2, pw, ph, {}));
        claim(x0, x0 + wPts);
      }

      // 3b) Labels sitting BELOW a ruled signing line ("Authorised Signatory",
      // "Name and Title", "Date" printed under a drawn line). Group the line's
      // items into column clusters (wide x-gaps = separate columns, as in
      // two-party signature blocks), match each cluster, and place the field
      // ABOVE the label — on the line the person actually signs.
      {
        const clusters = [];
        let cluster = null;
        for (const it of row.items) {
          // Whitespace-only items are column spacers, not content — pdf.js
          // emits wide " " items bridging column gaps; never let them glue
          // two columns into one cluster.
          if (!it.str.trim()) continue;
          if (cluster && it.x - cluster.xEnd <= Math.max(20, row.fontH * 2)) {
            cluster.text += it.str;
            cluster.xEnd = it.x + it.w;
          } else {
            cluster = { text: it.str, x: it.x, xEnd: it.x + it.w };
            clusters.push(cluster);
          }
        }
        for (const c of clusters) {
          const m2 = c.text.replace(/\s+/g, " ").trim().match(UNDER_LABEL_RE);
          if (!m2) continue;
          const type = underLabelType(m2[1]);
          const wPts = Math.max(c.xEnd - c.x, SIZE[type].w * pw * 0.9);
          out.push(makeField(type, p - 1, c.x, y + row.fontH * 0.9, pw, ph, { widthPts: wPts }));
        }
      }

      // 4) Checkbox glyphs.
      CHECKBOX_RE.lastIndex = 0;
      while ((m = CHECKBOX_RE.exec(text))) {
        const x0 = offsetToX(row, m.index);
        const x1 = offsetToX(row, m.index + m[0].length);
        if (overlaps(x0, x1)) continue;
        out.push(makeField("checkbox", p - 1, x0, y - 1, pw, ph, { widthPts: Math.max(x1 - x0, 10), mask: true }));
        claim(x0, x1);
      }

      if (out.length >= maxSuggestions) break;
    }
  }

  // De-duplicate near-identical suggestions (same page, ~same spot).
  const dedup = [];
  for (const f of out) {
    const dupe = dedup.some(d => d.page_index === f.page_index &&
      Math.abs(d.pos_x - f.pos_x) < 0.02 && Math.abs(d.pos_y - f.pos_y) < 0.015);
    if (!dupe) dedup.push(f);
  }
  return dedup.slice(0, maxSuggestions);
}

export default detectSignableAreas;

// @vitest-environment node
/**
 * Does the workbook actually unzip, and is what comes out well-formed XML?
 *
 * Split from xlsxWriter.test.js and pinned to the NODE environment on purpose.
 * jsdom has neither CompressionStream nor Blob.stream(), so under it the writer
 * always falls back to storing entries uncompressed — which means the deflate
 * path, the one that runs in every real browser, would never be tested. Here it
 * is exercised for real and inflated back with node's own zlib, so a CRC or a
 * length written against the wrong bytes fails loudly rather than producing an
 * archive that only Windows Explorer refuses.
 */
import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { buildWorkbook } from './xlsxWriter';

const dec = new TextDecoder();

/** Walk the central directory the way a real reader does, and unpack each part. */
const unzip = (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.byteLength - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);

  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const out = {};

  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const method  = view.getUint16(at + 10, true);
    const comp    = view.getUint32(at + 20, true);
    const raw     = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const localAt = view.getUint32(at + 42, true);
    const name    = dec.decode(bytes.slice(at + 46, at + 46 + nameLen));

    expect(view.getUint32(localAt, true), `${name} local header`).toBe(0x04034b50);
    const start = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    const body  = bytes.slice(start, start + comp);
    const data  = method === 8 ? zlib.inflateRawSync(body) : body;

    // The declared uncompressed length has to match what actually came back, or
    // every unzipper reports the archive as corrupt.
    expect(data.length, `${name} declared length`).toBe(raw);
    out[name] = { text: dec.decode(data), method, comp, raw };
    at += 46 + nameLen + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return out;
};

const workbook = () => buildWorkbook({
  sheetName: 'Payments',
  title: 'August payments',
  sections: [{
    columns: [
      { label: 'Client & Co', type: 'text' },
      { label: 'Paid on', type: 'date' },
      { label: 'Amount', type: 'money' },
    ],
    rows: [
      ['Achieng <A>', '2026-08-30', 1000],
      ['Otieno', null, 2500.75],
    ],
    totals: ['Total', null, 3500.75],
  }],
  notes: ['Report: August payments', '2 records'],
});

describe('xlsx round trip', () => {
  it('deflates every part and inflates it back intact', async () => {
    expect(typeof CompressionStream, 'this test is pointless without it').toBe('function');
    const parts = unzip(await workbook());
    const sheet = parts['xl/worksheets/sheet1.xml'];
    expect(sheet.method).toBe(8);
    expect(sheet.comp).toBeLessThan(sheet.raw);
  });

  it('unpacks to the six parts an .xlsx needs', async () => {
    const parts = unzip(await workbook());
    expect(Object.keys(parts).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
  });

  it('escapes tenant text so the XML stays well formed', async () => {
    const sheet = unzip(await workbook())['xl/worksheets/sheet1.xml'].text;
    expect(sheet).toContain('Client &amp; Co');
    expect(sheet).toContain('Achieng &lt;A&gt;');
    // Every < that is not a tag would make the sheet unreadable, so the tag
    // count has to balance.
    expect((sheet.match(/</g) || []).length).toBe((sheet.match(/>/g) || []).length);
  });

  it('drops the cell for a row that has no date rather than shifting the row', async () => {
    const sheet = unzip(await workbook())['xl/worksheets/sheet1.xml'].text;
    // Row 5 is Otieno, whose "Paid on" is null: A5 and C5 are present, B5 is not.
    expect(sheet).toContain('<c r="A5"');
    expect(sheet).toContain('<c r="C5"');
    expect(sheet).not.toContain('<c r="B5"');
  });
});

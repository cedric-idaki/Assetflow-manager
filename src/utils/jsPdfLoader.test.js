import { describe, it, expect } from 'vitest';
import { pdfSafeText } from './jsPdfLoader';

describe('pdfSafeText', () => {
  it('leaves plain text alone', () => {
    expect(pdfSafeText('National ID · 312 documents')).toBe('National ID · 312 documents');
  });

  it('keeps the Latin-1 characters the standard fonts do have', () => {
    // These draw correctly, so transliterating them would make the file worse.
    expect(pdfSafeText('Café — Ångström, 50 % ± 2 °C')).toBe('Café — Ångström, 50 % ± 2 °C');
  });

  it('spells out the symbols the fonts do not have', () => {
    // The bug this exists for: jsPDF does not drop an unmappable character, it
    // mangles the whole string — "≤ 30 Days" came out as `"d    3 0    D a y s.
    expect(pdfSafeText('≤ 30 Days')).toBe('<= 30 Days');
    expect(pdfSafeText('≥ 90 Days')).toBe('>= 90 Days');
    expect(pdfSafeText('rate ≠ 100%')).toBe('rate != 100%');
  });

  it('strips an accent rather than losing the name', () => {
    // ũ is outside cp1252 and appears in Kenyan names. Readable and wrong beats
    // illegible and wrong.
    expect(pdfSafeText('Wanjirũ')).toBe('Wanjiru');
    expect(pdfSafeText('Njeri Mũthoni')).toBe('Njeri Muthoni');
  });

  it('drops what has no Latin form at all rather than mangling the line', () => {
    expect(pdfSafeText('Nairobi 内容 office')).toBe('Nairobi  office');
    expect(pdfSafeText('🎉 done')).toBe(' done');
  });

  it('handles nothing at all', () => {
    expect(pdfSafeText(null)).toBe('');
    expect(pdfSafeText(undefined)).toBe('');
    expect(pdfSafeText(0)).toBe('0');
  });
});

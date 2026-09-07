/**
 * How a document gets filed.
 *
 * The two things worth pinning:
 *
 *   THE PATH IS BUILT FROM THE DOCUMENT'S OWN DATE, not today's. A receipt
 *   reprinted in June for a March sale files under March — which is where an
 *   auditor asked for "March receipts" will look. Getting this wrong is silent:
 *   nothing errors, the document is simply not where anybody looks for it.
 *
 *   THE FIRST SEGMENT IS THE TENANT. storage_path_is_own_tenant() compares it
 *   to current_admin_id(), so a wrong or missing first folder is a refused
 *   upload — and, because archiving is deliberately quiet, a refusal nobody
 *   sees.
 */

import { describe, it, expect } from 'vitest';
import { archivePath, archiveMetaFor } from './documentArchive';

describe('archivePath', () => {
  const base = { adminId: 'admin-1', fileName: 'Receipt_INV-2291.pdf' };

  it('files under the tenant, then year, month and day', () => {
    const path = archivePath({ ...base, issuedAt: '2026-03-09T14:05:07.000Z' });
    const [tenant, year, month, day] = path.split('/');
    expect(tenant).toBe('admin-1');
    expect(year).toBe('2026');
    expect(month).toBe('03');
    expect(day).toMatch(/^\d{2}$/);
  });

  it('uses the document date, not the filing date', () => {
    const march = archivePath({ ...base, issuedAt: '2026-03-01T09:00:00.000Z' });
    const june  = archivePath({ ...base, issuedAt: '2026-06-01T09:00:00.000Z' });
    expect(march.split('/')[2]).toBe('03');
    expect(june.split('/')[2]).toBe('06');
  });

  it('puts the reference in the filename so the bucket is readable without the registry', () => {
    const path = archivePath({ ...base, issuedAt: '2026-03-09T14:05:07.000Z', reference: 'INV-2291' });
    expect(path.split('/').pop()).toContain('INV-2291__');
  });

  it('strips anything an OS or a URL would refuse', () => {
    const path = archivePath({
      ...base,
      reference: 'INV/2291 #2',
      fileName: 'Receipt — Nyeri Traders (copy).pdf',
      issuedAt: '2026-03-09T14:05:07.000Z',
    });
    const name = path.split('/').pop();
    expect(name).not.toMatch(/[/\s#()—]/);
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it('falls back to today rather than filing under an invalid date', () => {
    const path = archivePath({ ...base, issuedAt: 'not a date' });
    expect(path.split('/')[1]).toBe(String(new Date().getFullYear()));
  });

  it('never produces an empty first segment, which the bucket would refuse', () => {
    expect(archivePath({ fileName: 'x.pdf' }).split('/')[0]).toBe('unfiled');
  });
});

describe('archiveMetaFor', () => {
  it('reads the kind, reference and party straight off the model', () => {
    expect(archiveMetaFor({
      kind: 'journal_voucher',
      title: 'JOURNAL VOUCHER',
      docNo: 'JE-000123',
      party: { name: 'Nyeri Traders' },
      filename: 'Journal_Voucher_JE-000123.pdf',
    })).toMatchObject({
      docType: 'voucher',
      module: 'accounting',
      reference: 'JE-000123',
      clientName: 'Nyeri Traders',
      fileName: 'Journal_Voucher_JE-000123.pdf',
    });
  });

  it('files an unknown kind as "other" rather than dropping it', () => {
    // A document the archive cannot classify is still a document. Losing it
    // would be worse than filing it imprecisely.
    expect(archiveMetaFor({ kind: 'something_new', filename: 'x.pdf' }))
      .toMatchObject({ docType: 'other', module: 'other' });
  });

  it('lets a builder override anything it knows better', () => {
    expect(archiveMetaFor({
      kind: 'receipt',
      docNo: 'RCP-1',
      archive: { clientId: 'client-9', amount: 12500, issuedAt: '2026-03-01T00:00:00.000Z' },
    })).toMatchObject({
      docType: 'receipt',
      reference: 'RCP-1',
      clientId: 'client-9',
      amount: 12500,
    });
  });
});

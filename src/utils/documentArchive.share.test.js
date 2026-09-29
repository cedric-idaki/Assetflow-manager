/**
 * A link handed to a client must point at a filed copy — and must fail out
 * loud when there is none.
 *
 * archiveDocument is quiet on purpose: a download must never fail because the
 * archive copy did. shareArchivedDocument is the opposite, because a message
 * saying "download your invoice here" with nothing behind the link is a client
 * who thinks they have been sent an invoice and has not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const upload = vi.fn();
const createSignedUrl = vi.fn();
const rpc = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args) => rpc(...args),
    storage: {
      from: () => ({
        upload: (...args) => upload(...args),
        createSignedUrl: (...args) => createSignedUrl(...args),
      }),
    },
  },
}));
vi.mock('./logger', () => ({ logger: { warn: vi.fn(), debug: vi.fn() } }));

import { shareArchivedDocument, resetArchiveTenant, SHARE_LINK_DAYS } from './documentArchive';

const SIGNED = 'https://example.supabase.co/storage/v1/object/sign/document-archive/admin-1/x.pdf?token=abc';
const blob = { type: 'application/pdf', size: 2048 };
const meta = {
  title: 'TAX INVOICE',
  reference: 'INV-0012',
  fileName: 'Invoice_INV-0012_Grace_Wanjiru.pdf',
  docType: 'invoice',
  module: 'accounting',
  clientName: 'Grace Wanjiru',
};

// The register echoes back the row it wrote, file_path included.
const registers = (shape = (row) => row) => rpc.mockImplementation(async (name, args) => {
  if (name === 'current_admin_id') return { data: 'admin-1', error: null };
  if (name === 'archive_document') return { data: shape({ id: 'doc-1', file_path: args.p_file_path }), error: null };
  return { data: null, error: { message: `unexpected rpc ${name}` } };
});

beforeEach(() => {
  vi.clearAllMocks();
  resetArchiveTenant();
  registers();
  upload.mockResolvedValue({ error: null });
  createSignedUrl.mockResolvedValue({ data: { signedUrl: SIGNED }, error: null });
});

describe('shareArchivedDocument', () => {
  it('files the document under the tenant and signs a link to that copy', async () => {
    const out = await shareArchivedDocument(blob, meta);

    const path = upload.mock.calls[0][0];
    expect(path).toMatch(/^admin-1\/\d{4}\/\d{2}\/\d{2}\/\d{6}_INV-0012__Invoice_INV-0012_Grace_Wanjiru\.pdf$/);
    expect(rpc).toHaveBeenCalledWith('archive_document', expect.objectContaining({
      p_file_path: path, p_doc_type: 'invoice', p_reference: 'INV-0012',
    }));
    expect(createSignedUrl).toHaveBeenCalledWith(path, SHARE_LINK_DAYS * 24 * 60 * 60);
    expect(out).toMatchObject({ url: SIGNED, filePath: path });
  });

  it('says when the link stops working', async () => {
    const before = Date.now();
    const out = await shareArchivedDocument(blob, meta, { days: 7 });
    expect(createSignedUrl).toHaveBeenCalledWith(expect.any(String), 7 * 24 * 60 * 60);
    const expires = new Date(out.expiresAt).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + 7 * 86400000);
    expect(expires).toBeLessThan(before + 7 * 86400000 + 60000);
  });

  it('accepts the row as the one-element array PostgREST sometimes returns', async () => {
    registers((row) => [row]);
    await expect(shareArchivedDocument(blob, meta)).resolves.toMatchObject({ url: SIGNED });
  });

  it('refuses to hand out a link when the upload was refused', async () => {
    upload.mockResolvedValue({ error: { message: 'new row violates row-level security policy' } });
    await expect(shareArchivedDocument(blob, meta)).rejects.toThrow(/could not be saved for sharing/);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('refuses when the register would not record it', async () => {
    rpc.mockImplementation(async (name) => (name === 'current_admin_id'
      ? { data: 'admin-1', error: null }
      : { data: null, error: { message: 'Only staff may file a document.' } }));
    await expect(shareArchivedDocument(blob, meta)).rejects.toThrow(/could not be saved for sharing/);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('refuses when there is no tenant to file under', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(shareArchivedDocument(blob, meta)).rejects.toThrow(/could not be saved for sharing/);
    expect(upload).not.toHaveBeenCalled();
  });

  it('passes a signing failure on rather than sending no link', async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'Object not found' } });
    await expect(shareArchivedDocument(blob, meta)).rejects.toThrow('Object not found');
  });
});

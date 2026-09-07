/**
 * File a generated PDF where it can be found again.
 *
 * WHY THIS EXISTS. Every PDF this app produced went to the browser's download
 * folder and nowhere else. The filename carried the reference and that was the
 * whole filing system — so nobody could find last March's receipts, prove what
 * had been issued to whom, or answer "everything for this client in Q2".
 *
 * THE DOWNLOAD ALWAYS WINS. Archiving runs AFTER the file has been handed to
 * the browser, and every failure in here is swallowed to a warning. A storage
 * outage must cost the archive copy, never the document somebody is standing
 * at a counter waiting for. That is also why nothing here is awaited by the
 * caller's happy path — see downloadAccountingDocument.
 *
 * THE PATH IS DATE-PARTITIONED as well as indexed:
 *
 *     <admin_id>/<yyyy>/<mm>/<dd>/<HHMMSS>_<reference>__<filename>
 *
 * The registry is how you search it; the path is what makes the bucket usable
 * when the registry is not — and a flat bucket of 40,000 PDFs is not.
 */

import { supabase } from '../lib/supabase';
import { logger } from './logger';

const BUCKET = 'document-archive';

/**
 * The caller's tenant, cached for the session.
 *
 * The registry row gets its admin_id server-side from current_admin_id(), but
 * the PATH needs it too — storage_path_is_own_tenant() compares the first
 * folder to the caller's tenant, so a wrong or missing first segment is a
 * refused upload rather than a misfiled one. Asking once and remembering is
 * what keeps this out of the twelve call sites that produce documents.
 */
let tenantPromise = null;

const currentTenant = () => {
  if (!tenantPromise) {
    tenantPromise = supabase.rpc('current_admin_id')
      .then(({ data, error }) => {
        if (error) throw error;
        return data || null;
      })
      .catch((err) => {
        // Do not cache a failure: a transient error must not disable archiving
        // for the rest of the session.
        tenantPromise = null;
        logger.debug('[documentArchive] tenant unresolved', { message: err?.message });
        return null;
      });
  }
  return tenantPromise;
};

/** For tests, and for a logout that changes who "the tenant" is. */
export const resetArchiveTenant = () => { tenantPromise = null; };

// What kind of document each builder produces, and which part of the system it
// came from. Keyed on the `kind` every model already carries, so a new builder
// files itself correctly by naming its kind rather than by remembering to pass
// metadata.
const KINDS = {
  journal_voucher:     { docType: 'voucher',     module: 'accounting' },
  invoice:             { docType: 'invoice',     module: 'accounting' },
  receipt:             { docType: 'receipt',     module: 'accounting' },
  payment_receipt:     { docType: 'receipt',     module: 'payments' },
  contribution_receipt:{ docType: 'receipt',     module: 'sacco' },
  loan_receipt:        { docType: 'receipt',     module: 'sacco' },
  share_receipt:       { docType: 'receipt',     module: 'sacco' },
  dividend_statement:  { docType: 'advice',      module: 'sacco' },
  payroll_voucher:     { docType: 'voucher',     module: 'payroll' },
  payslip:             { docType: 'payslip',     module: 'payroll' },
  certificate:         { docType: 'certificate', module: 'sacco' },
};

const kindMeta = (kind) => KINDS[kind] || { docType: 'other', module: 'other' };

/**
 * Everything the archive needs, read off the model the builder already
 * returned. `model.archive` overrides any of it — the only fields a builder
 * has to supply by hand are the ones no document displays: the client's id,
 * the member's id, and the transaction's real timestamp (models carry a
 * FORMATTED date, which is not a date).
 */
export const archiveMetaFor = (model = {}) => {
  const base = kindMeta(model.kind);
  return {
    docType:    base.docType,
    module:     base.module,
    title:      model.title || model.filename || 'Document',
    reference:  model.docNo || null,
    clientName: model.party?.name || null,
    fileName:   model.filename || 'document.pdf',
    ...(model.archive || {}),
  };
};

/** Anything an OS or a URL would refuse. */
const safe = (text, fallback = 'document') => {
  const out = String(text ?? '').trim().replace(/[^\w.-]+/g, '_').replace(/_+/g, '_');
  return out.replace(/^_|_$/g, '') || fallback;
};

const two = (n) => String(n).padStart(2, '0');

/**
 * Build the object name for one document.
 *
 * `issuedAt` is the DOCUMENT'S date, not today's: a receipt reprinted in June
 * for a March sale files under March, which is where an auditor will look for
 * it.
 */
export const archivePath = ({ adminId, issuedAt, reference, fileName }) => {
  const d = issuedAt ? new Date(issuedAt) : new Date();
  const when = Number.isNaN(d.getTime()) ? new Date() : d;
  const stamp = `${two(when.getHours())}${two(when.getMinutes())}${two(when.getSeconds())}`;
  const ref = reference ? `${safe(reference)}__` : '';
  return [
    adminId || 'unfiled',
    when.getFullYear(),
    two(when.getMonth() + 1),
    two(when.getDate()),
    `${stamp}_${ref}${safe(fileName, 'document.pdf')}`,
  ].join('/');
};

/**
 * Upload one rendered document and register it.
 *
 * @param {Blob}   blob  the rendered file
 * @param {object} meta  { adminId, title, docType, module, reference, clientId,
 *                        clientName, memberId, amount, issuedAt, fileName }
 * @returns {Promise<object|null>} the registry row, or null when filing failed
 */
export const archiveDocument = async (blob, meta = {}) => {
  if (!blob) return null;

  const adminId = meta.adminId || await currentTenant();
  if (!adminId) return null;   // no tenant, no path the bucket will accept

  const fileName = meta.fileName || 'document.pdf';
  const path = archivePath({
    adminId,
    issuedAt:  meta.issuedAt,
    reference: meta.reference,
    fileName,
  });

  try {
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, { upsert: false, contentType: blob.type || 'application/pdf' });
    if (upErr) throw new Error(upErr.message || 'upload failed');

    const { data, error } = await supabase.rpc('archive_document', {
      p_title:       meta.title || fileName,
      p_file_path:   path,
      p_file_name:   fileName,
      p_doc_type:    meta.docType || 'other',
      p_module:      meta.module || 'other',
      p_reference:   meta.reference || null,
      p_client_id:   meta.clientId || null,
      p_client_name: meta.clientName || null,
      p_member_id:   meta.memberId || null,
      p_amount:      meta.amount ?? null,
      p_issued_at:   meta.issuedAt || null,
      p_file_size:   blob.size ?? null,
    });
    if (error) throw new Error(error.message || 'could not register the document');
    return data;
  } catch (err) {
    // Deliberately quiet. The person already has the file; a red banner about
    // the archive copy would read as "your receipt failed", which it did not.
    logger.warn('[documentArchive] could not file a copy', { path, message: err?.message });
    return null;
  }
};

/** A time-limited link to a filed document. */
export const archivedDocumentUrl = async (filePath, seconds = 300) => {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(filePath, seconds);
  if (error) throw new Error(error.message || 'Could not open that document.');
  return data?.signedUrl || null;
};

export default archiveDocument;

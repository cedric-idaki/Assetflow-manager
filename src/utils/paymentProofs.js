import { supabase } from '../lib/supabase';

/**
 * Proof of payment — the deposit slip or transfer confirmation behind a
 * payment that did not come through M-Pesa. One register serves both sides:
 *
 *   module 'company' → a row in public.payments
 *   module 'sacco'   → a row in public.sacco_contributions
 *
 * Upload first, register second (attach_payment_proof). A refused register
 * takes its object back out, so a failure never leaves a file nothing points
 * at — and a success never leaves a row pointing at a file that is not there.
 */

export const PROOF_BUCKET = 'payment-proofs';

// Mirrors the bucket's own limits; checking here only saves the round trip.
export const PROOF_MAX_BYTES = 10 * 1024 * 1024;
export const PROOF_MIME_TYPES = [
  'application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic',
];
export const PROOF_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*';

// Methods where the only evidence is a document someone has to look at.
export const PROOF_SUGGESTED_METHODS = ['bank', 'bank_transfer', 'cheque', 'cash', 'card', 'other'];

const EXT_MIME = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', heic: 'image/heic',
};

/** Browsers leave file.type empty for some HEIC photos; fall back to the extension. */
export const proofMimeType = (file) => {
  if (file?.type) return file.type.toLowerCase();
  const ext = (file?.name || '').split('.').pop().toLowerCase();
  return EXT_MIME[ext] || '';
};

/** Returns an error message, or null when the file can be uploaded. */
export const validateProofFile = (file) => {
  if (!file) return 'Choose a file first.';
  if (!PROOF_MIME_TYPES.includes(proofMimeType(file))) {
    return 'Upload a PDF or an image (JPG, PNG, WEBP, HEIC).';
  }
  if (!file.size) return 'That file is empty.';
  if (file.size > PROOF_MAX_BYTES) return 'The file is larger than 10 MB.';
  return null;
};

/**
 * <tenant>/<uploader>/<timestamp>_<safe name>. The first segment is what the
 * tenant lockdown compares to current_admin_id(); the second is what keeps one
 * SACCO member out of another member's slips.
 */
export const buildProofPath = (adminId, userId, fileName, now = Date.now()) => {
  if (!adminId || !userId) throw new Error('Cannot file a document without a tenant and an uploader.');
  const safe = String(fileName || 'document').replace(/[^\w.-]+/g, '_').slice(-120);
  return `${adminId}/${userId}/${now}_${safe}`;
};

/**
 * Upload one file and attach it to a payment.
 *
 * @param {object}  args
 * @param {'company'|'sacco'} args.module
 * @param {string}  args.recordId  payments.id or sacco_contributions.id
 * @param {string}  args.adminId   the RECORD's admin_id (the tenant it belongs to)
 * @param {File}    args.file
 * @param {string} [args.note]
 */
export const uploadPaymentProof = async ({ module, recordId, adminId, file, note }) => {
  const problem = validateProofFile(file);
  if (problem) throw new Error(problem);
  if (!recordId) throw new Error('There is no payment to attach this to.');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Your session has expired — sign in again.');

  const path = buildProofPath(adminId, user.id, file.name);
  const contentType = proofMimeType(file);

  const { error: upErr } = await supabase.storage
    .from(PROOF_BUCKET)
    .upload(path, file, { upsert: false, contentType });
  if (upErr) throw new Error(upErr.message || 'The document could not be uploaded.');

  const { data, error } = await supabase.rpc('attach_payment_proof', {
    p_module:     module,
    p_record_id:  recordId,
    p_path:       path,
    p_file_name:  file.name,
    p_mime_type:  contentType || null,
    p_size_bytes: file.size ?? null,
    p_note:       note?.trim() || null,
  });
  if (error) {
    await supabase.storage.from(PROOF_BUCKET).remove([path]).catch(() => {});
    throw new Error(error.message || 'The document could not be attached.');
  }
  return Array.isArray(data) ? data[0] : data;
};

/** Proofs for one or many records, grouped by record id. */
export const listPaymentProofs = async (module, recordIds) => {
  const ids = [...new Set((recordIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const column = module === 'sacco' ? 'contribution_id' : 'payment_id';
  const { data, error } = await supabase
    .from('payment_proofs')
    .select('id, module, payment_id, contribution_id, storage_path, file_name, mime_type, size_bytes, note, uploaded_by, created_at')
    .in(column, ids)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).reduce((acc, p) => {
    const key = p[column];
    (acc[key] ||= []).push(p);
    return acc;
  }, {});
};

/** Open a proof in a new tab through a short-lived signed URL. */
export const openPaymentProof = async (proof) => {
  // Open synchronously so the popup blocker sees a user gesture, then point it.
  const win = window.open('', '_blank');
  try {
    const { data, error } = await supabase.storage
      .from(PROOF_BUCKET)
      .createSignedUrl(proof.storage_path, 300);
    if (error || !data?.signedUrl) throw new Error(error?.message || 'Could not open the document.');
    if (win) win.location.href = data.signedUrl;
    else window.location.assign(data.signedUrl);
  } catch (e) {
    win?.close();
    throw e;
  }
};

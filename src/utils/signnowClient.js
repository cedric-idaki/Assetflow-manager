/**
 * signnowClient.js
 *
 * Everything the app does to get a certificate signed, in one place.
 *
 * THE ORDER MATTERS, AND IT IS NOT OBVIOUS
 * ----------------------------------------
 *   1. mint the platform serial          — so it is printed on the page the
 *                                          officers actually sign
 *   2. build the PDF (watermarked DRAFT) — certificatePdf.js
 *   3. signing_request_open()            — records intent and the digest, and
 *                                          derives the storage path
 *   4. upload to signed-certificates     — the edge function reads it back from
 *                                          there rather than being handed bytes
 *   5. signnow-documents `send`          — the only step that talks to SignNow
 *
 * Steps 1–4 are done here because they need the user's session (RLS, and the
 * serial issuers check who is asking). Step 5 is done in an edge function
 * because it needs the tenant's SignNow password, which must never reach a
 * browser.
 *
 * If step 5 fails the request is left at `failed` with the reason on it, rather
 * than rolled back — an operator needs to see that a send was attempted, and
 * the row is where the error message lives.
 */

import { supabase } from '../lib/supabase';
import { resolveFileUrl } from '../lib/storageUrl';
import { cleanPanel } from './certificateSigning';

const BUCKET = 'signed-certificates';
const FN_DOCS = 'signnow-documents';
const FN_CREDS = 'signnow-credentials';

/** supabase.functions.invoke buries the function's own error body. Dig it out
 *  so the operator sees "SignNow rejected the sign-in", not "non-2xx". */
const unwrap = async (invocation) => {
  const { data, error } = await invocation;
  if (!error) return data;

  let detail = '';
  try {
    const body = await error.context?.json?.();
    detail = body?.error || '';
  } catch { /* the body was not JSON */ }

  throw new Error(detail || error.message || 'The request failed.');
};

// ===========================================================================
// CONNECTION (settings)
// ===========================================================================

export const signnowStatus = () =>
  unwrap(supabase.functions.invoke(FN_CREDS, { body: { action: 'status' } }));

export const signnowSave = (payload) =>
  unwrap(supabase.functions.invoke(FN_CREDS, { body: { action: 'save', ...payload } }));

export const signnowDisable = () =>
  unwrap(supabase.functions.invoke(FN_CREDS, { body: { action: 'disable' } }));

export const signnowDisconnect = () =>
  unwrap(supabase.functions.invoke(FN_CREDS, { body: { action: 'disconnect' } }));

// ===========================================================================
// POLICY
// ===========================================================================

/** The tenant's signing policies, keyed by document kind. */
export const loadSigningPolicies = async () => {
  const { data, error } = await supabase
    .from('signing_policies')
    .select('doc_kind, require_signature, signatories, signing_order, expires_days, auto_release');
  if (error) throw error;
  return Object.fromEntries((data || []).map((p) => [p.doc_kind, p]));
};

export const saveSigningPolicy = async ({
  docKind, require, signatories, signingOrder, expiresDays, autoRelease,
}) => {
  const { data, error } = await supabase.rpc('signing_policy_upsert', {
    p_doc_kind: docKind,
    p_require: !!require,
    p_signatories: cleanPanel(signatories),
    p_signing_order: signingOrder === 'parallel' ? 'parallel' : 'sequential',
    p_expires_days: expiresDays ? Number(expiresDays) : null,
    p_auto_release: autoRelease !== false,
  });
  if (error) throw error;
  return data;
};

// ===========================================================================
// STATUS
// ===========================================================================

/**
 * Signing state for a page of records, in one round trip.
 *
 * Returns a map keyed by source id. Rows with no signing request are simply
 * absent — the caller decides what "never sent" should look like, because that
 * differs by screen.
 */
export const signingStatusFor = async (sourceTable, sourceIds) => {
  const ids = (sourceIds || []).filter(Boolean);
  if (ids.length === 0) return {};

  const { data, error } = await supabase.rpc('signing_status_for', {
    p_source_table: sourceTable,
    p_source_ids: ids,
  });
  if (error) throw error;

  return Object.fromEntries((data || []).map((r) => [r.source_id, {
    requestId: r.request_id,
    status: r.status,
    docKind: r.doc_kind,
    documentName: r.document_name,
    signedPath: r.signed_path,
    serial: r.certificate_serial,
    signersTotal: r.signers_total,
    signersSigned: r.signers_signed,
    sentAt: r.sent_at,
    signedAt: r.signed_at,
    releasedAt: r.released_at,
    declineReason: r.decline_reason,
  }]));
};

// ===========================================================================
// GUARANTEE AGREEMENTS — the sacco-only kind
// ===========================================================================

/**
 * Execution state for a page of guarantees.
 *
 * A separate RPC from signingStatusFor() because the people who most need this
 * answer are not staff: is_staff_member() excludes sacco members, so
 * signing_status_for() returns them nothing at all. This one answers for the
 * PARTIES to each agreement as well as the society's staff, which is why the
 * member portal and the sacco dashboard can both read it.
 *
 * `required` rides along per row: "nothing sent yet" means one thing when the
 * society requires execution and something else entirely when it does not.
 */
export const guaranteeSigningStates = async (guaranteeIds) => {
  const ids = (guaranteeIds || []).filter(Boolean);
  if (ids.length === 0) return {};

  const { data, error } = await supabase.rpc('sacco_guarantee_signing_states', {
    p_guarantee_ids: ids,
  });
  if (error) throw error;

  return Object.fromEntries((data || []).map((r) => [r.guarantee_id, {
    required: !!r.required,
    requestId: r.request_id,
    // A guarantee with no request at all comes back as a row of nulls, because
    // `required` is worth knowing even then. Callers test `status`.
    status: r.status,
    docKind: 'guarantee_agreement',
    documentName: r.document_name,
    signedPath: r.signed_path,
    signersTotal: r.signers_total,
    signersSigned: r.signers_signed,
    sentAt: r.sent_at,
    signedAt: r.signed_at,
    releasedAt: r.released_at,
    declineReason: r.decline_reason,
  }]));
};

/**
 * Why this guarantee cannot be sent for signature, as a sentence, or null.
 *
 * The server's own rule, asked rather than re-derived — signing_request_open()
 * calls the identical function, so the screen and the RPC cannot disagree about
 * who may be sent out. See sacco_guarantee_signing_block().
 */
export const guaranteeSigningBlock = async (guaranteeId) => {
  const { data, error } = await supabase.rpc('sacco_guarantee_signing_block', {
    p_guarantee_id: guaranteeId,
  });
  if (error) throw error;
  return data || null;
};

/** The per-signer detail and the event trail for one request. */
export const loadSigningRequest = async (requestId) => {
  const [{ data: request }, { data: signers }, { data: events }] = await Promise.all([
    supabase.from('signing_requests').select('*').eq('id', requestId).maybeSingle(),
    supabase.from('signing_request_signers').select('*').eq('request_id', requestId)
      .order('signing_order', { ascending: true }),
    supabase.from('signing_request_events').select('*').eq('request_id', requestId)
      .order('created_at', { ascending: false }).limit(50),
  ]);
  return { request: request || null, signers: signers || [], events: events || [] };
};

// ===========================================================================
// SENDING
// ===========================================================================

/**
 * Mint the platform serial for a record, where its kind has an issuer.
 *
 * Returns null rather than throwing for the kinds that have none. A missing
 * serial is a worse certificate, not a failed send — and the release path mints
 * one as a last resort.
 */
export const mintSerialFor = async (docKind, sourceId) => {
  // Failures here deliberately propagate. settlement_certificate_issue()
  // refuses to mint for a plan that is not actually settled, and that refusal
  // means the document should not exist — it is not something to send anyway
  // and apologise for afterwards.
  if (docKind === 'share_certificate') {
    const { data, error } = await supabase.rpc('sacco_share_certificate_serial', {
      p_certificate_id: sourceId,
    });
    if (error) throw error;
    return data || null;
  }
  if (docKind === 'settlement_certificate') {
    const { data, error } = await supabase.rpc('settlement_certificate_issue', {
      p_plan_id: sourceId,
    });
    if (error) throw error;
    return data || null;
  }
  if (docKind === 'guarantee_agreement') {
    // Refuses for a guarantee the member has not confirmed, and that refusal
    // is the right answer: an unconfirmed agreement is not a document the
    // registry should be asserting anything about.
    const { data, error } = await supabase.rpc('sacco_guarantee_agreement_serial', {
      p_guarantee_id: sourceId,
    });
    if (error) throw error;
    return data || null;
  }
  return null;
};

/** SHA-256 of the blob, hex — the same digest the edge function recomputes. */
const digestOf = async (blob) => {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Where a request's draft goes.
 *
 * The path is NOT computed here. signing_request_open() derives it from the
 * tenant it resolved for the record, and this reads that value back — because
 * the leading folder has to equal current_admin_id() for the bucket's RLS to
 * accept the upload, and the browser does not reliably know that value. A staff
 * member of a society resolves to their owning admin, not to their own user id,
 * and computing it here would put the file in a folder they are not allowed to
 * write to.
 */
const draftPathOf = async (requestId) => {
  const { data, error } = await supabase
    .from('signing_requests')
    .select('draft_path')
    .eq('id', requestId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.draft_path) throw new Error('The signing request has no storage path.');
  return data.draft_path;
};

/**
 * `upsert` is on because regenerating a draft for the same request must replace
 * it rather than fail. Note that the SIGNED copy is written by the service role
 * to a different path, and no policy lets a browser overwrite that one.
 */
const uploadDraft = async (path, blob) => {
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, blob, { upsert: true, contentType: 'application/pdf' });
  if (error) throw new Error(`Could not store the document: ${error.message}`);
  return path;
};

/**
 * The whole send, start to finish.
 *
 * `build` is a function returning { blob, filename, fields, page } — normally
 * one of certificatePdf.js's builders, already bound to the record's facts by
 * the calling screen, which is the only place that knows them.
 *
 * The three-phase shape exists because the storage path contains the request
 * id, so the row has to exist before the file can be written.
 * signing_request_open() derives and stores that path; this reads it back and
 * uploads to it, so there is exactly one formula and the browser never has to
 * guess which tenant folder it is allowed to write in.
 */
export const sendForSignature = async ({
  docKind, sourceTable, sourceId, documentName, signers, message, build,
}) => {
  const panel = cleanPanel(signers);
  if (panel.length === 0) {
    throw new Error('Name at least one signatory, with an email address, before sending.');
  }

  // 1. The serial goes on the page they sign.
  const serial = await mintSerialFor(docKind, sourceId);

  // 2. Draw it.
  const built = await build({ serial, signers: panel });
  if (!built?.blob) throw new Error('The document could not be generated.');
  const digest = await digestOf(built.blob);

  // 3. Open the request. Doing this before the upload means a failed upload
  //    leaves a draft with no file, which the send step then refuses — visible
  //    and recoverable, where the other order would leave an orphan file with
  //    nothing pointing at it.
  const { data: requestId, error: openErr } = await supabase.rpc('signing_request_open', {
    p_doc_kind: docKind,
    p_source_table: sourceTable,
    p_source_id: sourceId,
    p_document_name: documentName,
    p_draft_digest: digest,
    p_serial: serial,
    p_signers: panel,
    p_message: message || null,
  });
  if (openErr) throw openErr;

  // 4. Store the file at the path the request already records.
  await uploadDraft(await draftPathOf(requestId), built.blob);

  // 5. Off to SignNow.
  const result = await unwrap(supabase.functions.invoke(FN_DOCS, {
    body: {
      action: 'send',
      requestId,
      fields: built.fields || [],
      lastPage: built.page ?? 0,
    },
  }));

  return { requestId, serial, ...result };
};

export const syncSigningRequest = (requestId) =>
  unwrap(supabase.functions.invoke(FN_DOCS, { body: { action: 'sync', requestId } }));

export const cancelSigningRequest = (requestId, reason) =>
  unwrap(supabase.functions.invoke(FN_DOCS, { body: { action: 'cancel', requestId, reason } }));

/** Release by hand, for tenants that chose not to auto-release. */
export const releaseSigningRequest = async (requestId) => {
  const { data, error } = await supabase.rpc('signing_request_release_manual', {
    p_request_id: requestId,
  });
  if (error) throw error;
  return data;
};

// ===========================================================================
// READING THE SIGNED DOCUMENT
// ===========================================================================

/**
 * A short-lived URL for a signed certificate.
 *
 * The bucket is private, so this is a signed URL minted for the current
 * session, not a permanent link — see storageUrl.js for why every private
 * bucket in this app is read that way.
 */
export const signedCertificateUrl = (signedPath) =>
  resolveFileUrl(signedPath, { bucket: BUCKET });

/** Open the signed certificate in a new tab. Returns false if popups blocked. */
export const openSignedCertificate = async (signedPath) => {
  const url = await signedCertificateUrl(signedPath);
  if (!url) return false;
  const w = window.open(url, '_blank', 'noopener');
  return !!w;
};

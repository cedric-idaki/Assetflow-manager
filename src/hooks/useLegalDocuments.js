/**
 * useLegalDocuments
 *
 * The terms, as a published document rather than a URL in a source file.
 *
 * READABLE WITHOUT A SESSION. The active version is fetched with the anon key
 * because the terms are shown DURING registration, before anyone is signed in
 * — a hook that needed auth would show a blank modal to exactly the people who
 * have to read it.
 *
 * ACCEPTANCE RECORDS THE VERSION, AND THE SERVER PICKS IT. `record_legal_acceptance`
 * resolves the active document itself; the client never names one. A client
 * that could name the version could record agreement to a document it never
 * displayed, which would make the whole record worthless as evidence.
 *
 * PUBLISHING IS PLATFORM-OWNER ONLY and enforced in the RPC, not here. These
 * are the terms everybody on the platform signs up under; a tenant admin
 * publishing them for everybody is not a thing that should be reachable.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { logger } from '../utils/logger';

const COLS = 'id, doc_kind, version, title, summary, file_path, file_name, ' +
             'body_html, external_url, is_active, effective_from, published_at, created_at';

const BUCKET = 'legal-documents';

/** A public bucket, so this is a plain URL — no signing, no session needed. */
export const legalFileUrl = (filePath) => {
  if (!filePath) return null;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
  return data?.publicUrl || null;
};

/** Where the document can actually be read from, whatever form it took. */
export const legalDocumentUrl = (doc) => {
  if (!doc) return null;
  if (doc.file_path) return legalFileUrl(doc.file_path);
  return doc.external_url || null;
};

/**
 * The one version currently in force. Used by the registration modal.
 */
export const useActiveLegalDocument = (docKind = 'terms') => {
  const [doc, setDoc]         = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error: err } = await supabase
          .from('legal_documents')
          .select(COLS)
          .eq('doc_kind', docKind)
          .eq('is_active', true)
          .maybeSingle();
        if (err) throw err;
        if (alive) setDoc(data || null);
      } catch (err) {
        logger.debug('[useActiveLegalDocument] unavailable', { message: err?.message });
        if (alive) setError(err?.message || 'Could not load the document.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [docKind]);

  return { doc, loading, error };
};

/**
 * Record that this person accepted whatever version is currently active.
 *
 * NOTHING ESCAPES THIS FUNCTION. It is called from the registration path
 * WITHOUT being awaited, so a rejection here does not fail a signup — it
 * becomes an unhandled rejection, which in a browser is a console error and in
 * a test run is a failure in whatever happened to be running at the time. The
 * whole body is therefore inside a try/catch, not just the `error` branch:
 * `supabase.rpc` can throw as well as resolve with an error, and the first
 * version of this only handled the second.
 *
 * A missing acceptance row is a gap in the record. A registration that fails
 * because of one is a lost customer. The gap is the better trade, but it is
 * logged so it is a gap somebody can find.
 */
export const recordLegalAcceptance = async ({ docKind = 'terms', email, fullName } = {}) => {
  try {
    const { data, error } = await supabase.rpc('record_legal_acceptance', {
      p_doc_kind:  docKind,
      p_email:     email || null,
      p_full_name: fullName || null,
    });
    if (error) {
      logger.warn('[recordLegalAcceptance] not recorded', { message: error.message });
      return null;
    }
    return data;
  } catch (err) {
    logger.warn('[recordLegalAcceptance] threw', { message: err?.message });
    return null;
  }
};

/**
 * The publishing side: every version, and the verbs to add one.
 */
export const useLegalLibrary = (docKind = 'terms') => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: err } = await supabase
        .from('legal_documents')
        .select(COLS)
        .eq('doc_kind', docKind)
        .order('effective_from', { ascending: false })
        .order('created_at', { ascending: false });
      if (err) throw err;
      setDocuments(data || []);
    } catch (err) {
      setError(err?.message || 'Could not load the document history.');
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [docKind]);

  useEffect(() => { load(); }, [load]);

  /**
   * Publish a new version.
   *
   * The file goes up first and the row second — an orphan object is
   * recoverable, a published version pointing at a document that was never
   * uploaded is terms nobody can read.
   */
  const publish = useCallback(async ({ version, title, summary, file, bodyHtml, externalUrl, activate = true, effectiveFrom }) => {
    let filePath = null;
    let fileName = null;

    if (file) {
      const safe = file.name.replace(/[^\w.-]+/g, '_');
      filePath = `${docKind}/${version.replace(/[^\w.-]+/g, '_')}_${Date.now()}_${safe}`;
      fileName = file.name;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, file, { upsert: false, contentType: file.type || 'application/pdf' });
      if (upErr) throw new Error(upErr.message || 'The document could not be uploaded.');
    }

    const { data, error: err } = await supabase.rpc('publish_legal_document', {
      p_doc_kind:     docKind,
      p_version:      version,
      p_title:        title,
      p_summary:      summary || null,
      p_file_path:    filePath,
      p_file_name:    fileName,
      p_body_html:    bodyHtml || null,
      p_external_url: externalUrl || null,
      p_activate:     activate,
      p_effective:    effectiveFrom || null,
    });
    if (err) {
      if (filePath) await supabase.storage.from(BUCKET).remove([filePath]).catch(() => {});
      throw new Error(err.message || 'Could not publish the document.');
    }
    await load();
    return data;
  }, [docKind, load]);

  const activate = useCallback(async (id) => {
    const { error: err } = await supabase.rpc('activate_legal_document', { p_id: id });
    if (err) throw new Error(err.message || 'Could not activate that version.');
    await load();
  }, [load]);

  /** Who accepted a given version — the reason for versioning at all. */
  const acceptances = useCallback(async (documentId) => {
    const { data, error: err } = await supabase
      .from('legal_acceptances')
      .select('id, user_id, email, full_name, accepted_at')
      .eq('document_id', documentId)
      .order('accepted_at', { ascending: false })
      .limit(500);
    if (err) throw err;
    return data || [];
  }, []);

  return { documents, loading, error, refetch: load, publish, activate, acceptances };
};

export default useActiveLegalDocument;

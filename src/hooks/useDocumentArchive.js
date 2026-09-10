/**
 * useDocumentArchive
 *
 * Everything the system has issued, findable.
 *
 * FILTERS GO TO THE SERVER, SEARCH DOES NOT — and the split is deliberate. The
 * archive grows without bound: a two-till shop issues tens of thousands of
 * receipts a year, so narrowing by date, kind, module or client has to happen
 * in SQL or the page fetches the whole book to show twenty-five rows. The
 * free-text box is a server filter too, for the same reason — a trigram index
 * covers title, reference and client name together (see 20260908200000).
 *
 * COUNTS COME FROM SQL. document_archive_summary() is SECURITY INVOKER, so the
 * same call tells staff what the tenant holds and a client what they hold.
 * Nothing here counts a fetched page and calls it a total.
 *
 * DOWNLOADS ARE SIGNED, ONE AT A TIME. The bucket is private and stays private:
 * a URL that works without a session is a receipt anybody who guesses the path
 * can read. Bulk download therefore signs and fetches each file in turn rather
 * than handing out a folder link.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { archivedDocumentUrl } from '../utils/documentArchive';
import { logger } from '../utils/logger';

const PAGE_SIZE = 50;

export const DOC_TYPES = [
  { value: 'receipt',     label: 'Receipts' },
  { value: 'invoice',     label: 'Invoices' },
  { value: 'voucher',     label: 'Vouchers' },
  { value: 'statement',   label: 'Statements' },
  { value: 'payslip',     label: 'Payslips' },
  { value: 'certificate', label: 'Certificates' },
  { value: 'contract',    label: 'Contracts' },
  { value: 'advice',      label: 'Advices' },
  { value: 'report',      label: 'Reports' },
  { value: 'other',       label: 'Other' },
];

export const DOC_MODULES = [
  { value: 'accounting', label: 'Accounting' },
  { value: 'payments',   label: 'Payments' },
  { value: 'sacco',      label: 'SACCO' },
  { value: 'payroll',    label: 'Payroll' },
  { value: 'pos',        label: 'Point of Sale' },
  { value: 'other',      label: 'Other' },
];

export const SORTS = [
  { value: 'issued_at.desc',  label: 'Newest first',    column: 'issued_at',   ascending: false },
  { value: 'issued_at.asc',   label: 'Oldest first',    column: 'issued_at',   ascending: true  },
  { value: 'client_name.asc', label: 'Client A–Z',      column: 'client_name', ascending: true  },
  { value: 'doc_type.asc',    label: 'Document type',   column: 'doc_type',    ascending: true  },
  { value: 'amount.desc',     label: 'Largest amount',  column: 'amount',      ascending: false },
];

const COLS = 'id, doc_type, module, title, reference, client_id, client_name, ' +
             'amount, currency, file_path, file_name, file_size, issued_at, created_at';

export const EMPTY_FILTERS = {
  search: '', docType: 'all', module: 'all', clientId: '',
  from: '', to: '', sort: 'issued_at.desc',
};

export const useDocumentArchive = () => {
  const [documents, setDocuments] = useState([]);
  const [summary, setSummary]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [hasMore, setHasMore]     = useState(false);
  const [filters, setFilters]     = useState(EMPTY_FILTERS);

  const pageRef = useRef(0);
  const mounted = useRef(true);

  const query = useCallback((page) => {
    const sort = SORTS.find(s => s.value === filters.sort) || SORTS[0];
    const from = page * PAGE_SIZE;

    let q = supabase
      .from('document_archive')
      .select(COLS)
      .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
      .range(from, from + PAGE_SIZE);   // one extra row tells us there is more

    if (filters.docType !== 'all') q = q.eq('doc_type', filters.docType);
    if (filters.module  !== 'all') q = q.eq('module', filters.module);
    if (filters.clientId)          q = q.eq('client_id', filters.clientId);
    if (filters.from)              q = q.gte('issued_at', new Date(filters.from).toISOString());
    if (filters.to) {
      const end = new Date(filters.to);
      end.setHours(23, 59, 59, 999);
      q = q.lte('issued_at', end.toISOString());
    }
    if (filters.search.trim()) {
      // One OR across the three columns the trigram index covers. Searching
      // them separately would need three round trips and could not be ordered.
      const term = `%${filters.search.trim()}%`;
      q = q.or(`title.ilike.${term},reference.ilike.${term},client_name.ilike.${term}`);
    }
    return q;
  }, [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      pageRef.current = 0;
      const [{ data, error: err }, { data: sum }] = await Promise.all([
        query(0),
        supabase.rpc('document_archive_summary'),
      ]);
      if (err) throw err;
      if (!mounted.current) return;

      const rows = data || [];
      setHasMore(rows.length > PAGE_SIZE);
      setDocuments(rows.slice(0, PAGE_SIZE));
      setSummary(sum || []);
    } catch (err) {
      logger.error('[useDocumentArchive] load failed', { message: err?.message });
      if (mounted.current) {
        setError(err?.message || 'Could not load the document archive.');
        setDocuments([]);
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [query]);

  const loadMore = useCallback(async () => {
    if (!hasMore) return;
    try {
      const next = pageRef.current + 1;
      const { data, error: err } = await query(next);
      if (err) throw err;
      pageRef.current = next;
      if (!mounted.current) return;
      const rows = data || [];
      setHasMore(rows.length > PAGE_SIZE);
      setDocuments(prev => [...prev, ...rows.slice(0, PAGE_SIZE)]);
    } catch (err) {
      setError(err?.message || 'Could not load more documents.');
    }
  }, [hasMore, query]);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; };
  }, [load]);

  /** Open one document in a new tab, on a link that expires. */
  const open = useCallback(async (doc) => {
    const url = await archivedDocumentUrl(doc.file_path);
    if (!url) throw new Error('That document is no longer in storage.');
    window.open(url, '_blank', 'noopener,noreferrer');
    return url;
  }, []);

  /** Save one document to disk. */
  const download = useCallback(async (doc) => {
    const url = await archivedDocumentUrl(doc.file_path);
    if (!url) throw new Error('That document is no longer in storage.');
    const res = await fetch(url);
    if (!res.ok) throw new Error('That document could not be fetched.');
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = doc.file_name || 'document.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick: Safari cancels the download if the URL dies
    // while the save dialog is still opening.
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  }, []);

  /**
   * Save several.
   *
   * Sequential, with a pause, and it reports what actually landed. Browsers
   * throttle or silently drop a burst of downloads from one gesture, so firing
   * them all at once produces a "downloaded 40 files" message and eleven
   * files. Reporting the real number is the difference between a tool somebody
   * trusts for an audit pack and one they check by hand anyway.
   */
  const downloadMany = useCallback(async (docs, onProgress) => {
    let done = 0;
    const failed = [];
    for (const doc of docs) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await download(doc);
        done += 1;
      } catch (err) {
        failed.push({ doc, message: err?.message });
      }
      onProgress?.(done + failed.length, docs.length);
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setTimeout(r, 400));
    }
    return { done, failed };
  }, [download]);

  return {
    documents, summary, loading, error, hasMore,
    filters, setFilters,
    refetch: load, loadMore,
    open, download, downloadMany,
  };
};

export default useDocumentArchive;

/**
 * useClientRecords — the FinHub client book.
 *
 * A client record is what makes somebody billable: company_invoices.client_id,
 * payments.client_id and payment_requests.client_id all point at the same
 * public.clients row. This hook owns the four things a caller needs to do with
 * one — find out whether it already exists, create it, read what it owes, and
 * read how it got there.
 *
 * EVERY FIGURE COMES FROM AN RPC, none from a reduction in the browser. The
 * book is paged, and a page reduced into a total is a total that is quietly
 * wrong for any tenant past the page size — the mistake 20260822140000 took
 * out of the SACCO dashboard. `finhub_client_book` therefore aggregates in
 * Postgres and returns the true row count beside the page.
 *
 * NUMBERS ARRIVE AS STRINGS. PostgREST serialises numeric and bigint as text,
 * so every money field is passed through Number() on the way in. Skip that and
 * "50000" + "12000" is "5000012000".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { logger } from '../utils/logger';

/** One page of the book. Matches the RPC's own default. */
export const CLIENT_PAGE_SIZE = 50;

/**
 * What the database raises when the details entered already belong to somebody.
 * PostgREST passes the SQLSTATE through as `error.code`, which is the only
 * reliable way to tell this apart from a genuine failure — the message is
 * written for a person, not for a switch statement.
 */
export const DUPLICATE_CODE = '23505';

/** How long after the last keystroke before asking the server who this is. */
const DUPLICATE_DEBOUNCE_MS = 450;

/** Enough of an identity to be worth a lookup. A half-typed name is not. */
const worthChecking = (form) =>
  Boolean(
    (form?.email && form.email.includes('@')) ||
    (form?.phone && form.phone.replace(/\D/g, '').length >= 9) ||
    (form?.kra_pin && form.kra_pin.trim().length >= 9) ||
    (form?.national_id && form.national_id.trim().length >= 6) ||
    (form?.full_name && form.full_name.trim().length >= 4)
  );

const num = (v) => Number(v || 0);

/** The RPC's `matched_on` array, said in the words the operator used. */
export const MATCH_LABELS = {
  kra_pin:     'KRA PIN',
  national_id: 'ID number',
  phone:       'phone number',
  email:       'email',
  name:        'name',
};

export const describeMatch = (matchedOn = []) => {
  const parts = matchedOn.map(m => MATCH_LABELS[m] || m);
  if (parts.length === 0) return 'the details entered';
  if (parts.length === 1) return `the same ${parts[0]}`;
  return `the same ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
};

/**
 * A match strong enough that the server will refuse to create alongside it.
 * Mirrors the `match_score >= 25` gate in finhub_create_client: the UI must not
 * present as a suggestion what the database is about to treat as a blocker.
 */
export const BLOCKING_SCORE = 25;
export const isBlockingMatch = (row) => num(row?.match_score) >= BLOCKING_SCORE;

const normaliseBookRow = (r) => ({
  ...r,
  invoiced:      num(r.invoiced),
  paid:          num(r.paid),
  balance:       num(r.balance),
  invoice_count: num(r.invoice_count),
  overdue_count: num(r.overdue_count),
  total_count:   num(r.total_count),
});

export const useClientRecords = ({ enabled = true, pageSize = CLIENT_PAGE_SIZE } = {}) => {
  const [clients, setClients] = useState([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(0);
  const [search,  setSearch]  = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  // The page and search in flight, so a slow response for an old search cannot
  // overwrite the rows for the current one.
  const requestRef = useRef(0);

  const fetchBook = useCallback(async (opts = {}) => {
    const nextPage   = opts.page   ?? page;
    const nextSearch = opts.search ?? search;
    const ticket = ++requestRef.current;

    setLoading(true);
    try {
      const { data, error: err } = await supabase.rpc('finhub_client_book', {
        p_search: nextSearch?.trim() || null,
        p_limit:  pageSize,
        p_offset: nextPage * pageSize,
      });
      if (err) throw err;
      if (ticket !== requestRef.current) return;      // a newer request won

      const rows = (data || []).map(normaliseBookRow);
      setClients(rows);
      // total_count rides on every row; with no rows there is nothing to count.
      setTotal(rows.length > 0 ? rows[0].total_count : 0);
      setError(null);
    } catch (err) {
      if (ticket !== requestRef.current) return;
      logger.error('[useClientRecords] book failed', err?.message);
      setClients([]);
      setTotal(0);
      setError(err?.message || 'Could not load the client book');
    } finally {
      if (ticket === requestRef.current) setLoading(false);
    }
  }, [page, search, pageSize]);

  useEffect(() => {
    if (!enabled) return;
    fetchBook({ page, search });
    // fetchBook closes over page/search already; depending on it as well would
    // fire the request twice for every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, page, search]);

  const goToPage    = useCallback((p) => setPage(Math.max(0, p)), []);
  const applySearch = useCallback((term) => { setPage(0); setSearch(term || ''); }, []);

  /**
   * Who is already on file that looks like this?
   *
   * Returns rows, never throws: this runs while somebody is typing, and a
   * failed lookup must not put an error in front of them mid-form. It does mean
   * an unreachable server looks like "no duplicates", which is why the server
   * refuses duplicates on its own account rather than trusting this answer.
   */
  const findDuplicates = useCallback(async (form, { excludeId = null, limit = 5 } = {}) => {
    try {
      const { data, error: err } = await supabase.rpc('finhub_find_client_duplicates', {
        p_full_name:   form?.full_name?.trim()   || null,
        p_email:       form?.email?.trim()       || null,
        p_phone:       form?.phone?.trim()       || null,
        p_kra_pin:     form?.kra_pin?.trim()     || null,
        p_national_id: form?.national_id?.trim() || null,
        p_exclude_id:  excludeId,
        p_limit:       limit,
      });
      if (err) throw err;
      return (data || []).map(r => ({ ...r, match_score: num(r.match_score) }));
    } catch (err) {
      logger.debug('[useClientRecords] duplicate lookup unavailable', err?.message);
      return [];
    }
  }, []);

  /**
   * Create the record, or adopt the one already there.
   *
   * `useExistingId` is the operator saying "that is the same person": no new
   * row, the existing one takes the lead link and any billing field it was
   * missing. `force` is them saying the opposite.
   */
  const createClient = useCallback(async (form, { leadId = null, agentId = null, useExistingId = null, force = false } = {}) => {
    const { data, error: err } = await supabase.rpc('finhub_create_client', {
      p_full_name:       form?.full_name?.trim() || '',
      p_phone:           form?.phone?.trim()     || null,
      p_email:           form?.email?.trim()     || null,
      p_kra_pin:         form?.kra_pin?.trim()   || null,
      p_national_id:     form?.national_id?.trim() || null,
      p_billing_address: form?.billing_address?.trim() || null,
      p_customer_type:   form?.customer_type || 'account',
      p_lead_id:         leadId,
      p_agent_id:        agentId,
      p_notes:           form?.notes?.trim() || null,
      p_use_existing:    useExistingId,
      p_force:           force,
    });
    if (err) throw err;
    // The function returns one clients row; PostgREST may hand it back bare or
    // wrapped in an array depending on how the call was shaped.
    return Array.isArray(data) ? data[0] : data;
  }, []);

  /** What one client owes, and how it got there. */
  const loadAccount = useCallback(async (clientId, { statementLimit = 100 } = {}) => {
    const [summaryRes, statementRes] = await Promise.all([
      supabase.rpc('finhub_client_summary',   { p_client_id: clientId }),
      supabase.rpc('finhub_client_statement', { p_client_id: clientId, p_limit: statementLimit }),
    ]);
    if (summaryRes.error)   throw summaryRes.error;
    if (statementRes.error) throw statementRes.error;

    const s = Array.isArray(summaryRes.data) ? summaryRes.data[0] : summaryRes.data;
    return {
      summary: s ? {
        ...s,
        invoiced:          num(s.invoiced),
        paid:              num(s.paid),
        balance:           num(s.balance),
        invoice_count:     num(s.invoice_count),
        unpaid_count:      num(s.unpaid_count),
        overdue_count:     num(s.overdue_count),
        payment_count:     num(s.payment_count),
        hire_purchase_due: num(s.hire_purchase_due),
      } : null,
      statement: (statementRes.data || []).map(r => ({
        ...r,
        charged:         num(r.charged),
        received:        num(r.received),
        running_balance: num(r.running_balance),
      })),
    };
  }, []);

  return {
    clients, total, page, search, loading, error,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    goToPage, applySearch,
    refetch: fetchBook,
    findDuplicates, createClient, loadAccount,
  };
};

/**
 * Watches a half-filled form and asks the server who it already knows.
 *
 * Debounced, and the answer for a stale keystroke is discarded rather than
 * rendered: a duplicate panel that lags a field behind is worse than none,
 * because it names the wrong person.
 */
export const useDuplicateWatch = (form, findDuplicates, { enabled = true, excludeId = null } = {}) => {
  const [matches, setMatches] = useState([]);
  const [checking, setChecking] = useState(false);
  const ticketRef = useRef(0);

  const key = [form?.full_name, form?.email, form?.phone, form?.kra_pin, form?.national_id].join('|');

  useEffect(() => {
    if (!enabled || !worthChecking(form)) { setMatches([]); return undefined; }

    const ticket = ++ticketRef.current;
    setChecking(true);
    const timer = setTimeout(async () => {
      const rows = await findDuplicates(form, { excludeId });
      if (ticket !== ticketRef.current) return;
      setMatches(rows);
      setChecking(false);
    }, DUPLICATE_DEBOUNCE_MS);

    return () => { clearTimeout(timer); };
    // `key` is the whole of what the lookup depends on; `form` is a new object
    // on every keystroke and would restart the timer even when nothing changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, excludeId, findDuplicates]);

  return { matches, checking, blocking: matches.filter(isBlockingMatch) };
};

export default useClientRecords;

/**
 * useBankReconciliation
 *
 * The statement, the payments, and what agrees with what.
 *
 * PARSING HAPPENS HERE, NOT IN THE DATABASE. Every bank exports a different
 * CSV — different column names, different date formats, debits as negatives or
 * in their own column — and a parser in SQL could neither be shown to a human
 * before committing nor corrected when a bank changes its export. So the file
 * is read in the browser, mapped, PREVIEWED, and only then sent as rows.
 *
 * NOTHING IS GUESSED. A line whose date or amount cannot be read is reported
 * as unreadable rather than defaulted — an invented date silently matches the
 * wrong payment, which is worse than a line nobody imported.
 *
 * MATCHING IS THE SERVER'S. bank_reconcile_auto() owns the two passes and the
 * ambiguity rule; this hook calls it and reports what it did. Re-implementing
 * the matching here would give two answers to "is this payment confirmed".
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { logger } from '../utils/logger';

const PAGE_SIZE = 100;

const TXN_COLS = 'id, bank_account, txn_date, value_date, description, bank_reference, ' +
                 'amount, direction, status, matched_payment_id, match_method, review_note, ' +
                 'currency, created_at';

/** Header names banks actually use, lowercased, in the order we prefer them. */
const HEADER_ALIASES = {
  txn_date:       ['transaction date', 'txn date', 'date', 'posting date', 'trans date', 'value date'],
  value_date:     ['value date', 'val date'],
  description:    ['description', 'narrative', 'details', 'particulars', 'transaction details', 'remarks'],
  bank_reference: ['reference', 'ref', 'transaction ref', 'cheque no', 'cheque number', 'reference no', 'transaction id'],
  amount:         ['amount', 'credit', 'money in', 'deposit', 'credit amount'],
  debit:          ['debit', 'money out', 'withdrawal', 'debit amount'],
  running_balance:['balance', 'running balance', 'closing balance'],
};

const norm = (h) => String(h || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');

/**
 * A date the way a Kenyan bank writes it.
 *
 * dd/mm/yyyy is tried BEFORE the ISO parse, because `new Date('03/04/2026')`
 * silently reads that as 4 March in a US locale — which is not an error, just
 * a payment reconciled into the wrong month.
 */
export const parseStatementDate = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return null;

  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(text);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? `20${y}` : y;
    const iso = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    return Number.isNaN(new Date(iso).getTime()) ? null : iso;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

/** "1,234.50", "(1,234.50)" and "-1,234.50" all mean the same thing to a bank. */
export const parseStatementAmount = (raw) => {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text) || text.startsWith('-');
  const digits = text.replace(/[()\s]/g, '').replace(/[^0-9.-]/g, '').replace(/-/g, '');
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isFinite(n) || n === 0) return null;
  return negative ? -n : n;
};

/** Split one CSV line, honouring quoted fields containing commas. */
const splitCsvLine = (line) => {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(v => v.trim());
};

/**
 * Turn a bank's CSV into rows import_bank_transactions understands.
 *
 * Returns `{ rows, skipped }` — skipped lines are counted and described rather
 * than dropped quietly, because "we imported 200 of your 240 lines" is a thing
 * the person needs to see BEFORE they trust the reconciliation.
 */
export const parseStatementCsv = (text) => {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) return { rows: [], skipped: [], headers: [] };

  const headers = splitCsvLine(lines[0]).map(norm);
  const indexOf = (key) => {
    for (const alias of HEADER_ALIASES[key] || []) {
      const i = headers.indexOf(alias);
      if (i >= 0) return i;
    }
    return -1;
  };

  const idx = Object.fromEntries(Object.keys(HEADER_ALIASES).map(k => [k, indexOf(k)]));
  const rows = [];
  const skipped = [];

  lines.slice(1).forEach((line, n) => {
    const cells = splitCsvLine(line);
    const date = parseStatementDate(idx.txn_date >= 0 ? cells[idx.txn_date] : '');
    const credit = idx.amount >= 0 ? parseStatementAmount(cells[idx.amount]) : null;
    const debit  = idx.debit  >= 0 ? parseStatementAmount(cells[idx.debit])  : null;
    const amount = credit ?? (debit === null ? null : -Math.abs(debit));

    if (!date || amount === null) {
      skipped.push({ line: n + 2, reason: !date ? 'no readable date' : 'no readable amount', raw: line.slice(0, 80) });
      return;
    }

    rows.push({
      txn_date:        date,
      value_date:      idx.value_date >= 0 ? parseStatementDate(cells[idx.value_date]) : null,
      description:     idx.description >= 0 ? cells[idx.description] : '',
      bank_reference:  idx.bank_reference >= 0 ? cells[idx.bank_reference] : '',
      amount,
      direction:       amount < 0 ? 'debit' : 'credit',
      running_balance: idx.running_balance >= 0 ? parseStatementAmount(cells[idx.running_balance]) : null,
    });
  });

  return { rows, skipped, headers };
};

export const useBankReconciliation = () => {
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary]           = useState(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [status, setStatus]             = useState('unmatched');
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let q = supabase
        .from('bank_transactions')
        .select(TXN_COLS)
        .order('txn_date', { ascending: false })
        .limit(PAGE_SIZE);
      if (status !== 'all') q = q.eq('status', status);

      const [{ data, error: err }, { data: sum }] = await Promise.all([
        q,
        supabase.rpc('bank_reconciliation_summary'),
      ]);
      if (err) throw err;
      if (!mounted.current) return;
      setTransactions(data || []);
      setSummary(sum || null);
    } catch (err) {
      logger.error('[useBankReconciliation] load failed', { message: err?.message });
      if (mounted.current) {
        setError(err?.message || 'Could not load the reconciliation.');
        setTransactions([]);
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; };
  }, [load]);

  const importRows = useCallback(async (rows, bankAccount = 'default') => {
    const { data, error: err } = await supabase.rpc('import_bank_transactions', {
      p_rows: rows, p_bank_account: bankAccount,
    });
    if (err) throw new Error(err.message || 'The statement could not be imported.');
    await load();
    return data;
  }, [load]);

  const autoMatch = useCallback(async (windowDays = 3) => {
    const { data, error: err } = await supabase.rpc('bank_reconcile_auto', { p_window_days: windowDays });
    if (err) throw new Error(err.message || 'Matching failed.');
    await load();
    return data;
  }, [load]);

  const match = useCallback(async (txnId, paymentId) => {
    const { error: err } = await supabase.rpc('bank_match_payment', {
      p_txn_id: txnId, p_payment_id: paymentId, p_method: 'manual',
    });
    if (err) throw new Error(err.message || 'Could not match that line.');
    await load();
  }, [load]);

  const unmatch = useCallback(async (txnId, reason) => {
    const { error: err } = await supabase.rpc('bank_unmatch_payment', {
      p_txn_id: txnId, p_reason: reason || null,
    });
    if (err) throw new Error(err.message || 'Could not unmatch that line.');
    await load();
  }, [load]);

  const ignore = useCallback(async (txnId, reason) => {
    const { error: err } = await supabase.rpc('bank_ignore_transaction', {
      p_txn_id: txnId, p_reason: reason,
    });
    if (err) throw new Error(err.message || 'Could not set that line aside.');
    await load();
  }, [load]);

  /** Payments still waiting on evidence, for the manual-match picker. */
  const unconfirmedPayments = useCallback(async (amount) => {
    let q = supabase
      .from('payments')
      .select('id, transaction_id, amount, payment_method, payment_date, reference_number, reconciliation_status')
      .eq('bank_confirmed', false)
      .order('payment_date', { ascending: false })
      .limit(50);
    if (amount) q = q.eq('amount', amount);
    const { data, error: err } = await q;
    if (err) throw err;
    return data || [];
  }, []);

  return {
    transactions, summary, loading, error, status, setStatus,
    refetch: load, importRows, autoMatch, match, unmatch, ignore, unconfirmedPayments,
  };
};

export default useBankReconciliation;

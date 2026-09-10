import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { useToast } from '../../../components/Toast';
import { useBankReconciliation, parseStatementCsv } from '../../../hooks/useBankReconciliation';

const KES = (n) => `KES ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const day = (v) => (v ? new Date(v).toLocaleDateString() : '—');

const STATUS_TONE = {
  unmatched: 'bg-amber-100 text-amber-800',
  matched:   'bg-emerald-100 text-emerald-700',
  review:    'bg-red-100 text-red-700',
  ignored:   'bg-gray-100 text-gray-500',
};

const Tile = ({ label, value, sub, tone }) => (
  <div className="bg-card border border-border rounded-xl p-4">
    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
    <p className={`text-2xl font-bold mt-1 ${tone || 'text-foreground'}`}>{value}</p>
    {sub && <p className="text-xs text-muted-foreground font-mono">{sub}</p>}
  </div>
);

/**
 * Bank reconciliation, as a treasurer does it.
 *
 * THREE STEPS, IN ORDER. Import the statement, let the matcher take the
 * obvious ones, then work the pile it could not decide. The pile is the point:
 * an automatic matcher that quietly guessed between two payments of the same
 * amount would produce a clean-looking reconciliation with the wrong
 * customer's receipt against the money.
 *
 * THE PREVIEW IS NOT DECORATION. Every bank's CSV is shaped differently, so
 * the file is parsed in the browser and shown — with a count of the lines that
 * could not be read — BEFORE anything is committed. "Imported 240 lines" when
 * forty had an unreadable date is a number that hides the thing you needed.
 */
const BankReconciliationPanel = () => {
  const toast = useToast();
  const {
    transactions, summary, loading, error, status, setStatus,
    importRows, autoMatch, match, unmatch, ignore, unconfirmedPayments,
  } = useBankReconciliation();

  const [preview, setPreview]   = useState(null);   // { rows, skipped, fileName }
  const [account, setAccount]   = useState('default');
  const [busy, setBusy]         = useState('');
  const [picking, setPicking]   = useState(null);   // { txn, candidates }

  const readFile = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const { rows, skipped } = parseStatementCsv(text);
      if (rows.length === 0) {
        toast.error('No readable rows in that file. Check it has a header row with a date and an amount column.');
        return;
      }
      setPreview({ rows, skipped, fileName: file.name });
    } catch (err) {
      toast.error(err?.message || 'That file could not be read.');
    }
  };

  const commitImport = async () => {
    setBusy('import');
    try {
      const res = await importRows(preview.rows, account.trim() || 'default');
      toast.success(
        `${res.imported} new line${res.imported === 1 ? '' : 's'} imported` +
        (res.duplicates ? `, ${res.duplicates} already on file` : '') +
        (res.unreadable ? `, ${res.unreadable} unreadable` : '') + '.',
      );
      setPreview(null);
    } catch (err) {
      toast.error(err?.message || 'The import failed. Nothing was saved.');
    } finally {
      setBusy('');
    }
  };

  const runAutoMatch = async () => {
    setBusy('match');
    try {
      const r = await autoMatch(3);
      const total = (r.matched_by_reference || 0) + (r.matched_by_amount || 0);
      toast.success(
        `${total} matched (${r.matched_by_reference} by reference, ${r.matched_by_amount} by amount and date)` +
        (r.needs_review ? ` · ${r.needs_review} need a human.` : '.'),
      );
    } catch (err) {
      toast.error(err?.message || 'Matching failed.');
    } finally {
      setBusy('');
    }
  };

  const openPicker = async (txn) => {
    try {
      // Offer the same-amount payments first; the treasurer can widen it.
      const exact = await unconfirmedPayments(txn.amount);
      const candidates = exact.length > 0 ? exact : await unconfirmedPayments(null);
      setPicking({ txn, candidates, exactOnly: exact.length > 0 });
    } catch (err) {
      toast.error(err?.message || 'Could not load the payments to match against.');
    }
  };

  const doMatch = async (paymentId) => {
    setBusy('manual');
    try {
      await match(picking.txn.id, paymentId);
      toast.success('Matched. The payment is now bank-confirmed.');
      setPicking(null);
    } catch (err) {
      toast.error(err?.message || 'Could not match that line.');
    } finally {
      setBusy('');
    }
  };

  const doIgnore = async (txn) => {
    const reason = window.prompt('Why is this line being set aside? (bank charge, transfer between own accounts…)');
    if (reason === null) return;
    if (!reason.trim()) { toast.error('A line set aside needs a reason.'); return; }
    setBusy(txn.id);
    try {
      await ignore(txn.id, reason.trim());
      toast.success('Set aside.');
    } catch (err) {
      toast.error(err?.message || 'Could not set that line aside.');
    } finally {
      setBusy('');
    }
  };

  const doUnmatch = async (txn) => {
    const reason = window.prompt('Why is this match being undone?');
    if (reason === null) return;
    setBusy(txn.id);
    try {
      await unmatch(txn.id, reason.trim());
      toast.success('Unmatched. The payment is back to needing review.');
    } catch (err) {
      toast.error(err?.message || 'Could not unmatch that line.');
    } finally {
      setBusy('');
    }
  };

  const pay = summary?.payments || {};
  const stmt = summary?.statement || {};
  const at = (o, k) => o?.[k]?.count || 0;

  return (
    <div className="space-y-4">

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Awaiting confirmation" value={at(pay, 'pending')}
              sub={KES(pay.pending?.amount)} tone="text-amber-600" />
        <Tile label="Confirmed" value={at(pay, 'confirmed')}
              sub={KES(pay.confirmed?.amount)} tone="text-emerald-600" />
        <Tile label="Needs review" value={at(pay, 'review') + at(stmt, 'review')}
              tone="text-red-600" />
        <Tile label="Unclaimed credits" value={KES(summary?.unclaimed_credits)}
              sub="in the account, no payment recorded" tone="text-foreground" />
      </div>

      {/* 1 — import */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Icon name="Upload" size={15} color="var(--color-muted-foreground)" />
          <h3 className="text-sm font-semibold text-foreground">1. Import the statement</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          A CSV export from the bank. Re-importing an overlapping period is safe — lines
          already on file are recognised and skipped.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={account} onChange={(e) => setAccount(e.target.value)}
            placeholder="Bank account label"
            aria-label="Bank account label"
            className="px-3 py-2 text-sm bg-background border border-border rounded-xl text-foreground w-48"
          />
          <label className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer">
            <Icon name="FileText" size={13} color="currentColor" /> Choose CSV
            <input type="file" accept=".csv,text/csv" className="hidden"
              onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>

        {preview && (
          <div className="border border-border rounded-xl p-3 space-y-2 bg-muted/30">
            <p className="text-xs font-semibold text-foreground">
              {preview.fileName}: {preview.rows.length} readable line{preview.rows.length === 1 ? '' : 's'}
              {preview.skipped.length > 0 && (
                <span className="text-amber-700"> · {preview.skipped.length} could not be read</span>
              )}
            </p>
            <div className="max-h-40 overflow-y-auto">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-border">
                  {preview.rows.slice(0, 8).map((r, i) => (
                    <tr key={i}>
                      <td className="py-1 pr-3 text-muted-foreground whitespace-nowrap">{r.txn_date}</td>
                      <td className="py-1 pr-3 text-foreground truncate max-w-xs">{r.description || '—'}</td>
                      <td className="py-1 pr-3 font-mono text-muted-foreground">{r.bank_reference || '—'}</td>
                      <td className="py-1 text-right font-semibold text-foreground whitespace-nowrap">{KES(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.skipped.length > 0 && (
              <p className="text-xs text-amber-700">
                Skipped: {preview.skipped.slice(0, 3).map(s => `line ${s.line} (${s.reason})`).join(', ')}
                {preview.skipped.length > 3 ? ` and ${preview.skipped.length - 3} more` : ''}.
                Nothing is guessed — fix them in the file and import again if they matter.
              </p>
            )}
            <div className="flex gap-2">
              <button onClick={commitImport} disabled={busy === 'import'}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground disabled:opacity-50">
                {busy === 'import' ? 'Importing…' : `Import ${preview.rows.length} lines`}
              </button>
              <button onClick={() => setPreview(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2 — match */}
      <div className="bg-card border border-border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Icon name="GitCompare" size={15} color="var(--color-muted-foreground)" />
            <h3 className="text-sm font-semibold text-foreground">2. Match what is obvious</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            By reference first, then by amount within three days — and only where there is
            exactly one candidate. Anything ambiguous is left for you rather than guessed.
          </p>
        </div>
        <button onClick={runAutoMatch} disabled={busy === 'match'}
          className="px-4 py-2 rounded-xl text-xs font-semibold bg-primary text-primary-foreground disabled:opacity-50 flex-shrink-0">
          {busy === 'match' ? 'Matching…' : 'Run matching'}
        </button>
      </div>

      {/* 3 — the pile */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-4 border-b border-border">
          <div>
            <div className="flex items-center gap-2">
              <Icon name="ListChecks" size={15} color="var(--color-muted-foreground)" />
              <h3 className="text-sm font-semibold text-foreground">3. Work the rest</h3>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{transactions.length} line(s) shown</p>
          </div>
          <div className="inline-flex items-center gap-1 p-1 bg-muted rounded-lg">
            {['unmatched', 'review', 'matched', 'ignored', 'all'].map(s => (
              <button key={s} onClick={() => setStatus(s)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize transition-colors ${
                  status === s ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 px-5 py-3 bg-red-50 border-b border-red-200">
            <Icon name="AlertCircle" size={15} color="#dc2626" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Icon name="CheckCircle2" size={26} color="currentColor" />
            <p className="text-sm mt-2">Nothing in this pile</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  {['Date', 'Description', 'Reference', 'Amount', 'Status', ''].map((h, i) => (
                    <th key={h || i} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {transactions.map(t => (
                  <tr key={t.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{day(t.txn_date)}</td>
                    <td className="px-4 py-3 text-sm text-foreground max-w-xs truncate">{t.description || '—'}</td>
                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{t.bank_reference || '—'}</td>
                    <td className={`px-4 py-3 font-semibold whitespace-nowrap ${t.direction === 'debit' ? 'text-red-600' : 'text-foreground'}`}>
                      {t.direction === 'debit' ? '−' : ''}{KES(t.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_TONE[t.status]}`}>
                        {t.status}
                      </span>
                      {t.review_note && <p className="text-[11px] text-red-600 mt-0.5 max-w-xs">{t.review_note}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {t.status === 'matched' ? (
                          <button onClick={() => doUnmatch(t)} disabled={busy === t.id}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground disabled:opacity-50">
                            Unmatch
                          </button>
                        ) : t.status !== 'ignored' && (
                          <>
                            <button onClick={() => openPicker(t)}
                              className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-primary text-primary-foreground">
                              Match
                            </button>
                            <button onClick={() => doIgnore(t)} disabled={busy === t.id}
                              className="px-2.5 py-1 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground disabled:opacity-50">
                              Set aside
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Manual match */}
      {picking && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="text-base font-semibold text-foreground">Match {KES(picking.txn.amount)}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {day(picking.txn.txn_date)} · {picking.txn.description || 'no description'}
                {picking.exactOnly
                  ? ' · showing payments of the same amount'
                  : ' · no same-amount payment is unconfirmed, showing all'}
              </p>
            </div>
            <div className="p-5 overflow-y-auto">
              {picking.candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No unconfirmed payments to match against. This may be money nobody has recorded
                  yet — set it aside with a note, or record the payment first.
                </p>
              ) : (
                <ul className="space-y-2">
                  {picking.candidates.map(p => (
                    <li key={p.id}>
                      <button onClick={() => doMatch(p.id)} disabled={!!busy}
                        className="w-full flex items-center justify-between gap-3 p-3 rounded-xl border border-border text-left hover:border-primary/50 hover:bg-muted/40 disabled:opacity-50">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">{KES(p.amount)}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.transaction_id} · {day(p.payment_date)} · {p.payment_method}
                            {p.reference_number ? ` · ${p.reference_number}` : ''}
                          </p>
                        </div>
                        <Icon name="ChevronRight" size={14} color="currentColor" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="px-5 py-4 border-t border-border flex justify-end">
              <button onClick={() => setPicking(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BankReconciliationPanel;

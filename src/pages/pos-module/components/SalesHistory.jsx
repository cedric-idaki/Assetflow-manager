/**
 * SALES HISTORY — REPRINT A PAST RECEIPT
 *
 * A customer who lost their receipt used to have nowhere to go: the receipt
 * existed only while the sale-completion modal was open, and closing it was the
 * end of the document. The sale was on record the whole time; nothing listed it.
 *
 * So this is a till's receipt book. It reads one tenant's sales newest-first, a
 * page at a time through usePagedQuery (the whole book is searched in Postgres,
 * not the page on screen — see that hook for why that distinction matters), and
 * reprints any of them through the same document builder the till uses.
 *
 * Search is on the numbers a customer can actually read off their paper —
 * invoice and receipt. Finding a sale BY CUSTOMER is the dropdown beside it,
 * which is exact rather than a name match, following the same split as the
 * sacco contributions ledger.
 *
 * NOTE: needs migration 20260902140000 applied — it adds sales.receipt_number,
 * which the search filter names.
 */

import React, { useState, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import Pagination from '../../../components/ui/Pagination';
import { usePagedQuery } from '../../../hooks/usePagedQuery';
import { fetchSaleForReprint } from '../../../hooks/usePOS';
import { reprintArgsFromSale, PRICING_LABELS, PAYMENT_LABELS } from '../../../utils/posReceiptDocument';
import { useReceiptPrinter, PaperPicker } from './ReceiptPrinter';

const PAGE_SIZE = 20;

const fmt  = (n) => `KES ${(parseFloat(n) || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const fmtD = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const ic = 'w-full px-3 py-2.5 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground placeholder:text-muted-foreground transition-colors';

// ── Reprint dialog ────────────────────────────────────────────────────────────
const ReprintModal = ({ loading, loadError, receipt, companyProfile, onClose }) => {
  // `printed: 1` — the original was issued at the till when the sale was made,
  // so everything this screen produces is a second copy and is stamped as one.
  const printer = useReceiptPrinter({
    printed: 1,
    // The tenant's letterhead comes from the page, not the sale — a reprint
    // on blank paper with no company name on it is not a receipt.
    buildArgs: () => (receipt ? reprintArgsFromSale({ ...receipt, companyProfile }) : null),
  });

  const sale = receipt?.sale;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-y-auto max-h-[90vh]">
        <div className="px-6 pt-5 pb-4 border-b border-border flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-foreground">Reprint Receipt</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {sale ? (sale.receipt_number || sale.invoice_number) : 'Loading…'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="currentColor" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
              <Icon name="Loader" size={16} color="currentColor" className="animate-spin" />
              Loading the receipt…
            </div>
          )}

          {loadError && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{loadError}</div>
          )}

          {sale && (
            <>
              <div className="bg-muted/30 rounded-xl p-4 space-y-2 text-sm">
                {[
                  { label: 'Customer',      value: receipt.client?.full_name || '—' },
                  { label: 'Asset',         value: receipt.asset?.description || '—' },
                  { label: 'Date',          value: fmtD(receipt.payment?.payment_date || sale.sale_date) },
                  { label: 'Terms',         value: PRICING_LABELS[sale.pricing_model] || sale.pricing_model },
                  { label: 'Paid by',       value: PAYMENT_LABELS[sale.payment_method] || sale.payment_method },
                ].map(r => (
                  <div key={r.label} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className="font-medium text-foreground text-right max-w-[60%]">{r.value}</span>
                  </div>
                ))}
                <div className="flex justify-between gap-3 pt-2 border-t border-border font-bold">
                  <span className="text-foreground">
                    {sale.pricing_model === 'cash' ? 'Amount paid' : 'Deposit paid'}
                  </span>
                  <span className="text-emerald-600">
                    {fmt(sale.pricing_model === 'cash' ? sale.total_amount : sale.deposit_amount)}
                  </span>
                </div>
              </div>

              {!sale.receipt_number && (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  This sale was recorded before receipt numbers were stored, so the copy is
                  identified by its invoice number.
                </div>
              )}

              {printer.error && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{printer.error}</div>
              )}

              <PaperPicker
                paper={printer.paper}
                onChange={printer.setPaper}
                printedHere={printer.printedHere}
                nextIsDuplicate={printer.nextIsDuplicate}
              />
            </>
          )}
        </div>

        <div className="flex gap-2 px-6 pb-6">
          <button onClick={onClose}
            className="flex-1 py-2.5 border border-border text-sm font-medium text-muted-foreground rounded-xl hover:bg-muted transition-colors">
            Close
          </button>
          <button onClick={printer.print} disabled={!sale}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50 transition-all"
            style={{ background: 'linear-gradient(135deg,#1A56DB,#1E429F)' }}>
            <Icon name="Printer" size={14} color="white" />
            Print Duplicate
          </button>
        </div>
      </div>
    </div>
  );
};

// ── History ───────────────────────────────────────────────────────────────────
const SalesHistory = ({ adminId, clients = [], companyProfile }) => {
  const [q, setQ]               = useState('');
  const [clientId, setClientId] = useState('');
  const [from, setFrom]         = useState('');
  const [to, setTo]             = useState('');

  const [open, setOpen]           = useState(false);
  const [loading, setLoading]     = useState(false);
  const [loadError, setLoadError] = useState('');
  const [receipt, setReceipt]     = useState(null);

  const history = usePagedQuery({
    table: 'sales',
    // select('*') for the sale itself: this table has drifted from the
    // migrations before, and the list needs no column the reprint does not.
    columns: '*, client:clients(id, full_name, account_number, phone), asset:assets(id, description, asset_code, asset_type)',
    searchColumns: ['invoice_number', 'receipt_number'],
    search: q,
    order: { column: 'sale_date', ascending: false },
    pageSize: PAGE_SIZE,
    enabled: !!adminId,
    applyFilters: (query) => {
      let out = query.eq('admin_id', adminId);
      if (clientId) out = out.eq('client_id', clientId);
      if (from)     out = out.gte('sale_date', from);
      if (to)       out = out.lte('sale_date', to);
      return out;
    },
    deps: [adminId, clientId, from, to],
  });

  const filtersActive = !!(q || clientId || from || to);

  const clientOptions = useMemo(
    () => [...clients].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')),
    [clients]
  );

  const openReprint = async (sale) => {
    setOpen(true);
    setLoading(true);
    setLoadError('');
    setReceipt(null);
    try {
      setReceipt(await fetchSaleForReprint(sale.id));
    } catch (err) {
      setLoadError(err.message || 'Could not load this receipt.');
    } finally {
      setLoading(false);
    }
  };

  const clearFilters = () => { setQ(''); setClientId(''); setFrom(''); setTo(''); };

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      {open && (
        <ReprintModal
          loading={loading}
          loadError={loadError}
          receipt={receipt}
          companyProfile={companyProfile}
          onClose={() => { setOpen(false); setReceipt(null); setLoadError(''); }}
        />
      )}

      <div className="p-5 border-b border-border space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Receipts</h2>
            <p className="text-xs text-muted-foreground">Find a past sale and print the customer another copy</p>
          </div>
          {filtersActive && (
            <button onClick={clearFilters}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-3 py-1.5 border border-border rounded-lg hover:bg-muted transition-colors shrink-0">
              <Icon name="X" size={13} color="currentColor" /> Clear
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <input className={ic} value={q} onChange={e => setQ(e.target.value)}
            placeholder="Receipt or invoice no." aria-label="Search by receipt or invoice number" />
          <select className={ic} value={clientId} onChange={e => setClientId(e.target.value)} aria-label="Filter by customer">
            <option value="">All customers</option>
            {clientOptions.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
          <input className={ic} type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="Sold from" />
          <input className={ic} type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="Sold until" />
        </div>
      </div>

      <div className="p-5">
        {history.error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">
            {history.error}
          </div>
        )}

        {history.loading && history.rows.length === 0 && (
          <div className="space-y-2">
            {[1,2,3,4,5].map(i => <div key={i} className="animate-pulse bg-muted rounded-lg h-14" />)}
          </div>
        )}

        {!history.loading && history.rows.length === 0 && !history.error && (
          <div className="text-center py-12">
            <Icon name="ReceiptText" size={28} color="currentColor" className="mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {filtersActive ? 'No sales match these filters.' : 'No sales recorded yet.'}
            </p>
          </div>
        )}

        {history.rows.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                    <th className="py-2 pr-3 font-medium">Receipt</th>
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Customer</th>
                    <th className="py-2 pr-3 font-medium">Asset</th>
                    <th className="py-2 pr-3 font-medium text-right">Paid</th>
                    <th className="py-2 font-medium text-right">Reprint</th>
                  </tr>
                </thead>
                <tbody>
                  {history.rows.map(s => (
                    <tr key={s.id} className="border-b border-border/60 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 pr-3">
                        <span className="font-medium text-foreground">{s.receipt_number || s.invoice_number}</span>
                        {s.receipt_number && (
                          <span className="block text-xs text-muted-foreground">{s.invoice_number}</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground whitespace-nowrap">{fmtD(s.sale_date)}</td>
                      <td className="py-2.5 pr-3 text-foreground">{s.client?.full_name || '—'}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{s.asset?.description || '—'}</td>
                      <td className="py-2.5 pr-3 text-right font-medium text-foreground whitespace-nowrap">
                        {/* What the customer actually paid — the whole total on
                            a cash sale, the deposit on a financed one. This is
                            the figure on their receipt. */}
                        {fmt(s.pricing_model === 'cash' ? s.total_amount : s.deposit_amount)}
                      </td>
                      <td className="py-2.5 text-right">
                        <button onClick={() => openReprint(s)}
                          aria-label={`Reprint receipt ${s.receipt_number || s.invoice_number}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg text-foreground hover:bg-muted transition-colors">
                          <Icon name="Printer" size={13} color="currentColor" /> Print
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={history.page}
              pageCount={history.pageCount}
              from={history.from}
              to={history.to}
              total={history.total}
              onPageChange={history.setPage}
              loading={history.loading}
              noun={filtersActive ? 'matching sales' : 'sales'}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default SalesHistory;

import React, { useCallback, useEffect, useState } from 'react';
import { useToast } from '../../../../components/Toast';
import Icon from '../../../../components/AppIcon';
import Pagination from '../../../../components/ui/Pagination';
import { usePagedQuery } from '../../../../hooks/usePagedQuery';
import { supabase } from '../../../../lib/supabase';
import { fetchAllRows } from '../../../../lib/fetchAllRows';
import { fetchPendingSharePurchases, fetchReceiptSummary } from '../../../../services/saccoReceiptService';
import {
  RECEIPT_TYPES, RECEIPT_METHODS, methodLabel, receiptTypeLabel, localToday,
  isReceiptBookMissing, describeReceiptError,
} from '../../../../utils/saccoReceipts';
import { money } from '../../../../utils/accountingDocument';
import IssueReceiptModal from './IssueReceiptModal';
import ReceiptViewer, { TypePill } from './ReceiptViewer';
import { downloadSaccoReceipt } from './receiptActions';
import {
  Card, StatCard, Table, PrimaryButton, GhostButton, EmptyState, TextInput, Select, fmtDate,
} from '../_shared';

const PAGE_SIZE = 25;
const SEARCH_COLUMNS = ['receipt_no', 'payment_reference', 'member_name', 'member_no', 'description'];

const monthStart = () => `${localToday().slice(0, 8)}01`;

const receipts = (n) => `${n.toLocaleString()} receipt${n === 1 ? '' : 's'}`;

/**
 * The society's receipt book: every loan repayment and share purchase payment
 * received, the purchases still waiting to be paid for, and the desk that takes
 * a payment and issues its receipt.
 *
 * The register is a page of the whole book (usePagedQuery) and the figures
 * above it come from sacco_receipt_summary(), which totals the whole period in
 * Postgres — never from the rows that happen to be on screen.
 */
const ReceiptsTab = ({ ctx }) => {
  const { sacco, exportCSV } = ctx;
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [method, setMethod] = useState('');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(localToday);

  const [issuing, setIssuing] = useState(null);   // preset for the issue modal, or null
  const [viewing, setViewing] = useState(null);   // receipt id
  const [downloading, setDownloading] = useState(null);
  const [exporting, setExporting] = useState(false);

  const filtered = (q) => {
    let x = q.eq('sacco_id', sacco?.id);
    if (type) x = x.eq('receipt_type', type);
    if (method) x = x.eq('payment_method', method);
    if (from) x = x.gte('paid_on', from);
    if (to) x = x.lte('paid_on', to);
    return x;
  };

  const register = usePagedQuery({
    table: 'sacco_receipts',
    columns: '*',
    enabled: !!sacco?.id,
    applyFilters: filtered,
    order: { column: 'created_at', ascending: false },
    searchColumns: SEARCH_COLUMNS,
    search,
    pageSize: PAGE_SIZE,
    deps: [sacco?.id, type, method, from, to],
  });

  // ── Period totals and the purchases still owed ──────────────────────────────
  const [summary, setSummary] = useState([]);
  const [pending, setPending] = useState([]);
  const [sideError, setSideError] = useState(null);

  const loadSide = useCallback(async () => {
    try {
      const [rows, owed] = await Promise.all([
        fetchReceiptSummary({ from, to }),
        fetchPendingSharePurchases(),
      ]);
      setSummary(rows);
      setPending(owed);
      setSideError(null);
    } catch (e) {
      setSideError(e);
    }
  }, [from, to]);

  useEffect(() => { if (sacco?.id) loadSide(); }, [sacco?.id, loadSide]);

  const total = (pred) => summary.filter(pred).reduce((s, r) => s + Number(r.amount || 0), 0);
  const count = (pred) => summary.filter(pred).reduce((s, r) => s + Number(r.receipts || 0), 0);
  const isLoan = (r) => r.receipt_type === 'loan_repayment';
  const isShare = (r) => r.receipt_type === 'share_purchase';
  const byMethod = RECEIPT_METHODS
    .map((m) => ({ ...m, amount: total((r) => r.payment_method === m.value) }))
    .filter((m) => m.amount > 0);
  const owedTotal = pending.reduce((s, p) => s + Number(p.amount_due || 0), 0);

  const issued = (receipt) => {
    setIssuing(null);
    register.refresh();
    loadSide();
    setViewing(receipt.id);
  };

  const download = async (r) => {
    setDownloading(r.id);
    try {
      toast.success(await downloadSaccoReceipt(r.id, sacco), 'Downloaded');
    } catch (e) {
      toast.error(e.message, 'Could not generate the receipt');
    } finally {
      setDownloading(null);
    }
  };

  /** Every receipt the filters match — not the page on screen. */
  const exportRegister = async () => {
    setExporting(true);
    try {
      const rows = await fetchAllRows(() => filtered(supabase.from('sacco_receipts').select('*'))
        .order('created_at', { ascending: false }));
      exportCSV(rows.map((r) => ({
        receipt_no: r.receipt_no,
        paid_on: r.paid_on,
        member: r.member_name,
        member_no: r.member_no || '',
        payment_for: receiptTypeLabel(r.receipt_type),
        description: r.description,
        method: methodLabel(r.payment_method),
        reference: r.payment_reference || '',
        amount: r.amount,
        received_by: r.received_by_name || '',
        issued_at: r.created_at,
      })), 'sacco_receipts');
    } catch (e) {
      toast.error(describeReceiptError(e), 'Could not build the export');
    } finally {
      setExporting(false);
    }
  };

  const clearFilters = () => { setSearch(''); setType(''); setMethod(''); setFrom(''); setTo(''); };

  const missing = isReceiptBookMissing(register.error) || isReceiptBookMissing(sideError);
  if (missing) {
    return (
      <Card title="Receipts">
        <EmptyState
          icon="AlertTriangle"
          title="The receipt book is not set up on the server yet"
          hint="Database migration 20260925163000_sacco_payment_receipts has to be applied before payments can be receipted."
        />
      </Card>
    );
  }

  const period = from || to ? `${from ? fmtDate(from) : 'the start'} – ${to ? fmtDate(to) : 'today'}` : 'all time';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Received" value={money(total(() => true))} icon="Receipt"
          hint={`${receipts(count(() => true))} · ${period}`} />
        <StatCard label="Loan repayments" value={money(total(isLoan))} icon="Banknote" tone="success"
          hint={receipts(count(isLoan))} />
        <StatCard label="Share purchases" value={money(total(isShare))} icon="PieChart" tone="muted"
          hint={receipts(count(isShare))} />
        <StatCard label="Awaiting payment" value={money(owedTotal)} icon="Clock" tone="warning"
          hint={`${pending.length.toLocaleString()} share purchase${pending.length === 1 ? '' : 's'}`} />
      </div>

      {byMethod.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {byMethod.map((m) => (
            <span key={m.value} className="px-2.5 py-1 rounded-full border border-border bg-card text-muted-foreground">
              {m.label} <span className="font-semibold text-foreground">{money(m.amount)}</span>
            </span>
          ))}
        </div>
      )}

      {sideError && (
        <p className="text-sm text-red-600">Totals could not be loaded: {describeReceiptError(sideError)}</p>
      )}

      {pending.length > 0 && (
        <Card
          title="Share purchases awaiting payment"
          subtitle="Settled on the share market, not yet paid for. Receipt each one when the money comes in."
        >
          <div className="max-h-80 overflow-y-auto">
            <Table columns={['Bought', 'Member', 'Purchase', 'From', 'Amount due', '']}>
              {pending.map((p) => (
                <tr key={p.share_txn_id} className="border-b border-border/60">
                  <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">{fmtDate(p.bought_at)}</td>
                  <td className="py-2.5 pr-4 font-medium text-foreground">
                    {p.member_name}{p.member_no ? <span className="text-muted-foreground font-normal"> · {p.member_no}</span> : null}
                  </td>
                  <td className="py-2.5 pr-4 text-foreground">
                    {(p.shares || 0).toLocaleString()} @ {money(p.price_per_share)}
                    <span className="block text-xs text-muted-foreground font-mono">{p.txn_no}</span>
                  </td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{p.seller}</td>
                  <td className="py-2.5 pr-4 font-semibold text-foreground">{money(p.amount_due)}</td>
                  <td className="py-2.5 pr-0 text-right">
                    <button
                      onClick={() => setIssuing({ type: 'share_purchase', memberId: p.member_id, shareTxnId: p.share_txn_id })}
                      className="text-xs text-primary font-semibold hover:underline whitespace-nowrap"
                    >
                      Receipt payment
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        </Card>
      )}

      <Card
        title="Receipt register"
        subtitle={`${receipts(register.total)} · ${period}`}
        actions={
          <div className="flex items-center gap-2">
            <GhostButton icon="Download" onClick={exportRegister} disabled={exporting || register.total === 0}>
              {exporting ? 'Preparing…' : 'Export'}
            </GhostButton>
            <PrimaryButton icon="Plus" onClick={() => setIssuing({})}>Receive payment</PrimaryButton>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
          <div className="lg:col-span-2">
            <TextInput value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Receipt no., reference or member" aria-label="Search receipts" />
          </div>
          <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Payment for">
            <option value="">All payments</option>
            {RECEIPT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
          <Select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Method">
            <option value="">All methods</option>
            {RECEIPT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
          <TextInput type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="Paid from" />
          <TextInput type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="Paid to" />
        </div>
        {(search || type || method || from || to) && (
          <button onClick={clearFilters} className="text-xs text-primary font-semibold hover:underline mb-3">
            Show every receipt
          </button>
        )}

        {register.error ? (
          <EmptyState icon="AlertTriangle" title="Could not load receipts" hint={register.error} />
        ) : register.rows.length === 0 ? (
          <EmptyState
            icon="Receipt"
            title={register.loading ? 'Loading receipts…' : 'No receipts in this view'}
            hint={register.loading ? undefined : 'Receive a loan repayment or a share purchase payment and its receipt is filed here.'}
          />
        ) : (
          <>
            <Table columns={['Receipt no.', 'Paid on', 'Member', 'For', 'Method', 'Amount', 'Received by', '']}>
              {register.rows.map((r) => (
                <tr key={r.id} className="border-b border-border/60">
                  <td className="py-2.5 pr-4 font-mono text-xs text-foreground whitespace-nowrap">{r.receipt_no}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">{fmtDate(r.paid_on)}</td>
                  <td className="py-2.5 pr-4 font-medium text-foreground">
                    {r.member_name}
                    {r.member_no && <span className="block text-xs text-muted-foreground font-normal">{r.member_no}</span>}
                  </td>
                  <td className="py-2.5 pr-4 text-foreground">
                    <TypePill type={r.receipt_type} />
                    <span className="block text-xs text-muted-foreground mt-1 max-w-xs">{r.description}</span>
                  </td>
                  <td className="py-2.5 pr-4 text-muted-foreground">
                    {methodLabel(r.payment_method)}
                    {r.payment_reference && <span className="block text-xs font-mono">{r.payment_reference}</span>}
                  </td>
                  <td className="py-2.5 pr-4 font-semibold text-foreground whitespace-nowrap">{money(r.amount)}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{r.received_by_name || '—'}</td>
                  <td className="py-2.5 pr-0 text-right whitespace-nowrap">
                    <button onClick={() => setViewing(r.id)} className="text-xs text-primary font-semibold hover:underline mr-3">View</button>
                    <button
                      onClick={() => download(r)}
                      disabled={downloading === r.id}
                      title={`Download receipt ${r.receipt_no}`}
                      aria-label={`Download receipt ${r.receipt_no}`}
                      className="align-middle text-muted-foreground hover:text-foreground disabled:opacity-60"
                    >
                      <Icon name={downloading === r.id ? 'Loader' : 'Download'} size={14} color="currentColor"
                        className={downloading === r.id ? 'animate-spin' : ''} />
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination
              page={register.page}
              pageCount={register.pageCount}
              from={register.from}
              to={register.to}
              total={register.total}
              onPageChange={register.setPage}
              loading={register.loading}
              noun="receipts"
            />
          </>
        )}
      </Card>

      <IssueReceiptModal open={!!issuing} preset={issuing} onClose={() => setIssuing(null)} onIssued={issued} />
      <ReceiptViewer receiptId={viewing} sacco={sacco} onClose={() => setViewing(null)} />
    </div>
  );
};

export default ReceiptsTab;

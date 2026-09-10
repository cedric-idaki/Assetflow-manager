import React, { useState, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import { useToast } from '../../../components/Toast';
import {
  usePaymentApproval, PAYMENT_STATUSES, REQUEST_TYPES, statusMeta,
} from '../../../hooks/usePaymentApproval';
import DecisionConfirmModal from './DecisionConfirmModal';
import PaymentRequestDrawer from './PaymentRequestDrawer';

const fmt = (n, cur = 'KES') =>
  `${cur} ${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const when = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
};

const Tile = ({ label, count, amount, icon, tone }) => (
  <div className="bg-card border border-border rounded-xl p-4">
    <div className="flex items-center justify-between">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
      <Icon name={icon} size={15} color={tone} />
    </div>
    <p className="text-2xl font-bold text-foreground mt-1">{count}</p>
    <p className="text-xs text-muted-foreground font-mono">{fmt(amount)}</p>
  </div>
);

/**
 * The Super Admin's payment approval desk.
 *
 * WHAT IT IS. Every payment request in the system, live: the tiles come from
 * payment_request_totals() (SQL, over everything) and the table from a filtered
 * page of the rows. Those two numbers are allowed to disagree — the tiles count
 * the whole book and the table shows one filtered page of it — and that is the
 * point. Deriving the tiles from `requests` would make the headline change every
 * time somebody typed in the search box, which is how a dashboard starts lying.
 *
 * A DECISION IS ALWAYS TWO CLICKS AND ONE PAUSE. Choosing YES / NO / WAIT
 * records the intent and gets back the exact wording the database hashed;
 * nothing has moved. The modal then shows that wording and sends the digest
 * back. Between them the request can be changed by somebody else, and if it is,
 * the confirm is refused — see DecisionConfirmModal.
 *
 * BULK WORKS THE SAME WAY, over one shared reason. The batch digest covers
 * every request in it, so a batch where one row moved is refused whole rather
 * than applied to the rest.
 */
const PaymentApprovalTab = ({ agents = [], onExport }) => {
  const toast = useToast();
  const api = usePaymentApproval({ realtime: true });
  const { requests, totals, loading, error, hasMore, busyId, filters, setFilters } = api;

  const [selected, setSelected]   = useState(() => new Set());
  const [drawerId, setDrawerId]   = useState(null);
  const [showFilters, setShowFilters] = useState(false);

  // The pending two-step. Held here rather than in the modal so a decision
  // survives the modal re-rendering, and so cancelling clears it in one place.
  const [pending, setPending] = useState(null); // { terms, decision, reason, bulk, batchId }
  const [confirming, setConfirming] = useState(false);

  const agentsById = useMemo(
    () => Object.fromEntries(agents.map(a => [a.id, a])),
    [agents],
  );

  // Search is client-side over the fetched page ON PURPOSE: it is a "find the
  // one I am looking at" control, not a filter. Everything that narrows the
  // QUERY lives in `filters` and goes to the server, so the tiles and the page
  // stay honest about what they cover.
  const visible = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter(r => {
      const agent = agentsById[r.agent_id];
      return [
        r.request_no, r.invoice_ref, r.payee_name, r.narrative,
        agent?.full_name, agent?.agent_code,
      ].filter(Boolean).some(v => String(v).toLowerCase().includes(q));
    });
  }, [requests, filters.search, agentsById]);

  // Only a request actually awaiting a decision can be decided, so the bulk bar
  // must never offer to act on one that is not.
  const decidable = (r) => r.status === 'pending_approval' || r.status === 'on_hold';
  const selectableIds = useMemo(() => visible.filter(decidable).map(r => r.id), [visible]);
  const selectedIds = useMemo(
    () => selectableIds.filter(id => selected.has(id)),
    [selectableIds, selected],
  );

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAll = () => setSelected(
    selectedIds.length === selectableIds.length ? new Set() : new Set(selectableIds));

  const setFilter = (key, value) => setFilters(f => ({ ...f, [key]: value }));

  const clearFilters = () => setFilters({
    status: 'all', requestType: 'all', agentId: '', managerId: '', clientId: '',
    invoice: '', minAmount: '', maxAmount: '', from: '', to: '', search: '',
  });

  const activeFilterCount = [
    filters.status !== 'all', filters.requestType !== 'all', filters.agentId,
    filters.managerId, filters.clientId, filters.invoice, filters.minAmount,
    filters.maxAmount, filters.from, filters.to,
  ].filter(Boolean).length;

  /** Step one, single. */
  const startDecision = async (request, decision) => {
    const reason = window.prompt(
      `Reason for ${decision === 'approve' ? 'approving' : decision === 'reject' ? 'rejecting' : 'holding'} ${request.request_no}:`,
    );
    if (reason === null) return;                 // cancelled the prompt
    if (!reason.trim()) {
      toast.error('A decision needs a reason.');
      return;
    }
    try {
      const terms = await api.decide(request.id, decision, reason.trim());
      setPending({ terms, decision, reason: reason.trim(), bulk: false, id: request.id });
    } catch (err) {
      toast.error(err?.message || 'Could not record the decision.');
    }
  };

  /** Step one, bulk. */
  const startBulkDecision = async (decision) => {
    if (selectedIds.length === 0) return;
    const reason = window.prompt(
      `Reason applied to all ${selectedIds.length} selected requests:`,
    );
    if (reason === null) return;
    if (!reason.trim()) {
      toast.error('A bulk decision needs a reason.');
      return;
    }
    try {
      const batch = await api.bulkDecide(selectedIds, decision, reason.trim());
      setPending({
        terms: { hash: batch.hash, lines: null },
        decision,
        reason: reason.trim(),
        bulk: true,
        batchId: batch.batch_id,
        count: batch.count,
      });
    } catch (err) {
      toast.error(err?.message || 'Could not record the bulk decision.');
    }
  };

  /** Step two, either kind. */
  const confirmDecision = async (hash) => {
    setConfirming(true);
    try {
      if (pending.bulk) {
        const n = await api.verifyBulk(pending.batchId, hash);
        toast.success(`${n} request${n === 1 ? '' : 's'} settled.`);
        setSelected(new Set());
      } else {
        await api.verifyDecision(pending.id, hash);
        toast.success('Decision confirmed.');
      }
      setPending(null);
    } finally {
      setConfirming(false);
    }
  };

  const exportRows = () => onExport?.(
    visible.map(r => ({
      request_no: r.request_no,
      status: r.status,
      type: r.request_type,
      agent: agentsById[r.agent_id]?.full_name || '—',
      agent_code: agentsById[r.agent_id]?.agent_code || '—',
      invoice: r.invoice_ref || '—',
      amount: r.amount,
      currency: r.currency,
      validation: r.validation_passed === null || r.validation_passed === undefined
        ? 'not run' : (r.validation_passed ? 'passed' : 'exceptions'),
      decision: r.decision || '—',
      decided_at: r.decided_at || '',
      verified_at: r.verified_at || '',
      payment_reference: r.payment_reference || '',
      bank_reference: r.bank_reference || '',
      created_at: r.created_at,
    })),
    'payment_approvals',
  );

  const drawerRequest = requests.find(r => r.id === drawerId) || null;

  return (
    <div className="space-y-4">

      {/* Totals — from SQL, over everything, regardless of the filters below */}
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        <Tile label="Pending"    count={totals.pending.count}    amount={totals.pending.amount}    icon="Clock"        tone="#d97706" />
        <Tile label="Approved"   count={totals.approved.count}   amount={totals.approved.amount}   icon="CheckCircle2" tone="#059669" />
        <Tile label="Rejected"   count={totals.rejected.count}   amount={totals.rejected.amount}   icon="XCircle"      tone="#dc2626" />
        <Tile label="On hold"    count={totals.onHold.count}     amount={totals.onHold.amount}     icon="PauseCircle"  tone="#ea580c" />
        <Tile label="Processing" count={totals.processing.count} amount={totals.processing.amount} icon="Loader"       tone="#0284c7" />
        <Tile label="Completed"  count={totals.completed.count}  amount={totals.completed.amount}  icon="BadgeCheck"   tone="#047857" />
        <Tile label="Failed"     count={totals.failed.count}     amount={totals.failed.amount}     icon="AlertTriangle" tone="#dc2626" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          ['Total requested', totals.requestedTotal],
          ['Total approved',  totals.approvedTotal],
          ['Awaiting decision', totals.pendingTotal],
        ].map(([label, value]) => (
          <div key={label} className="bg-card border border-border rounded-xl px-4 py-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="text-lg font-bold text-foreground font-mono">{fmt(value)}</p>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">

        {/* Toolbar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground">Payment Approvals</h2>
            <p className="text-xs text-muted-foreground">
              {visible.length} shown{hasMore ? ' (more available)' : ''}
              {activeFilterCount > 0 ? ` · ${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} applied` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                <Icon name="Search" size={13} color="var(--color-muted-foreground)" />
              </div>
              <input
                value={filters.search}
                onChange={(e) => setFilter('search', e.target.value)}
                placeholder="Find a request…"
                className="pl-8 pr-3 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground w-48"
              />
            </div>
            <button
              onClick={() => setShowFilters(s => !s)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                activeFilterCount > 0
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'}`}
            >
              <Icon name="SlidersHorizontal" size={13} color="currentColor" />
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
            <button
              onClick={exportRows}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Icon name="Download" size={13} color="currentColor" /> Export
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="px-5 py-4 border-b border-border bg-muted/30 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground uppercase mb-1">Status</label>
              <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground">
                <option value="all">All statuses</option>
                {PAYMENT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground uppercase mb-1">Payment type</label>
              <select value={filters.requestType} onChange={(e) => setFilter('requestType', e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground">
                <option value="all">All types</option>
                {REQUEST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground uppercase mb-1">Agent</label>
              <select value={filters.agentId} onChange={(e) => setFilter('agentId', e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground">
                <option value="">Any agent</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.full_name} ({a.agent_code})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground uppercase mb-1">Manager</label>
              <select value={filters.managerId} onChange={(e) => setFilter('managerId', e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground">
                <option value="">Any manager</option>
                {agents.filter(a => a.agent_role === 'manager').map(a => (
                  <option key={a.id} value={a.id}>{a.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground uppercase mb-1">Invoice ref</label>
              <input value={filters.invoice} onChange={(e) => setFilter('invoice', e.target.value)}
                placeholder="INV-…"
                className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground uppercase mb-1">Amount from</label>
              <input type="number" value={filters.minAmount} onChange={(e) => setFilter('minAmount', e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-muted-foreground uppercase mb-1">Amount to</label>
              <input type="number" value={filters.maxAmount} onChange={(e) => setFilter('maxAmount', e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground uppercase mb-1">From</label>
                <input type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)}
                  className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground uppercase mb-1">To</label>
                <input type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)}
                  className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground" />
              </div>
            </div>
            <div className="col-span-2 lg:col-span-4">
              <button onClick={clearFilters}
                className="text-xs font-medium text-muted-foreground hover:text-foreground underline">
                Clear all filters
              </button>
            </div>
          </div>
        )}

        {/* Bulk bar — only when something decidable is selected */}
        {selectedIds.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3 bg-primary/5 border-b border-border">
            <p className="text-xs font-semibold text-foreground">
              {selectedIds.length} request{selectedIds.length === 1 ? '' : 's'} selected
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => startBulkDecision('approve')} disabled={busyId === 'bulk'}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white disabled:opacity-50">
                Approve selected
              </button>
              <button onClick={() => startBulkDecision('hold')} disabled={busyId === 'bulk'}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-orange-600 text-white disabled:opacity-50">
                Hold selected
              </button>
              <button onClick={() => startBulkDecision('reject')} disabled={busyId === 'bulk'}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white disabled:opacity-50">
                Reject selected
              </button>
              <button onClick={() => setSelected(new Set())}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground">
                Clear
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 px-5 py-3 bg-red-50 border-b border-red-200">
            <Icon name="AlertCircle" size={15} color="#dc2626" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-muted-foreground text-sm">Loading payment requests…</div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Icon name="Inbox" size={28} color="currentColor" />
            <p className="text-sm mt-2">No payment requests match this view</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all decidable requests"
                      checked={selectableIds.length > 0 && selectedIds.length === selectableIds.length}
                      onChange={toggleAll}
                      disabled={selectableIds.length === 0}
                    />
                  </th>
                  {['Request', 'Agent', 'Amount', 'Invoice', 'Validation', 'Status', 'Raised', 'Decision'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map(r => {
                  const meta  = statusMeta(r.status);
                  const agent = agentsById[r.agent_id];
                  const busy  = busyId === r.id;
                  const canDecide = decidable(r);
                  return (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.request_no}`}
                          checked={selected.has(r.id)}
                          onChange={() => toggle(r.id)}
                          disabled={!canDecide}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => setDrawerId(r.id)}
                          className="font-mono text-xs text-primary hover:underline">
                          {r.request_no}
                        </button>
                        <p className="text-[11px] text-muted-foreground capitalize">
                          {String(r.request_type || '').replace(/_/g, ' ')}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-foreground">{agent?.full_name || '—'}</p>
                        <p className="text-[11px] text-muted-foreground font-mono">{agent?.agent_code || ''}</p>
                      </td>
                      <td className="px-4 py-3 font-semibold text-foreground whitespace-nowrap">
                        {fmt(r.amount, r.currency)}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{r.invoice_ref || '—'}</td>
                      <td className="px-4 py-3">
                        {r.validation_passed === null || r.validation_passed === undefined ? (
                          <span className="text-xs text-muted-foreground">Not run</span>
                        ) : (
                          <span className={`inline-flex items-center gap-1 text-xs font-semibold ${r.validation_passed ? 'text-emerald-600' : 'text-amber-600'}`}>
                            <Icon name={r.validation_passed ? 'CheckCircle2' : 'AlertTriangle'} size={12}
                              color={r.validation_passed ? '#059669' : '#d97706'} />
                            {r.validation_passed ? 'Passed' : 'Exceptions'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${meta.tone}`}>
                          {meta.label}
                        </span>
                        {r.pending_decision && (
                          <p className="text-[11px] text-amber-600 font-semibold mt-0.5">
                            Awaiting your confirmation
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{when(r.created_at)}</td>
                      <td className="px-4 py-3">
                        {canDecide ? (
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => startDecision(r, 'approve')} disabled={busy}
                              title="Approve"
                              className="px-2 py-1 rounded-lg text-[11px] font-bold bg-emerald-600 text-white disabled:opacity-50">
                              YES
                            </button>
                            <button onClick={() => startDecision(r, 'reject')} disabled={busy}
                              title="Reject"
                              className="px-2 py-1 rounded-lg text-[11px] font-bold bg-red-600 text-white disabled:opacity-50">
                              NO
                            </button>
                            <button onClick={() => startDecision(r, 'hold')} disabled={busy}
                              title="Place on hold"
                              className="px-2 py-1 rounded-lg text-[11px] font-bold bg-orange-600 text-white disabled:opacity-50">
                              WAIT
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setDrawerId(r.id)}
                            className="text-xs font-medium text-muted-foreground hover:text-foreground underline">
                            Open
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {hasMore && (
              <div className="px-5 py-4 border-t border-border text-center">
                <button onClick={api.loadMore}
                  className="px-4 py-2 rounded-lg text-xs font-semibold border border-border text-muted-foreground hover:text-foreground hover:bg-muted">
                  Load more
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <DecisionConfirmModal
        open={!!pending}
        terms={pending?.terms}
        decision={pending?.decision}
        reason={pending?.reason}
        bulkCount={pending?.bulk ? pending.count : 0}
        busy={confirming}
        onConfirm={confirmDecision}
        onCancel={() => setPending(null)}
      />

      {drawerRequest && (
        <PaymentRequestDrawer
          request={drawerRequest}
          agentsById={agentsById}
          api={api}
          onClose={() => setDrawerId(null)}
        />
      )}
    </div>
  );
};

export default PaymentApprovalTab;

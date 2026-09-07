import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { usePaymentApproval, statusMeta, DOCUMENT_TYPES } from '../../../hooks/usePaymentApproval';

const fmt = (n, cur = 'KES') =>
  `${cur} ${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const when = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
};

/**
 * The agent's own side of the approval pipeline.
 *
 * WHY THIS EXISTS. Before migration 20260908120000 a withdrawal WAS the wallet
 * row, so the History tab was the whole story. Now the request and the payout
 * are two different things: the request is raised here and the wallet entry
 * only appears once FinHub executes it. Without this panel an agent who
 * submitted would see nothing at all until the money landed — no confirmation
 * it arrived, no reason when it was refused, and nowhere to put the invoice
 * FinHub is waiting on.
 *
 * RLS DOES THE SCOPING. This calls the same hook the super admin's desk does;
 * the SELECT policy on payment_requests is what limits it to this agent's own
 * rows. There is deliberately no agent_id filter here — a filter is a
 * convenience, and treating one as the security boundary is how a missing
 * `.eq()` turns into somebody else's payout on screen.
 */
const PaymentRequestsPanel = () => {
  const api = usePaymentApproval({ realtime: true });
  const { requests, loading, error } = api;

  const [openId, setOpenId]   = useState(null);
  const [docs, setDocs]       = useState([]);
  const [docType, setDocType] = useState('invoice');
  const [busy, setBusy]       = useState('');
  const [note, setNote]       = useState('');

  const open = async (r) => {
    if (openId === r.id) { setOpenId(null); return; }
    setOpenId(r.id);
    setNote('');
    try {
      setDocs(await api.listDocuments(r.id));
    } catch {
      setDocs([]);
    }
  };

  const upload = async (request, file) => {
    if (!file) return;
    setBusy('upload');
    setNote('');
    try {
      await api.attachDocument(request, file, docType);
      setDocs(await api.listDocuments(request.id));
      setNote('Document attached.');
    } catch (err) {
      setNote(err?.message || 'Could not attach the document.');
    } finally {
      setBusy('');
    }
  };

  const cancel = async (request) => {
    const reason = window.prompt(`Withdraw request ${request.request_no}? Give a reason:`);
    if (reason === null) return;
    setBusy('cancel');
    setNote('');
    try {
      await api.cancelRequest(request.id, reason.trim() || 'Withdrawn by the requester');
      setNote('Request withdrawn.');
    } catch (err) {
      setNote(err?.message || 'Could not withdraw the request.');
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">Loading your requests…</div>;
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3">
        <Icon name="AlertCircle" size={15} color="#dc2626" />
        <p className="text-xs text-red-700">{error}</p>
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
        <Icon name="Inbox" size={26} color="currentColor" />
        <p className="text-sm mt-2">No payment requests yet</p>
        <p className="text-xs">Use the Withdraw tab to raise one.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {requests.map(r => {
        const meta = statusMeta(r.status);
        const isOpen = openId === r.id;
        const checks = r.validation_result?.checks || [];
        const canAttach = ['draft', 'submitted', 'under_validation', 'pending_approval', 'on_hold'].includes(r.status);
        const canCancel = ['draft', 'submitted', 'under_validation', 'pending_approval', 'on_hold', 'approved'].includes(r.status);

        return (
          <div key={r.id} className="border border-border rounded-xl overflow-hidden">
            <button
              onClick={() => open(r)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-foreground">{r.request_no}</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${meta.tone}`}>
                    {meta.label}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {r.narrative || 'Commission withdrawal'} · {when(r.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="font-semibold text-sm text-foreground">{fmt(r.amount, r.currency)}</span>
                <Icon name={isOpen ? 'ChevronUp' : 'ChevronDown'} size={14} color="currentColor" />
              </div>
            </button>

            {isOpen && (
              <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">

                {/* What FinHub found. An agent whose request is stuck should be
                    able to see WHY without asking anybody. */}
                {checks.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                      FinHub validation
                    </p>
                    <ul className="space-y-1">
                      {checks.map((c, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <Icon
                            name={c.ok ? 'CheckCircle2' : c.severity === 'warning' ? 'AlertTriangle' : 'XCircle'}
                            size={13}
                            color={c.ok ? '#059669' : c.severity === 'warning' ? '#d97706' : '#dc2626'}
                          />
                          <span className="text-xs text-muted-foreground">{c.note}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {r.decision_reason && (
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                      Decision
                    </p>
                    <p className="text-xs text-foreground">{r.decision_reason}</p>
                  </div>
                )}

                {r.failure_reason && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-2.5">
                    <p className="text-xs text-red-700">{r.failure_reason}</p>
                  </div>
                )}

                {r.payment_reference && (
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Paid</p>
                    <p className="text-xs text-foreground font-mono">{r.payment_reference}</p>
                  </div>
                )}

                {/* Documents */}
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                    Supporting documents ({docs.length})
                  </p>
                  {docs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nothing attached yet.</p>
                  ) : (
                    <ul className="space-y-1">
                      {docs.map(d => (
                        <li key={d.id} className="text-xs text-foreground truncate">
                          • {d.file_name}
                          <span className="text-muted-foreground capitalize">
                            {' '}({String(d.document_type || '').replace(/_/g, ' ')})
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {note && <p className="text-xs text-muted-foreground">{note}</p>}

                <div className="flex flex-wrap items-center gap-2">
                  {canAttach && (
                    <>
                      <select
                        value={docType}
                        onChange={(e) => setDocType(e.target.value)}
                        className="px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground"
                      >
                        {DOCUMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer">
                        <Icon name="Upload" size={12} color="currentColor" />
                        {busy === 'upload' ? 'Uploading…' : 'Attach'}
                        <input
                          type="file"
                          accept=".pdf,image/*,.doc,.docx,.xls,.xlsx"
                          className="hidden"
                          disabled={!!busy}
                          onChange={(e) => { upload(r, e.target.files?.[0]); e.target.value = ''; }}
                        />
                      </label>
                    </>
                  )}
                  {canCancel && (
                    <button
                      onClick={() => cancel(r)}
                      disabled={!!busy}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-red-600 disabled:opacity-50"
                    >
                      {busy === 'cancel' ? 'Withdrawing…' : 'Withdraw request'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PaymentRequestsPanel;

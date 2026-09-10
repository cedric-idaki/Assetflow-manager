import React, { useEffect, useState, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { useToast } from '../../../components/Toast';
import { statusMeta, DOCUMENT_TYPES } from '../../../hooks/usePaymentApproval';

const fmt = (n, cur = 'KES') =>
  `${cur} ${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const when = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const Field = ({ label, value, mono }) => (
  <div>
    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
    <p className={`text-sm text-foreground break-words ${mono ? 'font-mono' : ''}`}>{value || '—'}</p>
  </div>
);

const Section = ({ title, icon, children, right }) => (
  <div className="border border-border rounded-xl overflow-hidden">
    <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-muted/40 border-b border-border">
      <div className="flex items-center gap-2">
        <Icon name={icon} size={14} color="var(--color-muted-foreground)" />
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">{title}</h3>
      </div>
      {right}
    </div>
    <div className="p-4">{children}</div>
  </div>
);

/**
 * One payment request, whole.
 *
 * This is the screen the brief means by "viewable by the Super Admin before
 * making an approval decision": what FinHub checked and what it found, every
 * supporting document, and the complete trail of who did what. The decision
 * buttons themselves live in the tab, not here — a decision is taken against a
 * row in the queue and confirmed in its own modal, and putting a third Approve
 * button in a drawer only multiplies the ways to click it by accident.
 *
 * NOTHING HERE WRITES `status`. Every action calls an RPC on the hook, which
 * calls a SECURITY DEFINER function that owns the status machine. When one of
 * them refuses — wrong role, illegal transition, a request that moved in
 * another tab — the message it raises IS the message shown. Rewriting it into
 * something friendlier would hide the one fact that matters, which is whether
 * money moved.
 */
const PaymentRequestDrawer = ({
  request,
  onClose,
  agentsById = {},
  api,             // the usePaymentApproval hook
}) => {
  const toast = useToast();
  const [docs, setDocs]       = useState([]);
  const [events, setEvents]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState('');
  const [reference, setReference] = useState('');
  const [bankRef, setBankRef]     = useState('');
  const [note, setNote]           = useState('');
  const [docType, setDocType]     = useState('invoice');

  const load = useCallback(async () => {
    if (!request?.id) return;
    setLoading(true);
    try {
      const [d, e] = await Promise.all([
        api.listDocuments(request.id),
        api.listEvents(request.id),
      ]);
      setDocs(d);
      setEvents(e);
    } catch (err) {
      toast.error(err?.message || 'Could not load the request detail.');
    } finally {
      setLoading(false);
    }
  }, [request?.id, api, toast]);

  useEffect(() => { load(); }, [load]);

  if (!request) return null;

  const meta   = statusMeta(request.status);
  const agent  = agentsById[request.agent_id];
  const checks = request.validation_result?.checks || [];

  const act = async (label, fn) => {
    setBusy(label);
    try {
      await fn();
      toast.success(`${label} done.`);
      await load();
    } catch (err) {
      toast.error(err?.message || `${label} failed. Nothing has changed.`);
    } finally {
      setBusy('');
    }
  };

  const openDoc = async (doc) => {
    try {
      const url = await api.documentUrl(doc.file_path);
      if (!url) throw new Error('Document file not available.');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(err?.message || 'Could not open the document.');
    }
  };

  const upload = async (file) => {
    if (!file) return;
    setBusy('Upload');
    try {
      await api.attachDocument(request, file, docType);
      toast.success('Document attached.');
      await load();
    } catch (err) {
      toast.error(err?.message || 'Could not attach the document.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="fixed inset-0 z-[900] flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="bg-card w-full max-w-2xl h-full overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-card border-b border-border px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-semibold text-foreground font-mono">{request.request_no}</h2>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${meta.tone}`}>
                {meta.label}
              </span>
            </div>
            <p className="text-xl font-bold text-foreground mt-1">{fmt(request.amount, request.currency)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors" aria-label="Close">
            <Icon name="X" size={18} color="currentColor" />
          </button>
        </div>

        <div className="p-5 space-y-4">

          <Section title="The request" icon="FileText">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Type" value={String(request.request_type || '').replace(/_/g, ' ')} />
              <Field label="Agent" value={agent ? `${agent.full_name} (${agent.agent_code})` : '—'} />
              <Field label="Invoice" value={request.invoice_ref} mono />
              <Field label="Payee" value={request.payee_name} />
              <Field label="Payment method" value={request.payment_method} />
              <Field label="Payee account" value={request.payee_account} mono />
              <Field label="Submitted" value={when(request.submitted_at)} />
              <Field label="Raised" value={when(request.created_at)} />
            </div>
            {request.narrative && (
              <div className="mt-4">
                <Field label="Narration" value={request.narrative} />
              </div>
            )}
          </Section>

          {/* FinHub validation — the verdict AND every reason behind it. A
              summary that said only "failed" would send the approver looking
              for the detail somewhere else, which is where overrides get made
              blind. */}
          <Section
            title="FinHub validation"
            icon="ShieldCheck"
            right={
              request.validation_passed === null || request.validation_passed === undefined ? (
                <span className="text-[11px] text-muted-foreground">Not run</span>
              ) : (
                <span className={`text-[11px] font-semibold ${request.validation_passed ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {request.validation_passed ? 'Passed' : 'Exceptions raised'}
                </span>
              )
            }
          >
            {checks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This request has not been validated yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {checks.map((c, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <Icon
                      name={c.ok ? 'CheckCircle2' : c.severity === 'warning' ? 'AlertTriangle' : 'XCircle'}
                      size={15}
                      color={c.ok ? '#059669' : c.severity === 'warning' ? '#d97706' : '#dc2626'}
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground capitalize">{String(c.check || '').replace(/_/g, ' ')}</p>
                      <p className="text-xs text-muted-foreground">{c.note}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {request.status === 'submitted' && (
              <button
                type="button"
                disabled={!!busy}
                onClick={() => act('Validation', () => api.validateRequest(request.id))}
                className="mt-4 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground disabled:opacity-50"
              >
                {busy === 'Validation' ? 'Validating…' : 'Run FinHub validation'}
              </button>
            )}
          </Section>

          {/* Supporting documents */}
          <Section title={`Supporting documents (${docs.length})`} icon="Paperclip">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : docs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing attached.</p>
            ) : (
              <ul className="space-y-2">
                {docs.map(d => (
                  <li key={d.id} className="flex items-center justify-between gap-3 border border-border rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground truncate">{d.file_name}</p>
                      <p className="text-[11px] text-muted-foreground capitalize">
                        {String(d.document_type || '').replace(/_/g, ' ')} · {when(d.uploaded_at)}
                      </p>
                    </div>
                    <button
                      onClick={() => openDoc(d)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted flex-shrink-0"
                    >
                      <Icon name="ExternalLink" size={12} color="currentColor" /> Open
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {['draft', 'submitted', 'under_validation', 'pending_approval', 'on_hold'].includes(request.status) && (
              <div className="mt-4 flex flex-col sm:flex-row gap-2">
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                  className="px-3 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground"
                >
                  {DOCUMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer">
                  <Icon name="Upload" size={12} color="currentColor" />
                  {busy === 'Upload' ? 'Uploading…' : 'Attach a PDF'}
                  <input
                    type="file"
                    accept=".pdf,image/*,.doc,.docx,.xls,.xlsx"
                    className="hidden"
                    disabled={!!busy}
                    onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }}
                  />
                </label>
              </div>
            )}
          </Section>

          {/* The lifecycle actions FinHub owns. Each one is rendered only in the
              status it is legal in, so the screen never offers a click the
              database is going to refuse. */}
          {['approved', 'processing', 'executed', 'reconciliation_required'].includes(request.status) && (
            <Section title="Execution" icon="Banknote">
              {request.status === 'approved' && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Executing writes the wallet entry and records the payment reference.
                    It is the step that moves the money.
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="Payment reference (M-Pesa code, bank ref…)"
                      className="flex-1 px-3 py-1.5 text-sm bg-background border border-border rounded-lg text-foreground"
                    />
                    <button
                      disabled={!reference.trim() || !!busy}
                      onClick={() => act('Execution', () => api.executeRequest(request.id, reference.trim()))}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white disabled:opacity-50"
                    >
                      {busy === 'Execution' ? 'Executing…' : 'Execute payment'}
                    </button>
                  </div>
                </div>
              )}

              {request.status === 'executed' && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Executed means the instruction was sent. Confirm only once the
                    money is actually seen in the account.
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={bankRef}
                      onChange={(e) => setBankRef(e.target.value)}
                      placeholder="Bank reference"
                      className="flex-1 px-3 py-1.5 text-sm bg-background border border-border rounded-lg text-foreground"
                    />
                    <button
                      disabled={!!busy}
                      onClick={() => act('Bank confirmation', () => api.confirmBankCredit(request.id, bankRef.trim(), true))}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white disabled:opacity-50"
                    >
                      Credited
                    </button>
                    <button
                      disabled={!!busy}
                      onClick={() => act('Bank confirmation', () => api.confirmBankCredit(request.id, bankRef.trim(), false))}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white disabled:opacity-50"
                    >
                      Not credited
                    </button>
                  </div>
                </div>
              )}

              {request.status === 'reconciliation_required' && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Match this payout against the bank transaction to complete it.
                  </p>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Reconciliation note"
                    className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-lg text-foreground"
                  />
                  <div className="flex gap-2">
                    <button
                      disabled={!!busy}
                      onClick={() => act('Reconciliation', () => api.reconcileRequest(request.id, true, note.trim()))}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white disabled:opacity-50"
                    >
                      Matched — complete
                    </button>
                    <button
                      disabled={!!busy}
                      onClick={() => act('Reconciliation', () => api.reconcileRequest(request.id, false, note.trim()))}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white disabled:opacity-50"
                    >
                      Could not match
                    </button>
                  </div>
                </div>
              )}

              {request.status === 'processing' && (
                <p className="text-sm text-muted-foreground">
                  Payment in flight. It will move to Executed once the reference is recorded.
                </p>
              )}
            </Section>
          )}

          {/* Settlement facts, once there are any */}
          {(request.decision || request.executed_at || request.reconciled_at) && (
            <Section title="Settlement" icon="Gavel">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Decision" value={request.decision} />
                <Field label="Decided" value={when(request.decided_at)} />
                <Field label="Verified" value={when(request.verified_at)} />
                <Field label="Payment reference" value={request.payment_reference} mono />
                <Field label="Bank confirmed" value={
                  request.bank_confirmed === null || request.bank_confirmed === undefined
                    ? '—' : (request.bank_confirmed ? 'Yes' : 'No')
                } />
                <Field label="Bank reference" value={request.bank_reference} mono />
              </div>
              {request.decision_reason && (
                <div className="mt-4"><Field label="Reason given" value={request.decision_reason} /></div>
              )}
              {request.failure_reason && (
                <div className="mt-4"><Field label="Failure" value={request.failure_reason} /></div>
              )}
            </Section>
          )}

          {/* The immutable trail */}
          <Section title={`Audit trail (${events.length})`} icon="History">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events recorded.</p>
            ) : (
              <ol className="space-y-3">
                {events.map(ev => (
                  <li key={ev.id} className="flex gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground capitalize">
                        {String(ev.event_type || '').replace(/_/g, ' ')}
                        {ev.from_status !== ev.to_status && ev.to_status && (
                          <span className="font-normal text-muted-foreground">
                            {' '}· {statusMeta(ev.from_status).label} → {statusMeta(ev.to_status).label}
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {ev.actor_name || 'System'}{ev.actor_role ? ` (${ev.actor_role})` : ''} · {when(ev.occurred_at)}
                      </p>
                      {ev.reason && <p className="text-xs text-foreground mt-0.5">{ev.reason}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
};

export default PaymentRequestDrawer;

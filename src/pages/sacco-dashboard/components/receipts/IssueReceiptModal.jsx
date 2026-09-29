import React, { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../../../components/Toast';
import {
  recordLoanRepayment, recordSharePurchasePayment,
  fetchActiveLoans, fetchUnpaidInstalments, fetchPendingSharePurchases,
} from '../../../../services/saccoReceiptService';
import {
  RECEIPT_TYPES, RECEIPT_METHODS, methodMeta, instalmentDue, instalmentsDue, purchaseDue,
  loanRef, localToday, validateReceiptPayment, describeReceiptError,
} from '../../../../utils/saccoReceipts';
import { money } from '../../../../utils/accountingDocument';
import {
  Modal, Field, TextInput, NumberInput, Select, PrimaryButton, GhostButton, fmtDate,
} from '../_shared';

const blankPayment = () => ({ amount: '', method: 'cash', reference: '', paidOn: localToday(), notes: '' });

const byName = (a, b) => String(a.name).localeCompare(String(b.name));

/**
 * Take a payment and issue its receipt.
 *
 * The cashier says what the money is for — instalments of a loan, or a share
 * purchase that has settled and is still owed — then how and when it was paid.
 * Only things that can actually be paid are offered: borrowers with an active
 * loan, instalments not yet paid, purchases with money owed and no receipt. The
 * amount received must equal what is being settled; the database checks that
 * again and issues the receipt in the same transaction as the payment.
 *
 * `preset` opens it on a known item — { type, memberId, loanId, scheduleIds }
 * from a loan schedule, { type, memberId, shareTxnId } from the purchases
 * awaiting payment.
 */
const ReceiptDesk = ({ preset, onClose, onIssued }) => {
  const toast = useToast();
  const typeLocked = !!preset?.type;

  // Mounted fresh on every opening (see IssueReceiptModal below), so the
  // preset is the starting state rather than something applied a render late.
  const [type, setType] = useState(preset?.type || 'loan_repayment');
  const [memberId, setMemberId] = useState(preset?.memberId || '');

  const [loans, setLoans] = useState(null);           // every active loan
  const [loanId, setLoanId] = useState(preset?.loanId || '');
  const [instalments, setInstalments] = useState(null);
  const [selected, setSelected] = useState(() => new Set(preset?.scheduleIds || []));

  const [purchases, setPurchases] = useState(null);   // every purchase awaiting payment
  const [shareTxnId, setShareTxnId] = useState(preset?.shareTxnId || '');

  const [pay, setPay] = useState(blankPayment);
  const [amountTouched, setAmountTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);

  // ── What can be paid ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (type !== 'loan_repayment' || loans) return undefined;
    let live = true;
    fetchActiveLoans()
      .then((rows) => { if (live) setLoans(rows); })
      .catch((e) => { if (live) { setLoans([]); setLoadError(describeReceiptError(e)); } });
    return () => { live = false; };
  }, [type, loans]);

  useEffect(() => {
    if (type !== 'share_purchase' || purchases) return undefined;
    let live = true;
    fetchPendingSharePurchases()
      .then((rows) => { if (live) setPurchases(rows); })
      .catch((e) => { if (live) { setPurchases([]); setLoadError(describeReceiptError(e)); } });
    return () => { live = false; };
  }, [type, purchases]);

  // A loan's unpaid instalments. The preset's rows stay ticked if they are
  // still unpaid; otherwise the oldest one is, which is the one most often due.
  useEffect(() => {
    if (type !== 'loan_repayment' || !loanId) { setInstalments(null); return undefined; }
    let live = true;
    setInstalments(null);
    fetchUnpaidInstalments(loanId)
      .then((rows) => {
        if (!live) return;
        setInstalments(rows);
        setSelected((prev) => {
          const kept = rows.filter((r) => prev.has(r.id)).map((r) => r.id);
          return new Set(kept.length ? kept : rows.slice(0, 1).map((r) => r.id));
        });
      })
      .catch((e) => { if (live) { setInstalments([]); setLoadError(describeReceiptError(e)); } });
    return () => { live = false; };
  }, [type, loanId]);

  // ── Pickers ──────────────────────────────────────────────────────────────────
  const borrowers = useMemo(() => {
    const seen = new Map();
    (loans || []).forEach((l) => {
      const id = l.member_id;
      if (!seen.has(id)) seen.set(id, { id, name: l.member?.full_name || 'Member', no: l.member?.member_no, count: 0 });
      seen.get(id).count += 1;
    });
    return [...seen.values()].sort(byName);
  }, [loans]);

  const buyers = useMemo(() => {
    const seen = new Map();
    (purchases || []).forEach((p) => {
      if (!seen.has(p.member_id)) seen.set(p.member_id, { id: p.member_id, name: p.member_name || 'Member', no: p.member_no, count: 0 });
      seen.get(p.member_id).count += 1;
    });
    return [...seen.values()].sort(byName);
  }, [purchases]);

  const memberLoans = (loans || []).filter((l) => l.member_id === memberId);
  const memberPurchases = (purchases || []).filter((p) => p.member_id === memberId);
  const purchase = memberPurchases.find((p) => p.share_txn_id === shareTxnId) || null;

  // One loan or one purchase is the common case: choose it rather than make the
  // cashier pick the only option there is.
  useEffect(() => {
    if (type === 'loan_repayment' && memberId && !loanId && memberLoans.length === 1) setLoanId(memberLoans[0].id);
  }, [type, memberId, loanId, memberLoans]);
  useEffect(() => {
    if (type === 'share_purchase' && memberId && !shareTxnId && memberPurchases.length === 1) {
      setShareTxnId(memberPurchases[0].share_txn_id);
    }
  }, [type, memberId, shareTxnId, memberPurchases]);

  const chosenInstalments = (instalments || []).filter((r) => selected.has(r.id));
  const due = type === 'loan_repayment' ? instalmentsDue(chosenInstalments) : (purchase ? purchaseDue(purchase) : 0);

  // The amount follows what is being settled until the cashier types their own.
  useEffect(() => {
    if (!amountTouched) setPay((p) => ({ ...p, amount: due > 0 ? due.toFixed(2) : '' }));
  }, [due, amountTouched]);

  const setP = (k, v) => { setPay((p) => ({ ...p, [k]: v })); setServerError(null); };

  const switchType = (next) => {
    setType(next);
    setMemberId('');
    setLoanId('');
    setShareTxnId('');
    setSelected(new Set());
    setAmountTouched(false);
    setServerError(null);
  };

  const chooseMember = (id) => {
    setMemberId(id);
    setLoanId('');
    setShareTxnId('');
    setSelected(new Set());
    setServerError(null);
  };

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setServerError(null);
  };

  const method = methodMeta(pay.method);
  const problem = validateReceiptPayment({
    due, amount: pay.amount, method: pay.method, reference: pay.reference, paidOn: pay.paidOn,
  });
  // A mismatch the cashier typed is worth saying at once; everything else waits
  // for the first press, so an empty form is not a wall of red.
  const shownProblem = attempted || (amountTouched && due > 0 && /must equal/.test(problem || '')) ? problem : null;

  const submit = async () => {
    setAttempted(true);
    if (problem) return;
    setSaving(true);
    setServerError(null);
    try {
      const payment = {
        amount: parseFloat(pay.amount),
        method: pay.method,
        reference: pay.reference.trim(),
        paidOn: pay.paidOn,
        notes: pay.notes.trim(),
      };
      const receipt = type === 'loan_repayment'
        ? await recordLoanRepayment({ ...payment, scheduleIds: chosenInstalments.map((r) => r.id) })
        : await recordSharePurchasePayment({ ...payment, shareTxnId });
      toast.success(`Receipt ${receipt.receipt_no} issued for ${money(receipt.amount)}.`, 'Payment recorded');
      onIssued?.(receipt);
    } catch (e) {
      setServerError(describeReceiptError(e));
    } finally {
      setSaving(false);
    }
  };

  const today = localToday();
  const people = type === 'loan_repayment' ? borrowers : buyers;
  const listLoading = type === 'loan_repayment' ? loans === null : purchases === null;

  return (
    <Modal
      open
      onClose={() => { if (!saving) onClose?.(); }}
      wide
      title="Receive a payment"
      footer={<>
        <GhostButton onClick={onClose} disabled={saving}>Cancel</GhostButton>
        <PrimaryButton icon="Receipt" onClick={submit} disabled={saving || due <= 0}>
          {saving ? 'Issuing…' : 'Issue receipt'}
        </PrimaryButton>
      </>}
    >
      <div className="space-y-5">
        {!typeLocked && (
          <div className="flex gap-2" role="radiogroup" aria-label="Payment for">
            {RECEIPT_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={type === t.value}
                onClick={() => switchType(t.value)}
                className={`flex-1 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                  type === t.value ? 'border-primary/50 text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {loadError && (
          <p className="text-sm text-red-600">{loadError}</p>
        )}

        {/* ── What is being paid ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={type === 'loan_repayment' ? 'Borrower *' : 'Member *'}>
            <Select value={memberId} onChange={(e) => chooseMember(e.target.value)} disabled={listLoading}>
              <option value="">
                {listLoading ? 'Loading…'
                  : people.length === 0
                    ? (type === 'loan_repayment' ? 'No active loans' : 'No purchases awaiting payment')
                    : 'Select member'}
              </option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.no ? ` · ${p.no}` : ''}{p.count > 1 ? ` (${p.count})` : ''}
                </option>
              ))}
            </Select>
          </Field>

          {type === 'loan_repayment' ? (
            <Field label="Loan *">
              <Select value={loanId} onChange={(e) => { setLoanId(e.target.value); setSelected(new Set()); }} disabled={!memberId}>
                <option value="">{memberId ? 'Select loan' : 'Choose the borrower first'}</option>
                {memberLoans.map((l) => (
                  <option key={l.id} value={l.id}>
                    {loanRef(l.id)} · {l.product?.name || 'Loan'} · {money(l.principal)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Share purchase *">
              <Select value={shareTxnId} onChange={(e) => setShareTxnId(e.target.value)} disabled={!memberId}>
                <option value="">{memberId ? 'Select purchase' : 'Choose the member first'}</option>
                {memberPurchases.map((p) => (
                  <option key={p.share_txn_id} value={p.share_txn_id}>
                    {p.txn_no} · {(p.shares || 0).toLocaleString()} shares · {money(p.amount_due)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        {type === 'loan_repayment' && loanId && (
          <div className="border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-muted/40 border-b border-border flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Instalments this payment settles</p>
              <p className="text-xs text-muted-foreground">Whole instalments only</p>
            </div>
            {instalments === null ? (
              <p className="text-sm text-muted-foreground p-4">Loading instalments…</p>
            ) : instalments.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4">Every instalment of this loan is paid.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto divide-y divide-border/60">
                {instalments.map((r) => {
                  const overdue = r.due_date && r.due_date < today;
                  return (
                    <label key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm cursor-pointer hover:bg-muted/40">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggle(r.id)}
                        aria-label={`Instalment ${r.period_no}`}
                      />
                      <span className="w-24 text-foreground">Instalment {r.period_no}</span>
                      <span className="flex-1 text-muted-foreground">
                        due {fmtDate(r.due_date)}
                        {overdue && <span className="ml-2 text-xs font-semibold text-red-600">overdue</span>}
                      </span>
                      <span className="font-medium text-foreground">{money(instalmentDue(r))}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {type === 'share_purchase' && purchase && (
          <div className="p-4 rounded-xl border border-border bg-muted/40 text-sm space-y-1">
            <p className="text-foreground">
              {(purchase.shares || 0).toLocaleString()} shares at {money(purchase.price_per_share)} from {purchase.seller},
              bought {fmtDate(purchase.bought_at)}
            </p>
            <p className="text-muted-foreground">
              Price {money(purchase.consideration)}
              {Number(purchase.fee) > 0 ? ` + trading fee ${money(purchase.fee)}` : ''}
            </p>
          </div>
        )}

        {/* ── How it was paid ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={`Amount received (KES) *${due > 0 ? ` — due ${money(due)}` : ''}`}>
            <NumberInput
              value={pay.amount}
              onChange={(e) => { setAmountTouched(true); setP('amount', e.target.value); }}
              placeholder="0.00"
              step="0.01"
              min="0"
            />
          </Field>
          <Field label="Date paid *">
            <TextInput type="date" value={pay.paidOn} max={today} onChange={(e) => setP('paidOn', e.target.value)} />
          </Field>
          <Field label="Payment method *">
            <Select value={pay.method} onChange={(e) => setP('method', e.target.value)}>
              {RECEIPT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
          </Field>
          <Field label={`${method?.reference || 'Reference'}${method?.required ? ' *' : ''}`}>
            <TextInput
              value={pay.reference}
              onChange={(e) => setP('reference', pay.method === 'mpesa' ? e.target.value.toUpperCase() : e.target.value)}
              placeholder={method?.placeholder || ''}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <TextInput value={pay.notes} onChange={(e) => setP('notes', e.target.value)} placeholder="Optional — printed on the receipt" />
            </Field>
          </div>
        </div>

        {(shownProblem || serverError) && (
          <p role="alert" className="text-sm text-red-600">{serverError || shownProblem}</p>
        )}
      </div>
    </Modal>
  );
};

const IssueReceiptModal = ({ open, ...props }) => (open ? <ReceiptDesk {...props} /> : null);

export default IssueReceiptModal;

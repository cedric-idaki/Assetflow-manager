import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useToast } from '../../../components/Toast';
import Icon from '../../../components/AppIcon';
import { buildContributionReceipt, downloadAccountingDocument } from '../../../utils/accountingDocument';
import {
  Card, StatCard, Badge, Table, EmptyState, GhostButton, PrimaryButton, Modal,
  Field, TextInput, NumberInput, Select, ProgressBar, ContributionChart,
  KES, fmtDate, fmtDateTime, isSettled, accountLabel, monthKey, monthLabel,
} from '../../sacco-dashboard/components/_shared';

const BUILT_IN_TYPES = ['monthly', 'weekly', 'daily', 'one-time'];

// Cash / bank / card / cheque are DECLARATIONS: the member says they paid, and
// the entry waits for the treasurer. M-Pesa is the only method the member can
// settle themselves, because Safaricom confirms it to us directly.
const METHODS = [
  { value: 'mpesa', label: 'M-Pesa (pay now)',   icon: 'Smartphone', instant: true },
  { value: 'cash',  label: 'Cash',               icon: 'Banknote' },
  { value: 'bank',  label: 'Bank transfer',      icon: 'Landmark' },
  { value: 'card',  label: 'Card',               icon: 'CreditCard' },
  { value: 'cheque', label: 'Cheque',            icon: 'FileText' },
];

const EMPTY = {
  amount: '', account: 'deposits', contribution_type: 'monthly',
  payment_method: 'mpesa', reference: '', notes: '', phone: '',
};

// STK pushes are answered on a phone; give the member a real wait, then stop.
const POLL_MS = 4000;
const POLL_LIMIT = 30; // ~2 minutes

const ContributionsTab = ({ ctx }) => {
  const {
    me, sacco, contributions, contributionTypes, contributionStats, stats, exportCSV,
    submitContribution, cancelContribution, payContributionByMpesa, checkMpesaContribution,
  } = ctx;
  const toast = useToast();

  const [receipting, setReceipting] = useState(null);

  /**
   * The member's own copy of a contribution. The office side has issued these
   * since the ledger was built; the member — the one person who actually needs
   * the slip — could only export the whole history as a CSV and had to ask the
   * treasurer for anything that looked like proof.
   *
   * The row carries no member join (these are all mine), so `me` is attached
   * here; the builder decides receipt vs acknowledgement from the status, so an
   * unsettled declaration can never be waved about as proof of payment.
   */
  const downloadReceipt = async (c) => {
    setReceipting(c.id);
    try {
      const filename = await downloadAccountingDocument(buildContributionReceipt({
        contribution: { ...c, member: c.member || me },
        sacco,
      }));
      toast.success(filename, 'Downloaded');
    } catch (e) {
      toast.error(e.message, 'Could not generate the receipt');
    } finally {
      setReceipting(null);
    }
  };

  const [open, setOpen]     = useState(false);
  const [form, setForm]     = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  // null | 'waiting' | 'done' | 'failed'
  const [mpesa, setMpesa]   = useState(null);
  const pollRef  = useRef(null);
  const tickRef  = useRef(0);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const method = METHODS.find((m) => m.value === form.payment_method) || METHODS[0];

  useEffect(() => () => clearInterval(pollRef.current), []);

  const settled = contributions.filter(isSettled);
  const pending = contributions.filter((c) => c.status === 'pending');
  const reversed = contributions.filter((c) => c.status === 'reversed');

  const monthlyTarget = stats.monthlyTarget || 0;

  // Last twelve months of settled deposits, for the progress chart.
  const chartData = useMemo(() => {
    const buckets = new Map();
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      buckets.set(key, 0);
    }
    settled.forEach((c) => {
      if (c.account === 'share_capital') return;
      const key = monthKey(c.period_month || c.paid_date || c.paid_at || c.created_at);
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + (parseFloat(c.amount) || 0));
    });
    return [...buckets.entries()].map(([key, value]) => ({ key, value, label: monthLabel(key) }));
  }, [settled]);

  // The admin's active types are what members are asked to contribute to.
  const expected = (contributionTypes || []).map((t) => {
    const mine = contributions.filter(
      (c) => (c.contribution_type || '').toLowerCase() === t.name.toLowerCase()
    );
    const paidTotal = mine.filter(isSettled).reduce((s, c) => s + parseFloat(c.amount || 0), 0);
    const status = paidTotal > 0 ? 'completed'
      : mine.some((c) => c.status === 'overdue') ? 'overdue'
      : mine.some((c) => c.status === 'pending') ? 'pending'
      : 'due';
    return { ...t, paidTotal, status };
  });

  const typeOptions = [
    ...BUILT_IN_TYPES,
    ...(contributionTypes || []).map((t) => t.name).filter((n) => !BUILT_IN_TYPES.includes(n)),
  ];

  const openNew = () => {
    setForm({
      ...EMPTY,
      amount: monthlyTarget > 0 ? String(monthlyTarget) : '',
      phone: me?.phone || '',
    });
    setMpesa(null);
    setOpen(true);
  };

  const closeAll = () => {
    clearInterval(pollRef.current);
    setOpen(false);
    setMpesa(null);
  };

  const onTypeChange = (v) => {
    set('contribution_type', v);
    const custom = (contributionTypes || []).find((t) => t.name === v);
    if (custom && parseFloat(custom.suggested_amount) > 0) set('amount', String(custom.suggested_amount));
  };

  // Poll the transaction the push created. The callback settles it server-side;
  // this only decides what the member is shown.
  const startPolling = (checkoutRequestId) => {
    tickRef.current = 0;
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      tickRef.current += 1;
      const txn = await checkMpesaContribution(checkoutRequestId);
      if (txn?.status === 'completed') {
        clearInterval(pollRef.current);
        setMpesa({ state: 'done', receipt: txn.mpesa_receipt_number });
        toast.success('Contribution received. Thank you!');
      } else if (txn && ['failed', 'cancelled', 'timeout'].includes(txn.status)) {
        clearInterval(pollRef.current);
        setMpesa({ state: 'failed', error: txn.result_desc || 'The payment was not completed.' });
      } else if (tickRef.current >= POLL_LIMIT) {
        clearInterval(pollRef.current);
        setMpesa({
          state: 'failed',
          error: 'We have not heard back from M-Pesa yet. If your phone was debited, the entry will update on its own — check back shortly.',
        });
      }
    }, POLL_MS);
  };

  const save = async () => {
    const amount = parseFloat(form.amount);
    if (!(amount > 0)) { toast.error('Enter an amount greater than 0.'); return; }
    if (form.payment_method === 'mpesa' && !/^(\+?254|0)\d{9}$/.test(form.phone.replace(/\s+/g, ''))) {
      toast.error('Enter a valid Safaricom number, e.g. 0712 345 678.');
      return;
    }

    setSaving(true);
    try {
      // The pending row is created first, always. For M-Pesa it is what the
      // push is bound to; for everything else it IS the declaration.
      const row = await submitContribution({ ...form, amount });

      if (form.payment_method !== 'mpesa') {
        toast.success(`Recorded as ${row.txn_no}. Your treasurer will confirm it.`);
        setOpen(false);
        return;
      }

      setMpesa({ state: 'waiting' });
      const res = await payContributionByMpesa(row, form.phone.replace(/\s+/g, ''));
      startPolling(res.checkoutRequestId);
    } catch (e) {
      setMpesa(null);
      toast.error(e.message || 'Could not submit your contribution.');
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async (c) => {
    try {
      await cancelContribution(c.id);
      toast.success(`${c.txn_no} withdrawn.`);
    } catch (e) {
      toast.error(e.message || 'Could not withdraw that entry.');
    }
  };

  const nextDue = stats.nextDueDate;
  const outstanding = stats.outstanding || 0;
  const missed = stats.missedMonths || 0;

  return (
    <div className="space-y-6">
      {/* ── Requirement 5: the member dashboard figures ────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total savings"     value={KES(stats.totalSavings)}      icon="PiggyBank" tone="success" hint={`${settled.length} contributions`} />
        <StatCard label="Total deposits"    value={KES(stats.totalDeposits)}     icon="Wallet"    tone="primary" hint={me?.deposit_account_no || undefined} />
        <StatCard label="Total share capital" value={KES(stats.totalShareCapital)} icon="PieChart" tone="primary" hint={me?.share_capital_account_no || undefined} />
        <StatCard
          label="Last contribution"
          value={stats.lastContribution ? KES(stats.lastContribution.amount) : '—'}
          icon="Receipt" tone="muted"
          hint={stats.lastContribution ? fmtDate(stats.lastContribution.paid_at || stats.lastContribution.paid_date) : 'None yet'}
        />
      </div>

      {/* ── Requirement 4 + 5: progress against the monthly obligation ─────── */}
      <Card
        title="Contribution progress"
        subtitle={monthlyTarget > 0
          ? `Your monthly contribution is ${KES(monthlyTarget)}`
          : 'Your sacco has not set a monthly contribution amount for you yet'}
        actions={<PrimaryButton icon="Plus" onClick={openNew}>Make a contribution</PrimaryButton>}
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <ContributionChart data={chartData} target={monthlyTarget} />
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-muted-foreground">This month</span>
                <span className="font-semibold text-foreground">
                  {KES(stats.thisMonth)}{monthlyTarget > 0 ? ` / ${KES(monthlyTarget)}` : ''}
                </span>
              </div>
              <ProgressBar
                value={stats.thisMonth} target={monthlyTarget}
                tone={monthlyTarget > 0 && stats.thisMonth >= monthlyTarget ? 'success' : 'primary'}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded-xl border border-border">
                <p className="text-xs text-muted-foreground">Next expected</p>
                <p className="font-semibold text-foreground mt-0.5">{fmtDate(nextDue)}</p>
              </div>
              <div className={`p-3 rounded-xl border ${outstanding > 0 ? 'border-amber-200 bg-amber-50' : 'border-border'}`}>
                <p className="text-xs text-muted-foreground">Outstanding</p>
                <p className={`font-semibold mt-0.5 ${outstanding > 0 ? 'text-amber-700' : 'text-foreground'}`}>{KES(outstanding)}</p>
              </div>
            </div>

            {missed > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200">
                <Icon name="AlertTriangle" size={16} color="#dc2626" />
                <p className="text-xs text-foreground">
                  You have missed <strong>{missed}</strong> {missed === 1 ? 'month' : 'months'}
                  {contributionStats?.missed_month_list?.length
                    ? `: ${contributionStats.missed_month_list.slice(0, 6).map(monthLabel).join(', ')}${contributionStats.missed_month_list.length > 6 ? '…' : ''}`
                    : ''}.
                </p>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* ── Awaiting the treasurer ─────────────────────────────────────────── */}
      {pending.length > 0 && (
        <Card title="Awaiting confirmation" subtitle="Payments you have declared that your sacco has not confirmed yet">
          <Table columns={['Transaction no', 'Submitted', 'Type', 'Account', 'Method', 'Reference', 'Amount', '']}>
            {pending.map((c) => (
              <tr key={c.id} className="border-b border-border/60">
                <td className="py-2.5 pr-4 font-mono text-xs text-foreground">{c.txn_no}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{fmtDateTime(c.created_at)}</td>
                <td className="py-2.5 pr-4 capitalize text-foreground">{c.contribution_type}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{accountLabel(c.account)}</td>
                <td className="py-2.5 pr-4 uppercase text-xs text-muted-foreground">{c.payment_method}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{c.reference || '—'}</td>
                <td className="py-2.5 pr-4 font-semibold text-foreground">{KES(c.amount)}</td>
                <td className="py-2.5 pr-0 text-right">
                  <button onClick={() => withdraw(c)} className="text-xs text-red-600 font-semibold hover:underline">Withdraw</button>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {/* ── What the sacco expects ─────────────────────────────────────────── */}
      <Card title="Expected contributions" subtitle="Contributions your sacco has set up for members">
        {expected.length === 0 ? (
          <EmptyState icon="ListChecks" title="No extra contributions set up yet" hint="When your sacco creates a contribution — a building fund, holiday savings — it will appear here." />
        ) : (
          <Table columns={['Contribution', 'Frequency', 'Suggested amount', 'Due date', 'I have paid', 'My status', '']}>
            {expected.map((t) => (
              <tr key={t.id} className="border-b border-border/60">
                <td className="py-2.5 pr-4 font-medium text-foreground">
                  {t.name}
                  {t.description ? <span className="block text-xs text-muted-foreground font-normal">{t.description}</span> : null}
                </td>
                <td className="py-2.5 pr-4 capitalize text-muted-foreground">{t.frequency}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{parseFloat(t.suggested_amount) > 0 ? KES(t.suggested_amount) : '—'}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(t.due_date)}</td>
                <td className="py-2.5 pr-4 font-medium text-foreground">{t.paidTotal > 0 ? KES(t.paidTotal) : '—'}</td>
                <td className="py-2.5 pr-4"><Badge status={t.status} /></td>
                <td className="py-2.5 pr-0 text-right">
                  <button
                    onClick={() => {
                      setForm({
                        ...EMPTY,
                        contribution_type: t.name,
                        amount: parseFloat(t.suggested_amount) > 0 ? String(t.suggested_amount) : '',
                        phone: me?.phone || '',
                      });
                      setMpesa(null);
                      setOpen(true);
                    }}
                    className="text-xs text-primary font-semibold hover:underline whitespace-nowrap"
                  >
                    Contribute
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* ── Requirement 4: full history ────────────────────────────────────── */}
      <Card
        title="My contributions"
        subtitle={`${contributions.length} entries${reversed.length ? ` · ${reversed.length} reversed` : ''}`}
        actions={<GhostButton icon="Download" onClick={() => exportCSV(contributions, 'my_contributions')}>Export</GhostButton>}
      >
        {contributions.length === 0 ? (
          <EmptyState icon="PiggyBank" title="No contributions recorded yet" hint="Use “Make a contribution” above to record your first payment." />
        ) : (
          <Table columns={['Transaction no', 'Date & time', 'Type', 'Account', 'Method', 'Reference', 'Received by', 'Amount', 'Status', '']}>
            {contributions.map((c) => (
              <tr key={c.id} className={`border-b border-border/60 ${c.status === 'reversed' ? 'opacity-60' : ''}`}>
                <td className="py-2.5 pr-4 font-mono text-xs text-foreground">{c.txn_no || '—'}</td>
                <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">
                  {c.paid_at ? fmtDateTime(c.paid_at) : fmtDate(c.due_date)}
                </td>
                <td className="py-2.5 pr-4 capitalize text-foreground">{c.contribution_type}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{accountLabel(c.account)}</td>
                <td className="py-2.5 pr-4 uppercase text-xs text-muted-foreground">{c.payment_method || '—'}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{c.reference || '—'}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{c.received_by_name || '—'}</td>
                <td className={`py-2.5 pr-4 font-medium ${c.status === 'reversed' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                  {KES(c.amount)}
                </td>
                <td className="py-2.5 pr-4">
                  <Badge status={c.status} />
                  {c.status === 'reversed' && c.reversal_reason && (
                    <span className="block text-[11px] text-muted-foreground mt-0.5 max-w-[180px]">{c.reversal_reason}</span>
                  )}
                  {c.status === 'failed' && c.failure_reason && (
                    <span className="block text-[11px] text-muted-foreground mt-0.5 max-w-[180px]">{c.failure_reason}</span>
                  )}
                </td>
                <td className="py-2.5 pr-0 text-right">
                  <button
                    onClick={() => downloadReceipt(c)}
                    disabled={receipting === c.id}
                    title={isSettled(c)
                      ? `Download the receipt for ${c.txn_no || 'this contribution'}`
                      : `Download an acknowledgement for ${c.txn_no || 'this contribution'}`}
                    className="align-middle text-muted-foreground hover:text-foreground disabled:opacity-60"
                  >
                    <Icon name={receipting === c.id ? 'Loader' : 'Download'} size={14} color="currentColor"
                      className={receipting === c.id ? 'animate-spin' : ''} />
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* ── Make a contribution ────────────────────────────────────────────── */}
      <Modal
        open={open}
        onClose={() => { if (mpesa?.state !== 'waiting') closeAll(); }}
        title={mpesa ? 'M-Pesa payment' : 'Make a contribution'}
        footer={mpesa ? (
          mpesa.state === 'waiting'
            ? <GhostButton disabled>Waiting for your phone…</GhostButton>
            : <PrimaryButton icon="Check" onClick={closeAll}>Done</PrimaryButton>
        ) : (
          <>
            <GhostButton onClick={closeAll}>Cancel</GhostButton>
            <PrimaryButton icon={method.instant ? 'Smartphone' : 'Check'} onClick={save} disabled={saving}>
              {saving ? 'Submitting…' : method.instant ? 'Pay with M-Pesa' : 'Submit for confirmation'}
            </PrimaryButton>
          </>
        )}
      >
        {mpesa ? (
          <MpesaStatus state={mpesa} amount={form.amount} phone={form.phone} />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Amount (KES) *">
                <NumberInput value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder={monthlyTarget > 0 ? String(monthlyTarget) : '1000'} />
              </Field>
              <Field label="Credit to">
                <Select value={form.account} onChange={(e) => set('account', e.target.value)}>
                  <option value="deposits">Deposit contributions</option>
                  <option value="share_capital">Share capital</option>
                </Select>
              </Field>
              <Field label="Contribution">
                <Select value={form.contribution_type} onChange={(e) => onTypeChange(e.target.value)}>
                  {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </Field>
              <Field label="Payment method">
                <Select value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}>
                  {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </Select>
              </Field>
            </div>

            {method.instant ? (
              <>
                <Field label="Safaricom number *">
                  <TextInput value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="0712 345 678" />
                </Field>
                <div className="flex items-start gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                  <Icon name="Smartphone" size={18} color="#059669" />
                  <p className="text-xs text-foreground">
                    A payment prompt will appear on this phone. Enter your M-Pesa PIN to confirm —
                    your contribution is credited <strong>automatically</strong>, with the M-Pesa
                    receipt stored against it.
                  </p>
                </div>
              </>
            ) : (
              <>
                <Field label="Reference number">
                  <TextInput value={form.reference} onChange={(e) => set('reference', e.target.value)} placeholder="Deposit slip / receipt no." />
                </Field>
                <Field label="Note (optional)">
                  <TextInput value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Anything your treasurer should know" />
                </Field>
                <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
                  <Icon name="Clock" size={18} color="#ca8a04" />
                  <p className="text-xs text-foreground">
                    This is recorded as <strong>pending</strong> and only counts towards your savings
                    once your sacco confirms the money arrived. You can withdraw it until then.
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

const MpesaStatus = ({ state, amount, phone }) => {
  if (state.state === 'waiting') return (
    <div className="text-center py-6 space-y-3">
      <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center bg-emerald-100 animate-pulse">
        <Icon name="Smartphone" size={26} color="#059669" />
      </div>
      <p className="text-sm font-semibold text-foreground">Check your phone</p>
      <p className="text-xs text-muted-foreground">
        Enter your M-Pesa PIN to send {KES(amount)} from {phone}.
      </p>
      <p className="text-xs text-muted-foreground">This page updates on its own — please don't close it.</p>
    </div>
  );

  if (state.state === 'done') return (
    <div className="text-center py-6 space-y-3">
      <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center bg-emerald-100">
        <Icon name="CheckCircle2" size={26} color="#059669" />
      </div>
      <p className="text-sm font-semibold text-foreground">Contribution received</p>
      <p className="text-xs text-muted-foreground">
        {KES(amount)} credited to your account.
        {state.receipt ? <> M-Pesa receipt <span className="font-mono">{state.receipt}</span>.</> : null}
      </p>
    </div>
  );

  return (
    <div className="text-center py-6 space-y-3">
      <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center bg-amber-100">
        <Icon name="AlertTriangle" size={26} color="#ca8a04" />
      </div>
      <p className="text-sm font-semibold text-foreground">Payment not confirmed</p>
      <p className="text-xs text-muted-foreground max-w-sm mx-auto">{state.error}</p>
    </div>
  );
};

export default ContributionsTab;

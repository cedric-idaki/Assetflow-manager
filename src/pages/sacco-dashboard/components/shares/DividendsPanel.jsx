import React, { useState } from 'react';
import { useToast } from '../../../../components/Toast';
import { buildDividendStatement, downloadAccountingDocument } from '../../../../utils/accountingDocument';
import Icon from '../../../../components/AppIcon';
import {
  Card, StatCard, Table, Badge, PrimaryButton, GhostButton, Modal, Field,
  TextInput, NumberInput, Select, EmptyState, KES, fmtDate,
} from '../_shared';
import { KESshort, pct, int, num, withDefaults, today, DIVIDEND_STATUS_HINT } from './_util';

const EMPTY = {
  period_label: '', basis: 'profit_percent', profit_amount: '', dividend_percent: '',
  dividend_per_share: '', record_date: today(), payment_date: '', payout_method: 'cash', notes: '',
};

/**
 * The dividend centre: declare → calculate → pay, with the per-member
 * allocation the calculation produced.
 *
 * The calculation reconstructs each member's holding as it stood on the record
 * date from the share ledger, so somebody who sold last week is still paid what
 * they were owed.
 */
const DividendsPanel = ({ ctx, ov }) => {
  const {
    dividends = [], dividendAllocations = [], members = [], shareSettings, sacco,
    declareDividend, calculateDividend, payDividend, cancelDividend, exportCSV,
  } = ctx;
  const toast = useToast();
  const s = withDefaults(shareSettings);

  const [declareOpen, setDeclareOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [confirm, setConfirm] = useState(null);   // { kind, declaration }
  const [reason, setReason] = useState('');
  const [payRef, setPayRef] = useState('');

  const memberName = (id) => members.find((m) => m.id === id)?.full_name || '—';
  const memberOf = (a) => a.member || members.find((m) => m.id === a.member_id) || {};

  /**
   * A member's dividend slip, issued from the office. The withholding tax is
   * deducted here and remitted on the member's behalf, so the member cannot
   * account for it from a net figure alone — the statement prints gross, tax
   * and net, and says plainly when an allocation has not actually been paid.
   */
  const [docBusy, setDocBusy] = useState(null);
  const downloadAllocation = async (a, declaration) => {
    setDocBusy(a.id);
    try {
      const filename = await downloadAccountingDocument(buildDividendStatement({
        allocation: a, declaration, member: memberOf(a), sacco,
      }));
      toast.success(filename, 'Downloaded');
    } catch (e) {
      toast.error(e.message, 'Could not generate the statement');
    } finally {
      setDocBusy(null);
    }
  };
  const allocationsFor = (id) => dividendAllocations.filter((a) => a.declaration_id === id);

  const paid = dividends.filter((d) => d.status === 'paid');
  const totalPaid = paid.reduce((a, d) => a + num(d.total_payable), 0);
  const outstanding = dividendAllocations.filter((a) => a.status === 'pending')
    .reduce((a, x) => a + num(x.net_amount), 0);

  // Live preview of what the pool would be, before anything is committed.
  const previewPool = form.basis === 'per_share'
    ? num(form.dividend_per_share) * ov.memberOwned
    : num(form.profit_amount) * num(form.dividend_percent) / 100;
  const previewRate = ov.memberOwned > 0 ? previewPool / ov.memberOwned : 0;

  const submitDeclare = async () => {
    if (!form.period_label.trim()) { toast.error('Name the dividend period, e.g. FY2026.'); return; }
    setSaving(true);
    try {
      await declareDividend(form);
      toast.success('Dividend declared. Run the calculation to allocate it to members.');
      setDeclareOpen(false);
      setForm(EMPTY);
    } catch (e) { toast.error(e.message || 'Could not declare the dividend.'); } finally { setSaving(false); }
  };

  const runConfirm = async () => {
    const d = confirm.declaration;
    setSaving(true);
    try {
      if (confirm.kind === 'calculate') {
        const res = await calculateDividend(d);
        const r = Array.isArray(res) ? res[0] : res;
        toast.success(`Allocated ${KES(r?.total_payable || 0)} across ${r?.members_count || 0} members.`);
      } else if (confirm.kind === 'pay') {
        await payDividend(d, payRef);
        toast.success(d.payout_method === 'savings'
          ? 'Dividends paid — each member’s savings have been credited.'
          : 'Dividends marked paid and the liability cleared in the ledger.');
      } else {
        await cancelDividend(d, reason);
        toast.success('Declaration cancelled.');
      }
      setConfirm(null); setReason(''); setPayRef('');
    } catch (e) { toast.error(e.message || 'That action was refused.'); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Dividends paid (lifetime)" value={KESshort(totalPaid)} icon="Coins" tone="success" hint={KES(totalPaid)} />
        <StatCard label="Outstanding payable" value={KESshort(outstanding)} icon="Wallet"
          tone={outstanding > 0 ? 'warning' : 'muted'} hint={outstanding > 0 ? KES(outstanding) : 'Nothing owed'} />
        <StatCard label="Current rate" value={ov.liveDividend ? pct(ov.dividendRate, 2) : '—'} icon="Percent" tone="primary"
          hint={ov.liveDividend?.period_label || 'None declared'} />
        <StatCard label="Declarations" value={dividends.length} icon="FileText" tone="muted"
          hint={`${paid.length} paid`} />
      </div>

      <Card title="Declarations" subtitle="Declare a dividend, calculate every member's share, then pay"
        actions={<PrimaryButton icon="Plus" onClick={() => { setForm({ ...EMPTY, record_date: today() }); setDeclareOpen(true); }}>Declare dividend</PrimaryButton>}>
        {dividends.length === 0 ? (
          <EmptyState icon="Coins" title="No dividends declared yet"
            hint="Declare the profit and the rate; the engine works out every member's entitlement from their holding on the record date." />
        ) : (
          <Table columns={['Period', 'Basis', 'Rate', 'Record date', 'Payment date', 'Members', 'Total payable', 'Status', '']}>
            {dividends.map((d) => (
              <tr key={d.id} className="border-b border-border/60">
                <td className="py-2.5 pr-4">
                  <p className="font-medium text-foreground">{d.period_label}</p>
                  {d.notes && <p className="text-xs text-muted-foreground max-w-[200px] truncate">{d.notes}</p>}
                </td>
                <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                  {d.basis === 'per_share' ? 'Fixed per share' : `${pct(num(d.dividend_percent), 2)} of ${KES(d.profit_amount)}`}
                </td>
                <td className="py-2.5 pr-4 text-foreground">
                  {num(d.dividend_per_share) > 0 ? `${KES(d.dividend_per_share)}/share` : '—'}
                </td>
                <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(d.record_date)}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(d.payment_date)}</td>
                <td className="py-2.5 pr-4 text-foreground">{d.members_count || '—'}</td>
                <td className="py-2.5 pr-4 font-semibold text-foreground">{num(d.total_payable) > 0 ? KES(d.total_payable) : '—'}</td>
                <td className="py-2.5 pr-4"><Badge status={d.status} /></td>
                <td className="py-2.5 pr-0 text-right whitespace-nowrap">
                  {d.status === 'declared' && (
                    <button onClick={() => setConfirm({ kind: 'calculate', declaration: d })}
                      className="text-xs text-primary font-semibold hover:underline">Calculate</button>
                  )}
                  {d.status === 'calculated' && (
                    <>
                      <button onClick={() => setViewing(d)} className="text-xs text-muted-foreground font-semibold hover:underline">Review</button>
                      <button onClick={() => { setPayRef(''); setConfirm({ kind: 'pay', declaration: d }); }}
                        className="ml-3 text-xs text-emerald-600 font-semibold hover:underline">Pay</button>
                    </>
                  )}
                  {d.status === 'paid' && (
                    <button onClick={() => setViewing(d)} className="text-xs text-primary font-semibold hover:underline">View</button>
                  )}
                  {['declared', 'calculated'].includes(d.status) && (
                    <button onClick={() => { setReason(''); setConfirm({ kind: 'cancel', declaration: d }); }}
                      className="ml-3 text-xs text-red-600 font-semibold hover:underline">Cancel</button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* ── Declare ── */}
      <Modal open={declareOpen} onClose={() => setDeclareOpen(false)} title="Declare a dividend"
        footer={<>
          <GhostButton onClick={() => setDeclareOpen(false)}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={submitDeclare} disabled={saving}>{saving ? 'Declaring…' : 'Declare'}</PrimaryButton>
        </>}>
        <p className="text-sm text-muted-foreground mb-4">
          Declaring records the board's decision. Nothing is allocated or paid until you run the
          calculation, which snapshots every member's holding as at the record date.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Period *"><TextInput value={form.period_label} onChange={(e) => set('period_label', e.target.value)} placeholder="FY2026" /></Field>
          <Field label="Basis">
            <Select value={form.basis} onChange={(e) => set('basis', e.target.value)}>
              <option value="profit_percent">Percentage of profit</option>
              <option value="per_share">Fixed amount per share</option>
            </Select>
          </Field>
          {form.basis === 'profit_percent' ? (
            <>
              <Field label="Distributable profit (KES) *">
                <NumberInput value={form.profit_amount} onChange={(e) => set('profit_amount', e.target.value)} placeholder="20000000" />
              </Field>
              <Field label="Dividend percentage *">
                <NumberInput value={form.dividend_percent} onChange={(e) => set('dividend_percent', e.target.value)} placeholder="15" />
              </Field>
            </>
          ) : (
            <Field label="Amount per share (KES) *">
              <NumberInput value={form.dividend_per_share} onChange={(e) => set('dividend_per_share', e.target.value)} placeholder="12" />
            </Field>
          )}
          <Field label="Record date *"><TextInput type="date" value={form.record_date} onChange={(e) => set('record_date', e.target.value)} /></Field>
          <Field label="Payment date"><TextInput type="date" value={form.payment_date} onChange={(e) => set('payment_date', e.target.value)} /></Field>
          <Field label="Payout method">
            <Select value={form.payout_method} onChange={(e) => set('payout_method', e.target.value)}>
              <option value="cash">Cash / bank payout</option>
              <option value="savings">Credit each member's savings</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes"><TextInput value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="e.g. approved at the AGM of 12 Dec 2026" /></Field>
          </div>
        </div>

        {previewPool > 0 && (
          <div className="mt-4 p-3 rounded-lg bg-muted text-sm space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Estimate at today's register</p>
            <div className="flex justify-between"><span className="text-muted-foreground">Total pool</span>
              <span className="font-semibold text-foreground">{KES(previewPool)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Per share</span>
              <span className="text-foreground">{KES(previewRate)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Across</span>
              <span className="text-foreground">{ov.memberOwned.toLocaleString()} member-held shares · {ov.shareholders} holders</span></div>
            {num(s.dividend_tax_percent) > 0 && (
              <div className="flex justify-between"><span className="text-muted-foreground">Withholding tax ({s.dividend_tax_percent}%)</span>
                <span className="text-foreground">{KES(previewPool * num(s.dividend_tax_percent) / 100)}</span></div>
            )}
            <p className="text-xs text-muted-foreground pt-1">
              Final figures come from holdings on {fmtDate(form.record_date)}, not today's.
            </p>
          </div>
        )}
      </Modal>

      {/* ── Allocation review ── */}
      <Modal open={!!viewing} wide onClose={() => setViewing(null)}
        title={viewing ? `${viewing.period_label} — member allocations` : ''}
        footer={<>
          {viewing && allocationsFor(viewing.id).length > 0 && (
            <GhostButton icon="Download" onClick={() => exportCSV(allocationsFor(viewing.id).map((a) => ({
              member: a.member?.full_name || memberName(a.member_id),
              member_no: a.member?.member_no || '',
              shares_at_record: a.shares_at_record,
              gross: a.gross_amount, tax: a.tax_amount, net: a.net_amount,
              status: a.status, paid_at: a.paid_at ? String(a.paid_at).slice(0, 10) : '',
              reference: a.payment_ref || '',
            })), `dividend_${viewing.period_label}`)}>Export</GhostButton>
          )}
          <PrimaryButton icon="X" onClick={() => setViewing(null)}>Close</PrimaryButton>
        </>}>
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Total payable" value={KES(viewing.total_payable)} icon="Coins" tone="primary" />
              <StatCard label="Per share" value={KES(viewing.dividend_per_share)} icon="Tag" tone="muted" />
              <StatCard label="Members" value={viewing.members_count} icon="Users" tone="muted" />
              <StatCard label="Withholding tax" value={KES(viewing.total_tax)} icon="Receipt" tone="muted" />
            </div>
            <p className="text-xs text-muted-foreground">
              {DIVIDEND_STATUS_HINT[viewing.status]} · Record date {fmtDate(viewing.record_date)} ·
              {' '}{viewing.payout_method === 'savings' ? 'Credited to member savings' : 'Paid in cash'}
              {' '}· {int(viewing.total_shares).toLocaleString()} qualifying shares
            </p>
            {allocationsFor(viewing.id).length === 0 ? (
              <EmptyState icon="Users" title="No allocations" hint="Run the calculation to allocate this dividend." />
            ) : (
              <Table columns={['Member', 'Shares at record', 'Gross', 'Tax', 'Net', 'Status', '']}>
                {[...allocationsFor(viewing.id)]
                  .sort((a, b) => num(b.net_amount) - num(a.net_amount))
                  .map((a) => (
                    <tr key={a.id} className="border-b border-border/60">
                      <td className="py-2.5 pr-4 font-medium text-foreground">{a.member?.full_name || memberName(a.member_id)}</td>
                      <td className="py-2.5 pr-4 text-foreground">{int(a.shares_at_record).toLocaleString()}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{KES(a.gross_amount)}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{num(a.tax_amount) > 0 ? KES(a.tax_amount) : '—'}</td>
                      <td className="py-2.5 pr-4 font-semibold text-foreground">{KES(a.net_amount)}</td>
                      <td className="py-2.5 pr-4"><Badge status={a.status} /></td>
                      <td className="py-2.5 pr-0 text-right">
                        <button
                          onClick={() => downloadAllocation(a, viewing)}
                          disabled={docBusy === a.id}
                          title={a.status === 'paid'
                            ? `Download the payment advice for ${a.member?.full_name || memberName(a.member_id)}`
                            : `Download the entitlement advice for ${a.member?.full_name || memberName(a.member_id)}`}
                          className="align-middle text-muted-foreground hover:text-foreground disabled:opacity-60"
                        >
                          <Icon name={docBusy === a.id ? 'Loader' : 'Download'} size={14} color="currentColor"
                            className={docBusy === a.id ? 'animate-spin' : ''} />
                        </button>
                      </td>
                    </tr>
                  ))}
              </Table>
            )}
          </div>
        )}
      </Modal>

      {/* ── Calculate / pay / cancel ── */}
      <Modal open={!!confirm} onClose={() => setConfirm(null)}
        title={confirm?.kind === 'calculate' ? 'Calculate this dividend'
          : confirm?.kind === 'pay' ? 'Pay this dividend' : 'Cancel this declaration'}
        footer={<>
          <GhostButton onClick={() => setConfirm(null)}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={runConfirm} disabled={saving}>{saving ? 'Working…' : 'Confirm'}</PrimaryButton>
        </>}>
        {confirm && (
          <>
            <p className="text-sm text-foreground mb-3">
              <strong>{confirm.declaration.period_label}</strong> · record date {fmtDate(confirm.declaration.record_date)}
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              {confirm.kind === 'calculate' && 'Every member\'s holding as at the record date is reconstructed from the share ledger, their entitlement is worked out, and the liability is accrued in the ledger. You can review the allocations before paying.'}
              {confirm.kind === 'pay' && (confirm.declaration.payout_method === 'savings'
                ? `Each member's net dividend is credited to their savings as a completed contribution, and ${KES(confirm.declaration.total_payable)} moves from dividends payable to member deposits.`
                : `${KES(confirm.declaration.total_payable)} is marked paid to ${confirm.declaration.members_count} members and the payable is cleared against the bank.`)}
              {confirm.kind === 'cancel' && 'The declaration and every allocation are marked cancelled. Nothing is paid.'}
            </p>
            {confirm.kind === 'pay' && (
              <Field label="Payment reference (optional)">
                <TextInput value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="e.g. bank batch DIV-2026-01" />
              </Field>
            )}
            {confirm.kind === 'cancel' && (
              <Field label="Reason">
                <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. superseded by a revised AGM resolution" />
              </Field>
            )}
            {confirm.kind === 'calculate' && ov.memberOwned === 0 && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
                <Icon name="AlertTriangle" size={15} color="#ca8a04" />
                <p className="text-xs text-foreground">No member holds shares — the calculation will be refused.</p>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
};

export default DividendsPanel;

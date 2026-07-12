import React, { useState } from 'react';
import { useToast } from '../../../components/Toast';
import { Card, StatCard, Table, Badge, PrimaryButton, GhostButton, Modal, Field, TextInput, NumberInput, Select, EmptyState, KES, fmtDate } from './_shared';

const TYPES = ['monthly', 'weekly', 'project', 'other'];
const STATUSES = ['paid', 'pending', 'overdue', 'waived'];

const ContributionsTab = ({ ctx }) => {
  const { contributions, members, recordContribution, exportCSV } = ctx;
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    member_id: '', amount: '', contribution_type: 'monthly',
    due_date: '', paid_date: new Date().toISOString().slice(0, 10),
    status: 'paid', penalty_amount: '', reference: '', notes: '',
  });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const totalPaid = contributions.filter((c) => c.status === 'paid').reduce((s, c) => s + parseFloat(c.amount || 0), 0);
  const totalPenalty = contributions.reduce((s, c) => s + parseFloat(c.penalty_amount || 0), 0);
  const overdue = contributions.filter((c) => c.status === 'overdue').length;

  const save = async () => {
    if (!form.member_id) { toast.error('Choose a member.'); return; }
    if (!(parseFloat(form.amount) > 0)) { toast.error('Enter an amount greater than 0.'); return; }
    setSaving(true);
    try {
      await recordContribution(form);
      toast.success('Contribution recorded.');
      setOpen(false);
      setForm((p) => ({ ...p, amount: '', reference: '', notes: '', penalty_amount: '' }));
    } catch (e) {
      toast.error(e.message || 'Could not record contribution.');
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total collected" value={KES(totalPaid)} icon="PiggyBank" tone="success" />
        <StatCard label="Penalties" value={KES(totalPenalty)} icon="AlertTriangle" tone="warning" />
        <StatCard label="Overdue entries" value={overdue} icon="Clock" tone={overdue ? 'warning' : 'muted'} />
      </div>

      <Card
        title="Contributions ledger" subtitle={`${contributions.length} entries`}
        actions={
          <div className="flex items-center gap-2">
            <GhostButton icon="Download" onClick={() => exportCSV(contributions, 'sacco_contributions')}>Export</GhostButton>
            <PrimaryButton icon="Plus" onClick={() => setOpen(true)}>Record contribution</PrimaryButton>
          </div>
        }
      >
        {contributions.length === 0 ? (
          <EmptyState icon="PiggyBank" title="No contributions recorded" hint="Record a member's savings contribution to build their statement." />
        ) : (
          <Table columns={['Member', 'Type', 'Amount', 'Due', 'Paid', 'Penalty', 'Status']}>
            {contributions.map((c) => (
              <tr key={c.id} className={`border-b border-border/60 ${c.status === 'overdue' ? 'bg-red-50/40' : ''}`}>
                <td className="py-2.5 pr-4 font-medium text-foreground">{c.member?.full_name || '—'}</td>
                <td className="py-2.5 pr-4 capitalize text-muted-foreground">{c.contribution_type}</td>
                <td className="py-2.5 pr-4 font-semibold text-foreground">{KES(c.amount)}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(c.due_date)}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(c.paid_date)}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{c.penalty_amount > 0 ? KES(c.penalty_amount) : '—'}</td>
                <td className="py-2.5 pr-4"><Badge status={c.status} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal
        open={open} onClose={() => setOpen(false)} title="Record contribution"
        footer={<>
          <GhostButton onClick={() => setOpen(false)}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Record'}</PrimaryButton>
        </>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Member *">
            <Select value={form.member_id} onChange={(e) => set('member_id', e.target.value)}>
              <option value="">Select member</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Amount (KES) *"><NumberInput value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="1000" /></Field>
          <Field label="Type"><Select value={form.contribution_type} onChange={(e) => set('contribution_type', e.target.value)}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
          <Field label="Status"><Select value={form.status} onChange={(e) => set('status', e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
          <Field label="Due date"><TextInput type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} /></Field>
          <Field label="Paid date"><TextInput type="date" value={form.paid_date} onChange={(e) => set('paid_date', e.target.value)} /></Field>
          <Field label="Penalty (KES)"><NumberInput value={form.penalty_amount} onChange={(e) => set('penalty_amount', e.target.value)} placeholder="0" /></Field>
          <Field label="Reference"><TextInput value={form.reference} onChange={(e) => set('reference', e.target.value)} placeholder="M-Pesa code" /></Field>
        </div>
      </Modal>
    </div>
  );
};

export default ContributionsTab;

import React, { useState } from 'react';
import { useToast } from '../../../components/Toast';
import { Card, StatCard, Table, Badge, PrimaryButton, GhostButton, Modal, Field, TextInput, NumberInput, Select, EmptyState, KES, fmtDate } from './_shared';

const TYPES = ['monthly', 'weekly', 'project', 'other'];
const STATUSES = ['paid', 'pending', 'overdue', 'waived'];
const FREQUENCIES = ['one-off', 'weekly', 'monthly'];

const EMPTY_TYPE_FORM = { name: '', description: '', suggested_amount: '', frequency: 'monthly', due_date: '' };

const ContributionsTab = ({ ctx }) => {
  const {
    contributions, members, contributionTypes,
    recordContribution, createContributionType, updateContributionType, exportCSV,
  } = ctx;
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    member_id: '', amount: '', contribution_type: 'monthly',
    due_date: '', paid_date: new Date().toISOString().slice(0, 10),
    status: 'paid', penalty_amount: '', reference: '', notes: '',
  });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const [typesOpen, setTypesOpen] = useState(false);
  const [savingType, setSavingType] = useState(false);
  const [typeForm, setTypeForm] = useState(EMPTY_TYPE_FORM);
  const setT = (k, v) => setTypeForm((p) => ({ ...p, [k]: v }));

  const customTypes = (contributionTypes || []).filter((t) => t.is_active);
  const typeOptions = [...TYPES, ...customTypes.map((t) => t.name).filter((n) => !TYPES.includes(n))];

  // Picking a custom type pre-fills its suggested amount if none entered yet.
  const onTypeChange = (v) => {
    set('contribution_type', v);
    const custom = customTypes.find((t) => t.name === v);
    if (custom && parseFloat(custom.suggested_amount) > 0 && !form.amount) {
      set('amount', String(custom.suggested_amount));
    }
  };

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

  const saveType = async () => {
    const name = typeForm.name.trim();
    if (!name) { toast.error('Give the contribution a name.'); return; }
    const taken = typeOptions.some((t) => t.toLowerCase() === name.toLowerCase())
      || (contributionTypes || []).some((t) => t.name.toLowerCase() === name.toLowerCase());
    if (taken) { toast.error('A contribution type with that name already exists.'); return; }
    setSavingType(true);
    try {
      await createContributionType(typeForm);
      toast.success(`"${name}" added. It's now available when recording contributions.`);
      setTypeForm(EMPTY_TYPE_FORM);
    } catch (e) {
      toast.error(e.message || 'Could not add contribution type.');
    } finally { setSavingType(false); }
  };

  const toggleType = async (t) => {
    try {
      await updateContributionType(t.id, { is_active: !t.is_active });
      toast.success(t.is_active ? `"${t.name}" deactivated.` : `"${t.name}" reactivated.`);
    } catch (e) {
      toast.error(e.message || 'Could not update contribution type.');
    }
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
            <GhostButton icon="ListPlus" onClick={() => setTypesOpen(true)}>Contribution types</GhostButton>
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
          <Field label="Type"><Select value={form.contribution_type} onChange={(e) => onTypeChange(e.target.value)}>{typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
          <Field label="Status"><Select value={form.status} onChange={(e) => set('status', e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
          <Field label="Due date"><TextInput type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} /></Field>
          <Field label="Paid date"><TextInput type="date" value={form.paid_date} onChange={(e) => set('paid_date', e.target.value)} /></Field>
          <Field label="Penalty (KES)"><NumberInput value={form.penalty_amount} onChange={(e) => set('penalty_amount', e.target.value)} placeholder="0" /></Field>
          <Field label="Reference"><TextInput value={form.reference} onChange={(e) => set('reference', e.target.value)} placeholder="M-Pesa code" /></Field>
        </div>
      </Modal>

      <Modal
        open={typesOpen} onClose={() => setTypesOpen(false)} title="Contribution types" wide
        footer={<GhostButton onClick={() => setTypesOpen(false)}>Done</GhostButton>}
      >
        <p className="text-xs text-muted-foreground mb-4">
          Create extra contributions — a building fund, holiday savings, a land project — for your members
          to engage in. Active types appear in the Record contribution form alongside the built-in ones
          (monthly, weekly, project, other).
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name *"><TextInput value={typeForm.name} onChange={(e) => setT('name', e.target.value)} placeholder="e.g. Building fund" /></Field>
          <Field label="Suggested amount (KES)"><NumberInput value={typeForm.suggested_amount} onChange={(e) => setT('suggested_amount', e.target.value)} placeholder="500" /></Field>
          <Field label="Frequency"><Select value={typeForm.frequency} onChange={(e) => setT('frequency', e.target.value)}>{FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}</Select></Field>
          <Field label="Due date"><TextInput type="date" value={typeForm.due_date} onChange={(e) => setT('due_date', e.target.value)} /></Field>
          <div className="sm:col-span-2">
            <Field label="Description"><TextInput value={typeForm.description} onChange={(e) => setT('description', e.target.value)} placeholder="What is this contribution for?" /></Field>
          </div>
        </div>
        <div className="flex justify-end mt-3">
          <PrimaryButton icon="Plus" onClick={saveType} disabled={savingType}>{savingType ? 'Adding…' : 'Add type'}</PrimaryButton>
        </div>

        <div className="mt-5 pt-4 border-t border-border">
          <p className="text-xs font-semibold text-foreground mb-2">Your custom types</p>
          {(contributionTypes || []).length === 0 ? (
            <p className="text-xs text-muted-foreground">None yet. Add one above to make it available for member contributions.</p>
          ) : (
            <Table columns={['Name', 'Frequency', 'Suggested', 'Due', 'Status', '']}>
              {contributionTypes.map((t) => (
                <tr key={t.id} className="border-b border-border/60">
                  <td className="py-2.5 pr-4 font-medium text-foreground">
                    {t.name}
                    {t.description ? <span className="block text-xs text-muted-foreground font-normal">{t.description}</span> : null}
                  </td>
                  <td className="py-2.5 pr-4 capitalize text-muted-foreground">{t.frequency}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{t.suggested_amount > 0 ? KES(t.suggested_amount) : '—'}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(t.due_date)}</td>
                  <td className="py-2.5 pr-4"><Badge status={t.is_active ? 'active' : 'inactive'} /></td>
                  <td className="py-2.5"><GhostButton onClick={() => toggleType(t)}>{t.is_active ? 'Deactivate' : 'Activate'}</GhostButton></td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default ContributionsTab;

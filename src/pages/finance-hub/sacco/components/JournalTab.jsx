/**
 * Journal tab — §4 and §10.2.
 *
 * Three ways in, all landing in the same ledger:
 *   1. Post a transaction     — pick a TEMPLATE and an amount. The UI never
 *                               exposes a raw debit/credit pair.
 *   2. Manual multi-line entry— for anything the templates don't cover; the
 *                               database still refuses an unbalanced entry.
 *   3. Sync from operations   — turns recorded contributions, disbursements and
 *                               repayments into journal entries, once each.
 *
 * Corrections are reversing entries. History is never edited.
 */
import React, { useMemo, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { useToast } from '../../../../components/Toast';
import {
  Card, PrimaryButton, GhostButton, Modal, Field,
  TextInput, NumberInput, Select, EmptyState, fmtDate,
} from '../../../sacco-dashboard/components/_shared';
import { fmtPlain, round2 } from '../../../../utils/saccoAccounting';

const CATEGORY_LABEL = {
  member: 'Member transactions', loan: 'Loan book', period_end: 'Period-end (automated)',
  equity: 'Equity & distributions', ops: 'Operations & funding', chama: 'Chama',
};

const today = () => new Date().toISOString().slice(0, 10);

// ── Post-from-template modal ────────────────────────────────────────────────
const TemplateModal = ({ open, onClose, fin, members, onDone }) => {
  const toast = useToast();
  const { templates, coa, postFromTemplate } = fin;
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    templateCode: '', amount: '', date: today(), reference: '', description: '',
    memberId: '', variableAccount: '',
  });

  const tpl = templates.find((t) => t.template_code === f.templateCode);
  const accountName = (code) => coa.find((a) => a.account_code === code)?.account_name || code;

  const drCode = tpl ? (tpl.variable_side === 'debit'  && f.variableAccount ? f.variableAccount : tpl.debit_account)  : null;
  const crCode = tpl ? (tpl.variable_side === 'credit' && f.variableAccount ? f.variableAccount : tpl.credit_account) : null;

  const pick = (code) => {
    const t = templates.find((x) => x.template_code === code);
    setF((s) => ({
      ...s, templateCode: code,
      variableAccount: t?.variable_side ? (t.variable_side === 'debit' ? t.debit_account : t.credit_account) : '',
      description: t?.name || '',
    }));
  };

  const submit = async () => {
    if (!tpl) { toast.error('Choose a transaction type.'); return; }
    if (!(round2(f.amount) > 0)) { toast.error('Enter an amount greater than zero.'); return; }
    if (tpl.requires_member && !f.memberId) { toast.error(`${tpl.name} must be tied to a member.`); return; }
    setBusy(true);
    try {
      await postFromTemplate({
        templateCode: f.templateCode,
        amount: round2(f.amount),
        date: f.date,
        description: f.description || tpl.name,
        reference: f.reference || null,
        memberId: f.memberId || null,
        debitAccount: drCode,
        creditAccount: crCode,
      });
      toast.success(`${tpl.name} posted.`, 'Entry posted');
      setF({ templateCode: '', amount: '', date: today(), reference: '', description: '', memberId: '', variableAccount: '' });
      onClose();
      onDone?.();
    } catch (e) {
      toast.error(e.message, 'Posting rejected');
    } finally { setBusy(false); }
  };

  const grouped = useMemo(() => {
    const g = {};
    templates.filter((t) => !t.is_automated).forEach((t) => { (g[t.category] = g[t.category] || []).push(t); });
    return g;
  }, [templates]);

  return (
    <Modal open={open} onClose={onClose} title="Post a transaction" wide
      footer={<>
        <GhostButton onClick={onClose}>Cancel</GhostButton>
        <PrimaryButton icon="Check" onClick={submit} disabled={busy}>{busy ? 'Posting…' : 'Post entry'}</PrimaryButton>
      </>}>
      <div className="space-y-3">
        <Field label="Transaction type">
          <Select value={f.templateCode} onChange={(e) => pick(e.target.value)}>
            <option value="">Choose a transaction…</option>
            {Object.entries(grouped).map(([cat, list]) => (
              <optgroup key={cat} label={CATEGORY_LABEL[cat] || cat}>
                {list.map((t) => <option key={t.template_code} value={t.template_code}>{t.name}</option>)}
              </optgroup>
            ))}
          </Select>
        </Field>

        {tpl && (
          <>
            <div className="p-3 rounded-lg border border-border bg-muted/40">
              <p className="text-xs text-muted-foreground mb-2">This posts, per §4 of the specification:</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase">Debit</span>
                  <p className="font-mono text-xs text-foreground">{drCode}</p>
                  <p className="text-xs text-muted-foreground">{accountName(drCode)}</p>
                </div>
                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase">Credit</span>
                  <p className="font-mono text-xs text-foreground">{crCode}</p>
                  <p className="text-xs text-muted-foreground">{accountName(crCode)}</p>
                </div>
              </div>
              {tpl.trigger_hint && <p className="text-xs text-muted-foreground mt-2">Trigger: {tpl.trigger_hint}</p>}
            </div>

            {tpl.variable_side && (tpl.variable_options || []).length > 0 && (
              <Field label={`${tpl.variable_side === 'debit' ? 'Debit' : 'Credit'} account`}>
                <Select value={f.variableAccount} onChange={(e) => setF({ ...f, variableAccount: e.target.value })}>
                  {tpl.variable_options.map((code) => (
                    <option key={code} value={code}>{code} — {accountName(code)}</option>
                  ))}
                </Select>
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount"><NumberInput step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
              <Field label="Date"><TextInput type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            </div>

            <Field label={`Member${tpl.requires_member ? '' : ' (optional)'}`}>
              <Select value={f.memberId} onChange={(e) => setF({ ...f, memberId: e.target.value })}>
                <option value="">{tpl.requires_member ? 'Choose a member…' : 'Not member-specific'}</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}{m.member_no ? ` (${m.member_no})` : ''}</option>)}
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Description"><TextInput value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
              <Field label="Reference (optional)"><TextInput value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="Receipt / M-Pesa code" /></Field>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

// ── Manual multi-line entry modal ───────────────────────────────────────────
const ManualModal = ({ open, onClose, fin, members, onDone }) => {
  const toast = useToast();
  const { coa, postManual } = fin;
  const [busy, setBusy] = useState(false);
  const [head, setHead] = useState({ date: today(), description: '', reference: '', memberId: '' });
  const [lines, setLines] = useState([
    { account_code: '', debit: '', credit: '' },
    { account_code: '', debit: '', credit: '' },
  ]);

  const totalDr = round2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
  const totalCr = round2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
  const balanced = totalDr === totalCr && totalDr > 0;

  const setLine = (i, patch) => setLines((ls) => ls.map((l, ix) => (ix === i ? { ...l, ...patch } : l)));
  const active = coa.filter((a) => a.is_active);

  const submit = async () => {
    if (!head.description.trim()) { toast.error('Describe what the entry is for.'); return; }
    if (!balanced) { toast.error('Debits must equal credits before the entry can be posted.', 'Out of balance'); return; }
    setBusy(true);
    try {
      await postManual({ ...head, memberId: head.memberId || null, lines });
      toast.success('Journal entry posted.', 'Posted');
      setHead({ date: today(), description: '', reference: '', memberId: '' });
      setLines([{ account_code: '', debit: '', credit: '' }, { account_code: '', debit: '', credit: '' }]);
      onClose();
      onDone?.();
    } catch (e) { toast.error(e.message, 'Posting rejected'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Manual journal entry" wide
      footer={<>
        <GhostButton onClick={onClose}>Cancel</GhostButton>
        <PrimaryButton icon="Check" onClick={submit} disabled={busy || !balanced}>{busy ? 'Posting…' : 'Post entry'}</PrimaryButton>
      </>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><TextInput type="date" value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} /></Field>
          <Field label="Reference (optional)"><TextInput value={head.reference} onChange={(e) => setHead({ ...head, reference: e.target.value })} /></Field>
        </div>
        <Field label="Description"><TextInput value={head.description} onChange={(e) => setHead({ ...head, description: e.target.value })} placeholder="e.g. Reclassify misposted school fees loan" /></Field>
        <Field label="Member (optional)">
          <Select value={head.memberId} onChange={(e) => setHead({ ...head, memberId: e.target.value })}>
            <option value="">Not member-specific</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </Select>
        </Field>

        <div className="border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 px-3 font-medium">Account</th>
                  <th className="py-2 px-3 font-medium w-32 text-right">Debit</th>
                  <th className="py-2 px-3 font-medium w-32 text-right">Credit</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-2">
                      <Select value={l.account_code} onChange={(e) => setLine(i, { account_code: e.target.value })}>
                        <option value="">Choose account…</option>
                        {active.map((a) => <option key={a.id} value={a.account_code}>{a.account_code} — {a.account_name}</option>)}
                      </Select>
                    </td>
                    <td className="p-2">
                      <NumberInput step="0.01" value={l.debit}
                        onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} />
                    </td>
                    <td className="p-2">
                      <NumberInput step="0.01" value={l.credit}
                        onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
                    </td>
                    <td className="p-2 text-center">
                      {lines.length > 2 && (
                        <button onClick={() => setLines((ls) => ls.filter((_, ix) => ix !== i))} className="text-muted-foreground hover:text-red-600">
                          <Icon name="X" size={14} color="currentColor" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/50">
                <tr className="border-t border-border text-sm font-semibold">
                  <td className="py-2 px-3 text-muted-foreground">Totals</td>
                  <td className="py-2 px-3 text-right font-mono">{fmtPlain(totalDr)}</td>
                  <td className="py-2 px-3 text-right font-mono">{fmtPlain(totalCr)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <GhostButton icon="Plus" onClick={() => setLines((ls) => [...ls, { account_code: '', debit: '', credit: '' }])}>Add line</GhostButton>
          <span className={`text-xs font-semibold ${balanced ? 'text-emerald-600' : 'text-amber-600'}`}>
            {balanced ? 'Balanced' : `Out of balance by ${fmtPlain(Math.abs(totalDr - totalCr))}`}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          The database enforces this too — an unbalanced entry is rejected at commit, not just here.
        </p>
      </div>
    </Modal>
  );
};

// ── Operations sync modal ───────────────────────────────────────────────────
const SyncModal = ({ open, onClose, fin, ops, onDone }) => {
  const toast = useToast();
  const [sources, setSources] = useState({ contributions: true, loans: true, repayments: true, shares: false });
  const [busy, setBusy] = useState(false);

  const proposals = useMemo(
    () => (open ? fin.previewOperations({ ...ops, sources }) : []),
    [open, fin, ops, sources]);

  const byGroup = useMemo(() => {
    const g = {};
    proposals.forEach((p) => { (g[p.group] = g[p.group] || []).push(p); });
    return g;
  }, [proposals]);

  const run = async () => {
    setBusy(true);
    try {
      const r = await fin.postOperations(proposals);
      toast.success(`${r.posted} entries posted${r.skipped ? `, ${r.skipped} already in the ledger` : ''}.`, 'Sync complete');
      if (r.failed.length > 0) toast.error(`${r.failed.length} could not be posted: ${r.failed[0].message}`, 'Some entries failed');
      onClose();
      onDone?.();
    } catch (e) { toast.error(e.message, 'Sync failed'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Post sacco activity to the ledger" wide
      footer={<>
        <GhostButton onClick={onClose}>Cancel</GhostButton>
        <PrimaryButton icon="Zap" onClick={run} disabled={busy || proposals.length === 0}>
          {busy ? 'Posting…' : `Post ${proposals.length} entr${proposals.length === 1 ? 'y' : 'ies'}`}
        </PrimaryButton>
      </>}>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Contributions, disbursements and repayments recorded elsewhere in the sacco dashboard are
          double-entered here. Each source row posts once — anything already in the ledger is skipped.
        </p>

        <div className="grid grid-cols-2 gap-2">
          {[
            { key: 'contributions', label: 'Contributions & savings' },
            { key: 'loans',         label: 'Loan disbursements' },
            { key: 'repayments',    label: 'Loan repayments (principal + interest)' },
            { key: 'shares',        label: 'Share holdings as opening share capital' },
          ].map((s) => (
            <label key={s.key} className="flex items-start gap-2 p-2.5 rounded-lg border border-border cursor-pointer hover:bg-muted text-sm">
              <input type="checkbox" className="mt-0.5 w-4 h-4 accent-primary" checked={sources[s.key]}
                onChange={(e) => setSources({ ...sources, [s.key]: e.target.checked })} />
              <span className="text-foreground">{s.label}</span>
            </label>
          ))}
        </div>

        {sources.shares && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
            <Icon name="AlertTriangle" size={14} color="#ca8a04" />
            <p className="text-xs text-amber-800">
              Share holdings are a snapshot, not a transaction log. This books each holding once as opening
              share capital — later changes need their own entry. Leave it off if members buy shares through
              a share-type contribution, or you will count the same money twice.
            </p>
          </div>
        )}

        {proposals.length === 0 ? (
          <EmptyState icon="CheckCircle2" title="Ledger is up to date" hint="Every recorded transaction from the selected sources is already posted." />
        ) : (
          <div className="border border-border rounded-lg max-h-72 overflow-y-auto">
            {Object.entries(byGroup).map(([group, list]) => (
              <div key={group}>
                <div className="px-3 py-2 bg-muted/50 text-xs font-semibold text-foreground uppercase sticky top-0">
                  {group} · {list.length} · {fmtPlain(list.reduce((s, p) => s + p.amount, 0))}
                </div>
                {list.slice(0, 60).map((p) => (
                  <div key={p.key} className="flex items-center justify-between gap-3 px-3 py-2 border-t border-border text-xs">
                    <div className="min-w-0">
                      <p className="text-foreground truncate">{p.description}</p>
                      <p className="text-muted-foreground font-mono">{p.templateCode} · {p.date}</p>
                    </div>
                    <span className="font-mono font-semibold text-foreground whitespace-nowrap">{fmtPlain(p.amount)}</span>
                  </div>
                ))}
                {list.length > 60 && (
                  <p className="px-3 py-2 border-t border-border text-xs text-muted-foreground">
                    …and {list.length - 60} more, all included.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};

// ── Main tab ────────────────────────────────────────────────────────────────
const JournalTab = ({ fin, ops, onLedgerChange }) => {
  const toast = useToast();
  const { entries, coa } = fin;

  const [modal, setModal]   = useState(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery]   = useState('');
  const [expanded, setExpanded] = useState({});

  const accountName = (code) => coa.find((a) => a.account_code === code)?.account_name || '';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (filter === 'manual'    && e.is_automated) return false;
      if (filter === 'automated' && !e.is_automated) return false;
      if (filter === 'reversed'  && e.status === 'posted') return false;
      if (!q) return true;
      const hay = `${e.entry_no} ${e.description} ${e.reference} ${e.template_code} ${e.member?.full_name || ''} ${(e.lines || []).map((l) => l.account_code).join(' ')}`;
      return hay.toLowerCase().includes(q);
    });
  }, [entries, filter, query]);

  const doReverse = async (entry) => {
    const reason = window.prompt(`Reverse ${entry.entry_no}?\n\nThe original stays in the ledger; a mirrored entry is posted in the current open period. Reason (optional):`);
    if (reason === null) return;
    try {
      await fin.reverseEntry(entry.id, reason || null);
      toast.success(`${entry.entry_no} reversed.`, 'Reversal posted');
      onLedgerChange?.();
    } catch (e) { toast.error(e.message, 'Could not reverse'); }
  };

  const totals = useMemo(() => ({
    count: entries.length,
    automated: entries.filter((e) => e.is_automated).length,
    reversed: entries.filter((e) => e.status === 'reversed').length,
    value: entries.filter((e) => e.status !== 'reversed' && e.status !== 'reversal')
      .reduce((s, e) => s + (Number(e.total_amount) || 0), 0),
  }), [entries]);

  return (
    <div className="space-y-5">
      <Card
        title="General journal"
        subtitle="§10.2 — every posting is balanced, dated into an open period, and reversible. Nothing is edited after the fact."
        actions={
          <div className="flex flex-wrap gap-2">
            <GhostButton icon="Zap" onClick={() => setModal('sync')}>Sync from operations</GhostButton>
            <GhostButton icon="BookOpen" onClick={() => setModal('manual')}>Manual entry</GhostButton>
            <PrimaryButton icon="Plus" onClick={() => setModal('template')}>Post a transaction</PrimaryButton>
          </div>
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Entries', value: totals.count, icon: 'BookOpen' },
            { label: 'Automated', value: totals.automated, icon: 'Zap' },
            { label: 'Reversed', value: totals.reversed, icon: 'Undo2' },
            { label: 'Posted value', value: fmtPlain(totals.value), icon: 'Coins' },
          ].map((k) => (
            <div key={k.label} className="p-3 rounded-lg border border-border">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon name={k.icon} size={12} color="currentColor" />{k.label}
              </div>
              <p className="text-lg font-bold text-foreground mt-0.5">{k.value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Icon name="Search" size={14} color="currentColor" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search entries, accounts, references…"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary" />
          </div>
          {[
            { id: 'all', label: 'All' }, { id: 'manual', label: 'Manual' },
            { id: 'automated', label: 'Automated' }, { id: 'reversed', label: 'Reversals' },
          ].map((t) => (
            <button key={t.id} onClick={() => setFilter(t.id)}
              className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all ${
                filter === t.id ? 'border-primary text-primary bg-primary/5' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon="BookOpen" title="No journal entries yet"
            hint="Post a transaction, or run Sync from operations to bring in contributions, disbursements and repayments already recorded in the sacco dashboard." />
        ) : (
          <div className="space-y-2">
            {filtered.slice(0, 300).map((e) => {
              const open = expanded[e.id];
              const isReversed = e.status === 'reversed';
              const isReversal = e.status === 'reversal';
              return (
                <div key={e.id} className={`border rounded-lg ${isReversed ? 'border-red-200 bg-red-50/40' : isReversal ? 'border-amber-200 bg-amber-50/40' : 'border-border'}`}>
                  <button onClick={() => setExpanded((s) => ({ ...s, [e.id]: !open }))}
                    className="w-full flex items-center gap-3 p-3 text-left">
                    <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={14} color="currentColor" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-muted-foreground">{e.entry_no}</span>
                        <span className="text-sm font-medium text-foreground truncate">{e.description}</span>
                        {e.is_automated && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-semibold uppercase">auto</span>}
                        {isReversed && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold uppercase">reversed</span>}
                        {isReversal && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold uppercase">reversal</span>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {fmtDate(e.entry_date)}
                        {e.template_code && ` · ${e.template_code}`}
                        {e.member?.full_name && ` · ${e.member.full_name}`}
                        {e.reference && ` · ref ${e.reference}`}
                      </p>
                    </div>
                    <span className="font-mono text-sm font-semibold text-foreground whitespace-nowrap">{fmtPlain(e.total_amount)}</span>
                  </button>

                  {open && (
                    <div className="px-3 pb-3 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-muted-foreground border-y border-border">
                            <th className="py-1.5 pr-3 font-medium">Account</th>
                            <th className="py-1.5 pr-3 font-medium text-right w-28">Debit</th>
                            <th className="py-1.5 font-medium text-right w-28">Credit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(e.lines || []).map((l) => (
                            <tr key={l.id} className="border-b border-border last:border-0">
                              <td className="py-1.5 pr-3">
                                <span className="font-mono text-foreground">{l.account_code}</span>
                                <span className="text-muted-foreground"> — {l.account_name || accountName(l.account_code)}</span>
                              </td>
                              <td className="py-1.5 pr-3 text-right font-mono">{Number(l.debit) > 0 ? fmtPlain(l.debit) : ''}</td>
                              <td className="py-1.5 text-right font-mono">{Number(l.credit) > 0 ? fmtPlain(l.credit) : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!isReversed && (
                        <div className="mt-2">
                          <GhostButton icon="Undo2" onClick={() => doReverse(e)}>Reverse this entry</GhostButton>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {filtered.length > 300 && (
              <p className="text-xs text-muted-foreground text-center py-2">Showing the 300 most recent of {filtered.length} matching entries.</p>
            )}
          </div>
        )}
      </Card>

      <TemplateModal open={modal === 'template'} onClose={() => setModal(null)} fin={fin} members={ops.members} onDone={onLedgerChange} />
      <ManualModal   open={modal === 'manual'}   onClose={() => setModal(null)} fin={fin} members={ops.members} onDone={onLedgerChange} />
      <SyncModal     open={modal === 'sync'}     onClose={() => setModal(null)} fin={fin} ops={ops} onDone={onLedgerChange} />
    </div>
  );
};

export default JournalTab;

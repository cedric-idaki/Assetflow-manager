/**
 * Chart of Accounts tab — §3.
 *
 * Shows the seeded 4-digit hierarchical chart grouped by class, with the live
 * balance of every account pulled from the trial balance, plus BOSA/FOSA
 * segment tags (§2.2) and the contra-account flags that make 1190 and 1390
 * behave correctly on the Balance Sheet.
 */
import React, { useMemo, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { useToast } from '../../../../components/Toast';
import {
  Card, PrimaryButton, GhostButton, Modal, Field,
  TextInput, Select, EmptyState,
} from '../../../sacco-dashboard/components/_shared';
import { ACCOUNT_CLASSES, SEGMENTS, classForCode } from '../../../../config/saccoAccountingConfig';
import { fmtPlain, indexTrialBalance } from '../../../../utils/saccoAccounting';

const SEG_TONE = {
  bosa:  'bg-sky-100 text-sky-700',
  fosa:  'bg-violet-100 text-violet-700',
  chama: 'bg-amber-100 text-amber-700',
  both:  'bg-slate-100 text-slate-600',
};

const ChartOfAccountsTab = ({ fin, trialBalanceRows, currency }) => {
  const toast = useToast();
  const { coa, addAccount, updateAccount, config } = fin;

  const [query, setQuery]       = useState('');
  const [klass, setKlass]       = useState('all');
  const [segment, setSegment]   = useState('all');
  const [showInactive, setShowInactive] = useState(false);
  const [open, setOpen]         = useState(false);
  const [busy, setBusy]         = useState(false);
  const [form, setForm]         = useState({
    account_code: '', account_name: '', account_class: 'asset',
    normal_balance: 'debit', segment: 'both', is_contra: false, notes: '',
  });

  const tb = useMemo(() => indexTrialBalance(trialBalanceRows || []), [trialBalanceRows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return coa.filter((a) => {
      if (!showInactive && !a.is_active) return false;
      if (klass !== 'all' && a.account_class !== klass) return false;
      if (segment !== 'all' && a.segment !== segment) return false;
      if (q && !(`${a.account_code} ${a.account_name}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [coa, query, klass, segment, showInactive]);

  const grouped = useMemo(() => {
    const g = {};
    filtered.forEach((a) => { (g[a.account_class] = g[a.account_class] || []).push(a); });
    return g;
  }, [filtered]);

  // Keep normal balance in step with the class the user picks.
  const setClass = (c) => {
    const cls = ACCOUNT_CLASSES.find((x) => x.id === c);
    setForm((f) => ({ ...f, account_class: c, normal_balance: cls?.normal || 'debit' }));
  };

  const onCodeChange = (code) => {
    const inferred = classForCode(code);
    setForm((f) => {
      if (!inferred || inferred === f.account_class) return { ...f, account_code: code };
      const cls = ACCOUNT_CLASSES.find((x) => x.id === inferred);
      return { ...f, account_code: code, account_class: inferred, normal_balance: cls?.normal || 'debit' };
    });
  };

  const submit = async () => {
    if (!/^\d{4,6}$/.test(String(form.account_code).trim())) {
      toast.error('Use a 4-digit code (6 for multi-branch/product sub-accounts).', 'Invalid code');
      return;
    }
    if (!form.account_name.trim()) { toast.error('Give the account a name.'); return; }
    setBusy(true);
    try {
      await addAccount(form);
      setOpen(false);
      setForm({ account_code: '', account_name: '', account_class: 'asset', normal_balance: 'debit', segment: 'both', is_contra: false, notes: '' });
      toast.success('Account added to the chart.');
    } catch (e) {
      toast.error(e.code === '23505' ? 'That account code already exists.' : e.message, 'Could not add account');
    } finally { setBusy(false); }
  };

  const toggle = async (a) => {
    try {
      await updateAccount(a.id, { is_active: !a.is_active });
      toast.success(`${a.account_code} ${a.is_active ? 'deactivated' : 'reactivated'}.`);
    } catch (e) { toast.error(e.message); }
  };

  const cur = currency || config?.base_currency || 'KES';

  return (
    <div className="space-y-5">
      {/* Class summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {ACCOUNT_CLASSES.map((c) => {
          const accounts = coa.filter((a) => a.account_class === c.id);
          const total = accounts.reduce((s, a) => s + (tb[a.account_code]?.balance || 0), 0);
          return (
            <button key={c.id} onClick={() => setKlass(klass === c.id ? 'all' : c.id)}
              className={`text-left p-3 rounded-xl border transition-all ${klass === c.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'}`}>
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="text-base font-bold text-foreground mt-0.5">{fmtPlain(total)}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{c.range} · {accounts.length} a/c</p>
            </button>
          );
        })}
      </div>

      <Card
        title="Chart of Accounts"
        subtitle="§3 — 4-digit hierarchical codes. The first digit is the account class; balances are live from the ledger."
        actions={<PrimaryButton icon="Plus" onClick={() => setOpen(true)}>Add account</PrimaryButton>}
      >
        <div className="flex flex-wrap gap-2 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Icon name="Search" size={14} color="currentColor" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search code or name…"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary" />
          </div>
          <Select value={klass} onChange={(e) => setKlass(e.target.value)}>
            <option value="all">All classes</option>
            {ACCOUNT_CLASSES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
          <Select value={segment} onChange={(e) => setSegment(e.target.value)}>
            <option value="all">All segments</option>
            {SEGMENTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
          <GhostButton icon={showInactive ? 'EyeOff' : 'Eye'} onClick={() => setShowInactive((v) => !v)}>
            {showInactive ? 'Hide inactive' : 'Show inactive'}
          </GhostButton>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon="Layers" title="No accounts match" hint="Clear the filters, or add an account of your own." />
        ) : (
          <div className="space-y-6">
            {ACCOUNT_CLASSES.filter((c) => grouped[c.id]?.length).map((c) => (
              <div key={c.id}>
                <div className="flex items-baseline gap-2 mb-2">
                  <h4 className="text-sm font-bold text-foreground">{c.label}</h4>
                  <span className="text-xs text-muted-foreground">{c.range} · normal balance {c.normal} · {c.statement}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b border-border">
                        <th className="py-2 pr-4 font-medium w-20">Code</th>
                        <th className="py-2 pr-4 font-medium">Account</th>
                        <th className="py-2 pr-4 font-medium w-24">Segment</th>
                        <th className="py-2 pr-4 font-medium text-right w-32">Debits</th>
                        <th className="py-2 pr-4 font-medium text-right w-32">Credits</th>
                        <th className="py-2 pr-4 font-medium text-right w-36">Balance ({cur})</th>
                        <th className="py-2 font-medium w-24" />
                      </tr>
                    </thead>
                    <tbody>
                      {grouped[c.id].map((a) => {
                        const row = tb[a.account_code];
                        return (
                          <tr key={a.id} className={`border-b border-border last:border-0 ${a.is_active ? '' : 'opacity-50'}`}>
                            <td className="py-2 pr-4 font-mono text-xs text-foreground">{a.account_code}</td>
                            <td className="py-2 pr-4">
                              <span className="text-foreground">{a.account_name}</span>
                              {a.is_contra && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-semibold uppercase">contra</span>}
                              {a.notes && <span className="block text-xs text-muted-foreground">{a.notes}</span>}
                            </td>
                            <td className="py-2 pr-4">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${SEG_TONE[a.segment] || SEG_TONE.both}`}>
                                {a.segment}
                              </span>
                            </td>
                            <td className="py-2 pr-4 text-right font-mono text-xs text-muted-foreground">{fmtPlain(row?.debit || 0)}</td>
                            <td className="py-2 pr-4 text-right font-mono text-xs text-muted-foreground">{fmtPlain(row?.credit || 0)}</td>
                            <td className="py-2 pr-4 text-right font-mono text-xs font-semibold text-foreground">{fmtPlain(row?.balance || 0)}</td>
                            <td className="py-2 text-right">
                              {!a.is_system && (
                                <button onClick={() => toggle(a)}
                                  className="text-xs text-muted-foreground hover:text-foreground underline">
                                  {a.is_active ? 'Deactivate' : 'Reactivate'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={open} onClose={() => setOpen(false)} title="Add an account"
        footer={<>
          <GhostButton onClick={() => setOpen(false)}>Cancel</GhostButton>
          <PrimaryButton icon="Plus" onClick={submit} disabled={busy}>{busy ? 'Adding…' : 'Add account'}</PrimaryButton>
        </>}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Account code">
              <TextInput value={form.account_code} onChange={(e) => onCodeChange(e.target.value)} placeholder="e.g. 1104" />
            </Field>
            <Field label="Class">
              <Select value={form.account_class} onChange={(e) => setClass(e.target.value)}>
                {ACCOUNT_CLASSES.map((c) => <option key={c.id} value={c.id}>{c.label} ({c.range})</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Account name">
            <TextInput value={form.account_name} onChange={(e) => setForm({ ...form, account_name: e.target.value })}
              placeholder="e.g. Loans to Members – Asset Finance" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Normal balance">
              <Select value={form.normal_balance} onChange={(e) => setForm({ ...form, normal_balance: e.target.value })}>
                <option value="debit">Debit</option>
                <option value="credit">Credit</option>
              </Select>
            </Field>
            <Field label="Segment">
              <Select value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })}>
                {SEGMENTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" className="w-4 h-4 accent-primary" checked={form.is_contra}
              onChange={(e) => setForm({ ...form, is_contra: e.target.checked })} />
            Contra account (nets against its class, like 1190 or 1390)
          </label>
          <Field label="Notes (optional)">
            <TextInput value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <p className="text-xs text-muted-foreground">
            The first digit must match the class: 1 assets, 2 liabilities, 3 equity, 4 income, 5 expenses, 9 memo.
          </p>
        </div>
      </Modal>
    </div>
  );
};

export default ChartOfAccountsTab;

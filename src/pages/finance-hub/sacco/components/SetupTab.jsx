/**
 * Setup tab — §9/§10.5 "Society Type" switch plus the by-law parameters that
 * drive the whole engine (reserve %, loanable-funds ceiling, deposit rate),
 * the §2.5 provisioning ladder and the §2.4 appropriation waterfall.
 *
 * Picking a society type flips the module switches of the §9 matrix; nothing
 * about the ledger core changes, which is the point of the specification.
 */
import React, { useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { useToast } from '../../../../components/Toast';
import {
  Card, StatCard, Badge, PrimaryButton, GhostButton, Field,
  TextInput, NumberInput, Select, Table, EmptyState,
} from '../../../sacco-dashboard/components/_shared';
import {
  SOCIETY_TYPES, SOCIETY_MATRIX, DIFFERENCES, societyType, APPROPRIATION_LABELS,
} from '../../../../config/saccoAccountingConfig';

const MODULE_LABELS = {
  share_capital_enabled:     'Share capital ledger',
  loan_book_enabled:         'Loan book',
  fosa_enabled:              'FOSA window (1011, 1103, 2012)',
  provisioning_enabled:      'Loan provisioning engine',
  statutory_reserve_enabled: 'Statutory reserve appropriation',
  dividends_enabled:         'Dividends & interest on deposits',
  sasra_returns_enabled:     'SASRA prudential returns',
  welfare_fund_enabled:      'Welfare fund & claims register',
  mgr_enabled:               'Merry-go-round cycles',
};

const Toggle = ({ label, checked, onChange, hint, disabled }) => (
  <label className={`flex items-start gap-3 p-3 rounded-lg border border-border ${disabled ? 'opacity-50' : 'cursor-pointer hover:bg-muted'}`}>
    <input type="checkbox" checked={!!checked} disabled={disabled}
      onChange={(e) => onChange(e.target.checked)} className="mt-0.5 w-4 h-4 accent-primary" />
    <span>
      <span className="block text-sm font-medium text-foreground">{label}</span>
      {hint && <span className="block text-xs text-muted-foreground mt-0.5">{hint}</span>}
    </span>
  </label>
);

const SetupTab = ({ fin }) => {
  const toast = useToast();
  const { config, coa, isSeeded, seedChart, saveConfig,
          provisionPolicy, appropriationRules, saveProvisionBand, saveAppropriationRule } = fin;

  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);
  const [bands, setBands] = useState({});
  const [rules, setRules] = useState({});

  const current = form || config || {};
  const type = societyType(current.society_type);
  const set = (patch) => setForm({ ...(form || config || {}), ...patch });

  const applySocietyType = (id) => {
    const t = societyType(id);
    set({ society_type: id, ...t.modules });
  };

  const doSeed = async () => {
    setBusy(true);
    try {
      await seedChart();
      toast.success('Chart of accounts, posting templates, provisioning ladder and appropriation rules created.', 'Ledger initialised');
    } catch (e) { toast.error(e.message, 'Could not initialise the ledger'); }
    finally { setBusy(false); }
  };

  const doSave = async () => {
    setBusy(true);
    try {
      await saveConfig({
        society_type: current.society_type,
        base_currency: current.base_currency || 'KES',
        fiscal_year_start_month: Number(current.fiscal_year_start_month) || 1,
        statutory_reserve_pct: Number(current.statutory_reserve_pct) || 0,
        loanable_funds_multiple: Number(current.loanable_funds_multiple) || 0,
        deposit_interest_rate_pct: Number(current.deposit_interest_rate_pct) || 0,
        dividend_rate_pct: Number(current.dividend_rate_pct) || 0,
        iod_rate_pct: Number(current.iod_rate_pct) || 0,
        ...Object.keys(MODULE_LABELS).reduce((m, k) => { m[k] = !!current[k]; return m; }, {}),
      });
      setForm(null);
      toast.success('Society configuration saved.', 'Saved');
    } catch (e) { toast.error(e.message, 'Save failed'); }
    finally { setBusy(false); }
  };

  const saveBand = async (band) => {
    const patch = bands[band.id];
    if (!patch) return;
    try {
      await saveProvisionBand(band.id, {
        min_days: Number(patch.min_days ?? band.min_days),
        max_days: patch.max_days === '' ? null : Number(patch.max_days ?? band.max_days),
        provision_pct: Number(patch.provision_pct ?? band.provision_pct),
      });
      setBands((b) => ({ ...b, [band.id]: undefined }));
      toast.success(`${band.classification} band updated.`);
    } catch (e) { toast.error(e.message); }
  };

  const saveRule = async (rule) => {
    const patch = rules[rule.id];
    if (!patch) return;
    try {
      await saveAppropriationRule(rule.id, {
        percent: Number(patch.percent ?? rule.percent),
        is_active: patch.is_active ?? rule.is_active,
      });
      setRules((r) => ({ ...r, [rule.id]: undefined }));
      toast.success(`${rule.name} updated.`);
    } catch (e) { toast.error(e.message); }
  };

  // ── Not initialised yet ────────────────────────────────────────────────────
  if (!isSeeded) {
    return (
      <div className="space-y-5">
        <Card title="Initialise the accounting ledger"
              subtitle="One click seeds everything the specification requires before a single transaction can be posted.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            {[
              { icon: 'Layers',    title: '74-account chart of accounts', body: '4-digit hierarchical codes: assets 1000s, liabilities 2000s, equity 3000s, income 4000s, expenses 5000s, memo 9000s — with BOSA/FOSA segment tags.' },
              { icon: 'GitBranch', title: '38 journal posting templates',  body: 'Every transaction type from the spec, as data. The UI never lets anyone pick a raw debit/credit pair.' },
              { icon: 'ShieldAlert', title: 'Provisioning ladder',         body: 'Performing → Watch → Substandard → Doubtful → Loss, with default SASRA-style provision percentages you can edit.' },
              { icon: 'Split',     title: 'Appropriation waterfall',       body: 'Statutory reserve first, then education, development and welfare funds, then dividends and interest on deposits.' },
            ].map((c) => (
              <div key={c.title} className="p-4 rounded-xl border border-border">
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon name={c.icon} size={16} color="#1da8c5" />
                  <p className="text-sm font-semibold text-foreground">{c.title}</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{c.body}</p>
              </div>
            ))}
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200 mb-4">
            <Icon name="Info" size={16} color="#ca8a04" />
            <p className="text-xs text-amber-800">
              Seeding is additive and safe to repeat — existing accounts are never overwritten.
              You can add your own accounts afterwards, and edit every percentage.
            </p>
          </div>
          <PrimaryButton icon="Sparkles" onClick={doSeed} disabled={busy}>
            {busy ? 'Initialising…' : 'Initialise ledger'}
          </PrimaryButton>
        </Card>
      </div>
    );
  }

  // ── Configured ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Society type"        value={type.short} icon="Landmark" hint={type.memberBase} />
        <StatCard label="Accounts in chart"   value={coa.length} icon="Layers" tone="success" hint={`${coa.filter((a) => a.is_active).length} active`} />
        <StatCard label="Statutory reserve"   value={`${Number(current.statutory_reserve_pct || 0)}%`} icon="Landmark" tone="warning" hint="of net surplus, before any distribution" />
        <StatCard label="Loanable funds cap"  value={`${Number(current.loanable_funds_multiple || 0)}×`} icon="Scale" tone="muted" hint="of members' shares + savings" />
      </div>

      {/* Society type */}
      <Card title="Society type" subtitle="§9 — one configurable ledger core; the type switches modules on and off, it does not change the accounting.">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {SOCIETY_TYPES.map((t) => {
            const active = current.society_type === t.id;
            return (
              <button key={t.id} onClick={() => applySocietyType(t.id)}
                className={`text-left p-4 rounded-xl border transition-all ${active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'}`}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm font-semibold text-foreground">{t.label}</span>
                  {active && <Icon name="CheckCircle2" size={16} color="#1da8c5" />}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{t.blurb}</p>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Modules + by-law parameters */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Active modules" subtitle="Selecting a society type sets these; override any of them for your by-laws.">
          <div className="space-y-2">
            {Object.entries(MODULE_LABELS).map(([key, label]) => (
              <Toggle key={key} label={label} checked={current[key]}
                onChange={(v) => set({ [key]: v })} />
            ))}
          </div>
        </Card>

        <Card title="By-law parameters" subtitle="§2.4 — rates are configuration, never hard-coded percentages.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Base currency">
              <TextInput value={current.base_currency || 'KES'} onChange={(e) => set({ base_currency: e.target.value })} />
            </Field>
            <Field label="Fiscal year starts">
              <Select value={current.fiscal_year_start_month || 1} onChange={(e) => set({ fiscal_year_start_month: e.target.value })}>
                {['January','February','March','April','May','June','July','August','September','October','November','December']
                  .map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </Select>
            </Field>
            <Field label="Statutory reserve % of surplus">
              <NumberInput step="0.1" value={current.statutory_reserve_pct ?? 20} onChange={(e) => set({ statutory_reserve_pct: e.target.value })} />
            </Field>
            <Field label="Loanable funds multiple (× shares + savings)">
              <NumberInput step="0.1" value={current.loanable_funds_multiple ?? 3} onChange={(e) => set({ loanable_funds_multiple: e.target.value })} />
            </Field>
            <Field label="Deposit interest rate % p.a.">
              <NumberInput step="0.1" value={current.deposit_interest_rate_pct ?? 0} onChange={(e) => set({ deposit_interest_rate_pct: e.target.value })} />
            </Field>
            <Field label="Target dividend rate % on shares">
              <NumberInput step="0.1" value={current.dividend_rate_pct ?? 0} onChange={(e) => set({ dividend_rate_pct: e.target.value })} />
            </Field>
          </div>
          <div className="flex gap-2 mt-4">
            <PrimaryButton icon="Save" onClick={doSave} disabled={busy || !form}>
              {busy ? 'Saving…' : 'Save configuration'}
            </PrimaryButton>
            {form && <GhostButton icon="RotateCcw" onClick={() => setForm(null)}>Discard changes</GhostButton>}
          </div>
        </Card>
      </div>

      {/* Provisioning ladder */}
      <Card title="Loan classification & provisioning ladder"
            subtitle="§2.5 — aging buckets and the provision each carries. The period-end batch job applies these automatically.">
        {provisionPolicy.length === 0 ? (
          <EmptyState icon="ShieldAlert" title="No provisioning bands" hint="Re-run ledger initialisation to seed the default ladder." />
        ) : (
          <Table columns={['Classification', 'Days in arrears from', 'to', 'Provision %', '']}>
            {provisionPolicy.map((b) => {
              const p = bands[b.id] || {};
              const dirty = !!bands[b.id];
              return (
                <tr key={b.id} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4"><Badge status={b.classification} /></td>
                  <td className="py-2 pr-4 w-32">
                    <NumberInput value={p.min_days ?? b.min_days}
                      onChange={(e) => setBands((s) => ({ ...s, [b.id]: { ...p, min_days: e.target.value } }))} />
                  </td>
                  <td className="py-2 pr-4 w-32">
                    <NumberInput placeholder="open-ended" value={p.max_days ?? (b.max_days ?? '')}
                      onChange={(e) => setBands((s) => ({ ...s, [b.id]: { ...p, max_days: e.target.value } }))} />
                  </td>
                  <td className="py-2 pr-4 w-32">
                    <NumberInput step="0.1" value={p.provision_pct ?? b.provision_pct}
                      onChange={(e) => setBands((s) => ({ ...s, [b.id]: { ...p, provision_pct: e.target.value } }))} />
                  </td>
                  <td className="py-2">
                    {dirty && <GhostButton icon="Check" onClick={() => saveBand(b)}>Save</GhostButton>}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {/* Appropriation waterfall */}
      <Card title="Surplus appropriation waterfall"
            subtitle="§2.4 — applied in order at year-end. Statutory reserve is taken before any dividend or interest-on-deposits payout can occur.">
        {appropriationRules.length === 0 ? (
          <EmptyState icon="Split" title="No appropriation rules" hint="Re-run ledger initialisation to seed the default waterfall." />
        ) : (
          <Table columns={['#', 'Appropriation', 'Credited to', '% of net surplus', 'Active', '']}>
            {appropriationRules.map((r) => {
              const p = rules[r.id] || {};
              const dirty = !!rules[r.id];
              return (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4 text-muted-foreground">{r.sort_order}</td>
                  <td className="py-2 pr-4">
                    <span className="font-medium text-foreground">{APPROPRIATION_LABELS[r.rule_type] || r.name}</span>
                    {r.is_mandatory && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold">mandatory</span>}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{r.target_account}</td>
                  <td className="py-2 pr-4 w-32">
                    <NumberInput step="0.1" value={p.percent ?? r.percent}
                      onChange={(e) => setRules((s) => ({ ...s, [r.id]: { ...p, percent: e.target.value } }))} />
                  </td>
                  <td className="py-2 pr-4">
                    <input type="checkbox" className="w-4 h-4 accent-primary"
                      checked={p.is_active ?? r.is_active}
                      onChange={(e) => setRules((s) => ({ ...s, [r.id]: { ...p, is_active: e.target.checked } }))} />
                  </td>
                  <td className="py-2">
                    {dirty && <GhostButton icon="Check" onClick={() => saveRule(r)}>Save</GhostButton>}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {/* Reference matrices */}
      <Card title="Configuration matrix" subtitle="§9 — what each society type turns on.">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-2 pr-4 font-medium">Module</th>
                {SOCIETY_TYPES.map((t) => (
                  <th key={t.id} className={`py-2 pr-4 font-medium whitespace-nowrap ${current.society_type === t.id ? 'text-primary' : ''}`}>
                    {t.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SOCIETY_MATRIX.map((row) => (
                <tr key={row.module} className="border-b border-border last:border-0 align-top">
                  <td className="py-2 pr-4 font-medium text-foreground whitespace-nowrap">{row.module}</td>
                  {SOCIETY_TYPES.map((t) => (
                    <td key={t.id} className={`py-2 pr-4 ${current.society_type === t.id ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                      {row[t.id]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Why this is not a normal accounting system"
            subtitle="§8 — the defaults that commercial packages get wrong for a co-operative.">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-2 pr-4 font-medium">Aspect</th>
                <th className="py-2 pr-4 font-medium">Normal business system</th>
                <th className="py-2 pr-4 font-medium">This system</th>
              </tr>
            </thead>
            <tbody>
              {DIFFERENCES.map((d) => (
                <tr key={d.aspect} className="border-b border-border last:border-0 align-top">
                  <td className="py-2 pr-4 font-medium text-foreground whitespace-nowrap">{d.aspect}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{d.normal}</td>
                  <td className="py-2 pr-4 text-foreground">{d.sacco}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default SetupTab;

/**
 * Period Close tab — §10.4, as a guided workflow.
 *
 *   1. Interest accrual (loans and deposits)
 *   2. Loan aging & provisioning
 *   3. Depreciation / amortisation
 *   4. Reconcile bank and mobile-money control accounts
 *   5. Trial balance review
 *   6. Lock the period
 *   7. Generate the statements
 *   8. Year-end only: the appropriation waterfall
 *
 * The batch jobs each write their own auditable journal entry batch — balances
 * are never silently adjusted. Each job posts once per period; reverse its entry
 * on the Journal tab to re-run it.
 */
import React, { useMemo, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { useToast } from '../../../../components/Toast';
import {
  Card, StatCard, Badge, PrimaryButton, GhostButton, Modal, Field,
  TextInput, NumberInput, Select, EmptyState, Table, fmtDate,
} from '../../../sacco-dashboard/components/_shared';
import { CLOSE_CHECKLIST, CLASSIFICATION_TONES } from '../../../../config/saccoAccountingConfig';
import { fmtPlain, round2 } from '../../../../utils/saccoAccounting';

const JOB_META = {
  accrual:       { icon: 'Percent',     title: 'Interest accrual' },
  provisioning:  { icon: 'ShieldAlert', title: 'Loan aging & provisioning' },
  depreciation:  { icon: 'Building2',   title: 'Depreciation & amortisation' },
  lock:          { icon: 'Lock',        title: 'Lock the period' },
  appropriation: { icon: 'Split',       title: 'Appropriation waterfall' },
};

const AssetModal = ({ open, onClose, fin, onDone }) => {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    asset_name: '', gl_code: '1310', acquisition_date: new Date().toISOString().slice(0, 10),
    cost: '', residual_value: '', useful_life_years: 4, method: 'straight_line', paid_from: '1020',
  });

  const submit = async () => {
    if (!f.asset_name.trim()) { toast.error('Name the asset.'); return; }
    if (!(round2(f.cost) > 0)) { toast.error('Enter the acquisition cost.'); return; }
    setBusy(true);
    try {
      await fin.addFixedAsset(f);
      toast.success('Asset registered and the purchase posted to the ledger.');
      setF({ ...f, asset_name: '', cost: '', residual_value: '' });
      onClose();
      onDone?.();
    } catch (e) { toast.error(e.message, 'Could not register the asset'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Register a fixed asset"
      footer={<>
        <GhostButton onClick={onClose}>Cancel</GhostButton>
        <PrimaryButton icon="Plus" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Register asset'}</PrimaryButton>
      </>}>
      <div className="space-y-3">
        <Field label="Asset name">
          <TextInput value={f.asset_name} onChange={(e) => setF({ ...f, asset_name: e.target.value })} placeholder="e.g. Branch office desktop computers" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Asset account">
            <Select value={f.gl_code} onChange={(e) => setF({ ...f, gl_code: e.target.value })}>
              <option value="1300">1300 — Land and Buildings</option>
              <option value="1310">1310 — Furniture, Fittings & Equipment</option>
              <option value="1320">1320 — Computers & IT Equipment</option>
              <option value="1330">1330 — Motor Vehicles</option>
              <option value="1400">1400 — Intangible Assets / Software</option>
            </Select>
          </Field>
          <Field label="Paid from">
            <Select value={f.paid_from} onChange={(e) => setF({ ...f, paid_from: e.target.value })}>
              <option value="1020">1020 — Bank Operations Account</option>
              <option value="1010">1010 — Cash in Hand (BOSA)</option>
              <option value="1021">1021 — Bank Mobile Money</option>
              <option value="2300">2300 — Trade & Sundry Creditors (on credit)</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Acquisition date"><TextInput type="date" value={f.acquisition_date} onChange={(e) => setF({ ...f, acquisition_date: e.target.value })} /></Field>
          <Field label="Cost"><NumberInput step="0.01" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Residual value"><NumberInput step="0.01" value={f.residual_value} onChange={(e) => setF({ ...f, residual_value: e.target.value })} /></Field>
          <Field label="Useful life (years)"><NumberInput step="0.5" value={f.useful_life_years} onChange={(e) => setF({ ...f, useful_life_years: e.target.value })} /></Field>
          <Field label="Method">
            <Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
              <option value="straight_line">Straight line</option>
              <option value="reducing">Reducing balance</option>
            </Select>
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Registering the asset also posts the purchase (Dr asset account / Cr the source of funds).
          The depreciation batch job charges 5400 (or 5410 for intangibles) each period.
        </p>
      </div>
    </Modal>
  );
};

const PeriodsTab = ({ fin, ops, netSurplusForPeriod, onLedgerChange }) => {
  const toast = useToast();
  const { periods, config, fixedAssets, ensurePeriods, closePeriod, reopenPeriod, setChecklistItem, entries } = fin;
  const cur = config?.base_currency || 'KES';

  const [selectedId, setSelectedId] = useState(null);
  const [busyJob, setBusyJob] = useState(null);
  const [result, setResult] = useState(null);
  const [assetModal, setAssetModal] = useState(false);

  const period = useMemo(
    () => periods.find((p) => p.id === selectedId) || periods.find((p) => p.status === 'open') || periods[0] || null,
    [periods, selectedId]);

  const checklist = period?.checklist || {};

  // A job that already produced an entry for this period is shown as done.
  const jobEntry = (batchPrefix) => entries.find(
    (e) => e.batch_ref?.startsWith(`${batchPrefix}:${period?.id}`) && e.status !== 'reversed');

  const jobDone = {
    accrual:       !!jobEntry('accrual'),
    provisioning:  !!jobEntry('provisioning'),
    depreciation:  !!jobEntry('depreciation'),
    appropriation: !!jobEntry('appropriation'),
    lock:          period?.status === 'closed',
  };

  const runJob = async (job) => {
    if (!period) return;
    setBusyJob(job);
    setResult(null);
    try {
      if (job === 'accrual') {
        const r = await fin.runAccrualJob({
          period, loans: ops.loans, schedules: ops.schedules, contributions: ops.contributions,
        });
        setResult({ job, data: r });
        toast.success(
          `Loan interest ${cur} ${fmtPlain(r.loanInterest)} · deposit interest ${cur} ${fmtPlain(r.depositInterest)}`,
          'Accrual posted');
      } else if (job === 'provisioning') {
        const r = await fin.runProvisioningJob({ period, loans: ops.loans, schedules: ops.schedules });
        setResult({ job, data: r });
        toast.success(
          `Required provision ${cur} ${fmtPlain(r.requiredProvision)}; movement posted ${cur} ${fmtPlain(r.movement)}`,
          'Provisioning complete');
      } else if (job === 'depreciation') {
        const r = await fin.runDepreciationJob({ period });
        setResult({ job, data: r });
        toast.success(
          `Depreciation ${cur} ${fmtPlain(r.depreciation)} · amortisation ${cur} ${fmtPlain(r.amortisation)}`,
          'Depreciation posted');
      } else if (job === 'appropriation') {
        const r = await fin.runAppropriationJob({ period, netSurplus: netSurplusForPeriod });
        setResult({ job, data: r });
        toast.success(
          `${r.posted.length} appropriations posted; ${cur} ${fmtPlain(r.availableForDistribution)} available for distribution`,
          'Appropriation complete');
      } else if (job === 'lock') {
        await closePeriod(period.id);
        toast.success(`${period.label} is locked. Corrections now need a reversing entry in an open period.`, 'Period closed');
      }
      await setChecklistItem(period.id, job, true);
      onLedgerChange?.();
    } catch (e) {
      const dup = e?.code === '23505' || /duplicate key/i.test(e?.message || '');
      toast.error(dup
        ? 'This job has already run for the period. Reverse its journal entry first if you need to re-run it.'
        : e.message, 'Job failed');
    } finally { setBusyJob(null); }
  };

  const addYear = async () => {
    const y = new Date().getFullYear();
    try {
      await ensurePeriods(y);
      toast.success(`Monthly periods created for ${y}.`);
    } catch (e) { toast.error(e.message); }
  };

  const totalFixedAssets = round2(fixedAssets.reduce((s, a) => s + (Number(a.cost) || 0), 0));
  const totalAccumDepn   = round2(fixedAssets.reduce((s, a) => s + (Number(a.accumulated_depreciation) || 0), 0));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Periods"      value={periods.length} icon="CalendarDays" hint={`${periods.filter((p) => p.status === 'open').length} open`} />
        <StatCard label="Current period" value={period?.label || '—'} icon="Calendar" tone="success" hint={period ? `${fmtDate(period.start_date)} – ${fmtDate(period.end_date)}` : ''} />
        <StatCard label="Fixed assets at cost" value={fmtPlain(totalFixedAssets)} icon="Building2" tone="muted" hint={`${fixedAssets.length} in the register`} />
        <StatCard label="Accumulated depreciation" value={fmtPlain(totalAccumDepn)} icon="TrendingDown" tone="warning" hint="credited to 1390" />
      </div>

      <Card
        title="Accounting periods"
        subtitle="§10.2 — postings into a closed period are rejected by the database, not just by the UI."
        actions={<GhostButton icon="CalendarPlus" onClick={addYear}>Create this year's periods</GhostButton>}
      >
        {periods.length === 0 ? (
          <EmptyState icon="CalendarDays" title="No periods yet"
            hint="Periods are created automatically when you post, or create a full year up front." />
        ) : (
          <div className="flex flex-wrap gap-2">
            {periods.slice(0, 36).map((p) => (
              <button key={p.id} onClick={() => { setSelectedId(p.id); setResult(null); }}
                className={`px-3 py-2 rounded-lg text-sm border transition-all ${
                  period?.id === p.id ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
                <span className="font-medium">{p.label}</span>
                <span className="ml-2 text-[10px] uppercase font-semibold">
                  {p.status === 'closed' ? '🔒 closed' : 'open'}
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {period && (
        <Card
          title={`Period-end close — ${period.label}`}
          subtitle="§10.4 — work down the list. Each batch job posts its own auditable journal entries."
          actions={period.status === 'closed'
            ? <GhostButton icon="Unlock" onClick={async () => {
                try { await reopenPeriod(period.id); toast.success(`${period.label} reopened.`); }
                catch (e) { toast.error(e.message); }
              }}>Reopen period</GhostButton>
            : <Badge status="open" />}
        >
          <div className="space-y-2">
            {CLOSE_CHECKLIST.map((step, i) => {
              const done = step.job ? (jobDone[step.job] || !!checklist[step.job]) : !!checklist[step.id];
              const meta = step.job ? JOB_META[step.job] : null;
              const isYearEnd = step.job === 'appropriation';
              return (
                <div key={step.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border ${done ? 'border-emerald-200 bg-emerald-50/40' : 'border-border'}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                    done ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground'}`}>
                    {done ? '✓' : i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{step.label}</p>
                    {meta && <p className="text-xs text-muted-foreground mt-0.5">{meta.title}</p>}
                  </div>
                  <div className="flex-shrink-0">
                    {step.job ? (
                      <GhostButton
                        icon={meta?.icon || 'Play'}
                        disabled={busyJob === step.job || (period.status === 'closed' && step.job !== 'lock')}
                        onClick={() => runJob(step.job)}
                      >
                        {busyJob === step.job ? 'Running…' : done ? 'Run again' : (isYearEnd ? 'Run at year-end' : 'Run')}
                      </GhostButton>
                    ) : (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                        <input type="checkbox" className="w-4 h-4 accent-primary" checked={!!checklist[step.id]}
                          onChange={(e) => setChecklistItem(period.id, step.id, e.target.checked)} />
                        Mark done
                      </label>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Last job result */}
          {result?.job === 'provisioning' && (
            <div className="mt-4 p-4 rounded-lg border border-border">
              <p className="text-sm font-semibold text-foreground mb-2">Provisioning result</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                {[
                  ['Gross portfolio', result.data.grossPortfolio],
                  ['Portfolio at risk', result.data.portfolioAtRisk],
                  ['Required provision', result.data.requiredProvision],
                  ['Movement posted', result.data.movement],
                ].map(([l, v]) => (
                  <div key={l}>
                    <p className="text-xs text-muted-foreground">{l}</p>
                    <p className="text-sm font-bold text-foreground font-mono">{fmtPlain(v)}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mb-2">PAR ratio {result.data.parRatio}%</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(result.data.byClass).map(([cls, b]) => (
                  <span key={cls} className={`text-xs px-2 py-1 rounded-full font-medium capitalize ${CLASSIFICATION_TONES[cls] || 'bg-slate-100 text-slate-600'}`}>
                    {cls}: {b.count} · {fmtPlain(b.outstanding)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {result?.job === 'appropriation' && (
            <div className="mt-4 p-4 rounded-lg border border-border">
              <p className="text-sm font-semibold text-foreground mb-2">Appropriation of net surplus</p>
              <Table columns={['Appropriation', '%', 'Amount', 'Credited to']}>
                {result.data.lines.map((l) => (
                  <tr key={l.ruleType} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-4 text-foreground">{l.name}</td>
                    <td className="py-1.5 pr-4 font-mono text-xs">{l.percent}%</td>
                    <td className="py-1.5 pr-4 font-mono text-xs font-semibold">{fmtPlain(l.amount)}</td>
                    <td className="py-1.5 font-mono text-xs text-muted-foreground">{l.targetAccount}</td>
                  </tr>
                ))}
              </Table>
              <div className="flex justify-between mt-3 pt-3 border-t border-border text-sm font-bold">
                <span className="text-foreground">Surplus available for distribution</span>
                <span className="font-mono text-foreground">{cur} {fmtPlain(result.data.availableForDistribution)}</span>
              </div>
            </div>
          )}

          {result?.job === 'depreciation' && result.data.rows.length > 0 && (
            <div className="mt-4 p-4 rounded-lg border border-border">
              <p className="text-sm font-semibold text-foreground mb-2">Depreciation charged</p>
              <Table columns={['Asset', 'Account', 'Net book value', 'Charge']}>
                {result.data.rows.map((r) => (
                  <tr key={r.assetId} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-4 text-foreground">{r.assetName}</td>
                    <td className="py-1.5 pr-4 font-mono text-xs text-muted-foreground">{r.glCode}</td>
                    <td className="py-1.5 pr-4 font-mono text-xs">{fmtPlain(r.nbv)}</td>
                    <td className="py-1.5 font-mono text-xs font-semibold">{fmtPlain(r.charge)}</td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      )}

      {/* Fixed asset register */}
      <Card
        title="Fixed asset register"
        subtitle="Feeds the depreciation batch job and the Property, Plant & Equipment line of the Balance Sheet."
        actions={<PrimaryButton icon="Plus" onClick={() => setAssetModal(true)}>Register asset</PrimaryButton>}
      >
        {fixedAssets.length === 0 ? (
          <EmptyState icon="Building2" title="No fixed assets registered"
            hint="Register premises, furniture, computers, vehicles or capitalised software to start charging depreciation." />
        ) : (
          <Table columns={['Asset', 'Account', 'Acquired', 'Cost', 'Accum. depn', 'Net book value', 'Life', 'Method']}>
            {fixedAssets.map((a) => (
              <tr key={a.id} className="border-b border-border last:border-0">
                <td className="py-2 pr-4 text-foreground">{a.asset_name}</td>
                <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{a.gl_code}</td>
                <td className="py-2 pr-4 text-xs">{fmtDate(a.acquisition_date)}</td>
                <td className="py-2 pr-4 font-mono text-xs">{fmtPlain(a.cost)}</td>
                <td className="py-2 pr-4 font-mono text-xs">{fmtPlain(a.accumulated_depreciation)}</td>
                <td className="py-2 pr-4 font-mono text-xs font-semibold">{fmtPlain((Number(a.cost) || 0) - (Number(a.accumulated_depreciation) || 0))}</td>
                <td className="py-2 pr-4 text-xs">{Number(a.useful_life_years)}y</td>
                <td className="py-2 text-xs capitalize">{String(a.method || '').replace('_', ' ')}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <AssetModal open={assetModal} onClose={() => setAssetModal(false)} fin={fin} onDone={onLedgerChange} />
    </div>
  );
};

export default PeriodsTab;

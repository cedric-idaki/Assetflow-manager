/**
 * SACCO / CHAMA FINANCE HUB
 *
 * The Finance Hub as seen by a sacco_admin. Implements the "SACCO / Chama
 * Financial Accounting System" specification end to end: a configurable
 * fund-accounting ledger core producing a statutory Income Statement, Balance
 * Sheet and Cash Flow Statement for a deposit-taking SACCO, a BOSA-only SACCO,
 * or any Chama variant.
 *
 * Companies are NOT affected — src/pages/finance-hub/index.jsx routes them to
 * the original company hub, which reads entirely different tables.
 *
 * The member roster comes from SaccoDashboardContext, which holds it in full.
 * The operational LEDGERS (contributions, loans, schedules, shares) are read
 * here instead, complete — the dashboard caps those arrays for display, and a
 * display cap must never become the input to double-entry bookkeeping. See the
 * ops loader below. The accounting tables come from useSaccoFinance.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import MainLayout from '../../../layouts/MainLayout';
import Icon from '../../../components/AppIcon';
import { useAuth } from '../../../contexts/AuthContext';
import { useSaccoDashboardContext } from '../../../contexts/SaccoDashboardContext';
import { supabase } from '../../../lib/supabase';
import { fetchAllRows } from '../../../lib/fetchAllRows';
import { useSaccoFinance } from '../../../hooks/useSaccoFinance';
import { societyType } from '../../../config/saccoAccountingConfig';
import {
  indexTrialBalance, classTotal, netSurplusOf, sumBalances, fmtPlain, monthBounds, dayBefore,
} from '../../../utils/saccoAccounting';

import SetupTab            from './components/SetupTab';
import ChartOfAccountsTab  from './components/ChartOfAccountsTab';
import JournalTab          from './components/JournalTab';
import LedgerTab           from './components/LedgerTab';
import PeriodsTab          from './components/PeriodsTab';
import StatementsTab       from './components/StatementsTab';
import ChamaTab            from './components/ChamaTab';

const Sk = ({ className = '' }) => <div className={`animate-pulse bg-muted rounded-lg ${className}`} />;

/** Tabs whose figures are derived from `ops` — see the ops loader below. */
const OPS_TABS = ['ledger', 'journal', 'periods', 'chama'];

const Tab = ({ active, label, icon, badge, onClick }) => (
  <button onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border ${
      active ? 'border-primary/40 text-primary' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted'}`}
    style={active ? { background: 'rgba(52,193,221,0.10)' } : {}}>
    <Icon name={icon} size={15} color="currentColor" />
    {label}
    {badge > 0 && (
      <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-xs font-bold">{badge}</span>
    )}
  </button>
);

const KPI = ({ title, value, icon, iconBg, iconColor, hint, loading }) => (
  <div className="bg-card border border-border rounded-xl p-4">
    <div className="flex items-start justify-between gap-2">
      <p className="text-xs text-muted-foreground">{title}</p>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg}`}>
        <Icon name={icon} size={15} color={iconColor} />
      </div>
    </div>
    {loading ? <Sk className="h-6 w-24 mt-2" /> : <p className="text-lg font-bold text-foreground mt-1.5 font-mono">{value}</p>}
    {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
  </div>
);

const SaccoFinanceHub = () => {
  const { userProfile, getRoleRedirectPath } = useAuth();
  const navigate = useNavigate();
  const sc = useSaccoDashboardContext();
  const { sacco, members } = sc;

  const fin = useSaccoFinance(sacco);

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'statements';
  const setActiveTab = (tab) => setSearchParams({ tab }, { replace: true });

  // Reporting range — defaults to the current month, like a period-end close.
  const bounds = useMemo(() => monthBounds(new Date()), []);
  const [range, setRange] = useState({ from: bounds.start, to: bounds.end });

  // Four trial balances drive everything: movements in the period, cumulative
  // opening and closing positions, and the comparative prior period.
  const [tbPeriod,  setTbPeriod]  = useState([]);
  const [tbOpening, setTbOpening] = useState([]);
  const [tbClosing, setTbClosing] = useState([]);
  const [tbPrior,   setTbPrior]   = useState([]);
  const [tbLoading, setTbLoading] = useState(true);

  const loadTrialBalances = useCallback(async () => {
    if (!fin.isSeeded) { setTbLoading(false); return; }
    setTbLoading(true);
    try {
      const priorFrom = (() => {
        const d = new Date(range.from); d.setMonth(d.getMonth() - 1);
        return d.toISOString().slice(0, 10);
      })();
      const [p, o, c, pr] = await Promise.all([
        fin.trialBalance(range.from, range.to),
        fin.trialBalance(null, dayBefore(range.from)),
        fin.trialBalance(null, range.to),
        fin.trialBalance(priorFrom, dayBefore(range.from)),
      ]);
      setTbPeriod(p); setTbOpening(o); setTbClosing(c); setTbPrior(pr);
    } catch (_) {
      setTbPeriod([]); setTbOpening([]); setTbClosing([]); setTbPrior([]);
    } finally { setTbLoading(false); }
  }, [fin.isSeeded, fin.trialBalance, range.from, range.to]);

  useEffect(() => { loadTrialBalances(); }, [loadTrialBalances]);

  const periodMap  = useMemo(() => indexTrialBalance(tbPeriod),  [tbPeriod]);
  const openingMap = useMemo(() => indexTrialBalance(tbOpening), [tbOpening]);
  const closingMap = useMemo(() => indexTrialBalance(tbClosing), [tbClosing]);
  const priorMap   = useMemo(() => indexTrialBalance(tbPrior),   [tbPrior]);

  const netSurplus = useMemo(() => netSurplusOf(periodMap), [periodMap]);
  const type = societyType(fin.config?.society_type);
  const cur  = fin.config?.base_currency || 'KES';

  /**
   * The operational data the accounting side runs on — read IN FULL.
   *
   * This used to be the sacco dashboard's arrays, which are capped for display.
   * Everything downstream of `ops` is bookkeeping, and every one of them was
   * silently working from the newest rows only:
   *
   *   • PeriodsTab's accrual and provisioning jobs POST journal entries from
   *     these numbers, so the amounts written into the books were understated.
   *   • LedgerTab reconciles control accounts against a member sub-ledger built
   *     from them, so the comparison could show a discrepancy that is not real
   *     — or hide one that is.
   *   • The operations sync only proposes postings for rows it can see, so
   *     anything older than the cap could never be posted at all.
   *
   * A display cap is a reasonable trade. Capping the inputs to double-entry
   * bookkeeping is not, so the finance hub pays for completeness up front and
   * shows a loading state until it has everything.
   *
   * `members` still comes from the context: that roster is already uncapped,
   * and every other tab shares it.
   */
  const [opsRows, setOpsRows] = useState(null);
  const [opsError, setOpsError] = useState(null);

  useEffect(() => {
    if (!sacco?.id) return undefined;
    let cancelled = false;
    setOpsError(null);

    (async () => {
      try {
        const [contributionRows, loanRows, scheduleRows, shareRows] = await Promise.all([
          fetchAllRows(() => supabase.from('sacco_contributions')
            .select('*, member:sacco_members(id, full_name, member_no)')),
          fetchAllRows(() => supabase.from('sacco_loans')
            .select('*, member:sacco_members(id, full_name, member_no), product:sacco_loan_products(name)')),
          fetchAllRows(() => supabase.from('sacco_loan_schedule').select('*')),
          fetchAllRows(() => supabase.from('sacco_shares')
            .select('*, member:sacco_members(id, full_name, member_no)')),
        ]);
        if (!cancelled) {
          setOpsRows({
            contributions: contributionRows,
            loans: loanRows,
            schedules: scheduleRows,
            shares: shareRows,
          });
        }
      } catch (e) {
        if (!cancelled) { setOpsRows(null); setOpsError(e?.message || 'Could not read the sacco ledgers.'); }
      }
    })();

    return () => { cancelled = true; };
  }, [sacco?.id]);

  const opsLoading = !!sacco?.id && !opsRows && !opsError;
  const opsReady   = !opsLoading && !opsError;

  const ops = useMemo(() => ({
    members:       members || [],
    contributions: opsRows?.contributions || [],
    loans:         opsRows?.loans || [],
    schedules:     opsRows?.schedules || [],
    shares:        opsRows?.shares || [],
  }), [members, opsRows]);

  const refreshAll = useCallback(async () => {
    await Promise.all([fin.refetch(), loadTrialBalances()]);
  }, [fin, loadTrialBalances]);

  const handleClose = () => navigate(getRoleRedirectPath(userProfile?.role));

  const tabs = [
    { id: 'statements', label: 'Financial Statements', icon: 'BarChart2' },
    { id: 'ledger',     label: 'Trial Balance & Members', icon: 'Scale' },
    { id: 'journal',    label: 'Journal',              icon: 'BookOpen' },
    { id: 'coa',        label: 'Chart of Accounts',    icon: 'Layers' },
    { id: 'periods',    label: 'Period Close',         icon: 'CalendarCheck' },
    ...((fin.config?.mgr_enabled || fin.config?.welfare_fund_enabled)
      ? [{ id: 'chama', label: 'Chama Registers', icon: 'Users' }] : []),
    { id: 'setup',      label: 'Setup',                icon: 'Settings' },
  ];

  if (fin.error) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center min-h-64 gap-4">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <Icon name="AlertCircle" size={20} color="#ef4444" />
          </div>
          <p className="text-sm font-medium text-foreground">The accounting ledger failed to load</p>
          <p className="text-xs text-muted-foreground">{fin.error}</p>
          <button onClick={fin.refetch}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #34c1dd, #1da8c5)' }}>
            <Icon name="RefreshCw" size={14} color="currentColor" /> Retry
          </button>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="p-5 space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #34c1dd, #1da8c5)' }}>
              <Icon name="Landmark" size={20} color="#fff" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-foreground tracking-tight">Finance Hub</h1>
              <p className="text-sm text-muted-foreground">
                {sacco?.name || 'Your society'} · {type.short} · fund accounting on double entry
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(fin.loading || tbLoading) && (
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Icon name="Loader" size={13} color="currentColor" className="animate-spin" /> Loading…
              </span>
            )}
            <button onClick={refreshAll}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
              <Icon name="RefreshCw" size={14} color="currentColor" /> Refresh
            </button>
            <button onClick={handleClose} title="Close Finance Hub" aria-label="Close Finance Hub and return to dashboard"
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground border border-border hover:text-red-600 hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              <Icon name="X" size={18} color="currentColor" />
            </button>
          </div>
        </div>

        {!sacco && !sc.loading && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
            <Icon name="AlertTriangle" size={20} color="#ca8a04" />
            <div>
              <p className="text-sm font-semibold text-foreground">No society record found</p>
              <p className="text-xs text-muted-foreground">The ledger is scoped to your sacco record. It will appear once your registration record exists.</p>
            </div>
          </div>
        )}

        {/* Reporting period + KPI strip */}
        {fin.isSeeded && (
          <>
            <div className="flex flex-wrap items-end gap-3 p-4 bg-card border border-border rounded-xl">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">Reporting period from</label>
                <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })}
                  className="px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">to</label>
                <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })}
                  className="px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-primary" />
              </div>
              <div className="flex gap-2">
                {[
                  { label: 'This month', get: () => monthBounds(new Date()) },
                  { label: 'This year',  get: () => ({ start: `${new Date().getFullYear()}-01-01`, end: `${new Date().getFullYear()}-12-31` }) },
                  { label: 'All time',   get: () => ({ start: '2000-01-01', end: new Date().toISOString().slice(0, 10) }) },
                ].map((p) => (
                  <button key={p.label} onClick={() => { const b = p.get(); setRange({ from: b.start, to: b.end }); }}
                    className="px-3 py-2 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground ml-auto max-w-xs">
                The Income Statement and Cash Flow cover this range; the Balance Sheet is as at the end date.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <KPI title="Total operating income" value={fmtPlain(classTotal(periodMap, 'income'))} icon="TrendingUp"
                iconBg="bg-emerald-100 dark:bg-emerald-900/30" iconColor="#10b981" hint={`${cur} · this period`} loading={tbLoading} />
              <KPI title="Total expenses" value={fmtPlain(classTotal(periodMap, 'expense'))} icon="TrendingDown"
                iconBg="bg-red-100 dark:bg-red-900/30" iconColor="#ef4444" hint={`${cur} · this period`} loading={tbLoading} />
              <KPI title="Net surplus" value={fmtPlain(netSurplus)} icon="Coins"
                iconBg="bg-blue-100 dark:bg-blue-900/30" iconColor="#3b82f6" hint="before appropriation" loading={tbLoading} />
              <KPI title="Total assets" value={fmtPlain(classTotal(closingMap, 'asset'))} icon="Wallet"
                iconBg="bg-violet-100 dark:bg-violet-900/30" iconColor="#8b5cf6" hint={`as at ${range.to}`} loading={tbLoading} />
              <KPI title="Member savings (liability)" value={fmtPlain(sumBalances(closingMap, ['2010', '2011', '2012', '2013']))}
                icon="PiggyBank" iconBg="bg-amber-100 dark:bg-amber-900/30" iconColor="#f59e0b" hint="accounts 2010–2013" loading={tbLoading} />
              <KPI title="Share capital (equity)" value={fmtPlain(sumBalances(closingMap, ['3010', '3020']))}
                icon="PieChart" iconBg="bg-cyan-100 dark:bg-cyan-900/30" iconColor="#06b6d4" hint="accounts 3010–3020" loading={tbLoading} />
            </div>
          </>
        )}

        {/* Tabs */}
        <div className="flex gap-1 flex-wrap border-b border-border pb-3">
          {tabs.map((t) => (
            <Tab key={t.id} active={activeTab === t.id} label={t.label} icon={t.icon} onClick={() => setActiveTab(t.id)} />
          ))}
        </div>

        {/* Content */}
        {fin.loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-card border border-border rounded-xl p-5 space-y-3">
                  <Sk className="h-4 w-24" /><Sk className="h-8 w-32" /><Sk className="h-3 w-20" />
                </div>
              ))}
            </div>
            <Sk className="h-64" />
          </div>
        ) : !fin.isSeeded && activeTab !== 'setup' ? (
          <div className="bg-card border border-border rounded-xl p-8 text-center">
            <div className="w-12 h-12 rounded-xl mx-auto flex items-center justify-center" style={{ background: 'rgba(52,193,221,0.1)' }}>
              <Icon name="Sparkles" size={22} color="#1da8c5" />
            </div>
            <p className="text-sm font-semibold text-foreground mt-3">The ledger has not been initialised yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
              Seed the chart of accounts, posting templates, provisioning ladder and appropriation waterfall
              before anything can be posted or reported.
            </p>
            <button onClick={() => setActiveTab('setup')}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #34c1dd, #1da8c5)' }}>
              <Icon name="Settings" size={14} color="currentColor" /> Go to Setup
            </button>
          </div>
        ) : (
          <>
            {activeTab === 'statements' && (
              <StatementsTab fin={fin} periodTb={periodMap} openingTb={openingMap} closingTb={closingMap}
                priorTb={tbPrior.length ? priorMap : null} range={range} saccoName={sacco?.name || 'Society'} />
            )}
            {/* The four tabs below compute or POST bookkeeping from `ops`.
                Rendering them against a half-loaded set would show wrong
                reconciliations and let a period-close job post understated
                accruals, so they wait for the whole history or say why not. */}
            {OPS_TABS.includes(activeTab) && opsLoading && (
              <div className="bg-card border border-border rounded-xl p-8 text-center">
                <Sk className="h-4 w-56 mx-auto" />
                <p className="text-sm text-muted-foreground mt-3">
                  Reading the full transaction history…
                </p>
              </div>
            )}
            {OPS_TABS.includes(activeTab) && opsError && (
              <div className="bg-card border border-destructive/30 rounded-xl p-6">
                <div className="flex items-start gap-2">
                  <Icon name="AlertTriangle" size={16} color="#dc2626" className="mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Could not read the sacco ledgers</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Accounting figures are hidden rather than shown from partial data. {opsError}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'ledger' && opsReady && (
              <LedgerTab fin={fin} ops={ops} trialBalanceRows={tbClosing} asAt={range.to} />
            )}
            {activeTab === 'journal' && opsReady && (
              <JournalTab fin={fin} ops={ops} onLedgerChange={loadTrialBalances} />
            )}
            {activeTab === 'coa' && (
              <ChartOfAccountsTab fin={fin} trialBalanceRows={tbClosing} currency={cur} />
            )}
            {activeTab === 'periods' && opsReady && (
              <PeriodsTab fin={fin} ops={ops} netSurplusForPeriod={netSurplus} onLedgerChange={loadTrialBalances} />
            )}
            {activeTab === 'chama' && opsReady && (
              <ChamaTab fin={fin} ops={ops} trialBalanceRows={tbClosing} onLedgerChange={loadTrialBalances} />
            )}
            {activeTab === 'setup' && <SetupTab fin={fin} />}
          </>
        )}
      </div>
    </MainLayout>
  );
};

export default SaccoFinanceHub;

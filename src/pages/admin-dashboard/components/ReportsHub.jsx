import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../../lib/supabase';
import { fetchEmployeePiiBatch } from '../../../services/employeePiiService';
import Icon from '../../../components/AppIcon';
import StaffActivityReport from '../../../components/crm/StaffActivityReport';
import ReportBuilder from '../../../pages/reports-analytics-center/components/ReportBuilder';
import { computePayroll, payrollInputForEmployee } from '../../../utils/kenyaPayroll';
import { computeVatReturn } from '../../../utils/vatLedger';
import { buildCashFlow } from '../../../utils/financialStatements';
import { fetchAllRows } from '../../../lib/fetchAllRows';

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmt     = (n) => `KES ${parseFloat(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtPct  = (n) => `${parseFloat(n || 0).toFixed(1)}%`;

const Bar = ({ pct, color = 'bg-primary' }) => (
  <div className="h-2 bg-muted rounded-full overflow-hidden flex-1">
    <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
  </div>
);

const KpiCard = ({ label, value, sub, icon, color = 'text-primary', bg = 'bg-primary/10' }) => (
  <div className="bg-card border border-border rounded-xl p-5">
    <div className="flex items-center justify-between mb-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${bg}`}>
        <Icon name={icon} size={15} color="currentColor" className={color} />
      </div>
    </div>
    <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
    {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
  </div>
);

const Table = ({ headers, rows, empty = 'No data' }) => (
  <div className="bg-card border border-border rounded-xl overflow-hidden">
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="bg-muted/40">
            {headers.map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={headers.length} className="px-4 py-12 text-center text-sm text-muted-foreground">{empty}</td></tr>
          ) : rows.map((row, i) => (
            <tr key={i} className="border-t border-border hover:bg-muted/20 transition-colors">
              {row.map((cell, j) => <td key={j} className="px-4 py-3 text-sm text-muted-foreground">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

/**
 * The posted ledger, for the reports that are accounting statements rather
 * than operational summaries.
 *
 * Shared by the VAT and cash flow reports: both need every journal entry and
 * the chart that types the accounts, and fetching it twice would double the
 * work for identical data. Read through `fetchAllRows` rather than a capped
 * query — a cash flow needs the opening position, which a newest-first limit
 * silently drops.
 */
const useLedger = () => {
  const [journals, setJournals] = useState([]);
  const [coa, setCoa] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [je, accounts] = await Promise.all([
          fetchAllRows(() => supabase.from('journal_entries')
            .select('entry_date, debit_account, credit_account, amount, status, trigger_event, description, reference')
            .order('entry_date', { ascending: false })),
          supabase.from('chart_of_accounts').select('account_code, account_name, account_type'),
        ]);
        if (cancelled) return;
        setJournals(je || []);
        setCoa(accounts.data || []);
      } catch (err) { if (!cancelled) console.error('Ledger load:', err); }
      finally { if (!cancelled) setLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  return { journals, coa, loading };
};

// ─── REPORT: VAT REPORT ───────────────────────────────────────────────────────
const VATReport = () => {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));

  // VAT is read off the ledger, not inferred from payments received.
  //
  // This report used to compute `outputVAT = payments * 0.16` and
  // `inputVAT = outputVAT * 0.4`. Both were invented: the first assumes every
  // shilling collected is a standard-rated sale with tax chargeable on top, the
  // second assumes purchases without looking at any. The VAT accounts in the
  // ledger already hold both figures. See src/utils/vatLedger.js.
  const { journals, coa, loading } = useLedger();

  const vat = computeVatReturn({ journals, chartOfAccounts: coa, period });

  const rows = [...vat.entries.output, ...vat.entries.input].slice(0, 30).map(j => {
    const isInput = vat.entries.input.includes(j);
    return [
      fmtDate(j.entry_date),
      j.reference || j.description || '—',
      isInput ? j.debit_account : j.credit_account,
      <span className={isInput ? 'text-emerald-600 font-semibold' : 'text-red-500 font-semibold'}>
        {isInput ? 'Input' : 'Output'}
      </span>,
      <span className="font-mono">{fmt(j.amount)}</span>,
    ];
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">VAT Report</h3>
          <p className="text-xs text-muted-foreground">Output and input VAT from the ledger, for the selected period</p>
        </div>
        <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
          className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Standard Rated Sales" value={fmt(vat.taxableSales)} icon="TrendingUp"  color="text-foreground" bg="bg-blue-100 dark:bg-blue-900/30" />
        <KpiCard label="Output VAT (16%)"     value={fmt(vat.outputVAT)}    icon="ArrowUpRight" color="text-red-600"   bg="bg-red-100 dark:bg-red-900/30" />
        <KpiCard label="Input VAT Claimable"  value={fmt(vat.inputVAT)}     icon="ArrowDownLeft" color="text-emerald-600" bg="bg-emerald-100 dark:bg-emerald-900/30" />
        <KpiCard label="Net VAT Payable"      value={fmt(vat.netVAT)}       icon="Receipt"      color="text-primary"   bg="bg-primary/10" />
      </div>

      {/* A zero input VAT is now a real answer, so say which kind of zero it is. */}
      {!loading && vat.inputVAT === 0 && vat.outputVAT !== 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 dark:bg-amber-900/20 dark:border-amber-800">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">No input VAT recorded</p>
          <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">
            {vat.diagnostics.hasInputVatAccount
              ? 'An input VAT account exists but nothing was posted to it this period, so nothing is being reclaimed.'
              : 'No input VAT account exists in the chart of accounts. Add one (e.g. "Input VAT", a current asset) and post the VAT on purchases to it.'}
          </p>
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 dark:bg-amber-900/20 dark:border-amber-800">
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">VAT Return Due</p>
        <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">
          VAT for {new Date(period + '-01').toLocaleString('default', { month: 'long', year: 'numeric' })} is due by the 20th of the following month.{' '}
          {vat.netVAT < 0
            ? <>Credit carried forward: <strong>{fmt(Math.abs(vat.netVAT))}</strong></>
            : <>Net VAT payable: <strong>{fmt(vat.netVAT)}</strong></>}
        </p>
      </div>

      {loading
        ? <div className="flex items-center justify-center py-12"><p className="text-sm text-muted-foreground">Loading ledger…</p></div>
        : <Table headers={['Date', 'Reference', 'Account', 'Side', 'VAT Amount']} rows={rows} empty="No VAT entries posted in this period" />}
    </div>
  );
};

// ─── REPORT: CASH FLOW ────────────────────────────────────────────────────────
const CashFlowReport = () => {
  const months = 6;
  const { journals, coa, loading } = useLedger();

  // Actual movements on the cash accounts, month by month.
  //
  // Outflows were `inflows * 0.35` — a flat assumption that every month spends
  // 35% of what it takes, which made "net cash flow" a fixed 65% of collections
  // and the chart a picture of one constant. Inflows were no better: they
  // counted completed client payments only, so capital introduced, loans drawn
  // and every other receipt were invisible. Both sides now come off the ledger.
  // See src/utils/financialStatements.js.
  const monthKeys = useMemo(() => {
    const result = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      result.push(d.toISOString().slice(0, 7));
    }
    return result;
  }, []);

  const monthlyData = useMemo(() => monthKeys.map(m => {
    const cf = buildCashFlow({ journals, chartOfAccounts: coa, period: m });
    return {
      key: m,
      month: new Date(m + '-01').toLocaleString('default', { month: 'short', year: '2-digit' }),
      inflows: cf.inflows,
      outflows: cf.outflows,
      net: cf.netChange,
      closing: cf.closingCash,
      operating: cf.operating,
      investing: cf.investing,
      financing: cf.financing,
    };
  }), [monthKeys, journals, coa]);

  const totalInflows  = monthlyData.reduce((s, m) => s + m.inflows, 0);
  const totalOutflows = monthlyData.reduce((s, m) => s + m.outflows, 0);
  const netCashflow   = totalInflows - totalOutflows;
  // Scaled against the largest movement in EITHER direction, so the two bars in
  // a row are comparable. Scaling outflows against peak inflow made a month
  // that spent more than it earned draw a bar past the end of its track.
  const maxVal = Math.max(...monthlyData.map(m => Math.max(m.inflows, m.outflows)), 1);

  const cashAccountNames = buildCashFlow({ journals, chartOfAccounts: coa }).cashAccountNames;

  const rows = monthlyData.map(m => [
    m.month,
    <span className="text-emerald-600 font-semibold">{fmt(m.inflows)}</span>,
    <span className="text-red-500">{fmt(m.outflows)}</span>,
    <span className={`font-bold ${m.net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmt(m.net)}</span>,
    <span className="font-mono text-xs text-muted-foreground">{fmt(m.closing)}</span>,
    <div className="flex items-center gap-2 min-w-24">
      <Bar pct={(m.inflows / maxVal) * 100} color="bg-emerald-500" />
    </div>,
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-foreground">Cash Flow Statement</h3>
        <p className="text-xs text-muted-foreground">
          {months}-month cash movement, from the ledger
          {cashAccountNames.length > 0 && ` · Cash accounts: ${cashAccountNames.join(', ')}`}
        </p>
      </div>

      {!loading && cashAccountNames.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 dark:bg-amber-900/20 dark:border-amber-800">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">No cash accounts found</p>
          <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">
            This statement tracks movements on accounts named for cash, a bank, M-Pesa or a till.
            Without one in your chart of accounts there is nothing to report.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Total Inflows"  value={fmt(totalInflows)}  icon="ArrowDownLeft" color="text-emerald-600" bg="bg-emerald-100 dark:bg-emerald-900/30" />
        <KpiCard label="Total Outflows" value={fmt(totalOutflows)} icon="ArrowUpRight"  color="text-red-600"    bg="bg-red-100 dark:bg-red-900/30" />
        <KpiCard label="Net Cash Flow"  value={fmt(netCashflow)}   icon="TrendingUp"    color="text-primary"    bg="bg-primary/10" />
      </div>

      {/* Bar chart */}
      <div className="bg-card border border-border rounded-xl p-5">
        <p className="text-sm font-bold text-foreground mb-4">Monthly Cash Flow</p>
        <div className="space-y-3">
          {monthlyData.map(m => (
            <div key={m.month} className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-12 flex-shrink-0">{m.month}</span>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-14">Inflows</span>
                  <Bar pct={(m.inflows / maxVal) * 100} color="bg-emerald-500" />
                  <span className="text-xs font-mono text-emerald-600 w-24 text-right">{fmt(m.inflows)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-14">Outflows</span>
                  <Bar pct={(m.outflows / maxVal) * 100} color="bg-red-400" />
                  <span className="text-xs font-mono text-red-500 w-24 text-right">{fmt(m.outflows)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {loading
        ? <div className="flex items-center justify-center py-12"><p className="text-sm text-muted-foreground">Loading ledger…</p></div>
        : <Table headers={['Month', 'Inflows', 'Outflows', 'Net Cash Flow', 'Closing Cash', 'Trend']} rows={rows}
            empty="No cash movements posted in the last six months" />}
    </div>
  );
};

// ─── REPORT: INVENTORY MOVEMENT ───────────────────────────────────────────────
const InventoryReport = ({ assets }) => {
  const available = assets.filter(a => a.asset_status === 'available');
  const sold      = assets.filter(a => a.asset_status === 'sold');
  const reserved  = assets.filter(a => a.asset_status === 'reserved');
  const totalValue = assets.reduce((s, a) => s + parseFloat(a.selling_price || 0), 0);
  const soldValue  = sold.reduce((s, a) => s + parseFloat(a.selling_price || 0), 0);

  const byType = assets.reduce((acc, a) => {
    const t = a.asset_type || 'other';
    if (!acc[t]) acc[t] = { type: t, total: 0, sold: 0, available: 0, reserved: 0, value: 0 };
    acc[t].total++;
    acc[t].value += parseFloat(a.selling_price || 0);
    if (a.asset_status === 'sold')      acc[t].sold++;
    if (a.asset_status === 'available') acc[t].available++;
    if (a.asset_status === 'reserved')  acc[t].reserved++;
    return acc;
  }, {});

  const rows = Object.values(byType).map(t => [
    <span className="font-semibold text-foreground capitalize">{t.type}</span>,
    t.total,
    <span className="text-emerald-600 font-semibold">{t.available}</span>,
    <span className="text-amber-600">{t.reserved}</span>,
    <span className="text-blue-600">{t.sold}</span>,
    fmt(t.value),
    <div className="flex items-center gap-2">
      <Bar pct={t.total > 0 ? (t.sold / t.total) * 100 : 0} color="bg-blue-500" />
      <span className="text-xs text-muted-foreground">{t.total > 0 ? Math.round((t.sold / t.total) * 100) : 0}%</span>
    </div>,
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-foreground">Inventory Movement Report</h3>
        <p className="text-xs text-muted-foreground">Asset stock levels, movement and valuation</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total Assets"   value={assets.length}   icon="Package"    color="text-foreground"    bg="bg-muted" />
        <KpiCard label="Available"      value={available.length} icon="CheckCircle" color="text-emerald-600" bg="bg-emerald-100 dark:bg-emerald-900/30" />
        <KpiCard label="Sold"           value={sold.length}     icon="TrendingUp"  color="text-blue-600"     bg="bg-blue-100 dark:bg-blue-900/30" />
        <KpiCard label="Stock Value"    value={fmt(totalValue - soldValue)} icon="DollarSign" color="text-primary" bg="bg-primary/10" />
      </div>

      <Table
        headers={['Asset Type', 'Total', 'Available', 'Reserved', 'Sold', 'Total Value', 'Sell-Through Rate']}
        rows={rows}
        empty="No assets found"
      />
    </div>
  );
};

// ─── REPORT: CLIENT PORTFOLIO ─────────────────────────────────────────────────
const ClientPortfolioReport = ({ clients, payments }) => {
  const clientPayments = payments.reduce((acc, p) => {
    if (!acc[p.client_id]) acc[p.client_id] = 0;
    if (p.payment_status === 'completed') acc[p.client_id] += parseFloat(p.amount || 0);
    return acc;
  }, {});

  const rows = clients.slice(0, 30).map(c => {
    const paid = clientPayments[c.id] || 0;
    return [
      <span className="font-semibold text-foreground">{c.full_name}</span>,
      c.account_number || '—',
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
        c.kyc_status === 'verified' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
      }`}>{c.kyc_status || 'pending'}</span>,
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${
        c.client_status === 'active' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
      }`}>{c.client_status || 'active'}</span>,
      <span className="font-mono text-emerald-600 font-semibold">{fmt(paid)}</span>,
      <span className="font-mono text-red-500">{fmt(c.outstanding_balance || 0)}</span>,
      fmtDate(c.created_at),
    ];
  });

  const totalPortfolio   = clients.reduce((s, c) => s + parseFloat(c.outstanding_balance || 0), 0);
  const totalCollected   = Object.values(clientPayments).reduce((s, v) => s + v, 0);
  const activeClients    = clients.filter(c => c.client_status === 'active').length;
  const verifiedClients  = clients.filter(c => c.kyc_status === 'verified').length;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-foreground">Client Portfolio Report</h3>
        <p className="text-xs text-muted-foreground">Overview of all client accounts, balances and payment history</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total Clients"    value={clients.length}    icon="Users"       color="text-foreground"    bg="bg-muted" />
        <KpiCard label="Active Clients"   value={activeClients}     icon="UserCheck"   color="text-blue-600"      bg="bg-blue-100 dark:bg-blue-900/30" />
        <KpiCard label="KYC Verified"     value={verifiedClients}   icon="Shield"      color="text-emerald-600"   bg="bg-emerald-100 dark:bg-emerald-900/30" />
        <KpiCard label="Total Outstanding" value={fmt(totalPortfolio)} icon="AlertCircle" color="text-red-600"   bg="bg-red-100 dark:bg-red-900/30" />
      </div>

      <Table
        headers={['Client', 'Account No.', 'KYC', 'Status', 'Total Paid', 'Outstanding', 'Joined']}
        rows={rows}
        empty="No clients found"
      />
    </div>
  );
};

// ─── REPORT: COMMISSION REPORT ────────────────────────────────────────────────
const CommissionReport = ({ agents, payments, assets }) => {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));

  const rows = agents.map(a => {
    const commission = parseFloat(a.commission_earned || 0);
    const sales      = parseFloat(a.total_sales || 0);
    const rate       = sales > 0 ? ((commission / sales) * 100).toFixed(1) : '0.0';
    return [
      <span className="font-semibold text-foreground">{a.full_name || a.name || '—'}</span>,
      a.email || '—',
      a.total_sales || 0,
      <span className="font-mono text-foreground">{fmt(sales)}</span>,
      <span className="font-mono text-emerald-600 font-semibold">{fmt(commission)}</span>,
      `${rate}%`,
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
        a.is_active !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
      }`}>{a.is_active !== false ? 'Active' : 'Inactive'}</span>,
    ];
  });

  const totalCommission = agents.reduce((s, a) => s + parseFloat(a.commission_earned || 0), 0);
  const totalSales      = agents.reduce((s, a) => s + parseFloat(a.total_sales || 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Commission Report</h3>
          <p className="text-xs text-muted-foreground">Agent sales performance and commission earned</p>
        </div>
        <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
          className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Total Agents"      value={agents.length}       icon="Users"      color="text-foreground" bg="bg-muted" />
        <KpiCard label="Total Sales Value" value={fmt(totalSales)}     icon="TrendingUp" color="text-blue-600"   bg="bg-blue-100 dark:bg-blue-900/30" />
        <KpiCard label="Total Commission"  value={fmt(totalCommission)} icon="Award"     color="text-primary"    bg="bg-primary/10" />
      </div>

      <Table
        headers={['Agent', 'Email', 'Sales Count', 'Sales Value', 'Commission Earned', 'Rate', 'Status']}
        rows={rows}
        empty="No agents found"
      />
    </div>
  );
};

// ─── REPORT: DAILY COLLECTIONS ────────────────────────────────────────────────
const DailyCollectionsReport = ({ payments }) => {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  const todayPayments = payments.filter(p => {
    const d = new Date(p.payment_date || p.created_at);
    return d.toISOString().split('T')[0] === date;
  });

  const completed = todayPayments.filter(p => p.payment_status === 'completed');
  const pending   = todayPayments.filter(p => p.payment_status !== 'completed');
  const total     = completed.reduce((s, p) => s + parseFloat(p.amount || 0), 0);

  const byMethod = completed.reduce((acc, p) => {
    const m = p.payment_method || 'other';
    if (!acc[m]) acc[m] = { method: m, count: 0, total: 0 };
    acc[m].count++;
    acc[m].total += parseFloat(p.amount || 0);
    return acc;
  }, {});

  const rows = completed.map(p => [
    fmtDate(p.payment_date || p.created_at),
    p.reference_number || p.transaction_id || '—',
    p.payment_method?.replace(/_/g, ' ') || '—',
    <span className="font-mono font-semibold text-emerald-600">{fmt(p.amount)}</span>,
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">Completed</span>,
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Daily Collections Report</h3>
          <p className="text-xs text-muted-foreground">All payments received on a given day</p>
        </div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Total Collected"   value={fmt(total)}         icon="DollarSign"  color="text-emerald-600" bg="bg-emerald-100 dark:bg-emerald-900/30" />
        <KpiCard label="Transactions"      value={completed.length}   icon="CreditCard"  color="text-primary"     bg="bg-primary/10" />
        <KpiCard label="Pending"           value={pending.length}     icon="Clock"       color="text-amber-600"   bg="bg-amber-100 dark:bg-amber-900/30" />
      </div>

      {/* By method */}
      {Object.values(byMethod).length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-sm font-bold text-foreground mb-3">Collections by Method</p>
          <div className="space-y-2">
            {Object.values(byMethod).map(m => (
              <div key={m.method} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground capitalize w-24 flex-shrink-0">{m.method.replace(/_/g, ' ')}</span>
                <Bar pct={total > 0 ? (m.total / total) * 100 : 0} color="bg-primary" />
                <span className="text-xs font-mono text-foreground w-24 text-right">{fmt(m.total)}</span>
                <span className="text-xs text-muted-foreground">({m.count})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Table headers={['Date', 'Reference', 'Method', 'Amount', 'Status']} rows={rows} empty="No collections on selected date" />
    </div>
  );
};

// ─── REPORT: INSTALLMENT ADHERENCE ───────────────────────────────────────────
const InstallmentAdherenceReport = ({ clients }) => {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from('installment_plans')
        .select('*, asset:assets(description, asset_code)')
        .order('created_at', { ascending: false });
      setPlans(data || []);
      setLoading(false);
    };
    fetch();
  }, []);

  const clientMap = Object.fromEntries((clients || []).map(c => [c.id, c]));
  const onTime    = plans.filter(p => p.plan_status === 'active' || p.plan_status === 'completed').length;
  const overdue   = plans.filter(p => p.plan_status === 'overdue').length;
  const adherence = plans.length > 0 ? ((onTime / plans.length) * 100).toFixed(1) : 0;

  const rows = plans.slice(0, 30).map(p => {
    const client  = clientMap[p.client_id];
    const pct     = p.total_installments > 0 ? Math.round((p.installments_paid / p.total_installments) * 100) : 0;
    const remaining = (p.total_installments || 0) - (p.installments_paid || 0);
    return [
      <span className="font-semibold text-foreground">{client?.full_name || '—'}</span>,
      p.asset?.description || '—',
      p.plan_name,
      `${p.installments_paid}/${p.total_installments}`,
      <div className="flex items-center gap-2 min-w-20">
        <Bar pct={pct} color={pct === 100 ? 'bg-emerald-500' : pct > 50 ? 'bg-primary' : 'bg-amber-500'} />
        <span className="text-xs">{pct}%</span>
      </div>,
      fmt(p.installment_amount),
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${
        p.plan_status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
        p.plan_status === 'overdue'   ? 'bg-red-100 text-red-700' :
        p.plan_status === 'active'    ? 'bg-blue-100 text-blue-700' :
        'bg-gray-100 text-gray-600'
      }`}>{p.plan_status}</span>,
      fmtDate(p.next_charge_date),
    ];
  });

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-foreground">Installment Adherence Report</h3>
        <p className="text-xs text-muted-foreground">Track client payment discipline across all hire purchase plans</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total Plans"     value={plans.length}   icon="Calendar"    color="text-foreground"    bg="bg-muted" />
        <KpiCard label="On Track"        value={onTime}         icon="CheckCircle" color="text-emerald-600"   bg="bg-emerald-100 dark:bg-emerald-900/30" />
        <KpiCard label="Overdue"         value={overdue}        icon="AlertCircle" color="text-red-600"       bg="bg-red-100 dark:bg-red-900/30" />
        <KpiCard label="Adherence Rate"  value={`${adherence}%`} icon="TrendingUp" color="text-primary"       bg="bg-primary/10" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">Loading plans...</p>
        </div>
      ) : (
        <Table
          headers={['Client', 'Asset', 'Plan', 'Paid', 'Progress', 'Installment', 'Status', 'Next Due']}
          rows={rows}
          empty="No installment plans found"
        />
      )}
    </div>
  );
};


// ─── REPORT: AGING ANALYSIS ───────────────────────────────────────────────────
const AgingAnalysisReport = ({ clients, payments }) => {
  const today = new Date();

  // Build outstanding balance per client with age
  const clientMap = Object.fromEntries((clients || []).map(c => [c.id, c]));
  const clientPayments = (payments || []).reduce((acc, p) => {
    if (!acc[p.client_id]) acc[p.client_id] = { paid: 0, lastPayment: null };
    if (p.payment_status === 'completed') {
      acc[p.client_id].paid += parseFloat(p.amount || 0);
      const d = p.payment_date || p.created_at;
      if (!acc[p.client_id].lastPayment || d > acc[p.client_id].lastPayment) acc[p.client_id].lastPayment = d;
    }
    return acc;
  }, {});

  const aging = { current: [], d30: [], d60: [], d90: [], d90plus: [] };
  let totals = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };

  clients.forEach(c => {
    const outstanding = parseFloat(c.outstanding_balance || 0);
    if (outstanding <= 0) return;
    const lastPay = clientPayments[c.id]?.lastPayment;
    const daysSince = lastPay ? Math.floor((today - new Date(lastPay)) / (1000 * 60 * 60 * 24)) : 999;
    const entry = { client: c.full_name, account: c.account_number || '—', balance: outstanding, days: daysSince, lastPayment: lastPay };
    if (daysSince <= 30)       { aging.current.push(entry); totals.current += outstanding; }
    else if (daysSince <= 60)  { aging.d30.push(entry);     totals.d30 += outstanding; }
    else if (daysSince <= 90)  { aging.d60.push(entry);     totals.d60 += outstanding; }
    else if (daysSince <= 120) { aging.d90.push(entry);     totals.d90 += outstanding; }
    else                       { aging.d90plus.push(entry); totals.d90plus += outstanding; }
  });

  const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0);
  const buckets = [
    { key: 'current', label: '0–30 Days',  color: 'text-emerald-600', bg: 'bg-emerald-100 dark:bg-emerald-900/30', data: aging.current,  total: totals.current  },
    { key: 'd30',     label: '31–60 Days', color: 'text-blue-600',    bg: 'bg-blue-100 dark:bg-blue-900/30',       data: aging.d30,      total: totals.d30      },
    { key: 'd60',     label: '61–90 Days', color: 'text-amber-600',   bg: 'bg-amber-100 dark:bg-amber-900/30',     data: aging.d60,      total: totals.d60      },
    { key: 'd90',     label: '91–120 Days',color: 'text-orange-600',  bg: 'bg-orange-100 dark:bg-orange-900/30',   data: aging.d90,      total: totals.d90      },
    { key: 'd90plus', label: '120+ Days',  color: 'text-red-600',     bg: 'bg-red-100 dark:bg-red-900/30',         data: aging.d90plus,  total: totals.d90plus  },
  ];

  const [selected, setSelected] = React.useState('current');
  const bucket = buckets.find(b => b.key === selected);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-bold text-foreground">Aging Analysis Report</h3>
        <p className="text-xs text-muted-foreground">Outstanding receivables by age — identifies collection risk</p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {buckets.map(b => (
          <button key={b.key} onClick={() => setSelected(b.key)}
            className={`bg-card border rounded-xl p-4 text-left transition-all hover:border-primary/40 ${selected === b.key ? 'border-primary/40 ring-1 ring-primary/20' : 'border-border'}`}>
            <p className="text-xs font-semibold text-muted-foreground mb-1">{b.label}</p>
            <p className={`text-lg font-bold font-mono ${b.color}`}>{fmt(b.total)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{b.data.length} accounts</p>
          </button>
        ))}
      </div>

      {/* Visual bar */}
      {grandTotal > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-sm font-bold text-foreground mb-3">Portfolio Aging Distribution — Total Outstanding: {fmt(grandTotal)}</p>
          <div className="flex h-8 rounded-lg overflow-hidden gap-0.5">
            {buckets.filter(b => b.total > 0).map(b => (
              <div key={b.key} style={{ width: `${(b.total / grandTotal) * 100}%` }}
                className={`flex items-center justify-center text-xs font-bold text-white ${
                  b.key === 'current' ? 'bg-emerald-500' :
                  b.key === 'd30'     ? 'bg-blue-500' :
                  b.key === 'd60'     ? 'bg-amber-500' :
                  b.key === 'd90'     ? 'bg-orange-500' : 'bg-red-500'
                }`} title={`${b.label}: ${fmt(b.total)}`}>
                {((b.total / grandTotal) * 100).toFixed(0)}%
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-2 flex-wrap">
            {buckets.map(b => (
              <div key={b.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className={`w-2.5 h-2.5 rounded-full ${
                  b.key === 'current' ? 'bg-emerald-500' :
                  b.key === 'd30'     ? 'bg-blue-500' :
                  b.key === 'd60'     ? 'bg-amber-500' :
                  b.key === 'd90'     ? 'bg-orange-500' : 'bg-red-500'
                }`} />
                {b.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail table */}
      <Table
        headers={['Client', 'Account No.', 'Outstanding Balance', 'Days Since Last Payment', 'Last Payment']}
        rows={bucket.data.map(e => [
          <span className="font-semibold text-foreground">{e.client}</span>,
          e.account,
          <span className={`font-mono font-semibold ${bucket.color}`}>{fmt(e.balance)}</span>,
          <span className={`font-semibold ${e.days > 90 ? 'text-red-600' : e.days > 60 ? 'text-amber-600' : 'text-foreground'}`}>{e.days === 999 ? 'Never paid' : `${e.days} days`}</span>,
          fmtDate(e.lastPayment),
        ])}
        empty={`No accounts in ${bucket.label} range`}
      />
    </div>
  );
};

// ─── REPORT: PAYROLL SUMMARY ──────────────────────────────────────────────────
const PayrollSummaryReport = ({ agents, employees = [], payrollRecords = [] }) => {
  const [profiles, setProfiles]   = React.useState([]);
  const [loading, setLoading]     = React.useState(true);
  const [period, setPeriod]       = React.useState(new Date().toISOString().slice(0, 7));

  React.useEffect(() => {
    const load = async () => {
      try {
        const { data } = await supabase
          .from('user_profiles')
          .select('id, full_name, role, basic_salary, housing_allowance, transport_allowance, is_active, employment_type')
          .not('basic_salary', 'is', null);
        setProfiles(data || []);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    };
    load();
  }, []);

  // This report used to carry its OWN copy of the Kenya tax rules — a fourth
  // one, with 25% running all the way to 500,000, no personal relief and NSSF
  // capped at 1,080 — so the PAYE an admin read here disagreed with the PAYE HR
  // actually paid. It now computes through the same engine as payroll.
  //
  // Where a real payroll run exists for the period, its stored figures are used
  // instead of re-pricing the salary: that is what was paid and filed. The
  // `hasActualPayroll` flag was already here and was never acted on.
  const periodRecords = payrollRecords.filter(r => r.pay_month === period);
  const hasActualPayroll = periodRecords.length > 0;
  const recordByEmployee = Object.fromEntries(periodRecords.map(r => [r.employee_id, r]));

  const figuresFor = (p) => {
    const actual = recordByEmployee[p.id];
    if (actual) {
      return {
        gross: parseFloat(actual.gross_salary || 0),
        paye:  parseFloat(actual.paye || 0),
        net:   parseFloat(actual.net_salary || 0),
        basic: parseFloat(actual.basic_salary ?? p.basic_salary ?? 0),
        actual: true,
      };
    }
    const r = computePayroll(payrollInputForEmployee(p, {}, period));
    return { gross: r.grossCash, paye: r.paye, net: r.netPay, basic: r.basic, actual: false };
  };

  const depts = profiles.reduce((acc, p) => {
    const dept = p.role || 'other';
    if (!acc[dept]) acc[dept] = { dept, count: 0, grossPay: 0, netPay: 0, paye: 0 };
    const f = figuresFor(p);
    acc[dept].count++;
    acc[dept].grossPay += f.gross;
    acc[dept].netPay   += f.net;
    acc[dept].paye     += f.paye;
    return acc;
  }, {});

  const deptList     = Object.values(depts);
  const totalGross   = deptList.reduce((s, d) => s + d.grossPay, 0);
  const totalNet     = deptList.reduce((s, d) => s + d.netPay, 0);
  const totalPAYE    = deptList.reduce((s, d) => s + d.paye, 0);
  const totalStaff   = profiles.length;

  const rows = profiles.slice(0, 30).map(p => {
    const f = figuresFor(p);
    return [
      <span className="font-semibold text-foreground">{p.full_name || '—'}</span>,
      <span className="capitalize text-muted-foreground text-xs">{p.role || '—'}</span>,
      <span className="font-mono">{fmt(f.basic)}</span>,
      <span className="font-mono">{fmt(f.gross)}</span>,
      <span className="font-mono text-red-500">{fmt(f.paye)}</span>,
      <span className="font-mono text-emerald-600 font-semibold">{fmt(f.net)}</span>,
      // Whether this row is a real payroll line or a projection off the salary
      // on file. Both are useful; conflating them is not.
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${f.actual ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
        {f.actual ? 'Paid' : 'Projected'}
      </span>,
    ];
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-foreground">Payroll Summary Report</h3>
          {/* Whether this is what was paid or what it would cost if payroll were
              run on today's salaries. The two get read the same way otherwise,
              and only one of them is a fact. */}
          <p className="text-xs text-muted-foreground">
            {hasActualPayroll
              ? `${periodRecords.length} payroll record(s) processed for this period — figures shown are what was paid.`
              : 'No payroll run for this period yet — figures are projected from the salaries on file.'}
          </p>
        </div>
        <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
          className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total Staff"    value={totalStaff}     icon="Users"      color="text-foreground"  bg="bg-muted" />
        <KpiCard label="Total Gross Pay" value={fmt(totalGross)} icon="TrendingUp" color="text-blue-600"   bg="bg-blue-100 dark:bg-blue-900/30" />
        <KpiCard label="Total PAYE"     value={fmt(totalPAYE)}  icon="Receipt"    color="text-red-600"    bg="bg-red-100 dark:bg-red-900/30" />
        <KpiCard label="Total Net Pay"  value={fmt(totalNet)}   icon="DollarSign" color="text-emerald-600" bg="bg-emerald-100 dark:bg-emerald-900/30" />
      </div>

      {/* Dept summary */}
      {deptList.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <p className="text-sm font-bold text-foreground mb-3">By Role / Department</p>
          <div className="space-y-2">
            {deptList.map(d => (
              <div key={d.dept} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground capitalize w-28 flex-shrink-0">{d.dept}</span>
                <div className="h-2 bg-muted rounded-full overflow-hidden flex-1">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${totalGross > 0 ? (d.grossPay / totalGross) * 100 : 0}%` }} />
                </div>
                <span className="text-xs font-mono text-foreground w-28 text-right">{fmt(d.grossPay)}</span>
                <span className="text-xs text-muted-foreground">({d.count})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12"><p className="text-sm text-muted-foreground">Loading payroll data...</p></div>
      ) : profiles.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <p className="text-sm text-muted-foreground">No payroll data found. Run payroll in HR Management first.</p>
        </div>
      ) : (
        <Table
          headers={['Employee', 'Role', 'Basic Salary', 'Gross Pay', 'PAYE', 'Net Pay', 'Source']}
          rows={rows}
          empty="No employees found"
        />
      )}
    </div>
  );
};


// ─── MAIN REPORTS PAGE ────────────────────────────────────────────────────────

// ─── HR REPORT ────────────────────────────────────────────────────────────────
const HRReport = ({ employees = [], payrollRecords = [], dateRange }) => {
  const [period, setPeriod] = React.useState(new Date().toISOString().slice(0, 7));

  const active   = employees.filter(e => e.is_active !== false);
  const inactive = employees.filter(e => e.is_active === false);
  const depts    = [...new Set(employees.map(e => e.department).filter(Boolean))];

  const totalGross = employees.reduce((s, e) => {
    return s + parseFloat(e.basic_salary || 0) + parseFloat(e.housing_allowance || 0) + parseFloat(e.transport_allowance || 0);
  }, 0);

  // Payroll for selected period
  const periodPayroll = payrollRecords.filter(p => p.pay_month === period);
  const periodNet     = periodPayroll.reduce((s, p) => s + parseFloat(p.net_salary || 0), 0);
  const periodGross   = periodPayroll.reduce((s, p) => s + parseFloat(p.gross_salary || 0), 0);
  const periodPAYE    = periodPayroll.reduce((s, p) => s + parseFloat(p.paye || 0), 0);

  const empRows = employees.map(e => {
    const gross = parseFloat(e.basic_salary || 0) + parseFloat(e.housing_allowance || 0) + parseFloat(e.transport_allowance || 0);
    return [
      <span className="font-semibold text-foreground">{e.full_name || '—'}</span>,
      <span className="text-xs capitalize text-muted-foreground">{(e.role || '—').replace(/_/g, ' ')}</span>,
      <span className="text-xs text-muted-foreground">{e.department || '—'}</span>,
      <span className="text-xs capitalize text-muted-foreground">{(e.employment_type || '—').replace(/_/g, ' ')}</span>,
      <span className="font-mono">{fmt(e.basic_salary)}</span>,
      <span className="font-mono font-semibold text-foreground">{fmt(gross)}</span>,
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${e.is_active !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
        {e.is_active !== false ? 'Active' : 'Inactive'}
      </span>,
    ];
  });

  const payrollRows = periodPayroll.map(p => {
    const emp = employees.find(e => e.id === p.employee_id);
    return [
      <span className="font-semibold text-foreground">{emp?.full_name || '—'}</span>,
      <span className="text-xs text-muted-foreground">{emp?.department || '—'}</span>,
      <span className="font-mono">{fmt(p.gross_salary)}</span>,
      <span className="font-mono text-red-500">({fmt(p.paye)})</span>,
      <span className="font-mono text-red-500">({fmt(p.nssf)})</span>,
      <span className="font-mono text-red-500">({fmt(p.shif)})</span>,
      <span className="font-mono font-bold text-emerald-600">{fmt(p.net_salary)}</span>,
    ];
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">HR Report</h3>
          <p className="text-xs text-muted-foreground">Employee records and payroll breakdown</p>
        </div>
        <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
          className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total Employees"  value={employees.length} icon="Users"      color="text-foreground"  bg="bg-muted" />
        <KpiCard label="Active Staff"     value={active.length}    icon="UserCheck"  color="text-emerald-600" bg="bg-emerald-100 dark:bg-emerald-900/30" />
        <KpiCard label="Departments"      value={depts.length}     icon="Building2"  color="text-blue-600"    bg="bg-blue-100 dark:bg-blue-900/30" />
        <KpiCard label="Monthly Payroll"  value={fmt(totalGross)}  icon="DollarSign" color="text-primary"     bg="bg-primary/10" />
      </div>

      {periodPayroll.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <KpiCard label={`${period} Gross`}   value={fmt(periodGross)} icon="TrendingUp" color="text-foreground"  bg="bg-muted" />
          <KpiCard label={`${period} Net Pay`} value={fmt(periodNet)}   icon="Wallet"     color="text-emerald-600" bg="bg-emerald-100 dark:bg-emerald-900/30" />
          <KpiCard label={`${period} PAYE`}    value={fmt(periodPAYE)}  icon="Receipt"    color="text-red-600"     bg="bg-red-100 dark:bg-red-900/30" />
        </div>
      )}

      <div>
        <p className="text-sm font-bold text-foreground mb-3">Employee Records</p>
        <Table
          headers={['Employee', 'Role', 'Department', 'Type', 'Basic Salary', 'Gross Package', 'Status']}
          rows={empRows}
          empty="No employees found"
        />
      </div>

      {periodPayroll.length > 0 && (
        <div>
          <p className="text-sm font-bold text-foreground mb-3">Payroll for {period}</p>
          <Table
            headers={['Employee', 'Department', 'Gross', 'PAYE', 'NSSF', 'SHA', 'Net Pay']}
            rows={payrollRows}
            empty="No payroll records for this period"
          />
        </div>
      )}
    </div>
  );
};

// ─── EXPORT CSV HELPER ────────────────────────────────────────────────────────
const exportCSV = (data, filename) => {
  if (!data || data.length === 0) return;
  const keys = Object.keys(data[0]);
  const csv  = [
    keys.join(','),
    ...data.map(row => keys.map(k => `"${String(row[k] ?? '').replace(/"/g, '""')}"`).join(','))
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// ─── DATE RANGE FILTER HELPER ─────────────────────────────────────────────────
const getDateRange = (range, customFrom, customTo) => {
  const now   = new Date();
  const start = (y, m, d) => new Date(y, m, d);
  if (range === 'today')   return { from: start(now.getFullYear(), now.getMonth(), now.getDate()), to: now };
  if (range === 'weekly')  {
    const s = new Date(now); s.setDate(now.getDate() - now.getDay());
    s.setHours(0,0,0,0); return { from: s, to: now };
  }
  if (range === 'monthly') return { from: start(now.getFullYear(), now.getMonth(), 1), to: now };
  if (range === 'yearly')  return { from: start(now.getFullYear(), 0, 1), to: now };
  if (range === 'custom' && customFrom && customTo) {
    const to = new Date(customTo); to.setHours(23,59,59,999);
    return { from: new Date(customFrom), to };
  }
  return null; // all time
};

const filterByDate = (items, dateField, range, customFrom, customTo) => {
  const dr = getDateRange(range, customFrom, customTo);
  if (!dr) return items;
  return items.filter(item => {
    const d = new Date(item[dateField] || item.created_at);
    return d >= dr.from && d <= dr.to;
  });
};

// ─── MAIN REPORTS HUB ─────────────────────────────────────────────────────────
const ReportsHub = ({ assets = [], payments = [], agents = [], clients = [], employees = [], payrollRecords = [] }) => {
  const [activeReport, setActiveReport] = useState('vat');
  const [dateRange,    setDateRange]    = useState('all');
  const [customFrom,   setCustomFrom]   = useState('');
  const [customTo,     setCustomTo]     = useState('');

  // Absolute bounds for reports that fetch their own rows and therefore cannot
  // use filterByDate, which works on an in-memory array.
  const activeDateRange = getDateRange(dateRange, customFrom, customTo);

  // The builder is self-contained: its own source, its own period, its own
  // export. The hub's toolbar would act on data it is not showing.
  const isBuilder = activeReport === 'builder';

  // Apply global date filter to shared datasets
  const filteredPayments = filterByDate(payments, 'payment_date', dateRange, customFrom, customTo);
  const filteredClients  = filterByDate(clients,  'created_at',   dateRange, customFrom, customTo);
  const filteredAssets   = filterByDate(assets,   'created_at',   dateRange, customFrom, customTo);

  const reports = [
    // First in the strip, but not the default: the standard reports answer the
    // questions people already know they have, and the builder is for the ones
    // they do not. Leading with it is discoverability, not a change to what
    // this screen opens on.
    { id: 'builder',     label: 'Report Builder',        icon: 'Wand2'       },
    { id: 'vat',         label: 'VAT Report',            icon: 'Receipt'     },
    { id: 'cashflow',    label: 'Cash Flow',             icon: 'TrendingUp'  },
    { id: 'inventory',   label: 'Inventory Movement',    icon: 'Package'     },
    { id: 'portfolio',   label: 'Client Portfolio',      icon: 'Users'       },
    { id: 'commission',  label: 'Commission Report',     icon: 'Award'       },
    { id: 'collections', label: 'Daily Collections',     icon: 'CreditCard'  },
    { id: 'adherence',   label: 'Installment Adherence', icon: 'Calendar'    },
    { id: 'aging',       label: 'Aging Analysis',        icon: 'AlertCircle' },
    { id: 'payroll',     label: 'Payroll Summary',       icon: 'Receipt'     },
    { id: 'hr',          label: 'HR Report',             icon: 'UserCheck'   },
    { id: 'staff-activity', label: 'Staff Activity',   icon: 'Activity'    },
  ];

  // Export current report data as CSV
  const handleExport = async () => {
    if (activeReport === 'vat' || activeReport === 'cashflow' || activeReport === 'collections') {
      exportCSV(filteredPayments.map(p => ({
        date:      p.payment_date || p.created_at,
        reference: p.reference_number || '',
        method:    p.payment_method || '',
        amount:    p.amount,
        status:    p.payment_status,
        client_id: p.client_id,
      })), `${activeReport}_payments`);
    } else if (activeReport === 'inventory') {
      exportCSV(filteredAssets.map(a => ({
        name:       a.asset_name || a.title || '',
        type:       a.asset_type || '',
        status:     a.asset_status || '',
        price:      a.selling_price || 0,
        created_at: a.created_at,
      })), 'inventory');
    } else if (activeReport === 'portfolio' || activeReport === 'aging' || activeReport === 'adherence') {
      exportCSV(filteredClients.map(c => ({
        name:       c.full_name,
        email:      c.email,
        phone:      c.phone,
        account:    c.account_number,
        status:     c.client_status,
        kyc:        c.kyc_status,
        balance:    c.outstanding_balance,
        created_at: c.created_at,
      })), `${activeReport}_clients`);
    } else if (activeReport === 'commission') {
      exportCSV(agents.map(a => ({
        name:             a.full_name,
        email:            a.email,
        region:           a.region,
        commission_rate:  a.commission_rate,
        total_sales:      a.total_sales,
        total_commission: a.total_commission,
        status:           a.agent_status,
      })), 'commission_agents');
    } else if (activeReport === 'payroll') {
      exportCSV(payrollRecords.map(p => {
        // employee could be in either employees array or agents array
        const emp = [...employees, ...agents].find(e => e.id === p.employee_id);
        return {
          employee:   emp?.full_name || p.employee_id || '',
          department: emp?.department || emp?.region || '',
          pay_month:  p.pay_month,
          gross:      p.gross_salary,
          paye:       p.paye,
          nssf:       p.nssf,
          shif:       p.shif,
          net:        p.net_salary,
          status:     p.status,
        };
      }), 'payroll_summary');
    } else if (activeReport === 'hr') {
      // nssf_number is encrypted and is not on the employee row, so it has to be
      // decrypted for this export. One batched call rather than one per row.
      // A failure here must not silently ship a CSV with a blank NSSF column
      // that looks like the numbers were never recorded.
      const pii = await fetchEmployeePiiBatch(employees.map(e => e.id));
      if (!pii.ok) {
        window.alert(
          `Could not decrypt NSSF numbers for this export: ${pii.error}

Nothing has been exported.`,
        );
        return;
      }
      exportCSV(employees.map(e => ({
        name:        e.full_name,
        email:       e.email,
        role:        e.role,
        department:  e.department,
        type:        e.employment_type,
        basic:       e.basic_salary,
        housing:     e.housing_allowance,
        transport:   e.transport_allowance,
        kra_pin:     e.kra_pin,
        nssf:        pii.values[e.id]?.nssf_number || '',
        status:      e.is_active ? 'active' : 'inactive',
        date_joined: e.date_joined,
      })), 'hr_employees');
    }
  };

  return (
    <div className="space-y-5 print:space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">Reports Hub</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isBuilder ? 'Build a report from any module, then keep it' : 'Financial and operational reports'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Export is per-report and hard-coded below; the builder chooses its
              own columns, so it carries its own export. Print is generic — it
              lifts whatever is inside .print-report-content, which the builder
              renders too — so it stays for both. */}
          {!isBuilder && (
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Icon name="Download" size={14} color="currentColor" />
            Export CSV
          </button>
          )}
          <button
           onClick={() => {
              const reportEl = document.querySelector('.print-report-content');
              if (!reportEl) { window.print(); return; }

              const printWindow = window.open('', '_blank');
              printWindow.document.write(`
                <!DOCTYPE html>
                <html>
                  <head>
                    <title>Ararat Report</title>
                    <style>
                      body { font-family: sans-serif; padding: 24px; color: #111; }
                      table { width: 100%; border-collapse: collapse; font-size: 12px; }
                      th { background: #f3f4f6; padding: 8px 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: #6b7280; border-bottom: 1px solid #e5e7eb; }
                      td { padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 12px; color: #374151; }
                      tr:hover td { background: #f9fafb; }
                      h3 { font-size: 18px; margin: 0 0 4px; }
                      p { font-size: 12px; color: #6b7280; margin: 0 0 16px; }
                      .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
                      .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }
                      .card-label { font-size: 10px; text-transform: uppercase; color: #6b7280; margin-bottom: 4px; }
                      .card-value { font-size: 20px; font-weight: bold; color: #111; }
                      @media print { body { padding: 12px; } }
                    </style>
                  </head>
                  <body>
                    <div style="margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #e5e7eb;">
                      <strong style="font-size:20px;">Ararat</strong>
                      <span style="font-size:12px;color:#6b7280;margin-left:12px;">Report printed on ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                    </div>
                    ${reportEl.innerHTML}
                  </body>
                </html>
              `);
              printWindow.document.close();
              printWindow.focus();
              setTimeout(() => {
                printWindow.print();
                printWindow.close();
              }, 500);
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Icon name="Printer" size={14} color="currentColor" />
            Print
          </button>
        </div>
      </div>

      {/* Global date range filter. The builder carries its own period control
          — showing two would leave the user guessing which one applied. */}
      <div className={`bg-card border border-border rounded-xl px-5 py-4 ${isBuilder ? 'hidden' : ''}`}>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Date Range</p>
            <div className="flex gap-1 flex-wrap">
              {[
                { value: 'all',     label: 'All Time'   },
                { value: 'today',   label: 'Today'      },
                { value: 'weekly',  label: 'This Week'  },
                { value: 'monthly', label: 'This Month' },
                { value: 'yearly',  label: 'This Year'  },
                { value: 'custom',  label: 'Custom'     },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setDateRange(opt.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    dateRange === opt.value
                      ? 'bg-primary text-white'
                      : 'bg-muted text-muted-foreground hover:text-foreground border border-border'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {dateRange === 'custom' && (
            <div className="flex items-end gap-2">
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">From</p>
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  className="bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">To</p>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                  className="bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
          )}

          {dateRange !== 'all' && (
            <p className="text-xs text-muted-foreground pb-1.5">
              Showing {filteredPayments.length} payments · {filteredClients.length} clients · {filteredAssets.length} assets
            </p>
          )}
        </div>
      </div>

      {/* Report selector */}
      <div className="flex gap-2 flex-wrap">
        {reports.map(r => (
          <button key={r.id} onClick={() => setActiveReport(r.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border transition-all ${
              activeReport === r.id
                ? 'border-primary/30 text-primary bg-primary/8'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
            style={activeReport === r.id ? { background: 'rgba(26,86,219,0.08)' } : {}}>
            <Icon name={r.icon} size={13} color="currentColor" />
            {r.label}
          </button>
        ))}
      </div>

      {/* Report content — filtered data passed to each report */}
      <div className="print-report-content">
        {/* Self-fetching and self-exporting: the builder chooses its own
            source, so the hub's shared arrays and date range do not apply to
            it and its toolbar is hidden above. */}
        {activeReport === 'builder'     && <ReportBuilder />}
        {activeReport === 'vat'         && <VATReport />}
        {activeReport === 'cashflow'    && <CashFlowReport />}
        {activeReport === 'inventory'   && <InventoryReport   assets={filteredAssets} />}
        {activeReport === 'portfolio'   && <ClientPortfolioReport clients={filteredClients} payments={filteredPayments} />}
        {activeReport === 'commission'  && <CommissionReport  agents={agents} payments={filteredPayments} assets={filteredAssets} />}
        {activeReport === 'collections' && <DailyCollectionsReport payments={filteredPayments} />}
        {activeReport === 'adherence'   && <InstallmentAdherenceReport clients={filteredClients} />}
        {activeReport === 'aging'       && <AgingAnalysisReport clients={filteredClients} payments={filteredPayments} />}
        {activeReport === 'payroll'     && <PayrollSummaryReport agents={agents} employees={employees} payrollRecords={payrollRecords} />}
        {activeReport === 'hr'          && <HRReport employees={employees} payrollRecords={payrollRecords} />}
        {/* Self-fetching: staff activity comes from audit_logs, not from the
            props this hub is handed, so it takes absolute date bounds instead
            of one of the pre-filtered arrays. */}
        {activeReport === 'staff-activity' && (
          <StaffActivityReport
            from={activeDateRange?.from || null}
            to={activeDateRange?.to || null}
            onExport={exportCSV}
          />
        )}
      </div>
    </div>
  );
};

export default ReportsHub;

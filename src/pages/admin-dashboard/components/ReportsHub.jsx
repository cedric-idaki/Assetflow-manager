import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import Icon from '../../../components/AppIcon';

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

// ─── REPORT: VAT REPORT ───────────────────────────────────────────────────────
const VATReport = ({ payments, assets }) => {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));

  const filtered = payments.filter(p => {
    const d = new Date(p.payment_date || p.created_at);
    return d.toISOString().slice(0, 7) === period && p.payment_status === 'completed';
  });

  const taxableRevenue = filtered.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
  const outputVAT      = taxableRevenue * 0.16;
  const inputVAT       = outputVAT * 0.4;
  const netVAT         = outputVAT - inputVAT;

  const rows = filtered.slice(0, 20).map(p => [
    fmtDate(p.payment_date || p.created_at),
    p.reference_number || '—',
    p.payment_method || '—',
    fmt(p.amount),
    fmt(parseFloat(p.amount || 0) * 0.16),
    <span className="text-emerald-600 font-semibold">Standard Rate 16%</span>,
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">VAT Report</h3>
          <p className="text-xs text-muted-foreground">Output and input VAT summary for filing</p>
        </div>
        <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
          className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Taxable Revenue"  value={fmt(taxableRevenue)} icon="TrendingUp"  color="text-foreground" bg="bg-blue-100 dark:bg-blue-900/30" />
        <KpiCard label="Output VAT (16%)" value={fmt(outputVAT)}      icon="ArrowUpRight" color="text-red-600"   bg="bg-red-100 dark:bg-red-900/30" />
        <KpiCard label="Input VAT (Est.)" value={fmt(inputVAT)}       icon="ArrowDownLeft" color="text-emerald-600" bg="bg-emerald-100 dark:bg-emerald-900/30" />
        <KpiCard label="Net VAT Payable"  value={fmt(netVAT)}         icon="Receipt"      color="text-primary"   bg="bg-primary/10" />
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 dark:bg-amber-900/20 dark:border-amber-800">
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">VAT Return Due</p>
        <p className="text-xs text-amber-700 dark:text-amber-500 mt-1">
          VAT for {new Date(period + '-01').toLocaleString('default', { month: 'long', year: 'numeric' })} is due by the 20th of the following month. Net VAT payable: <strong>{fmt(netVAT)}</strong>
        </p>
      </div>

      <Table headers={['Date', 'Reference', 'Method', 'Amount', 'VAT Amount', 'Rate']} rows={rows} empty="No transactions in selected period" />
    </div>
  );
};

// ─── REPORT: CASH FLOW ────────────────────────────────────────────────────────
const CashFlowReport = ({ payments }) => {
  const [months] = useState(6);

  const getLast6Months = () => {
    const result = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      result.push(d.toISOString().slice(0, 7));
    }
    return result;
  };

  const monthlyData = getLast6Months().map(m => {
    const inflows  = payments.filter(p => (p.payment_date || p.created_at || '').startsWith(m) && p.payment_status === 'completed').reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    const outflows = inflows * 0.35; // estimated expenses
    return { month: new Date(m + '-01').toLocaleString('default', { month: 'short', year: '2-digit' }), inflows, outflows, net: inflows - outflows };
  });

  const totalInflows  = monthlyData.reduce((s, m) => s + m.inflows, 0);
  const totalOutflows = monthlyData.reduce((s, m) => s + m.outflows, 0);
  const netCashflow   = totalInflows - totalOutflows;
  const maxVal        = Math.max(...monthlyData.map(m => m.inflows), 1);

  const rows = monthlyData.map(m => [
    m.month,
    <span className="text-emerald-600 font-semibold">{fmt(m.inflows)}</span>,
    <span className="text-red-500">{fmt(m.outflows)}</span>,
    <span className={`font-bold ${m.net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmt(m.net)}</span>,
    <div className="flex items-center gap-2 min-w-24">
      <Bar pct={(m.inflows / maxVal) * 100} color="bg-emerald-500" />
    </div>,
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-foreground">Cash Flow Statement</h3>
        <p className="text-xs text-muted-foreground">6-month cash inflows and outflows summary</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
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

      <Table headers={['Month', 'Inflows', 'Outflows', 'Net Cash Flow', 'Trend']} rows={rows} />
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

      <div className="grid grid-cols-3 gap-4">
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

      <div className="grid grid-cols-3 gap-4">
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
const PayrollSummaryReport = ({ agents }) => {
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

  const calcPAYE = (gross) => {
    if (gross <= 24000)  return 0;
    if (gross <= 32333)  return (gross - 24000) * 0.10;
    if (gross <= 500000) return 833 + (gross - 32333) * 0.25;
    return 833 + 116917 * 0.25 + (gross - 500000) * 0.30;
  };

  const depts = profiles.reduce((acc, p) => {
    const dept = p.role || 'other';
    if (!acc[dept]) acc[dept] = { dept, count: 0, grossPay: 0, netPay: 0, paye: 0 };
    const basic    = parseFloat(p.basic_salary || 0);
    const housing  = parseFloat(p.housing_allowance || 0);
    const transport= parseFloat(p.transport_allowance || 0);
    const gross    = basic + housing + transport;
    const paye     = calcPAYE(gross);
    const nssf     = Math.min(gross * 0.06, 1080);
    const sha      = gross * 0.0275;
    const levy     = gross * 0.015;
    const net      = gross - paye - nssf - sha - levy;
    acc[dept].count++;
    acc[dept].grossPay += gross;
    acc[dept].netPay   += net;
    acc[dept].paye     += paye;
    return acc;
  }, {});

  const deptList     = Object.values(depts);
  const totalGross   = deptList.reduce((s, d) => s + d.grossPay, 0);
  const totalNet     = deptList.reduce((s, d) => s + d.netPay, 0);
  const totalPAYE    = deptList.reduce((s, d) => s + d.paye, 0);
  const totalStaff   = profiles.length;

  const rows = profiles.slice(0, 30).map(p => {
    const basic     = parseFloat(p.basic_salary || 0);
    const housing   = parseFloat(p.housing_allowance || 0);
    const transport = parseFloat(p.transport_allowance || 0);
    const gross     = basic + housing + transport;
    const paye      = calcPAYE(gross);
    const nssf      = Math.min(gross * 0.06, 1080);
    const sha       = gross * 0.0275;
    const levy      = gross * 0.015;
    const net       = gross - paye - nssf - sha - levy;
    return [
      <span className="font-semibold text-foreground">{p.full_name || '—'}</span>,
      <span className="capitalize text-muted-foreground text-xs">{p.role || '—'}</span>,
      <span className="font-mono">{fmt(basic)}</span>,
      <span className="font-mono">{fmt(gross)}</span>,
      <span className="font-mono text-red-500">{fmt(paye)}</span>,
      <span className="font-mono text-emerald-600 font-semibold">{fmt(net)}</span>,
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${p.is_active !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
        {p.is_active !== false ? 'Active' : 'Inactive'}
      </span>,
    ];
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-foreground">Payroll Summary Report</h3>
          <p className="text-xs text-muted-foreground">Total payroll cost by department and period</p>
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
          <p className="text-sm text-muted-foreground">No payroll data found. Add salary details in HR Management.</p>
        </div>
      ) : (
        <Table
          headers={['Employee', 'Role', 'Basic Salary', 'Gross Pay', 'PAYE', 'Net Pay', 'Status']}
          rows={rows}
          empty="No employees found"
        />
      )}
    </div>
  );
};


// ─── MAIN REPORTS PAGE ────────────────────────────────────────────────────────
const ReportsHub = ({ assets = [], payments = [], agents = [], clients = [] }) => {
  const [activeReport, setActiveReport] = useState('vat');

  const reports = [
    { id: 'vat',         label: 'VAT Report',            icon: 'Receipt' },
    { id: 'cashflow',    label: 'Cash Flow',             icon: 'TrendingUp' },
    { id: 'inventory',   label: 'Inventory Movement',    icon: 'Package' },
    { id: 'portfolio',   label: 'Client Portfolio',      icon: 'Users' },
    { id: 'commission',  label: 'Commission Report',     icon: 'Award' },
    { id: 'collections', label: 'Daily Collections',     icon: 'CreditCard' },
    { id: 'adherence',   label: 'Installment Adherence', icon: 'Calendar' },
    { id: 'aging',        label: 'Aging Analysis',         icon: 'AlertCircle' },
    { id: 'payroll',      label: 'Payroll Summary',         icon: 'Users' },
  ];

  const handlePrint = () => window.print();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Reports Hub</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Financial and operational reports</p>
        </div>
        <button onClick={handlePrint}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <Icon name="Printer" size={14} color="currentColor" />
          Print Report
        </button>
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

      {/* Report content */}
      <div>
        {activeReport === 'vat'         && <VATReport payments={payments} assets={assets} />}
        {activeReport === 'cashflow'    && <CashFlowReport payments={payments} />}
        {activeReport === 'inventory'   && <InventoryReport assets={assets} />}
        {activeReport === 'portfolio'   && <ClientPortfolioReport clients={clients} payments={payments} />}
        {activeReport === 'commission'  && <CommissionReport agents={agents} payments={payments} assets={assets} />}
        {activeReport === 'collections' && <DailyCollectionsReport payments={payments} />}
        {activeReport === 'adherence'   && <InstallmentAdherenceReport clients={clients} />}
        {activeReport === 'aging'       && <AgingAnalysisReport clients={clients} payments={payments} />}
        {activeReport === 'payroll'     && <PayrollSummaryReport agents={agents} />}
      </div>
    </div>
  );
};

export default ReportsHub;

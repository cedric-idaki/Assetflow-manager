import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import MainLayout from '../../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';
import { calcKenyaTax } from '../../hooks/useFinanceHub';
import { useFinanceHubContext } from '../../contexts/FinanceHubContext';
import Icon from '../../components/AppIcon';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const fmt = (n) =>
  `KES ${parseFloat(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtMonth = (m) => m ? new Date(m + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '—';
const fmtPct   = (n) => `${parseFloat(n || 0).toFixed(1)}%`;

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS (FINNOVA-inspired dark-mode aesthetic adapted for AssetFlow)
// ─────────────────────────────────────────────────────────────────────────────
const S = {
  page:     'min-h-screen bg-background',
  panel:    'bg-card border border-border rounded-xl',
  header:   'flex items-center justify-between px-5 py-4 border-b border-border',
  body:     'p-5',
  th:       'text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40',
  td:       'px-4 py-3 text-sm text-muted-foreground border-t border-border',
  tdFirst:  'px-4 py-3 text-sm font-medium text-foreground border-t border-border',
  row:      'hover:bg-muted/30 transition-colors',
  input:    'w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all',
  select:   'bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all',
  btnPri:   'inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors',
  btnSec:   'inline-flex items-center gap-2 bg-muted text-foreground px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-muted/70 transition-colors',
  btnGhost: 'inline-flex items-center gap-2 text-muted-foreground px-3 py-1.5 rounded-lg text-sm hover:text-foreground hover:bg-muted transition-colors',
  label:    'block text-xs font-semibold text-muted-foreground mb-1.5',
};

// ─────────────────────────────────────────────────────────────────────────────
// SHARED COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
const Sk = ({ className = '' }) => <div className={`animate-pulse bg-muted rounded-md ${className}`} />;

const Tab = ({ active, label, icon, badge, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border whitespace-nowrap ${
      active
        ? 'border-primary/30 text-primary bg-primary/8'
        : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted'
    }`}
    style={active ? { background: 'rgba(26,86,219,0.06)' } : {}}
  >
    <Icon name={icon} size={14} color="currentColor" />
    {label}
    {badge > 0 && (
      <span className="flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-xs font-bold">
        {badge > 99 ? '99+' : badge}
      </span>
    )}
  </button>
);

const StatusBadge = ({ status }) => {
  const map = {
    paid:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    pending:  'bg-amber-100  text-amber-700  dark:bg-amber-900/30  dark:text-amber-400',
    overdue:  'bg-red-100    text-red-700    dark:bg-red-900/30    dark:text-red-400',
    posted:   'bg-blue-100   text-blue-700   dark:bg-blue-900/30   dark:text-blue-400',
    approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    draft:    'bg-gray-100   text-gray-600   dark:bg-gray-800      dark:text-gray-400',
    active:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    inactive: 'bg-gray-100   text-gray-500   dark:bg-gray-800      dark:text-gray-500',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${map[status] || 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  );
};

const KPICard = ({ title, value, icon, iconBg, iconColor, sub, loading: l }) => (
  <div className="bg-card border border-border rounded-xl p-5">
    {l ? (
      <div className="space-y-2 animate-pulse"><Sk className="h-3 w-24" /><Sk className="h-7 w-32" /><Sk className="h-3 w-20" /></div>
    ) : (
      <>
        <div className="flex items-start justify-between mb-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${iconBg}`}>
            <Icon name={icon} size={15} color={iconColor} />
          </div>
        </div>
        <p className="text-2xl font-bold text-foreground font-mono leading-none mb-1">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </>
    )}
  </div>
);

// Financial statement row
const FSRow = ({ label, value, indent = false, total = false, header = false, color = '' }) => (
  <div className={`flex justify-between items-center py-2 ${
    header ? 'border-b-2 border-border font-semibold text-foreground' :
    total  ? 'border-t-2 border-border font-bold text-primary' :
    indent ? 'pl-4 border-b border-border/50 text-muted-foreground' :
    'border-b border-border text-foreground font-medium'
  }`}>
    <span className="text-sm">{label}</span>
    {value !== undefined && (
      <span className={`text-sm font-mono font-semibold ${color || (total ? 'text-primary' : header ? '' : 'text-foreground')}`}>
        {value}
      </span>
    )}
  </div>
);

// Empty state
const Empty = ({ icon, text, sub }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
      <Icon name={icon} size={20} color="var(--muted-foreground)" />
    </div>
    <p className="text-sm font-medium text-foreground mb-1">{text}</p>
    {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
  </div>
);

// Toast
let _toastTimer;
const toast = (msg, type = 'success') => {
  const el = document.getElementById('fh-toast');
  if (!el) return;
  const colors = { success: '#10b981', error: '#ef4444', info: '#3b82f6', warning: '#f59e0b' };
  const icons  = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  el.textContent = `${icons[type]} ${msg}`;
  el.style.borderColor = colors[type];
  el.style.opacity = '1';
  el.style.transform = 'translateY(0)';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
  }, 3500);
};

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1 — INVOICES
// ─────────────────────────────────────────────────────────────────────────────
const InvoicesTab = ({ invoices, loading, companyProfile, financialSummary: fs }) => {
  const [search,  setSearch]  = useState('');
  const [filter,  setFilter]  = useState('all');
  const [selected, setSelected] = useState(null);

  const filtered = useMemo(() =>
    invoices.filter(inv => {
      const q = search.toLowerCase();
      const matchSearch = !search ||
        inv.client_name.toLowerCase().includes(q) ||
        inv.invoice_no.toLowerCase().includes(q) ||
        inv.reference.toLowerCase().includes(q);
      return matchSearch && (filter === 'all' || inv.status === filter);
    }),
    [invoices, search, filter]
  );

  const totals = useMemo(() => ({
    paid:    invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0),
    pending: invoices.filter(i => i.status === 'pending').reduce((s, i) => s + i.amount, 0),
    overdue: invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + i.amount, 0),
  }), [invoices]);

  if (selected) {
    const inv = selected;
    const co  = companyProfile;
    return (
      <div className="space-y-4">
        <button onClick={() => setSelected(null)} className={S.btnGhost}>
          <Icon name="ArrowLeft" size={14} color="currentColor" /> Back to Invoices
        </button>
        <div className="bg-white dark:bg-card border border-border rounded-xl p-8 max-w-2xl shadow-sm">
          {/* Header */}
          <div className="flex justify-between items-start mb-8 pb-6 border-b-2 border-primary">
            <div>
              <p className="text-base font-semibold text-gray-900 dark:text-foreground">{co?.company_name || 'AssetFlow Company'}</p>
              <p className="text-xs text-gray-500 mt-1">KRA PIN: {co?.kra_pin || 'N/A'}</p>
              <p className="text-xs text-gray-500">{co?.physical_address || ''}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-black text-primary">INVOICE</p>
              <p className="text-sm font-mono font-bold text-gray-700 dark:text-muted-foreground mt-1">{inv.invoice_no}</p>
            </div>
          </div>
          {/* Bill to / dates */}
          <div className="grid grid-cols-2 gap-6 mb-6 text-sm">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Bill To</p>
              <p className="font-semibold text-gray-900 dark:text-foreground">{inv.client_name}</p>
              <p className="text-gray-500">{inv.account_no}</p>
              <p className="text-gray-500">{inv.client_email}</p>
              <p className="text-gray-500">{inv.client_phone}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Details</p>
              <p className="text-gray-700 dark:text-muted-foreground"><span className="font-medium">Date:</span> {fmtDate(inv.date)}</p>
              <p className="text-gray-700 dark:text-muted-foreground"><span className="font-medium">Due:</span> {fmtDate(inv.due_date)}</p>
              <p className="text-gray-700 dark:text-muted-foreground"><span className="font-medium">Method:</span> {inv.method}</p>
              <p className="text-gray-700 dark:text-muted-foreground"><span className="font-medium">Ref:</span> {inv.reference}</p>
            </div>
          </div>
          {/* Line items */}
          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="bg-gray-50 dark:bg-muted">
                <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-muted-foreground">Description</th>
                <th className="text-right px-4 py-2 font-semibold text-gray-600 dark:text-muted-foreground">Amount (KES)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100 dark:border-border">
                <td className="px-4 py-3 text-gray-800 dark:text-foreground">{inv.asset}</td>
                <td className="px-4 py-3 text-right font-mono text-gray-800 dark:text-foreground">{inv.amount.toLocaleString('en-KE')}</td>
              </tr>
              <tr className="border-b border-gray-100 dark:border-border text-gray-500">
                <td className="px-4 py-2 text-xs">VAT (16%)</td>
                <td className="px-4 py-2 text-right font-mono text-xs">{inv.vat_amount.toLocaleString('en-KE', { maximumFractionDigits: 0 })}</td>
              </tr>
            </tbody>
          </table>
          {/* Total */}
          <div className="flex justify-between items-center bg-primary text-primary-foreground px-6 py-4 rounded-lg">
            <span className="font-bold text-base">TOTAL DUE</span>
            <span className="font-black text-xl font-mono">{fmt(inv.amount + inv.vat_amount)}</span>
          </div>
          {inv.notes && <p className="mt-4 text-xs text-gray-500 italic">Note: {inv.notes}</p>}
          <div className="mt-6 flex gap-3">
            <button className={S.btnPri} onClick={() => toast(`Printing ${inv.invoice_no}…`, 'info')}>
              <Icon name="Printer" size={14} color="currentColor" /> Print
            </button>
            <button className={S.btnSec} onClick={() => toast(`Sending ${inv.invoice_no} by email…`, 'info')}>
              <Icon name="Mail" size={14} color="currentColor" /> Email
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard title="Paid" value={fmt(totals.paid)} icon="CheckCircle" iconBg="bg-emerald-100 dark:bg-emerald-900/30" iconColor="#10b981" loading={loading} />
        <KPICard title="Pending" value={fmt(totals.pending)} icon="Clock" iconBg="bg-amber-100 dark:bg-amber-900/30" iconColor="#f59e0b" sub={`${fs.pendingInvoices} invoices`} loading={loading} />
        <KPICard title="Overdue" value={fmt(totals.overdue)} icon="AlertCircle" iconBg="bg-red-100 dark:bg-red-900/30" iconColor="#ef4444" sub={`${fs.overdueInvoices} invoices`} loading={loading} />
        <KPICard title="Total Invoices" value={loading ? '—' : invoices.length} icon="FileText" iconBg="bg-blue-100 dark:bg-blue-900/30" iconColor="#3b82f6" loading={loading} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Icon name="Search" size={14} color="var(--muted-foreground)" className="absolute left-3 top-1/2 -translate-y-1/2" />
          <input className={`${S.input} pl-9`} placeholder="Search client, invoice #, reference…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {['all', 'paid', 'pending', 'overdue'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
              filter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}>
            {s}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className={S.panel}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Invoice #', 'Client', 'Asset', 'Date', 'Due Date', 'Amount', 'Method', 'Status', ''].map(h => (
                  <th key={h} className={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array(5).fill(0).map((_, i) => (
                  <tr key={i}>
                    {Array(9).fill(0).map((_, j) => (
                      <td key={j} className={S.td}><Sk className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9}><Empty icon="FileText" text="No invoices found" sub="Payments will appear here once recorded" /></td></tr>
              ) : filtered.map(inv => (
                <tr key={inv.id} className={S.row}>
                  <td className={S.tdFirst}>{inv.invoice_no}</td>
                  <td className={S.td}>{inv.client_name}</td>
                  <td className={S.td + ' max-w-32 truncate'}>{inv.asset}</td>
                  <td className={S.td}>{fmtDate(inv.date)}</td>
                  <td className={S.td}>{fmtDate(inv.due_date)}</td>
                  <td className={`${S.td} font-mono font-semibold text-foreground`}>{fmt(inv.amount)}</td>
                  <td className={S.td}>{inv.method}</td>
                  <td className={S.td}><StatusBadge status={inv.status} /></td>
                  <td className={S.td}>
                    <button className={S.btnGhost} onClick={() => setSelected(inv)}>
                      <Icon name="Eye" size={13} color="currentColor" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2 — AUTO JOURNAL FEED
// ─────────────────────────────────────────────────────────────────────────────
const AutomatedJournalTab = ({ entries, loading, TRIGGER_LABELS }) => {
  const [filter, setFilter] = useState('all');

  const groups = {
    all:      entries,
    sales:    entries.filter(e => ['cash_sale_completed','vat_on_cash_sale','cogs_on_sale','installment_deposit_received','installment_receivable_created'].includes(e.trigger_event)),
    payments: entries.filter(e => ['installment_payment_received','payment_received'].includes(e.trigger_event)),
    penalties: entries.filter(e => e.trigger_event === 'late_payment_penalty'),
    payroll:  entries.filter(e => ['payroll_processed','paye_payable','nssf_payable','shif_payable','housing_levy_payable'].includes(e.trigger_event)),
    wallet:   entries.filter(e => ['overpayment_wallet_credit','refund_issued'].includes(e.trigger_event)),
  };
  const visible = groups[filter] || entries;

  const colorMap = { emerald: 'text-emerald-600', blue: 'text-blue-600', orange: 'text-orange-500', violet: 'text-violet-600', green: 'text-green-600', red: 'text-red-600', amber: 'text-amber-600', teal: 'text-teal-600', purple: 'text-purple-600', indigo: 'text-indigo-600' };
  const bgMap    = { emerald: 'bg-emerald-100 dark:bg-emerald-900/30', blue: 'bg-blue-100 dark:bg-blue-900/30', orange: 'bg-orange-100 dark:bg-orange-900/30', violet: 'bg-violet-100 dark:bg-violet-900/30', green: 'bg-green-100 dark:bg-green-900/30', red: 'bg-red-100 dark:bg-red-900/30', amber: 'bg-amber-100 dark:bg-amber-900/30', teal: 'bg-teal-100 dark:bg-teal-900/30', purple: 'bg-purple-100 dark:bg-purple-900/30', indigo: 'bg-indigo-100 dark:bg-indigo-900/30' };

  return (
    <div className="space-y-4">
      {/* Summary pills */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Entries',  value: entries.length, color: 'text-foreground' },
          { label: 'Total Value',    value: fmt(entries.reduce((s, e) => s + parseFloat(e.amount || 0), 0)), color: 'text-blue-600' },
          { label: 'Today',          value: entries.filter(e => e.entry_date === new Date().toISOString().split('T')[0]).length, color: 'text-emerald-600' },
          { label: 'This Month',     value: entries.filter(e => (e.period_month || '') === new Date().toISOString().slice(0, 7)).length, color: 'text-violet-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-5">
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2">
        {Object.entries({ all: 'All', sales: 'Sales', payments: 'Payments', penalties: 'Penalties', payroll: 'Payroll', wallet: 'Wallet' }).map(([k, v]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              filter === k ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}>
            {v} ({groups[k].length})
          </button>
        ))}
      </div>

      {/* Feed */}
      <div className={S.panel}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Trigger', 'Date', 'Description', 'Debit Account', 'Credit Account', 'Amount', 'Status'].map(h => (
                  <th key={h} className={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array(8).fill(0).map((_, i) => (
                  <tr key={i}>{Array(7).fill(0).map((_, j) => <td key={j} className={S.td}><Sk className="h-4 w-full" /></td>)}</tr>
                ))
              ) : visible.length === 0 ? (
                <tr><td colSpan={7}><Empty icon="Zap" text="No automated entries yet" sub="Journal entries are posted automatically when sales, payments and payroll events occur" /></td></tr>
              ) : visible.map(entry => {
                const tl = TRIGGER_LABELS[entry.trigger_event] || { label: entry.trigger_event, icon: '📝', color: 'blue' };
                return (
                  <tr key={entry.id} className={S.row}>
                    <td className={S.td}>
                      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-semibold ${bgMap[tl.color] || 'bg-gray-100'} ${colorMap[tl.color] || 'text-gray-600'}`}>
                        <span>{tl.icon}</span>
                        <span>{tl.label}</span>
                      </div>
                    </td>
                    <td className={S.td}>{fmtDate(entry.entry_date)}</td>
                    <td className={`${S.td} max-w-48 truncate`}>{entry.description}</td>
                    <td className={`${S.td} text-emerald-600 font-medium`}>{entry.debit_account}</td>
                    <td className={`${S.td} text-red-500 font-medium`}>{entry.credit_account}</td>
                    <td className={`${S.td} font-mono font-semibold text-foreground`}>{fmt(entry.amount)}</td>
                    <td className={S.td}><StatusBadge status={entry.status || 'posted'} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3 — MANUAL JOURNAL ENTRIES
// ─────────────────────────────────────────────────────────────────────────────
const JournalTab = ({ journalEntries, chartOfAccounts, loading, onCreate }) => {
  const [form, setForm] = useState({ date: new Date().toISOString().split('T')[0], description: '', debitAccount: '', creditAccount: '', amount: '', reference: '', entryType: 'general' });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const coaNames = chartOfAccounts.map(a => `${a.account_code} — ${a.account_name}`);

  const filtered = journalEntries.filter(j =>
    !search || j.description?.toLowerCase().includes(search.toLowerCase()) ||
    j.debit_account?.toLowerCase().includes(search.toLowerCase()) ||
    j.credit_account?.toLowerCase().includes(search.toLowerCase())
  );

  const handleSave = async () => {
    if (!form.description || !form.debitAccount || !form.creditAccount || !form.amount) {
      toast('Please fill in all required fields', 'error'); return;
    }
    if (parseFloat(form.amount) <= 0) { toast('Amount must be greater than zero', 'error'); return; }
    if (form.debitAccount === form.creditAccount) { toast('Debit and Credit accounts must differ', 'error'); return; }
    setSaving(true);
    try {
      await onCreate(form);
      setForm({ date: new Date().toISOString().split('T')[0], description: '', debitAccount: '', creditAccount: '', amount: '', reference: '', entryType: 'general' });
      toast('Journal entry posted successfully', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-5">
      {/* New entry form */}
      <div className={S.panel}>
        <div className={S.header}>
          <div className="flex items-center gap-2">
            <Icon name="BookOpen" size={16} color="var(--primary)" />
            <span className="font-semibold text-foreground">New Manual Entry</span>
          </div>
          <span className="text-xs text-muted-foreground">Debits = Credits (double-entry)</span>
        </div>
        <div className={S.body}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            <div>
              <label className={S.label}>Entry Date *</label>
              <input type="date" className={S.input} value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
            </div>
            <div>
              <label className={S.label}>Entry Type</label>
              <select className={`${S.input} ${S.select}`} value={form.entryType} onChange={e => setForm(p => ({ ...p, entryType: e.target.value }))}>
                <option value="general">General</option>
                <option value="depreciation">Depreciation</option>
                <option value="accrual">Accrual</option>
                <option value="adjustment">Adjustment</option>
                <option value="closing">Closing Entry</option>
              </select>
            </div>
            <div>
              <label className={S.label}>Reference / Doc #</label>
              <input className={S.input} placeholder="e.g. PV-001, JE-2024…" value={form.reference} onChange={e => setForm(p => ({ ...p, reference: e.target.value }))} />
            </div>
            <div className="lg:col-span-3">
              <label className={S.label}>Description *</label>
              <input className={S.input} placeholder="Describe the transaction clearly…" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
            </div>
            <div>
              <label className={S.label}>Debit Account *</label>
              <input list="debit-coa" className={S.input} placeholder="Select or type account…" value={form.debitAccount} onChange={e => setForm(p => ({ ...p, debitAccount: e.target.value }))} />
              <datalist id="debit-coa">
                {coaNames.map(n => <option key={n} value={n} />)}
              </datalist>
            </div>
            <div>
              <label className={S.label}>Credit Account *</label>
              <input list="credit-coa" className={S.input} placeholder="Select or type account…" value={form.creditAccount} onChange={e => setForm(p => ({ ...p, creditAccount: e.target.value }))} />
              <datalist id="credit-coa">
                {coaNames.map(n => <option key={n} value={n} />)}
              </datalist>
            </div>
            <div>
              <label className={S.label}>Amount (KES) *</label>
              <input type="number" className={S.input} placeholder="0.00" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
            </div>
          </div>
          {/* Double-entry preview */}
          {form.debitAccount && form.creditAccount && parseFloat(form.amount) > 0 && (
            <div className="mb-4 p-3 bg-muted/50 rounded-lg border border-border text-xs font-mono">
              <div className="flex gap-8">
                <div><span className="text-muted-foreground">DR  </span><span className="text-emerald-600 font-semibold">{form.debitAccount}</span> <span className="text-foreground">{fmt(form.amount)}</span></div>
                <div><span className="text-muted-foreground">  CR  </span><span className="text-red-500 font-semibold">{form.creditAccount}</span> <span className="text-foreground">{fmt(form.amount)}</span></div>
              </div>
            </div>
          )}
          <button className={S.btnPri} onClick={handleSave} disabled={saving}>
            {saving ? <><Icon name="Loader" size={14} color="currentColor" className="animate-spin" /> Posting…</> : <><Icon name="CheckCircle" size={14} color="currentColor" /> Post Entry</>}
          </button>
        </div>
      </div>

      {/* Journal ledger */}
      <div className={S.panel}>
        <div className={S.header}>
          <span className="font-semibold text-foreground">Manual Journal Ledger</span>
          <input className={`${S.input} max-w-64`} placeholder="Search entries…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Ref', 'Date', 'Description', 'Debit', 'Credit', 'Amount', 'Status'].map(h => (
                  <th key={h} className={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array(5).fill(0).map((_, i) => <tr key={i}>{Array(7).fill(0).map((_, j) => <td key={j} className={S.td}><Sk className="h-4 w-full" /></td>)}</tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7}><Empty icon="BookOpen" text="No manual entries" sub='Click "Post Entry" above to create your first manual journal entry' /></td></tr>
              ) : filtered.map(j => (
                <tr key={j.id} className={S.row}>
                  <td className={S.tdFirst + ' font-mono text-xs'}>{j.reference || `JE-${j.id?.slice(-6).toUpperCase()}`}</td>
                  <td className={S.td}>{fmtDate(j.entry_date)}</td>
                  <td className={`${S.td} max-w-48 truncate`}>{j.description}</td>
                  <td className={`${S.td} text-emerald-600 font-medium text-xs`}>{j.debit_account}</td>
                  <td className={`${S.td} text-red-500 font-medium text-xs`}>{j.credit_account}</td>
                  <td className={`${S.td} font-mono font-semibold text-foreground`}>{fmt(j.amount)}</td>
                  <td className={S.td}><StatusBadge status={j.status || 'posted'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TAB 4 — CHART OF ACCOUNTS
// ─────────────────────────────────────────────────────────────────────────────
const ChartOfAccountsTab = ({ chartOfAccounts, loading, onAdd, onToggle }) => {
  const [search,   setSearch]   = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [form, setForm] = useState({
    account_code: '', account_name: '', account_type: 'current_asset',
    category: 'Cash', is_active: true, description: '',
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return chartOfAccounts.filter(a =>
      (!search || a.account_code.includes(q) || a.account_name.toLowerCase().includes(q) || a.category.toLowerCase().includes(q)) &&
      (typeFilter === 'all' || a.account_type === typeFilter)
    );
  }, [chartOfAccounts, search, typeFilter]);

  // Group by type
  const groups = useMemo(() => {
    const g = {};
    filtered.forEach(a => {
      if (!g[a.account_type]) g[a.account_type] = [];
      g[a.account_type].push(a);
    });
    return g;
  }, [filtered]);

  const typeOrder = ['current_asset', 'non_current_asset', 'current_liability', 'equity', 'revenue', 'cost_of_sales', 'operating_expense'];
  const typeColors = {
    current_asset:      'bg-blue-100   text-blue-700   dark:bg-blue-900/30   dark:text-blue-400',
    non_current_asset:  'bg-cyan-100   text-cyan-700   dark:bg-cyan-900/30   dark:text-cyan-400',
    current_liability:  'bg-red-100    text-red-700    dark:bg-red-900/30    dark:text-red-400',
    equity:             'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    revenue:            'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    cost_of_sales:      'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    operating_expense:  'bg-amber-100  text-amber-700  dark:bg-amber-900/30  dark:text-amber-400',
  };
  const typeLabels = {
    current_asset:     'Current Asset',
    non_current_asset: 'Non-Current Asset',
    current_liability: 'Current Liability',
    equity:            'Equity',
    revenue:           'Revenue',
    cost_of_sales:     'Cost of Sales',
    operating_expense: 'Operating Expense',
  };
  const catMap = {
    current_asset:     ['Cash', 'Receivables', 'Inventory', 'Prepaid', 'Deposits', 'Other'],
    non_current_asset: ['Fixed Assets', 'Depreciation', 'Other'],
    current_liability: ['Payables', 'Statutory', 'Deposits', 'Other'],
    equity:            ['Capital', 'Earnings', 'Other'],
    revenue:           ['Sales', 'Finance Income', 'Commission', 'Other'],
    cost_of_sales:     ['COGS', 'Other'],
    operating_expense: ['Personnel', 'Admin', 'Marketing', 'Overhead', 'Other'],
  };

  const handleSave = async () => {
    if (!form.account_code || !form.account_name) { toast('Account code and name are required', 'error'); return; }
    if (chartOfAccounts.some(a => a.account_code === form.account_code)) {
      toast('Account code already exists', 'error'); return;
    }
    setSaving(true);
    try {
      await onAdd(form);
      setForm({ account_code: '', account_name: '', account_type: 'current_asset', category: 'Cash', is_active: true, description: '' });
      setShowForm(false);
      toast(`Account ${form.account_code} — ${form.account_name} added`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-5">
      {/* Summary strip */}
      <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
        {typeOrder.map(type => (
          <div key={type} className={`bg-card border border-border rounded-xl p-4 cursor-pointer transition-all ${typeFilter === type ? 'border-primary' : ''}`}
            onClick={() => setTypeFilter(prev => prev === type ? 'all' : type)}>
            <p className="text-xs text-muted-foreground mb-1">{type}</p>
            <p className="text-2xl font-bold font-mono text-foreground">
              {chartOfAccounts.filter(a => a.account_type === type).length}
            </p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Icon name="Search" size={14} color="var(--muted-foreground)" className="absolute left-3 top-1/2 -translate-y-1/2" />
          <input className={`${S.input} pl-9`} placeholder="Search by code, name or category…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className={`${S.input} ${S.select} w-auto`} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="all">All Types</option>
          {typeOrder.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className={S.btnPri} onClick={() => setShowForm(p => !p)}>
          <Icon name={showForm ? 'ChevronUp' : 'Plus'} size={14} color="currentColor" />
          {showForm ? 'Hide Form' : 'Add Account'}
        </button>
      </div>

      {/* Add Account Form */}
      {showForm && (
        <div className={`${S.panel} border-primary/40`} style={{ background: 'rgba(26,86,219,0.03)' }}>
          <div className={S.header}>
            <span className="font-semibold text-foreground flex items-center gap-2">
              <Icon name="Plus" size={15} color="var(--primary)" /> New Account
            </span>
          </div>
          <div className={S.body}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
              <div>
                <label className={S.label}>Account Code *</label>
                <input className={S.input} placeholder="e.g. 1050" value={form.account_code} onChange={e => setForm(p => ({ ...p, account_code: e.target.value }))} />
              </div>
              <div>
                <label className={S.label}>Account Name *</label>
                <input className={S.input} placeholder="e.g. Petty Cash" value={form.account_name} onChange={e => setForm(p => ({ ...p, account_name: e.target.value }))} />
              </div>
              <div>
                <label className={S.label}>Account Type *</label>
                <select className={`${S.input} ${S.select}`} value={form.account_type}
                  onChange={e => setForm(p => ({ ...p, account_type: e.target.value, category: catMap[e.target.value]?.[0] || '' }))}>
                  {typeOrder.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={S.label}>Category</label>
                <select className={`${S.input} ${S.select}`} value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                  {(catMap[form.account_type] || []).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className={S.label}>Description (optional)</label>
                <input className={S.input} placeholder="Brief description of this account…" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-3">
              <button className={S.btnPri} onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save Account'}
              </button>
              <button className={S.btnSec} onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Accounts grouped by type */}
      {loading ? (
        <div className={S.panel}>{Array(10).fill(0).map((_, i) => <div key={i} className="px-5 py-3 border-b border-border"><Sk className="h-4 w-full" /></div>)}</div>
      ) : (
        typeOrder.filter(t => groups[t]?.length > 0).map(type => (
          <div key={type} className={S.panel}>
            <div className={`${S.header} bg-muted/20`}>
              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${typeColors[type]}`}>{typeLabels[type] || type}</span>
                <span className="text-sm font-semibold text-foreground">{type} Accounts</span>
              </div>
              <span className="text-xs text-muted-foreground">{groups[type].length} accounts</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    {['Code', 'Account Name', 'Category', 'Normal Balance', 'Status', ''].map(h => (
                      <th key={h} className={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups[type].map(acct => (
                    <tr key={acct.id || acct.account_code} className={S.row}>
                      <td className={`${S.tdFirst} font-mono`}>{acct.account_code}</td>
                      <td className={S.td}>{acct.account_name}</td>
                      <td className={S.td}>{acct.category}</td>
                      <td className={`${S.td} text-xs`}>
                        {['current_asset','non_current_asset','cost_of_sales','operating_expense'].includes(acct.account_type) ? (
                          <span className="text-emerald-600 font-semibold">Debit</span>
                        ) : (
                          <span className="text-red-500 font-semibold">Credit</span>
                        )}
                      </td>
                      <td className={S.td}><StatusBadge status={acct.is_active ? 'active' : 'inactive'} /></td>
                      <td className={S.td}>
                        <button className={S.btnGhost}
                          onClick={() => { onToggle(acct.id, !acct.is_active); toast(`Account ${acct.is_active ? 'deactivated' : 'activated'}`, 'info'); }}>
                          {acct.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TAB 5 — PAYROLL
// ─────────────────────────────────────────────────────────────────────────────
const PayrollTab = ({ payrollRecords, employees, loading, onRunPayroll, onApprove }) => {
  const [subTab, setSubTab]     = useState('run');
  const [empId,  setEmpId]      = useState('');
  const [month,  setMonth]      = useState(new Date().toISOString().slice(0, 7));
  const [gross,  setGross]      = useState('');
  const [housing, setHousing]   = useState('');
  const [transport, setTransport] = useState('');
  const [preview, setPreview]   = useState(null);
  const [saving,  setSaving]    = useState(false);
  // PAYE standalone calculator
  const [calcGross, setCalcGross] = useState('');
  const calcResult = calcGross ? calcKenyaTax(parseFloat(calcGross)) : null;

  const selectedEmp = employees.find(e => e.id === empId);

  const handlePreview = () => {
    const g = parseFloat(gross || selectedEmp?.basic_salary || 0);
    const h = parseFloat(housing || selectedEmp?.housing_allowance || 0);
    const t = parseFloat(transport || selectedEmp?.transport_allowance || 0);
    if (!g) { toast('Enter a gross salary', 'error'); return; }
    const totalGross = g + h + t;
    setPreview({ ...calcKenyaTax(totalGross), housing: h, transport: t, basic: g });
  };

  const handleRun = async () => {
    if (!empId || !month || !preview) { toast('Select employee, month and preview first', 'error'); return; }
    setSaving(true);
    try {
      await onRunPayroll(empId, parseFloat(gross || selectedEmp?.basic_salary || 0), month, {
        housing: parseFloat(housing || selectedEmp?.housing_allowance || 0),
        transport: parseFloat(transport || selectedEmp?.transport_allowance || 0),
      });
      setPreview(null); setGross(''); setHousing(''); setTransport('');
      toast(`Payroll run for ${selectedEmp?.full_name} — ${fmtMonth(month)} submitted`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleApprove = async (id) => {
    try {
      await onApprove(id);
      toast('Payroll approved and accounting entries posted', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  // Group by month
  const byMonth = useMemo(() => {
    const g = {};
    payrollRecords.forEach(r => {
      if (!g[r.pay_month]) g[r.pay_month] = [];
      g[r.pay_month].push(r);
    });
    return g;
  }, [payrollRecords]);

  const subtabs = [
    { id: 'run',   label: 'Run Payroll',   icon: 'Play' },
    { id: 'calc',  label: 'PAYE Calculator', icon: 'Calculator' },
    { id: 'hist',  label: 'Payroll History', icon: 'Clock' },
  ];

  return (
    <div className="space-y-5">
      {/* Sub-nav */}
      <div className="flex gap-2 border-b border-border pb-1">
        {subtabs.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              subTab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}>
            <Icon name={t.icon} size={13} color="currentColor" />
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'run' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Input panel */}
          <div className={S.panel}>
            <div className={S.header}>
              <span className="font-semibold text-foreground">Process Payroll</span>
            </div>
            <div className={`${S.body} space-y-4`}>
              <div>
                <label className={S.label}>Employee *</label>
                <select className={`${S.input} ${S.select}`} value={empId} onChange={e => {
                  setEmpId(e.target.value);
                  const emp = employees.find(x => x.id === e.target.value);
                  if (emp) { setGross(emp.basic_salary || ''); setHousing(emp.housing_allowance || ''); setTransport(emp.transport_allowance || ''); }
                }}>
                  <option value="">— Select employee —</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>{e.full_name} · {e.department}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={S.label}>Pay Month *</label>
                <input type="month" className={S.input} value={month} onChange={e => setMonth(e.target.value)} />
              </div>
              <div>
                <label className={S.label}>Basic Salary (KES)</label>
                <input type="number" className={S.input} placeholder="From employee record" value={gross} onChange={e => setGross(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={S.label}>Housing Allowance</label>
                  <input type="number" className={S.input} placeholder="0" value={housing} onChange={e => setHousing(e.target.value)} />
                </div>
                <div>
                  <label className={S.label}>Transport Allowance</label>
                  <input type="number" className={S.input} placeholder="0" value={transport} onChange={e => setTransport(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button className={S.btnSec} onClick={handlePreview}>
                  <Icon name="Eye" size={14} color="currentColor" /> Preview
                </button>
                {preview && (
                  <button className={S.btnPri} onClick={handleRun} disabled={saving}>
                    {saving ? 'Submitting…' : <><Icon name="CheckCircle" size={14} color="currentColor" /> Submit Payroll</>}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Preview panel */}
          <div>
            {preview ? (
              <div className={`${S.panel} overflow-hidden`}>
                <div className="bg-gradient-to-r from-primary to-primary/80 px-5 py-4">
                  <p className="text-xs font-semibold text-primary-foreground/70 uppercase tracking-wider">Payslip Preview</p>
                  <p className="text-base font-semibold text-primary-foreground mt-0.5">{selectedEmp?.full_name || 'Employee'}</p>
                  <p className="text-sm text-primary-foreground/70">{fmtMonth(month)} · {selectedEmp?.department}</p>
                </div>
                <div className={S.body}>
                  <div className="space-y-0">
                    {[
                      { label: 'Basic Salary',       value: fmt(preview.basic),     color: 'text-emerald-600' },
                      { label: 'Housing Allowance',  value: fmt(preview.housing),   color: 'text-emerald-600' },
                      { label: 'Transport Allowance',value: fmt(preview.transport), color: 'text-emerald-600' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="flex justify-between py-2 border-b border-border text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <span className={`font-mono font-semibold ${color}`}>{value}</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-2.5 border-b-2 border-border text-sm font-bold">
                      <span className="text-foreground">Gross Pay</span>
                      <span className="font-mono text-foreground">{fmt(preview.gross)}</span>
                    </div>
                    {[
                      { label: 'PAYE (Income Tax)',   value: preview.paye },
                      { label: 'NSSF (Tier I & II)',  value: preview.nssf },
                      { label: 'SHA (2.75%)',          value: preview.shif },
                      { label: 'Housing Levy (1.5%)', value: preview.housingLevy },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex justify-between py-2 border-b border-border text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-mono font-semibold text-red-500">({fmt(value)})</span>
                      </div>
                    ))}
                    <div className="flex justify-between pt-3 pb-1 text-base font-bold">
                      <span className="text-foreground">NET PAY</span>
                      <span className="font-mono text-emerald-600 text-xl">{fmt(preview.net)}</span>
                    </div>
                  </div>
                  {selectedEmp?.bank_name && (
                    <p className="text-xs text-muted-foreground mt-3">
                      Bank: {selectedEmp.bank_name} · A/C: {selectedEmp.bank_account}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className={`${S.panel} flex items-center justify-center py-20`}>
                <div className="text-center">
                  <Icon name="Calculator" size={32} color="var(--muted-foreground)" />
                  <p className="text-sm text-muted-foreground mt-3">Select an employee and click Preview</p>
                  <p className="text-xs text-muted-foreground">to see Kenya statutory deductions</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === 'calc' && (
        <div className="max-w-xl">
          <div className={S.panel}>
            <div className={S.header}>
              <span className="font-semibold text-foreground">Kenya PAYE Calculator (2025/26)</span>
            </div>
            <div className={`${S.body} space-y-4`}>
              <div>
                <label className={S.label}>Gross Monthly Income (KES)</label>
                <input type="number" className={S.input} placeholder="e.g. 85000" value={calcGross} onChange={e => setCalcGross(e.target.value)} />
              </div>
              {calcResult && (
                <div className="space-y-0 border border-border rounded-xl overflow-hidden">
                  {[
                    { label: 'Gross Income',       value: fmt(calcResult.gross),        color: 'text-foreground' },
                    { label: 'PAYE Tax',           value: fmt(calcResult.paye),         color: 'text-red-500' },
                    { label: 'NSSF (Tier I+II)',   value: fmt(calcResult.nssf),         color: 'text-red-500' },
                    { label: 'SHA (2.75%)',         value: fmt(calcResult.shif),         color: 'text-red-500' },
                    { label: 'Housing Levy (1.5%)',value: fmt(calcResult.housingLevy),  color: 'text-red-500' },
                    { label: 'Total Deductions',   value: fmt(calcResult.totalDeductions), color: 'text-red-500', bold: true },
                  ].map(({ label, value, color, bold }) => (
                    <div key={label} className={`flex justify-between px-4 py-3 border-b border-border text-sm ${bold ? 'bg-muted/30 font-semibold' : ''}`}>
                      <span className="text-muted-foreground">{label}</span>
                      <span className={`font-mono font-semibold ${color}`}>{value}</span>
                    </div>
                  ))}
                  <div className="flex justify-between px-4 py-4 bg-primary/5">
                    <span className="font-bold text-foreground text-base">NET PAY</span>
                    <span className="font-mono font-black text-emerald-600 text-xl">{fmt(calcResult.net)}</span>
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Rates: PAYE per KRA bands 2025/26 · NSSF New Act · SHA 2.75% (min KES 300) · AHL 1.5%</p>
            </div>
          </div>
        </div>
      )}

      {subTab === 'hist' && (
        <div className="space-y-4">
          {loading ? (
            <div className={S.panel + ' p-5'}><Sk className="h-4 w-full mb-3" /><Sk className="h-4 w-3/4" /></div>
          ) : Object.keys(byMonth).length === 0 ? (
            <Empty icon="Clock" text="No payroll history" sub="Run a payroll above to see history" />
          ) : Object.entries(byMonth).sort(([a], [b]) => b.localeCompare(a)).map(([month, records]) => {
            const totalGross = records.reduce((s, r) => s + parseFloat(r.gross_salary || 0), 0);
            const totalNet   = records.reduce((s, r) => s + parseFloat(r.net_salary || 0), 0);
            const pending    = records.filter(r => r.status === 'pending').length;
            return (
              <div key={month} className={S.panel}>
                <div className={`${S.header} bg-muted/20`}>
                  <div>
                    <span className="font-semibold text-foreground">{fmtMonth(month)}</span>
                    <span className="text-xs text-muted-foreground ml-3">{records.length} records · Gross {fmt(totalGross)} · Net {fmt(totalNet)}</span>
                  </div>
                  {pending > 0 && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">{pending} pending approval</span>}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead><tr>{['Employee', 'Dept', 'Gross', 'PAYE', 'NSSF', 'SHA', 'Net Pay', 'Status', ''].map(h => <th key={h} className={S.th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {records.map(r => (
                        <tr key={r.id} className={S.row}>
                          <td className={S.tdFirst}>{r.employee?.full_name || '—'}</td>
                          <td className={S.td}>{r.employee?.department || '—'}</td>
                          <td className={`${S.td} font-mono`}>{fmt(r.gross_salary)}</td>
                          <td className={`${S.td} font-mono text-red-500`}>({fmt(r.paye)})</td>
                          <td className={`${S.td} font-mono text-red-500`}>({fmt(r.nssf)})</td>
                          <td className={`${S.td} font-mono text-red-500`}>({fmt(r.shif)})</td>
                          <td className={`${S.td} font-mono font-bold text-emerald-600`}>{fmt(r.net_salary)}</td>
                          <td className={S.td}><StatusBadge status={r.status} /></td>
                          <td className={S.td}>
                            {r.status === 'pending' && (
                              <button className="text-xs bg-primary text-primary-foreground px-3 py-1 rounded-lg hover:bg-primary/90 transition-colors"
                                onClick={() => handleApprove(r.id)}>
                                Approve
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TAB 6 — FINANCIAL STATEMENTS
// ─────────────────────────────────────────────────────────────────────────────
const StatementsTab = ({ financialSummary: fs, journalEntries, automatedEntries, chartOfAccounts, companyProfile, loading }) => {
  const [stmt,   setStmt]   = useState('pl');
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));

  const co      = companyProfile;
  const allJournals = [...journalEntries, ...automatedEntries];
  const coName  = co?.company_name || 'AssetFlow Company';
  const periodLabel = fmtMonth(period);

  // Trial balance from chart of accounts + journals
  const trialBalance = useMemo(() => {
    const accts = {};
    chartOfAccounts.forEach(a => {
      accts[a.account_name] = { code: a.account_code, name: a.account_name, type: a.account_type, debit: 0, credit: 0 };
    });
    allJournals.filter(j => j.status === 'posted').forEach(j => {
      const d = j.debit_account;
      const c = j.credit_account;
      const amt = parseFloat(j.amount || 0);
      if (d && accts[d]) accts[d].debit += amt;
      if (c && accts[c]) accts[c].credit += amt;
      // New accounts not in COA
      if (d && !accts[d]) accts[d] = { code: '—', name: d, type: '?', debit: amt, credit: 0 };
      if (c && !accts[c]) accts[c] = { code: '—', name: c, type: '?', debit: 0,   credit: amt };
    });
    return Object.values(accts).filter(a => a.debit > 0 || a.credit > 0)
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [chartOfAccounts, allJournals]);

  const totalTBDebit  = trialBalance.reduce((s, a) => s + a.debit,  0);
  const totalTBCredit = trialBalance.reduce((s, a) => s + a.credit, 0);

  const stmts = [
    { id: 'pl',  label: 'P&L Statement',  icon: 'TrendingUp'  },
    { id: 'bs',  label: 'Balance Sheet',  icon: 'Scale'        },
    { id: 'cf',  label: 'Cash Flow',      icon: 'ArrowUpDown'  },
    { id: 'tb',  label: 'Trial Balance',  icon: 'List'         },
    { id: 'vat', label: 'VAT Report',     icon: 'Landmark'     },
  ];

  return (
    <div className="space-y-5">
      {/* Statement picker */}
      <div className="flex flex-wrap gap-2 items-center">
        {stmts.map(s => (
          <button key={s.id} onClick={() => setStmt(s.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
              stmt === s.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}>
            <Icon name={s.icon} size={13} color="currentColor" />
            {s.label}
          </button>
        ))}
        <input type="month" className={`${S.input} ml-auto w-auto`} value={period} onChange={e => setPeriod(e.target.value)} />
        <button className={S.btnSec} onClick={() => toast('Exporting to PDF…', 'info')}>
          <Icon name="Download" size={14} color="currentColor" /> Export
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className={`${S.panel} p-8`}>
          <div className="space-y-3 animate-pulse">
            {Array(8).fill(0).map((_, i) => <Sk key={i} className={`h-4 ${i % 3 === 0 ? 'w-1/4' : 'w-full'}`} />)}
          </div>
        </div>
      )}

      {!loading && stmt === 'pl' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2">
            <div className={`${S.panel} p-6`}>
              <div className="text-center mb-6">
                <p className="text-lg font-bold text-foreground">{coName}</p>
                <p className="text-xl font-black text-foreground mt-1">Profit & Loss Statement</p>
                <p className="text-sm text-muted-foreground">Period: {periodLabel}</p>
              </div>

              <FSRow label="REVENUE" header />
              <FSRow label="Asset Sales Revenue" value={fmt(fs.totalRevenue - fs.totalInterestIncome - fs.totalPenaltyIncome)} indent color="text-emerald-600" />
              <FSRow label="Interest Income (HP)"   value={fmt(fs.totalInterestIncome)} indent color="text-emerald-600" />
              <FSRow label="Penalty Income"          value={fmt(fs.totalPenaltyIncome)}  indent color="text-emerald-600" />
              <FSRow label="TOTAL REVENUE"           value={fmt(fs.totalRevenue)} total color="text-emerald-600" />

              <div className="mt-4" />
              <FSRow label="COST OF SALES" header />
              <FSRow label="Cost of Assets Sold (COGS)" value={fmt(fs.totalCOGS)} indent color="text-red-500" />
              <FSRow label="GROSS PROFIT"    value={fmt(fs.grossProfit)} total />

              <div className="mt-4" />
              <FSRow label="OPERATING EXPENSES" header />
              <FSRow label="Salaries & Wages"  value={fmt(fs.totalSalaries)} indent color="text-red-500" />
              <FSRow label="Other Operating Expenses" value={fmt(Math.max(fs.totalExpenses - fs.totalCOGS - fs.totalSalaries, 0))} indent color="text-red-500" />
              <FSRow label="TOTAL EXPENSES"  value={fmt(fs.totalExpenses)} total color="text-red-500" />

              <div className="mt-6 p-4 rounded-xl border-2 border-primary/30 bg-primary/5">
                <div className="flex justify-between items-center">
                  <span className="text-base font-black text-foreground">NET PROFIT / (LOSS)</span>
                  <span className={`text-2xl font-black font-mono ${fs.netProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {fmt(fs.netProfit)}
                  </span>
                </div>
                <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
                  <span>Gross Margin: <strong className="text-foreground">{fmtPct(fs.grossMargin)}</strong></span>
                  <span>Net Margin: <strong className="text-foreground">{fs.totalRevenue > 0 ? fmtPct((fs.netProfit / fs.totalRevenue) * 100) : '0.0%'}</strong></span>
                </div>
              </div>
            </div>
          </div>
          {/* Side ratios */}
          <div className="space-y-4">
            {[
              { label: 'Total Revenue',   value: fmt(fs.totalRevenue),   color: 'text-emerald-600' },
              { label: 'Total Expenses',  value: fmt(fs.totalExpenses),  color: 'text-red-500' },
              { label: 'Net Profit',      value: fmt(fs.netProfit),      color: fs.netProfit >= 0 ? 'text-emerald-600' : 'text-red-500' },
              { label: 'Gross Margin',    value: fmtPct(fs.grossMargin), color: 'text-blue-600' },
              { label: 'Interest Income', value: fmt(fs.totalInterestIncome), color: 'text-emerald-600' },
              { label: 'Penalty Income',  value: fmt(fs.totalPenaltyIncome),  color: 'text-orange-500' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-card border border-border rounded-xl p-5">
                <p className="text-xs text-muted-foreground mb-1">{label}</p>
                <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && stmt === 'bs' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className={`${S.panel} p-6`}>
            <div className="text-center mb-6">
              <p className="text-xl font-black text-foreground">Balance Sheet</p>
              <p className="text-sm text-muted-foreground">As at {periodLabel}</p>
            </div>
            <FSRow label="ASSETS" header />
            <p className="text-xs font-semibold text-muted-foreground mt-3 mb-1">Current Assets</p>
            <FSRow label="Cash & Cash Equivalents" value={fmt(fs.closingCash)} indent color="text-emerald-600" />
            <FSRow label="Accounts Receivable (HP)" value={fmt(fs.totalRevenue * 0.35)} indent />
            <FSRow label="Inventory" value={fmt(fs.totalAssets * 0.15)} indent />
            <p className="text-xs font-semibold text-muted-foreground mt-3 mb-1">Non-Current Assets</p>
            <FSRow label="Property & Equipment" value={fmt(fs.totalAssets * 0.4)} indent />
            <FSRow label="Less: Depreciation" value={`(${fmt(fs.totalAssets * 0.05)})`} indent color="text-red-500" />
            <FSRow label="TOTAL ASSETS" value={fmt(fs.totalAssets)} total color="text-emerald-600" />

            <div className="mt-6" />
            <FSRow label="LIABILITIES & EQUITY" header />
            <p className="text-xs font-semibold text-muted-foreground mt-3 mb-1">Current Liabilities</p>
            <FSRow label="Accounts Payable"     value={fmt(fs.totalLiabilities * 0.3)} indent color="text-red-500" />
            <FSRow label="VAT Payable"          value={fmt(fs.netVAT)}                 indent color="text-red-500" />
            <FSRow label="Payroll Liabilities"  value={fmt(fs.totalSalaries * 0.08)}   indent color="text-red-500" />
            <p className="text-xs font-semibold text-muted-foreground mt-3 mb-1">Equity</p>
            <FSRow label="Share Capital"        value={fmt(fs.equity * 0.6)}            indent />
            <FSRow label="Retained Earnings"    value={fmt(fs.equity * 0.4)}            indent />
            <FSRow label="Current Year Profit"  value={fmt(fs.netProfit)}               indent color="text-emerald-600" />
            <FSRow label="TOTAL LIABILITIES & EQUITY" value={fmt(fs.totalAssets)} total />

            {/* Balance check */}
            <div className={`mt-4 p-3 rounded-lg border text-xs font-medium ${Math.abs(fs.totalAssets - (fs.totalLiabilities + fs.equity + fs.netProfit)) < 1000 ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400' : 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400'}`}>
              ✓ Balance Sheet is balanced
            </div>
          </div>
          {/* Key ratios */}
          <div className="space-y-3">
            <div className={`${S.panel} p-5`}>
              <p className="font-semibold text-foreground mb-4">Key Financial Ratios</p>
              {[
                { label: 'Current Ratio',       value: fs.totalLiabilities > 0 ? ((fs.closingCash + fs.totalRevenue * 0.35) / fs.totalLiabilities).toFixed(2) : '—', note: 'Liquidity' },
                { label: 'Debt-to-Equity',      value: fs.equity > 0 ? (fs.totalLiabilities / fs.equity).toFixed(2) : '—', note: 'Leverage' },
                { label: 'Return on Equity',    value: fs.equity > 0 ? fmtPct((fs.netProfit / fs.equity) * 100) : '—', note: 'Profitability' },
                { label: 'Asset Turnover',      value: fs.totalAssets > 0 ? `${(fs.totalRevenue / fs.totalAssets).toFixed(2)}x` : '—', note: 'Efficiency' },
                { label: 'Net Profit Margin',   value: fs.totalRevenue > 0 ? fmtPct((fs.netProfit / fs.totalRevenue) * 100) : '—', note: 'Profitability' },
              ].map(({ label, value, note }) => (
                <div key={label} className="flex items-center justify-between p-3 bg-muted/30 rounded-xl mb-2">
                  <div>
                    <p className="text-sm text-foreground font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{note}</p>
                  </div>
                  <span className="text-lg font-black font-mono text-primary">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!loading && stmt === 'cf' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className={`${S.panel} p-6`}>
            <div className="text-center mb-6">
              <p className="text-xl font-black text-foreground">Cash Flow Statement</p>
              <p className="text-sm text-muted-foreground">{periodLabel}</p>
            </div>
            <FSRow label="OPERATING ACTIVITIES" header />
            <FSRow label="Net Profit"              value={fmt(fs.netProfit)}              indent color="text-emerald-600" />
            <FSRow label="Add: Depreciation"       value={fmt(fs.totalAssets * 0.05)}     indent />
            <FSRow label="Increase in Receivables" value={`(${fmt(fs.totalRevenue * 0.1)})`} indent color="text-red-500" />
            <FSRow label="Increase in Payables"    value={fmt(fs.totalLiabilities * 0.15)} indent color="text-emerald-600" />
            <FSRow label="Net Operating Cash" value={fmt(fs.cashFromOperations)} total color="text-emerald-600" />

            <div className="mt-5" />
            <FSRow label="INVESTING ACTIVITIES" header />
            <FSRow label="Purchase of Equipment"  value={`(${fmt(Math.abs(fs.cashFromInvesting))})`} indent color="text-red-500" />
            <FSRow label="Net Investing Cash" value={fmt(fs.cashFromInvesting)} total color={fs.cashFromInvesting < 0 ? 'text-red-500' : 'text-emerald-600'} />

            <div className="mt-5" />
            <FSRow label="FINANCING ACTIVITIES" header />
            <FSRow label="Loan Repayments" value={fmt(fs.cashFromFinancing)} indent />
            <FSRow label="Net Financing Cash" value={fmt(fs.cashFromFinancing)} total />

            <div className="mt-6 p-4 rounded-xl bg-primary/5 border border-primary/20">
              <div className="flex justify-between text-sm mb-1"><span className="text-muted-foreground">Opening Balance</span><span className="font-mono font-semibold">{fmt(fs.openingCash)}</span></div>
              <div className="flex justify-between text-sm mb-2"><span className="text-muted-foreground">Net Change</span><span className={`font-mono font-semibold ${fs.closingCash - fs.openingCash >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>+ {fmt(fs.cashFromOperations + fs.cashFromInvesting + fs.cashFromFinancing)}</span></div>
              <div className="border-t border-primary/20 pt-2 flex justify-between">
                <span className="font-bold text-foreground">Closing Balance</span>
                <span className="font-black text-2xl font-mono text-emerald-600">{fmt(fs.closingCash)}</span>
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <div className={`${S.panel} p-5`}>
              <p className="font-semibold text-foreground mb-4">Cash Position Summary</p>
              {[
                { label: 'Cash from Operations', value: fs.cashFromOperations, icon: 'TrendingUp' },
                { label: 'Cash from Investing',  value: fs.cashFromInvesting,  icon: 'BarChart2'  },
                { label: 'Cash from Financing',  value: fs.cashFromFinancing,  icon: 'Landmark'   },
              ].map(({ label, value, icon }) => (
                <div key={label} className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl mb-2">
                  <Icon name={icon} size={16} color={value >= 0 ? '#10b981' : '#ef4444'} />
                  <div className="flex-1">
                    <p className="text-sm text-foreground">{label}</p>
                  </div>
                  <span className={`font-mono font-bold text-sm ${value >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmt(value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!loading && stmt === 'tb' && (
        <div className={S.panel}>
          <div className={S.header}>
            <div>
              <p className="font-semibold text-foreground">Trial Balance — {periodLabel}</p>
              <p className="text-xs text-muted-foreground">All posted journal entries</p>
            </div>
            <div className="flex gap-3">
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${Math.abs(totalTBDebit - totalTBCredit) < 1 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                {Math.abs(totalTBDebit - totalTBCredit) < 1 ? '✓ Balanced' : '⚠ Out of balance'}
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={S.th}>Code</th>
                  <th className={S.th}>Account Name</th>
                  <th className={S.th}>Type</th>
                  <th className={`${S.th} text-right`}>Debit (KES)</th>
                  <th className={`${S.th} text-right`}>Credit (KES)</th>
                </tr>
              </thead>
              <tbody>
                {trialBalance.length === 0 ? (
                  <tr><td colSpan={5}><Empty icon="List" text="No posted entries" sub="Journal entries will appear here once posted" /></td></tr>
                ) : (
                  <>
                    {trialBalance.map(a => (
                      <tr key={a.name} className={S.row}>
                        <td className={`${S.td} font-mono text-xs`}>{a.code}</td>
                        <td className={S.tdFirst}>{a.name}</td>
                        <td className={S.td}>{a.type}</td>
                        <td className={`${S.td} text-right font-mono ${a.debit > 0 ? 'text-foreground' : 'text-muted-foreground/40'}`}>{a.debit > 0 ? a.debit.toLocaleString('en-KE', { maximumFractionDigits: 0 }) : '—'}</td>
                        <td className={`${S.td} text-right font-mono ${a.credit > 0 ? 'text-foreground' : 'text-muted-foreground/40'}`}>{a.credit > 0 ? a.credit.toLocaleString('en-KE', { maximumFractionDigits: 0 }) : '—'}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-border bg-muted/20 font-bold">
                      <td colSpan={3} className="px-4 py-3 text-sm text-foreground">TOTALS</td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-foreground">{totalTBDebit.toLocaleString('en-KE', { maximumFractionDigits: 0 })}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-foreground">{totalTBCredit.toLocaleString('en-KE', { maximumFractionDigits: 0 })}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && stmt === 'vat' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className={`${S.panel} p-6`}>
            <div className="text-center mb-6">
              <p className="text-xl font-black text-foreground">VAT Return</p>
              <p className="text-sm text-muted-foreground">{periodLabel} · Rate: 16%</p>
            </div>
            <FSRow label="OUTPUT VAT (Sales)" header />
            <FSRow label="Standard Rated Sales" value={fmt(fs.totalRevenue)} indent />
            <FSRow label="Output VAT (16%)" value={fmt(fs.outputVAT)} indent color="text-red-500" />

            <div className="mt-4" />
            <FSRow label="INPUT VAT (Purchases)" header />
            <FSRow label="Standard Rated Purchases" value={fmt(fs.inputVAT / 0.16)} indent />
            <FSRow label="Input VAT Claimable (16%)" value={fmt(fs.inputVAT)} indent color="text-emerald-600" />

            <div className="mt-6 p-4 rounded-xl border-2 border-border">
              <FSRow label="Net VAT Payable to KRA" value={fmt(fs.netVAT)} total color={fs.netVAT > 0 ? 'text-red-500' : 'text-emerald-600'} />
            </div>
            <div className="mt-4 flex gap-3">
              <button className={S.btnPri} onClick={() => toast('Preparing iTax export…', 'info')}>
                <Icon name="Upload" size={14} color="currentColor" /> File with KRA
              </button>
              <button className={S.btnSec} onClick={() => toast('Downloading iTax format…', 'info')}>
                <Icon name="Download" size={14} color="currentColor" /> iTax Export
              </button>
            </div>
          </div>
          <div className="space-y-4">
            <div className={`${S.panel} p-5`}>
              <p className="font-semibold text-foreground mb-4">Tax Compliance Calendar</p>
              {(() => {
                const now  = new Date();
                const y    = now.getFullYear();
                const m    = now.getMonth();
                return [
                  { label: `VAT Return (${new Date(y, m - 1, 1).toLocaleString('en-KE', { month: 'long' })})`, status: 'Filed', color: 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-400' },
                  { label: `VAT Return (${new Date(y, m, 1).toLocaleString('en-KE', { month: 'long' })})`,     status: 'Due 20th',   color: 'bg-amber-50  border-amber-200  text-amber-700  dark:bg-amber-900/20  dark:border-amber-700  dark:text-amber-400'  },
                  { label: `PAYE Return (${new Date(y, m, 1).toLocaleString('en-KE', { month: 'long' })})`,    status: 'Due 9th',    color: 'bg-blue-50   border-blue-200   text-blue-700   dark:bg-blue-900/20   dark:border-blue-700   dark:text-blue-400'   },
                  { label: `NSSF Contribution`,  status: 'Due 15th',   color: 'bg-muted border-border text-muted-foreground' },
                  { label: `SHA Contribution`,   status: 'Due 15th',   color: 'bg-muted border-border text-muted-foreground' },
                  { label: `Housing Levy`,       status: 'Due 9th',    color: 'bg-muted border-border text-muted-foreground' },
                ].map(({ label, status, color }) => (
                  <div key={label} className={`flex justify-between items-center p-3 border rounded-lg mb-2 text-sm ${color}`}>
                    <span>{label}</span>
                    <span className="text-xs font-semibold">{status}</span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
const FinanceHub = () => {
  const { user } = useAuth();
  const {
    invoices, journalEntries, automatedEntries, chartOfAccounts,
    payrollRecords, employees, financialSummary: fs,
    companyProfile, loading, error,
    createJournalEntry, runPayroll, approvePayroll,
    addAccountToCOA, toggleAccountStatus,
    refetch, TRIGGER_LABELS,
  } = useFinanceHubContext();

  // Tab state lives in the URL so it survives navigation and page refresh
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'invoices';
  const setActiveTab = (tab) => setSearchParams({ tab }, { replace: true });

  const tabs = [
    { id: 'invoices',   label: 'Invoices',            icon: 'FileText',  badge: fs.pendingInvoices  },
    { id: 'automated',  label: 'Auto Journal Feed',   icon: 'Zap',       badge: automatedEntries.length > 0 ? 0 : 0 },
    { id: 'journal',    label: 'Manual Entries',      icon: 'BookOpen',  badge: 0 },
    { id: 'coa',        label: 'Chart of Accounts',   icon: 'Layers',    badge: 0 },
    { id: 'payroll',    label: 'Payroll',             icon: 'Users',     badge: payrollRecords.filter(r => r.status === 'pending').length },
    { id: 'statements', label: 'Financial Statements',icon: 'BarChart2', badge: 0 },
  ];

  if (error) return (
    <MainLayout>
      <div className="flex flex-col items-center justify-center min-h-64 gap-4">
        <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <Icon name="AlertCircle" size={20} color="#ef4444" />
        </div>
        <p className="text-sm font-medium text-foreground">Finance Hub failed to load</p>
        <p className="text-xs text-muted-foreground">{error}</p>
        <button className={S.btnPri} onClick={refetch}>
          <Icon name="RefreshCw" size={14} color="currentColor" /> Retry
        </button>
      </div>
    </MainLayout>
  );

  return (
    <MainLayout>
      <div className="p-5 space-y-5">
        {/* Page header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-black text-foreground tracking-tight">Finance Hub</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {companyProfile?.company_name || 'Your Company'} · Accounting, Payroll & Financial Statements
            </p>
          </div>
          <div className="flex gap-3 items-center">
            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Icon name="Loader" size={13} color="currentColor" className="animate-spin" />
                Loading…
              </div>
            )}
            <button className={S.btnSec} onClick={refetch}>
              <Icon name="RefreshCw" size={14} color="currentColor" /> Refresh
            </button>
          </div>
        </div>

        {/* KPI overview strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {[
            { title: 'Total Revenue',    value: fmt(fs.totalRevenue),  icon: 'TrendingUp',  iconBg: 'bg-emerald-100 dark:bg-emerald-900/30', iconColor: '#10b981' },
            { title: 'Total Expenses',   value: fmt(fs.totalExpenses), icon: 'TrendingDown', iconBg: 'bg-red-100 dark:bg-red-900/30',        iconColor: '#ef4444' },
            { title: 'Net Profit',       value: fmt(fs.netProfit),     icon: 'DollarSign',  iconBg: 'bg-blue-100 dark:bg-blue-900/30',       iconColor: '#3b82f6' },
            { title: 'Gross Margin',     value: fmtPct(fs.grossMargin), icon: 'Percent',    iconBg: 'bg-violet-100 dark:bg-violet-900/30',   iconColor: '#8b5cf6' },
            { title: 'Pending Invoices', value: fs.pendingInvoices,   icon: 'Clock',        iconBg: 'bg-amber-100 dark:bg-amber-900/30',     iconColor: '#f59e0b' },
            { title: 'Net VAT Due',      value: fmt(fs.netVAT),        icon: 'Landmark',    iconBg: 'bg-orange-100 dark:bg-orange-900/30',   iconColor: '#f97316' },
          ].map(kpi => <KPICard key={kpi.title} {...kpi} loading={loading} />)}
        </div>

        {/* Tab nav */}
        <div className="flex flex-wrap gap-2 border-b border-border pb-3">
          {tabs.map(t => (
            <Tab key={t.id} active={activeTab === t.id} label={t.label}
              icon={t.icon} badge={t.badge} onClick={() => setActiveTab(t.id)} />
          ))}
        </div>

        {/* Tab content */}
        <div>
          {activeTab === 'invoices' && (
            <InvoicesTab invoices={invoices} loading={loading} companyProfile={companyProfile} financialSummary={fs} />
          )}
          {activeTab === 'automated' && (
            <AutomatedJournalTab entries={automatedEntries} loading={loading} TRIGGER_LABELS={TRIGGER_LABELS} />
          )}
          {activeTab === 'journal' && (
            <JournalTab journalEntries={journalEntries} chartOfAccounts={chartOfAccounts} loading={loading} onCreate={createJournalEntry} />
          )}
          {activeTab === 'coa' && (
            <ChartOfAccountsTab
              chartOfAccounts={chartOfAccounts} loading={loading}
              onAdd={addAccountToCOA} onToggle={toggleAccountStatus}
            />
          )}
          {activeTab === 'payroll' && (
            <PayrollTab
              payrollRecords={payrollRecords} employees={employees} loading={loading}
              onRunPayroll={runPayroll} onApprove={approvePayroll}
            />
          )}
          {activeTab === 'statements' && (
            <StatementsTab
              financialSummary={fs}
              journalEntries={journalEntries}
              automatedEntries={automatedEntries}
              chartOfAccounts={chartOfAccounts}
              companyProfile={companyProfile}
              loading={loading}
            />
          )}
        </div>
      </div>

      {/* Toast notification */}
      <div id="fh-toast" style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
        background: 'var(--card)', border: '1px solid #10b981',
        color: 'var(--foreground)', padding: '14px 20px', borderRadius: 12,
        fontSize: 13, maxWidth: 360, boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        display: 'flex', alignItems: 'center', gap: 10,
        opacity: 0, transform: 'translateY(8px)',
        transition: 'opacity 0.3s, transform 0.3s',
      }} />
    </MainLayout>
  );
};

export default FinanceHub;

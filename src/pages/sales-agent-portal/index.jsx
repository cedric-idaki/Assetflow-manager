import React, { useState } from 'react';
import Icon from '../../components/AppIcon';
import MainLayout from '../../layouts/MainLayout';
import PipelineStage from './components/PipelineStage';
import CommissionDashboard from './components/CommissionDashboard';
import ActivityFeed from './components/ActivityFeed';
import LeadRegistrationModal from './components/LeadRegistrationModal';
import CreateClientModal from './components/CreateClientModal';
import AgentActivityTrail from './components/AgentActivityTrail';
import SalesCostTracker from './components/SalesCostTracker';
import UpcomingAppointments from './components/UpcomingAppointments';
import { useSalesAgentContext } from '../../contexts/SalesAgentContext';

// ── Export Modal ─────────────────────────────────────────────────────────────
const EXPORT_PRESETS = [
  { label: 'Today',        value: 'today' },
  { label: 'This Week',    value: 'weekly' },
  { label: 'This Month',   value: 'monthly' },
  { label: 'This Year',    value: 'yearly' },
  { label: 'Custom Range', value: 'custom' },
];

const getDateRange = (preset) => {
  const now = new Date();
  const start = new Date();
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  if (preset === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (preset === 'weekly') {
    const day = now.getDay();
    start.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    start.setHours(0, 0, 0, 0);
  } else if (preset === 'monthly') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else if (preset === 'yearly') {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
  }
  return { start, end };
};

const ExportModal = ({ leads, expenses, walletTransactions, agentProfile, onClose }) => {
  const [preset, setPreset]       = useState('monthly');
  const [dataType, setDataType]   = useState('leads');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]   = useState('');

  const getFiltered = () => {
    let from, to;
    if (preset === 'custom') {
      if (!customFrom || !customTo) return [];
      from = new Date(customFrom);
      from.setHours(0, 0, 0, 0);
      to = new Date(customTo);
      to.setHours(23, 59, 59, 999);
    } else {
      const range = getDateRange(preset);
      from = range.start;
      to   = range.end;
    }

    const inRange = (dateStr) => {
      const d = new Date(dateStr);
      return d >= from && d <= to;
    };

    if (dataType === 'leads') {
      return (leads || []).filter(l => inRange(l.created_at));
    }
    if (dataType === 'clients') {
      return (leads || []).filter(l => l.stage === 'closed' && inRange(l.created_at));
    }
    if (dataType === 'expenses') {
      return (expenses || []).filter(e => inRange(e.created_at));
    }
    if (dataType === 'commissions') {
      return (walletTransactions || []).filter(t => t.type === 'commission' && inRange(t.created_at));
    }
    return [];
  };

  const buildCSV = (rows) => {
    if (!rows.length) return null;
    const colMaps = {
      leads: [
        ['Full Name',      r => r.full_name || ''],
        ['Email',          r => r.email || ''],
        ['Phone',          r => r.phone || ''],
        ['Stage',          r => (r.stage || '').replace(/_/g, ' ')],
        ['Priority',       r => r.priority || ''],
        ['Asset Interest', r => r.asset_interest || ''],
        ['Budget Range',   r => (r.budget_range || '').replace(/_/g, ' ')],
        ['Source',         r => r.source || ''],
        ['Notes',          r => (r.notes || '').replace(/,/g, ';')],
        ['Created',        r => r.created_at ? new Date(r.created_at).toLocaleDateString('en-GB') : ''],
      ],
      clients: [
        ['Full Name',      r => r.full_name || ''],
        ['Email',          r => r.email || ''],
        ['Phone',          r => r.phone || ''],
        ['Asset Interest', r => r.asset_interest || ''],
        ['Budget Range',   r => (r.budget_range || '').replace(/_/g, ' ')],
        ['Converted',      r => r.created_at ? new Date(r.created_at).toLocaleDateString('en-GB') : ''],
      ],
      expenses: [
        ['Description',    r => (r.description || '').replace(/,/g, ';')],
        ['Amount (KES)',   r => r.amount || 0],
        ['Category',       r => r.category || ''],
        ['Date',           r => r.created_at ? new Date(r.created_at).toLocaleDateString('en-GB') : ''],
      ],
      commissions: [
        ['Description',    r => (r.description || '').replace(/,/g, ';')],
        ['Amount (KES)',   r => r.amount || 0],
        ['Status',         r => r.status || ''],
        ['Date',           r => r.created_at ? new Date(r.created_at).toLocaleDateString('en-GB') : ''],
      ],
    };
    const cols = colMaps[dataType] || colMaps.leads;
    const header = cols.map(([h]) => h).join(',');
    const body   = rows.map(r => cols.map(([, fn]) => `"${fn(r)}"`).join(',')).join('\n');
    return header + '\n' + body;
  };

  const handleExport = () => {
    const rows = getFiltered();
    if (!rows.length) { alert('No records found for the selected period.'); return; }
    const csv  = buildCSV(rows);
    if (!csv) return;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const agentCode = agentProfile?.agent_code || 'agent';
    const label = EXPORT_PRESETS.find(p => p.value === preset)?.label.toLowerCase().replace(' ', '_') || preset;
    a.href     = url;
    a.download = `${agentCode}_${dataType}_${label}_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onClose();
  };

  const previewCount = getFiltered().length;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center">
              <Icon name="Download" size={18} color="#1A56DB" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Export Data</h3>
              <p className="text-xs text-muted-foreground">Download filtered records as CSV</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Data type */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">What to Export</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'leads',       label: 'All Leads',     icon: 'Target' },
                { value: 'clients',     label: 'Converted Clients', icon: 'Users' },
                { value: 'expenses',    label: 'Expenses',      icon: 'Receipt' },
                { value: 'commissions', label: 'Commissions',   icon: 'Award' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setDataType(opt.value)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                    dataType === opt.value
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/30'
                  }`}
                >
                  <Icon name={opt.icon} size={14} color="currentColor" />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date filter */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Date Range</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {EXPORT_PRESETS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setPreset(p.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    preset === p.value
                      ? 'bg-primary text-white'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">From</label>
                  <input
                    type="date"
                    value={customFrom}
                    onChange={e => setCustomFrom(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">To</label>
                  <input
                    type="date"
                    value={customTo}
                    onChange={e => setCustomTo(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Preview count */}
          <div className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm ${
            previewCount > 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-muted border-border text-muted-foreground'
          }`}>
            <Icon name={previewCount > 0 ? 'FileText' : 'AlertCircle'} size={15} color="currentColor" />
            {previewCount > 0
              ? <><span className="font-bold">{previewCount}</span> record{previewCount !== 1 ? 's' : ''} ready to export</>
              : 'No records match the selected period'
            }
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={previewCount === 0}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-all"
            style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
          >
            <Icon name="Download" size={15} color="currentColor" />
            Export {previewCount > 0 ? `${previewCount} Records` : ''}
          </button>
        </div>
      </div>
    </div>
  );
};

const PIPELINE_STAGES = ['new_lead', 'contacted', 'qualified', 'proposal_sent', 'closed'];

// ── KPI Card ──────────────────────────────────────────────────────────────────
const KPICard = ({ label, value, icon, colorClass, loading, subtext }) => (
  <div className="bg-card border border-border rounded-xl p-5">
    {loading ? (
      <div className="animate-pulse space-y-2">
        <div className="h-3 bg-muted rounded w-24" />
        <div className="h-7 bg-muted rounded w-16" />
      </div>
    ) : (
      <>
        <div className="flex items-center gap-2 mb-1">
          <Icon name={icon} size={15} color="currentColor" />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <p className={`text-2xl font-bold ${colorClass}`}>{value}</p>
        {subtext && <p className="text-xs text-muted-foreground mt-0.5">{subtext}</p>}
      </>
    )}
  </div>
);

// ── Lead Detail Modal ─────────────────────────────────────────────────────────
const LeadDetailModal = ({ lead, onClose, onStageChange, onConvertToClient }) => {
  const [newStage, setNewStage] = useState(lead?.stage || 'new_lead');
  const [saving, setSaving]     = useState(false);

  const stages = [
    { value: 'new_lead',      label: 'New Lead' },
    { value: 'contacted',     label: 'Contacted' },
    { value: 'qualified',     label: 'Qualified' },
    { value: 'proposal_sent', label: 'Proposal Sent' },
    { value: 'closed',        label: 'Closed / Converted' },
  ];

  const handleSave = async () => {
    if (newStage === lead?.stage) { onClose(); return; }
    setSaving(true);
    await onStageChange(lead.id, newStage);
    setSaving(false);
    onClose();
  };

  const fmt = (d) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-sm">
              {(lead?.full_name || 'L').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">{lead?.full_name}</h3>
              <p className="text-xs text-muted-foreground">{lead?.phone}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Email',     value: lead?.email },
              { label: 'Phone',     value: lead?.phone },
              { label: 'Budget',    value: lead?.budget_range },
              { label: 'Interest',  value: lead?.asset_interest },
              { label: 'Source',    value: lead?.source },
              { label: 'Priority',  value: lead?.priority },
              { label: 'Created',   value: fmt(lead?.created_at) },
              { label: 'Follow-up', value: fmt(lead?.follow_up_date) },
            ].filter(r => r.value).map(row => (
              <div key={row.label}>
                <p className="text-xs text-muted-foreground">{row.label}</p>
                <p className="text-sm font-medium text-foreground capitalize">{row.value}</p>
              </div>
            ))}
          </div>

          {lead?.notes && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Notes</p>
              <p className="text-sm text-foreground bg-muted rounded-lg px-3 py-2">{lead.notes}</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1">Pipeline Stage</label>
            <select
              value={newStage}
              onChange={e => setNewStage(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {stages.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-emerald-800 mb-1">🎯 Ready to convert this lead?</p>
            <p className="text-xs text-emerald-700 mb-2">
              Create a client account so they can access the portal and make payments.
            </p>
            <button
              onClick={() => { onClose(); onConvertToClient(lead); }}
              className="w-full py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
            >
              Create Client Account →
            </button>
          </div>
        </div>

        <div className="flex gap-3 px-5 pb-5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary text-primary-foreground text-sm font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            ) : (
              <Icon name="Save" size={14} color="white" />
            )}
            {saving ? 'Saving...' : 'Update Stage'}
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2.5 border border-border text-muted-foreground text-sm rounded-xl hover:bg-muted"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// ── My Clients Section ────────────────────────────────────────────────────────
const MyClientsSection = ({ leads, onCreateClient }) => {
  const closedLeads = (leads || []).filter(l => l.stage === 'closed');

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">My Clients</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Leads you converted to client accounts</p>
        </div>
        <button
          onClick={() => onCreateClient(null)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white"
          style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}
        >
          <Icon name="UserPlus" size={13} color="white" />
          New Client
        </button>
      </div>

      {closedLeads.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Icon name="Users" size={28} color="currentColor" />
          <p className="text-xs mt-2 font-medium">No converted clients yet</p>
          <p className="text-xs opacity-60 mt-0.5">Convert a lead or create a new client account</p>
          <button
            onClick={() => onCreateClient(null)}
            className="mt-3 text-xs text-emerald-600 hover:underline font-semibold"
          >
            Create first client account →
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {closedLeads.slice(0, 5).map(lead => (
            <div
              key={lead.id}
              className="flex items-center justify-between p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 text-xs font-bold">
                  {(lead.full_name || 'C').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{lead.full_name}</p>
                  <p className="text-xs text-muted-foreground">{lead.phone} · {lead.asset_interest}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">
                  Converted
                </span>
                <button
                  onClick={() => onCreateClient(lead)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Create account
                </button>
              </div>
            </div>
          ))}
          {closedLeads.length > 5 && (
            <p className="text-xs text-muted-foreground text-center pt-1">
              +{closedLeads.length - 5} more converted leads
            </p>
          )}
        </div>
      )}
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
const SalesAgentPortal = () => {
  const {
    agentProfile, leads, walletTransactions, expenses, followUps,
    activityFeed, kpis, loading, connected,
    registerLead, updateLeadStage, requestWithdrawal, logExpense, refetch,
    activeView, setActiveView, modals, openModal, closeModal,
  } = useSalesAgentContext();

  const [toast, setToast] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleRegisterLead = async (formData) => {
    await registerLead(formData);
    closeModal('leadRegistration');
    showToast('Lead registered successfully!');
  };

  const handleDrop = async (leadId, newStage) => {
    try { await updateLeadStage(leadId, newStage); } catch (err) {}
  };

  const handleConvertToClient = (lead) => {
    closeModal('leadDetail');
    openModal('prefillLead', lead);
    openModal('createClient');
  };

  const handleClientCreated = (clientDetails) => {
    // Show detailed success popup with client info
    openModal('successPopup', clientDetails || {});
    refetch();
  };

  const fmt = (n) =>
    `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <MainLayout>
      <div className="space-y-5">

        {/* ── Header ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Sales Agent Portal</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {agentProfile
                ? `${agentProfile.full_name} · ${agentProfile.region || 'All Regions'} · Code: ${agentProfile.agent_code}`
                : 'Loading agent profile...'}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Live indicator */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-card text-xs">
              <span className="relative flex h-2 w-2">
                {connected && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                )}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
              </span>
              <span className={connected ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
                {connected ? 'Live' : 'Offline'}
              </span>
            </div>

            {/* View toggle */}
            <div className="flex rounded-xl border border-border overflow-hidden">
              <button
                onClick={() => setActiveView('portal')}
                className={`px-3 py-2 text-xs font-semibold transition-colors ${
                  activeView === 'portal'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:bg-muted'
                }`}
              >
                Portal
              </button>
              <button
                onClick={() => setActiveView('activity')}
                className={`px-3 py-2 text-xs font-semibold transition-colors ${
                  activeView === 'activity'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:bg-muted'
                }`}
              >
                My Activity
              </button>
            </div>

            {/* Create client */}
            <button
              onClick={() => { closeModal('prefillLead'); openModal('createClient'); }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}
            >
              <Icon name="UserPlus" size={15} color="white" />
              Create Client
            </button>

            {/* Export */}
            <button
              onClick={() => openModal('showExport')}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Icon name="Download" size={15} color="currentColor" />
              Export
            </button>

            {/* Register lead */}
            <button
              onClick={() => openModal('leadRegistration')}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
            >
              <Icon name="Plus" size={15} color="white" />
              Register Lead
            </button>
          </div>
        </div>

        {/* ── Activity Trail View ── */}
        {activeView === 'activity' && <AgentActivityTrail />}

        {/* ── Portal View ── */}
        {activeView === 'portal' && (
          <div className="space-y-5">

            {/* KPI Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KPICard
                label="Wallet Balance"
                value={fmt(kpis?.walletBalance)}
                icon="Wallet"
                colorClass="text-emerald-600"
                loading={loading}
                subtext="Available to withdraw"
              />
              <KPICard
                label="Commission This Month"
                value={fmt(kpis?.commissionThisMonth)}
                icon="Award"
                colorClass="text-orange-600"
                loading={loading}
                subtext={`Rate: ${agentProfile?.commission_rate || 5}%`}
              />
              <KPICard
                label="Clients Created"
                value={(leads || []).filter(l => l.stage === 'closed').length}
                icon="Users"
                colorClass="text-blue-600"
                loading={loading}
                subtext="Converted from leads"
              />
              <KPICard
                label="Leads in Pipeline"
                value={kpis?.leadsInPipeline || 0}
                icon="Target"
                colorClass="text-amber-600"
                loading={loading}
                subtext={`${(leads || []).length} total leads`}
              />
            </div>

            {/* Pipeline */}
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-foreground">Lead Pipeline</h3>
                <span className="text-xs text-muted-foreground">
                  {leads?.length} total · drag to move stages
                </span>
              </div>
              {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {PIPELINE_STAGES.map(s => (
                    <div key={s} className="animate-pulse">
                      <div className="h-8 bg-muted rounded-lg mb-3" />
                      <div className="min-h-[200px] bg-muted/30 rounded-xl" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {PIPELINE_STAGES.map(stageKey => (
                    <PipelineStage
                      key={stageKey}
                      stageKey={stageKey}
                      leads={leads?.filter(l => l?.stage === stageKey)}
                      onDrop={handleDrop}
                      onLeadClick={lead => openModal('leadDetail', lead)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* My Clients + Commission */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <MyClientsSection leads={leads} onCreateClient={handleConvertToClient} />
              <CommissionDashboard
                kpis={kpis}
                walletTransactions={walletTransactions}
                agentProfile={agentProfile}
                onRequestWithdrawal={requestWithdrawal}
                loading={loading}
              />
            </div>

            {/* Upcoming + Activity + Cost Tracker */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <UpcomingAppointments followUps={followUps} loading={loading} />
              <ActivityFeed activities={activityFeed} loading={loading} />
              <SalesCostTracker
                expenses={expenses}
                leads={leads}
                onLogExpense={logExpense}
                loading={loading}
              />
            </div>

          </div>
        )}

      </div>

      {/* ── Toast ── */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[300] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium max-w-sm ${
          toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        }`}>
          <Icon name={toast.type === 'success' ? 'CheckCircle' : 'AlertCircle'} size={16} color="white" />
          {toast.msg}
          <button onClick={() => setToast(null)} className="ml-2 opacity-70 hover:opacity-100">
            <Icon name="X" size={14} color="white" />
          </button>
        </div>
      )}

      {/* ── Export Modal ── */}
      {modals.showExport && (
        <ExportModal
          leads={leads}
          expenses={expenses}
          walletTransactions={walletTransactions}
          agentProfile={agentProfile}
          onClose={() => closeModal('showExport')}
        />
      )}

      {/* ── Lead Registration Modal ── */}
      {modals.leadRegistration && (
        <LeadRegistrationModal
          isOpen={modals.leadRegistration}
          onSubmit={handleRegisterLead}
          onClose={() => closeModal('leadRegistration')}
        />
      )}

      {/* ── Lead Detail Modal ── */}
      {modals.leadDetail && (
        <LeadDetailModal
          lead={modals.leadDetail}
          onClose={() => closeModal('leadDetail')}
          onStageChange={updateLeadStage}
          onConvertToClient={handleConvertToClient}
        />
      )}

      {/* ── Create Client Modal ── */}
      {modals.createClient && (
        <CreateClientModal
          isOpen={modals.createClient}
          onClose={() => { closeModal('createClient'); closeModal('prefillLead'); }}
          agentProfile={agentProfile}
          prefillLead={modals.prefillLead}
          onSuccess={handleClientCreated}
        />
      )}

      {/* ── Client Created Success Popup ── */}
      {modals.successPopup && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[400] flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            {/* Green header */}
            <div className="bg-emerald-600 px-6 py-5 text-center">
              <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <Icon name="CheckCircle" size={32} color="white" />
              </div>
              <h2 className="text-lg font-bold text-white">Client Account Created!</h2>
              <p className="text-xs text-emerald-100 mt-1">The account is ready to use</p>
            </div>

            {/* Details */}
            <div className="px-6 py-5 space-y-3">
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
                <div className="text-xs font-semibold text-emerald-800 uppercase tracking-wide mb-2">Account Details</div>
                {[
                  { icon: 'User',    label: 'Name',           value: modals.successPopup.full_name },
                  { icon: 'Mail',    label: 'Login Email',    value: modals.successPopup.email },
                  { icon: 'Phone',   label: 'Phone',          value: modals.successPopup.phone },
                  { icon: 'Hash',    label: 'Account Number', value: modals.successPopup.account_number },
                  { icon: 'Shield',  label: 'KYC Status',     value: 'Pending Verification' },
                ].filter(r => r.value).map(row => (
                  <div key={row.label} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-1.5 text-emerald-700">
                      <Icon name={row.icon} size={12} color="currentColor" />
                      <span className="font-medium">{row.label}</span>
                    </div>
                    <span className="font-semibold text-emerald-900 text-right max-w-[180px] truncate">{row.value}</span>
                  </div>
                ))}
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                <span className="font-semibold">⚠️ Important:</span> Share the login email and password with the client securely. The password cannot be retrieved later.
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
                <span className="font-semibold">Next steps:</span> The client logs in at the portal, completes KYC verification, and can then view their assets and make payments.
              </div>
            </div>

            {/* Actions */}
            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={() => closeModal('successPopup')}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                Done ✓
              </button>
              <button
                onClick={() => {
                  const text = `Client Account Created\n\nName: ${modals.successPopup.full_name}\nEmail: ${modals.successPopup.email}\nAccount: ${modals.successPopup.account_number}\n\nPlease log in at the client portal.`;
                  navigator.clipboard?.writeText(text).then(() => showToast('Details copied to clipboard'));
                  closeModal('successPopup');
                }}
                className="px-4 py-2.5 border border-border text-muted-foreground text-sm font-medium rounded-xl hover:bg-muted"
              >
                Copy & Close
              </button>
            </div>
          </div>
        </div>
      )}

    </MainLayout>
  );
};

export default SalesAgentPortal;

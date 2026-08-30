import React, { useState, useMemo } from 'react';
import Icon from '../../components/AppIcon';
import MainLayout from '../../layouts/MainLayout';
import PipelineStage from './components/PipelineStage';
import CommissionDashboard from './components/CommissionDashboard';
import ActivityFeed from './components/ActivityFeed';
import LeadRegistrationModal from './components/LeadRegistrationModal';
import CreateClientModal from './components/CreateClientModal';
import ClientsPanel from './components/ClientsPanel';
import CreateCompanyModal from './components/CreateCompanyModal';
import CreateSaccoModal from './components/CreateSaccoModal';
import AssistModal from './components/AssistModal';
import AssistRequestsPanel from './components/AssistRequestsPanel';
import AssistInboxModal from './components/AssistInboxModal';
import TicketsPanel from './components/TicketsPanel';
import TicketsInboxModal from './components/TicketsInboxModal';
import TicketThreadModal from './components/TicketThreadModal';
import NewTicketModal from './components/NewTicketModal';
import AgentActivityTrail from './components/AgentActivityTrail';
import SalesCostTracker from './components/SalesCostTracker';
import FollowUpsPanel from './components/FollowUpsPanel';
import ScheduleFollowUpModal from './components/ScheduleFollowUpModal';
import CatalogPanel from './components/CatalogPanel';
import ShareListingModal from './components/ShareListingModal';
import CrmPanel from './components/CrmPanel';
import LogInteractionModal from './components/LogInteractionModal';
import InteractionTimeline from './components/InteractionTimeline';
import CustomerRecord from '../../components/crm/CustomerRecord';
import LostReasonModal from './components/LostReasonModal';
import LostDealsPanel from './components/LostDealsPanel';
import OpportunitiesPanel from './components/OpportunitiesPanel';
import { useSalesAgentContext } from '../../contexts/SalesAgentContext';
import { deriveStaleLeads } from '../../hooks/useCrmInteractions';
import { channelMeta, PIPELINE_STAGE_VALUES } from '../../config/crmVocabulary';
import {
  leadValue, leadProbability, weightedValue, formatMoney, formatCompactMoney,
} from '../../utils/pipelineValue';

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
        // Blank, not 0, when nobody has priced the deal: a spreadsheet that
        // sums this column must not count unpriced leads as free ones.
        ['Deal Value',     r => (r.deal_value === null || r.deal_value === undefined ? '' : r.deal_value)],
        ['Win Chance %',   r => leadProbability(r)],
        ['Weighted Value', r => Math.round(weightedValue(r)) || ''],
        ['Expected Close', r => r.expected_close_date || ''],
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
        ['Deal Value',     r => (r.deal_value === null || r.deal_value === undefined ? '' : r.deal_value)],
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

// The board's columns, from the shared vocabulary rather than a fourth copy of
// the same five strings — the stage list now carries forecast weights, and a
// local copy is how the board and the forecast start disagreeing.
const PIPELINE_STAGES = PIPELINE_STAGE_VALUES;

// ── Tier badge ────────────────────────────────────────────────────────────────
// An agent's tier decides what they earn per registration, whether they can ask
// for help or are the one asked, and whether they hold the ticket pool — and
// nothing in the portal ever said which one they were. Agents worked it out from
// which buttons they happened to have.
const TIERS = {
  gold: {
    label: 'Gold Agent',
    icon:  'Crown',
    cls:   'bg-amber-100 text-amber-800 border-amber-300',
    hint:  'KES 1,500 per company registered · KES 1,000 per assist you complete',
  },
  bronze: {
    label: 'Bronze Agent',
    icon:  'Award',
    cls:   'bg-orange-100 text-orange-800 border-orange-300',
    hint:  'KES 500 per company registered · you can ask a gold agent for help',
  },
};

const TierBadge = ({ tier }) => {
  const t = TIERS[tier];
  if (!t) return null;
  return (
    <span
      title={t.hint}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold ${t.cls}`}
    >
      <Icon name={t.icon} size={13} color="currentColor" />
      {t.label}
    </span>
  );
};

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
const LeadDetailModal = ({ lead, onClose, onStageChange, onConvertToClient, onScheduleFollowUp, onLogInteraction, onOpenRecord, history = [], isClientMode, isSaccoMode, canRegisterSacco }) => {
  const [newStage, setNewStage] = useState(lead?.stage || 'new_lead');
  const [saving, setSaving]     = useState(false);
  const isConverted = Boolean(lead?.converted_at);
  const { value: dealAmount, source: dealSource } = leadValue(lead);

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
              // The deal, then the buyer's own words about what they can spend.
              // Both shown, never merged: one is a figure the agent committed
              // to and the other is a note somebody typed at registration.
              {
                label: 'Deal value',
                value: dealSource === 'stated'
                  ? formatMoney(dealAmount)
                  : dealSource === 'estimated'
                  ? `~${formatMoney(dealAmount)} (from budget)`
                  : null,
              },
              { label: 'Chance of winning', value: `${leadProbability(lead)}%` },
              { label: 'Expected close', value: lead?.expected_close_date ? fmt(`${lead.expected_close_date}T00:00:00`) : null },
              { label: 'Budget',    value: lead?.budget_range },
              { label: 'Interest',  value: lead?.asset_interest },
              { label: 'Source',    value: lead?.source },
              { label: 'Priority',  value: lead?.priority },
              { label: 'Created',   value: fmt(lead?.created_at) },
              { label: 'Next follow-up', value: lead?.next_follow_up_at ? fmt(lead.next_follow_up_at) : null },
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

          {/* Contact history. The single `notes` field above is whatever was
              typed at registration; this is everything that has happened since,
              which is the half the modal never used to show. */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Contact history
                {history.length > 0 && <span className="ml-1.5 font-normal normal-case">({history.length})</span>}
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { onClose(); onOpenRecord?.(lead); }}
                  className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-primary"
                >
                  <Icon name="Maximize2" size={12} color="currentColor" />
                  Full record
                </button>
                <button
                  onClick={() => onLogInteraction?.(lead)}
                  className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                  <Icon name="Plus" size={12} color="currentColor" />
                  Log contact
                </button>
              </div>
            </div>
            <InteractionTimeline
              interactions={history}
              showContact={false}
              limit={5}
              emptyLabel="Nothing logged for this lead yet."
              emptyHint="Log the call or meeting and the next person to open this lead will know what was said."
              onLog={() => onLogInteraction?.(lead)}
            />
          </div>

          {/* Not ready yet — park it as a dated follow-up instead of losing it. */}
          {!isConverted && (
            <button
              onClick={() => { onClose(); onScheduleFollowUp(lead); }}
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-border text-sm font-semibold text-foreground rounded-xl hover:bg-muted transition-colors"
            >
              <Icon name="CalendarPlus" size={14} color="currentColor" />
              {lead?.next_follow_up_at ? 'Schedule another follow-up' : 'Schedule a follow-up'}
            </button>
          )}

          {isConverted ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
              <Icon name="BadgeCheck" size={22} color="#059669" />
              <p className="text-xs font-semibold text-emerald-800 mt-1">
                Already converted to a {lead?.converted_entity || 'client'} account
              </p>
              <p className="text-xs text-emerald-700 mt-0.5">
                {fmt(lead?.converted_at)} — no further action needed.
              </p>
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-emerald-800 mb-1">🎯 They said yes — ready to onboard?</p>
              <p className="text-xs text-emerald-700 mb-2">
                {isClientMode
                  ? 'Convert them into a client with a portal login. Their details are prefilled.'
                  : isSaccoMode
                  ? 'Register them as a sacco with a sacco admin portal account. Their details are prefilled.'
                  : canRegisterSacco
                  ? 'Register them as a company (admin portal) or as a sacco (sacco admin portal). Their details are prefilled either way.'
                  : 'Register them as a company with an admin portal account. Their details are prefilled.'}
                {' '}The lead closes automatically once the account exists.
              </p>
              <button
                onClick={() => { onClose(); onConvertToClient(lead); }}
                className="w-full py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
              >
                {isClientMode ? 'Convert to Client →' : isSaccoMode ? 'Register as Sacco →' : 'Register as Company →'}
              </button>
              {/* Super-admin agents sell both products, so the same lead can be
                  closed as a sacco instead of a company. */}
              {canRegisterSacco && (
                <button
                  onClick={() => { onClose(); onConvertToClient(lead, 'sacco'); }}
                  className="w-full mt-2 py-2 text-xs font-semibold bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg transition-colors"
                >
                  Register as Sacco →
                </button>
              )}
            </div>
          )}
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
const MyClientsSection = ({ leads, onCreateClient, onCreateSacco, isClientMode, isSaccoMode, canRegisterSacco }) => {
  const closedLeads = (leads || []).filter(l => l.stage === 'closed');
  const registerLabel = isClientMode ? 'Create Client' : isSaccoMode ? 'Register Sacco' : 'Register Company';
  const registerNoun  = isClientMode ? 'client' : isSaccoMode ? 'sacco' : 'company';

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">My Clients</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Leads you converted to client accounts</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onCreateClient(null)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}
          >
            <Icon name={isClientMode ? 'UserPlus' : isSaccoMode ? 'PiggyBank' : 'Building2'} size={13} color="white" />
            {registerLabel}
          </button>
          {canRegisterSacco && (
            <button
              onClick={() => onCreateSacco(null)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #0891b2, #0e7490)' }}
            >
              <Icon name="PiggyBank" size={13} color="white" />
              Register Sacco
            </button>
          )}
        </div>
      </div>

      {closedLeads.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Icon name="Users" size={28} color="currentColor" />
          <p className="text-xs mt-2 font-medium">No converted clients yet</p>
          <p className="text-xs opacity-60 mt-0.5">
            Convert a lead or register a new {registerNoun}{canRegisterSacco ? ' or sacco' : ''}
          </p>
          <div className="flex items-center justify-center gap-3 mt-3">
            <button
              onClick={() => onCreateClient(null)}
              className="text-xs text-emerald-600 hover:underline font-semibold"
            >
              Register a {registerNoun} →
            </button>
            {canRegisterSacco && (
              <button
                onClick={() => onCreateSacco(null)}
                className="text-xs text-cyan-600 hover:underline font-semibold"
              >
                Register a sacco →
              </button>
            )}
          </div>
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
                  {lead.converted_at ? `${lead.converted_entity || 'Account'} created` : 'Closed'}
                </span>
                {/* Once the account exists, offering "Register" again would
                    create a duplicate — show the date instead. */}
                {lead.converted_at ? (
                  <span className="text-xs text-muted-foreground">
                    {new Date(lead.converted_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                  </span>
                ) : (
                  <button
                    onClick={() => onCreateClient(lead)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Register {registerNoun}
                  </button>
                )}
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
    agentProfile, agentMode, goldAgents, leads, walletTransactions, expenses,
    completedFollowUps, followUpBuckets, assistBuckets, assistsError, refetchAssists,
    activityFeed, kpis, loading, connected, error: portalError,
    registerLead, updateLeadStage, updateLeadLostReason, updateLeadDeal, markLeadConverted, requestWithdrawal, logExpense, assignAssist, refetch,
    respondToAssist, completeAssist, cancelAssist,
    scheduleFollowUp, rescheduleFollowUp, completeFollowUp, cancelFollowUp,
    tickets, ticketBuckets, ticketMessages, ticketDirectory, ticketsLoading,
    ticketMessagesLoading, ticketsError, isTicketUnread,
    openTicket, replyToTicket, claimTicket, setTicketStatus, openThread, refetchTickets,
    catalogAssets, shareLinks, shareLinksByAsset, shareStats,
    catalogLoading, catalogError, refetchCatalog,
    clientBook, clientBookCounts, clientBookLoading, clientBookError,
    clientBookBlocked, tracksSubscriptions, clientBookEnabled, refetchClientBook,
    interactions, interactionsByLead, crmStats, crmLoading, crmError,
    logInteraction, deleteInteraction, refetchInteractions,
    activeView, setActiveView, modals, openModal, closeModal,
  } = useSalesAgentContext();

  // Admin-created agents register clients; super-admin-created agents register
  // companies; sacco-oversight-created agents (agent_type 'sacco') register saccos.
  const isClientMode = agentMode === 'client';
  const isSaccoMode  = agentMode === 'sacco';
  // Super-admin agents sell the whole platform, not just the company product —
  // they can register a sacco alongside a company, so they get both entry
  // points. Admin-created (client) agents stay on their own tenant's clients,
  // and sacco-side agents already register saccos as their default.
  const canRegisterSacco = agentMode === 'company';
  // Only super-admin BRONZE agents can ask a gold agent to onboard an admin.
  const isBronzeCompanyAgent = agentMode === 'company' && (agentProfile?.agent_plan || 'bronze') === 'bronze';
  // Gold agents are on the receiving end — they get the request inbox.
  const isGoldAgent = (agentProfile?.agent_plan || '') === 'gold';
  // Show the panel to gold agents, and to anyone who has an assist either way.
  const showAssistPanel = isGoldAgent
    || isBronzeCompanyAgent
    || (assistBuckets?.incoming?.length || 0) > 0
    || (assistBuckets?.outgoing?.length || 0) > 0;

  // Tickets are the bronze ↔ gold channel, so they follow the tier. An agent
  // created by an admin registers clients, has no tier and no counterparts —
  // the whole feature stays off for them rather than showing an empty inbox.
  const ticketTier = (agentProfile?.agent_plan || (agentMode === 'company' ? 'bronze' : '')).toLowerCase();
  const hasTickets = ['bronze', 'gold'].includes(ticketTier);

  // The tier drives what an agent earns, who they can ask for help and who can
  // ask them — and until now the portal never said which one they were. Agents
  // inferred it from which buttons they happened to have.
  const tier = agentProfile ? ticketTier : '';

  // The thread modal holds an id, not a snapshot: replying and resolving both
  // change the ticket, and the header has to show what it is now.
  const activeTicket = modals.ticketThread
    ? (tickets || []).find(t => t.id === modals.ticketThread.id) || modals.ticketThread
    : null;

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

  // Closing a lead without converting it is the ONE moment the reason is
  // actually known, so both close paths (drag-to-closed and the detail modal)
  // are intercepted here rather than each growing its own copy of the prompt.
  // A lead that already converted is a win being tidied up, not a loss — it is
  // never asked.
  const [pendingClose, setPendingClose] = useState(null);

  const requestStageChange = async (leadId, newStage) => {
    const lead = leads.find(l => l.id === leadId);
    if (newStage === 'closed' && lead && !lead.converted_at) {
      setPendingClose(lead);
      return;
    }
    await updateLeadStage(leadId, newStage);
  };

  const confirmClose = async (lost) => {
    const lead = pendingClose;
    if (!lead) return;
    await updateLeadStage(lead.id, 'closed', lost);
    setPendingClose(null);
    showToast(lost?.reason ? 'Lead closed — reason recorded' : 'Lead closed');
  };

  const handleDrop = async (leadId, newStage) => {
    // Swallowed on purpose: a failed drag should not throw out of a drop
    // handler. requestStageChange surfaces real failures through the modal.
    try { await requestStageChange(leadId, newStage); } catch (err) {}
  };

  // What this agent registers by default — the sacco path is the explicit
  // second option a super-admin agent gets on top of it.
  const defaultEntity = isClientMode ? 'client' : isSaccoMode ? 'sacco' : 'company';

  // Every register/convert entry point goes through here so the modal that
  // opens is stated, never inferred. One modal per entity now that an
  // admin-created agent has both 'client' and 'company' available — the old
  // shape overloaded createClient to mean "whatever this agent's default is",
  // which cannot express an agent who has two.
  const MODAL_FOR_ENTITY = { sacco: 'createSacco', company: 'createCompany', client: 'createClient' };

  const openRegister = (entity, lead = null) => {
    closeModal('leadDetail');
    if (lead) openModal('prefillLead', lead);
    else      closeModal('prefillLead');
    openModal(MODAL_FOR_ENTITY[entity] || 'createClient');
  };

  const handleConvertToClient = (lead, entity = defaultEntity) => openRegister(entity, lead);

  // Lapsed, lapsing, or never activated — the clients worth a call today.
  const renewalsDue = (clientBookCounts?.expired || 0)
    + (clientBookCounts?.expiring || 0)
    + (clientBookCounts?.pending || 0)
    + (clientBookCounts?.attention || 0);

  const handleAssign = async ({ goldAgentId, adminName, helpType, note }) => {
    // The AssistModal shows its own success state; just persist + refresh here.
    await assignAssist({ goldAgentId, adminName, helpType, note });
    refetch();
  };

  const handleRespondToAssist = async (assist, decision, reason) => {
    try {
      await respondToAssist(assist, decision, reason);
      showToast(decision === 'accepted'
        ? 'Assist accepted — the bronze agent has been notified.'
        : 'Request declined — the bronze agent has been notified.');
    } catch (err) {
      showToast(err?.message || 'Could not update the request.', 'error');
    }
  };

  const handleCompleteAssist = async (assist, outcome) => {
    try {
      const row = await completeAssist(assist, outcome);
      showToast(`Onboarding complete — ${fmt(row?.amount || 1000)} credited to your wallet.`);
    } catch (err) {
      showToast(err?.message || 'Could not complete the assist.', 'error');
    }
  };

  const handleCancelAssist = async (assist) => {
    try {
      await cancelAssist(assist);
      showToast('Assist request cancelled.');
    } catch (err) {
      showToast(err?.message || 'Could not cancel the request.', 'error');
    }
  };

  // ── Tickets ────────────────────────────────────────────────────────────────
  const handleOpenTicket = (ticket) => {
    openModal('ticketThread', ticket);
    // Loads the thread and clears the unread mark in one act.
    openThread(ticket);
  };

  const handleRaiseTicket = async (payload) => {
    const ticket = await openTicket(payload);
    showToast(payload.assignedAgentId
      ? `Ticket ${ticket?.ticket_no || ''} sent — they've been emailed.`
      : `Ticket ${ticket?.ticket_no || ''} is in the gold pool — the first gold agent to claim it takes it on.`);
    return ticket;
  };

  const handleClaimTicket = async (ticket) => {
    try {
      await claimTicket(ticket);
      showToast(`Ticket ${ticket?.ticket_no || ''} is yours — the agent who raised it has been told.`);
    } catch (err) {
      showToast(err?.message || 'Could not claim that ticket.', 'error');
    }
  };

  const handleTicketStatus = async (ticket, status, note) => {
    const said = {
      resolved:    'Ticket marked resolved.',
      closed:      'Ticket closed.',
      waiting:     'Marked as waiting on the other agent.',
      in_progress: 'Ticket reopened.',
    }[status] || 'Ticket updated.';
    await setTicketStatus(ticket, status, note);
    if (status === 'closed') closeModal('ticketThread');
    showToast(said);
  };

  // `channel` carries over from the log-contact form: an agent who has just
  // written up an email and wants the long appointment form should not have to
  // re-pick "email" on the other side.
  const handleScheduleFollowUp = (lead, channel = null) => {
    closeModal('leadDetail');
    openModal('prefillFollowUpLead', lead);
    if (channel) openModal('prefillFollowUpChannel', channel);
    else         closeModal('prefillFollowUpChannel');
    openModal('scheduleFollowUp');
  };

  // ── CRM: recording what has already happened ───────────────────────────────
  // Open leads with no recorded contact for a fortnight. Drives the sidebar
  // badge and the panel's call list, so both count the same thing.
  const staleLeadCount = useMemo(() => deriveStaleLeads(leads).length, [leads]);

  // The full customer record — everything known about one person, opened over
  // the top of whatever the agent was looking at.
  const [recordLead, setRecordLead] = useState(null);

  // Only kind 'client' rows can be logged against: their id IS a public.clients
  // id, which is what crm_interactions.client_id references. A company-mode
  // row's id is an admin's user_profiles id and would fail that FK.
  const crmClientOptions = useMemo(
    () => (clientBook || [])
      .filter(c => c.kind === 'client')
      .map(c => ({ id: c.id, full_name: c.name, phone: c.phone })),
    [clientBook],
  );

  const handleOpenLogInteraction = (lead = null) => {
    closeModal('leadDetail');
    if (lead) openModal('prefillInteractionLead', lead);
    else      closeModal('prefillInteractionLead');
    openModal('logInteraction');
  };

  const handleLogInteraction = async (payload) => {
    const result = await logInteraction(payload);
    if (result?.error) return result;
    closeModal('prefillInteractionLead');

    // The other half: the contact just recorded usually ends with a promise to
    // come back, and a promise with no date is one nobody is reminded about.
    // Booked here rather than in the hook because the follow-up needs the id of
    // the interaction that produced it, which only exists once the insert lands.
    let booked = null;
    let bookingFailed = false;
    if (payload?.followUp) {
      try {
        booked = await scheduleFollowUp({
          leadId:      payload.leadId || null,
          // A contact against a client, or a walk-in with no lead row, has no
          // lead_id — the name is the only handle the reminder will have.
          leadName:    payload.contactName || null,
          channel:     payload.followUp.channel,
          scheduledAt: payload.followUp.scheduledAt,
          remindAt:    payload.followUp.remindAt,
          notes:       payload.followUp.notes,
          sourceInteractionId: result?.data?.id || null,
        });
      } catch (err) {
        // The contact IS saved. Reporting this as a failed submit would leave
        // the modal open and invite a second Save, duplicating the log — so the
        // modal closes and the toast says exactly what did and did not happen.
        bookingFailed = true;
        showToast(
          `Contact logged, but the follow-up could not be scheduled${err?.message ? ` — ${err.message}` : ''}. Schedule it from the follow-ups panel.`,
          'error',
        );
      }
    }

    // The trigger moves leads.last_contact_at and interaction_count; the board
    // above still holds the pre-log copy, so pull the leads back in.
    refetch();

    if (!bookingFailed) {
      const when = booked?.scheduled_at || payload?.followUp?.scheduledAt;
      showToast(
        when
          ? `Contact logged. ${channelMeta(booked?.appointment_type || payload.followUp.channel).label} follow-up set for ${new Date(when).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.`
          : 'Contact logged.',
      );
    }
    return result;
  };

  /**
   * Price a deal from the opportunities panel.
   *
   * Rethrows rather than swallowing: the row edits in place and keeps its form
   * open on failure so the agent can retry without retyping. A toast alone
   * would close the editor and lose what they typed.
   */
  const handleSaveDeal = async (leadId, patch) => {
    await updateLeadDeal(leadId, patch);
    showToast('Deal updated.');
  };

  const handleDeleteInteraction = async (id) => {
    const result = await deleteInteraction(id);
    if (result?.error) { showToast(result.error, 'error'); return; }
    refetch();
    showToast('Entry removed.');
  };

  // Chasing a renewal is the same appointment as chasing a lead. Accounts
  // registered without a lead have nothing to link to, so the modal is prefilled
  // with a name-only stand-in — scheduleFollowUp accepts a null lead_id.
  const handleClientFollowUp = (client) => {
    handleScheduleFollowUp(client.lead || { id: null, full_name: client.name });
  };

  const handleFollowUpSubmit = async (payload) => {
    await scheduleFollowUp(payload);
    closeModal('prefillFollowUpLead');
    closeModal('prefillFollowUpChannel');
    const how = channelMeta(payload.appointmentType).label;
    showToast(`${how} follow-up set for ${new Date(payload.scheduledAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — you'll get an email reminder.`);
  };

  const handleCompleteFollowUp = async (id, outcome) => {
    try {
      await completeFollowUp(id, outcome);
      showToast('Follow-up marked done.');
    } catch (err) {
      showToast(err?.message || 'Could not update the follow-up.', 'error');
    }
  };

  const handleSnoozeFollowUp = async (id, newDate) => {
    try {
      await rescheduleFollowUp(id, newDate);
      showToast(`Moved to ${newDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.`);
    } catch (err) {
      showToast(err?.message || 'Could not reschedule.', 'error');
    }
  };

  const handleCancelFollowUp = async (id) => {
    try {
      await cancelFollowUp(id);
      showToast('Appointment removed.');
    } catch (err) {
      showToast(err?.message || 'Could not remove the appointment.', 'error');
    }
  };

  // ── Shareable listings ─────────────────────────────────────────────────────
  // The link carries this agent's id, so an enquiry through it arrives as their
  // lead. Refresh the catalogue so the card shows the link straight away.
  const handleShared = () => {
    refetchCatalog();
    showToast('Link ready — send it and any enquiry comes back as your lead.');
  };

  // entity comes from the modal that produced the account, not from the agent
  // mode — a super-admin agent creates companies AND saccos from the same portal.
  const handleClientCreated = async (account, entity = defaultEntity) => {
    // Stamp the lead as converted so it moves into "My Clients" and can never
    // be registered a second time. Every create modal (client / company / sacco)
    // returns leadId when it was opened from a lead.
    if (account?.leadId) {
      try {
        await markLeadConverted(account.leadId, {
          entity,
          refId:  account.clientId || account.adminId || account.saccoId || null,
        });
      } catch (err) {
        // Never block the success popup — the account itself already exists.
        console.error('markLeadConverted failed:', err?.message);
      }
    }
    refetch();
  };

  const fmt = (n) =>
    `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  // -- Toolbar ---------------------------------------------------------------
  // The portal's actions live on the sidebar rail, not above the content: the
  // header row had grown to ten buttons that wrapped onto a second line and
  // pushed the KPIs down the page, while the agent sidebar sat nearly empty.
  // One list feeds both surfaces -- the rail on desktop, and a compact row on
  // phones, where the sidebar is behind the hamburger. `color` is the version
  // that reads on the dark rail; `gradient` is the light-background version.
  const registerEntityLabel = isClientMode ? 'Create Client' : isSaccoMode ? 'Register Sacco' : 'Register Company';

  const portalActions = [
    // Create a client (admin agents), register a company (super-admin agents)
    // or register a sacco (sacco-oversight agents)
    {
      id: 'register-entity',
      label: registerEntityLabel,
      icon: isClientMode ? 'UserPlus' : isSaccoMode ? 'PiggyBank' : 'Building2',
      color: '#34d399',
      gradient: 'linear-gradient(135deg, #059669, #047857)',
      onClick: () => openRegister(defaultEntity),
    },
    // An admin-created agent sells their company's stock AND can sign a brand
    // new company up to the platform, the same flow and the same commission a
    // super-admin agent gets. The company created this way is an INDEPENDENT
    // tenant -- create-staff-user stamps admin_id NULL for the `admin` role --
    // not a client of the agent's own admin. Super-admin agents already reach
    // this through their default entity, hence isClientMode only.
    isClientMode && {
      id: 'register-company',
      label: 'Register Company',
      icon: 'Building2',
      color: '#818cf8',
      gradient: 'linear-gradient(135deg, #4f46e5, #4338ca)',
      onClick: () => openRegister('company'),
    },
    // Second product for super-admin agents -- same commission plan, different
    // tenant type.
    canRegisterSacco && {
      id: 'register-sacco',
      label: 'Register Sacco',
      icon: 'PiggyBank',
      color: '#22d3ee',
      gradient: 'linear-gradient(135deg, #0891b2, #0e7490)',
      onClick: () => openRegister('sacco'),
    },
    // Assist -- bronze agents hand an admin to a gold agent for onboarding
    isBronzeCompanyAgent && {
      id: 'assist',
      label: 'Assist',
      icon: 'LifeBuoy',
      color: '#fbbf24',
      gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
      onClick: () => openModal('assist'),
    },
    // Assist inbox -- opens the requests rather than scrolling at them, so it
    // works from the Activity view too and cannot land short.
    isGoldAgent && {
      id: 'assists',
      label: 'Assists',
      icon: 'LifeBuoy',
      badge: assistBuckets?.actionable,
      badgeColor: assistBuckets?.pending?.length > 0 ? '#f59e0b' : '#3b82f6',
      onClick: () => openModal('assistInbox'),
    },
    // Tickets -- the conversation channel between agents. The badge is the
    // point: an unread reply nobody notices is a phone call.
    hasTickets && {
      id: 'tickets',
      label: 'Tickets',
      icon: 'Ticket',
      badge: ticketBuckets?.actionable,
      badgeColor: ticketBuckets?.unreadCount > 0 ? '#2563eb' : '#f59e0b',
      onClick: () => openModal('tickets'),
    },
    // Log a contact -- the other half of the follow-up button. That one books
    // the next conversation; this one writes down the one just had. The badge
    // counts open leads nobody has touched in a fortnight, because an agent who
    // never opens this is exactly the agent whose leads go cold.
    {
      id: 'log-contact',
      label: 'Log Contact',
      icon: 'Contact',
      color: '#a78bfa',
      gradient: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
      badge: staleLeadCount,
      badgeColor: '#f59e0b',
      onClick: () => handleOpenLogInteraction(null),
    },
    // Opportunities -- the pipeline in money. The badge counts open deals with
    // no value on them, because those are the ones making the forecast wrong,
    // and an agent who never opens this panel is exactly the agent who has
    // forty unpriced deals.
    {
      id: 'opportunities',
      label: 'Opportunities',
      icon: 'TrendingUp',
      href: '#opportunities',
      badge: kpis?.pipeline?.unvalued?.count,
      badgeColor: '#d97706',
    },
    // Schedule a follow-up -- badge shows what is due or overdue
    {
      id: 'follow-ups',
      label: 'Follow-ups',
      icon: 'CalendarClock',
      badge: followUpBuckets?.actionable,
      badgeColor: followUpBuckets?.overdue?.length > 0 ? '#dc2626' : '#f59e0b',
      onClick: () => { closeModal('prefillFollowUpLead'); openModal('scheduleFollowUp'); },
    },
    // Catalogue -- what the agent can send a buyer. The badge counts enquiries
    // that came back through their own links. Admin-created agents only: they
    // are the ones with a company whose stock is theirs to sell. A platform or
    // sacco agent has no catalogue, and create_asset_share_link refuses them
    // outright (20260819120000), so offering the tab would only mislead.
    isClientMode && {
      id: 'catalogue',
      label: 'Catalogue',
      icon: 'Store',
      href: '#catalog',
      badge: shareStats?.totalEnquiries,
      badgeColor: '#059669',
    },
    { id: 'export', label: 'Export', icon: 'Download', onClick: () => openModal('showExport') },
    {
      id: 'register-lead',
      label: 'Register Lead',
      icon: 'Plus',
      color: '#60a5fa',
      gradient: 'linear-gradient(135deg, #1A56DB, #1E429F)',
      onClick: () => openModal('leadRegistration'),
    },
  ].filter(Boolean);

  const sidebarActions = [
    { label: 'Actions', items: portalActions },
  ];

  return (
    <MainLayout sidebarActions={sidebarActions}>
      <div className="space-y-5">

        {/* ── Header ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">Sales Agent Portal</h1>
              <TierBadge tier={tier} />
            </div>
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
          </div>
        </div>

        {/* -- Actions (phones only) --
            The same list the sidebar rail renders from. */}
        <div className="lg:hidden flex items-center gap-2 flex-wrap">
          {portalActions.map((a) => {
            const cls = `relative flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold ${
              a.gradient
                ? 'text-white'
                : 'border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all'
            }`;
            const inner = (
              <>
                <Icon name={a.icon} size={14} color={a.gradient ? 'white' : 'currentColor'} />
                {a.label}
                {a.badge > 0 && (
                  <span
                    className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-xs font-bold text-white flex items-center justify-center"
                    style={{ background: a.badgeColor || '#ef4444' }}
                  >
                    {a.badge > 99 ? '99+' : a.badge}
                  </span>
                )}
              </>
            );
            return a.href ? (
              <a key={a.id} href={a.href} className={cls} style={a.gradient ? { background: a.gradient } : undefined}>
                {inner}
              </a>
            ) : (
              <button key={a.id} onClick={a.onClick} className={cls} style={a.gradient ? { background: a.gradient } : undefined}>
                {inner}
              </button>
            );
          })}
        </div>

        {/* ── Activity Trail View ── */}
        {activeView === 'activity' && <AgentActivityTrail />}

        {/* ── Portal View ── */}
        {activeView === 'portal' && (
          <div className="space-y-5">

            {/* Assist alert — a bronze agent is waiting on this gold agent. */}
            {!loading && assistBuckets?.pending?.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl border bg-amber-50 border-amber-200">
                <Icon name="LifeBuoy" size={17} color="#d97706" />
                <p className="text-sm font-semibold text-amber-800">
                  {assistBuckets.pending.length} bronze agent{assistBuckets.pending.length !== 1 ? 's' : ''} asked
                  for your help onboarding an admin
                </p>
                <button
                  onClick={() => openModal('assistInbox')}
                  className="ml-auto text-xs font-semibold text-amber-700 hover:underline"
                >
                  View requests →
                </button>
              </div>
            )}

            {/* Ticket alert — someone has written and is waiting on a reply. */}
            {!loading && hasTickets && (ticketBuckets?.unreadCount > 0 || ticketBuckets?.pool?.length > 0) && (
              <div className={`flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl border ${
                ticketBuckets.unreadCount > 0 ? 'bg-blue-50 border-blue-200' : 'bg-amber-50 border-amber-200'
              }`}>
                <Icon
                  name={ticketBuckets.unreadCount > 0 ? 'MessageSquare' : 'Hand'}
                  size={17}
                  color={ticketBuckets.unreadCount > 0 ? '#1a56db' : '#d97706'}
                />
                <p className={`text-sm font-semibold ${
                  ticketBuckets.unreadCount > 0 ? 'text-blue-800' : 'text-amber-800'
                }`}>
                  {ticketBuckets.unreadCount > 0 && (
                    <>{ticketBuckets.unreadCount} ticket{ticketBuckets.unreadCount !== 1 ? 's' : ''} with something new</>
                  )}
                  {ticketBuckets.unreadCount > 0 && ticketBuckets.pool.length > 0 && ' · '}
                  {ticketBuckets.pool.length > 0 && (
                    <>{ticketBuckets.pool.length} waiting to be claimed</>
                  )}
                </p>
                <button
                  onClick={() => openModal('tickets')}
                  className={`ml-auto text-xs font-semibold hover:underline ${
                    ticketBuckets.unreadCount > 0 ? 'text-blue-700' : 'text-amber-700'
                  }`}
                >
                  Open tickets →
                </button>
              </div>
            )}

            {/* Due-follow-up alert — the in-portal half of the reminder. The
                email half is sent by the agent-followup-reminders worker. */}
            {!loading && followUpBuckets?.actionable > 0 && (
              <div className={`flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl border ${
                followUpBuckets.overdue.length > 0
                  ? 'bg-red-50 border-red-200'
                  : 'bg-amber-50 border-amber-200'
              }`}>
                <Icon
                  name={followUpBuckets.overdue.length > 0 ? 'AlertTriangle' : 'Bell'}
                  size={17}
                  color={followUpBuckets.overdue.length > 0 ? '#dc2626' : '#d97706'}
                />
                <p className={`text-sm font-semibold ${
                  followUpBuckets.overdue.length > 0 ? 'text-red-800' : 'text-amber-800'
                }`}>
                  {followUpBuckets.overdue.length > 0 && (
                    <>{followUpBuckets.overdue.length} follow-up{followUpBuckets.overdue.length !== 1 ? 's' : ''} overdue</>
                  )}
                  {followUpBuckets.overdue.length > 0 && followUpBuckets.today.length > 0 && ' · '}
                  {followUpBuckets.today.length > 0 && (
                    <>{followUpBuckets.today.length} due today</>
                  )}
                </p>
                <a
                  href="#follow-ups"
                  className={`ml-auto text-xs font-semibold hover:underline ${
                    followUpBuckets.overdue.length > 0 ? 'text-red-700' : 'text-amber-700'
                  }`}
                >
                  View follow-ups →
                </a>
              </div>
            )}

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
                value={clientBookEnabled
                  ? (clientBookCounts?.all || 0)
                  : (leads || []).filter(l => l.stage === 'closed').length}
                icon="Users"
                colorClass="text-blue-600"
                loading={loading || clientBookLoading}
                subtext={clientBookEnabled
                  ? (renewalsDue > 0
                      ? `${renewalsDue} need${renewalsDue === 1 ? 's' : ''} following up`
                      : 'All up to date')
                  : 'Converted from leads'}
              />
              {/* Pipeline measured in money, not headcount. The count is the
                  subtext now: one KES 12M deal and forty KES 200k deals used to
                  produce the same card, and only one of them is a good month. */}
              <KPICard
                label="Pipeline Value"
                value={formatCompactMoney(kpis?.pipeline?.open?.value)}
                icon="Target"
                colorClass="text-amber-600"
                loading={loading}
                subtext={`${kpis?.leadsInPipeline || 0} open · ${formatCompactMoney(kpis?.pipeline?.open?.weighted)} weighted`}
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

            {/* Opportunities — the same board, measured in money. The stages
                above say where each deal sits; this says what the pipeline is
                worth, what is due this month, and which deals still have no
                price on them at all. */}
            <div id="opportunities" className="scroll-mt-24">
              <OpportunitiesPanel
                leads={leads}
                loading={loading}
                error={portalError}
                onSaveDeal={handleSaveDeal}
                onOpenLead={lead => openModal('leadDetail', lead)}
                onRefresh={refetch}
              />
            </div>

            {/* Customer relationships — the contact history behind the board
                above. The pipeline says where a deal is; this says what was
                actually said, and who has gone quiet. */}
            <div id="crm" className="scroll-mt-24">
              <CrmPanel
                interactions={interactions}
                leads={leads}
                loading={crmLoading}
                error={crmError}
                stats={crmStats}
                onLog={() => handleOpenLogInteraction(null)}
                onLogForLead={handleOpenLogInteraction}
                onOpenRecord={setRecordLead}
                onRefresh={refetchInteractions}
                onDelete={handleDeleteInteraction}
              />
            </div>

            {/* Lost deals — the only place a reason can be added after the
                close-time prompt was skipped, or corrected if it was wrong. */}
            <div id="lost-deals" className="scroll-mt-24">
              <LostDealsPanel
                leads={leads}
                loading={loading}
                onSaveReason={updateLeadLostReason}
              />
            </div>

            {/* My Clients — who signed, and whether they are still paying */}
            <div id="clients" className="scroll-mt-24">
              {clientBookEnabled ? (
                <ClientsPanel
                  clients={clientBook}
                  counts={clientBookCounts}
                  loading={clientBookLoading || loading}
                  error={clientBookError}
                  subscriptionsBlocked={clientBookBlocked}
                  tracksSubscriptions={tracksSubscriptions}
                  enabled={clientBookEnabled}
                  onRefresh={refetchClientBook}
                  onFollowUp={handleClientFollowUp}
                  onRegister={() => openRegister(defaultEntity)}
                  onRegisterSacco={() => openRegister('sacco')}
                  canRegisterSacco={canRegisterSacco}
                  registerLabel={isClientMode ? 'Create Client' : 'Register Company'}
                  registerNoun={isClientMode ? 'client' : 'company'}
                />
              ) : (
                /* Sacco-side agents keep the plain converted-lead list. */
                <MyClientsSection
                  leads={leads}
                  onCreateClient={() => openRegister(defaultEntity)}
                  onCreateSacco={() => openRegister('sacco')}
                  isClientMode={isClientMode}
                  isSaccoMode={isSaccoMode}
                  canRegisterSacco={canRegisterSacco}
                />
              )}
            </div>

            {/* Commission */}
            <CommissionDashboard
              kpis={kpis}
              walletTransactions={walletTransactions}
              agentProfile={agentProfile}
              onRequestWithdrawal={requestWithdrawal}
              loading={loading}
            />

            {/* Catalogue — pick something, send a buyer a link, watch it land.
                Admin-created agents only: the catalogue IS their admin's stock,
                and no other kind of agent has one. */}
            {isClientMode && (
            <div id="catalog" className="scroll-mt-24">
              <CatalogPanel
                assets={catalogAssets}
                links={shareLinks}
                linksByAsset={shareLinksByAsset}
                stats={shareStats}
                loading={catalogLoading}
                error={catalogError}
                onShare={(asset) => openModal('shareListing', asset)}
                onRefresh={refetchCatalog}
                onNotify={showToast}
              />
            </div>
            )}

            {/* Follow-ups & Appointments */}
            <div id="follow-ups" className="scroll-mt-24">
              <FollowUpsPanel
                buckets={followUpBuckets}
                completedFollowUps={completedFollowUps}
                loading={loading}
                onSchedule={() => { closeModal('prefillFollowUpLead'); openModal('scheduleFollowUp'); }}
                onComplete={handleCompleteFollowUp}
                onSnooze={handleSnoozeFollowUp}
                onCancel={handleCancelFollowUp}
              />
            </div>

            {/* Assist requests — gold agents work their inbox here, bronze
                agents track what they asked for */}
            {showAssistPanel && (
              <div id="assist-requests" className="scroll-mt-24">
                <AssistRequestsPanel
                  buckets={assistBuckets}
                  loading={loading}
                  isGoldAgent={isGoldAgent}
                  error={assistsError}
                  onRefresh={refetchAssists}
                  onRespond={handleRespondToAssist}
                  onComplete={handleCompleteAssist}
                  onCancel={handleCancelAssist}
                  onRequestAssist={isBronzeCompanyAgent ? () => openModal('assist') : null}
                />
              </div>
            )}

            {/* Tickets — the conversation channel between bronze and gold */}
            {hasTickets && (
              <div id="tickets" className="scroll-mt-24">
                <TicketsPanel
                  buckets={ticketBuckets}
                  agentId={agentProfile?.id}
                  isGoldAgent={isGoldAgent}
                  loading={ticketsLoading}
                  error={ticketsError}
                  isUnread={isTicketUnread}
                  onOpen={handleOpenTicket}
                  onClaim={handleClaimTicket}
                  onNewTicket={() => openModal('newTicket')}
                  onRefresh={refetchTickets}
                />
              </div>
            )}

            {/* Activity + Cost Tracker */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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

      {/* ── Why was this lead lost? ── */}
      <LostReasonModal
        open={Boolean(pendingClose)}
        lead={pendingClose}
        onCancel={() => setPendingClose(null)}
        onConfirm={confirmClose}
      />

      {/* ── Lead Detail Modal ── */}
      {modals.leadDetail && (
        <LeadDetailModal
          lead={modals.leadDetail}
          onClose={() => closeModal('leadDetail')}
          onStageChange={requestStageChange}
          onConvertToClient={handleConvertToClient}
          onScheduleFollowUp={handleScheduleFollowUp}
          onLogInteraction={handleOpenLogInteraction}
          onOpenRecord={setRecordLead}
          history={interactionsByLead?.[modals.leadDetail.id] || []}
          isClientMode={isClientMode}
          isSaccoMode={isSaccoMode}
          canRegisterSacco={canRegisterSacco}
        />
      )}

      {/* ── Full customer record ── */}
      {recordLead && (
        <CustomerRecord
          lead={recordLead}
          agentName={agentProfile?.full_name}
          onClose={() => setRecordLead(null)}
          onLogInteraction={(l) => { setRecordLead(null); handleOpenLogInteraction(l); }}
          onScheduleFollowUp={(l) => { setRecordLead(null); handleScheduleFollowUp(l); }}
        />
      )}

      {/* ── Log Contact Modal ── */}
      {modals.logInteraction && (
        <LogInteractionModal
          isOpen={modals.logInteraction}
          leads={leads}
          clients={crmClientOptions}
          prefillLead={typeof modals.prefillInteractionLead === 'object' ? modals.prefillInteractionLead : null}
          onSubmit={handleLogInteraction}
          onScheduleFollowUp={handleScheduleFollowUp}
          onClose={() => { closeModal('logInteraction'); closeModal('prefillInteractionLead'); }}
        />
      )}

      {/* ── Schedule Follow-up Modal ── */}
      {modals.scheduleFollowUp && (
        <ScheduleFollowUpModal
          isOpen={modals.scheduleFollowUp}
          leads={leads}
          prefillLead={typeof modals.prefillFollowUpLead === 'object' ? modals.prefillFollowUpLead : null}
          prefillChannel={typeof modals.prefillFollowUpChannel === 'string' ? modals.prefillFollowUpChannel : null}
          onSubmit={handleFollowUpSubmit}
          onClose={() => {
            closeModal('scheduleFollowUp');
            closeModal('prefillFollowUpLead');
            closeModal('prefillFollowUpChannel');
          }}
        />
      )}

      {/* ── Register a client of the agent's own admin ── */}
      {modals.createClient && (
        <CreateClientModal
          isOpen={modals.createClient}
          onClose={() => { closeModal('createClient'); closeModal('prefillLead'); }}
          agentProfile={agentProfile}
          prefillLead={typeof modals.prefillLead === 'object' ? modals.prefillLead : null}
          onSuccess={(account) => handleClientCreated(account, 'client')}
        />
      )}

      {/* ── Sign a brand-new company up to the platform. Reached by
             super-admin agents as their default entity, and now by
             admin-created agents from their own Register Company action. ── */}
      {modals.createCompany && (
        <CreateCompanyModal
          isOpen={modals.createCompany}
          onClose={() => { closeModal('createCompany'); closeModal('prefillLead'); }}
          agentProfile={agentProfile}
          prefillLead={typeof modals.prefillLead === 'object' ? modals.prefillLead : null}
          onSuccess={(account) => handleClientCreated(account, 'company')}
        />
      )}

      {/* ── Register a sacco — the default for sacco-side agents, and the
             second product for super-admin agents ── */}
      {modals.createSacco && (
        <CreateSaccoModal
          isOpen={modals.createSacco}
          onClose={() => { closeModal('createSacco'); closeModal('prefillLead'); }}
          agentProfile={agentProfile}
          prefillLead={typeof modals.prefillLead === 'object' ? modals.prefillLead : null}
          onSuccess={(account) => handleClientCreated(account, 'sacco')}
        />
      )}

      {/* ── Assist modal (bronze agents → gold agent onboarding) ── */}
      {modals.assist && (
        <AssistModal
          isOpen={modals.assist}
          onClose={() => closeModal('assist')}
          goldAgents={goldAgents}
          onAssign={handleAssign}
        />
      )}

      {/* ── Assist inbox (what the header "Assists" button opens) ── */}
      <AssistInboxModal
        isOpen={!!modals.assistInbox}
        onClose={() => closeModal('assistInbox')}
        buckets={assistBuckets}
        loading={loading}
        isGoldAgent={isGoldAgent}
        error={assistsError}
        onRefresh={refetchAssists}
        onRespond={handleRespondToAssist}
        onComplete={handleCompleteAssist}
        onCancel={handleCancelAssist}
        onRequestAssist={isBronzeCompanyAgent ? () => { closeModal('assistInbox'); openModal('assist'); } : null}
      />

      {/* ── Tickets: the list, the thread, and raising a new one ── */}
      <TicketsInboxModal
        isOpen={!!modals.tickets}
        onClose={() => closeModal('tickets')}
        buckets={ticketBuckets}
        agentId={agentProfile?.id}
        isGoldAgent={isGoldAgent}
        loading={ticketsLoading}
        error={ticketsError}
        isUnread={isTicketUnread}
        onOpen={(t) => { closeModal('tickets'); handleOpenTicket(t); }}
        onClaim={handleClaimTicket}
        onNewTicket={() => { closeModal('tickets'); openModal('newTicket'); }}
        onRefresh={refetchTickets}
      />

      <TicketThreadModal
        isOpen={!!activeTicket}
        ticket={activeTicket}
        messages={ticketMessages?.[activeTicket?.id]}
        agentId={agentProfile?.id}
        isGoldAgent={isGoldAgent}
        loading={ticketMessagesLoading}
        onSend={replyToTicket}
        onClaim={handleClaimTicket}
        onStatus={handleTicketStatus}
        onClose={() => closeModal('ticketThread')}
      />

      {modals.newTicket && (
        <NewTicketModal
          isOpen={modals.newTicket}
          onClose={() => closeModal('newTicket')}
          directory={ticketDirectory}
          isGoldAgent={isGoldAgent}
          onSubmit={handleRaiseTicket}
        />
      )}

      {/* ── Share a listing with a buyer ── */}
      {modals.shareListing && (
        <ShareListingModal
          isOpen={!!modals.shareListing}
          asset={typeof modals.shareListing === 'object' ? modals.shareListing : null}
          leads={leads}
          agentProfile={agentProfile}
          onShared={handleShared}
          onClose={() => closeModal('shareListing')}
        />
      )}

    </MainLayout>
  );
};

export default SalesAgentPortal;

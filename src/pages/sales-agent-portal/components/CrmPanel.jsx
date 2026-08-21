import React, { useState, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import InteractionTimeline from './InteractionTimeline';
import { INTERACTION_TYPES, deriveStaleLeads, STALE_CONTACT_DAYS } from '../../../hooks/useCrmInteractions';

const TIMELINE_PAGE = 12;

const StatChip = ({ icon, label, value, tone = 'text-foreground' }) => (
  <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-background">
    <Icon name={icon} size={14} color="currentColor" className="text-muted-foreground" />
    <div className="leading-tight">
      <p className={`text-sm font-bold ${tone}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  </div>
);

/**
 * The agent's relationship view: who has gone quiet, and everything that has
 * been said to anybody, newest first.
 *
 * The pipeline board above it answers "where is this deal"; this panel answers
 * "when did we last speak, and what came of it" — which is the question the
 * portal previously had no place to store an answer to at all.
 */
const CrmPanel = ({
  interactions = [],
  leads = [],
  loading = false,
  error = null,
  stats = {},
  onLog,
  onLogForLead,
  onOpenRecord,
  onRefresh,
  onDelete,
}) => {
  const [typeFilter, setTypeFilter] = useState('all');
  const [showCount, setShowCount]   = useState(TIMELINE_PAGE);
  const [tab, setTab]               = useState('timeline'); // timeline | quiet

  const staleLeads = useMemo(() => deriveStaleLeads(leads), [leads]);

  const filtered = useMemo(() => (
    typeFilter === 'all'
      ? interactions
      : interactions.filter(i => i.interaction_type === typeFilter)
  ), [interactions, typeFilter]);

  // Only offer a filter chip for a type this agent has actually used — a row of
  // nine buttons that mostly return nothing is worse than no filter.
  const usedTypes = useMemo(
    () => INTERACTION_TYPES.filter(t => (stats?.byType?.[t.value] || 0) > 0),
    [stats],
  );

  const handleDelete = async (interaction) => {
    if (!onDelete) return;
    const who = interaction?.contact_name ? ` with ${interaction.contact_name}` : '';
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Remove this logged contact${who}? This cannot be undone.`)) return;
    await onDelete(interaction.id);
  };

  return (
    <div className="bg-card border border-border rounded-xl">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Icon name="Contact" size={17} color="var(--color-primary)" />
            Customer Relationships
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Every call, meeting and message — so the next conversation starts where the last one ended
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onRefresh && (
            <button
              onClick={() => onRefresh()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Icon name="RefreshCw" size={12} color="currentColor" />
              Refresh
            </button>
          )}
          <button
            onClick={onLog}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
          >
            <Icon name="Plus" size={13} color="currentColor" />
            Log Contact
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 px-5 py-4 border-b border-border">
        <StatChip icon="Activity"   label="Contacts this week"  value={stats?.thisWeek ?? 0} />
        <StatChip icon="Users"      label="People touched"      value={stats?.contactsTouched ?? 0} />
        <StatChip
          icon="ThumbsUp"
          label="Positive outcomes"
          value={stats?.positiveRate === null || stats?.positiveRate === undefined ? '—' : `${stats.positiveRate}%`}
          tone={stats?.positiveRate >= 50 ? 'text-emerald-600' : 'text-foreground'}
        />
        <StatChip
          icon="BellOff"
          label={`Quiet ${STALE_CONTACT_DAYS}+ days`}
          value={staleLeads.length}
          tone={staleLeads.length > 0 ? 'text-amber-600' : 'text-emerald-600'}
        />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-5 pt-3">
        {[
          { id: 'timeline', label: 'Timeline', count: interactions.length },
          { id: 'quiet',    label: 'Gone quiet', count: staleLeads.length },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              tab === t.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {t.label}
            {t.count > 0 && <span className="ml-1.5 opacity-70">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* Timeline */}
      {tab === 'timeline' && (
        <div className="px-5 py-4 space-y-4">
          {usedTypes.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => { setTypeFilter('all'); setShowCount(TIMELINE_PAGE); }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                  typeFilter === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                All {interactions.length}
              </button>
              {usedTypes.map(t => (
                <button
                  key={t.value}
                  onClick={() => { setTypeFilter(t.value); setShowCount(TIMELINE_PAGE); }}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                    typeFilter === t.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon name={t.icon} size={11} color="currentColor" />
                  {t.label} {stats?.byType?.[t.value]}
                </button>
              ))}
            </div>
          )}

          <InteractionTimeline
            interactions={filtered}
            loading={loading}
            error={error}
            limit={showCount}
            onLog={onLog}
            onDelete={onDelete ? handleDelete : undefined}
          />

          {filtered.length > showCount && (
            <button
              onClick={() => setShowCount(c => c + TIMELINE_PAGE)}
              className="w-full py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              Show older contacts
            </button>
          )}
        </div>
      )}

      {/* Gone quiet — the call list */}
      {tab === 'quiet' && (
        <div className="px-5 py-4">
          {staleLeads.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-11 h-11 rounded-full bg-emerald-100 mx-auto flex items-center justify-center mb-3">
                <Icon name="CheckCircle2" size={19} color="#059669" />
              </div>
              <p className="text-sm font-medium text-foreground">Nobody has gone quiet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Every open lead has been contacted in the last {STALE_CONTACT_DAYS} days.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {staleLeads.map(lead => (
                <li key={lead.id} className="py-3 flex flex-wrap items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground flex-shrink-0">
                    {(lead.full_name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div
                    className={`min-w-0 flex-1 ${onOpenRecord ? 'cursor-pointer' : ''}`}
                    onClick={() => onOpenRecord?.(lead)}
                  >
                    <p className={`text-sm font-medium text-foreground truncate ${onOpenRecord ? 'hover:text-primary' : ''}`}>
                      {lead.full_name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {(lead.stage || '').replace(/_/g, ' ')}
                      {lead.phone ? ` · ${lead.phone}` : ''}
                    </p>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                    (lead.quietDays ?? 999) >= 30
                      ? 'bg-red-100 text-red-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    {lead.quietDays === null
                      ? 'Never contacted'
                      : `${lead.quietDays} day${lead.quietDays === 1 ? '' : 's'} quiet`}
                  </span>
                  <button
                    onClick={() => onLogForLead?.(lead)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-all whitespace-nowrap"
                  >
                    Log contact
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default CrmPanel;

import React, { useState, useMemo } from 'react';
import Icon from '../AppIcon';
import { Sk, Empty, StatTile, fmtAgo, fmtDue, initials } from './crmFormat';
import { stageMeta, lostReasonMeta, isLostLead } from '../../config/crmVocabulary';
import { leadValue, formatCompactMoney, formatMoney } from '../../utils/pipelineValue';
import { STALE_LEAD_DAYS, PIPELINE_STAGES } from '../../hooks/useSupervisorLeads';

// The board is the agent portal's, reused rather than re-cut. It already knows
// how a stage column looks, what a card shows and how a drag reads, and a
// second copy would be two boards to keep in step with one set of stages.
import PipelineStage from '../../pages/sales-agent-portal/components/PipelineStage';

/**
 * The supervisor's OWN pipeline: prospects they are working themselves.
 *
 * Two views over the same rows, because a pipeline is asked two different
 * questions. The BOARD answers "where is everything" and is how a deal moves —
 * dragging a card is the whole interaction. The LIST answers "what do I do
 * next", which a board cannot: it sorts by neglect, so the deals nobody has
 * touched come first regardless of which column they sit in.
 *
 * The two nags above them are separate on purpose. "Never contacted" is a
 * failure to start and "gone quiet" is a failure to follow through; a single
 * "needs attention" count would hide which one this pipeline has.
 */

const TONE_DOT = {
  slate:   'bg-slate-400',
  blue:    'bg-blue-500',
  violet:  'bg-violet-500',
  amber:   'bg-amber-500',
  emerald: 'bg-emerald-500',
};

/** Where a deal sits, said the same way in both views. */
const StageBadge = ({ stage }) => {
  const meta = stageMeta(stage);
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted text-xs font-medium text-foreground">
      <span className={`w-1.5 h-1.5 rounded-full ${TONE_DOT[meta.tone] || TONE_DOT.slate}`} />
      {meta.label}
    </span>
  );
};

/**
 * One row of the worklist.
 *
 * The value is shown with its provenance intact: a figure read out of a free
 * text budget note is greyed and labelled "est.", because the difference
 * between "they said KES 4M" and "someone typed under 5M in March" is the
 * difference between a forecast and a guess.
 */
const LeadRow = ({ lead, onOpen, onLog, onSchedule, onDelete }) => {
  const { value, source } = leadValue(lead);
  const quiet = lead.last_contact_at;
  const lost  = isLostLead(lead);

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
      <td className="px-3 py-3">
        <button onClick={() => onOpen(lead)} className="flex items-center gap-3 text-left group">
          <span className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-bold text-primary flex-shrink-0">
            {initials(lead.full_name)}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
              {lead.full_name}
            </span>
            <span className="block text-xs text-muted-foreground truncate">
              {lead.phone || lead.email || 'No contact details'}
            </span>
          </span>
        </button>
      </td>

      <td className="px-3 py-3 whitespace-nowrap">
        <StageBadge stage={lead.stage} />
        {lost && lead.lost_reason && (
          <span className="block text-[11px] text-red-600 mt-1">
            Lost — {lostReasonMeta(lead.lost_reason).label}
          </span>
        )}
      </td>

      <td className="px-3 py-3 whitespace-nowrap text-right">
        {value > 0 ? (
          <span className={source === 'stated' ? 'text-sm font-semibold text-foreground' : 'text-sm text-muted-foreground'}>
            {formatCompactMoney(value)}
            {source !== 'stated' && <span className="text-[10px] ml-1">est.</span>}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">No value</span>
        )}
      </td>

      <td className="px-3 py-3 whitespace-nowrap text-xs text-muted-foreground">
        {fmtAgo(quiet, { never: 'Never contacted' })}
      </td>

      <td className="px-3 py-3 whitespace-nowrap text-xs">
        {lead.next_follow_up_at
          ? <span className="text-foreground">{fmtDue(lead.next_follow_up_at)}</span>
          : <span className="text-muted-foreground">Nothing booked</span>}
      </td>

      <td className="px-3 py-3">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => onLog(lead)}
            title="Record a contact"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Icon name="MessageSquarePlus" size={15} color="currentColor" />
          </button>
          <button
            onClick={() => onSchedule(lead)}
            title="Book a follow-up"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Icon name="CalendarPlus" size={15} color="currentColor" />
          </button>
          <button
            onClick={() => onDelete(lead)}
            title="Remove this lead"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
          >
            <Icon name="Trash2" size={15} color="currentColor" />
          </button>
        </div>
      </td>
    </tr>
  );
};

const LeadPipelinePanel = ({
  leads = [],
  board = {},
  summary,
  loading,
  onAdd,
  onOpen,
  onMoveStage,
  onLog,
  onSchedule,
  onDelete,
  onExport,
}) => {
  const [view, setView]     = useState('board');
  const [filter, setFilter] = useState('all');
  const [query, setQuery]   = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const staleIds    = new Set(summary.stale.map(l => l.id));
    const unworkedIds = new Set(summary.unworked.map(l => l.id));

    return leads
      .filter((l) => {
        if (filter === 'stale'    && !staleIds.has(l.id))    return false;
        if (filter === 'unworked' && !unworkedIds.has(l.id)) return false;
        if (filter === 'open'     && (l.converted_at || l.stage === 'closed')) return false;
        if (!q) return true;
        return [l.full_name, l.phone, l.email, l.asset_interest, l.source]
          .some(v => String(v || '').toLowerCase().includes(q));
      })
      // Neglect first: the point of the list view is the worklist a board
      // cannot show, so the deal nobody has touched outranks the big one
      // somebody rang yesterday.
      .sort((a, b) => {
        const at = a.last_contact_at ? new Date(a.last_contact_at).getTime() : 0;
        const bt = b.last_contact_at ? new Date(b.last_contact_at).getTime() : 0;
        return at - bt;
      });
  }, [leads, query, filter, summary]);

  // Swallowed on purpose: a failed drag must not throw out of a drop handler.
  // Real failures surface through the tab's error banner.
  const handleDrop = async (leadId, stage) => {
    try { await onMoveStage(leadId, stage); } catch { /* reported upstream */ }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[1, 2, 3, 4, 5].map(i => <Sk key={i} className="h-24" />)}
        </div>
        <Sk className="h-80" />
      </div>
    );
  }

  const FILTERS = [
    { id: 'all',      label: 'All',             count: leads.length },
    { id: 'open',     label: 'Still open',      count: summary.open },
    { id: 'unworked', label: 'Never contacted', count: summary.unworked.length },
    { id: 'stale',    label: `Quiet ${STALE_LEAD_DAYS}+ days`, count: summary.stale.length },
  ];

  return (
    <div className="space-y-4">

      {/* What the pipeline is worth, before what is in it */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatTile
          icon="Target" label="Open deals" value={summary.open}
          hint={`${summary.total} in the book`}
        />
        <StatTile
          icon="Flame" label="Opportunities" value={summary.opportunities}
          hint="Qualified or with an offer out"
        />
        <StatTile
          icon="Wallet" label="Pipeline value" value={formatCompactMoney(summary.pipelineValue)}
          hint={formatMoney(summary.pipelineValue)}
        />
        <StatTile
          icon="TrendingUp" label="Weighted forecast" value={formatCompactMoney(summary.weightedValue)}
          hint="Value × odds of landing"
        />
        <StatTile
          icon="Percent" label="Conversion"
          value={summary.conversionRate === null ? '—' : `${summary.conversionRate}%`}
          hint={summary.conversionRate === null ? 'Nothing settled yet' : `${summary.won} won · ${summary.lost} lost`}
          tone={summary.conversionRate === null ? 'default' : summary.conversionRate >= 30 ? 'good' : 'warn'}
        />
      </div>

      {/* Controls */}
      <div className="bg-card border border-border rounded-xl p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            {['board', 'list'].map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          {view === 'list' && (
            <>
              <div className="relative flex-1 min-w-[180px]">
                <Icon
                  name="Search" size={14} color="var(--color-muted-foreground)"
                  className="absolute left-3 top-1/2 -translate-y-1/2"
                />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search leads…"
                  className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                />
              </div>
              {FILTERS.map(f => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                    filter === f.id
                      ? 'border-primary/40 text-primary bg-primary/5'
                      : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  {f.label} ({f.count})
                </button>
              ))}
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => onExport(rows)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Icon name="Download" size={14} color="currentColor" />
              Export
            </button>
            <button
              onClick={onAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity"
            >
              <Icon name="Plus" size={14} color="currentColor" />
              New lead
            </button>
          </div>
        </div>

        {/* The two nags, always visible — they are the reason to open this tab */}
        {view === 'board' && (summary.unworked.length > 0 || summary.stale.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-border">
            {summary.unworked.length > 0 && (
              <button
                onClick={() => { setView('list'); setFilter('unworked'); }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs font-medium hover:bg-red-100 transition-colors"
              >
                <Icon name="AlertCircle" size={12} color="currentColor" />
                {summary.unworked.length} never contacted
              </button>
            )}
            {summary.stale.length > 0 && (
              <button
                onClick={() => { setView('list'); setFilter('stale'); }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium hover:bg-amber-100 transition-colors"
              >
                <Icon name="Clock" size={12} color="currentColor" />
                {summary.stale.length} quiet for {STALE_LEAD_DAYS}+ days
              </button>
            )}
          </div>
        )}
      </div>

      {/* The pipeline itself */}
      {leads.length === 0 ? (
        <div className="bg-card border border-border rounded-xl">
          <Empty
            icon="Target"
            title="No leads of your own yet"
            hint="This is your pipeline, separate from what your agents are working. Add the companies and people you are courting yourself, and every call, follow-up and deal value lands here."
            action={(
              <button
                onClick={onAdd}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                <Icon name="Plus" size={15} color="currentColor" />
                Add your first lead
              </button>
            )}
          />
        </div>
      ) : view === 'board' ? (
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-3">
            {leads.length} lead{leads.length === 1 ? '' : 's'} · drag a card to move it between stages
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {PIPELINE_STAGES.map(stage => (
              <PipelineStage
                key={stage.value}
                stageKey={stage.value}
                leads={board[stage.value] || []}
                onDrop={handleDrop}
                onLeadClick={onOpen}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {rows.length === 0 ? (
            <Empty
              icon="SearchX"
              title="Nothing matches that"
              hint="Try a different search, or clear the filter."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">Lead</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">Stage</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">Value</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">Last contact</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground">Next follow-up</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(lead => (
                    <LeadRow
                      key={lead.id}
                      lead={lead}
                      onOpen={onOpen}
                      onLog={onLog}
                      onSchedule={onSchedule}
                      onDelete={onDelete}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LeadPipelinePanel;

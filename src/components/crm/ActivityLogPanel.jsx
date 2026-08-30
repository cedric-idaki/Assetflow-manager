import React, { useState, useMemo } from 'react';
import Icon from '../AppIcon';
import { Sk, Empty, fmtWhen, ChannelBadge, OutcomeBadge, AuthorBadge } from './crmFormat';
import { LOGGABLE_CHANNELS, channelMeta } from '../../config/crmVocabulary';
import { INTERACTION_OUTCOMES } from '../../hooks/useCrmInteractions';

/**
 * The communication record: every contact with anybody, newest first.
 *
 * The client book answers "who have we neglected"; this answers "what actually
 * happened, and when did somebody say it would". It is the register you read
 * when a customer rings up claiming they were promised something, and the one
 * an auditor asks for.
 *
 * Filters are deliberately the controlled vocabularies rather than free text
 * search over the summary: channel and outcome are aggregatable and a summary
 * is not, which is the same reason those columns are constrained in the first
 * place. The search box is there for the name, which is not a vocabulary.
 */

const WINDOWS = [
  { value: 7,    label: 'Last 7 days' },
  { value: 30,   label: 'Last 30 days' },
  { value: 90,   label: 'Last quarter' },
  { value: null, label: 'Everything' },
];

const DAY = 86400000;

const ActivityLogPanel = ({ interactions = [], loading, nameFor, onExport, onDelete, onLog }) => {
  const [scope, setScope]     = useState('all');
  const [channel, setChannel] = useState('');
  const [outcome, setOutcome] = useState('');
  const [days, setDays]       = useState(30);
  const [query, setQuery]     = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const from = days ? Date.now() - days * DAY : null;

    return interactions.filter((i) => {
      if (!i) return false;
      if (scope === 'own'  && i.agent_id) return false;
      if (scope === 'team' && !i.agent_id) return false;
      if (channel && channelMeta(i.interaction_type).value !== channel) return false;
      if (outcome && i.outcome !== outcome) return false;
      if (from) {
        const at = new Date(i.occurred_at).getTime();
        if (Number.isNaN(at) || at < from) return false;
      }
      if (q) {
        const hay = [i.contact_name, nameFor(i), i.subject, i.summary, i.next_step]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [interactions, scope, channel, outcome, days, query, nameFor]);

  if (loading) {
    return <div className="space-y-3">{[1, 2, 3, 4].map(i => <Sk key={i} className="h-20" />)}</div>;
  }

  const filtered = rows.length !== interactions.length;

  return (
    <div className="space-y-4">

      {/* Filters */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2">
              <Icon name="Search" size={15} color="var(--color-muted-foreground)" />
            </span>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search names, summaries and next steps"
              className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <select
              value={channel}
              onChange={e => setChannel(e.target.value)}
              className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground"
            >
              <option value="">Any channel</option>
              {LOGGABLE_CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>

            <select
              value={outcome}
              onChange={e => setOutcome(e.target.value)}
              className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground"
            >
              <option value="">Any outcome</option>
              {INTERACTION_OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            <select
              value={days === null ? 'all' : days}
              onChange={e => setDays(e.target.value === 'all' ? null : Number(e.target.value))}
              className="px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground"
            >
              {WINDOWS.map(w => (
                <option key={String(w.value)} value={w.value === null ? 'all' : w.value}>{w.label}</option>
              ))}
            </select>

            <button
              onClick={() => onExport?.(rows)}
              disabled={!rows.length}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              <Icon name="Download" size={15} color="currentColor" />
              Export
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {[
              { value: 'all',  label: 'Everyone' },
              { value: 'own',  label: 'The office' },
              { value: 'team', label: 'Agents' },
            ].map(s => (
              <button
                key={s.value}
                onClick={() => setScope(s.value)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  scope === s.value ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => onLog(null)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
            style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
          >
            <Icon name="MessageSquarePlus" size={14} color="#fff" />
            Log a contact
          </button>
        </div>
      </div>

      {/* The record */}
      <div className="bg-card border border-border rounded-xl divide-y divide-border">
        {rows.length === 0 ? (
          <Empty
            icon={filtered ? 'FilterX' : 'MessagesSquare'}
            title={filtered ? 'Nothing matches those filters' : 'No contact has been recorded yet'}
            hint={filtered
              ? 'Widen the date range or clear a filter.'
              : 'Every call, WhatsApp, email and visit logged by the office or an agent lands here.'}
          />
        ) : (
          rows.slice(0, 300).map(i => (
            <div key={i.id} className="p-4 hover:bg-muted/30 transition-colors">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon name={channelMeta(i.interaction_type).icon} size={14} color="var(--color-muted-foreground)" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-foreground truncate">
                      {i.contact_name || nameFor(i) || 'Unnamed contact'}
                    </span>
                    <ChannelBadge value={i.interaction_type} />
                    <OutcomeBadge value={i.outcome} />
                    <AuthorBadge row={i} />
                  </div>

                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
                    <span>{fmtWhen(i.occurred_at)}</span>
                    <span>· {i.direction === 'inbound' ? 'they got in touch' : 'we reached out'}</span>
                    {i.duration_minutes ? <span>· {i.duration_minutes} min</span> : null}
                  </div>

                  {i.subject && <p className="text-xs font-semibold text-foreground mt-1.5">{i.subject}</p>}
                  {i.summary && <p className="text-xs text-foreground mt-1 whitespace-pre-wrap">{i.summary}</p>}
                  {i.next_step && (
                    <p className="text-[11px] text-primary mt-1.5">
                      <Icon name="ArrowRight" size={11} color="currentColor" className="inline mr-1" />
                      {i.next_step}
                    </p>
                  )}
                </div>

                {!i.agent_id && (
                  <button
                    onClick={() => onDelete(i)}
                    title="Remove this entry"
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors flex-shrink-0"
                  >
                    <Icon name="Trash2" size={14} color="currentColor" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {rows.length > 300 && (
        <p className="text-xs text-muted-foreground px-1">
          Showing the newest 300 of {rows.length}. Narrow the date range, or export for the whole set.
        </p>
      )}
    </div>
  );
};

export default ActivityLogPanel;

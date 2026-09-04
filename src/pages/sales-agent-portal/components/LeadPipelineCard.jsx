import React from 'react';
import Icon from '../../../components/AppIcon';
import { leadValue, formatCompactMoney } from '../../../utils/pipelineValue';

const getPriorityStyle = (priority) => {
  switch (priority) {
    case 'high': return 'bg-red-500/10 text-red-600 border-red-200';
    case 'medium': return 'bg-amber-500/10 text-amber-600 border-amber-200';
    case 'low': return 'bg-emerald-500/10 text-emerald-600 border-emerald-200';
    default: return 'bg-muted text-muted-foreground';
  }
};

const LeadPipelineCard = ({ lead, onDragStart, onLeadClick }) => {
  const initials = lead?.full_name
    ?.split(' ')?.map((n) => n?.[0])?.join('')?.toUpperCase()?.slice(0, 2) || '??';

  // What this card is worth. `source` decides how it reads: a stated value is
  // the agent's own figure and gets the bold treatment, an estimate read out of
  // the budget note is greyed and labelled, and a deal with neither says so
  // instead of showing a confident zero.
  const { value: dealValue, source: valueSource } = leadValue(lead);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="bg-card border border-border rounded-lg p-3 mb-2 cursor-grab active:cursor-grabbing hover:shadow-md hover:-translate-y-0.5 transition-all"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="text-xs font-bold text-primary">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-foreground truncate">{lead?.full_name}</p>
            <p className="text-xs text-muted-foreground truncate">{lead?.phone}</p>
          </div>
        </div>
        <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-medium border ${getPriorityStyle(lead?.priority)}`}>
          {lead?.priority}
        </span>
      </div>
      {lead?.asset_interest && (
        <div className="flex items-center gap-1.5 mb-1">
          <Icon name="Tag" size={11} color="var(--color-muted-foreground)" />
          <span className="text-xs text-muted-foreground truncate">{lead?.asset_interest}</span>
        </div>
      )}
      <div className="flex items-center gap-1.5 mb-1">
        <Icon name="DollarSign" size={11} color="var(--color-muted-foreground)" />
        {valueSource === 'stated' ? (
          <span className="text-xs font-semibold text-foreground">{formatCompactMoney(dealValue)}</span>
        ) : valueSource === 'estimated' ? (
          <span className="text-xs text-muted-foreground" title={`Estimated from the budget note: "${lead?.budget_range}"`}>
            ~{formatCompactMoney(dealValue)}
          </span>
        ) : (
          <span className="text-xs text-amber-600 font-medium">No value set</span>
        )}
      </div>

      {/* When the agent expects it to land. Only shown once it has been said —
          an undated deal is not late, it is just undated. */}
      {lead?.expected_close_date && (
        <div className="flex items-center gap-1.5 mb-1">
          <Icon name="CalendarCheck" size={11} color="var(--color-muted-foreground)" />
          <span className="text-xs text-muted-foreground">
            Closes {new Date(`${lead.expected_close_date}T00:00:00`).toLocaleDateString('en-GB', {
              day: 'numeric', month: 'short',
            })}
          </span>
        </div>
      )}
      {/* Next open follow-up — kept current by the leads_sync_next_follow_up
          trigger, so no join is needed to know a card is due. */}
      {lead?.next_follow_up_at && (
        <div className={`flex items-center gap-1.5 mb-1 ${
          new Date(lead.next_follow_up_at) < new Date() ? 'text-red-600' : 'text-primary'
        }`}>
          <Icon name="CalendarClock" size={11} color="currentColor" />
          <span className="text-xs font-medium">
            {new Date(lead.next_follow_up_at) < new Date() ? 'Overdue · ' : ''}
            {new Date(lead.next_follow_up_at).toLocaleDateString('en-GB', {
              day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
            })}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-border/50 mt-1">
        <span className="text-xs text-muted-foreground">
          {new Date(lead?.created_at)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
        <button
          onClick={() => onLeadClick?.(lead)}
          className="text-xs text-primary hover:underline"
        >
          View
        </button>
      </div>
    </div>
  );
};

export default LeadPipelineCard;
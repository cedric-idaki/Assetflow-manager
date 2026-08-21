import React from 'react';
import Icon from '../../../components/AppIcon';
import { typeMeta, outcomeMeta } from '../../../hooks/useCrmInteractions';

// Tailwind cannot see class names built at runtime, so every tone a type can
// carry is spelled out here where the scanner finds it.
const TONE = {
  blue:    'bg-blue-100 text-blue-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  violet:  'bg-violet-100 text-violet-700',
  amber:   'bg-amber-100 text-amber-700',
  orange:  'bg-orange-100 text-orange-700',
  indigo:  'bg-indigo-100 text-indigo-700',
  slate:   'bg-slate-100 text-slate-700',
};

const SENTIMENT = {
  positive: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  negative: 'bg-red-50 text-red-700 border-red-200',
  neutral:  'bg-muted text-muted-foreground border-border',
};

const fmtWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now.getTime() - 86400000).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (sameDay)   return `Today, ${time}`;
  if (yesterday) return `Yesterday, ${time}`;
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/**
 * One contact, rendered as a row in a vertical timeline.
 *
 * `showContact` is off inside a single lead's history — repeating the same name
 * down every row is noise — and on in the portal-wide feed, where the name is
 * the only thing telling two rows apart.
 */
const InteractionRow = ({ interaction, showContact = true, showAgent = false, onEdit, onDelete }) => {
  const t = typeMeta(interaction?.interaction_type);
  const o = outcomeMeta(interaction?.outcome);
  const inbound = interaction?.direction === 'inbound';

  return (
    <li className="relative pl-9 pb-4 last:pb-0">
      {/* Rail */}
      <span className="absolute left-3 top-8 bottom-0 w-px bg-border last:hidden" aria-hidden="true" />
      <span className={`absolute left-0 top-0.5 w-6 h-6 rounded-full flex items-center justify-center ${TONE[t.tone] || TONE.slate}`}>
        <Icon name={t.icon} size={12} color="currentColor" />
      </span>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-semibold text-foreground">
          {showContact && interaction?.contact_name ? interaction.contact_name : t.label}
        </span>
        {showContact && interaction?.contact_name && (
          <span className="text-xs text-muted-foreground">· {t.label}</span>
        )}
        <span
          className="text-xs text-muted-foreground inline-flex items-center gap-1"
          title={inbound ? 'They reached out' : 'The agent reached out'}
        >
          <Icon name={inbound ? 'ArrowDownLeft' : 'ArrowUpRight'} size={11} color="currentColor" />
          {inbound ? 'Inbound' : 'Outbound'}
        </span>
        {interaction?.duration_minutes ? (
          <span className="text-xs text-muted-foreground">· {interaction.duration_minutes} min</span>
        ) : null}
        {o && (
          <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${SENTIMENT[o.sentiment]}`}>
            {o.label}
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
          {fmtWhen(interaction?.occurred_at)}
        </span>
      </div>

      {showAgent && interaction?.agentName && (
        <p className="mt-0.5 text-xs text-muted-foreground flex items-center gap-1">
          <Icon name="User" size={11} color="currentColor" />
          {interaction.agentName}
        </p>
      )}

      {interaction?.summary && (
        <p className="mt-1 text-sm text-foreground whitespace-pre-line">{interaction.summary}</p>
      )}

      {interaction?.next_step && (
        <p className="mt-1.5 text-xs text-primary flex items-start gap-1.5">
          <Icon name="ArrowRight" size={12} color="currentColor" className="mt-0.5 flex-shrink-0" />
          <span><span className="font-semibold">Next:</span> {interaction.next_step}</span>
        </p>
      )}

      {(onEdit || onDelete) && (
        <div className="mt-1.5 flex items-center gap-3">
          {onEdit && (
            <button
              onClick={() => onEdit(interaction)}
              className="text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              Edit
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(interaction)}
              className="text-xs text-muted-foreground hover:text-red-600 transition-colors"
            >
              Remove
            </button>
          )}
        </div>
      )}
    </li>
  );
};

const InteractionTimeline = ({
  interactions = [],
  loading = false,
  error = null,
  emptyLabel = 'No contact logged yet.',
  emptyHint = 'Every call, meeting and WhatsApp you log here is history the next conversation can start from.',
  showContact = true,
  showAgent = false,
  limit = null,
  onEdit,
  onDelete,
  onLog,
}) => {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="animate-pulse flex gap-3">
            <div className="w-6 h-6 rounded-full bg-muted flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-muted rounded w-1/3" />
              <div className="h-3 bg-muted rounded w-2/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // A failed load and an empty history render identically once the rows are
  // gone, and "you have logged nothing" is the one an agent believes.
  if (error) {
    return (
      <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
        <Icon name="AlertCircle" size={15} color="#dc2626" className="mt-0.5 flex-shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  if (!interactions.length) {
    return (
      <div className="text-center py-8 px-4">
        <div className="w-11 h-11 rounded-full bg-muted mx-auto flex items-center justify-center mb-3">
          <Icon name="MessageSquare" size={19} color="var(--color-muted-foreground)" />
        </div>
        <p className="text-sm font-medium text-foreground">{emptyLabel}</p>
        {emptyHint && <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">{emptyHint}</p>}
        {onLog && (
          <button
            onClick={onLog}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity"
          >
            <Icon name="Plus" size={13} color="currentColor" />
            Log a contact
          </button>
        )}
      </div>
    );
  }

  const rows = limit ? interactions.slice(0, limit) : interactions;

  return (
    <ul className="relative">
      {rows.map(i => (
        <InteractionRow
          key={i.id}
          interaction={i}
          showContact={showContact}
          showAgent={showAgent}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
      {limit && interactions.length > limit && (
        <li className="pl-9 text-xs text-muted-foreground">
          + {interactions.length - limit} earlier contact{interactions.length - limit !== 1 ? 's' : ''}
        </li>
      )}
    </ul>
  );
};

export { InteractionRow };
export default InteractionTimeline;

/**
 * Shared presentation for the administrator's CRM.
 *
 * The five panels of the admin CRM all render the same handful of things — a
 * date, a sum of money, a channel badge, an outcome badge, how long ago
 * something happened. Five private copies of that is how "14 days ago" on one
 * screen becomes "2 weeks" on the next and a reader stops trusting either.
 *
 * CrmOversightTab keeps its own copies deliberately: it is a shipped screen
 * with its own layout, and rewriting it to import from here would be a change
 * to working code for no gain to the reader.
 */

import React from 'react';
import Icon from '../AppIcon';
import { channelMeta } from '../../config/crmVocabulary';
import { outcomeMeta } from '../../hooks/useCrmInteractions';

export const Sk = ({ className = '' }) => (
  <div className={`animate-pulse bg-muted rounded-lg ${className}`} />
);

export const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const fmtWhen = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/** Matches the KES convention used across the admin tabs. */
export const fmtMoney = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;

/**
 * How long ago, in the words a person would use.
 *
 * "Never" is a first-class answer rather than a dash: on a client book it is
 * the most actionable value on the row, and a dash reads as missing data.
 */
export const fmtAgo = (iso, { never = 'never' } = {}) => {
  if (!iso) return never;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return never;
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1)    return 'just now';
  if (mins < 60)   return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)    return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1)  return 'yesterday';
  if (days < 30)   return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  return fmtDate(iso);
};

/** When something is due, said forwards. */
export const fmtDue = (iso) => {
  if (!iso) return 'no date';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'no date';
  const mins = Math.round((t - Date.now()) / 60000);
  if (mins < 0) {
    const late = Math.abs(mins);
    if (late < 60) return `${late} min late`;
    const hrs = Math.floor(late / 60);
    if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} late`;
    return `${Math.floor(hrs / 24)} day${Math.floor(hrs / 24) === 1 ? '' : 's'} late`;
  }
  if (mins < 60) return `in ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ${hrs} hr${hrs === 1 ? '' : 's'}`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
};

export const initials = (name) =>
  (name || '?').split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase();

const TONE_BADGE = {
  slate:   'bg-slate-100 text-slate-700 border-slate-200',
  blue:    'bg-blue-50 text-blue-700 border-blue-200',
  violet:  'bg-violet-50 text-violet-700 border-violet-200',
  amber:   'bg-amber-50 text-amber-700 border-amber-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  orange:  'bg-orange-50 text-orange-700 border-orange-200',
  indigo:  'bg-indigo-50 text-indigo-700 border-indigo-200',
  red:     'bg-red-50 text-red-700 border-red-200',
};

/** How a contact happened, or will. */
export const ChannelBadge = ({ value, withIcon = true, className = '' }) => {
  const meta = channelMeta(value);
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${
      TONE_BADGE[meta.tone] || TONE_BADGE.slate
    } ${className}`}>
      {withIcon && <Icon name={meta.icon} size={11} color="currentColor" />}
      {meta.label}
    </span>
  );
};

const SENTIMENT_BADGE = {
  positive: TONE_BADGE.emerald,
  negative: TONE_BADGE.red,
  neutral:  TONE_BADGE.slate,
};

/** What came of it. Nothing is rendered when the outcome was never recorded. */
export const OutcomeBadge = ({ value }) => {
  const meta = outcomeMeta(value);
  if (!meta) return null;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${
      SENTIMENT_BADGE[meta.sentiment]
    }`}>
      {meta.label}
    </span>
  );
};

/** How warm the relationship is. The three states deriveClientBook produces. */
export const RELATIONSHIP = {
  recent: { label: 'In touch',       badge: TONE_BADGE.emerald, dot: 'bg-emerald-500' },
  quiet:  { label: 'Gone quiet',     badge: TONE_BADGE.amber,   dot: 'bg-amber-500' },
  never:  { label: 'Never contacted',badge: TONE_BADGE.red,     dot: 'bg-red-500' },
};

export const RelationshipBadge = ({ state }) => {
  const meta = RELATIONSHIP[state] || RELATIONSHIP.never;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${meta.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
};

/**
 * Who wrote a row: the office, or one of the agents.
 *
 * It earns its place because it is also the answer to "why can I not edit
 * this" — the write policies only accept the tenant's own rows.
 */
export const AuthorBadge = ({ row }) => (
  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${
    row?.agent_id ? TONE_BADGE.violet : TONE_BADGE.blue
  }`}>
    <Icon name={row?.agent_id ? 'UserCheck' : 'Building2'} size={10} color="currentColor" />
    {row?.agent_id ? 'Agent' : 'Office'}
  </span>
);

/** The empty state every panel needs, said the same way each time. */
export const Empty = ({ icon = 'Inbox', title, hint, action = null }) => (
  <div className="text-center py-10 px-4">
    <div className="w-11 h-11 rounded-xl bg-muted mx-auto flex items-center justify-center">
      <Icon name={icon} size={20} color="var(--color-muted-foreground)" />
    </div>
    <p className="text-sm font-medium text-foreground mt-3">{title}</p>
    {hint && <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">{hint}</p>}
    {action}
  </div>
);

/** A number with a word under it. The unit every CRM header is built from. */
export const StatTile = ({ icon, label, value, hint, tone = 'default', onClick }) => {
  const tones = {
    default: 'text-foreground',
    good:    'text-emerald-600',
    warn:    'text-amber-600',
    bad:     'text-red-600',
  };
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
      className={`bg-card border border-border rounded-xl p-4 text-left w-full ${
        onClick ? 'hover:border-primary/40 transition-colors' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <Icon name={icon} size={14} color="var(--color-muted-foreground)" />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <p className={`text-2xl font-bold mt-2 ${tones[tone] || tones.default}`}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </Wrapper>
  );
};

export default {
  Sk, fmtDate, fmtWhen, fmtMoney, fmtAgo, fmtDue, initials,
  ChannelBadge, OutcomeBadge, RelationshipBadge, AuthorBadge, Empty, StatTile, RELATIONSHIP,
};

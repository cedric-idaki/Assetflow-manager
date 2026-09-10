import React, { useState, useMemo } from 'react';
import Icon from '../AppIcon';
import {
  Sk, Empty, fmtMoney, fmtAgo, fmtDue, initials,
  ChannelBadge, RelationshipBadge, RELATIONSHIP,
} from './crmFormat';

/**
 * The administrator's client book.
 *
 * The Clients tab that already exists is an ACCOUNT list: who they are, what
 * they owe, whether their KYC passed. This is the same people seen as
 * RELATIONSHIPS — when they were last spoken to, on what channel, what is
 * booked next, and which of them nobody has called in a month. Those are
 * different questions and they sort differently, which is why this is its own
 * screen rather than three more columns on that one.
 *
 * The filters are the point of the screen. "Never contacted" and "Gone quiet"
 * are not decorations: they are the two work queues an admin actually has, and
 * everything else here exists to get somebody into one of them and then out.
 */

const FILTERS = [
  { value: 'all',     label: 'Everyone',        icon: 'Users' },
  { value: 'never',   label: 'Never contacted', icon: 'UserX' },
  { value: 'quiet',   label: 'Gone quiet',      icon: 'Clock' },
  { value: 'due',     label: 'Follow-up due',   icon: 'CalendarClock' },
  { value: 'owing',   label: 'Owes money',      icon: 'Wallet' },
];

const SORTS = [
  { value: 'quiet',   label: 'Longest quiet' },
  { value: 'recent',  label: 'Recently contacted' },
  { value: 'owing',   label: 'Biggest balance' },
  { value: 'touches', label: 'Most contact' },
  { value: 'name',    label: 'Name A–Z' },
];

const matches = (c, q) => {
  if (!q) return true;
  const hay = [c.full_name, c.account_number, c.phone, c.email, c.city]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
};

/**
 * Order the book.
 *
 * "Longest quiet" is the default because it is the only order that puts work
 * at the top: a book sorted A–Z asks the reader to find the neglected accounts
 * themselves, which is the job the screen is supposed to be doing. A client
 * nobody has EVER contacted sorts above one contacted long ago — never is
 * worse than late.
 */
const sortBook = (rows, sort) => {
  const copy = [...rows];
  switch (sort) {
    case 'recent':
      return copy.sort((a, b) =>
        (b.lastContactAt ? new Date(b.lastContactAt).getTime() : -Infinity)
        - (a.lastContactAt ? new Date(a.lastContactAt).getTime() : -Infinity));
    case 'owing':
      return copy.sort((a, b) => b.outstanding - a.outstanding);
    case 'touches':
      return copy.sort((a, b) => b.touchCount - a.touchCount);
    case 'name':
      return copy.sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
    case 'quiet':
    default:
      return copy.sort((a, b) => {
        const av = a.quietDays === null ? Infinity : a.quietDays;
        const bv = b.quietDays === null ? Infinity : b.quietDays;
        return bv - av;
      });
  }
};

const ClientRow = ({ row, onOpen, onLog, onSchedule }) => (
  <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors border-b border-border last:border-0">
    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-xs font-bold text-white ${
      row.contactState === 'never' ? 'bg-red-400'
        : row.contactState === 'quiet' ? 'bg-amber-500' : 'bg-emerald-500'
    }`}>
      {initials(row.full_name)}
    </div>

    <button onClick={() => onOpen(row)} className="flex-1 min-w-0 text-left">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-foreground truncate">{row.full_name || 'Unnamed client'}</span>
        <RelationshipBadge state={row.contactState} />
        {row.followUpOverdue && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium bg-red-50 text-red-700 border-red-200">
            <Icon name="AlertTriangle" size={10} color="currentColor" />
            Follow-up late
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
        <span>{row.account_number || '—'}</span>
        {row.phone && <span>· {row.phone}</span>}
        {row.outstanding > 0 && (
          <span className="text-amber-600 font-medium">· {fmtMoney(row.outstanding)} outstanding</span>
        )}
      </div>
    </button>

    <div className="hidden md:block text-right w-40 flex-shrink-0">
      <p className="text-xs font-medium text-foreground">{fmtAgo(row.lastContactAt)}</p>
      <div className="flex items-center justify-end gap-1.5 mt-0.5">
        {row.lastChannel && <ChannelBadge value={row.lastChannel} />}
        <span className="text-[11px] text-muted-foreground">
          {row.touchCount} contact{row.touchCount === 1 ? '' : 's'}
        </span>
      </div>
    </div>

    <div className="hidden lg:block text-right w-32 flex-shrink-0">
      {row.nextFollowUp ? (
        <>
          <p className={`text-xs font-medium ${row.followUpOverdue ? 'text-red-600' : 'text-foreground'}`}>
            {fmtDue(row.nextFollowUp.scheduled_at)}
          </p>
          <p className="text-[11px] text-muted-foreground truncate">
            {row.nextFollowUp.appointment_type?.replace(/_/g, ' ')}
          </p>
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">nothing booked</p>
      )}
    </div>

    <div className="flex items-center gap-1 flex-shrink-0">
      <button
        onClick={() => onLog(row)}
        title="Log a contact"
        className="p-2 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
      >
        <Icon name="MessageSquarePlus" size={16} color="currentColor" />
      </button>
      <button
        onClick={() => onSchedule(row)}
        title="Schedule a follow-up"
        className="p-2 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
      >
        <Icon name="CalendarPlus" size={16} color="currentColor" />
      </button>
      <button
        onClick={() => onOpen(row)}
        title="Open record"
        className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
      >
        <Icon name="ChevronRight" size={16} color="currentColor" />
      </button>
    </div>
  </div>
);

const ClientBookPanel = ({ book = [], loading, onOpen, onLog, onSchedule, onExport }) => {
  const [query, setQuery]   = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort]     = useState('quiet');

  const counts = useMemo(() => ({
    all:   book.length,
    never: book.filter(c => c.contactState === 'never').length,
    quiet: book.filter(c => c.contactState === 'quiet').length,
    due:   book.filter(c => c.nextFollowUp).length,
    owing: book.filter(c => c.outstanding > 0).length,
  }), [book]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = book.filter((c) => {
      if (!matches(c, q)) return false;
      switch (filter) {
        case 'never': return c.contactState === 'never';
        case 'quiet': return c.contactState === 'quiet';
        case 'due':   return Boolean(c.nextFollowUp);
        case 'owing': return c.outstanding > 0;
        default:      return true;
      }
    });
    return sortBook(filtered, sort);
  }, [book, query, filter, sort]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Sk className="h-12" />
        {[1, 2, 3, 4, 5].map(i => <Sk key={i} className="h-16" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Controls */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2">
              <Icon name="Search" size={15} color="var(--color-muted-foreground)" />
            </span>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name, account, phone or email"
              className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
            />
          </div>
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            className="px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
          >
            {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
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

        <div className="flex flex-wrap gap-2">
          {FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                filter === f.value
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              <Icon name={f.icon} size={13} color="currentColor" />
              {f.label}
              <span className={`px-1.5 rounded ${filter === f.value ? 'bg-primary/10' : 'bg-muted'}`}>
                {counts[f.value]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Book */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-muted/40 border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
          <span className="w-9" />
          <span className="flex-1">Client</span>
          <span className="w-40 text-right">Last contact</span>
          <span className="hidden lg:block w-32 text-right">Next follow-up</span>
          <span className="w-[104px]" />
        </div>

        {rows.length === 0 ? (
          <Empty
            icon={query ? 'SearchX' : 'Users'}
            title={query ? 'Nobody matches that search' : (
              filter === 'all' ? 'No clients yet' : `Nothing in "${FILTERS.find(f => f.value === filter)?.label}"`
            )}
            hint={query
              ? 'Try part of a name, an account number or a phone number.'
              : (filter === 'all'
                ? 'Clients added in the Clients tab appear here with their contact history.'
                : 'That is a good thing — this queue is empty.')}
          />
        ) : (
          rows.map(row => (
            <ClientRow
              key={row.id}
              row={row}
              onOpen={onOpen}
              onLog={onLog}
              onSchedule={onSchedule}
            />
          ))
        )}
      </div>

      {rows.length > 0 && (
        <p className="text-xs text-muted-foreground px-1">
          {rows.length} of {book.length} client{book.length === 1 ? '' : 's'}
          {filter !== 'all' && ` · filtered by ${FILTERS.find(f => f.value === filter)?.label.toLowerCase()}`}
          {' · '}
          <span className="text-amber-600">{counts.quiet} gone quiet</span>
          {' · '}
          <span className="text-red-600">{counts.never} never contacted</span>
        </p>
      )}
    </div>
  );
};

export { sortBook, RELATIONSHIP };
export default ClientBookPanel;

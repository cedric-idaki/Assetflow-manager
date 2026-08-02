import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';

// The ticket list. Assists carry one note and then go quiet; a ticket is a
// thread, so this panel's job is to make it obvious which threads are waiting
// on THIS agent — unread first, unclaimed pool tickets next, everything else
// after that.

export const TICKET_STATUS_STYLES = {
  open:        { cls: 'bg-amber-500/10 text-amber-600',     icon: 'CircleDot',    label: 'Open' },
  in_progress: { cls: 'bg-blue-500/10 text-blue-600',       icon: 'MessagesSquare', label: 'In progress' },
  waiting:     { cls: 'bg-purple-500/10 text-purple-600',   icon: 'Clock',        label: 'Waiting' },
  resolved:    { cls: 'bg-emerald-500/10 text-emerald-600', icon: 'CheckCircle',  label: 'Resolved' },
  closed:      { cls: 'bg-muted text-muted-foreground',     icon: 'Archive',      label: 'Closed' },
};

export const TICKET_PRIORITY_STYLES = {
  urgent: { cls: 'bg-red-500/10 text-red-600',       label: 'Urgent' },
  high:   { cls: 'bg-orange-500/10 text-orange-600', label: 'High' },
  normal: { cls: 'bg-muted text-muted-foreground',   label: 'Normal' },
  low:    { cls: 'bg-muted text-muted-foreground',   label: 'Low' },
};

export const TICKET_CATEGORY_LABELS = {
  onboarding:   'Onboarding help',
  lead_support: 'Lead support',
  commission:   'Commission',
  training:     'Training',
  system:       'System issue',
  other:        'General',
};

// "2h ago" / "3d ago" — how long the other agent has been waiting.
export const ago = (d) => {
  if (!d) return '';
  const mins  = Math.max(0, Math.round((Date.now() - new Date(d)) / 60000));
  const hours = Math.round(mins / 60);
  const days  = Math.round(hours / 24);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
};

export const initials = (name) =>
  (name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

export const TicketStatusChip = ({ status }) => {
  const s = TICKET_STATUS_STYLES[status] || TICKET_STATUS_STYLES.open;
  return (
    <span className={`flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${s.cls}`}>
      <Icon name={s.icon} size={10} color="currentColor" />
      {s.label}
    </span>
  );
};

export const TicketPriorityChip = ({ priority }) => {
  // Normal is the default on every ticket — a chip on all of them would say
  // nothing, so only the ones that are actually urgent get a badge.
  if (!priority || ['normal', 'low'].includes(priority)) return null;
  const p = TICKET_PRIORITY_STYLES[priority] || TICKET_PRIORITY_STYLES.normal;
  return (
    <span className={`flex-shrink-0 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wide ${p.cls}`}>
      {p.label}
    </span>
  );
};

// ── One ticket in the list ───────────────────────────────────────────────────
const TicketRow = ({ ticket, agentId, unread, onOpen, onClaim }) => {
  const [claiming, setClaiming] = useState(false);
  const mine        = ticket.opened_by_agent_id === agentId;
  const other       = mine ? ticket.assignee : ticket.opener;
  const unclaimed   = !ticket.assigned_agent_id;
  const canClaim    = unclaimed && !mine && typeof onClaim === 'function';

  const claim = async (e) => {
    e.stopPropagation();
    setClaiming(true);
    try { await onClaim(ticket); } finally { setClaiming(false); }
  };

  return (
    <button
      type="button"
      onClick={() => onOpen(ticket)}
      className={`w-full text-left p-3 rounded-xl border transition-colors ${
        unread
          ? 'bg-blue-50/60 border-blue-200 hover:bg-blue-50'
          : 'bg-muted/30 border-transparent hover:bg-muted/50'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${
          unclaimed ? 'bg-amber-500/15 text-amber-700' : 'bg-primary/10 text-primary'
        }`}>
          {unclaimed && !mine ? <Icon name="Inbox" size={15} color="currentColor" /> : initials(other?.full_name)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-foreground truncate">
              {unread && <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-600 mr-1.5 align-middle" />}
              {ticket.subject}
            </p>
            <div className="flex items-center gap-1.5">
              <TicketPriorityChip priority={ticket.priority} />
              <TicketStatusChip status={ticket.status} />
            </div>
          </div>

          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {ticket.ticket_no} · {TICKET_CATEGORY_LABELS[ticket.category] || 'General'}
            {' · '}
            {unclaimed
              ? (mine ? 'waiting for a gold agent to claim it' : `from ${ticket.opener?.full_name || 'an agent'}`)
              : mine
              ? `with ${other?.full_name || 'a gold agent'}`
              : `raised by ${other?.full_name || 'an agent'}`}
          </p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Icon name="MessageSquare" size={11} color="currentColor" />
              {ticket.message_count || 0}
            </span>
            <span className="text-xs text-muted-foreground">{ago(ticket.last_message_at)}</span>
            {ticket.admin_name && (
              <span className="text-xs text-muted-foreground truncate">· {ticket.admin_name}</span>
            )}
            {canClaim && (
              <span
                role="button"
                tabIndex={0}
                onClick={claim}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') claim(e); }}
                className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
              >
                <Icon name="Hand" size={11} color="white" />
                {claiming ? 'Claiming...' : 'Claim'}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
};

const EmptyState = ({ icon, title, hint, action }) => (
  <div className="flex flex-col items-center justify-center py-10 text-center">
    <Icon name={icon} size={30} color="var(--color-muted-foreground)" />
    <p className="text-sm font-medium text-muted-foreground mt-2">{title}</p>
    <p className="text-xs text-muted-foreground/70 mt-0.5 max-w-xs">{hint}</p>
    {action}
  </div>
);

// ── Panel ────────────────────────────────────────────────────────────────────
const TicketsPanel = ({
  buckets, agentId, isGoldAgent, loading, error,
  isUnread, onOpen, onClaim, onNewTicket, onRefresh, embedded,
}) => {
  const { assigned = [], raised = [], pool = [], closed = [], unreadCount = 0 } = buckets || {};

  // A gold agent's day starts with what has been given to them; a bronze
  // agent's with what they asked for. The profile that decides which arrives
  // after the first render, so the tab has to follow it rather than be picked
  // once on mount.
  const [tab, setTab] = useState(isGoldAgent ? 'assigned' : 'raised');
  useEffect(() => { setTab(isGoldAgent ? 'assigned' : 'raised'); }, [isGoldAgent]);

  const shell = embedded ? '' : 'bg-card border border-border rounded-xl p-5';
  const unreadIn = (list) => (list || []).filter(t => isUnread?.(t)).length;

  if (loading) {
    return (
      <div className={shell}>
        <div className="h-5 bg-muted rounded w-44 mb-4 animate-pulse" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex gap-3 mb-3 animate-pulse">
            <div className="w-9 h-9 rounded-full bg-muted flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 bg-muted rounded w-2/3" />
              <div className="h-3 bg-muted rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const TABS = [
    { key: 'assigned', label: 'Assigned to me', list: assigned, show: true },
    { key: 'raised',   label: 'I raised',       list: raised,   show: true },
    { key: 'pool',     label: 'Unclaimed',      list: pool,     show: isGoldAgent || pool.length > 0 },
    { key: 'closed',   label: 'Closed',         list: closed,   show: true },
  ].filter(t => t.show);

  const activeTab  = TABS.some(t => t.key === tab) ? tab : TABS[0]?.key;
  const activeList = TABS.find(t => t.key === activeTab)?.list || [];

  const EMPTY = {
    assigned: {
      icon: 'Inbox',
      title: 'No tickets assigned to you',
      hint: 'When an agent raises a ticket with you — or you claim one from the pool — the conversation lives here.',
    },
    raised: {
      icon: 'Ticket',
      title: "You haven't raised a ticket yet",
      hint: 'Ask a gold agent for help, or leave it unassigned and the first free gold agent picks it up.',
    },
    pool: {
      icon: 'Hand',
      title: 'Nothing waiting to be claimed',
      hint: 'Tickets raised for no agent in particular land here. Claim one and it becomes yours to answer.',
    },
    closed: {
      icon: 'Archive',
      title: 'No closed tickets yet',
      hint: 'Resolved and closed tickets stay here with the whole conversation on them.',
    },
  };

  return (
    <div className={shell}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        {!embedded && (
          <div className="flex items-center gap-2">
            <Icon name="Ticket" size={18} color="var(--color-primary)" />
            <div>
              <h3 className="font-heading font-semibold text-base text-foreground">Tickets</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {unreadCount > 0
                  ? `${unreadCount} ticket${unreadCount !== 1 ? 's' : ''} with something new`
                  : 'How you and the other agents talk inside the system'}
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 ml-auto">
          {onRefresh && (
            <button
              onClick={onRefresh}
              title="Refresh tickets"
              className="p-2 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Icon name="RefreshCw" size={13} color="currentColor" />
            </button>
          )}
          {onNewTicket && (
            <button
              onClick={onNewTicket}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
            >
              <Icon name="Plus" size={13} color="white" />
              New ticket
            </button>
          )}
        </div>
      </div>

      {/* A load that failed must not read as "nobody has written to you". */}
      {error && (
        <div className="flex flex-wrap items-center gap-2 mb-3 px-3 py-2 rounded-xl bg-red-50 border border-red-200">
          <Icon name="AlertTriangle" size={14} color="#dc2626" />
          <p className="text-xs font-medium text-red-700">
            Tickets could not be loaded, so this list may be incomplete.
          </p>
          {onRefresh && (
            <button onClick={onRefresh} className="ml-auto text-xs font-semibold text-red-700 hover:underline">
              Try again
            </button>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {TABS.map(t => {
          const n = unreadIn(t.list);
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === t.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
              {t.list.length > 0 && (
                <span className={activeTab === t.key ? 'opacity-80' : 'opacity-60'}>{t.list.length}</span>
              )}
              {n > 0 && activeTab !== t.key && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
              )}
            </button>
          );
        })}
      </div>

      {activeList.length === 0 ? (
        <EmptyState
          {...EMPTY[activeTab]}
          action={activeTab === 'raised' && onNewTicket ? (
            <button onClick={onNewTicket} className="mt-3 text-xs text-primary hover:underline font-semibold">
              Raise a ticket →
            </button>
          ) : null}
        />
      ) : (
        <div className="space-y-2 max-h-[460px] overflow-y-auto scrollbar-custom pr-1">
          {activeList.map(t => (
            <TicketRow
              key={t.id}
              ticket={t}
              agentId={agentId}
              unread={isUnread?.(t)}
              onOpen={onOpen}
              onClaim={activeTab === 'pool' || !t.assigned_agent_id ? onClaim : null}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default TicketsPanel;

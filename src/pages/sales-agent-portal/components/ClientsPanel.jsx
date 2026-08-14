import React, { useState, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import { BUCKET_ORDER, BUCKET_META, CRITICAL_WINDOW_DAYS } from '../../../hooks/useAgentClients';

/**
 * The agent's client book. Who they signed, whether those accounts are still
 * paying, and who to ring today.
 *
 * Company-mode agents see real subscription periods; client-mode agents see
 * account standing, because a client row has no subscription to expire (see
 * the header note in useAgentClients).
 */

const TONE = {
  red:     { pill: 'bg-red-100 text-red-700',         dot: 'bg-red-500',     chip: 'border-red-300 bg-red-50 text-red-700'         },
  amber:   { pill: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-500',   chip: 'border-amber-300 bg-amber-50 text-amber-700'   },
  emerald: { pill: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500', chip: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  slate:   { pill: 'bg-muted text-muted-foreground',  dot: 'bg-slate-400',   chip: 'border-border bg-muted/40 text-muted-foreground' },
};

const toneFor = (bucket) => TONE[BUCKET_META[bucket]?.tone || 'slate'];

const shortDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

const initials = (name) =>
  (name || 'C').split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase();

const money = (n) =>
  n == null ? null : `KES ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// Kenyan numbers arrive as 07…, 2547… or +2547… — WhatsApp wants bare digits.
const waNumber = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  return digits;
};

// ── One row in the book ──────────────────────────────────────────────────────
const ClientRow = ({ client, tracksSubscriptions, onFollowUp }) => {
  const tone = toneFor(client.bucket);
  const urgent =
    client.bucket === 'expired' ||
    (client.bucket === 'expiring' && client.daysRemaining != null && client.daysRemaining <= CRITICAL_WINDOW_DAYS);
  const wa = waNumber(client.phone);

  return (
    <div className={`p-3 rounded-xl border transition-colors ${
      urgent ? 'border-red-200 bg-red-50/40 hover:bg-red-50/70' : 'border-border bg-background hover:bg-muted/30'
    }`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        {/* Who */}
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-foreground shrink-0">
            {initials(client.name)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate" title={client.name}>
              {client.name}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {[
                client.contactName && client.contactName !== client.name ? client.contactName : null,
                client.phone,
                client.accountNumber,
              ].filter(Boolean).join(' · ') || 'No contact details'}
            </p>
            {tracksSubscriptions && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {[
                  client.planName ? `${client.planName} plan` : null,
                  client.seats != null ? `${client.seats} seat${client.seats === 1 ? '' : 's'}` : null,
                  client.endDate ? `ends ${shortDate(client.endDate)}` : null,
                  client.renewals > 0 ? `${client.renewals} renewal${client.renewals === 1 ? '' : 's'}` : null,
                ].filter(Boolean).join(' · ') || 'No subscription on record'}
              </p>
            )}
          </div>
        </div>

        {/* Standing + actions */}
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs px-2 py-1 rounded-full font-semibold whitespace-nowrap ${tone.pill}`}>
            {client.statusLabel}
          </span>

          {client.phone && (
            <a
              href={`tel:${client.phone}`}
              title={`Call ${client.phone}`}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            >
              <Icon name="Phone" size={14} color="var(--color-muted-foreground)" />
            </a>
          )}
          {wa && (
            <a
              href={`https://wa.me/${wa}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Message on WhatsApp"
              className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            >
              <Icon name="MessageCircle" size={14} color="var(--color-muted-foreground)" />
            </a>
          )}
          <button
            onClick={() => onFollowUp(client)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-border hover:border-primary/50 hover:bg-primary/5 text-foreground transition-colors"
          >
            <Icon name="CalendarPlus" size={13} color="currentColor" />
            Follow up
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Panel ────────────────────────────────────────────────────────────────────
const ClientsPanel = ({
  clients = [],
  counts = {},
  loading = false,
  error = null,
  subscriptionsBlocked = false,
  tracksSubscriptions = false,
  enabled = true,
  onRefresh,
  onFollowUp,
  onRegister,
  onRegisterSacco,
  canRegisterSacco = false,
  registerLabel = 'Register',
  registerNoun = 'client',
}) => {
  const [filter, setFilter] = useState('all');
  const [query, setQuery]   = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients.filter((c) => {
      if (filter !== 'all' && c.bucket !== filter) return false;
      if (!q) return true;
      return [c.name, c.contactName, c.email, c.phone, c.accountNumber, c.planName]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(q));
    });
  }, [clients, filter, query]);

  // Only offer a chip for a bucket that actually has rows, plus whichever one
  // is currently selected so the filter never vanishes under the user.
  const chips = useMemo(
    () => BUCKET_ORDER.filter(b => (counts[b] || 0) > 0 || filter === b),
    [counts, filter]
  );

  const chaseable = (counts.expired || 0) + (counts.expiring || 0) + (counts.pending || 0) + (counts.attention || 0);

  const exportCsv = () => {
    const cols = tracksSubscriptions
      ? [
          ['Account',      c => c.name],
          ['Contact',      c => c.contactName || ''],
          ['Email',        c => c.email || ''],
          ['Phone',        c => c.phone || ''],
          ['Plan',         c => c.planName || ''],
          ['Status',       c => c.statusLabel],
          ['Start',        c => (c.startDate ? new Date(c.startDate).toLocaleDateString('en-GB') : '')],
          ['Expires',      c => (c.endDate ? new Date(c.endDate).toLocaleDateString('en-GB') : '')],
          ['Days left',    c => (c.daysRemaining == null ? '' : c.daysRemaining)],
          ['Renewals',     c => c.renewals ?? 0],
          ['Amount (KES)', c => (c.price == null ? '' : c.price)],
        ]
      : [
          ['Client',            c => c.name],
          ['Account number',    c => c.accountNumber || ''],
          ['Email',             c => c.email || ''],
          ['Phone',             c => c.phone || ''],
          ['Standing',          c => c.statusLabel],
          ['Account status',    c => c.clientStatus || ''],
          ['KYC',               c => c.kycStatus || ''],
          ['Outstanding (KES)', c => c.outstanding ?? 0],
          ['Registered',        c => (c.registeredAt ? new Date(c.registeredAt).toLocaleDateString('en-GB') : '')],
        ];

    const csv = [
      cols.map(([h]) => h).join(','),
      ...visible.map(c => cols.map(([, fn]) => `"${String(fn(c) ?? '').replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `my_clients_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">My Clients</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {tracksSubscriptions
              ? 'Accounts you registered and where their subscription stands'
              : 'Clients you registered and how their accounts are standing'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="p-2 rounded-xl border border-border hover:bg-muted transition-colors"
              title="Refresh"
            >
              <Icon name="RefreshCw" size={14} color="var(--color-muted-foreground)" />
            </button>
          )}
          {clients.length > 0 && (
            <button
              onClick={exportCsv}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-border hover:bg-muted transition-colors text-foreground"
            >
              <Icon name="Download" size={13} color="currentColor" />
              Export
            </button>
          )}
          {onRegister && (
            <button
              onClick={onRegister}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}
            >
              <Icon name="UserPlus" size={13} color="white" />
              {registerLabel}
            </button>
          )}
          {canRegisterSacco && onRegisterSacco && (
            <button
              onClick={onRegisterSacco}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #0891b2, #0e7490)' }}
            >
              <Icon name="PiggyBank" size={13} color="white" />
              Register Sacco
            </button>
          )}
        </div>
      </div>

      {/* The one line that matters: how many need chasing */}
      {!loading && chaseable > 0 && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-xl border border-amber-200 bg-amber-50">
          <Icon name="BellRing" size={15} color="#b45309" />
          <p className="text-xs text-amber-800 font-medium">
            {chaseable} of your {clients.length} client{clients.length === 1 ? '' : 's'} need{chaseable === 1 ? 's' : ''} following up
            {counts.expired > 0 && ` — ${counts.expired} already ${tracksSubscriptions ? 'expired' : 'lapsed'}`}
            {counts.expiring > 0 && `, ${counts.expiring} expiring soon`}.
          </p>
        </div>
      )}

      {subscriptionsBlocked && (
        <div className="flex items-start gap-2 p-3 mb-4 rounded-xl border border-red-200 bg-red-50">
          <Icon name="ShieldAlert" size={15} color="#b91c1c" />
          <p className="text-xs text-red-800">
            Subscription records could not be read, so status is shown as unknown rather than guessed.
            Apply migration <code className="font-mono">20260813160000_agent_client_subscription_visibility.sql</code> to
            grant agents read access to the accounts they registered.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-xl border border-red-200 bg-red-50">
          <Icon name="AlertCircle" size={15} color="#b91c1c" />
          <p className="text-xs text-red-800">{error}</p>
        </div>
      )}

      {/* Filters */}
      {!loading && clients.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <button
            onClick={() => setFilter('all')}
            className={`text-xs px-2.5 py-1.5 rounded-full border font-semibold transition-colors ${
              filter === 'all' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            All {counts.all || 0}
          </button>
          {chips.map((b) => {
            const tone = toneFor(b);
            return (
              <button
                key={b}
                onClick={() => setFilter(b)}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border font-semibold transition-colors ${
                  filter === b ? tone.chip : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                {BUCKET_META[b].label} {counts[b] || 0}
              </button>
            );
          })}

          <div className="relative ml-auto">
            <Icon
              name="Search"
              size={13}
              color="var(--color-muted-foreground)"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search clients"
              aria-label="Search clients"
              className="pl-7 pr-3 py-1.5 text-xs rounded-full border border-border bg-background text-foreground w-44 focus:outline-none focus:border-primary"
            />
          </div>
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map(i => <div key={i} className="h-16 rounded-xl bg-muted/40 animate-pulse" />)}
        </div>
      ) : !enabled ? (
        <div className="text-center py-8 text-muted-foreground">
          <Icon name="Users" size={28} color="currentColor" />
          <p className="text-xs mt-2 font-medium">Subscription tracking isn't available for this agent type</p>
        </div>
      ) : clients.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Icon name="Users" size={28} color="currentColor" />
          <p className="text-xs mt-2 font-medium">No clients yet</p>
          <p className="text-xs opacity-60 mt-0.5">Convert a lead or register a new {registerNoun} to start tracking renewals</p>
          {onRegister && (
            <button onClick={onRegister} className="text-xs text-emerald-600 hover:underline font-semibold mt-3">
              Register a {registerNoun} →
            </button>
          )}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Icon name="SearchX" size={26} color="currentColor" />
          <p className="text-xs mt-2 font-medium">No clients match that filter</p>
          <button
            onClick={() => { setFilter('all'); setQuery(''); }}
            className="text-xs text-primary hover:underline font-semibold mt-2"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(c => (
            <ClientRow
              key={c.id}
              client={c}
              tracksSubscriptions={tracksSubscriptions}
              onFollowUp={onFollowUp}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ClientsPanel;

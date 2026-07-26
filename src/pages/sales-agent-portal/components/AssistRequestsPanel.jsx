import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

// The gold agent's inbox. Before this existed a bronze agent's request for help
// was invisible to the agent being asked — the only signal was the commission
// landing in their wallet, long after the moment the help was needed.

const STATUS_STYLES = {
  requested: { cls: 'bg-amber-500/10 text-amber-600',     icon: 'Clock',       label: 'Awaiting response' },
  accepted:  { cls: 'bg-blue-500/10 text-blue-600',       icon: 'UserCheck',   label: 'In progress' },
  completed: { cls: 'bg-emerald-500/10 text-emerald-600', icon: 'CheckCircle', label: 'Completed' },
  declined:  { cls: 'bg-red-500/10 text-red-600',         icon: 'XCircle',     label: 'Declined' },
  cancelled: { cls: 'bg-muted text-muted-foreground',     icon: 'Ban',         label: 'Cancelled' },
};

const fmtMoney = (n) => `KES ${(parseFloat(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// "2h ago" / "3d ago" — how long the other agent has been waiting.
const ago = (d) => {
  if (!d) return '';
  const mins  = Math.max(0, Math.round((Date.now() - new Date(d)) / 60000));
  const hours = Math.round(mins / 60);
  const days  = Math.round(hours / 24);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
};

const StatusChip = ({ status }) => {
  const s = STATUS_STYLES[status] || STATUS_STYLES.requested;
  return (
    <span className={`flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${s.cls}`}>
      <Icon name={s.icon} size={10} color="currentColor" />
      {s.label}
    </span>
  );
};

// ── Inline text prompt shared by decline (reason) and complete (outcome) ──────
const InlinePrompt = ({ placeholder, confirmLabel, tone = 'emerald', required, onConfirm, onCancel }) => {
  const [text, setText]     = useState('');
  const [saving, setSaving] = useState(false);
  const toneCls = tone === 'red'
    ? 'bg-red-600 hover:bg-red-700'
    : 'bg-emerald-600 hover:bg-emerald-700';

  const confirm = async () => {
    if (required && !text.trim()) return;
    setSaving(true);
    try { await onConfirm(text.trim()); } finally { setSaving(false); }
  };

  return (
    <div className="mt-2.5 pt-2.5 border-t border-border/60 space-y-2">
      <input
        type="text"
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') onCancel(); }}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <div className="flex gap-2">
        <button
          onClick={confirm}
          disabled={saving || (required && !text.trim())}
          className={`flex-1 py-1.5 text-xs font-semibold text-white rounded-lg disabled:opacity-60 transition-colors ${toneCls}`}
        >
          {saving ? 'Saving...' : confirmLabel}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

// ── One request, seen from the gold agent's side ─────────────────────────────
const IncomingRow = ({ assist, onRespond, onComplete }) => {
  const [mode, setMode] = useState(null); // 'decline' | 'complete' | null
  const [busy, setBusy] = useState(false);
  const bronze  = assist.bronze || {};
  const pending = assist.status === 'requested';

  const accept = async () => {
    setBusy(true);
    try { await onRespond(assist, 'accepted'); } finally { setBusy(false); }
  };

  return (
    <div className={`p-3 rounded-xl border transition-colors ${
      pending
        ? 'bg-amber-50/60 border-amber-200 hover:bg-amber-50'
        : 'bg-muted/30 border-transparent hover:bg-muted/50'
    }`}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-amber-500/15 flex items-center justify-center">
          <Icon name="LifeBuoy" size={16} color="#d97706" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-foreground truncate">
              {bronze.full_name || 'A bronze agent'} needs help
            </p>
            <StatusChip status={assist.status} />
          </div>

          <p className="text-xs text-muted-foreground mt-0.5">
            {bronze.agent_code ? `${bronze.agent_code} · ` : ''}
            {bronze.region ? `${bronze.region} · ` : ''}
            asked {ago(assist.created_at)}
          </p>

          <p className="text-xs text-foreground mt-1.5">
            <span className="text-muted-foreground">Admin / company:</span>{' '}
            <span className="font-semibold">{assist.admin_name || 'Unspecified'}</span>
          </p>

          {assist.note && (
            <p className="text-xs text-foreground mt-1 bg-muted rounded-lg px-2 py-1.5">{assist.note}</p>
          )}

          {/* Contact details — accepting is useless without a way to reach them */}
          {(bronze.phone || bronze.email) && (
            <div className="flex flex-wrap items-center gap-3 mt-1.5">
              {bronze.phone && (
                <a href={`tel:${bronze.phone}`} className="flex items-center gap-1 text-xs text-primary hover:underline">
                  <Icon name="Phone" size={11} color="currentColor" /> {bronze.phone}
                </a>
              )}
              {bronze.email && (
                <a href={`mailto:${bronze.email}`} className="flex items-center gap-1 text-xs text-primary hover:underline truncate">
                  <Icon name="Mail" size={11} color="currentColor" /> {bronze.email}
                </a>
              )}
            </div>
          )}

          {mode === 'decline' && (
            <InlinePrompt
              placeholder="Why can't you take this? e.g. Out of region this week"
              confirmLabel="Decline request"
              tone="red"
              onConfirm={async (reason) => { await onRespond(assist, 'declined', reason); setMode(null); }}
              onCancel={() => setMode(null)}
            />
          )}

          {mode === 'complete' && (
            <InlinePrompt
              placeholder="How did the onboarding go? e.g. Trained 3 staff, account live"
              confirmLabel={`Complete & claim ${fmtMoney(assist.amount)}`}
              onConfirm={async (outcome) => { await onComplete(assist, outcome); setMode(null); }}
              onCancel={() => setMode(null)}
            />
          )}

          {!mode && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {pending ? (
                <>
                  <button
                    onClick={accept}
                    disabled={busy}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60 transition-colors"
                  >
                    <Icon name="Check" size={11} color="white" /> Accept
                  </button>
                  <button
                    onClick={() => setMode('decline')}
                    disabled={busy}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium text-muted-foreground hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    Decline
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setMode('complete')}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
                >
                  <Icon name="CheckCircle" size={11} color="white" /> Mark onboarding complete
                </button>
              )}
              <span className="ml-auto text-xs font-semibold text-emerald-700">
                {fmtMoney(assist.amount)} {pending ? 'on completion' : 'when you close this'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── One request, seen from the bronze agent's side ───────────────────────────
const OutgoingRow = ({ assist, onCancel }) => {
  const [busy, setBusy] = useState(false);
  const gold = assist.gold || {};
  const open = ['requested', 'accepted'].includes(assist.status);

  const cancel = async () => {
    setBusy(true);
    try { await onCancel(assist); } finally { setBusy(false); }
  };

  return (
    <div className="p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
          <Icon name="UserCog" size={16} color="var(--color-primary)" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-foreground truncate">
              {gold.full_name || 'Gold agent'}
            </p>
            <StatusChip status={assist.status} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {assist.admin_name || 'Unspecified admin'} · sent {ago(assist.created_at)}
          </p>
          {assist.note && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{assist.note}</p>
          )}
          {assist.status === 'declined' && assist.decline_reason && (
            <p className="text-xs text-red-600 mt-1">Reason: {assist.decline_reason}</p>
          )}
          {assist.status === 'completed' && assist.outcome && (
            <p className="text-xs text-foreground mt-1 bg-muted rounded-lg px-2 py-1">{assist.outcome}</p>
          )}
          {open && (
            <button
              onClick={cancel}
              disabled={busy}
              className="mt-2 px-2.5 py-1 rounded-lg text-xs font-medium text-muted-foreground hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Cancel request
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const Section = ({ title, count, tone, children }) => {
  if (!count) return null;
  const toneCls = { warn: 'text-amber-600', normal: 'text-muted-foreground' }[tone] || 'text-muted-foreground';
  return (
    <div className="space-y-2">
      <p className={`text-xs font-bold uppercase tracking-wide ${toneCls}`}>{title} · {count}</p>
      {children}
    </div>
  );
};

// ── Panel ────────────────────────────────────────────────────────────────────
const AssistRequestsPanel = ({
  buckets, loading, isGoldAgent,
  onRespond, onComplete, onCancel, onRequestAssist,
}) => {
  const { incoming = [], outgoing = [], pending = [], active = [], history = [] } = buckets || {};
  const [tab, setTab] = useState(isGoldAgent ? 'incoming' : 'outgoing');

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="h-5 bg-muted rounded w-44 mb-4 animate-pulse" />
        {[...Array(2)].map((_, i) => (
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

  const showIncoming = isGoldAgent || incoming.length > 0;
  const showOutgoing = !isGoldAgent || outgoing.length > 0;
  const showTabs     = showIncoming && showOutgoing;
  const activeTab    = showTabs ? tab : (showIncoming ? 'incoming' : 'outgoing');

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Icon name="LifeBuoy" size={18} color="#d97706" />
          <div>
            <h3 className="font-heading font-semibold text-base text-foreground">
              {showIncoming ? 'Assist Requests' : 'My Assist Requests'}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {showIncoming
                ? (pending.length > 0
                    ? `${pending.length} agent${pending.length !== 1 ? 's' : ''} waiting on you`
                    : active.length > 0
                    ? `${active.length} onboarding${active.length !== 1 ? 's' : ''} in progress`
                    : 'No bronze agent needs help right now')
                : 'Help you have asked gold agents for'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {showTabs && (
            <div className="flex rounded-xl border border-border overflow-hidden">
              {[
                { key: 'incoming', label: `Incoming${pending.length ? ` (${pending.length})` : ''}` },
                { key: 'outgoing', label: `Sent${outgoing.length ? ` (${outgoing.length})` : ''}` },
              ].map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                    activeTab === t.key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          {!isGoldAgent && onRequestAssist && (
            <button
              onClick={onRequestAssist}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white"
              style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}
            >
              <Icon name="LifeBuoy" size={13} color="white" />
              Ask for help
            </button>
          )}
        </div>
      </div>

      {/* Incoming — the gold agent's queue */}
      {activeTab === 'incoming' && (
        incoming.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Icon name="Inbox" size={30} color="var(--color-muted-foreground)" />
            <p className="text-sm font-medium text-muted-foreground mt-2">No assist requests yet</p>
            <p className="text-xs text-muted-foreground/70 mt-0.5 max-w-xs">
              When a bronze agent asks you to take an admin through the system, it
              lands here — accept it, then mark it complete to claim the commission.
            </p>
          </div>
        ) : (
          <div className="space-y-4 max-h-[460px] overflow-y-auto scrollbar-custom pr-1">
            <Section title="Waiting on you" count={pending.length} tone="warn">
              <div className="space-y-2">
                {pending.map(a => (
                  <IncomingRow key={a.id} assist={a} onRespond={onRespond} onComplete={onComplete} />
                ))}
              </div>
            </Section>
            <Section title="Accepted — in progress" count={active.length} tone="normal">
              <div className="space-y-2">
                {active.map(a => (
                  <IncomingRow key={a.id} assist={a} onRespond={onRespond} onComplete={onComplete} />
                ))}
              </div>
            </Section>
            <Section title="History" count={history.length} tone="normal">
              <div className="space-y-2">
                {history.map(a => (
                  <div key={a.id} className="flex items-start gap-3 p-3 rounded-xl bg-muted/20">
                    <div className="w-7 h-7 flex-shrink-0 rounded-full bg-muted flex items-center justify-center">
                      <Icon name={(STATUS_STYLES[a.status] || STATUS_STYLES.completed).icon} size={13} color="var(--color-muted-foreground)" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-foreground truncate">
                          {a.admin_name || 'Unspecified admin'}
                        </p>
                        <StatusChip status={a.status} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {a.bronze?.full_name || 'Bronze agent'} · {ago(a.completed_at || a.responded_at || a.created_at)}
                        {a.status === 'completed' ? ` · ${fmtMoney(a.amount)} earned` : ''}
                      </p>
                      {a.outcome && (
                        <p className="text-xs text-foreground mt-1 bg-muted rounded-lg px-2 py-1">{a.outcome}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        )
      )}

      {/* Sent — the bronze agent's tracking list */}
      {activeTab === 'outgoing' && (
        outgoing.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Icon name="LifeBuoy" size={30} color="var(--color-muted-foreground)" />
            <p className="text-sm font-medium text-muted-foreground mt-2">You haven't asked for help yet</p>
            <p className="text-xs text-muted-foreground/70 mt-0.5 max-w-xs">
              A gold agent can take an admin you registered through the system for you.
            </p>
            {onRequestAssist && (
              <button onClick={onRequestAssist} className="mt-3 text-xs text-primary hover:underline font-semibold">
                Ask a gold agent for help →
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2 max-h-[460px] overflow-y-auto scrollbar-custom pr-1">
            {outgoing.map(a => (
              <OutgoingRow key={a.id} assist={a} onCancel={onCancel} />
            ))}
          </div>
        )
      )}
    </div>
  );
};

export default AssistRequestsPanel;

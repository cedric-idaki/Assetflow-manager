import React, { useState, useEffect, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import {
  TicketStatusChip, TicketPriorityChip, TICKET_CATEGORY_LABELS, ago, initials,
} from './TicketsPanel';

// The conversation itself. Everything an agent needs to answer without leaving
// the thread: what was asked, who is on it, how to reach them, and the buttons
// that move the ticket on.

const fmtTime = (d) =>
  d ? new Date(d).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }) : '';

// ── One line in the thread ───────────────────────────────────────────────────
const MessageBubble = ({ message, agentId }) => {
  const mine = message.sender_agent_id === agentId;

  // Status changes read as narration, not as something anyone said.
  if (message.is_system) {
    return (
      <div className="flex items-center gap-2 my-2">
        <div className="flex-1 h-px bg-border" />
        <p className="text-xs text-muted-foreground italic px-1 text-center">
          {message.sender?.full_name || (mine ? 'You' : 'An agent')} {message.body}
          <span className="opacity-60"> · {ago(message.created_at)}</span>
        </p>
        <div className="flex-1 h-px bg-border" />
      </div>
    );
  }

  return (
    <div className={`flex gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
        mine ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
      }`}>
        {initials(message.sender?.full_name)}
      </div>
      <div className={`max-w-[78%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${
          mine
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-muted text-foreground rounded-tl-sm'
        }`}>
          {message.body}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 px-1">
          {mine ? 'You' : (message.sender?.full_name || 'Agent')} · {fmtTime(message.created_at)}
        </p>
      </div>
    </div>
  );
};

// ── Inline note prompt shared by resolve and close ───────────────────────────
const NotePrompt = ({ placeholder, confirmLabel, tone = 'emerald', onConfirm, onCancel }) => {
  const [text, setText]     = useState('');
  const [saving, setSaving] = useState(false);
  const toneCls = tone === 'muted'
    ? 'bg-slate-600 hover:bg-slate-700'
    : 'bg-emerald-600 hover:bg-emerald-700';

  const confirm = async () => {
    setSaving(true);
    try { await onConfirm(text.trim()); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-2">
      <input
        type="text"
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') onCancel(); }}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <div className="flex gap-2">
        <button
          onClick={confirm}
          disabled={saving}
          className={`flex-1 py-2 text-xs font-semibold text-white rounded-lg disabled:opacity-60 transition-colors ${toneCls}`}
        >
          {saving ? 'Saving...' : confirmLabel}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-2 text-xs text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

const TicketThreadModal = ({
  isOpen, ticket, messages, agentId, isGoldAgent, loading,
  onSend, onClaim, onStatus, onClose,
}) => {
  const [draft, setDraft]   = useState('');
  const [busy, setBusy]     = useState(false);
  const [mode, setMode]     = useState(null);   // 'resolve' | 'close' | null
  const [err, setErr]       = useState(null);
  const endRef = useRef(null);

  const thread = messages || [];

  // Land on the newest message: a thread that opens at the top makes the agent
  // scroll to find the thing they were notified about.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [thread.length, isOpen]);

  useEffect(() => { setDraft(''); setMode(null); setErr(null); }, [ticket?.id]);

  if (!isOpen || !ticket) return null;

  const mine       = ticket.opened_by_agent_id === agentId;
  const other      = mine ? ticket.assignee : ticket.opener;
  const unclaimed  = !ticket.assigned_agent_id;
  const isParty    = mine || ticket.assigned_agent_id === agentId;
  const isClosed   = ticket.status === 'closed';
  const canClaim   = unclaimed && !mine && isGoldAgent;
  // An unclaimed ticket is not yours to answer — claim it first, so the agent
  // who raised it knows who is on it.
  const canWrite   = isParty && !isClosed;

  const run = async (fn) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr(e?.message || 'That did not go through.'); } finally { setBusy(false); }
  };

  const send = async () => {
    if (!draft.trim() || busy) return;
    const body = draft.trim();
    setDraft('');
    await run(async () => {
      try { await onSend(ticket, body); } catch (e) { setDraft(body); throw e; }
    });
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl shadow-2xl w-full max-w-2xl my-8 flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-border">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Icon name="Ticket" size={17} color="var(--color-primary)" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading font-semibold text-base text-foreground truncate">{ticket.subject}</h2>
              <TicketPriorityChip priority={ticket.priority} />
              <TicketStatusChip status={ticket.status} />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {ticket.ticket_no} · {TICKET_CATEGORY_LABELS[ticket.category] || 'General'} · opened {ago(ticket.created_at)}
              {ticket.admin_name ? ` · about ${ticket.admin_name}` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <Icon name="X" size={17} color="currentColor" />
          </button>
        </div>

        {/* Who is on it — and how to reach them. Accepting a ticket is useless
            without a way to pick up the phone. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-2.5 border-b border-border bg-muted/20">
          <span className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{mine ? 'You' : ticket.opener?.full_name || 'An agent'}</span>
            {' → '}
            {unclaimed
              ? <span className="text-amber-600 font-semibold">unclaimed · in the gold pool</span>
              : <span className="font-semibold text-foreground">{ticket.assigned_agent_id === agentId ? 'you' : ticket.assignee?.full_name || 'a gold agent'}</span>}
          </span>
          {other?.phone && (
            <a href={`tel:${other.phone}`} className="flex items-center gap-1 text-xs text-primary hover:underline">
              <Icon name="Phone" size={11} color="currentColor" /> {other.phone}
            </a>
          )}
          {other?.email && (
            <a href={`mailto:${other.email}`} className="flex items-center gap-1 text-xs text-primary hover:underline truncate">
              <Icon name="Mail" size={11} color="currentColor" /> {other.email}
            </a>
          )}
        </div>

        {/* Thread */}
        <div className="flex-1 overflow-y-auto scrollbar-custom px-5 py-4 space-y-3 min-h-[200px]">
          {loading && thread.length === 0 ? (
            [...Array(3)].map((_, i) => (
              <div key={i} className="flex gap-2.5 animate-pulse">
                <div className="w-8 h-8 rounded-full bg-muted flex-shrink-0" />
                <div className="h-10 bg-muted rounded-2xl w-1/2" />
              </div>
            ))
          ) : thread.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No messages on this ticket yet.</p>
          ) : (
            thread.map(m => <MessageBubble key={m.id} message={m} agentId={agentId} />)
          )}
          <div ref={endRef} />
        </div>

        {err && (
          <div className="mx-5 mb-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200">
            <Icon name="AlertTriangle" size={14} color="#dc2626" />
            <p className="text-xs font-medium text-red-700">{err}</p>
          </div>
        )}

        {/* Composer + actions */}
        <div className="border-t border-border px-5 py-3 space-y-3">
          {mode === 'resolve' && (
            <NotePrompt
              placeholder="What settled it? e.g. Walked them through the asset upload"
              confirmLabel="Mark resolved"
              onConfirm={async (note) => { await run(() => onStatus(ticket, 'resolved', note)); setMode(null); }}
              onCancel={() => setMode(null)}
            />
          )}
          {mode === 'close' && (
            <NotePrompt
              placeholder="Anything to note before closing? (optional)"
              confirmLabel="Close ticket"
              tone="muted"
              onConfirm={async (note) => { await run(() => onStatus(ticket, 'closed', note)); setMode(null); }}
              onCancel={() => setMode(null)}
            />
          )}

          {!mode && (
            <>
              {canClaim ? (
                <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200">
                  <Icon name="Hand" size={15} color="#d97706" />
                  <p className="text-xs font-medium text-amber-800 flex-1">
                    Claim this ticket to answer it — the agent who raised it will be told it's yours.
                  </p>
                  <button
                    onClick={() => run(() => onClaim(ticket))}
                    disabled={busy}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
                  >
                    {busy ? 'Claiming...' : 'Claim ticket'}
                  </button>
                </div>
              ) : isClosed ? (
                <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-xl bg-muted border border-border">
                  <Icon name="Archive" size={15} color="var(--color-muted-foreground)" />
                  <p className="text-xs font-medium text-muted-foreground flex-1">
                    This ticket is closed. Reopen it to carry on the conversation.
                  </p>
                  {isParty && (
                    <button
                      onClick={() => run(() => onStatus(ticket, 'in_progress'))}
                      disabled={busy}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border text-foreground hover:bg-card disabled:opacity-60"
                    >
                      Reopen
                    </button>
                  )}
                </div>
              ) : !canWrite ? (
                <p className="text-xs text-muted-foreground text-center py-1">
                  You can read this ticket, but only the agents on it can reply.
                </p>
              ) : (
                <>
                  <div className="flex items-end gap-2">
                    <textarea
                      rows={2}
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => {
                        // Enter sends, Shift+Enter starts a new line — the way
                        // every other chat box these agents use behaves.
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                      }}
                      placeholder="Write a reply…"
                      className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-xl text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                      onClick={send}
                      disabled={busy || !draft.trim()}
                      className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
                      style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
                    >
                      <Icon name="Send" size={14} color="white" />
                      Send
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {ticket.status !== 'waiting' && (
                      <button
                        onClick={() => run(() => onStatus(ticket, 'waiting'))}
                        disabled={busy}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
                      >
                        Waiting on them
                      </button>
                    )}
                    {ticket.status !== 'resolved' && (
                      <button
                        onClick={() => setMode('resolve')}
                        disabled={busy}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                      >
                        <Icon name="CheckCircle" size={11} color="currentColor" />
                        Mark resolved
                      </button>
                    )}
                    <button
                      onClick={() => setMode('close')}
                      disabled={busy}
                      className="ml-auto px-2.5 py-1 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      Close ticket
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default TicketThreadModal;

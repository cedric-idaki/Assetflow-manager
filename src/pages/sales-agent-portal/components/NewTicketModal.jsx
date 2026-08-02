import React, { useState, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import { TICKET_CATEGORIES, TICKET_PRIORITIES } from '../../../hooks/useAgentTickets';

// Raising a ticket. The one decision that matters here is who it goes to:
// a named agent, or nobody in particular. Leaving it unassigned puts it in the
// gold pool, where every gold agent sees it until one claims it — which is what
// a bronze agent actually wants when they don't know who is free.

const NewTicketModal = ({ isOpen, onClose, directory, isGoldAgent, prefill, onSubmit }) => {
  const [subject, setSubject]     = useState(prefill?.subject   || '');
  const [body, setBody]           = useState('');
  const [assignee, setAssignee]   = useState(prefill?.assignedAgentId || '');
  const [category, setCategory]   = useState(prefill?.category  || 'onboarding');
  const [priority, setPriority]   = useState('normal');
  const [adminName, setAdminName] = useState(prefill?.adminName || '');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState(null);

  const { gold, bronze } = useMemo(() => ({
    gold:   (directory || []).filter(a => a.agent_plan === 'gold'),
    bronze: (directory || []).filter(a => a.agent_plan !== 'gold'),
  }), [directory]);

  if (!isOpen) return null;

  const submit = async () => {
    setError(null);
    if (!subject.trim()) { setError('Give the ticket a subject.'); return; }
    if (!body.trim())    { setError('Say what you need in the first message.'); return; }
    if (isGoldAgent && !assignee) { setError('Choose the agent this ticket is for.'); return; }

    setSaving(true);
    try {
      await onSubmit({
        subject, body, assignedAgentId: assignee || null, category, priority,
        adminName: adminName.trim() || null,
        assistId: prefill?.assistId || null,
      });
      onClose();
    } catch (err) {
      setError(err?.message || 'The ticket could not be raised.');
    } finally {
      setSaving(false);
    }
  };

  const selected = (directory || []).find(a => a.id === assignee);

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl shadow-2xl w-full max-w-lg my-8"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Icon name="Ticket" size={17} color="var(--color-primary)" />
          </div>
          <div className="min-w-0">
            <h2 className="font-heading font-semibold text-base text-foreground">Raise a ticket</h2>
            <p className="text-xs text-muted-foreground">
              Start a conversation that stays on record
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <Icon name="X" size={17} color="currentColor" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Subject */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="e.g. Need help onboarding Carsoko's finance team"
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Who it goes to */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
              Send to
            </label>
            <select
              value={assignee}
              onChange={e => setAssignee(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {/* A gold agent has no pool to post into — the pool is read by
                  gold agents, so an unassigned ticket from one would be seen by
                  everyone except the agent it was meant for. */}
              {!isGoldAgent && <option value="">Any gold agent (first to claim it)</option>}
              {isGoldAgent && <option value="">Choose an agent…</option>}
              {gold.length > 0 && (
                <optgroup label="Gold agents">
                  {gold.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.full_name}{a.agent_code ? ` · ${a.agent_code}` : ''}{a.region ? ` · ${a.region}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {bronze.length > 0 && (
                <optgroup label="Bronze agents">
                  {bronze.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.full_name}{a.agent_code ? ` · ${a.agent_code}` : ''}{a.region ? ` · ${a.region}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <p className="text-xs text-muted-foreground mt-1.5">
              {assignee
                ? `${selected?.full_name || 'They'} will be emailed and see it in their portal straight away.`
                : isGoldAgent
                ? 'Pick the agent this ticket is for.'
                : 'Every gold agent sees it until one claims it — use this when you don\'t know who is free.'}
            </p>
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
              What is it about
            </label>
            <div className="grid grid-cols-2 gap-2">
              {TICKET_CATEGORIES.map(c => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
                    category === c.value
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/30'
                  }`}
                >
                  <Icon name={c.icon} size={13} color="currentColor" />
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
              Priority
            </label>
            <div className="flex flex-wrap gap-2">
              {TICKET_PRIORITIES.map(p => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPriority(p.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    priority === p.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Optional context */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
              Admin / company <span className="normal-case font-normal opacity-70">(optional)</span>
            </label>
            <input
              type="text"
              value={adminName}
              onChange={e => setAdminName(e.target.value)}
              placeholder="Who or what is this about?"
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* First message */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
              Message
            </label>
            <textarea
              rows={4}
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Explain what you need. They can reply on the ticket and the whole exchange stays here."
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200">
              <Icon name="AlertTriangle" size={14} color="#dc2626" />
              <p className="text-xs font-medium text-red-700">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-all"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-all"
            style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
          >
            {saving ? (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            ) : (
              <Icon name="Send" size={14} color="white" />
            )}
            {saving ? 'Raising ticket...' : 'Raise ticket'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NewTicketModal;

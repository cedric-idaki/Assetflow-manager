import React, { useState, useEffect } from 'react';
import Icon from '../AppIcon';
import {
  fmtMoney, fmtWhen, fmtAgo, fmtDue, initials,
  ChannelBadge, OutcomeBadge, AuthorBadge, RelationshipBadge, Empty,
} from './crmFormat';
import { DiaryRow } from './FollowUpDiaryPanel';

/**
 * One customer, everything said to them, and what is promised next.
 *
 * This is the screen the CRM exists for. Before ringing somebody an admin
 * needs what was actually said last time, what they wanted, what they owe and
 * what somebody already promised them — and until now none of that was
 * recorded anywhere but a single overwritable notes field.
 *
 * The history is the WHOLE tenant's, agents included, because an admin who saw
 * only their own half would ring a customer an agent spoke to yesterday. The
 * edit and delete controls are shown only on rows the office wrote: the write
 * policies accept nothing else, and an edit button that always fails is worse
 * than no button.
 */

const Section = ({ title, count, action, children }) => (
  <div className="border-t border-border pt-4">
    <div className="flex items-center justify-between mb-3">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {title}{typeof count === 'number' && <span className="ml-1.5 text-muted-foreground/70">({count})</span>}
      </h4>
      {action}
    </div>
    {children}
  </div>
);

const QuickLink = ({ icon, label, href, tone = 'default' }) => {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
        tone === 'whatsapp'
          ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
          : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
      }`}
    >
      <Icon name={icon} size={13} color="currentColor" />
      {label}
    </a>
  );
};

/** Digits only, with the Kenyan country code, for a wa.me link. */
const waNumber = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0'))   return `254${digits.slice(1)}`;
  return digits;
};

/** A finished appointment, read-only — there is nothing left to do to it. */
const CompletedRow = ({ f }) => (
  <div className="flex items-start gap-3 p-3 rounded-xl border border-border bg-muted/30">
    <Icon name="CheckCircle2" size={16} color="#059669" className="mt-0.5" />
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <ChannelBadge value={f.appointment_type} />
        <span className="text-xs font-medium text-foreground">{fmtWhen(f.completed_at || f.scheduled_at)}</span>
        <AuthorBadge row={f} />
      </div>
      {f.notes && <p className="text-xs text-foreground mt-1">{f.notes}</p>}
      {f.outcome && <p className="text-xs text-muted-foreground mt-1">Outcome: {f.outcome}</p>}
    </div>
  </div>
);

const TouchRow = ({ i, canEdit, onDelete }) => (
  <div className="relative pl-6 pb-4 last:pb-0">
    <span className="absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full bg-primary/60 ring-4 ring-card" />
    <span className="absolute left-[4px] top-5 bottom-0 w-px bg-border last:hidden" />

    <div className="flex items-center gap-2 flex-wrap">
      <ChannelBadge value={i.interaction_type} />
      <OutcomeBadge value={i.outcome} />
      <span className="text-[11px] text-muted-foreground">{fmtWhen(i.occurred_at)}</span>
      {i.direction === 'inbound' && (
        <span className="text-[10px] text-muted-foreground">· they got in touch</span>
      )}
      {i.duration_minutes ? (
        <span className="text-[10px] text-muted-foreground">· {i.duration_minutes} min</span>
      ) : null}
      <AuthorBadge row={i} />
      {canEdit && (
        <button
          onClick={() => onDelete(i)}
          title="Remove this entry"
          className="ml-auto p-1 rounded text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
        >
          <Icon name="Trash2" size={13} color="currentColor" />
        </button>
      )}
    </div>

    {i.subject && <p className="text-xs font-semibold text-foreground mt-1">{i.subject}</p>}
    {i.summary && <p className="text-xs text-foreground mt-1 whitespace-pre-wrap">{i.summary}</p>}
    {i.next_step && (
      <p className="text-[11px] text-primary mt-1">
        <Icon name="ArrowRight" size={11} color="currentColor" className="inline mr-1" />
        {i.next_step}
      </p>
    )}
  </div>
);

const ClientCrmDrawer = ({
  client, onClose, onLog, onSchedule,
  onCompleteFollowUp, onRescheduleFollowUp, onDeleteFollowUp, onDeleteInteraction,
  onSaveNote,
}) => {
  const [note, setNote]         = useState(client?.notes || '');
  const [savingNote, setSaving] = useState(false);
  const [noteMsg, setNoteMsg]   = useState('');
  const [showDone, setShowDone] = useState(false);

  // A different client in the same drawer must not inherit the last one's note.
  useEffect(() => {
    setNote(client?.notes || '');
    setNoteMsg('');
    setShowDone(false);
  }, [client?.id, client?.notes]);

  if (!client) return null;

  const openFollowUps = client.followUps.filter(f => !f.is_completed);
  const doneFollowUps = client.followUps.filter(f => f.is_completed);

  const saveNote = async () => {
    setSaving(true);
    setNoteMsg('');
    const res = await onSaveNote(client.id, note);
    setNoteMsg(res?.error || 'Saved');
    setSaving(false);
  };

  const wa = waNumber(client.phone);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-end">
      <div className="bg-card border-l border-border w-full max-w-2xl h-full overflow-y-auto shadow-2xl">

        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 z-10">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center text-sm font-bold text-primary flex-shrink-0">
                {initials(client.full_name)}
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-foreground truncate">{client.full_name}</h3>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-xs text-muted-foreground">{client.account_number}</span>
                  <RelationshipBadge state={client.contactState} />
                  {client.client_status && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground capitalize">
                      {client.client_status}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted flex-shrink-0">
              <Icon name="X" size={18} color="var(--color-muted-foreground)" />
            </button>
          </div>

          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <button
              onClick={() => onLog(client)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
              style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
            >
              <Icon name="MessageSquarePlus" size={14} color="#fff" />
              Log a contact
            </button>
            <button
              onClick={() => onSchedule(client)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              <Icon name="CalendarPlus" size={14} color="currentColor" />
              Schedule
            </button>
            <QuickLink icon="Phone" label="Call" href={client.phone ? `tel:${client.phone}` : null} />
            <QuickLink icon="Mail" label="Email" href={client.email ? `mailto:${client.email}` : null} />
            <QuickLink icon="MessageCircle" label="WhatsApp" tone="whatsapp" href={wa ? `https://wa.me/${wa}` : null} />
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">

          {/* At a glance */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Last contact', value: fmtAgo(client.lastContactAt), icon: 'Clock' },
              { label: 'Contacts', value: client.touchCount, icon: 'MessagesSquare' },
              { label: 'Outstanding', value: fmtMoney(client.outstanding), icon: 'Wallet' },
              {
                label: 'Next follow-up',
                value: client.nextFollowUp ? fmtDue(client.nextFollowUp.scheduled_at) : 'none',
                icon: 'CalendarClock',
              },
            ].map(s => (
              <div key={s.label} className="bg-muted/40 rounded-xl p-3">
                <div className="flex items-center gap-1.5">
                  <Icon name={s.icon} size={12} color="var(--color-muted-foreground)" />
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{s.label}</span>
                </div>
                <p className="text-sm font-bold text-foreground mt-1 truncate">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Contact details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {[
              { label: 'Phone', value: client.phone },
              { label: 'Email', value: client.email },
              { label: 'Location', value: [client.city, client.address].filter(Boolean).join(', ') },
              { label: 'KYC', value: client.kyc_status },
            ].filter(d => d.value).map(d => (
              <div key={d.label} className="flex gap-2">
                <span className="text-muted-foreground w-16 flex-shrink-0">{d.label}</span>
                <span className="text-foreground truncate">{d.value}</span>
              </div>
            ))}
          </div>

          {/* What is promised next */}
          <Section title="Booked next" count={openFollowUps.length}>
            {openFollowUps.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nothing is booked with this client.
                <button onClick={() => onSchedule(client)} className="text-primary font-medium ml-1 hover:underline">
                  Schedule something
                </button>
              </p>
            ) : (
              <div className="space-y-2">
                {openFollowUps.map(f => (
                  <DiaryRow
                    key={f.id}
                    f={f}
                    name={client.full_name}
                    onComplete={onCompleteFollowUp}
                    onReschedule={onRescheduleFollowUp}
                    onDelete={onDeleteFollowUp}
                  />
                ))}
              </div>
            )}

            {doneFollowUps.length > 0 && (
              <>
                <button
                  onClick={() => setShowDone(v => !v)}
                  className="text-xs text-muted-foreground hover:text-foreground mt-3 flex items-center gap-1"
                >
                  <Icon name={showDone ? 'ChevronUp' : 'ChevronDown'} size={13} color="currentColor" />
                  {showDone ? 'Hide' : 'Show'} {doneFollowUps.length} completed
                </button>
                {showDone && (
                  <div className="space-y-2 mt-2">
                    {doneFollowUps.map(f => <CompletedRow key={f.id} f={f} />)}
                  </div>
                )}
              </>
            )}
          </Section>

          {/* What has been said */}
          <Section
            title="Contact history"
            count={client.touches.length}
            action={
              <button
                onClick={() => onLog(client)}
                className="text-xs text-primary font-medium hover:underline"
              >
                + Log a contact
              </button>
            }
          >
            {client.touches.length === 0 ? (
              <Empty
                icon="MessageSquareOff"
                title="Nothing has been recorded yet"
                hint={client.touchCount > 0
                  ? 'Older contact exists but falls outside the window loaded here.'
                  : 'Every call, WhatsApp and visit logged against this client will build up here.'}
              />
            ) : (
              <div>
                {client.touches.map(i => (
                  <TouchRow
                    key={i.id}
                    i={i}
                    canEdit={!i.agent_id}
                    onDelete={onDeleteInteraction}
                  />
                ))}
              </div>
            )}
          </Section>

          {/* The standing note — what they are like, not what was said once */}
          <Section title="Standing note">
            <textarea
              value={note}
              onChange={(e) => { setNote(e.target.value); setNoteMsg(''); }}
              rows={3}
              placeholder="What anyone picking up this account should know — how they prefer to be contacted, who decides, what went wrong last time."
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
            />
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={saveNote}
                disabled={savingNote || note === (client.notes || '')}
                className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                {savingNote ? 'Saving…' : 'Save note'}
              </button>
              {noteMsg && (
                <span className={`text-xs ${noteMsg === 'Saved' ? 'text-emerald-600' : 'text-red-600'}`}>
                  {noteMsg}
                </span>
              )}
              <span className="text-[11px] text-muted-foreground ml-auto">
                This overwrites. The timeline above is the record that does not.
              </span>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
};

export default ClientCrmDrawer;

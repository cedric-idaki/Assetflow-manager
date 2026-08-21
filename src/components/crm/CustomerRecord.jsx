import React from 'react';
import Icon from '../AppIcon';
import { useCustomerRecord } from '../../hooks/useCustomerRecord';
import { typeMeta, outcomeMeta } from '../../hooks/useCrmInteractions';

/**
 * One person, in full.
 *
 * The lists elsewhere in the CRM are counts — "7 contacts", "Qualified", "14
 * days quiet". That is the right altitude for scanning and the wrong one for
 * picking up the phone. This is the other altitude: every field captured, the
 * complete history with the notes intact, what was promised and never done,
 * and what they have actually paid.
 *
 * Shared by the agent portal and the supervisor dashboards. `readOnly` is the
 * only difference — a supervisor watches, they do not log contacts on an
 * agent's behalf.
 */

const STAGE_TONE = {
  new_lead:      'bg-slate-100 text-slate-700 border-slate-200',
  contacted:     'bg-blue-100 text-blue-700 border-blue-200',
  qualified:     'bg-violet-100 text-violet-700 border-violet-200',
  proposal_sent: 'bg-amber-100 text-amber-700 border-amber-200',
  closed:        'bg-emerald-100 text-emerald-700 border-emerald-200',
};

const PRIORITY_TONE = {
  high:   'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low:    'bg-slate-100 text-slate-600',
};

const SENTIMENT = {
  positive: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  negative: 'bg-red-50 text-red-700 border-red-200',
  neutral:  'bg-muted text-muted-foreground border-border',
};

const TYPE_TONE = {
  blue: 'bg-blue-100 text-blue-700',      emerald: 'bg-emerald-100 text-emerald-700',
  violet: 'bg-violet-100 text-violet-700', amber: 'bg-amber-100 text-amber-700',
  orange: 'bg-orange-100 text-orange-700', indigo: 'bg-indigo-100 text-indigo-700',
  slate: 'bg-slate-100 text-slate-700',
};

const money = (n) => `KES ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const fmtWhen = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

const initials = (name) =>
  (name || '?').split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase();

// ── Building blocks ─────────────────────────────────────────────────────────
const Section = ({ title, icon, count, children, action }) => (
  <section className="border-t border-border pt-4">
    <div className="flex items-center justify-between mb-3">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
        <Icon name={icon} size={13} color="currentColor" />
        {title}
        {count !== undefined && count !== null && (
          <span className="font-normal normal-case opacity-70">({count})</span>
        )}
      </h4>
      {action}
    </div>
    {children}
  </section>
);

const Field = ({ label, value, mono = false }) => {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm text-foreground ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
};

const Stat = ({ label, value, tone = 'text-foreground' }) => (
  <div className="px-3 py-2 rounded-xl bg-muted/50 border border-border">
    <p className={`text-base font-bold leading-tight ${tone}`}>{value}</p>
    <p className="text-xs text-muted-foreground">{label}</p>
  </div>
);

const Empty = ({ children }) => (
  <p className="text-sm text-muted-foreground py-2">{children}</p>
);

// ── Main ────────────────────────────────────────────────────────────────────
const CustomerRecord = ({
  lead,
  agentName = null,
  readOnly = false,
  onClose,
  onLogInteraction,
  onScheduleFollowUp,
}) => {
  const {
    interactions, followUpBuckets, client, payments, paidTotal, outstanding,
    subscriptions, shareLinks, asset, summary, loading, error,
  } = useCustomerRecord(lead, { enabled: Boolean(lead) });

  if (!lead) return null;

  const stage      = lead.stage || 'new_lead';
  const converted  = Boolean(lead.converted_at);
  const activeSub  = subscriptions[0] || null;
  const totalOpen  = followUpBuckets.overdue.length + followUpBuckets.upcoming.length;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-4xl my-auto">

        {/* ── Header ── */}
        <div className="sticky top-0 z-10 bg-card border-b border-border rounded-t-2xl px-5 sm:px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary flex-shrink-0">
                {initials(lead.full_name)}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-foreground truncate">{lead.full_name}</h2>
                  <span className={`px-2 py-0.5 rounded-full border text-xs font-semibold capitalize ${STAGE_TONE[stage] || STAGE_TONE.new_lead}`}>
                    {stage.replace(/_/g, ' ')}
                  </span>
                  {lead.priority && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${PRIORITY_TONE[lead.priority] || PRIORITY_TONE.low}`}>
                      {lead.priority}
                    </span>
                  )}
                  {converted && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">
                      Converted
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                  {lead.phone && (
                    <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1 hover:text-primary">
                      <Icon name="Phone" size={11} color="currentColor" />{lead.phone}
                    </a>
                  )}
                  {lead.email && (
                    <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1 hover:text-primary truncate">
                      <Icon name="Mail" size={11} color="currentColor" />{lead.email}
                    </a>
                  )}
                  {agentName && (
                    <span className="inline-flex items-center gap-1">
                      <Icon name="UserCheck" size={11} color="currentColor" />{agentName}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted flex-shrink-0">
              <Icon name="X" size={18} color="var(--color-muted-foreground)" />
            </button>
          </div>

          {!readOnly && (
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                onClick={() => onLogInteraction?.(lead)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white"
                style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
              >
                <Icon name="Plus" size={13} color="currentColor" />
                Log contact
              </button>
              <button
                onClick={() => onScheduleFollowUp?.(lead)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/40 transition-all"
              >
                <Icon name="CalendarPlus" size={13} color="currentColor" />
                Schedule follow-up
              </button>
            </div>
          )}
        </div>

        <div className="px-5 sm:px-6 py-5 space-y-5">

          {error && (
            <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
              <Icon name="AlertCircle" size={15} color="#dc2626" className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ── At a glance ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <Stat label="Contacts logged" value={summary.contacts} />
            <Stat
              label={summary.lastTouchAt ? 'Since last contact' : 'Never contacted'}
              value={summary.quietDays === null ? '—' : `${summary.quietDays}d`}
              tone={(summary.quietDays ?? 0) >= 14 ? 'text-amber-600' : 'text-foreground'}
            />
            <Stat
              label="Open follow-ups"
              value={totalOpen}
              tone={followUpBuckets.overdue.length > 0 ? 'text-red-600' : 'text-foreground'}
            />
            <Stat
              label="They reached out"
              value={summary.inbound}
              tone={summary.inbound > 0 ? 'text-emerald-600' : 'text-foreground'}
            />
          </div>

          {/* ── Who they are ── */}
          <Section title="Details" icon="User">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Field label="Wants"       value={lead.asset_interest} />
              <Field label="Budget"      value={(lead.budget_range || '').replace(/_/g, ' ') || null} />
              <Field label="Source"      value={(lead.source || '').replace(/_/g, ' ') || null} />
              <Field label="Registered"  value={fmtDate(lead.created_at)} />
              <Field label="First contact" value={fmtDate(summary.firstTouchAt)} />
              <Field label="Last contact"  value={fmtDate(summary.lastTouchAt) || fmtDate(lead.last_contact_at)} />
              <Field label="KRA PIN"     value={lead.kra_pin} mono />
              <Field label="Address"     value={lead.physical_address} />
              <Field label="Postal"      value={lead.postal_address} />
              <Field
                label="Next of kin"
                value={lead.next_of_kin_name
                  ? `${lead.next_of_kin_name}${lead.next_of_kin_relationship ? ` (${lead.next_of_kin_relationship})` : ''}${lead.next_of_kin_phone ? ` · ${lead.next_of_kin_phone}` : ''}`
                  : null}
              />
              {converted && (
                <Field
                  label="Converted"
                  value={`${fmtDate(lead.converted_at)}${lead.converted_entity ? ` → ${lead.converted_entity}` : ''}`}
                />
              )}
            </div>
            {lead.notes && (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground mb-1">Notes from registration</p>
                <p className="text-sm text-foreground bg-muted rounded-lg px-3 py-2 whitespace-pre-line">{lead.notes}</p>
              </div>
            )}
          </Section>

          {/* ── Commercial standing ── */}
          {(client || activeSub) && (
            <Section title="Account standing" icon="Wallet">
              {client && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Field label="Account no." value={client.account_number} mono />
                    <Field label="Status"      value={(client.client_status || '').replace(/_/g, ' ') || null} />
                    <Field label="KYC"         value={(client.kyc_status || '').replace(/_/g, ' ') || null} />
                    <Field label="Assets"      value={client.total_assets ?? null} />
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 mt-3">
                    <Stat label="Paid to date" value={money(paidTotal)} tone="text-emerald-600" />
                    <Stat
                      label="Outstanding"
                      value={money(outstanding)}
                      tone={outstanding > 0 ? 'text-red-600' : 'text-foreground'}
                    />
                  </div>
                  {payments.length > 0 && (
                    <ul className="mt-3 divide-y divide-border">
                      {payments.slice(0, 6).map(p => (
                        <li key={p.id} className="py-2 flex items-center gap-3 text-sm">
                          <span className="text-foreground font-medium">{money(p.amount)}</span>
                          <span className="text-xs text-muted-foreground capitalize">
                            {(p.payment_method || '').replace(/_/g, ' ')}
                          </span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full capitalize ${
                            (p.payment_status || '').toLowerCase() === 'completed'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}>
                            {p.payment_status}
                          </span>
                          <span className="ml-auto text-xs text-muted-foreground">
                            {fmtDate(p.payment_date || p.created_at)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              {activeSub && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Field label="Plan"    value={activeSub.plan_name} />
                  <Field label="Status"  value={activeSub.status} />
                  <Field label="Paid"    value={money(activeSub.price_paid)} />
                  <Field label="Renews"  value={fmtDate(activeSub.end_date)} />
                </div>
              )}
            </Section>
          )}

          {/* ── What they were shown ── */}
          {(asset || shareLinks.length > 0) && (
            <Section title="Interest & listings shared" icon="Store" count={shareLinks.length || null}>
              {asset && (
                <div className="mb-3 px-3 py-2.5 rounded-xl border border-border bg-muted/40">
                  <p className="text-sm font-medium text-foreground">{asset.description}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {[asset.asset_code, asset.location, asset.selling_price ? money(asset.selling_price) : null]
                      .filter(Boolean).join(' · ')}
                  </p>
                </div>
              )}
              {shareLinks.length === 0 ? (
                <Empty>No listings shared with them yet.</Empty>
              ) : (
                <ul className="divide-y divide-border">
                  {shareLinks.map(l => (
                    <li key={l.id} className="py-2 flex flex-wrap items-center gap-3 text-sm">
                      <span className="text-foreground">
                        {l.recipient_name || 'Shared link'}
                        {l.channel ? <span className="text-xs text-muted-foreground"> · {l.channel}</span> : null}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {l.view_count || 0} view{(l.view_count || 0) === 1 ? '' : 's'}
                        {l.enquiry_count ? ` · ${l.enquiry_count} enquiry` : ''}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {l.last_viewed_at ? `last opened ${fmtDate(l.last_viewed_at)}` : 'never opened'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {/* ── Follow-ups ── */}
          <Section title="Follow-ups" icon="CalendarClock" count={followUpBuckets.overdue.length + followUpBuckets.upcoming.length + followUpBuckets.done.length}>
            {followUpBuckets.overdue.length === 0
              && followUpBuckets.upcoming.length === 0
              && followUpBuckets.done.length === 0 ? (
              <Empty>Nothing scheduled.</Empty>
            ) : (
              <ul className="space-y-2">
                {[
                  ...followUpBuckets.overdue.map(f => ({ f, tag: 'overdue' })),
                  ...followUpBuckets.upcoming.map(f => ({ f, tag: 'upcoming' })),
                  ...followUpBuckets.done.map(f => ({ f, tag: 'done' })),
                ].map(({ f, tag }) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      tag === 'overdue' ? 'bg-red-100 text-red-700'
                        : tag === 'upcoming' ? 'bg-amber-100 text-amber-700'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {tag === 'done' ? 'Done' : tag === 'overdue' ? 'Overdue' : 'Upcoming'}
                    </span>
                    <span className="text-foreground capitalize">
                      {(f.appointment_type || 'follow up').replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs text-muted-foreground">{fmtWhen(f.scheduled_at)}</span>
                    {f.location && <span className="text-xs text-muted-foreground">· {f.location}</span>}
                    {f.outcome && (
                      <span className="w-full text-xs text-muted-foreground pl-1">↳ {f.outcome}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* ── The whole conversation ── */}
          <Section
            title="Contact history"
            icon="MessageSquare"
            count={interactions.length}
            action={summary.totalMinutes > 0 ? (
              <span className="text-xs text-muted-foreground">{summary.totalMinutes} min total</span>
            ) : null}
          >
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="animate-pulse flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-muted flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 bg-muted rounded w-1/3" />
                      <div className="h-3 bg-muted rounded w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : interactions.length === 0 ? (
              <Empty>
                Nothing logged yet. Every call and meeting recorded here is history
                the next conversation can start from.
              </Empty>
            ) : (
              <ul className="relative">
                {interactions.map((i, idx) => {
                  const t = typeMeta(i.interaction_type);
                  const o = outcomeMeta(i.outcome);
                  const inbound = i.direction === 'inbound';
                  const last = idx === interactions.length - 1;
                  return (
                    <li key={i.id} className="relative pl-10 pb-5 last:pb-0">
                      {!last && <span className="absolute left-[13px] top-8 bottom-0 w-px bg-border" aria-hidden="true" />}
                      <span className={`absolute left-0 top-0 w-7 h-7 rounded-full flex items-center justify-center ${TYPE_TONE[t.tone] || TYPE_TONE.slate}`}>
                        <Icon name={t.icon} size={13} color="currentColor" />
                      </span>

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-semibold text-foreground">{t.label}</span>
                        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                          <Icon name={inbound ? 'ArrowDownLeft' : 'ArrowUpRight'} size={11} color="currentColor" />
                          {inbound ? 'They reached out' : 'Agent reached out'}
                        </span>
                        {i.duration_minutes ? (
                          <span className="text-xs text-muted-foreground">· {i.duration_minutes} min</span>
                        ) : null}
                        {o && (
                          <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${SENTIMENT[o.sentiment]}`}>
                            {o.label}
                          </span>
                        )}
                        <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
                          {fmtWhen(i.occurred_at)}
                        </span>
                      </div>

                      {i.subject && (
                        <p className="mt-1 text-sm font-medium text-foreground">{i.subject}</p>
                      )}
                      {/* Full text, never truncated — this is the whole point. */}
                      {i.summary && (
                        <p className="mt-1 text-sm text-foreground whitespace-pre-line">{i.summary}</p>
                      )}
                      {i.next_step && (
                        <p className="mt-1.5 text-xs text-primary flex items-start gap-1.5">
                          <Icon name="ArrowRight" size={12} color="currentColor" className="mt-0.5 flex-shrink-0" />
                          <span><span className="font-semibold">Next:</span> {i.next_step}</span>
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
};

export default CustomerRecord;

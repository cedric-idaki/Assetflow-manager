import React, { useMemo } from 'react';
import Icon from '../AppIcon';
import {
  Sk, Empty, StatTile, fmtMoney, fmtAgo, fmtDue,
  ChannelBadge, RelationshipBadge, AuthorBadge, initials,
} from './crmFormat';
import { CLIENT_QUIET_DAYS } from '../../hooks/useAdminCrm';

/**
 * The CRM's front page.
 *
 * The four working views each answer one question well, and none of them
 * answers the first one an admin actually has, which is "what do I do this
 * morning". This panel is that answer and nothing else: what is late, who has
 * been dropped, what was said recently. Everything on it is a way into one of
 * the other views — a starting point, not a sixth place to work.
 *
 * It derives nothing the other panels do not already have. Every figure comes
 * from the same `summary`, `book` and `diary` the views below are built from,
 * so a number here can never disagree with the screen it links to.
 *
 * Actions deliberately stop at "log a contact" and "book a follow-up". Closing
 * an appointment off stays in the diary, where the confirm step and the outcome
 * note live with it — two ways to complete a follow-up would be two things to
 * keep in step with one set of database constraints.
 */

const Card = ({ title, hint, icon, action, children }) => (
  <div className="bg-card border border-border rounded-xl p-5">
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          {icon && <Icon name={icon} size={15} color="var(--color-muted-foreground)" />}
          {title}
        </h3>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      {action}
    </div>
    {children}
  </div>
);

const MoreLink = ({ label, onClick }) => (
  <button
    onClick={onClick}
    className="text-xs font-medium text-primary hover:underline flex-shrink-0"
  >
    {label}
  </button>
);

const Avatar = ({ name }) => (
  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
    <span className="text-[11px] font-bold text-muted-foreground">{initials(name)}</span>
  </div>
);

/** Why this customer is on the attention list, in one line. */
const neglectReason = (c) => {
  if (c.contactState === 'never') return 'Never contacted';
  return `Quiet ${c.quietDays} day${c.quietDays === 1 ? '' : 's'}`;
};

const CrmOverviewPanel = ({
  book = [],
  interactions = [],
  diary = { overdue: [], today: [], thisWeek: [] },
  summary,
  loading = false,
  nameFor = () => '',
  onGo = () => {},
  onOpenClient = () => {},
  onLog = () => {},
  onSchedule = () => {},
}) => {
  /**
   * Who has been dropped, worst first.
   *
   * Never-contacted outranks gone-quiet whatever the balance: an introduction
   * nobody has made is a different failure from a relationship being let go.
   * Within each, money first, then how long it has been, then the name — that
   * last tie-break because on a young tenant every metric is still zero, and an
   * unstable comparator makes the whole list reshuffle on every refetch.
   */
  const attention = useMemo(() => {
    const rank = (c) => (c.contactState === 'never' ? 0 : 1);
    return book
      .filter((c) => c.contactState !== 'recent')
      .slice()
      .sort((a, b) =>
        rank(a) - rank(b)
        || b.outstanding - a.outstanding
        || (b.quietDays ?? 0) - (a.quietDays ?? 0)
        || (a.full_name || '').localeCompare(b.full_name || ''))
      .slice(0, 6);
  }, [book]);

  /** The office's own commitments that are late, or fall today. */
  const dueNow = useMemo(
    () => [...(diary.overdue || []), ...(diary.today || [])].slice(0, 6),
    [diary],
  );

  const recent = useMemo(
    () => interactions
      .slice()
      .sort((a, b) => new Date(b?.occurred_at || 0) - new Date(a?.occurred_at || 0))
      .slice(0, 6),
    [interactions],
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => <Sk key={i} className="h-24" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Sk className="h-72" />
          <Sk className="h-72" />
        </div>
        <Sk className="h-64" />
      </div>
    );
  }

  const clients  = summary?.clients  || {};
  const activity = summary?.activity || {};
  const overdue  = (diary.overdue || []).length;
  const coverage = clients.coverageRate;

  return (
    <div className="space-y-4">

      {/* ── The numbers, each one a way into the view behind it ───────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile
          icon="Users"
          label="Customers"
          value={clients.total ?? 0}
          hint={`${clients.active ?? 0} active`}
          onClick={() => onGo('clients')}
        />
        <StatTile
          icon="Target"
          label="Reached"
          /* A dash rather than 0% on an empty book: "nothing has been measured"
             and "we reached nobody" are different answers. */
          value={coverage === null || coverage === undefined ? '—' : `${coverage}%`}
          hint={`In the last ${CLIENT_QUIET_DAYS} days`}
          tone={coverage === null || coverage === undefined ? 'default' : coverage >= 50 ? 'good' : 'warn'}
          onClick={() => onGo('reports')}
        />
        <StatTile
          icon="UserX"
          label="Never contacted"
          value={clients.never ?? 0}
          hint="No contact on record"
          tone={clients.never ? 'bad' : 'good'}
          onClick={() => onGo('clients')}
        />
        <StatTile
          icon="Clock"
          label="Gone quiet"
          value={clients.quiet ?? 0}
          hint={`${clients.quietWithBalance?.length ?? 0} of them owe money`}
          tone={clients.quiet ? 'warn' : 'good'}
          onClick={() => onGo('clients')}
        />
        <StatTile
          icon="CalendarClock"
          label="Overdue"
          value={overdue}
          hint={`${(diary.today || []).length} due today`}
          tone={overdue ? 'bad' : 'good'}
          onClick={() => onGo('followups')}
        />
        <StatTile
          icon="MessagesSquare"
          label="Contacts this week"
          value={activity.thisWeek ?? 0}
          hint={`${activity.ownThisWeek ?? 0} by the office`}
          onClick={() => onGo('activity')}
        />
      </div>

      {/* ── Today's work ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        <Card
          title="Due now"
          icon="CalendarClock"
          hint="Appointments the office booked that are late or fall today"
          action={<MoreLink label="Open diary" onClick={() => onGo('followups')} />}
        >
          {dueNow.length === 0 ? (
            <Empty
              icon="CalendarCheck"
              title="Nothing is late"
              hint="Appointments you book appear here on the day they fall due."
              action={(
                <button
                  onClick={() => onSchedule(null)}
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <Icon name="CalendarPlus" size={13} color="currentColor" />
                  Book a follow-up
                </button>
              )}
            />
          ) : (
            <div className="space-y-2">
              {dueNow.map((f) => {
                const late = (diary.overdue || []).includes(f);
                return (
                  <div
                    key={f.id}
                    className="flex items-center gap-3 p-2.5 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                  >
                    <span className={`w-1.5 h-8 rounded-full flex-shrink-0 ${late ? 'bg-red-500' : 'bg-amber-500'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {nameFor(f) || f.lead_name || 'Unnamed contact'}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {f.notes || 'No note'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <ChannelBadge value={f.appointment_type} />
                      <span className={`text-xs font-medium ${late ? 'text-red-600' : 'text-amber-600'}`}>
                        {fmtDue(f.scheduled_at)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card
          title="Needs attention"
          icon="AlertTriangle"
          hint={`Customers nobody has spoken to in ${CLIENT_QUIET_DAYS} days, money first`}
          action={<MoreLink label="Open book" onClick={() => onGo('clients')} />}
        >
          {attention.length === 0 ? (
            <Empty
              icon="CheckCircle2"
              title={book.length ? 'Every customer has been reached' : 'No customers yet'}
              hint={book.length
                ? `Nobody on the book has gone ${CLIENT_QUIET_DAYS} days without contact.`
                : 'Customers appear here once the client list has rows.'}
            />
          ) : (
            <div className="space-y-2">
              {attention.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                >
                  <Avatar name={c.full_name} />
                  <button onClick={() => onOpenClient(c)} className="min-w-0 flex-1 text-left">
                    <p className="text-sm font-medium text-foreground truncate hover:text-primary transition-colors">
                      {c.full_name || 'Unnamed'}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {neglectReason(c)}
                      {c.outstanding > 0 && ` · ${fmtMoney(c.outstanding)} owing`}
                    </p>
                  </button>
                  <RelationshipBadge state={c.contactState} />
                  <button
                    onClick={() => onLog(c)}
                    title="Log a contact"
                    className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors flex-shrink-0"
                  >
                    <Icon name="PhoneCall" size={13} color="currentColor" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── What was said ────────────────────────────────────────────────── */}
      <Card
        title="Recent contact"
        icon="MessagesSquare"
        hint="The last thing said to a customer, by the office or by an agent"
        action={<MoreLink label="Open log" onClick={() => onGo('activity')} />}
      >
        {recent.length === 0 ? (
          <Empty
            icon="MessageSquare"
            title="Nothing has been logged yet"
            hint="Every call, visit and message recorded against a customer shows up here."
            action={(
              <button
                onClick={() => onLog(null)}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Icon name="PhoneCall" size={13} color="currentColor" />
                Log a contact
              </button>
            )}
          />
        ) : (
          <div className="divide-y divide-border">
            {recent.map((i) => (
              <div key={i.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                <Avatar name={nameFor(i) || i.contact_name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground truncate">
                      {nameFor(i) || i.contact_name || 'Unnamed contact'}
                    </span>
                    <ChannelBadge value={i.interaction_type} />
                    <AuthorBadge row={i} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {i.summary || i.subject || 'No note recorded'}
                  </p>
                </div>
                <span className="text-[11px] text-muted-foreground flex-shrink-0 pt-0.5">
                  {fmtAgo(i.occurred_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default CrmOverviewPanel;

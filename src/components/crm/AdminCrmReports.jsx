import React from 'react';
import Icon from '../AppIcon';
import { Sk, Empty, StatTile, fmtMoney, fmtAgo, ChannelBadge } from './crmFormat';
import { CLIENT_QUIET_DAYS } from '../../hooks/useAdminCrm';

/**
 * CRM reporting for the administrator.
 *
 * Every figure here is chosen because it implies an action. "412 contacts
 * logged" is a vanity number; "43% of your customers have not been spoken to
 * in a month, and 9 of them owe you money" is a morning's work. Where a number
 * cannot be honestly computed — no clients, nothing rated, nothing booked —
 * it says so rather than showing a confident zero, because a zero here reads
 * as failure and "we have not measured this yet" is a different thing.
 *
 * The bars are plain divs. A chart library would draw the same five rows and
 * cost a dependency, and these are proportions, not curves.
 */

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

const BarRow = ({ label, badge, count, total, tone = 'bg-primary' }) => (
  <div className="flex items-center gap-3">
    <div className="w-32 flex-shrink-0 flex items-center gap-1.5 min-w-0">
      {badge}
      {!badge && <span className="text-xs text-foreground truncate">{label}</span>}
    </div>
    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct(count, total)}%` }} />
    </div>
    <span className="w-16 text-right text-xs text-muted-foreground flex-shrink-0">
      {count} · {pct(count, total)}%
    </span>
  </div>
);

const Card = ({ title, hint, action, children }) => (
  <div className="bg-card border border-border rounded-xl p-5">
    <div className="flex items-start justify-between gap-3 mb-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      {action}
    </div>
    {children}
  </div>
);

/** Contacts per day, last fortnight. Height only — the numbers are on hover. */
const ActivityTrend = ({ daily }) => {
  const peak = Math.max(1, ...daily.map(d => d.count));
  const total = daily.reduce((n, d) => n + d.count, 0);

  if (!total) {
    return (
      <p className="text-xs text-muted-foreground">
        Nothing has been logged in the last fortnight.
      </p>
    );
  }

  return (
    <>
      <div className="flex items-end gap-1 h-24">
        {daily.map((d) => {
          const day = new Date(d.date);
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group">
              <div className="w-full flex items-end h-20">
                <div
                  className={`w-full rounded-t transition-all ${d.count ? 'bg-primary/70 group-hover:bg-primary' : 'bg-muted'}`}
                  style={{ height: `${Math.max(d.count ? 8 : 3, (d.count / peak) * 100)}%` }}
                  title={`${day.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}: ${d.count} contact${d.count === 1 ? '' : 's'}`}
                />
              </div>
              <span className="text-[9px] text-muted-foreground">
                {day.toLocaleDateString('en-GB', { weekday: 'narrow' })}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        {total} contact{total === 1 ? '' : 's'} in the last fortnight · busiest day {peak}
      </p>
    </>
  );
};

const AdminCrmReports = ({ summary, loading, onOpenClient, onExportBook, onExportActivity }) => {
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Sk key={i} className="h-24" />)}
        </div>
        <Sk className="h-56" />
        <Sk className="h-56" />
      </div>
    );
  }

  const { clients, activity, diary } = summary;

  return (
    <div className="space-y-4">

      {/* The four numbers a CRM is judged on */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile
          icon="Users"
          label="Reached this month"
          value={clients.coverageRate === null ? '—' : `${clients.coverageRate}%`}
          hint={clients.coverageRate === null
            ? 'No clients on the book yet'
            : `${clients.recent} of ${clients.total} clients`}
          tone={clients.coverageRate === null ? 'default' : (clients.coverageRate >= 50 ? 'good' : 'warn')}
        />
        <StatTile
          icon="UserX"
          label="Never contacted"
          value={clients.never}
          hint={clients.never ? 'Nobody has ever spoken to them' : 'Everybody has been reached at least once'}
          tone={clients.never ? 'bad' : 'good'}
        />
        <StatTile
          icon="Clock"
          label="Gone quiet"
          value={clients.quiet}
          hint={`No contact in ${CLIENT_QUIET_DAYS}+ days`}
          tone={clients.quiet ? 'warn' : 'good'}
        />
        <StatTile
          icon="AlertTriangle"
          label="Overdue follow-ups"
          value={diary.overdue}
          hint={diary.open ? `${diary.open} open in the diary` : 'Nothing booked'}
          tone={diary.overdue ? 'bad' : 'good'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Trend */}
        <Card
          title="Contact over the last fortnight"
          hint="Every logged contact, the office and the agents together."
        >
          <ActivityTrend daily={activity.daily} />
          <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-border">
            {[
              { label: 'This week', value: activity.thisWeek },
              { label: 'By the office', value: activity.ownThisWeek, hint: 'this week' },
              { label: 'By agents', value: activity.teamThisWeek, hint: 'this week' },
            ].map(s => (
              <div key={s.label}>
                <p className="text-lg font-bold text-foreground">{s.value}</p>
                <p className="text-[11px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* Channels */}
        <Card
          title="How contact happens"
          hint="Where the relationship actually lives, as opposed to where you assume it does."
        >
          {activity.byChannel.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing has been logged yet.</p>
          ) : (
            <div className="space-y-2.5">
              {activity.byChannel.slice(0, 6).map(c => (
                <BarRow
                  key={c.value || 'none'}
                  badge={<ChannelBadge value={c.value} />}
                  count={c.count}
                  total={activity.total}
                />
              ))}
            </div>
          )}
          <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border text-xs">
            <span className="text-muted-foreground">
              <span className="font-semibold text-foreground">{activity.outbound}</span> we reached out
            </span>
            <span className="text-muted-foreground">
              <span className="font-semibold text-foreground">{activity.inbound}</span> they got in touch
            </span>
          </div>
        </Card>

        {/* Outcomes */}
        <Card
          title="What comes of it"
          hint={activity.positiveRate === null
            ? 'Outcomes are optional, and none have been recorded yet.'
            : `${activity.positiveRate}% of rated contacts went well.`}
        >
          {activity.byOutcome.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing has been logged yet.</p>
          ) : (
            <div className="space-y-2.5">
              {activity.byOutcome.slice(0, 8).map(o => (
                <BarRow
                  key={o.value || 'none'}
                  label={o.label}
                  count={o.count}
                  total={activity.total}
                  tone={o.value === null ? 'bg-slate-300' : 'bg-primary'}
                />
              ))}
            </div>
          )}
        </Card>

        {/* Diary discipline */}
        <Card
          title="Are commitments kept"
          hint="A diary nobody ticks is a diary nobody reads."
        >
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Open', value: diary.open, tone: 'text-foreground' },
              { label: 'Overdue', value: diary.overdue, tone: diary.overdue ? 'text-red-600' : 'text-foreground' },
              { label: 'Due today', value: diary.today, tone: 'text-amber-600' },
              { label: 'Completed', value: diary.completed, tone: 'text-emerald-600' },
            ].map(s => (
              <div key={s.label} className="bg-muted/40 rounded-xl p-3">
                <p className={`text-xl font-bold ${s.tone}`}>{s.value}</p>
                <p className="text-[11px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-4 pt-4 border-t border-border">
            {diary.completionRate === null
              ? 'Nothing has been booked yet, so there is nothing to keep.'
              : `${diary.completionRate}% of everything ever booked was seen through.`}
          </p>
        </Card>
      </div>

      {/* The worklist: quiet AND owing. Two problems that are usually one. */}
      <Card
        title="Quiet customers who owe money"
        hint={`No contact in ${CLIENT_QUIET_DAYS}+ days and a balance outstanding — the list where "nobody called them" and "they have not paid" are the same problem.`}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={onExportBook}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Icon name="Download" size={13} color="currentColor" />
              Client book
            </button>
            <button
              onClick={onExportActivity}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Icon name="Download" size={13} color="currentColor" />
              Contact log
            </button>
          </div>
        }
      >
        {clients.quietWithBalance.length === 0 ? (
          <Empty
            icon="CheckCircle2"
            title="Nothing on this list"
            hint={clients.withOpenBalance
              ? 'Every customer with a balance has been contacted recently.'
              : 'No customer currently carries an outstanding balance.'}
          />
        ) : (
          <div className="divide-y divide-border">
            {clients.quietWithBalance.slice(0, 15).map(c => (
              <button
                key={c.id}
                onClick={() => onOpenClient(c)}
                className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-muted/40 transition-colors px-1 rounded"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{c.full_name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {c.account_number} · last contact {fmtAgo(c.lastContactAt)}
                  </p>
                </div>
                <span className="text-sm font-semibold text-amber-600 flex-shrink-0">{fmtMoney(c.outstanding)}</span>
                <Icon name="ChevronRight" size={15} color="var(--color-muted-foreground)" />
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default AdminCrmReports;

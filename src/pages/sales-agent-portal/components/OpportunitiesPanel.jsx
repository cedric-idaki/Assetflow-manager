import React, { useMemo, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { PIPELINE_STAGES, stageMeta } from '../../../config/crmVocabulary';
import {
  summariseOpportunities,
  leadValue,
  leadProbability,
  parseBudgetRange,
  parseLocalDate,
  formatCompactMoney,
  formatMoney,
} from '../../../utils/pipelineValue';

/**
 * The money view of the pipeline.
 *
 * The board above answers "where is this deal" and the CRM panel answers "what
 * was said". Neither could ever answer the two questions a sales person is
 * actually asked — how much is in your pipeline, and what is going to close
 * this month — because until leads.deal_value existed there was no number to
 * answer them with. The only money-shaped field was `budget_range`, free text,
 * unsummable.
 *
 * So this panel does two jobs at once. It shows the forecast, and it is the
 * place deals get priced: every list here is a worklist, and the emptiest one
 * ("needs a value") is the one that makes the rest of the numbers true.
 *
 * Estimated money is never dressed up as stated money. A figure this app read
 * out of a budget note carries a marker everywhere it appears, and the headline
 * splits the two, because the difference between "the agent says KES 4M" and
 * "someone typed 'under 5M' in March" is the difference between a forecast and
 * a guess.
 */

/**
 * Stage tones, written out in full.
 *
 * Every class here is a literal string on purpose. Tailwind generates CSS by
 * scanning source text for class names, so anything assembled at runtime —
 * `bg-${tone}-100`, or a `.replace('100', '400')` on one of these — names a
 * class that was never built and renders as no colour at all.
 */
const TONE_CLASS = {
  slate:   'bg-slate-100 text-slate-700 border-slate-200',
  blue:    'bg-blue-100 text-blue-700 border-blue-200',
  violet:  'bg-violet-100 text-violet-700 border-violet-200',
  amber:   'bg-amber-100 text-amber-700 border-amber-200',
  emerald: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

/** The solid fill for the stage bar — same tones, deeper, also written out. */
const TONE_BAR = {
  slate:   'bg-slate-400',
  blue:    'bg-blue-400',
  violet:  'bg-violet-400',
  amber:   'bg-amber-400',
  emerald: 'bg-emerald-400',
};

const fmtDate = (value) => {
  const d = parseLocalDate(value);
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : null;
};

/** Today, as the value an <input type="date"> wants. */
const toDateInput = (value) => {
  const d = parseLocalDate(value);
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const StatTile = ({ icon, label, value, sub, tone = 'text-foreground', onClick, active }) => {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
      className={`text-left px-3.5 py-3 rounded-xl border transition-all ${
        active ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border bg-background'
      } ${onClick ? 'hover:border-primary/40 cursor-pointer' : ''}`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Icon name={icon} size={13} color="currentColor" className="text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className={`text-lg font-bold leading-tight ${tone}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </Wrapper>
  );
};

/**
 * One deal, with its value editable in place.
 *
 * In place rather than behind the lead modal on purpose: pricing a pipeline is
 * a batch job an agent does once, going down a list of forty. Four clicks and a
 * dialog per deal is how a pipeline stays unpriced forever.
 */
const DealRow = ({ lead, onSave, onOpen }) => {
  const { value, source, budget } = leadValue(lead);
  const probability = leadProbability(lead);
  const meta = stageMeta(lead.stage);
  const due  = parseLocalDate(lead.expected_close_date);
  const isOverdue = due && due < new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [form, setForm] = useState({
    dealValue:  lead.deal_value ?? '',
    closeDate:  toDateInput(lead.expected_close_date),
    probability: lead.win_probability ?? '',
  });

  const start = () => {
    setForm({
      dealValue:   lead.deal_value ?? '',
      closeDate:   toDateInput(lead.expected_close_date),
      probability: lead.win_probability ?? '',
    });
    setError('');
    setEditing(true);
  };

  /** Take the budget note's figure as the stated value — the one-click path. */
  const useBudget = () => {
    if (!budget) return;
    setForm(f => ({ ...f, dealValue: budget.value }));
    setError('');
    setEditing(true);
  };

  const save = async () => {
    const raw = String(form.dealValue).trim();
    const parsed = raw === '' ? null : Number(raw.replace(/,/g, ''));
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      setError('Enter a value of zero or more, or leave it blank.');
      return;
    }
    const prob = String(form.probability).trim();
    const parsedProb = prob === '' ? null : Number(prob);
    if (parsedProb !== null && (!Number.isFinite(parsedProb) || parsedProb < 0 || parsedProb > 100)) {
      setError('Chance of winning must be between 0 and 100.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onSave(lead.id, {
        dealValue:      parsed,
        expectedCloseDate: form.closeDate || null,
        winProbability: parsedProb,
      });
      setEditing(false);
    } catch (err) {
      setError(err?.message || 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <button
            onClick={() => onOpen?.(lead)}
            className="text-sm font-medium text-foreground truncate hover:text-primary text-left"
          >
            {lead.full_name || 'Unnamed lead'}
          </button>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${TONE_CLASS[meta.tone] || TONE_CLASS.slate}`}>
              {meta.label}
            </span>
            <span className="text-xs text-muted-foreground">{probability}% chance</span>
            {lead.win_probability !== null && lead.win_probability !== undefined && (
              <span className="text-xs text-muted-foreground" title="Set on this deal, overriding the stage default">
                · your call
              </span>
            )}
            {due && (
              <span className={`text-xs font-medium ${isOverdue ? 'text-red-600' : 'text-muted-foreground'}`}>
                · {isOverdue ? 'was due ' : 'closes '}{fmtDate(lead.expected_close_date)}
              </span>
            )}
            {lead.asset_interest && (
              <span className="text-xs text-muted-foreground truncate">· {lead.asset_interest}</span>
            )}
          </div>
        </div>

        <div className="text-right flex-shrink-0">
          {source === 'none' ? (
            <p className="text-sm font-semibold text-amber-600">No value</p>
          ) : (
            <>
              <p className={`text-sm font-bold ${source === 'estimated' ? 'text-muted-foreground' : 'text-foreground'}`}>
                {formatMoney(value)}
              </p>
              <p className="text-xs text-muted-foreground">
                {source === 'estimated' ? 'estimated' : `${formatCompactMoney(value * probability / 100)} weighted`}
              </p>
            </>
          )}
        </div>

        {!editing && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {source !== 'stated' && budget && (
              <button
                onClick={useBudget}
                title={`Budget note says "${lead.budget_range}"`}
                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-all whitespace-nowrap"
              >
                Use {formatCompactMoney(budget.value)}
              </button>
            )}
            <button
              onClick={start}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-all"
            >
              {source === 'stated' ? 'Edit' : 'Set value'}
            </button>
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-3 p-3 rounded-xl bg-muted/40 border border-border space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Deal value (KES)</label>
              <input
                type="number"
                min="0"
                step="1000"
                value={form.dealValue}
                onChange={e => setForm(f => ({ ...f, dealValue: e.target.value }))}
                placeholder="0"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              {budget && (
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, dealValue: budget.value }))}
                  className="text-xs text-primary hover:underline mt-1"
                >
                  Budget note says {formatMoney(budget.value)}
                  {budget.kind === 'range' ? ' (low end)' : budget.kind === 'ceiling' ? ' (their ceiling)' : ''}
                </button>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Expected close</label>
              <input
                type="date"
                value={form.closeDate}
                onChange={e => setForm(f => ({ ...f, closeDate: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">
                Chance of winning
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={form.probability}
                onChange={e => setForm(f => ({ ...f, probability: e.target.value }))}
                placeholder={`${meta.probability ?? 0} (stage default)`}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Blank uses the {meta.label.toLowerCase()} default of {meta.probability ?? 0}%.
              </p>
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
};

const EmptyState = ({ icon, title, hint, tone = 'emerald' }) => (
  <div className="text-center py-8">
    <div className={`w-11 h-11 rounded-full mx-auto flex items-center justify-center mb-3 ${
      tone === 'emerald' ? 'bg-emerald-100' : 'bg-muted'
    }`}>
      <Icon name={icon} size={19} color={tone === 'emerald' ? '#059669' : '#6b7280'} />
    </div>
    <p className="text-sm font-medium text-foreground">{title}</p>
    {hint && <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">{hint}</p>}
  </div>
);

const LIST_PAGE = 10;

const OpportunitiesPanel = ({
  leads = [],
  loading = false,
  error = null,
  onSaveDeal,
  onOpenLead,
  onRefresh,
}) => {
  const [tab, setTab] = useState('all');
  const [showCount, setShowCount] = useState(LIST_PAGE);

  const summary = useMemo(() => summariseOpportunities(leads), [leads]);

  const lists = useMemo(() => ({
    all:      [...summary.open.leads].sort((a, b) => leadValue(b).value - leadValue(a).value),
    closing:  [...summary.closingThisMonth.leads].sort(
      (a, b) => (parseLocalDate(a.expected_close_date) ?? 0) - (parseLocalDate(b.expected_close_date) ?? 0),
    ),
    overdue:  [...summary.overdue.leads].sort(
      (a, b) => (parseLocalDate(a.expected_close_date) ?? 0) - (parseLocalDate(b.expected_close_date) ?? 0),
    ),
    unvalued: [...summary.unvalued.leads].sort((a, b) => {
      // The ones with a budget note first: they are a single click from done.
      const ab = parseBudgetRange(a.budget_range) ? 1 : 0;
      const bb = parseBudgetRange(b.budget_range) ? 1 : 0;
      return bb - ab;
    }),
  }), [summary]);

  const shown = (lists[tab] || []).slice(0, showCount);

  const switchTab = (next) => { setTab(next); setShowCount(LIST_PAGE); };

  const tabs = [
    { id: 'all',      label: 'Open deals',   count: summary.open.count },
    { id: 'closing',  label: 'Closing this month', count: summary.closingThisMonth.count },
    { id: 'overdue',  label: 'Date passed',  count: summary.overdue.count },
    { id: 'unvalued', label: 'Needs a value', count: summary.unvalued.count },
  ];

  const openStages = PIPELINE_STAGES.filter(s => s.value !== 'closed');

  return (
    <div className="bg-card border border-border rounded-xl">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Icon name="TrendingUp" size={17} color="var(--color-primary)" />
            Opportunities
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            What your pipeline is worth, and what is likely to land
          </p>
        </div>
        {onRefresh && (
          <button
            onClick={() => onRefresh()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <Icon name="RefreshCw" size={12} color="currentColor" />
            Refresh
          </button>
        )}
      </div>

      {error && (
        <div className="mx-5 mt-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
          <Icon name="AlertCircle" size={14} color="#dc2626" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {/* Headline figures */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 px-5 py-4 border-b border-border">
        <StatTile
          icon="Layers"
          label="Open pipeline"
          value={loading ? '—' : formatCompactMoney(summary.open.value)}
          sub={
            summary.estimatedValue > 0
              ? `${formatCompactMoney(summary.statedValue)} stated · ${formatCompactMoney(summary.estimatedValue)} estimated`
              : `${summary.open.count} open deal${summary.open.count === 1 ? '' : 's'}`
          }
        />
        <StatTile
          icon="Target"
          label="Weighted forecast"
          value={loading ? '—' : formatCompactMoney(summary.open.weighted)}
          sub="Value × chance of winning"
          tone="text-primary"
        />
        <StatTile
          icon="CalendarCheck"
          label="Closing this month"
          value={loading ? '—' : formatCompactMoney(summary.closingThisMonth.value)}
          sub={`${summary.closingThisMonth.count} deal${summary.closingThisMonth.count === 1 ? '' : 's'} dated${
            summary.overdue.count > 0 ? ` · ${summary.overdue.count} past due` : ''
          }`}
          tone={summary.overdue.count > 0 ? 'text-amber-600' : 'text-foreground'}
          onClick={() => switchTab(summary.overdue.count > 0 ? 'overdue' : 'closing')}
          active={tab === 'closing' || tab === 'overdue'}
        />
        <StatTile
          icon="Trophy"
          label="Won this month"
          value={loading ? '—' : formatCompactMoney(summary.wonThisMonth.value)}
          sub={
            summary.valueWinRate === null
              ? 'No deals settled yet'
              : `${summary.valueWinRate}% of settled value won`
          }
          tone="text-emerald-600"
        />
      </div>

      {/* Unpriced nag — the panel's own numbers are only as true as this is
          small, so it says so plainly rather than hiding the gap. */}
      {!loading && summary.unvalued.count > 0 && (
        <div className="mx-5 mt-4 flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl border bg-amber-50 border-amber-200">
          <Icon name="AlertTriangle" size={16} color="#d97706" />
          <p className="text-xs font-semibold text-amber-800">
            {summary.unvalued.count} open deal{summary.unvalued.count === 1 ? '' : 's'} carry no value
            {summary.unvalued.withBudgetHint > 0 && (
              <> — {summary.unvalued.withBudgetHint} already {summary.unvalued.withBudgetHint === 1 ? 'has' : 'have'} a figure in the budget note</>
            )}
          </p>
          <button
            onClick={() => switchTab('unvalued')}
            className="ml-auto text-xs font-semibold text-amber-700 hover:underline whitespace-nowrap"
          >
            Price them →
          </button>
        </div>
      )}

      {/* Value by stage — the same money as the headline, split across the
          board above, so the two can be read against each other. */}
      {!loading && summary.open.value > 0 && (
        <div className="px-5 pt-4">
          <div className="flex h-2 rounded-full overflow-hidden bg-muted">
            {openStages.map(s => {
              const bucket = summary.byStage[s.value];
              const pct = bucket ? (bucket.value / summary.open.value) * 100 : 0;
              if (pct <= 0) return null;
              return (
                <div
                  key={s.value}
                  style={{ width: `${pct}%` }}
                  title={`${s.label}: ${formatMoney(bucket.value)}`}
                  className={TONE_BAR[s.tone] || TONE_BAR.slate}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {openStages.map(s => {
              const bucket = summary.byStage[s.value];
              if (!bucket?.count) return null;
              return (
                <span key={s.value} className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{s.label}</span>{' '}
                  {formatCompactMoney(bucket.value)} · {bucket.count}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 px-5 pt-3">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => switchTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              tab === t.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {t.label}
            {t.count > 0 && <span className="ml-1.5 opacity-70">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="px-5 py-4">
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="animate-pulse flex items-center gap-3">
                <div className="h-4 bg-muted rounded flex-1" />
                <div className="h-4 bg-muted rounded w-24" />
              </div>
            ))}
          </div>
        ) : shown.length === 0 ? (
          tab === 'unvalued' ? (
            <EmptyState
              icon="CheckCircle2"
              title="Every open deal has a value"
              hint="The pipeline figure above is the real thing, not an estimate."
            />
          ) : tab === 'overdue' ? (
            <EmptyState
              icon="CheckCircle2"
              title="No close dates have slipped"
              hint="Every dated deal is still expected on or after today."
            />
          ) : tab === 'closing' ? (
            <EmptyState
              icon="CalendarClock"
              title="Nothing dated for this month"
              hint="Give your live deals an expected close date and this becomes your month-end list."
              tone="slate"
            />
          ) : (
            <EmptyState
              icon="Inbox"
              title="No open deals"
              hint="Register a lead and it appears here the moment it has a value."
              tone="slate"
            />
          )
        ) : (
          <>
            <ul className="divide-y divide-border">
              {shown.map(l => (
                <DealRow key={l.id} lead={l} onSave={onSaveDeal} onOpen={onOpenLead} />
              ))}
            </ul>
            {(lists[tab] || []).length > showCount && (
              <button
                onClick={() => setShowCount(c => c + LIST_PAGE)}
                className="w-full mt-3 py-2 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
              >
                Show more
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default OpportunitiesPanel;

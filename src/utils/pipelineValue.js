/**
 * pipelineValue
 *
 * What the agent's pipeline is WORTH, and what of it is likely to land.
 *
 * The portal has always been able to count leads. Counting is the wrong unit:
 * an agent working one KES 12M deal and an agent working forty KES 200k deals
 * had identical dashboards, and only one of them was having a good month. The
 * numbers here are the ones a sales person is actually asked for — open
 * pipeline, weighted forecast, what closes this month, average deal size, win
 * rate measured in money rather than in headcount.
 *
 * Pure and exported so the arithmetic is testable without a database, for the
 * same reason deriveInteractionStats is: every figure here is one an agent gets
 * judged on and a commission conversation gets had over. A weighted forecast
 * that is quietly off by a rounding rule is worse than no forecast, because
 * people act on it.
 *
 * ── Stated money and estimated money ──────────────────────────────────────
 *
 * `leads.deal_value` is what somebody actually said the deal is worth.
 * `leads.budget_range` is free text an agent typed at registration — "under
 * 500k", "2,000,000 - 5,000,000", "5M" — and it is the only money-shaped thing
 * on every lead written before deal_value existed.
 *
 * Rather than backfilling the free text into the numeric column (see
 * 20260830140000, which deliberately does not), the parse happens HERE, at read
 * time, and the two are kept apart all the way to the screen: `stated` is money
 * an agent committed to, `estimated` is this file's reading of a note. A total
 * is allowed to include both — a pipeline figure of zero on day one would just
 * make the feature look broken — but it is never allowed to present them as the
 * same kind of fact.
 */

import {
  stageMeta, isLostLead, OPPORTUNITY_STAGES, PIPELINE_STAGE_VALUES,
} from '../config/crmVocabulary';

/**
 * Below this, a number found in free text is not money.
 *
 * `budget_range` is a text box, and text boxes collect things like "3 bedroom"
 * and "2 acres". Without a floor, "3 bedroom" parses to a KES 3 opportunity
 * that is counted, sorted and forecast. No asset this business sells costs
 * under a thousand shillings, so anything smaller is a misread, not a bargain.
 */
const MIN_PLAUSIBLE_VALUE = 1000;

const SUFFIX_MULTIPLIER = { k: 1e3, m: 1e6, b: 1e9 };

/** Words that mean the single number following them is a CEILING. */
const CEILING_HINTS = /\b(under|below|less than|up to|upto|max|maximum|at most)\b|[<≤]/;

/** Words that mean the single number is a FLOOR. */
const FLOOR_HINTS = /\b(above|over|from|more than|at least|min|minimum|starting)\b|[>≥]/;

/**
 * A number, or null when there isn't one.
 *
 * The null and empty-string checks are the whole point, and are not paranoia:
 * `Number(null)` is 0 and so is `Number('')`. Without them an unpriced lead
 * reads back as a deal somebody deliberately valued at zero, and a lead nobody
 * has assessed reads back as a 0% chance of ever closing — both indistinguish-
 * able from a real answer, and both silently wrong in a forecast.
 */
const numeric = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Read a money figure out of a free-text budget note.
 *
 * Returns null when there is nothing usable, which is a real and common answer
 * — the caller must be able to tell "no budget recorded" from "a budget of
 * zero", and a lead with an empty note is not a lead worth nothing.
 *
 * The representative `value` is deliberately the LOW end of a range. An agent
 * who wrote "2,000,000 - 5,000,000" committed to neither figure, and a pipeline
 * total that quietly picks the optimistic end of every range is a forecast
 * built to disappoint.
 *
 * @returns {{value:number, kind:'exact'|'range'|'ceiling'|'floor', low:number, high:number|null}|null}
 */
export const parseBudgetRange = (text) => {
  if (text === null || text === undefined) return null;

  // Underscores because older budget values were written that way
  // ('under_500k'), and the portal's own CSV export already replaces them for
  // display — the parser should read what the agent sees.
  const raw = String(text).toLowerCase().replace(/_/g, ' ');
  if (!raw.trim()) return null;

  // Currency words carry no quantity and their letters collide with the
  // suffixes below — 'kes' would otherwise lend its k to the number after it.
  const cleaned = raw.replace(/\b(kes|kshs?|shs?)\b\.?/g, ' ');

  // A number, optional decimal, optional thousands separators, optional
  // magnitude suffix. The suffix must not be followed by another letter, or
  // "5 bedroom" would read its b as 'billion'.
  const TOKEN = /(\d[\d,]*(?:\.\d+)?)\s*([kmb])?(?![a-z])/g;

  const found = [];
  let match;
  while ((match = TOKEN.exec(cleaned)) !== null) {
    const digits = Number(match[1].replace(/,/g, ''));
    if (!Number.isFinite(digits)) continue;
    found.push({ digits, suffix: match[2] || null });
  }
  if (found.length === 0) return null;

  const expand = (t) => t.digits * (t.suffix ? SUFFIX_MULTIPLIER[t.suffix] : 1);

  if (found.length >= 2) {
    const [a, b] = found;
    // "2 - 5M" means two million to five million. The writer put the magnitude
    // once, on the end where it reads naturally, and meant it for both halves.
    // Only inherited when the bare number is too small to stand on its own, so
    // "500000 - 2M" is left exactly as written.
    const aSuffix = (!a.suffix && b.suffix && a.digits < MIN_PLAUSIBLE_VALUE) ? b.suffix : a.suffix;
    const low  = a.digits * (aSuffix ? SUFFIX_MULTIPLIER[aSuffix] : 1);
    const high = expand(b);

    // Written backwards ("5M - 2M") — take them as a set rather than trusting
    // the order, so the low end is still the low end.
    const lo = Math.min(low, high);
    const hi = Math.max(low, high);
    if (lo < MIN_PLAUSIBLE_VALUE) return null;
    return { value: lo, kind: 'range', low: lo, high: hi };
  }

  const value = expand(found[0]);
  if (value < MIN_PLAUSIBLE_VALUE) return null;

  // A ceiling and a floor are both single stated bounds, and the bound is the
  // only figure the agent gave — so it is what gets used, and `kind` carries
  // the caveat forward for anything that wants to show it.
  if (CEILING_HINTS.test(cleaned)) return { value, kind: 'ceiling', low: 0, high: value };
  if (FLOOR_HINTS.test(cleaned) || /\d\s*[kmb]?\s*\+/.test(cleaned)) {
    return { value, kind: 'floor', low: value, high: null };
  }
  return { value, kind: 'exact', low: value, high: value };
};

/**
 * What one lead is worth, and whether anybody actually said so.
 *
 * Always returns an object — a lead with no value is `{ value: 0, source:
 * 'none' }` rather than null, because every caller here sums these and a null
 * in a reduce is how a pipeline total becomes NaN on one bad row.
 *
 * @returns {{value:number, source:'stated'|'estimated'|'none', budget:object|null}}
 */
export const leadValue = (lead) => {
  const stated = numeric(lead?.deal_value);
  // `>= 0` and not truthiness: a deal deliberately marked zero (a giveaway, a
  // written-off renewal) is a stated value, not a missing one.
  if (stated !== null && stated >= 0) {
    return { value: stated, source: 'stated', budget: null };
  }

  const budget = parseBudgetRange(lead?.budget_range);
  if (budget) return { value: budget.value, source: 'estimated', budget };

  return { value: 0, source: 'none', budget: null };
};

/**
 * The odds this deal lands, 0-100.
 *
 * Settled deals are not forecasts. A converted lead is 100 and a lost one is 0
 * no matter what stage weight or per-deal override it carries, because the
 * question has already been answered — leaving a proposal-stage 60% on a deal
 * that closed last week would put money in the forecast that has already been
 * banked or already been lost.
 */
export const leadProbability = (lead) => {
  if (lead?.converted_at) return 100;
  if (isLostLead(lead)) return 0;

  const override = numeric(lead?.win_probability);
  if (override !== null) return Math.min(100, Math.max(0, override));

  return stageMeta(lead?.stage).probability ?? 0;
};

/** Value × odds: the part of this deal a forecast is entitled to count. */
export const weightedValue = (lead) => leadValue(lead).value * (leadProbability(lead) / 100);

/** Open means still winnable: not converted, not at the end of the board. */
export const isOpenLead = (lead) =>
  Boolean(lead) && !lead.converted_at && lead.stage !== 'closed';

const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const startOfNextMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 1);

/**
 * A date column compared against a local calendar month.
 *
 * expected_close_date is a DATE, so PostgREST hands it over as 'YYYY-MM-DD'.
 * `new Date('2026-08-31')` parses as UTC midnight, which in any timezone west
 * of Greenwich is the 30th locally — the deal drops out of August for exactly
 * the people it is due for. Split and build a local date instead.
 */
export const parseLocalDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const iso = String(value);
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));

  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

const emptyBucket = () => ({ count: 0, value: 0, weighted: 0, leads: [] });

const addTo = (bucket, lead, value, weighted) => {
  bucket.count    += 1;
  bucket.value    += value;
  bucket.weighted += weighted;
  bucket.leads.push(lead);
};

/**
 * Everything the opportunities panel puts on screen, in one pass.
 *
 * One pass and one shape on purpose: these figures are read side by side, and
 * the fastest way to lose an agent's trust is for the pipeline total and the
 * sum of the stage columns under it to disagree because two functions filtered
 * "open" slightly differently.
 */
export const summariseOpportunities = (leads = [], now = Date.now()) => {
  const today      = new Date(now);
  const monthStart = startOfMonth(today);
  const monthEnd   = startOfNextMonth(today);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const open          = emptyBucket();
  const opportunities = emptyBucket();
  const closingThisMonth = emptyBucket();
  const overdue       = emptyBucket();
  const undated       = emptyBucket();
  const won           = emptyBucket();
  const wonThisMonth  = emptyBucket();
  const lost          = emptyBucket();

  // Every open stage gets a bucket up front, so a stage with nothing in it
  // renders as an empty column rather than vanishing from the board. 'closed'
  // is excluded because its leads are already counted as won or lost.
  const byStage = {};
  for (const s of PIPELINE_STAGE_VALUES) {
    if (s !== 'closed') byStage[s] = emptyBucket();
  }

  let statedValue    = 0;
  let estimatedValue = 0;
  const unvalued     = { count: 0, withBudgetHint: 0, leads: [] };

  for (const lead of leads) {
    if (!lead) continue;

    const { value, source } = leadValue(lead);
    const weighted = value * (leadProbability(lead) / 100);

    if (lead.converted_at) {
      addTo(won, lead, value, value);
      const at = parseLocalDate(lead.converted_at);
      if (at && at >= monthStart && at < monthEnd) addTo(wonThisMonth, lead, value, value);
      continue;
    }

    if (isLostLead(lead)) {
      // Weighted is the value here, not zero: this bucket answers "how much did
      // we lose", which is the full size of what walked away, not the fraction
      // a forecast would have counted.
      addTo(lost, lead, value, value);
      continue;
    }

    if (!isOpenLead(lead)) continue;

    addTo(open, lead, value, weighted);

    if (source === 'stated') {
      statedValue += value;
    } else {
      // "Unvalued" means no agent has stated a figure, which includes the ones
      // this file estimated from a budget note — an estimate is a reading, not
      // a commitment, and the panel exists to get them turned into one.
      // `withBudgetHint` is the subset that is a single click from done,
      // because the number is already sitting in budget_range.
      if (source === 'estimated') {
        estimatedValue += value;
        unvalued.withBudgetHint += 1;
      }
      unvalued.count += 1;
      unvalued.leads.push(lead);
    }

    if (!byStage[lead.stage]) byStage[lead.stage] = emptyBucket();
    addTo(byStage[lead.stage], lead, value, weighted);

    if (OPPORTUNITY_STAGES.includes(lead.stage)) addTo(opportunities, lead, value, weighted);

    const due = parseLocalDate(lead.expected_close_date);
    if (!due) {
      addTo(undated, lead, value, weighted);
    } else if (due < todayStart) {
      // Not "late to close" — late to be RE-DATED. A deal whose own close date
      // has passed while it sat open is a deal whose forecast is stale, and it
      // is the single most useful list on this panel.
      addTo(overdue, lead, value, weighted);
    } else if (due < monthEnd) {
      addTo(closingThisMonth, lead, value, weighted);
    }
  }

  const settledValue = won.value + lost.value;
  const valuedWon    = won.leads.filter(l => leadValue(l).value > 0);

  return {
    open,
    opportunities,
    closingThisMonth,
    overdue,
    undated,
    won,
    wonThisMonth,
    lost,
    byStage,
    unvalued,

    // The honest split behind `open.value`. Shown side by side on the panel so
    // an agent can see how much of their pipeline figure is their own number
    // and how much is this file's reading of a note they typed months ago.
    statedValue,
    estimatedValue,

    /** Average size of a deal actually won. Null, never 0, when none have been. */
    avgWonValue: valuedWon.length
      ? Math.round(valuedWon.reduce((s, l) => s + leadValue(l).value, 0) / valuedWon.length)
      : null,

    /**
     * Win rate measured in money rather than headcount.
     *
     * The count-based rate treats a lost KES 20M deal as the equal of a lost
     * KES 200k one. This is the number that says whether the big ones are
     * landing, and it is routinely the less flattering of the two.
     */
    valueWinRate: settledValue > 0 ? Math.round((won.value / settledValue) * 100) : null,

    /** Biggest open deal — the one worth a phone call today. */
    biggest: open.leads.reduce(
      (best, l) => (!best || leadValue(l).value > leadValue(best).value ? l : best),
      null,
    ),
  };
};

/**
 * Open pipeline grouped into the next `months` calendar months by close date.
 *
 * Separate from summariseOpportunities because it is a different question with
 * a different shape — "when does the money arrive" rather than "how much is
 * there" — and only one screen asks it.
 */
export const forecastByMonth = (leads = [], months = 6, now = Date.now()) => {
  const today = new Date(now);
  const buckets = [];
  for (let i = 0; i < months; i += 1) {
    const start = new Date(today.getFullYear(), today.getMonth() + i, 1);
    buckets.push({
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
      label: start.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
      start,
      end: new Date(start.getFullYear(), start.getMonth() + 1, 1),
      count: 0,
      value: 0,
      weighted: 0,
    });
  }

  for (const lead of leads) {
    if (!isOpenLead(lead)) continue;
    const due = parseLocalDate(lead?.expected_close_date);
    if (!due) continue;
    const bucket = buckets.find(b => due >= b.start && due < b.end);
    if (!bucket) continue;
    bucket.count    += 1;
    bucket.value    += leadValue(lead).value;
    bucket.weighted += weightedValue(lead);
  }

  return buckets;
};

/**
 * Money, short enough to fit in a stat tile.
 *
 * A pipeline reads in millions and a KPI card is about eleven characters wide,
 * so "KES 12,450,000" wraps and "KES 12.5M" does not. Exact digits stay
 * available through `formatMoney` for anywhere the precision matters.
 */
export const formatCompactMoney = (n, currency = 'KES') => {
  const v = numeric(n) ?? 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}${currency} ${(abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${sign}${currency} ${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${sign}${currency} ${(abs / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}K`;
  return `${sign}${currency} ${Math.round(abs)}`;
};

export const formatMoney = (n, currency = 'KES') =>
  `${currency} ${(numeric(n) ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default {
  parseBudgetRange,
  leadValue,
  leadProbability,
  weightedValue,
  isOpenLead,
  parseLocalDate,
  summariseOpportunities,
  forecastByMonth,
  formatCompactMoney,
  formatMoney,
};

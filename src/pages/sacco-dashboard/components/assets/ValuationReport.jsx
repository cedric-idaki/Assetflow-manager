/**
 * ASSET VALUATION — what the SACCO's assets are worth, and how much of that
 * anybody has actually checked.
 *
 * The register answers "what do we own". This answers the question a treasurer
 * is asked across the table at a board meeting, which is a different question
 * and has a trap in it: the register reports each asset at
 * coalesce(current_value, book_value), so a book with four valuations out of
 * four hundred assets still produces a confident-looking "current value"
 * total. Ninety-nine per cent of it is an accountant's residual.
 *
 * SO THIS REPORT NEVER SHOWS THE HEADLINE ALONE. Every screen below carries the
 * split beside it — how many assets carry a recorded valuation, what share of
 * the money that covers, what the valuations rest on, and how many of them are
 * over a year old. A board that is told "KES 63.5M" deserves to be told in the
 * same breath that KES 54M of it is book value.
 *
 * EVERY FIGURE IS A SERVER AGGREGATE. useAssetValuation reads two Postgres
 * functions that scan every held asset; the table below is the complete
 * category breakdown, not a page, and the total row comes from the whole-book
 * aggregate rather than from adding the rows above it. If those two ever
 * disagree, the one to believe is the one Postgres computed over everything.
 */
import React, { useMemo } from 'react';
import Icon from '../../../../components/AppIcon';
import { useToast } from '../../../../components/Toast';
import { downloadCSV } from '../../../../utils/exportUtils';
import { useAssetValuation } from '../../../../hooks/useAssetValuation';
import {
  categoryMeta, categoryLabel, valuationBasisLabel,
  valuationCoverage, revaluationStance,
  buildValuationExport, VALUATION_EXPORT_COLUMNS,
} from '../../../../config/assetRegister';
import { KES, fmtDate, Card, StatCard, Table, EmptyState, GhostButton, PrimaryButton } from '../_shared';

const Sk = ({ className = '' }) => <div className={`animate-pulse bg-muted rounded-lg ${className}`} />;

/** Percentage of a whole, zero-safe, to one decimal. */
const pctOf = (part, whole) => (Number(whole) > 0 ? (Number(part) / Number(whole)) * 100 : 0);
const pct = (v, dp = 1) => `${(Number(v) || 0).toFixed(dp)}%`;

/**
 * A signed money figure.
 *
 * The sign is the whole message on a revaluation line, and KES() drops it into
 * the same grey as everything else. A deficit that looks like a surplus is the
 * one formatting bug on this screen that would matter.
 */
const signedKES = (n) => `${Number(n) > 0 ? '+' : ''}${KES(n)}`;

const TONE_TEXT = { success: 'text-emerald-600', warning: 'text-amber-600', muted: 'text-muted-foreground' };

const ValuationReport = () => {
  const toast = useToast();
  const { totals, byCategory, loading, error, loadedAt, refresh } = useAssetValuation();

  const coverage = useMemo(() => valuationCoverage(totals), [totals]);
  const stance   = useMemo(() => revaluationStance(totals), [totals]);

  const bases = useMemo(() => Object.entries(totals.byBasis || {})
    .map(([basis, agg]) => ({
      basis,
      label: valuationBasisLabel(basis),
      count: Number(agg?.count) || 0,
      value: Number(agg?.value) || 0,
    }))
    .sort((a, b) => b.value - a.value),
  [totals.byBasis]);

  const exportReport = () => {
    if (byCategory.length === 0) { toast.error('There is nothing to export yet.'); return; }
    downloadCSV(
      buildValuationExport(byCategory, totals),
      `asset-valuation-${new Date().toISOString().slice(0, 10)}`,
      VALUATION_EXPORT_COLUMNS,
    );
    toast.success('Valuation report exported.');
  };

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-5 space-y-3">
              <Sk className="h-4 w-24" /><Sk className="h-8 w-32" /><Sk className="h-3 w-20" />
            </div>
          ))}
        </div>
        <Sk className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-red-50 border border-red-200">
          <span className="flex items-center gap-2">
            <Icon name="AlertCircle" size={15} color="#dc2626" />
            <p className="text-xs text-red-700">{error}</p>
          </span>
          <GhostButton icon="RefreshCw" onClick={refresh}>Retry</GhostButton>
        </div>
      )}

      {/* ── The four figures, in the order they must be read ────────────────
          Cost, then what has been charged against it, then what is left, then
          what somebody says it is worth. Presenting the last one first is how a
          valuation report turns into a sales document. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="At cost" value={KES(totals.totalCost)} icon="Receipt" tone="muted"
          hint={`${totals.heldAssets.toLocaleString('en-KE')} asset${totals.heldAssets === 1 ? '' : 's'} still held`}
        />
        <StatCard
          label="Less depreciation" value={KES(totals.totalDepreciation)} icon="TrendingDown" tone="warning"
          hint={totals.totalCost > 0
            ? `${pct(pctOf(totals.totalDepreciation, totals.totalCost))} of cost written down`
            : 'Nothing charged yet'}
        />
        <StatCard
          label="Net book value" value={KES(totals.totalBookValue)} icon="Scale"
          hint="The figure the Balance Sheet defends"
        />
        <StatCard
          label="Current value" value={KES(totals.totalCurrentValue)} icon="LineChart" tone="success"
          hint={totals.valuedAssets > 0
            ? `${pct(coverage.value)} of it from a recorded valuation`
            : 'Nothing valued — this is book value'}
        />
      </div>

      {/* ── What the headline rests on ──────────────────────────────────────
          The most important paragraph on the page, which is why it is a
          paragraph and not a fifth stat card: the number above means nothing
          without it. */}
      <Card
        title="What the current value rests on"
        subtitle={`As at ${fmtDate(loadedAt || new Date())}${totals.lastValuedOn ? ` · last valuation recorded ${fmtDate(totals.lastValuedOn)}` : ''}`}
        actions={(
          <div className="flex items-center gap-2">
            <GhostButton icon="Printer" onClick={() => window.print()}>Print</GhostButton>
            <PrimaryButton icon="Download" onClick={exportReport} disabled={byCategory.length === 0}>
              Export CSV
            </PrimaryButton>
          </div>
        )}
      >
        {totals.heldAssets === 0 ? (
          <EmptyState
            icon="Package"
            title="Nothing to value yet"
            hint="Register the premises, vehicles, computers, furniture and software the SACCO owns, and this report fills itself in."
          />
        ) : (
          <div className="space-y-4">
            {/* Valued vs at book, as one bar. Two numbers that must be seen
                against each other, not in separate cards. */}
            <div>
              <div className="flex items-center justify-between gap-3 mb-1.5 text-xs">
                <span className="text-foreground">
                  <strong>{KES(totals.valuedCurrentValue)}</strong> from{' '}
                  {totals.valuedAssets.toLocaleString('en-KE')} recorded valuation{totals.valuedAssets === 1 ? '' : 's'}
                </span>
                <span className="text-muted-foreground">
                  <strong className="text-foreground">{KES(totals.unvaluedBookValue)}</strong> at book value
                  {' '}({totals.unvaluedAssets.toLocaleString('en-KE')} asset{totals.unvaluedAssets === 1 ? '' : 's'})
                </span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden flex">
                <div className="h-full" style={{ width: `${coverage.value}%`, background: '#34c1dd' }} />
                <div className="h-full flex-1" style={{ background: 'rgba(100,116,139,0.35)' }} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                {totals.valuedAssets === 0
                  ? 'No asset carries a recorded valuation, so every figure in the "current value" column above is book value — cost less the depreciation the period-end job has charged. It is what the ledger will defend, not what anyone would pay.'
                  : `${pct(coverage.assets)} of the assets held carry a recorded valuation, covering ${pct(coverage.value)} of the reported value. The rest is reported at book value.`}
              </p>
            </div>

            {/* Revaluation gap. Only over the valued assets — netting the
                unvalued ones in would report a surplus the SACCO never had. */}
            {stance && (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-3 border-t border-border">
                <span className="text-xs text-muted-foreground">{stance.label}</span>
                <span className={`font-mono text-lg font-semibold ${TONE_TEXT[stance.tone]}`}>
                  {signedKES(stance.delta)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  across the {totals.valuedAssets.toLocaleString('en-KE')} valued asset{totals.valuedAssets === 1 ? '' : 's'},
                  whose book value is {KES(totals.valuedBookValue)}. Not posted — a revaluation is an equity
                  movement and needs its own journal.
                </span>
              </div>
            )}

            {totals.staleValuations > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
                <Icon name="AlertTriangle" size={15} color="#ca8a04" />
                <p className="text-xs text-amber-800">
                  <strong>{totals.staleValuations}</strong> valuation
                  {totals.staleValuations === 1 ? ' is' : 's are'} over a year old. This report is quoting them as
                  today&apos;s value; revalue those assets, or say so when you present it.
                </p>
              </div>
            )}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ── By category ──────────────────────────────────────────────────── */}
        <Card
          title="Value by category"
          subtitle="Every asset the SACCO still holds, grouped the way the chart of accounts groups them"
          className="lg:col-span-2"
        >
          {byCategory.length === 0 ? (
            <EmptyState icon="PieChart" title="Nothing registered yet"
              hint="Categories appear here as assets are added to the register." />
          ) : (
            <>
              <Table columns={['Category', 'Assets', 'At cost', 'Depreciation', 'Book value', 'Current value', 'Share', 'Revaluation']}>
                {byCategory.map((r) => {
                  const meta = categoryMeta(r.category);
                  const shareOfValue = pctOf(r.totalCurrentValue, totals.totalCurrentValue);
                  return (
                    <tr key={r.category} className="border-b border-border/60 last:border-0">
                      <td className="py-2.5 pr-4">
                        <span className="flex items-center gap-2 text-sm text-foreground whitespace-nowrap">
                          <Icon name={meta.icon} size={14} color="#1da8c5" />
                          {categoryLabel(r.category)}
                        </span>
                        {/* Named per row, not only in a footnote: a category
                            whose "current value" is entirely book value must not
                            look like one that has been to a valuer. */}
                        <span className="block text-[10px] text-muted-foreground ml-6">
                          {r.valuedCount === 0
                            ? 'none valued — at book value'
                            : `${r.valuedCount} of ${r.assetCount} valued${r.staleCount > 0 ? ` · ${r.staleCount} stale` : ''}`}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-muted-foreground">{r.assetCount.toLocaleString('en-KE')}</td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-right whitespace-nowrap">{KES(r.totalCost)}</td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-right whitespace-nowrap text-muted-foreground">{KES(r.totalDepreciation)}</td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-right whitespace-nowrap text-muted-foreground">{KES(r.totalBookValue)}</td>
                      <td className="py-2.5 pr-4 font-mono text-xs text-right whitespace-nowrap font-semibold text-foreground">{KES(r.totalCurrentValue)}</td>
                      <td className="py-2.5 pr-4 whitespace-nowrap">
                        <span className="flex items-center gap-2">
                          <span className="w-14 h-1.5 rounded-full bg-muted overflow-hidden">
                            <span className="block h-full rounded-full" style={{ width: `${shareOfValue}%`, background: '#34c1dd' }} />
                          </span>
                          <span className="font-mono text-[11px] text-muted-foreground">{pct(shareOfValue)}</span>
                        </span>
                      </td>
                      <td className={`py-2.5 font-mono text-xs text-right whitespace-nowrap ${
                        r.valuedCount === 0 ? 'text-muted-foreground'
                          : r.revaluationDelta > 0 ? TONE_TEXT.success
                          : r.revaluationDelta < 0 ? TONE_TEXT.warning : 'text-muted-foreground'}`}>
                        {r.valuedCount === 0 ? '—' : signedKES(r.revaluationDelta)}
                      </td>
                    </tr>
                  );
                })}

                {/* THE TOTAL ROW IS THE SERVER'S, not a sum of the rows above.
                    They come from two aggregates over the same set and should
                    agree — and where they cannot, the whole-book figure is the
                    one that is right. */}
                <tr className="border-t-2 border-border">
                  <td className="py-2.5 pr-4 text-sm font-semibold text-foreground">Total</td>
                  <td className="py-2.5 pr-4 font-mono text-xs font-semibold text-foreground">{totals.heldAssets.toLocaleString('en-KE')}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-right font-semibold text-foreground whitespace-nowrap">{KES(totals.totalCost)}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-right font-semibold text-foreground whitespace-nowrap">{KES(totals.totalDepreciation)}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-right font-semibold text-foreground whitespace-nowrap">{KES(totals.totalBookValue)}</td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-right font-semibold text-foreground whitespace-nowrap">{KES(totals.totalCurrentValue)}</td>
                  <td className="py-2.5 pr-4 font-mono text-[11px] text-muted-foreground">100.0%</td>
                  <td className={`py-2.5 font-mono text-xs text-right font-semibold whitespace-nowrap ${
                    totals.valuedAssets === 0 ? 'text-muted-foreground' : TONE_TEXT[stance?.tone] || 'text-foreground'}`}>
                    {totals.valuedAssets === 0 ? '—' : signedKES(totals.revaluationDelta)}
                  </td>
                </tr>
              </Table>

              <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
                Disposed, written-off and lost assets are excluded — this is what the SACCO holds today, not what it
                has ever owned. Categories map to the same asset accounts the Balance Sheet&apos;s Property, Plant &amp;
                Equipment line is built from.
              </p>
            </>
          )}
        </Card>

        {/* ── What the valuations rest on ──────────────────────────────────── */}
        <div className="space-y-5">
          <Card title="Basis of valuation" subtitle="Who says so, and for how much">
            {bases.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center leading-relaxed">
                No valuations recorded. Open an asset and record what it is worth today — the register keeps the
                date and the basis beside the figure, so a stale valuation identifies itself.
              </p>
            ) : (
              <div className="space-y-3">
                {bases.map((b) => (
                  <div key={b.basis}>
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <span className="text-xs text-foreground">
                        {b.label}
                        <span className="text-muted-foreground"> · {b.count}</span>
                      </span>
                      <span className="font-mono text-xs text-foreground">{KES(b.value)}</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full"
                        style={{ width: `${pctOf(b.value, totals.valuedCurrentValue)}%`, background: '#34c1dd' }} />
                    </div>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground pt-1 leading-relaxed">
                  A professional valuation and an internal estimate are not the same claim. Where the two are mixed,
                  say which is which when the figure is presented.
                </p>
              </div>
            )}
          </Card>

          <div className="rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon name="Info" size={14} color="#1da8c5" />
              <h4 className="text-xs font-bold uppercase tracking-wide text-foreground">How this report is built</h4>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Every figure is aggregated over the whole register in the database, not over the page of assets in the
              Register tab — filtering or paging that list cannot change a number here.{' '}
              <strong className="text-foreground">Current value</strong> is each asset&apos;s recorded valuation where
              there is one and its book value where there is not, which is the same rule the register rows follow.
              Recording a valuation never posts to the ledger.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ValuationReport;

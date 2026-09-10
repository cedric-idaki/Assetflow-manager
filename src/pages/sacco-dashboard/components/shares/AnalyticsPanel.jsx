import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import { supabase } from '../../../../lib/supabase';
import { fetchAllRows } from '../../../../lib/fetchAllRows';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Card, StatCard, Table, EmptyState, Select, KES } from '../_shared';
import { KESshort, pct, int, num } from './_util';

const RANGES = [
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 90 days' },
  { id: '365', label: 'Last 12 months' },
  { id: 'all', label: 'All time' },
];

// A calm categorical ramp — one hue family so the pie reads as one dataset.
const SLICE = ['#1da8c5', '#34c1dd', '#67d3e8', '#9ae1ef', '#0e7d94', '#0a5f70', '#94a3b8'];

const CHART_TOOLTIP = {
  backgroundColor: 'var(--color-card)',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
};

/**
 * Share analytics: price history, trading volume, who holds what, where the
 * treasury has been, and how dividends have accumulated.
 *
 * Everything is derived from the share ledger the engine writes, so a chart and
 * a report can never tell different stories.
 */
const AnalyticsPanel = ({ ctx, ov }) => {
  const {
    sharePrices = [], transfers = [], shares = [], members = [],
    dividends = [],
  } = ctx;
  const [range, setRange] = useState('90');

  const since = useMemo(() => {
    if (range === 'all') return null;
    const d = new Date();
    d.setDate(d.getDate() - parseInt(range, 10));
    return d.toISOString().slice(0, 10);
  }, [range]);

  /**
   * The share ledger for the selected window, read from Postgres.
   *
   * These series used to filter the dashboard's shareTxns array, which holds
   * the newest 1,000 rows. The range picker then narrowed THAT — so "All time"
   * on an active sacco silently began at whenever row 1,000 fell, and every
   * chart, top-buyer table and treasury line started mid-history with nothing
   * saying so. Fetching by the window makes the range mean what it says, and
   * costs less than holding the whole ledger for a 30-day view.
   */
  const [shareTxns, setShareTxns] = useState([]);
  const [txnsLoading, setTxnsLoading] = useState(true);
  const [txnsError, setTxnsError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setTxnsLoading(true);
    setTxnsError(null);

    (async () => {
      try {
        const rows = await fetchAllRows(() => {
          const q = supabase.from('sacco_share_transactions').select('*');
          return (since ? q.gte('created_at', since) : q).order('created_at', { ascending: false });
        });
        if (!cancelled) setShareTxns(rows);
      } catch (e) {
        if (!cancelled) { setShareTxns([]); setTxnsError(e?.message || 'Could not load the share ledger.'); }
      } finally {
        if (!cancelled) setTxnsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [since]);

  // The window is applied by the query now; this stays for rows that carry
  // their own dates from elsewhere (transfers, dividends).
  const inRange = (d) => !since || String(d || '').slice(0, 10) >= since;

  const memberName = (id) => members.find((m) => m.id === id)?.full_name || '—';

  // ── Price + market cap over time ─────────────────────────────────────────
  const priceSeries = useMemo(() => [...sharePrices]
    .filter((p) => inRange(p.effective_date))
    .reverse()
    .map((p) => ({
      date: String(p.effective_date).slice(5),
      price: num(p.market_value),
      cap: num(p.market_value) * ov.totalIssued,
    })), [sharePrices, since, ov.totalIssued]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Trading volume by day ────────────────────────────────────────────────
  const volumeSeries = useMemo(() => {
    const byDay = new Map();
    transfers
      .filter((t) => t.status === 'settled' && inRange(t.settled_at || t.created_at))
      .forEach((t) => {
        const k = String(t.settled_at || t.created_at).slice(0, 10);
        const row = byDay.get(k) || { date: k, shares: 0, value: 0, trades: 0 };
        row.shares += int(t.shares);
        row.value += num(t.price);
        row.trades += 1;
        byDay.set(k, row);
      });
    return [...byDay.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ ...r, date: r.date.slice(5) }));
  }, [transfers, since]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Ownership concentration ──────────────────────────────────────────────
  const topHolders = useMemo(() => [...shares]
    .filter((r) => int(r.shares_held) > 0)
    .sort((a, b) => int(b.shares_held) - int(a.shares_held))
    .slice(0, 10)
    .map((r) => ({
      name: (r.member?.full_name || memberName(r.member_id)).split(' ')[0],
      fullName: r.member?.full_name || memberName(r.member_id),
      shares: int(r.shares_held),
      value: int(r.shares_held) * ov.effective,
      ownership: ov.totalIssued > 0 ? (int(r.shares_held) / ov.totalIssued) * 100 : 0,
    })), [shares, ov.effective, ov.totalIssued, members]); // eslint-disable-line react-hooks/exhaustive-deps

  const concentration = useMemo(() => {
    const held = [...shares].map((r) => int(r.shares_held)).filter((n) => n > 0).sort((a, b) => b - a);
    const total = held.reduce((s, n) => s + n, 0) || 1;
    const topN = (n) => (held.slice(0, n).reduce((s, x) => s + x, 0) / total) * 100;
    return { top1: topN(1), top5: topN(5), top10: topN(10) };
  }, [shares]);

  const ownershipPie = useMemo(() => {
    const slices = topHolders.slice(0, 6).map((h) => ({ name: h.fullName, value: h.shares }));
    const named = slices.reduce((s, x) => s + x.value, 0);
    const others = ov.memberOwned - named;
    if (others > 0) slices.push({ name: 'All other members', value: others });
    if (ov.treasuryPool > 0) slices.push({ name: 'SACCO Treasury', value: ov.treasuryPool });
    return slices;
  }, [topHolders, ov.memberOwned, ov.treasuryPool]);

  // ── Biggest buyers and sellers ───────────────────────────────────────────
  const traders = useMemo(() => {
    const map = new Map();
    shareTxns
      .filter((t) => t.member_id && inRange(t.created_at) && ['purchase', 'sale'].includes(t.txn_type))
      .forEach((t) => {
        const row = map.get(t.member_id) || { id: t.member_id, bought: 0, sold: 0, boughtValue: 0, soldValue: 0, trades: 0 };
        if (t.txn_type === 'purchase') { row.bought += int(t.shares); row.boughtValue += num(t.amount); }
        else { row.sold += Math.abs(int(t.shares)); row.soldValue += num(t.amount); }
        row.trades += 1;
        map.set(t.member_id, row);
      });
    return [...map.values()].map((r) => ({
      ...r, name: shares.find((s) => s.member_id === r.id)?.member?.full_name || memberName(r.id),
    }));
  }, [shareTxns, since, shares, members]); // eslint-disable-line react-hooks/exhaustive-deps

  const topBuyers = [...traders].filter((t) => t.bought > 0).sort((a, b) => b.bought - a.bought).slice(0, 5);
  const topSellers = [...traders].filter((t) => t.sold > 0).sort((a, b) => b.sold - a.sold).slice(0, 5);

  // ── Treasury balance over time ───────────────────────────────────────────
  const treasurySeries = useMemo(() => [...shareTxns]
    .filter((t) => t.is_treasury && inRange(t.created_at))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((t) => ({
      date: String(t.created_at).slice(5, 10),
      pool: int(t.balance_after),
    })), [shareTxns, since]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dividend history ─────────────────────────────────────────────────────
  const dividendSeries = useMemo(() => [...dividends]
    .filter((d) => d.status === 'paid' || d.status === 'calculated')
    .sort((a, b) => String(a.record_date).localeCompare(String(b.record_date)))
    .map((d) => ({
      period: d.period_label,
      total: num(d.total_payable),
      perShare: num(d.dividend_per_share),
    })), [dividends]);

  const rangedTrades = transfers.filter((t) => t.status === 'settled' && inRange(t.settled_at || t.created_at));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Every chart is built from the share ledger, so the numbers here and in the reports are the same numbers.
        </p>
        <div className="w-full sm:w-48">
          <Select value={range} onChange={(e) => setRange(e.target.value)}>
            {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </Select>
        </div>
      </div>

      {/* Flat charts while the ledger is still arriving read as "no trading
          happened", which is exactly the wrong conclusion to draw. */}
      {txnsLoading && (
        <p className="text-xs text-muted-foreground">Loading the share ledger for this period…</p>
      )}
      {txnsError && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-destructive/30 bg-destructive/10">
          <Icon name="AlertTriangle" size={15} color="#dc2626" className="mt-0.5 shrink-0" />
          <p className="text-xs text-foreground">
            Trading charts could not be built for this period, so they are showing empty rather than partial. {txnsError}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Trades in period" value={rangedTrades.length.toLocaleString()} icon="ArrowLeftRight" tone="primary" />
        <StatCard label="Volume traded" value={`${rangedTrades.reduce((s, t) => s + int(t.shares), 0).toLocaleString()}`}
          icon="Layers" tone="muted" hint="shares" />
        <StatCard label="Value traded" value={KESshort(rangedTrades.reduce((s, t) => s + num(t.price), 0))} icon="Wallet" tone="success" />
        <StatCard label="Top holder stake" value={pct(concentration.top1, 1)} icon="Crown" tone="muted"
          hint={`Top 5 hold ${pct(concentration.top5, 1)}`} />
      </div>

      {/* Price + capitalisation */}
      <Card title="Share price and market capitalisation">
        {priceSeries.length === 0 ? (
          <EmptyState icon="TrendingUp" title="No price history in this period"
            hint="Publish the share price daily to build the trend members watch." />
        ) : (
          <div className="w-full h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={priceSeries}>
                <defs>
                  <linearGradient id="anPrice" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1da8c5" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="#1da8c5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" stroke="var(--color-muted-foreground)" fontSize={12} />
                <YAxis yAxisId="p" stroke="var(--color-muted-foreground)" fontSize={12} width={78} tickFormatter={KESshort} />
                <YAxis yAxisId="c" orientation="right" stroke="var(--color-muted-foreground)" fontSize={12} width={78} tickFormatter={KESshort} />
                <Tooltip contentStyle={CHART_TOOLTIP} formatter={(v, n) => [KES(v), n === 'price' ? 'Share price' : 'Market cap']} />
                <Legend formatter={(v) => (v === 'price' ? 'Share price' : 'Market capitalisation')} />
                <Area yAxisId="p" type="monotone" dataKey="price" stroke="#1da8c5" strokeWidth={2} fill="url(#anPrice)" />
                <Area yAxisId="c" type="monotone" dataKey="cap" stroke="#94a3b8" strokeWidth={1.5} fill="none" strokeDasharray="4 3" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Trading volume */}
        <Card title="Trading volume" subtitle="Shares changing hands, by day">
          {volumeSeries.length === 0 ? (
            <EmptyState icon="BarChart3" title="No trades in this period" />
          ) : (
            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={volumeSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="date" stroke="var(--color-muted-foreground)" fontSize={12} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={12} width={56} />
                  <Tooltip contentStyle={CHART_TOOLTIP}
                    formatter={(v, n) => (n === 'shares' ? [`${v.toLocaleString()} shares`, 'Volume'] : [KES(v), 'Value'])} />
                  <Bar dataKey="shares" fill="#34c1dd" radius={[4, 4, 0, 0]} name="shares" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Ownership split */}
        <Card title="Ownership" subtitle="Who holds the shares in issue">
          {ownershipPie.length === 0 || ov.totalIssued === 0 ? (
            <EmptyState icon="PieChart" title="No shares in issue" />
          ) : (
            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={ownershipPie} dataKey="value" nameKey="name" cx="50%" cy="50%"
                    innerRadius={52} outerRadius={92} paddingAngle={1.5}>
                    {ownershipPie.map((entry, i) => (
                      <Cell key={entry.name}
                        fill={entry.name === 'SACCO Treasury' ? '#64748b' : SLICE[i % SLICE.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={CHART_TOOLTIP}
                    formatter={(v, n) => [`${v.toLocaleString()} shares (${pct((v / ov.totalIssued) * 100, 1)})`, n]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Top shareholders */}
        <Card title="Top shareholders">
          {topHolders.length === 0 ? (
            <EmptyState icon="Users" title="No shareholders yet" />
          ) : (
            <Table columns={['#', 'Member', 'Shares', 'Value', 'Ownership']}>
              {topHolders.map((h, i) => (
                <tr key={h.fullName + i} className="border-b border-border/60">
                  <td className="py-2.5 pr-4 text-muted-foreground">{i + 1}</td>
                  <td className="py-2.5 pr-4 font-medium text-foreground">{h.fullName}</td>
                  <td className="py-2.5 pr-4 text-foreground">{h.shares.toLocaleString()}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{KES(h.value)}</td>
                  <td className="py-2.5 pr-4 font-semibold text-foreground">{pct(h.ownership, 2)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        {/* Treasury balance */}
        <Card title="Treasury balance" subtitle="The society's own pool over time">
          {treasurySeries.length === 0 ? (
            <EmptyState icon="Landmark" title="No treasury movements in this period" />
          ) : (
            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={treasurySeries}>
                  <defs>
                    <linearGradient id="anTreas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#64748b" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#64748b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="date" stroke="var(--color-muted-foreground)" fontSize={12} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={12} width={64} />
                  <Tooltip contentStyle={CHART_TOOLTIP} formatter={(v) => [`${v.toLocaleString()} shares`, 'Treasury pool']} />
                  <Area type="stepAfter" dataKey="pool" stroke="#64748b" strokeWidth={2} fill="url(#anTreas)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card title="Largest buyers" subtitle="In the selected period">
          {topBuyers.length === 0 ? (
            <EmptyState icon="ArrowDownLeft" title="No purchases in this period" />
          ) : (
            <Table columns={['Member', 'Shares bought', 'Value', 'Trades']}>
              {topBuyers.map((t) => (
                <tr key={t.id} className="border-b border-border/60">
                  <td className="py-2.5 pr-4 font-medium text-foreground">{t.name}</td>
                  <td className="py-2.5 pr-4 text-emerald-600 font-semibold">+{t.bought.toLocaleString()}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{KES(t.boughtValue)}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{t.trades}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Largest sellers" subtitle="In the selected period">
          {topSellers.length === 0 ? (
            <EmptyState icon="ArrowUpRight" title="No sales in this period" />
          ) : (
            <Table columns={['Member', 'Shares sold', 'Value', 'Trades']}>
              {topSellers.map((t) => (
                <tr key={t.id} className="border-b border-border/60">
                  <td className="py-2.5 pr-4 font-medium text-foreground">{t.name}</td>
                  <td className="py-2.5 pr-4 text-red-600 font-semibold">−{t.sold.toLocaleString()}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{KES(t.soldValue)}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{t.trades}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      {/* Dividend history */}
      <Card title="Dividend history" subtitle="Declared and paid, by period">
        {dividendSeries.length === 0 ? (
          <EmptyState icon="Coins" title="No dividends declared yet"
            hint="Declared dividends appear here once they have been calculated." />
        ) : (
          <div className="w-full h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dividendSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="period" stroke="var(--color-muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={12} width={78} tickFormatter={KESshort} />
                <Tooltip contentStyle={CHART_TOOLTIP} formatter={(v) => [KES(v), 'Total dividend']} />
                <Bar dataKey="total" fill="#059669" radius={[4, 4, 0, 0]} name="total" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
};

export default AnalyticsPanel;

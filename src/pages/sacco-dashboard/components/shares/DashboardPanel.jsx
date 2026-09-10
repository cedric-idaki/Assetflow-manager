import React, { useMemo, useState } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { useToast } from '../../../../components/Toast';
import Icon from '../../../../components/AppIcon';
import {
  Card, StatCard, PrimaryButton, GhostButton, Modal, Field, TextInput, NumberInput,
  EmptyState, KES, fmtDate,
} from '../_shared';
import {
  KESshort, pct, gainTone, gainSign, marketIsOpen, withDefaults, today, num,
  withholdingOverview,
} from './_util';

/**
 * The ten-second read: what the whole share market looks like right now.
 * Nine headline numbers, the price trend, and the two things that need a human
 * (pending approvals, an uncalculated dividend).
 */
const DashboardPanel = ({ ctx, ov, onNavigate }) => {
  const { sharePrices = [], shareSettings, setMarketValue, sacco, withholdings = [] } = ctx;
  const toast = useToast();
  const s = withDefaults(shareSettings);

  const [priceOpen, setPriceOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [priceForm, setPriceForm] = useState({ market_value: '', effective_date: today(), note: '' });
  const setPF = (k, v) => setPriceForm((p) => ({ ...p, [k]: v }));

  // Shares out of circulation are part of the ten-second read: they are stock
  // the society controls but nobody can trade.
  const wo = useMemo(
    () => withholdingOverview(withholdings, ov.effective, ov.totalIssued),
    [withholdings, ov.effective, ov.totalIssued],
  );

  const series = useMemo(
    () => [...sharePrices].reverse().map((p) => ({
      date: String(p.effective_date || '').slice(5),
      value: num(p.market_value),
    })),
    [sharePrices],
  );

  const savePrice = async () => {
    if (!(parseFloat(priceForm.market_value) >= 0)) { toast.error('Enter a market value.'); return; }
    setSaving(true);
    try {
      await setMarketValue(priceForm);
      toast.success('Market value published — every member sees it now.');
      setPriceOpen(false);
      setPriceForm({ market_value: '', effective_date: today(), note: '' });
    } catch (e) { toast.error(e.message || 'Could not publish.'); } finally { setSaving(false); }
  };

  const open = marketIsOpen(shareSettings);
  const asOf = sharePrices[0]?.effective_date;

  return (
    <div className="space-y-6">
      {/* Market state banner — the one thing that changes how everything else behaves */}
      <div className={`flex flex-wrap items-center gap-3 p-4 rounded-xl border ${
        s.trading_suspended ? 'bg-red-50 border-red-200'
          : open ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
        <span className="relative flex h-2.5 w-2.5">
          {open && !s.trading_suspended && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
            s.trading_suspended ? 'bg-red-500' : open ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        </span>
        <div className="flex-1 min-w-[200px]">
          <p className="text-sm font-semibold text-foreground">
            {s.trading_suspended ? 'Trading suspended' : open ? 'Market open' : 'Market closed'}
          </p>
          <p className="text-xs text-muted-foreground">
            {s.trading_suspended
              ? (s.suspension_reason || 'No trades can be placed or matched.')
              : open
                ? `Orders match ${s.auto_settle && !s.require_transfer_approval ? 'and settle automatically' : 'and wait for your approval'}.`
                : `Members can trade ${String(s.market_open_time).slice(0, 5)}–${String(s.market_close_time).slice(0, 5)}.`}
          </p>
        </div>
        <GhostButton icon="Settings" onClick={() => onNavigate('settings')}>Trading controls</GhostButton>
      </div>

      {/* The nine headline numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard label="Total shares issued" value={ov.totalIssued.toLocaleString()} icon="Layers" tone="primary"
          hint={`${ov.shareholders} shareholder${ov.shareholders === 1 ? '' : 's'}`} />
        <StatCard label="Treasury shares" value={ov.treasuryPool.toLocaleString()} icon="Landmark" tone="muted"
          hint={ov.totalIssued > 0 ? `${pct((ov.treasuryPool / ov.totalIssued) * 100, 1)} of the issue` : 'No shares issued'} />
        <StatCard label="Member-owned shares" value={ov.memberOwned.toLocaleString()} icon="Users" tone="muted"
          hint={ov.totalIssued > 0 ? `${pct((ov.memberOwned / ov.totalIssued) * 100, 1)} of the issue` : '—'} />
        <StatCard label="Current share price" value={ov.price > 0 ? KES(ov.price) : '—'} icon="TrendingUp" tone="primary"
          hint={asOf ? `As of ${fmtDate(asOf)}` : 'Not published yet'} />
        <StatCard label="Market capitalisation" value={KESshort(ov.marketCap)} icon="Building2" tone="success"
          hint={KES(ov.marketCap)} />
        <StatCard label="Today's trades" value={ov.todaysTrades.length.toLocaleString()} icon="ArrowLeftRight" tone="primary"
          hint={ov.todaysTrades.length > 0 ? `${ov.todaysVolume.toLocaleString()} shares · ${KESshort(ov.todaysValue)}` : 'No trades yet today'} />
        <StatCard label="Pending transfers" value={ov.pendingTransfers.length.toLocaleString()}
          icon="Clock" tone={ov.pendingTransfers.length > 0 ? 'warning' : 'muted'}
          hint={ov.pendingTransfers.length > 0 ? 'Waiting for approval' : 'Nothing awaiting you'} />
        <StatCard label="Dividend rate" value={ov.liveDividend ? pct(ov.dividendRate, 2) : '—'} icon="Percent" tone="success"
          hint={ov.liveDividend ? `${ov.liveDividend.period_label} · ${ov.liveDividend.status}` : 'None declared'} />
        <StatCard label="Dividend payable" value={KESshort(ov.dividendPayable)} icon="Wallet"
          tone={ov.dividendPayable > 0 ? 'warning' : 'muted'}
          hint={ov.dividendPayable > 0 ? KES(ov.dividendPayable) : 'Nothing outstanding'} />
        <StatCard label="Open orders" value={ov.openOrders.length.toLocaleString()} icon="Store" tone="muted"
          hint={`${ov.buyOrders.length} bid · ${ov.sellOrders.length} ask`} />
        <button onClick={() => onNavigate('withholding')} className="text-left">
          <StatCard label="Shares withheld" value={wo.outstanding.toLocaleString()} icon="Lock"
            tone={wo.outstanding > 0 ? 'warning' : 'muted'}
            hint={wo.outstanding > 0
              ? `${KESshort(wo.value)} · ${wo.members} member${wo.members === 1 ? '' : 's'}`
              : 'Nothing held back'} />
        </button>
      </div>

      {/* Anything that needs a human */}
      {(ov.pendingTransfers.length > 0
        || (ov.liveDividend && ov.liveDividend.status === 'declared')
        || ov.price <= 0) && (
        <Card title="Needs your attention">
          <div className="space-y-2">
            {ov.price <= 0 && (
              <button onClick={() => setPriceOpen(true)}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted transition-all text-left">
                <Icon name="TrendingUp" size={16} color="#ca8a04" />
                <span className="flex-1 text-sm text-foreground">No market value has been published — members cannot value their holdings.</span>
                <span className="text-xs font-semibold text-primary">Set today's value</span>
              </button>
            )}
            {ov.pendingTransfers.length > 0 && (
              <button onClick={() => onNavigate('marketplace')}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted transition-all text-left">
                <Icon name="Clock" size={16} color="#ca8a04" />
                <span className="flex-1 text-sm text-foreground">
                  {ov.pendingTransfers.length} transfer{ov.pendingTransfers.length === 1 ? '' : 's'} waiting for approval.
                </span>
                <span className="text-xs font-semibold text-primary">Review</span>
              </button>
            )}
            {ov.liveDividend?.status === 'declared' && (
              <button onClick={() => onNavigate('dividends')}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted transition-all text-left">
                <Icon name="Coins" size={16} color="#1da8c5" />
                <span className="flex-1 text-sm text-foreground">
                  {ov.liveDividend.period_label} is declared but not yet calculated — members have no figure to see.
                </span>
                <span className="text-xs font-semibold text-primary">Calculate</span>
              </button>
            )}
          </div>
        </Card>
      )}

      {/* Price + trend */}
      <Card
        title="Share price"
        subtitle={asOf ? `Published for ${fmtDate(asOf)}` : 'No market value published yet'}
        actions={<PrimaryButton icon="TrendingUp" onClick={() => setPriceOpen(true)}>Set today's value</PrimaryButton>}
      >
        <div className="flex flex-wrap items-end gap-x-10 gap-y-3 mb-5">
          <div>
            <p className="text-4xl font-bold text-foreground">{ov.price > 0 ? KES(ov.price) : '—'}</p>
            {ov.hasPrevPrice && (
              <p className={`text-sm font-semibold mt-1 ${gainTone(ov.priceDelta)}`}>
                {ov.priceDelta > 0 ? '▲' : ov.priceDelta < 0 ? '▼' : '■'} {KES(Math.abs(ov.priceDelta))} vs previous
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Par value</p>
            <p className="text-lg font-semibold text-foreground">{KES(s.par_value)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Premium over par</p>
            <p className={`text-lg font-semibold ${gainTone(ov.price - num(s.par_value))}`}>
              {ov.price > 0 && num(s.par_value) > 0
                ? `${gainSign(ov.price - num(s.par_value))}${pct(((ov.price - num(s.par_value)) / num(s.par_value)) * 100, 1)}`
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Lifetime traded</p>
            <p className="text-lg font-semibold text-foreground">{ov.tradedVolume.toLocaleString()} shares</p>
          </div>
        </div>

        {series.length === 0 ? (
          <EmptyState icon="TrendingUp" title="No price history yet"
            hint="Publish a value with “Set today's value” — each day builds the trend members watch." />
        ) : (
          <div className="w-full h-64" aria-label="Share price history">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                <defs>
                  <linearGradient id="sharePriceFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34c1dd" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#34c1dd" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" stroke="var(--color-muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={12} width={80} tickFormatter={(v) => KESshort(v)} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '8px' }}
                  formatter={(v) => [KES(v), 'Share price']}
                />
                <Area type="monotone" dataKey="value" stroke="#1da8c5" strokeWidth={2}
                  fill="url(#sharePriceFill)" dot={{ r: 2 }} name="Share price" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Publish market value */}
      <Modal open={priceOpen} onClose={() => setPriceOpen(false)} title="Publish the share price"
        footer={<>
          <GhostButton onClick={() => setPriceOpen(false)}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={savePrice} disabled={saving}>{saving ? 'Publishing…' : 'Publish'}</PrimaryButton>
        </>}>
        <p className="text-sm text-muted-foreground mb-4">
          This is the live value every member sees on their portfolio, and the default price on new orders.
          Re-publishing for a date you already set overwrites it.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Share price (KES) *">
            <NumberInput value={priceForm.market_value} onChange={(e) => setPF('market_value', e.target.value)}
              placeholder={ov.price > 0 ? String(ov.price) : String(s.par_value)} />
          </Field>
          <Field label="Effective date">
            <TextInput type="date" value={priceForm.effective_date} onChange={(e) => setPF('effective_date', e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Note (optional)">
              <TextInput value={priceForm.note} onChange={(e) => setPF('note', e.target.value)} placeholder="e.g. AGM revaluation" />
            </Field>
          </div>
        </div>
        {parseFloat(priceForm.market_value) > 0 && ov.totalIssued > 0 && (
          <p className="text-xs text-muted-foreground mt-3">
            At {KES(priceForm.market_value)} the society is capitalised at{' '}
            <strong className="text-foreground">{KES(ov.totalIssued * parseFloat(priceForm.market_value))}</strong>
            {' '}across {ov.totalIssued.toLocaleString()} shares
            {sacco?.name ? ` in ${sacco.name}` : ''}.
          </p>
        )}
      </Modal>
    </div>
  );
};

export default DashboardPanel;

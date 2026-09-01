import React, { useMemo, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useToast } from '../../../components/Toast';
import Icon from '../../../components/AppIcon';
import {
  Card, StatCard, Badge, Table, EmptyState, PrimaryButton, GhostButton,
  Modal, Field, NumberInput, TextInput, Select, KES, fmtDate,
} from '../../sacco-dashboard/components/_shared';
import {
  KESshort, pct, int, num, gainTone, gainSign, remaining, withDefaults,
  marketIsOpen, memberPosition, TXN_LABELS, printCertificate,
  memberWithholding, reasonLabel, outstanding, onMarket,
} from '../../sacco-dashboard/components/shares/_util';

const SUB_TABS = [
  { id: 'portfolio', label: 'Portfolio',    icon: 'PieChart' },
  { id: 'market',    label: 'Market',       icon: 'Store' },
  { id: 'orders',    label: 'My orders',    icon: 'ListOrdered' },
  { id: 'dividends', label: 'Dividends',    icon: 'Coins' },
  { id: 'certs',     label: 'Certificates', icon: 'Award' },
  { id: 'history',   label: 'History',      icon: 'History' },
];

const emptyOrder = { side: 'sell', shares: '', price_per_share: '', expiry_date: '' };

/**
 * The member's investment app: what they own, what it is worth, what they can
 * buy and sell, what the society has paid them, and every certificate.
 *
 * Nothing here mutates ownership — every button calls the share engine, which
 * checks the rules and settles the trade in one transaction.
 */
const SharesTab = ({ ctx }) => {
  const {
    me, sacco, shares, sharePrices = [], currentMarketValue = 0,
    saccoTotals = { totalShares: 0 }, listings = [], transfers = [], members = [],
    shareSettings, shareTxns = [], certificates = [], dividends = [],
    dividendAllocations = [], treasury, myWithholdings = [],
    createListing, cancelListing, updateListing, buyListing, transferShares, exportCSV,
  } = ctx;
  const toast = useToast();
  const s = withDefaults(shareSettings);
  const [tab, setTab] = useState('portfolio');

  const [orderOpen, setOrderOpen] = useState(false);
  const [orderForm, setOrderForm] = useState(emptyOrder);
  const [editing, setEditing] = useState(null);
  const [buying, setBuying] = useState(null);
  const [buyQty, setBuyQty] = useState('');
  const [xferOpen, setXferOpen] = useState(false);
  const [xferForm, setXferForm] = useState({ to_member: '', shares: '', reason: '' });
  const [saving, setSaving] = useState(false);

  const setO = (k, v) => setOrderForm((p) => ({ ...p, [k]: v }));
  const setX = (k, v) => setXferForm((p) => ({ ...p, [k]: v }));

  // ── My position ───────────────────────────────────────────────────────────
  const treasuryPool = int(treasury?.treasury_shares);
  const totalIssued = saccoTotals.totalShares + treasuryPool;
  const par = num(shares?.par_value) || num(s.par_value);
  const price = currentMarketValue > 0 ? currentMarketValue : par;
  const pos = memberPosition(shares, price, totalIssued || saccoTotals.totalShares);
  const open = marketIsOpen(shareSettings);
  // Shares the society is holding back from me. Already excluded from pos.free
  // by memberPosition — this is so the member can see WHY, rather than finding
  // out when a sell is refused.
  const withheld = memberWithholding(myWithholdings, me?.id);
  const asOf = sharePrices[0]?.effective_date;

  const priceSeries = useMemo(() => [...sharePrices].reverse().map((p) => ({
    date: String(p.effective_date || '').slice(5),
    value: num(p.market_value),
    mine: num(p.market_value) * pos.held,
  })), [sharePrices, pos.held]);

  const myOrders = listings.filter((l) => l.seller_member_id === me?.id || l.buyer_member_id === me?.id);
  const liveOrders = myOrders.filter((l) => l.status === 'open');
  const marketSells = listings.filter((l) => (l.side || 'sell') === 'sell' && l.status === 'open' && l.seller_member_id !== me?.id)
    .sort((a, b) => num(a.price_per_share) - num(b.price_per_share));
  const marketBuys = listings.filter((l) => l.side === 'buy' && l.status === 'open' && l.buyer_member_id !== me?.id)
    .sort((a, b) => num(b.price_per_share) - num(a.price_per_share));

  const myAllocations = dividendAllocations
    .map((a) => ({ ...a, declaration: dividends.find((d) => d.id === a.declaration_id) }))
    .sort((a, b) => String(b.declaration?.record_date || '').localeCompare(String(a.declaration?.record_date || '')));
  const dividendsPaid = myAllocations.filter((a) => a.status === 'paid').reduce((t, a) => t + num(a.net_amount), 0);
  const dividendsPending = myAllocations.filter((a) => a.status === 'pending').reduce((t, a) => t + num(a.net_amount), 0);
  // What the current declaration would be worth if it were calculated today.
  const upcoming = dividends.find((d) => d.status === 'declared');
  const projected = upcoming && saccoTotals.totalShares > 0
    ? (upcoming.basis === 'per_share'
      ? num(upcoming.dividend_per_share) * pos.held
      : (num(upcoming.profit_amount) * num(upcoming.dividend_percent) / 100) * (pos.held / saccoTotals.totalShares))
    : 0;

  const activeCert = certificates.find((c) => c.status === 'active');
  const votes = num(s.votes_per_share) > 0 ? Math.floor(pos.held * num(s.votes_per_share)) : 1;

  const blocked = (() => {
    if (s.trading_suspended) return s.suspension_reason || 'Trading is suspended by the society.';
    if (pos.frozen) return shares?.freeze_reason || 'Your holding is frozen.';
    if (!open) return `The market is closed. It trades ${String(s.market_open_time).slice(0, 5)}–${String(s.market_close_time).slice(0, 5)}.`;
    return null;
  })();

  // ── Actions ───────────────────────────────────────────────────────────────
  const openOrder = (side) => {
    setOrderForm({ ...emptyOrder, side, price_per_share: price > 0 ? String(price) : '' });
    setOrderOpen(true);
  };

  const submitOrder = async () => {
    const qty = int(orderForm.shares);
    if (qty <= 0) { toast.error('Enter how many shares.'); return; }
    if (orderForm.side === 'sell' && qty > pos.free) {
      toast.error(`You have ${pos.free.toLocaleString()} shares free`
        + ` (${pos.locked.toLocaleString()} listed, ${pos.withheld.toLocaleString()} withheld by the society).`);
      return;
    }
    if (s.price_floor_is_par && num(orderForm.price_per_share) < num(s.par_value)) {
      toast.error(`Price may not be below par value (${KES(s.par_value)}).`); return;
    }
    setSaving(true);
    try {
      await createListing(orderForm);
      toast.success(orderForm.side === 'sell'
        ? 'Your shares are on the market — they stay reserved until the order fills or you cancel.'
        : 'Your buy order is live. It fills as soon as a seller takes it.');
      setOrderOpen(false);
      setOrderForm(emptyOrder);
    } catch (e) { toast.error(e.message || 'The order was refused.'); } finally { setSaving(false); }
  };

  const submitEdit = async () => {
    setSaving(true);
    try {
      await updateListing(editing, editing);
      toast.success('Order updated.');
      setEditing(null);
    } catch (e) { toast.error(e.message || 'Could not update the order.'); } finally { setSaving(false); }
  };

  const doCancel = async (l) => {
    try {
      await cancelListing(l);
      toast.success('Order cancelled — your shares are free again.');
    } catch (e) { toast.error(e.message || 'Could not cancel.'); }
  };

  const confirmBuy = async () => {
    const qty = int(buyQty);
    if (qty <= 0 || qty > remaining(buying)) { toast.error(`Choose between 1 and ${remaining(buying)} shares.`); return; }
    setSaving(true);
    try {
      const t = await buyListing(buying, qty);
      const done = t?.status === 'settled';
      toast.success(done
        ? `Done — ${qty.toLocaleString()} shares are yours and your certificate has been updated.`
        : 'Order placed. It completes once the administrator approves it.');
      setBuying(null); setBuyQty('');
    } catch (e) { toast.error(e.message || 'The purchase was refused.'); } finally { setSaving(false); }
  };

  const submitTransfer = async () => {
    const qty = int(xferForm.shares);
    if (!xferForm.to_member) { toast.error('Choose who receives the shares.'); return; }
    if (qty <= 0 || qty > pos.free) {
      toast.error(`You have ${pos.free.toLocaleString()} shares free to transfer`
        + (pos.withheld > 0 ? ` — ${pos.withheld.toLocaleString()} are withheld by the society.` : '.'));
      return;
    }
    setSaving(true);
    try {
      await transferShares(xferForm);
      toast.success('Shares transferred. Both certificates have been reissued.');
      setXferOpen(false);
      setXferForm({ to_member: '', shares: '', reason: '' });
    } catch (e) { toast.error(e.message || 'The transfer was refused.'); } finally { setSaving(false); }
  };

  const download = (c) => {
    const ok = printCertificate(c, {
      saccoName: sacco?.name, memberName: me?.full_name, memberNo: me?.member_no, marketValue: currentMarketValue,
    });
    if (!ok) toast.error('Allow pop-ups to download your certificate.');
  };

  const sellerLabel = (l) => (l.seller_is_treasury
    ? 'SACCO Treasury'
    : (l.seller?.full_name || members.find((m) => m.id === l.seller_member_id)?.full_name || 'A member'));

  return (
    <div className="space-y-5">
      <div className="flex gap-1 flex-wrap border-b border-border pb-3">
        {SUB_TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all border ${
              tab === t.id ? 'border-primary/40 text-primary' : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted'}`}
            style={tab === t.id ? { background: 'rgba(52,193,221,0.10)' } : {}}>
            <Icon name={t.icon} size={14} color="currentColor" />{t.label}
            {t.id === 'orders' && liveOrders.length > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[10px] font-bold">
                {liveOrders.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {blocked && tab !== 'portfolio' && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
          <Icon name="Info" size={16} color="#ca8a04" />
          <p className="text-sm text-foreground">{blocked}</p>
        </div>
      )}

      {/* ── Portfolio ── */}
      {tab === 'portfolio' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Current shares" value={pos.held.toLocaleString()} icon="PieChart" tone="primary"
              hint={pos.locked > 0 ? `${pos.locked.toLocaleString()} listed for sale` : `${pct(pos.ownership, 2)} of the society`} />
            <StatCard label="Current value" value={KES(pos.value)} icon="Wallet" tone="success"
              hint={price > 0 ? `at ${KES(price)} per share` : 'No price published'} />
            <StatCard label="Average buy price" value={pos.avg > 0 ? KES(pos.avg) : '—'} icon="Tag" tone="muted"
              hint={pos.invested > 0 ? `${KES(pos.invested)} invested` : 'No purchases recorded'} />
            <StatCard label="Profit" value={`${gainSign(pos.unrealized)}${KES(pos.unrealized)}`}
              icon={pos.unrealized >= 0 ? 'TrendingUp' : 'TrendingDown'}
              tone={pos.unrealized >= 0 ? 'success' : 'warning'}
              hint={pos.invested > 0 ? `${gainSign(pos.unrealizedPct)}${pct(pos.unrealizedPct, 1)} on cost` : '—'} />
          </div>

          {pos.frozen && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
              <Icon name="Snowflake" size={18} color="#dc2626" />
              <p className="text-sm text-foreground">
                <strong>Your holding is frozen.</strong> {shares?.freeze_reason || 'Please contact the society office.'}
              </p>
            </div>
          )}

          {/* Withheld shares stay yours and keep earning dividends, but you
              cannot sell or transfer them. Saying so here — with the reason and
              the reference — is better than the member discovering it when a
              sell order is refused. */}
          {withheld.live.length > 0 && (
            <div className="flex gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
              <Icon name="Lock" size={18} color="#ca8a04" />
              <div className="text-sm text-foreground min-w-0">
                <p>
                  <strong>{withheld.outstanding.toLocaleString()} of your shares
                  {' '}({KES(withheld.outstanding * price)}) are being held by the society.</strong>
                  {' '}They still earn dividends and count towards your ownership, but you cannot
                  sell or transfer them until they are released.
                </p>
                <ul className="mt-2 space-y-1">
                  {withheld.live.map((w) => (
                    <li key={w.id} className="text-xs text-muted-foreground">
                      <span className="font-mono font-semibold text-foreground">{w.ref_no}</span>
                      {' · '}{outstanding(w).toLocaleString()} share{outstanding(w) === 1 ? '' : 's'}
                      {' · '}{reasonLabel(w.reason_type)}
                      {w.reference ? ` (${w.reference})` : ''}
                      {' · since '}{fmtDate(w.withheld_on)}
                      {onMarket(w) > 0 && ` — ${onMarket(w).toLocaleString()} offered for sale by the society`}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card title="Your position" className="lg:col-span-1">
              <dl className="space-y-2 text-sm">
                <Row k="Shares held" v={pos.held.toLocaleString()} />
                <Row k="Free to trade" v={pos.free.toLocaleString()} />
                <Row k="Reserved in orders" v={pos.locked.toLocaleString()} />
                {withheld.outstanding > 0 && (
                  <Row k="Withheld by the society" v={withheld.outstanding.toLocaleString()} tone="text-amber-600" />
                )}
                <Row k="Market price" v={price > 0 ? KES(price) : '—'} />
                <Row k="Total value" v={KES(pos.value)} bold />
                <div className="pt-2 border-t border-border" />
                <Row k="Total invested" v={KES(pos.invested)} />
                <Row k="Unrealised profit" v={`${gainSign(pos.unrealized)}${KES(pos.unrealized)}`} tone={gainTone(pos.unrealized)} />
                <Row k="Realised profit" v={`${gainSign(pos.realized)}${KES(pos.realized)}`} tone={gainTone(pos.realized)} />
                <Row k="Dividends earned" v={KES(pos.dividends)} />
                <Row k="Total return" v={`${gainSign(pos.unrealized + pos.realized + pos.dividends)}${KES(pos.unrealized + pos.realized + pos.dividends)}`}
                  tone={gainTone(pos.unrealized + pos.realized + pos.dividends)} bold />
                <div className="pt-2 border-t border-border" />
                <Row k="Ownership" v={pct(pos.ownership, 3)} />
                <Row k="Voting rights" v={num(s.votes_per_share) > 0 ? `${votes.toLocaleString()} vote${votes === 1 ? '' : 's'}` : 'One member, one vote'} />
                <Row k="Certificate" v={activeCert?.certificate_no || 'None yet'} />
              </dl>
              <div className="flex flex-wrap gap-2 mt-4">
                <PrimaryButton icon="ShoppingCart" onClick={() => setTab('market')}>Buy shares</PrimaryButton>
                <GhostButton icon="Store" onClick={() => openOrder('sell')} disabled={!!blocked || pos.free <= 0}>Sell shares</GhostButton>
                {s.allow_member_transfers && (
                  <GhostButton icon="Send" onClick={() => setXferOpen(true)} disabled={!!blocked || pos.free <= 0}>Transfer</GhostButton>
                )}
              </div>
            </Card>

            <Card title="Share price" subtitle={asOf ? `Published by your SACCO for ${fmtDate(asOf)}` : 'Not published yet'}
              className="lg:col-span-2">
              {priceSeries.length === 0 ? (
                <EmptyState icon="TrendingUp" title="No price history yet"
                  hint="Your SACCO publishes the share price — your holding is valued at par until then." />
              ) : (
                <>
                  <div className="flex flex-wrap items-end gap-x-8 gap-y-2 mb-4">
                    <div>
                      <p className="text-3xl font-bold text-foreground">{KES(price)}</p>
                      <p className="text-xs text-muted-foreground">per share</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Par value (sale floor)</p>
                      <p className="text-lg font-semibold text-foreground">{KES(s.par_value)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Your holding is worth</p>
                      <p className="text-lg font-semibold text-foreground">{KES(pos.value)}</p>
                    </div>
                  </div>
                  <div className="w-full h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={priceSeries}>
                        <defs>
                          <linearGradient id="memberPrice" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#34c1dd" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#34c1dd" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis dataKey="date" stroke="var(--color-muted-foreground)" fontSize={12} />
                        <YAxis stroke="var(--color-muted-foreground)" fontSize={12} width={72} tickFormatter={KESshort} />
                        <Tooltip contentStyle={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '8px' }}
                          formatter={(v, n) => [KES(v), n === 'value' ? 'Share price' : 'Your holding']} />
                        <Area type="monotone" dataKey="value" stroke="#1da8c5" strokeWidth={2} fill="url(#memberPrice)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* ── Market ── */}
      {tab === 'market' && (
        <div className="space-y-6">
          <Card
            title="Shares for sale"
            subtitle="Offered by fellow members and by the SACCO itself — best price first"
            actions={<PrimaryButton icon="Store" onClick={() => openOrder('sell')} disabled={!!blocked || pos.free <= 0}>Sell my shares</PrimaryButton>}
          >
            {marketSells.length === 0 ? (
              <EmptyState icon="Store" title="Nothing on offer right now"
                hint="When a member or the SACCO lists shares, they appear here and you can buy instantly." />
            ) : (
              <Table columns={['Seller', 'Shares', 'Price / share', 'Total', 'Expires', '']}>
                {marketSells.map((l) => (
                  <tr key={l.id} className="border-b border-border/60">
                    <td className="py-2.5 pr-4">
                      <span className={l.seller_is_treasury ? 'font-medium text-primary' : 'text-foreground'}>
                        {sellerLabel(l)}
                      </span>
                      {l.seller_is_treasury && <span className="block text-xs text-muted-foreground">Sold by the society</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-foreground">{remaining(l).toLocaleString()}</td>
                    <td className="py-2.5 pr-4 font-semibold text-foreground">{KES(l.price_per_share)}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{KES(remaining(l) * num(l.price_per_share))}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground text-xs">{l.expiry_date ? fmtDate(l.expiry_date) : '—'}</td>
                    <td className="py-2.5 pr-0 text-right">
                      <button disabled={!!blocked}
                        onClick={() => { setBuying(l); setBuyQty(String(remaining(l))); }}
                        className="text-xs text-primary font-semibold hover:underline disabled:opacity-40 disabled:no-underline">
                        Buy
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card
            title="Members waiting to buy"
            subtitle="Sell into one of these bids instead of waiting for a buyer"
            actions={<GhostButton icon="ShoppingCart" onClick={() => openOrder('buy')} disabled={!!blocked}>Post a buy order</GhostButton>}
          >
            {marketBuys.length === 0 ? (
              <EmptyState icon="ShoppingCart" title="No buyers waiting"
                hint="Post your own buy order at the price you are willing to pay, and wait for a seller." />
            ) : (
              <Table columns={['Buyer', 'Shares wanted', 'Price / share', 'Total', '']}>
                {marketBuys.map((l) => (
                  <tr key={l.id} className="border-b border-border/60">
                    <td className="py-2.5 pr-4 text-foreground">
                      {l.buyer_is_treasury ? <span className="font-medium text-primary">SACCO Treasury</span>
                        : (members.find((m) => m.id === l.buyer_member_id)?.full_name || 'A member')}
                    </td>
                    <td className="py-2.5 pr-4 text-foreground">{remaining(l).toLocaleString()}</td>
                    <td className="py-2.5 pr-4 font-semibold text-foreground">{KES(l.price_per_share)}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{KES(remaining(l) * num(l.price_per_share))}</td>
                    <td className="py-2.5 pr-0 text-right">
                      <button disabled={!!blocked || pos.free <= 0}
                        onClick={() => { setBuying(l); setBuyQty(String(Math.min(remaining(l), pos.free))); }}
                        className="text-xs text-primary font-semibold hover:underline disabled:opacity-40 disabled:no-underline">
                        Sell to them
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}

      {/* ── My orders ── */}
      {tab === 'orders' && (
        <Card title="My orders" subtitle="Edit or cancel any order that has not been filled">
          {myOrders.length === 0 ? (
            <EmptyState icon="ListOrdered" title="You have no orders"
              hint="Post a sell order to offer your shares, or a buy order at the price you want to pay." />
          ) : (
            <Table columns={['Placed', 'Side', 'Shares', 'Filled', 'Price', 'Total', 'Expires', 'Status', '']}>
              {myOrders.map((l) => (
                <tr key={l.id} className="border-b border-border/60">
                  <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">{fmtDate(l.created_at)}</td>
                  <td className="py-2.5 pr-4 font-medium text-foreground capitalize">{l.side || 'sell'}</td>
                  <td className="py-2.5 pr-4 text-foreground">{int(l.shares).toLocaleString()}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{int(l.filled_shares).toLocaleString()}</td>
                  <td className="py-2.5 pr-4 text-foreground">{KES(l.price_per_share)}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{KES(remaining(l) * num(l.price_per_share))}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground text-xs">{l.expiry_date ? fmtDate(l.expiry_date) : '—'}</td>
                  <td className="py-2.5 pr-4"><Badge status={l.status} /></td>
                  <td className="py-2.5 pr-0 text-right whitespace-nowrap">
                    {l.status === 'open' && (
                      <>
                        <button onClick={() => setEditing({ ...l })} className="text-xs text-primary font-semibold hover:underline">Edit</button>
                        <button onClick={() => doCancel(l)} className="ml-3 text-xs text-red-600 font-semibold hover:underline">Cancel</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* ── Dividends ── */}
      {tab === 'dividends' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Dividends received" value={KES(dividendsPaid)} icon="Coins" tone="success" />
            <StatCard label="Awaiting payment" value={KES(dividendsPending)} icon="Clock"
              tone={dividendsPending > 0 ? 'warning' : 'muted'} />
            <StatCard label="Projected next" value={projected > 0 ? KES(projected) : '—'} icon="Sparkles" tone="primary"
              hint={upcoming ? `${upcoming.period_label} — estimate` : 'None declared'} />
            <StatCard label="Lifetime return" value={KES(pos.dividends)} icon="TrendingUp" tone="muted"
              hint="Credited to your record" />
          </div>

          {upcoming && (
            <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl bg-sky-50 border border-sky-200">
              <Icon name="Megaphone" size={18} color="#0284c7" />
              <p className="flex-1 text-sm text-foreground min-w-[240px]">
                <strong>{upcoming.period_label} dividend declared</strong>
                {upcoming.basis === 'per_share'
                  ? ` at ${KES(upcoming.dividend_per_share)} per share`
                  : ` at ${pct(num(upcoming.dividend_percent), 2)} of profit`}
                . Record date {fmtDate(upcoming.record_date)}
                {upcoming.payment_date ? `, payable ${fmtDate(upcoming.payment_date)}` : ''}.
                {projected > 0 && ` On your ${pos.held.toLocaleString()} shares that is roughly ${KES(projected)}.`}
              </p>
            </div>
          )}

          <Card title="Dividend history"
            actions={myAllocations.length > 0 && (
              <GhostButton icon="Download" onClick={() => exportCSV(myAllocations.map((a) => ({
                period: a.declaration?.period_label || '', record_date: a.declaration?.record_date || '',
                shares_at_record: a.shares_at_record, gross: a.gross_amount, tax: a.tax_amount,
                net: a.net_amount, status: a.status, paid_at: a.paid_at ? String(a.paid_at).slice(0, 10) : '',
              })), 'my_dividends')}>Export</GhostButton>
            )}>
            {myAllocations.length === 0 ? (
              <EmptyState icon="Coins" title="No dividends yet"
                hint="When your SACCO declares and calculates a dividend, your share of it appears here." />
            ) : (
              <Table columns={['Period', 'Record date', 'Shares', 'Gross', 'Tax', 'Net', 'Status']}>
                {myAllocations.map((a) => (
                  <tr key={a.id} className="border-b border-border/60">
                    <td className="py-2.5 pr-4 font-medium text-foreground">{a.declaration?.period_label || '—'}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(a.declaration?.record_date)}</td>
                    <td className="py-2.5 pr-4 text-foreground">{int(a.shares_at_record).toLocaleString()}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{KES(a.gross_amount)}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{num(a.tax_amount) > 0 ? KES(a.tax_amount) : '—'}</td>
                    <td className="py-2.5 pr-4 font-semibold text-foreground">{KES(a.net_amount)}</td>
                    <td className="py-2.5 pr-4"><Badge status={a.status} /></td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}

      {/* ── Certificates ── */}
      {tab === 'certs' && (
        <Card title="My share certificates"
          subtitle="Reissued automatically whenever your holding changes — download any of them">
          {certificates.length === 0 ? (
            <EmptyState icon="Award" title="No certificates yet"
              hint="Your first certificate is generated the moment you acquire shares." />
          ) : (
            <Table columns={['Certificate no.', 'Shares', 'Par value', 'Value today', 'Issued', 'Status', '']}>
              {certificates.map((c) => (
                <tr key={c.id} className="border-b border-border/60">
                  <td className="py-2.5 pr-4 font-mono text-xs text-foreground">{c.certificate_no}</td>
                  <td className="py-2.5 pr-4 text-foreground">{int(c.shares).toLocaleString()}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{KES(c.par_value)}</td>
                  <td className="py-2.5 pr-4 font-semibold text-foreground">{KES(int(c.shares) * (price || num(c.par_value)))}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(c.issue_date || c.created_at)}</td>
                  <td className="py-2.5 pr-4"><Badge status={c.status === 'active' ? 'active' : 'closed'} /></td>
                  <td className="py-2.5 pr-0 text-right">
                    <button onClick={() => download(c)} className="text-xs text-primary font-semibold hover:underline">Download</button>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* ── History ── */}
      {tab === 'history' && (
        <Card title="Share history" subtitle="Every purchase, sale, transfer and dividend on your account"
          actions={shareTxns.length > 0 && (
            <GhostButton icon="Download" onClick={() => exportCSV(shareTxns.map((t) => ({
              date: String(t.created_at).slice(0, 10), ref: t.txn_no, movement: t.txn_type,
              shares: t.shares, price: t.price_per_share, amount: t.amount,
              balance_after: t.balance_after, gain: t.realized_gain,
            })), 'my_share_history')}>Export</GhostButton>
          )}>
          {shareTxns.length === 0 ? (
            <EmptyState icon="History" title="Nothing yet"
              hint="Your share movements will be listed here from your first purchase onwards." />
          ) : (
            <Table columns={['Date', 'Ref', 'Movement', 'Shares', 'Price', 'Amount', 'Balance']}>
              {shareTxns.map((t) => (
                <tr key={t.id} className="border-b border-border/60">
                  <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">{fmtDate(t.created_at)}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground font-mono text-xs">{t.txn_no}</td>
                  <td className="py-2.5 pr-4 text-foreground">{TXN_LABELS[t.txn_type] || t.txn_type}</td>
                  <td className={`py-2.5 pr-4 font-semibold ${int(t.shares) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {int(t.shares) > 0 ? '+' : ''}{int(t.shares).toLocaleString()}
                  </td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{num(t.price_per_share) > 0 ? KES(t.price_per_share) : '—'}</td>
                  <td className="py-2.5 pr-4 text-foreground">{num(t.amount) > 0 ? KES(t.amount) : '—'}</td>
                  <td className="py-2.5 pr-4 text-foreground">{int(t.balance_after).toLocaleString()}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* ── Place order ── */}
      <Modal open={orderOpen} onClose={() => setOrderOpen(false)}
        title={orderForm.side === 'sell' ? 'Sell shares' : 'Buy shares'}
        footer={<>
          <GhostButton onClick={() => setOrderOpen(false)}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={submitOrder} disabled={saving}>{saving ? 'Placing…' : 'Place order'}</PrimaryButton>
        </>}>
        <p className="text-sm text-muted-foreground mb-4">
          {orderForm.side === 'sell'
            ? `You hold ${pos.held.toLocaleString()} shares, ${pos.free.toLocaleString()} of them free. Listed shares are reserved until the order fills or you cancel it.`
            : 'Your bid sits on the market until a seller takes it. You can cancel any time before that.'}
          {s.price_floor_is_par && ` The minimum price is par value, ${KES(s.par_value)}.`}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Number of shares *">
            <NumberInput value={orderForm.shares} onChange={(e) => setO('shares', e.target.value)} placeholder="100" />
          </Field>
          <Field label="Price per share (KES) *">
            <NumberInput value={orderForm.price_per_share} onChange={(e) => setO('price_per_share', e.target.value)} />
          </Field>
          <Field label="Expiry (optional)">
            <TextInput type="date" value={orderForm.expiry_date} onChange={(e) => setO('expiry_date', e.target.value)} />
          </Field>
        </div>
        {int(orderForm.shares) > 0 && num(orderForm.price_per_share) > 0 && (
          <div className="mt-4 p-3 rounded-lg bg-muted text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Order value</span>
              <span className="font-semibold text-foreground">{KES(int(orderForm.shares) * num(orderForm.price_per_share))}</span></div>
            {orderForm.side === 'sell' && num(s.commission_percent) > 0 && (
              <div className="flex justify-between"><span className="text-muted-foreground">Commission ({s.commission_percent}%)</span>
                <span className="text-foreground">−{KES(int(orderForm.shares) * num(orderForm.price_per_share) * num(s.commission_percent) / 100)}</span></div>
            )}
            {orderForm.side === 'buy' && num(s.trading_fee_percent) > 0 && (
              <div className="flex justify-between"><span className="text-muted-foreground">Trading fee ({s.trading_fee_percent}%)</span>
                <span className="text-foreground">+{KES(int(orderForm.shares) * num(orderForm.price_per_share) * num(s.trading_fee_percent) / 100)}</span></div>
            )}
            {orderForm.side === 'sell' && pos.avg > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Profit at this price</span>
                <span className={gainTone((num(orderForm.price_per_share) - pos.avg) * int(orderForm.shares))}>
                  {gainSign((num(orderForm.price_per_share) - pos.avg) * int(orderForm.shares))}
                  {KES((num(orderForm.price_per_share) - pos.avg) * int(orderForm.shares))}
                </span>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Edit order ── */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit order"
        footer={<>
          <GhostButton onClick={() => setEditing(null)}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={submitEdit} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</PrimaryButton>
        </>}>
        {editing && (
          <>
            <p className="text-sm text-muted-foreground mb-4">
              {int(editing.filled_shares) > 0
                ? `${int(editing.filled_shares).toLocaleString()} shares have already been taken — the new quantity must stay above that.`
                : 'Change the quantity, price or expiry while the order is still open.'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Number of shares *">
                <NumberInput value={editing.shares} onChange={(e) => setEditing((p) => ({ ...p, shares: e.target.value }))} />
              </Field>
              <Field label={`Price per share (min ${KES(s.par_value)}) *`}>
                <NumberInput value={editing.price_per_share} onChange={(e) => setEditing((p) => ({ ...p, price_per_share: e.target.value }))} />
              </Field>
              <Field label="Expiry">
                <TextInput type="date" value={editing.expiry_date || ''} onChange={(e) => setEditing((p) => ({ ...p, expiry_date: e.target.value }))} />
              </Field>
            </div>
          </>
        )}
      </Modal>

      {/* ── Buy / sell into an order ── */}
      <Modal open={!!buying} onClose={() => { setBuying(null); setBuyQty(''); }}
        title={buying?.side === 'buy' ? 'Sell into this order' : 'Buy shares'}
        footer={<>
          <GhostButton onClick={() => { setBuying(null); setBuyQty(''); }}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={confirmBuy} disabled={saving}>
            {saving ? 'Working…' : (s.auto_settle && !s.require_transfer_approval) ? 'Confirm' : 'Send request'}
          </PrimaryButton>
        </>}>
        {buying && (
          <>
            <p className="text-sm text-foreground mb-4">
              {buying.side === 'buy' ? 'Selling to ' : 'Buying from '}
              <strong>{buying.side === 'buy'
                ? (buying.buyer_is_treasury ? 'the SACCO' : (members.find((m) => m.id === buying.buyer_member_id)?.full_name || 'a member'))
                : sellerLabel(buying)}</strong>
              {' '}at <strong>{KES(buying.price_per_share)}</strong> per share.
              {' '}{(s.auto_settle && !s.require_transfer_approval)
                ? 'This completes immediately — the shares move and your certificate is reissued.'
                : 'The administrator approves it before it completes.'}
            </p>
            <Field label={`Number of shares (max ${remaining(buying).toLocaleString()}) *`}>
              <NumberInput value={buyQty} onChange={(e) => setBuyQty(e.target.value)} disabled={!s.allow_partial_fills} />
            </Field>
            {!s.allow_partial_fills && (
              <p className="text-xs text-muted-foreground mt-2">Your SACCO does not allow partial fills, so the whole order is taken.</p>
            )}
            {int(buyQty) > 0 && (
              <div className="mt-4 p-3 rounded-lg bg-muted text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Consideration</span>
                  <span className="font-semibold text-foreground">{KES(int(buyQty) * num(buying.price_per_share))}</span></div>
                {buying.side !== 'buy' && num(s.trading_fee_percent) > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Trading fee ({s.trading_fee_percent}%)</span>
                    <span className="text-foreground">{KES(int(buyQty) * num(buying.price_per_share) * num(s.trading_fee_percent) / 100)}</span></div>
                )}
                {buying.side === 'buy' && num(s.commission_percent) > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Commission ({s.commission_percent}%)</span>
                    <span className="text-foreground">{KES(int(buyQty) * num(buying.price_per_share) * num(s.commission_percent) / 100)}</span></div>
                )}
                {buying.side !== 'buy' && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Your holding after</span>
                    <span className="text-foreground">{(pos.held + int(buyQty)).toLocaleString()} shares</span></div>
                )}
              </div>
            )}
          </>
        )}
      </Modal>

      {/* ── Transfer to a member ── */}
      <Modal open={xferOpen} onClose={() => setXferOpen(false)} title="Transfer shares to a member"
        footer={<>
          <GhostButton onClick={() => setXferOpen(false)}>Cancel</GhostButton>
          <PrimaryButton icon="Send" onClick={submitTransfer} disabled={saving}>{saving ? 'Transferring…' : 'Transfer'}</PrimaryButton>
        </>}>
        <p className="text-sm text-muted-foreground mb-4">
          A transfer moves shares with no money changing hands, subject to your SACCO's rules.
          You have {pos.free.toLocaleString()} shares free to transfer. Both certificates are reissued immediately.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <Field label="Transfer to *">
              <Select value={xferForm.to_member} onChange={(e) => setX('to_member', e.target.value)}>
                <option value="">Select member</option>
                {members.filter((m) => m.id !== me?.id).map((m) => (
                  <option key={m.id} value={m.id}>{m.full_name}{m.member_no ? ` (${m.member_no})` : ''}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Number of shares *">
            <NumberInput value={xferForm.shares} onChange={(e) => setX('shares', e.target.value)} />
          </Field>
          <Field label="Reason (optional)">
            <TextInput value={xferForm.reason} onChange={(e) => setX('reason', e.target.value)} placeholder="e.g. family transfer" />
          </Field>
        </div>
      </Modal>
    </div>
  );
};

const Row = ({ k, v, tone = 'text-foreground', bold }) => (
  <div className="flex items-baseline justify-between gap-4">
    <dt className="text-muted-foreground">{k}</dt>
    <dd className={`${tone} ${bold ? 'font-bold' : 'font-medium'} text-right`}>{v}</dd>
  </div>
);

export default SharesTab;

import React, { useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useToast } from '../../../components/Toast';
import { Card, StatCard, Table, Badge, PrimaryButton, GhostButton, Modal, Field, TextInput, NumberInput, Select, EmptyState, KES, fmtDate } from './_shared';

const today = () => new Date().toISOString().slice(0, 10);

const SharesTab = ({ ctx }) => {
  const {
    shares, sharePrices = [], listings, transfers, members,
    currentMarketValue = 0, marketCap = 0,
    saveShares, setMarketValue, createListing, requestTransfer, approveTransfer, exportCSV,
  } = ctx;
  const toast = useToast();
  const [holdOpen, setHoldOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [buyListing, setBuyListing] = useState(null);
  const [saving, setSaving] = useState(false);

  const [holdForm, setHoldForm] = useState({ member_id: '', shares_held: '', par_value: '' });
  const [listForm, setListForm] = useState({ seller_member_id: '', shares: '', price_per_share: '', expiry_date: '' });
  const [priceForm, setPriceForm] = useState({ market_value: '', effective_date: today(), note: '' });
  const [buyer, setBuyer] = useState('');
  const setHF = (k, v) => setHoldForm((p) => ({ ...p, [k]: v }));
  const setLF = (k, v) => setListForm((p) => ({ ...p, [k]: v }));
  const setPF = (k, v) => setPriceForm((p) => ({ ...p, [k]: v }));

  const memberName = (id) => members.find((m) => m.id === id)?.full_name || '—';
  const totalParValue = shares.reduce((s, r) => s + (parseInt(r.shares_held, 10) || 0) * parseFloat(r.par_value || 0), 0);
  const totalShares = shares.reduce((s, r) => s + (parseInt(r.shares_held, 10) || 0), 0);
  const currentEffective = sharePrices[0]?.effective_date;
  const prevValue = parseFloat(sharePrices[1]?.market_value || 0);
  const delta = currentMarketValue - prevValue;

  // Settled trades power the trading report (open marketplace, immutable record).
  const settled = transfers.filter((t) => t.status === 'settled');
  const tradedVolume = settled.reduce((s, t) => s + (parseInt(t.shares, 10) || 0), 0);
  const tradedValue = settled.reduce((s, t) => s + parseFloat(t.price || 0), 0);

  // Daily market-value trend (series is stored newest-first; chart wants oldest-first).
  const priceSeries = useMemo(
    () => [...sharePrices].reverse().map((p) => ({ date: String(p.effective_date || '').slice(5), value: parseFloat(p.market_value || 0) })),
    [sharePrices],
  );

  const saveHolding = async () => {
    if (!holdForm.member_id) { toast.error('Choose a member.'); return; }
    setSaving(true);
    try { await saveShares(holdForm); toast.success('Share holding saved.'); setHoldOpen(false); setHoldForm({ member_id: '', shares_held: '', par_value: '' }); }
    catch (e) { toast.error(e.message || 'Could not save.'); } finally { setSaving(false); }
  };

  const savePrice = async () => {
    if (!(parseFloat(priceForm.market_value) >= 0)) { toast.error('Enter a market value.'); return; }
    setSaving(true);
    try { await setMarketValue(priceForm); toast.success('Market value published to members.'); setPriceOpen(false); setPriceForm({ market_value: '', effective_date: today(), note: '' }); }
    catch (e) { toast.error(e.message || 'Could not publish.'); } finally { setSaving(false); }
  };

  const saveListing = async () => {
    if (!listForm.seller_member_id) { toast.error('Choose the seller.'); return; }
    if (!(parseInt(listForm.shares, 10) > 0)) { toast.error('Enter a share quantity.'); return; }
    setSaving(true);
    try { await createListing(listForm); toast.success('Listing created on the marketplace.'); setListOpen(false); setListForm({ seller_member_id: '', shares: '', price_per_share: '', expiry_date: '' }); }
    catch (e) { toast.error(e.message || 'Could not list.'); } finally { setSaving(false); }
  };

  const submitBuy = async () => {
    if (!buyer) { toast.error('Choose the buying member.'); return; }
    setSaving(true);
    try { await requestTransfer(buyListing, buyer); toast.success('Purchase submitted for approval.'); setBuyListing(null); setBuyer(''); }
    catch (e) { toast.error(e.message || 'Could not submit.'); } finally { setSaving(false); }
  };

  const doApprove = async (t) => {
    try { await approveTransfer(t); toast.success('Transfer settled — shares moved.'); }
    catch (e) { toast.error(e.message || 'Could not settle.'); }
  };

  const exportTrades = () => exportCSV(
    settled.map((t) => ({
      date: String(t.created_at || '').slice(0, 10),
      seller: memberName(t.seller_member_id), buyer: memberName(t.buyer_member_id),
      shares: t.shares, price: t.price, status: t.status,
    })),
    'share_trades',
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total shares" value={totalShares.toLocaleString()} icon="PieChart" />
        <StatCard label="Market value / share" value={currentMarketValue > 0 ? KES(currentMarketValue) : '—'} icon="TrendingUp" tone="primary" />
        <StatCard label="Market capitalisation" value={KES(marketCap)} icon="Landmark" tone="success" />
        <StatCard label="Open listings" value={listings.filter((l) => l.status === 'open').length} icon="Store" tone="muted" />
      </div>

      {/* Dynamic market value — published by the admin, seen live by members */}
      <Card
        title="Market value per share"
        subtitle={currentEffective ? `Effective ${fmtDate(currentEffective)}` : 'No market value published yet'}
        actions={<PrimaryButton icon="TrendingUp" onClick={() => setPriceOpen(true)}>Set today's value</PrimaryButton>}
      >
        <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
          <div>
            <p className="text-3xl font-bold text-foreground">{currentMarketValue > 0 ? KES(currentMarketValue) : '—'}</p>
            {sharePrices.length > 1 && (
              <p className={`text-sm font-medium ${delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                {delta > 0 ? '▲' : delta < 0 ? '▼' : '■'} {KES(Math.abs(delta))} vs previous
              </p>
            )}
          </div>
          <p className="text-sm text-muted-foreground max-w-md">
            Members see this as their live share value and a default sale price. Par value ({KES(totalShares ? totalParValue / totalShares : 0)} avg) remains the floor for sales.
          </p>
        </div>
      </Card>

      {/* Holdings */}
      <Card title="Share holdings" subtitle={`${shares.length} shareholders`}
        actions={<PrimaryButton icon="Plus" onClick={() => setHoldOpen(true)}>Set holding</PrimaryButton>}>
        {shares.length === 0 ? (
          <EmptyState icon="PieChart" title="No share holdings" hint="Record each member's shares and par value to enable dividends and trading." />
        ) : (
          <Table columns={['Member', 'Shares', 'Par value', 'Market value']}>
            {shares.map((s) => {
              const held = parseInt(s.shares_held, 10) || 0;
              return (
                <tr key={s.id} className="border-b border-border/60">
                  <td className="py-2.5 pr-4 font-medium text-foreground">{s.member?.full_name || memberName(s.member_id)}</td>
                  <td className="py-2.5 pr-4 text-foreground">{held.toLocaleString()}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{KES(s.par_value)}</td>
                  <td className="py-2.5 pr-4 font-semibold text-foreground">{KES(held * (currentMarketValue || parseFloat(s.par_value || 0)))}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {/* Marketplace */}
      <Card title="Internal marketplace" subtitle="Member-to-member share transfers (admin-approved)"
        actions={<PrimaryButton icon="Tag" onClick={() => setListOpen(true)}>List shares</PrimaryButton>}>
        {listings.length === 0 ? (
          <EmptyState icon="Store" title="No active listings" hint="A member can list shares for sale; another member buys, then you approve the transfer." />
        ) : (
          <Table columns={['Seller', 'Shares', 'Price/share', 'Total', 'Status', '']}>
            {listings.map((l) => (
              <tr key={l.id} className="border-b border-border/60">
                <td className="py-2.5 pr-4 font-medium text-foreground">{l.seller?.full_name || memberName(l.seller_member_id)}</td>
                <td className="py-2.5 pr-4 text-foreground">{l.shares}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{KES(l.price_per_share)}</td>
                <td className="py-2.5 pr-4 font-semibold text-foreground">{KES(l.shares * l.price_per_share)}</td>
                <td className="py-2.5 pr-4"><Badge status={l.status} /></td>
                <td className="py-2.5 pr-0 text-right">
                  {l.status === 'open' && <button onClick={() => setBuyListing(l)} className="text-xs text-primary font-semibold hover:underline">Buy</button>}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Pending transfers */}
      {transfers.filter((t) => t.status === 'pending').length > 0 && (
        <Card title="Transfers awaiting approval">
          <Table columns={['Seller', 'Buyer', 'Shares', 'Price', '']}>
            {transfers.filter((t) => t.status === 'pending').map((t) => (
              <tr key={t.id} className="border-b border-border/60">
                <td className="py-2.5 pr-4 text-foreground">{memberName(t.seller_member_id)}</td>
                <td className="py-2.5 pr-4 text-foreground">{memberName(t.buyer_member_id)}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{t.shares}</td>
                <td className="py-2.5 pr-4 font-semibold text-foreground">{KES(t.price)}</td>
                <td className="py-2.5 pr-0 text-right"><button onClick={() => doApprove(t)} className="text-xs text-emerald-600 font-semibold hover:underline">Approve & settle</button></td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {/* Trading report — daily market value trend + settled trades */}
      <Card
        title="Trading report"
        subtitle="Everyday market value and openly-settled trades"
        actions={settled.length > 0 && <GhostButton icon="Download" onClick={exportTrades}>Export trades</GhostButton>}
      >
        {priceSeries.length === 0 ? (
          <EmptyState icon="TrendingUp" title="No market-value history yet" hint="Publish a daily value with “Set today's value” to build the trend." />
        ) : (
          <div className="w-full h-64 mb-6" aria-label="Daily market value trend">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={priceSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" stroke="var(--color-muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={12} width={72} tickFormatter={(v) => KES(v)} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '8px' }}
                  formatter={(v) => [KES(v), 'Market value']}
                />
                <Line type="monotone" dataKey="value" stroke="var(--color-primary)" strokeWidth={2} dot={{ r: 2 }} name="Market value" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
          <StatCard label="Settled trades" value={settled.length.toLocaleString()} icon="ArrowLeftRight" tone="muted" />
          <StatCard label="Volume traded" value={`${tradedVolume.toLocaleString()} shares`} icon="Layers" tone="muted" />
          <StatCard label="Value traded" value={KES(tradedValue)} icon="Wallet" tone="success" />
        </div>

        {settled.length === 0 ? (
          <EmptyState icon="ArrowLeftRight" title="No settled trades yet" hint="Approved marketplace purchases appear here as an immutable trade record." />
        ) : (
          <Table columns={['Date', 'Seller', 'Buyer', 'Shares', 'Price']}>
            {settled.map((t) => (
              <tr key={t.id} className="border-b border-border/60">
                <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(t.created_at)}</td>
                <td className="py-2.5 pr-4 text-foreground">{memberName(t.seller_member_id)}</td>
                <td className="py-2.5 pr-4 text-foreground">{memberName(t.buyer_member_id)}</td>
                <td className="py-2.5 pr-4 text-foreground">{t.shares}</td>
                <td className="py-2.5 pr-4 font-semibold text-foreground">{KES(t.price)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Set market value modal */}
      <Modal open={priceOpen} onClose={() => setPriceOpen(false)} title="Publish market value per share"
        footer={<><GhostButton onClick={() => setPriceOpen(false)}>Cancel</GhostButton><PrimaryButton icon="Check" onClick={savePrice} disabled={saving}>{saving ? 'Publishing…' : 'Publish'}</PrimaryButton></>}>
        <p className="text-sm text-muted-foreground mb-4">This becomes the live share value every member sees. Setting a value for a date you already published overwrites it.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Market value per share (KES) *"><NumberInput value={priceForm.market_value} onChange={(e) => setPF('market_value', e.target.value)} placeholder="120" /></Field>
          <Field label="Effective date"><TextInput type="date" value={priceForm.effective_date} onChange={(e) => setPF('effective_date', e.target.value)} /></Field>
          <div className="sm:col-span-2"><Field label="Note (optional)"><TextInput value={priceForm.note} onChange={(e) => setPF('note', e.target.value)} placeholder="e.g. AGM revaluation" /></Field></div>
        </div>
      </Modal>

      {/* Holding modal */}
      <Modal open={holdOpen} onClose={() => setHoldOpen(false)} title="Set share holding"
        footer={<><GhostButton onClick={() => setHoldOpen(false)}>Cancel</GhostButton><PrimaryButton icon="Check" onClick={saveHolding} disabled={saving}>{saving ? 'Saving…' : 'Save'}</PrimaryButton></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Member *"><Select value={holdForm.member_id} onChange={(e) => setHF('member_id', e.target.value)}><option value="">Select member</option>{members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</Select></Field>
          <Field label="Shares held"><NumberInput value={holdForm.shares_held} onChange={(e) => setHF('shares_held', e.target.value)} placeholder="100" /></Field>
          <Field label="Par value (KES)"><NumberInput value={holdForm.par_value} onChange={(e) => setHF('par_value', e.target.value)} placeholder="100" /></Field>
        </div>
      </Modal>

      {/* Listing modal */}
      <Modal open={listOpen} onClose={() => setListOpen(false)} title="List shares for sale"
        footer={<><GhostButton onClick={() => setListOpen(false)}>Cancel</GhostButton><PrimaryButton icon="Check" onClick={saveListing} disabled={saving}>{saving ? 'Saving…' : 'List'}</PrimaryButton></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Seller *"><Select value={listForm.seller_member_id} onChange={(e) => setLF('seller_member_id', e.target.value)}><option value="">Select member</option>{members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</Select></Field>
          <Field label="Shares *"><NumberInput value={listForm.shares} onChange={(e) => setLF('shares', e.target.value)} placeholder="50" /></Field>
          <Field label="Price per share (KES)"><NumberInput value={listForm.price_per_share} onChange={(e) => setLF('price_per_share', e.target.value)} placeholder={currentMarketValue > 0 ? String(currentMarketValue) : '120'} /></Field>
          <Field label="Expiry date"><TextInput type="date" value={listForm.expiry_date} onChange={(e) => setLF('expiry_date', e.target.value)} /></Field>
        </div>
      </Modal>

      {/* Buy modal */}
      <Modal open={!!buyListing} onClose={() => setBuyListing(null)} title="Buy shares"
        footer={<><GhostButton onClick={() => setBuyListing(null)}>Cancel</GhostButton><PrimaryButton icon="Check" onClick={submitBuy} disabled={saving}>{saving ? 'Submitting…' : 'Submit purchase'}</PrimaryButton></>}>
        {buyListing && (
          <>
            <p className="text-sm text-muted-foreground mb-3">
              Buying <span className="font-semibold text-foreground">{buyListing.shares}</span> shares at{' '}
              <span className="font-semibold text-foreground">{KES(buyListing.price_per_share)}</span> each ·
              total <span className="font-semibold text-foreground">{KES(buyListing.shares * buyListing.price_per_share)}</span>.
            </p>
            <Field label="Buying member *">
              <Select value={buyer} onChange={(e) => setBuyer(e.target.value)}>
                <option value="">Select member</option>
                {members.filter((m) => m.id !== buyListing.seller_member_id).map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </Select>
            </Field>
          </>
        )}
      </Modal>
    </div>
  );
};

export default SharesTab;

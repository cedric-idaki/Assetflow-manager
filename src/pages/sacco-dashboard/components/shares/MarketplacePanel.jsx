import React, { useState } from 'react';
import { useToast } from '../../../../components/Toast';
import Icon from '../../../../components/AppIcon';
import {
  Card, StatCard, Table, Badge, PrimaryButton, GhostButton, Modal, Field,
  TextInput, NumberInput, Select, EmptyState, KES, fmtDate,
} from '../_shared';
import { int, num, remaining, withDefaults, marketIsOpen } from './_util';

/**
 * The exchange floor: a two-sided order book, live trades, and the approval
 * queue for societies that keep a human in the loop.
 *
 * Taking an order calls the engine, which checks ownership and limits, moves
 * the shares, updates the ledger and reissues the certificates — in one
 * transaction. Nothing here does arithmetic on ownership itself.
 */
const MarketplacePanel = ({ ctx, ov }) => {
  const {
    listings = [], transfers = [], members = [], shares = [], treasury,
    shareSettings, placeOrder, updateOrder, cancelOrder, executeOrder,
    approveShareTransfer, rejectShareTransfer, reverseTrade, exportCSV,
  } = ctx;
  const toast = useToast();
  const s = withDefaults(shareSettings);
  const open = marketIsOpen(shareSettings);

  const [orderOpen, setOrderOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [taking, setTaking] = useState(null);     // listing being filled
  const [confirm, setConfirm] = useState(null);   // { kind, transfer }
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState('');

  const [form, setForm] = useState({ side: 'sell', member_id: '', as_treasury: false, shares: '', price_per_share: '', expiry_date: '' });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const [takeForm, setTakeForm] = useState({ member_id: '', as_treasury: false, shares: '' });
  const setTF = (k, v) => setTakeForm((p) => ({ ...p, [k]: v }));

  const memberName = (id) => members.find((m) => m.id === id)?.full_name || '—';
  const partyName = (id, isTreasury) => (isTreasury ? 'SACCO Treasury' : memberName(id));
  const holdingOf = (id) => shares.find((r) => r.member_id === id);
  const freeOf = (id) => {
    const h = holdingOf(id);
    return Math.max(0, int(h?.shares_held) - int(h?.locked_shares));
  };

  const sellBook = listings
    .filter((l) => (l.side || 'sell') === 'sell' && l.status === 'open')
    .sort((a, b) => num(a.price_per_share) - num(b.price_per_share));   // best ask first
  const buyBook = listings
    .filter((l) => l.side === 'buy' && l.status === 'open')
    .sort((a, b) => num(b.price_per_share) - num(a.price_per_share));   // best bid first
  const closed = listings.filter((l) => !['open'].includes(l.status));
  const pending = transfers.filter((t) => t.status === 'pending');
  const settled = transfers.filter((t) => t.status === 'settled');

  const bestBid = buyBook[0] ? num(buyBook[0].price_per_share) : 0;
  const bestAsk = sellBook[0] ? num(sellBook[0].price_per_share) : 0;
  const spread = bestBid > 0 && bestAsk > 0 ? bestAsk - bestBid : 0;

  const openOrderModal = () => {
    setForm({
      side: 'sell', member_id: '', as_treasury: false, shares: '',
      price_per_share: ov.price > 0 ? String(ov.price) : String(s.par_value || ''),
      expiry_date: '',
    });
    setOrderOpen(true);
  };

  const submitOrder = async () => {
    const qty = int(form.shares);
    if (qty <= 0) { toast.error('Enter a share quantity.'); return; }
    if (!form.as_treasury && !form.member_id) { toast.error('Choose whose order this is.'); return; }
    setSaving(true);
    try {
      await placeOrder(form);
      toast.success(form.side === 'sell'
        ? 'Sell order is live on the book — the shares are now escrowed.'
        : 'Buy order is live on the book.');
      setOrderOpen(false);
    } catch (e) { toast.error(e.message || 'The order was refused.'); } finally { setSaving(false); }
  };

  const openTake = (l) => {
    setTakeForm({ member_id: '', as_treasury: false, shares: String(remaining(l)) });
    setTaking(l);
  };

  const submitTake = async () => {
    if (!takeForm.as_treasury && !takeForm.member_id) {
      toast.error(taking.side === 'buy' ? 'Choose the selling member.' : 'Choose the buying member.');
      return;
    }
    const qty = int(takeForm.shares);
    if (qty <= 0 || qty > remaining(taking)) { toast.error(`Enter between 1 and ${remaining(taking)} shares.`); return; }
    setSaving(true);
    try {
      const t = await executeOrder(taking, takeForm);
      const settledNow = t?.status === 'settled';
      toast.success(settledNow
        ? `Trade settled — ${qty.toLocaleString()} shares moved, certificates reissued and the ledger posted.`
        : 'Trade matched and is waiting for your approval.');
      setTaking(null);
    } catch (e) { toast.error(e.message || 'The trade was refused.'); } finally { setSaving(false); }
  };

  const submitEdit = async () => {
    setSaving(true);
    try {
      await updateOrder(editing, editing);
      toast.success('Order updated.');
      setEditing(null);
    } catch (e) { toast.error(e.message || 'Could not update the order.'); } finally { setSaving(false); }
  };

  const doCancel = async (l) => {
    try {
      await cancelOrder(l, null);
      toast.success('Order withdrawn — any escrowed shares are free again.');
    } catch (e) { toast.error(e.message || 'Could not withdraw the order.'); }
  };

  const runConfirm = async () => {
    setSaving(true);
    try {
      if (confirm.kind === 'approve') {
        await approveShareTransfer(confirm.transfer);
        toast.success('Trade settled — shares moved and the ledger posted.');
      } else if (confirm.kind === 'reject') {
        await rejectShareTransfer(confirm.transfer, reason);
        toast.success('Trade rejected — the order is back on the book.');
      } else {
        if (!reason.trim()) throw new Error('A reversal needs a reason.');
        await reverseTrade(confirm.transfer, reason);
        toast.success('Trade reversed with a mirror-image settlement. Both entries stay on file.');
      }
      setConfirm(null); setReason('');
    } catch (e) { toast.error(e.message || 'That action was refused.'); } finally { setSaving(false); }
  };

  const OrderRow = ({ l, side }) => (
    <tr className="border-b border-border/60">
      <td className="py-2.5 pr-4">
        <span className={`font-medium ${(side === 'sell' ? l.seller_is_treasury : l.buyer_is_treasury) ? 'text-primary' : 'text-foreground'}`}>
          {side === 'sell'
            ? (l.seller_is_treasury ? 'SACCO Treasury' : (l.seller?.full_name || memberName(l.seller_member_id)))
            : (l.buyer_is_treasury ? 'SACCO Treasury' : memberName(l.buyer_member_id))}
        </span>
        {int(l.filled_shares) > 0 && (
          <span className="block text-xs text-muted-foreground">{int(l.filled_shares).toLocaleString()} already filled</span>
        )}
        {/* A forced sale of withheld shares, not the member's own offer — worth
            saying, because withdrawing it returns them to withholding rather
            than to the member. */}
        {l.withholding_id && (
          <span className="inline-flex items-center gap-1 mt-0.5 text-xs text-amber-600 font-medium">
            <Icon name="Lock" size={11} color="currentColor" />
            Withheld shares
          </span>
        )}
      </td>
      <td className="py-2.5 pr-4 text-foreground">{remaining(l).toLocaleString()}</td>
      <td className="py-2.5 pr-4 font-semibold text-foreground">{KES(l.price_per_share)}</td>
      <td className="py-2.5 pr-4 text-muted-foreground">{KES(remaining(l) * num(l.price_per_share))}</td>
      <td className="py-2.5 pr-4 text-muted-foreground text-xs">{l.expiry_date ? fmtDate(l.expiry_date) : 'No expiry'}</td>
      <td className="py-2.5 pr-0 text-right whitespace-nowrap">
        <button onClick={() => openTake(l)} className="text-xs text-primary font-semibold hover:underline">
          {side === 'sell' ? 'Fill (buy)' : 'Fill (sell)'}
        </button>
        <button onClick={() => setEditing({ ...l })} className="ml-3 text-xs text-muted-foreground font-semibold hover:underline">Edit</button>
        <button onClick={() => doCancel(l)} className="ml-3 text-xs text-red-600 font-semibold hover:underline">Withdraw</button>
      </td>
    </tr>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Best bid" value={bestBid > 0 ? KES(bestBid) : '—'} icon="ArrowUpCircle" tone="success"
          hint={`${buyBook.length} buy order${buyBook.length === 1 ? '' : 's'}`} />
        <StatCard label="Best ask" value={bestAsk > 0 ? KES(bestAsk) : '—'} icon="ArrowDownCircle" tone="warning"
          hint={`${sellBook.length} sell order${sellBook.length === 1 ? '' : 's'}`} />
        <StatCard label="Spread" value={spread > 0 ? KES(spread) : '—'} icon="MoveHorizontal" tone="muted"
          hint={bestAsk > 0 && spread > 0 ? `${((spread / bestAsk) * 100).toFixed(1)}% of ask` : 'No two-sided market'} />
        <StatCard label="Shares on offer" value={sellBook.reduce((a, l) => a + remaining(l), 0).toLocaleString()} icon="Store" tone="primary" />
        <StatCard label="Awaiting approval" value={pending.length} icon="Clock" tone={pending.length ? 'warning' : 'muted'} />
      </div>

      {!open && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <Icon name={s.trading_suspended ? 'Ban' : 'Clock'} size={18} color="#ca8a04" />
          <p className="text-sm text-foreground">
            {s.trading_suspended
              ? <><strong>Trading is suspended.</strong> {s.suspension_reason || 'Members cannot place or fill orders.'} Your own actions here are still blocked by the engine.</>
              : <><strong>The market is closed to members right now.</strong> You can still place and fill orders on their behalf — staff instructions are accepted outside market hours.</>}
          </p>
        </div>
      )}

      {/* Approvals first: they are the only thing blocking a trade */}
      {pending.length > 0 && (
        <Card title="Transfers awaiting approval"
          subtitle={s.require_transfer_approval
            ? 'This society reviews every trade before it settles'
            : 'Matched but not yet settled'}>
          <Table columns={['Matched', 'Seller', 'Buyer', 'Shares', 'Price/share', 'Total', 'Fees', '']}>
            {pending.map((t) => (
              <tr key={t.id} className="border-b border-border/60">
                <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">{fmtDate(t.created_at)}</td>
                <td className="py-2.5 pr-4 text-foreground">{partyName(t.seller_member_id, t.seller_is_treasury)}</td>
                <td className="py-2.5 pr-4 text-foreground">{partyName(t.buyer_member_id, t.buyer_is_treasury)}</td>
                <td className="py-2.5 pr-4 text-foreground">{int(t.shares).toLocaleString()}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{KES(t.price_per_share)}</td>
                <td className="py-2.5 pr-4 font-semibold text-foreground">{KES(t.price)}</td>
                <td className="py-2.5 pr-4 text-muted-foreground text-xs">
                  {num(t.buyer_fee) + num(t.seller_fee) > 0 ? KES(num(t.buyer_fee) + num(t.seller_fee)) : '—'}
                </td>
                <td className="py-2.5 pr-0 text-right whitespace-nowrap">
                  <button onClick={() => { setReason(''); setConfirm({ kind: 'approve', transfer: t }); }}
                    className="text-xs text-emerald-600 font-semibold hover:underline">Approve</button>
                  <button onClick={() => { setReason(''); setConfirm({ kind: 'reject', transfer: t }); }}
                    className="ml-3 text-xs text-red-600 font-semibold hover:underline">Reject</button>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {/* The book */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card title="Sell orders (asks)" subtitle="Shares offered for sale — fill one to buy"
          actions={<PrimaryButton icon="Plus" onClick={() => { openOrderModal(); set('side', 'sell'); }}>Place order</PrimaryButton>}>
          {sellBook.length === 0 ? (
            <EmptyState icon="Store" title="Nothing offered for sale"
              hint="Members — or the treasury — list shares here; a buyer fills the order and the engine settles it." />
          ) : (
            <Table columns={['Seller', 'Shares', 'Price/share', 'Total', 'Expires', '']}>
              {sellBook.map((l) => <OrderRow key={l.id} l={l} side="sell" />)}
            </Table>
          )}
        </Card>

        <Card title="Buy orders (bids)" subtitle="Members waiting to buy — fill one to sell to them"
          actions={<GhostButton icon="Plus" onClick={() => { openOrderModal(); set('side', 'buy'); }}>Place bid</GhostButton>}>
          {buyBook.length === 0 ? (
            <EmptyState icon="ShoppingCart" title="No buyers waiting"
              hint="A member who wants shares can post a bid at their price and wait for a seller." />
          ) : (
            <Table columns={['Buyer', 'Shares', 'Price/share', 'Total', 'Expires', '']}>
              {buyBook.map((l) => <OrderRow key={l.id} l={l} side="buy" />)}
            </Table>
          )}
        </Card>
      </div>

      {/* Settled trades */}
      <Card title="Trade tape" subtitle={`${settled.length} settled trade${settled.length === 1 ? '' : 's'}`}
        actions={settled.length > 0 && (
          <GhostButton icon="Download" onClick={() => exportCSV(settled.map((t) => ({
            date: String(t.settled_at || t.created_at).slice(0, 10),
            seller: partyName(t.seller_member_id, t.seller_is_treasury),
            buyer: partyName(t.buyer_member_id, t.buyer_is_treasury),
            shares: t.shares, price_per_share: t.price_per_share, total: t.price,
            buyer_fee: t.buyer_fee, seller_fee: t.seller_fee, type: t.trade_type,
          })), 'share_trades')}>Export</GhostButton>
        )}>
        {settled.length === 0 ? (
          <EmptyState icon="ArrowLeftRight" title="No trades yet"
            hint="Every settled trade lands here as an immutable record — reversible, never deletable." />
        ) : (
          <Table columns={['Settled', 'Seller', 'Buyer', 'Shares', 'Price/share', 'Total', 'Type', '']}>
            {settled.slice(0, 100).map((t) => (
              <tr key={t.id} className="border-b border-border/60">
                <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">{fmtDate(t.settled_at || t.created_at)}</td>
                <td className="py-2.5 pr-4 text-foreground">{partyName(t.seller_member_id, t.seller_is_treasury)}</td>
                <td className="py-2.5 pr-4 text-foreground">{partyName(t.buyer_member_id, t.buyer_is_treasury)}</td>
                <td className="py-2.5 pr-4 text-foreground">{int(t.shares).toLocaleString()}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{KES(t.price_per_share)}</td>
                <td className="py-2.5 pr-4 font-semibold text-foreground">{KES(t.price)}</td>
                <td className="py-2.5 pr-4 text-xs text-muted-foreground capitalize">{t.trade_type || 'market'}</td>
                <td className="py-2.5 pr-0 text-right">
                  {t.trade_type !== 'reversal' && (
                    <button onClick={() => { setReason(''); setConfirm({ kind: 'reverse', transfer: t }); }}
                      className="text-xs text-red-600 font-semibold hover:underline">Reverse</button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Closed orders */}
      {closed.length > 0 && (
        <Card title="Closed orders" subtitle="Filled, withdrawn and expired">
          <Table columns={['Date', 'Side', 'Party', 'Shares', 'Filled', 'Price', 'Status', 'Note']}>
            {closed.slice(0, 50).map((l) => (
              <tr key={l.id} className="border-b border-border/60">
                <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">{fmtDate(l.created_at)}</td>
                <td className="py-2.5 pr-4 text-foreground capitalize">{l.side || 'sell'}</td>
                <td className="py-2.5 pr-4 text-foreground">
                  {(l.side || 'sell') === 'sell'
                    ? partyName(l.seller_member_id, l.seller_is_treasury)
                    : partyName(l.buyer_member_id, l.buyer_is_treasury)}
                </td>
                <td className="py-2.5 pr-4 text-muted-foreground">{int(l.shares).toLocaleString()}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{int(l.filled_shares).toLocaleString()}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{KES(l.price_per_share)}</td>
                <td className="py-2.5 pr-4"><Badge status={l.status} /></td>
                <td className="py-2.5 pr-4 text-xs text-muted-foreground max-w-[180px] truncate">{l.cancel_reason || '—'}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {/* ── Place order ── */}
      <Modal open={orderOpen} onClose={() => setOrderOpen(false)}
        title={form.side === 'sell' ? 'Place a sell order' : 'Place a buy order'}
        footer={<>
          <GhostButton onClick={() => setOrderOpen(false)}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={submitOrder} disabled={saving}>{saving ? 'Placing…' : 'Place order'}</PrimaryButton>
        </>}>
        <p className="text-sm text-muted-foreground mb-4">
          {form.side === 'sell'
            ? 'The shares are escrowed the moment the order goes live, so the same share can never be listed twice.'
            : 'A bid sits on the book until a seller fills it. Nothing is reserved until it matches.'}
          {s.price_floor_is_par && ` The price floor is par value, ${KES(s.par_value)}.`}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Side">
            <Select value={form.side} onChange={(e) => set('side', e.target.value)}>
              <option value="sell">Sell — offer shares</option>
              <option value="buy">Buy — bid for shares</option>
            </Select>
          </Field>
          <Field label="On behalf of *">
            <Select value={form.as_treasury ? '__treasury__' : form.member_id}
              onChange={(e) => {
                const v = e.target.value;
                set('as_treasury', v === '__treasury__');
                set('member_id', v === '__treasury__' ? '' : v);
              }}>
              <option value="">Select</option>
              {treasury && <option value="__treasury__">SACCO Treasury (the house)</option>}
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}{form.side === 'sell' ? ` — ${freeOf(m.id).toLocaleString()} free` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Shares *"><NumberInput value={form.shares} onChange={(e) => set('shares', e.target.value)} placeholder="500" /></Field>
          <Field label="Price per share (KES) *"><NumberInput value={form.price_per_share} onChange={(e) => set('price_per_share', e.target.value)} /></Field>
          <Field label="Expiry (optional)"><TextInput type="date" value={form.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} /></Field>
        </div>
        {int(form.shares) > 0 && num(form.price_per_share) > 0 && (
          <p className="text-xs text-muted-foreground mt-3">
            Order value <strong className="text-foreground">{KES(int(form.shares) * num(form.price_per_share))}</strong>
            {ov.price > 0 && ` · ${((num(form.price_per_share) / ov.price - 1) * 100).toFixed(1)}% against the ${KES(ov.price)} market price`}
          </p>
        )}
      </Modal>

      {/* ── Fill an order ── */}
      <Modal open={!!taking} onClose={() => setTaking(null)}
        title={taking?.side === 'buy' ? 'Sell into this bid' : 'Buy from this order'}
        footer={<>
          <GhostButton onClick={() => setTaking(null)}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={submitTake} disabled={saving}>
            {saving ? 'Executing…' : (s.auto_settle && !s.require_transfer_approval) ? 'Execute & settle' : 'Execute'}
          </PrimaryButton>
        </>}>
        {taking && (
          <>
            <p className="text-sm text-muted-foreground mb-4">
              {remaining(taking).toLocaleString()} shares available at{' '}
              <strong className="text-foreground">{KES(taking.price_per_share)}</strong> each.
              {' '}{(s.auto_settle && !s.require_transfer_approval)
                ? 'The engine settles this immediately: ownership moves, certificates reissue and the ledger posts.'
                : 'This society reviews trades, so it will land in the approval queue.'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={taking.side === 'buy' ? 'Selling party *' : 'Buying party *'}>
                <Select value={takeForm.as_treasury ? '__treasury__' : takeForm.member_id}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTF('as_treasury', v === '__treasury__');
                    setTF('member_id', v === '__treasury__' ? '' : v);
                  }}>
                  <option value="">Select</option>
                  {treasury && <option value="__treasury__">SACCO Treasury (the house)</option>}
                  {members
                    .filter((m) => m.id !== taking.seller_member_id && m.id !== taking.buyer_member_id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name}{taking.side === 'buy' ? ` — ${freeOf(m.id).toLocaleString()} free` : ''}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label={`Shares (max ${remaining(taking).toLocaleString()}) *`}>
                <NumberInput value={takeForm.shares} onChange={(e) => setTF('shares', e.target.value)}
                  disabled={!s.allow_partial_fills} />
              </Field>
            </div>
            {!s.allow_partial_fills && (
              <p className="text-xs text-muted-foreground mt-2">This society does not allow partial fills — the whole order is taken.</p>
            )}
            {int(takeForm.shares) > 0 && (
              <div className="mt-4 p-3 rounded-lg bg-muted text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Consideration</span>
                  <span className="font-semibold text-foreground">{KES(int(takeForm.shares) * num(taking.price_per_share))}</span></div>
                {num(s.trading_fee_percent) > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Buyer fee ({s.trading_fee_percent}%)</span>
                    <span className="text-foreground">{KES(int(takeForm.shares) * num(taking.price_per_share) * num(s.trading_fee_percent) / 100)}</span></div>
                )}
                {num(s.commission_percent) > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Seller commission ({s.commission_percent}%)</span>
                    <span className="text-foreground">{KES(int(takeForm.shares) * num(taking.price_per_share) * num(s.commission_percent) / 100)}</span></div>
                )}
              </div>
            )}
          </>
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
                ? `${int(editing.filled_shares).toLocaleString()} shares are already filled — the new quantity must stay above that.`
                : 'Adjust the quantity, price or expiry while the order is still open.'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Shares *">
                <NumberInput value={editing.shares} onChange={(e) => setEditing((p) => ({ ...p, shares: e.target.value }))} />
              </Field>
              <Field label="Price per share (KES) *">
                <NumberInput value={editing.price_per_share} onChange={(e) => setEditing((p) => ({ ...p, price_per_share: e.target.value }))} />
              </Field>
              <Field label="Expiry">
                <TextInput type="date" value={editing.expiry_date || ''} onChange={(e) => setEditing((p) => ({ ...p, expiry_date: e.target.value }))} />
              </Field>
            </div>
          </>
        )}
      </Modal>

      {/* ── Approve / reject / reverse ── */}
      <Modal open={!!confirm} onClose={() => setConfirm(null)}
        title={confirm?.kind === 'approve' ? 'Settle this trade'
          : confirm?.kind === 'reject' ? 'Reject this trade' : 'Reverse this trade'}
        footer={<>
          <GhostButton onClick={() => setConfirm(null)}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={runConfirm} disabled={saving}>{saving ? 'Working…' : 'Confirm'}</PrimaryButton>
        </>}>
        {confirm && (
          <>
            <p className="text-sm text-foreground mb-4">
              {int(confirm.transfer.shares).toLocaleString()} shares from{' '}
              <strong>{partyName(confirm.transfer.seller_member_id, confirm.transfer.seller_is_treasury)}</strong> to{' '}
              <strong>{partyName(confirm.transfer.buyer_member_id, confirm.transfer.buyer_is_treasury)}</strong>
              {' '}at {KES(confirm.transfer.price_per_share)} each — total {KES(confirm.transfer.price)}.
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              {confirm.kind === 'approve' && 'Ownership moves, both certificates are reissued and the ledger is posted.'}
              {confirm.kind === 'reject' && 'The shares go back on the book and the escrow is released. Nothing moves.'}
              {confirm.kind === 'reverse' && 'A mirror-image trade settles the shares back. The original trade stays on file exactly as it happened.'}
            </p>
            {confirm.kind !== 'approve' && (
              <Field label={confirm.kind === 'reverse' ? 'Reason *' : 'Reason'}>
                <TextInput value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder={confirm.kind === 'reverse' ? 'e.g. keyed against the wrong member' : 'Optional note for the audit trail'} />
              </Field>
            )}
          </>
        )}
      </Modal>
    </div>
  );
};

export default MarketplacePanel;

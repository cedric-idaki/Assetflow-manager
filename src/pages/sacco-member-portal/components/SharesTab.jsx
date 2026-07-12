import React, { useState } from 'react';
import { useToast } from '../../../components/Toast';
import {
  Card, StatCard, Badge, Table, EmptyState, PrimaryButton, GhostButton,
  Modal, Field, NumberInput, TextInput, KES, fmtDate,
} from '../../sacco-dashboard/components/_shared';

const emptySell = { shares: '', price_per_share: '', expiry_date: '' };

const SharesTab = ({ ctx }) => {
  const { me, shares, listings, transfers, createListing, cancelListing, buyListing, exportCSV } = ctx;
  const toast = useToast();
  const [sellOpen, setSellOpen] = useState(false);
  const [sellForm, setSellForm] = useState(emptySell);
  const [saving, setSaving] = useState(false);
  const [buying, setBuying] = useState(null); // listing pending confirm

  const held = parseInt(shares?.shares_held, 10) || 0;
  const par = parseFloat(shares?.par_value || 0);

  const set = (k, v) => setSellForm((p) => ({ ...p, [k]: v }));

  // Shares currently locked in my open/pending listings.
  const listedShares = listings
    .filter((l) => l.seller_member_id === me?.id && ['open', 'pending_approval'].includes(l.status))
    .reduce((s, l) => s + (parseInt(l.shares, 10) || 0), 0);

  const sell = async () => {
    const qty = parseInt(sellForm.shares, 10) || 0;
    const price = parseFloat(sellForm.price_per_share) || 0;
    if (qty <= 0) { toast.error('Enter the number of shares to sell.'); return; }
    if (qty > held - listedShares) { toast.error(`You can list at most ${held - listedShares} shares (you hold ${held}, ${listedShares} already listed).`); return; }
    if (price < par) { toast.error(`Price may not be below par value (${KES(par)}).`); return; }
    setSaving(true);
    try {
      await createListing(sellForm);
      toast.success('Shares listed on the marketplace.');
      setSellOpen(false);
      setSellForm(emptySell);
    } catch (e) {
      toast.error(e.message || 'Could not create the listing.');
    } finally {
      setSaving(false);
    }
  };

  const confirmBuy = async () => {
    setSaving(true);
    try {
      await buyListing(buying);
      toast.success('Purchase request sent — awaiting administrator approval.');
      setBuying(null);
    } catch (e) {
      toast.error(e.message || 'Could not send the purchase request.');
    } finally {
      setSaving(false);
    }
  };

  const marketListings = listings.filter((l) => l.status === 'open' && l.seller_member_id !== me?.id);
  const myListings = listings.filter((l) => l.seller_member_id === me?.id);
  const myTransfers = transfers;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Shares Held" value={held.toLocaleString()} icon="PieChart" tone="primary" />
        <StatCard label="Par Value" value={KES(par)} icon="Tag" tone="muted" />
        <StatCard label="Total Value" value={KES(held * par)} icon="Wallet" tone="success" />
        <StatCard label="Listed for Sale" value={listedShares.toLocaleString()} icon="Store" tone="warning" />
      </div>

      <Card
        title="Marketplace"
        subtitle="Shares offered by other members — purchases settle after administrator approval"
        actions={<PrimaryButton icon="Store" onClick={() => setSellOpen(true)} disabled={held - listedShares <= 0}>Sell my shares</PrimaryButton>}
      >
        {marketListings.length === 0 ? (
          <EmptyState icon="Store" title="No shares on offer right now" hint="Listings from fellow members appear here." />
        ) : (
          <Table columns={['Seller', 'Shares', 'Price / share', 'Total', 'Expires', '']}>
            {marketListings.map((l) => (
              <tr key={l.id} className="border-b border-border/60">
                <td className="py-2.5 pr-4 text-foreground">{l.seller?.full_name || '—'}</td>
                <td className="py-2.5 pr-4 text-foreground">{l.shares}</td>
                <td className="py-2.5 pr-4 text-foreground">{KES(l.price_per_share)}</td>
                <td className="py-2.5 pr-4 font-medium text-foreground">{KES(l.shares * l.price_per_share)}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(l.expiry_date)}</td>
                <td className="py-2.5 pr-0 text-right">
                  <button onClick={() => setBuying(l)} className="text-xs text-primary font-semibold hover:underline">Buy</button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="My listings">
          {myListings.length === 0 ? (
            <EmptyState icon="Tags" title="You have no listings" />
          ) : (
            <Table columns={['Shares', 'Price / share', 'Expires', 'Status', '']}>
              {myListings.map((l) => (
                <tr key={l.id} className="border-b border-border/60">
                  <td className="py-2.5 pr-4 text-foreground">{l.shares}</td>
                  <td className="py-2.5 pr-4 text-foreground">{KES(l.price_per_share)}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(l.expiry_date)}</td>
                  <td className="py-2.5 pr-4"><Badge status={l.status} /></td>
                  <td className="py-2.5 pr-0 text-right">
                    {l.status === 'open' && (
                      <button onClick={() => cancelListing(l).then(() => toast.success('Listing cancelled.')).catch((e) => toast.error(e.message))}
                        className="text-xs text-red-600 font-semibold hover:underline">Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card
          title="My transfers"
          actions={myTransfers.length > 0 && <GhostButton icon="Download" onClick={() => exportCSV(myTransfers, 'my_share_transfers')}>Export</GhostButton>}
        >
          {myTransfers.length === 0 ? (
            <EmptyState icon="ArrowLeftRight" title="No transfers yet" />
          ) : (
            <Table columns={['Date', 'Direction', 'Shares', 'Price', 'Status']}>
              {myTransfers.map((t) => (
                <tr key={t.id} className="border-b border-border/60">
                  <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(t.created_at)}</td>
                  <td className="py-2.5 pr-4 text-foreground">{t.buyer_member_id === me?.id ? 'Buying' : 'Selling'}</td>
                  <td className="py-2.5 pr-4 text-foreground">{t.shares}</td>
                  <td className="py-2.5 pr-4 text-foreground">{KES(t.price)}</td>
                  <td className="py-2.5 pr-4"><Badge status={t.status} /></td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      {/* Sell modal */}
      <Modal
        open={sellOpen} onClose={() => setSellOpen(false)}
        title="List shares for sale"
        footer={<>
          <GhostButton onClick={() => setSellOpen(false)}>Cancel</GhostButton>
          <PrimaryButton icon="Store" onClick={sell} disabled={saving}>{saving ? 'Listing…' : 'List shares'}</PrimaryButton>
        </>}
      >
        <p className="text-sm text-muted-foreground mb-4">
          You hold {held.toLocaleString()} shares ({listedShares} already listed). Sales settle only after administrator approval.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Number of shares *"><NumberInput value={sellForm.shares} onChange={(e) => set('shares', e.target.value)} /></Field>
          <Field label={`Price per share (min ${KES(par)}) *`}><NumberInput value={sellForm.price_per_share} onChange={(e) => set('price_per_share', e.target.value)} /></Field>
          <Field label="Listing expiry"><TextInput type="date" value={sellForm.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} /></Field>
        </div>
      </Modal>

      {/* Buy confirm */}
      <Modal
        open={!!buying} onClose={() => setBuying(null)}
        title="Confirm purchase request"
        footer={<>
          <GhostButton onClick={() => setBuying(null)}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={confirmBuy} disabled={saving}>{saving ? 'Sending…' : 'Confirm purchase'}</PrimaryButton>
        </>}
      >
        {buying && (
          <p className="text-sm text-foreground">
            Buy <strong>{buying.shares}</strong> shares from <strong>{buying.seller?.full_name || 'a member'}</strong> at{' '}
            <strong>{KES(buying.price_per_share)}</strong> per share — total <strong>{KES(buying.shares * buying.price_per_share)}</strong>.
            The transfer completes once the administrator approves it.
          </p>
        )}
      </Modal>
    </div>
  );
};

export default SharesTab;

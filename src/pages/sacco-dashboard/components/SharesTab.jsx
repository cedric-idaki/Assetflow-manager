import React, { useState } from 'react';
import { useToast } from '../../../components/Toast';
import { Card, StatCard, Table, Badge, PrimaryButton, GhostButton, Modal, Field, TextInput, NumberInput, Select, EmptyState, KES } from './_shared';

const SharesTab = ({ ctx }) => {
  const { shares, listings, transfers, members, saveShares, createListing, requestTransfer, approveTransfer } = ctx;
  const toast = useToast();
  const [holdOpen, setHoldOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [buyListing, setBuyListing] = useState(null);
  const [saving, setSaving] = useState(false);

  const [holdForm, setHoldForm] = useState({ member_id: '', shares_held: '', par_value: '' });
  const [listForm, setListForm] = useState({ seller_member_id: '', shares: '', price_per_share: '', expiry_date: '' });
  const [buyer, setBuyer] = useState('');
  const setHF = (k, v) => setHoldForm((p) => ({ ...p, [k]: v }));
  const setLF = (k, v) => setListForm((p) => ({ ...p, [k]: v }));

  const memberName = (id) => members.find((m) => m.id === id)?.full_name || '—';
  const totalValue = shares.reduce((s, r) => s + (parseInt(r.shares_held, 10) || 0) * parseFloat(r.par_value || 0), 0);
  const totalShares = shares.reduce((s, r) => s + (parseInt(r.shares_held, 10) || 0), 0);

  const saveHolding = async () => {
    if (!holdForm.member_id) { toast.error('Choose a member.'); return; }
    setSaving(true);
    try { await saveShares(holdForm); toast.success('Share holding saved.'); setHoldOpen(false); setHoldForm({ member_id: '', shares_held: '', par_value: '' }); }
    catch (e) { toast.error(e.message || 'Could not save.'); } finally { setSaving(false); }
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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total shares" value={totalShares.toLocaleString()} icon="PieChart" />
        <StatCard label="Total share value" value={KES(totalValue)} icon="TrendingUp" tone="success" />
        <StatCard label="Open listings" value={listings.filter((l) => l.status === 'open').length} icon="Store" tone="muted" />
      </div>

      {/* Holdings */}
      <Card title="Share holdings" subtitle={`${shares.length} shareholders`}
        actions={<PrimaryButton icon="Plus" onClick={() => setHoldOpen(true)}>Set holding</PrimaryButton>}>
        {shares.length === 0 ? (
          <EmptyState icon="PieChart" title="No share holdings" hint="Record each member's shares and par value to enable dividends and trading." />
        ) : (
          <Table columns={['Member', 'Shares', 'Par value', 'Total value']}>
            {shares.map((s) => (
              <tr key={s.id} className="border-b border-border/60">
                <td className="py-2.5 pr-4 font-medium text-foreground">{s.member?.full_name || memberName(s.member_id)}</td>
                <td className="py-2.5 pr-4 text-foreground">{(parseInt(s.shares_held, 10) || 0).toLocaleString()}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{KES(s.par_value)}</td>
                <td className="py-2.5 pr-4 font-semibold text-foreground">{KES((parseInt(s.shares_held, 10) || 0) * parseFloat(s.par_value || 0))}</td>
              </tr>
            ))}
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
          <Field label="Price per share (KES)"><NumberInput value={listForm.price_per_share} onChange={(e) => setLF('price_per_share', e.target.value)} placeholder="120" /></Field>
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

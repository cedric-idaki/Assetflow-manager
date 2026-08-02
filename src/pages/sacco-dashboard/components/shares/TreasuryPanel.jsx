import React, { useState } from 'react';
import { useToast } from '../../../../components/Toast';
import Icon from '../../../../components/AppIcon';
import {
  Card, StatCard, Table, PrimaryButton, GhostButton, Modal, Field,
  TextInput, NumberInput, Select, EmptyState, KES, fmtDate,
} from '../_shared';
import { KESshort, pct, int, num, remaining, isLive, TXN_LABELS, withDefaults } from './_util';

const ACTIONS = [
  { id: 'issue',    label: 'Issue new shares',   icon: 'PlusCircle',  hint: 'Create shares into the treasury — capital expansion.' },
  { id: 'sell',     label: 'Sell from treasury', icon: 'Store',       hint: 'Offer treasury shares on the marketplace.' },
  { id: 'buyback',  label: 'Buy back shares',    icon: 'Undo2',       hint: 'Take shares off a member, straight into treasury stock.' },
  { id: 'allot',    label: 'Transfer to member', icon: 'ArrowRight',  hint: 'Allot treasury shares directly, no marketplace.' },
  { id: 'retire',   label: 'Retire shares',      icon: 'MinusCircle', hint: 'Permanently reduce the shares in circulation.' },
  { id: 'adjust',   label: 'Adjust inventory',   icon: 'Wrench',      hint: 'Correct the treasury count after a stock-take.' },
];

/**
 * Treasury management: everything the society does with its own shares.
 * Each action is a single engine RPC, so the pool, the ledger and the share
 * register move together or not at all.
 */
const TreasuryPanel = ({ ctx, ov }) => {
  const {
    treasury, members, shares, shareSettings, shareTxns = [], listings = [],
    saveTreasury, issueShares, retireShares, adjustTreasury,
    placeOrder, directTransfer, freezeMember, exportCSV,
  } = ctx;
  const toast = useToast();
  const s = withDefaults(shareSettings);

  const [action, setAction] = useState(null);
  const [saving, setSaving] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [freezeFor, setFreezeFor] = useState(null);

  const [form, setForm] = useState({});
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const [setupForm, setSetupForm] = useState({ authorized_shares: '', treasury_shares: '', par_value: '' });
  const setSU = (k, v) => setSetupForm((p) => ({ ...p, [k]: v }));

  const pool = int(treasury?.treasury_shares);
  const authorized = int(treasury?.authorized_shares);
  const frozen = int(treasury?.frozen_shares);
  const houseListed = listings
    .filter((l) => (l.side || 'sell') === 'sell' && l.seller_is_treasury && isLive(l))
    .reduce((sum, l) => sum + remaining(l), 0);
  const free = Math.max(0, pool - houseListed - frozen);

  const memberName = (id) => members.find((m) => m.id === id)?.full_name || '—';
  const holdingOf = (id) => int(shares.find((r) => r.member_id === id)?.shares_held);

  const treasuryTxns = shareTxns.filter((t) => t.is_treasury);

  const openAction = (id) => {
    const price = ov.price > 0 ? String(ov.price) : String(s.par_value || '');
    setForm({
      shares: '', reason: '', price_per_share: price,
      par_value: String(treasury?.par_value || s.par_value || ''),
      member_id: '', expiry_date: '', direction: 'add',
    });
    setAction(id);
  };

  const run = async () => {
    const qty = int(form.shares);
    setSaving(true);
    try {
      if (action === 'issue') {
        if (qty <= 0) throw new Error('Enter how many shares to issue.');
        await issueShares({ shares: qty, par_value: form.par_value, reason: form.reason });
        toast.success(`${qty.toLocaleString()} shares issued into the treasury.`);
      } else if (action === 'sell') {
        if (qty <= 0) throw new Error('Enter how many shares to offer.');
        if (qty > free) throw new Error(`Only ${free.toLocaleString()} treasury shares are free to list.`);
        await placeOrder({
          side: 'sell', shares: qty, price_per_share: form.price_per_share,
          expiry_date: form.expiry_date, as_treasury: true,
        });
        toast.success('Treasury listing is live — every member can buy from the house.');
      } else if (action === 'buyback') {
        if (!form.member_id) throw new Error('Choose the member selling.');
        if (qty <= 0) throw new Error('Enter how many shares to buy back.');
        if (qty > holdingOf(form.member_id)) throw new Error(`${memberName(form.member_id)} holds only ${holdingOf(form.member_id)} shares.`);
        await directTransfer({
          shares: qty, price_per_share: form.price_per_share,
          from_member: form.member_id, to_treasury: true, reason: form.reason,
        });
        toast.success(`Bought back ${qty.toLocaleString()} shares into the treasury.`);
      } else if (action === 'allot') {
        if (!form.member_id) throw new Error('Choose who receives the shares.');
        if (qty <= 0) throw new Error('Enter how many shares to transfer.');
        if (qty > free) throw new Error(`Only ${free.toLocaleString()} treasury shares are free.`);
        await directTransfer({
          shares: qty, price_per_share: form.price_per_share,
          from_treasury: true, to_member: form.member_id, reason: form.reason,
        });
        toast.success(`${qty.toLocaleString()} shares allotted to ${memberName(form.member_id)}.`);
      } else if (action === 'retire') {
        if (qty <= 0) throw new Error('Enter how many shares to retire.');
        await retireShares({ shares: qty, reason: form.reason });
        toast.success(`${qty.toLocaleString()} shares retired — out of circulation for good.`);
      } else if (action === 'adjust') {
        if (qty <= 0) throw new Error('Enter the size of the correction.');
        if (!form.reason?.trim()) throw new Error('An inventory correction needs a reason.');
        await adjustTreasury({ delta: form.direction === 'remove' ? -qty : qty, reason: form.reason });
        toast.success('Treasury inventory corrected.');
      }
      setAction(null);
    } catch (e) {
      toast.error(e.message || 'The treasury action was refused.');
    } finally { setSaving(false); }
  };

  const openSetup = () => {
    setSetupForm({
      authorized_shares: String(treasury?.authorized_shares ?? ''),
      treasury_shares: String(treasury?.treasury_shares ?? ''),
      par_value: String(treasury?.par_value ?? s.par_value ?? ''),
    });
    setSetupOpen(true);
  };

  const saveSetup = async () => {
    const cap = int(setupForm.authorized_shares);
    const poolNext = int(setupForm.treasury_shares);
    if (cap > 0 && cap < ov.memberOwned + poolNext) {
      toast.error(`The authorized cap (${cap.toLocaleString()}) cannot sit below member-held + treasury (${(ov.memberOwned + poolNext).toLocaleString()}).`);
      return;
    }
    setSaving(true);
    try {
      await saveTreasury(setupForm);
      toast.success('Treasury saved.');
      setSetupOpen(false);
    } catch (e) { toast.error(e.message || 'Could not save.'); } finally { setSaving(false); }
  };

  const doFreeze = async () => {
    setSaving(true);
    try {
      await freezeMember(freezeFor.member_id, !freezeFor.is_frozen, form.reason);
      toast.success(freezeFor.is_frozen
        ? 'Holding unfrozen — the member can trade again.'
        : 'Holding frozen. Their open sell orders were withdrawn.');
      setFreezeFor(null);
    } catch (e) { toast.error(e.message || 'Could not change the freeze.'); } finally { setSaving(false); }
  };

  const frozenHoldings = shares.filter((r) => r.is_frozen);

  if (!treasury) {
    return (
      <Card title="Treasury" subtitle="The society's own stock of shares">
        <EmptyState icon="Landmark" title="No treasury yet"
          hint="Record the authorized share cap and the pool the society trades from, then you can issue, sell, buy back and retire shares." />
        <div className="flex justify-center">
          <PrimaryButton icon="Plus" onClick={openSetup}>Set up the treasury</PrimaryButton>
        </div>
        <Modal open={setupOpen} onClose={() => setSetupOpen(false)} title="Treasury setup"
          footer={<>
            <GhostButton onClick={() => setSetupOpen(false)}>Cancel</GhostButton>
            <PrimaryButton icon="Check" onClick={saveSetup} disabled={saving}>{saving ? 'Saving…' : 'Save'}</PrimaryButton>
          </>}>
          <p className="text-sm text-muted-foreground mb-4">
            Members currently hold {ov.memberOwned.toLocaleString()} shares. The treasury pool is everything
            the society itself still holds — unallotted or bought back.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Authorized shares (0 = no cap)"><NumberInput value={setupForm.authorized_shares} onChange={(e) => setSU('authorized_shares', e.target.value)} placeholder="100000" /></Field>
            <Field label="Treasury pool (shares)"><NumberInput value={setupForm.treasury_shares} onChange={(e) => setSU('treasury_shares', e.target.value)} placeholder="15000" /></Field>
            <Field label="Par value (KES)"><NumberInput value={setupForm.par_value} onChange={(e) => setSU('par_value', e.target.value)} placeholder="100" /></Field>
          </div>
        </Modal>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="Treasury pool" value={pool.toLocaleString()} icon="Landmark" tone="primary"
          hint={KESshort(pool * ov.effective)} />
        <StatCard label="Free to trade" value={free.toLocaleString()} icon="Unlock" tone="success"
          hint={houseListed > 0 ? `${houseListed.toLocaleString()} already listed` : 'Nothing listed'} />
        <StatCard label="Authorized cap" value={authorized > 0 ? authorized.toLocaleString() : 'No cap'} icon="Shield" tone="muted"
          hint={authorized > 0 ? `${(authorized - ov.totalIssued).toLocaleString()} unissued` : 'Unlimited'} />
        <StatCard label="Lifetime issued" value={int(treasury.issued_shares).toLocaleString()} icon="PlusCircle" tone="muted" />
        <StatCard label="Lifetime retired" value={int(treasury.retired_shares).toLocaleString()} icon="MinusCircle" tone="muted" />
        <StatCard label="Treasury stake" value={ov.totalIssued > 0 ? pct((pool / ov.totalIssued) * 100, 1) : '—'} icon="PieChart" tone="muted" />
      </div>

      <Card title="Treasury actions" subtitle="Everything the society can do with its own shares"
        actions={<GhostButton icon="Settings" onClick={openSetup}>Treasury settings</GhostButton>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ACTIONS.map((a) => (
            <button key={a.id} onClick={() => openAction(a.id)}
              className="flex items-start gap-3 p-4 rounded-xl border border-border hover:border-primary/40 hover:bg-muted transition-all text-left">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(52,193,221,0.12)' }}>
                <Icon name={a.icon} size={17} color="#1da8c5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{a.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{a.hint}</p>
              </div>
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground mt-4">
          The pool is worth {KES(pool * ov.effective)} at {ov.price > 0 ? 'the current share price' : 'par value'}.
          {' '}Treasury sales and buy-backs post share capital to the Finance Hub ledger automatically.
        </p>
      </Card>

      {/* Frozen holdings live here — freezing is a treasury/registrar action */}
      <Card
        title="Frozen holdings"
        subtitle="Shares locked out of trading while a dispute, estate or order is resolved"
        actions={<GhostButton icon="Snowflake" onClick={() => { setForm({ reason: '' }); setFreezeFor({ member_id: '', is_frozen: false, pick: true }); }}>Freeze a holding</GhostButton>}
      >
        {frozenHoldings.length === 0 ? (
          <EmptyState icon="Unlock" title="No frozen holdings" hint="Every shareholder can trade freely." />
        ) : (
          <Table columns={['Member', 'Shares', 'Reason', 'Frozen since', '']}>
            {frozenHoldings.map((r) => (
              <tr key={r.id} className="border-b border-border/60">
                <td className="py-2.5 pr-4 font-medium text-foreground">{r.member?.full_name || memberName(r.member_id)}</td>
                <td className="py-2.5 pr-4 text-foreground">{int(r.shares_held).toLocaleString()}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{r.freeze_reason || '—'}</td>
                <td className="py-2.5 pr-4 text-muted-foreground">{fmtDate(r.frozen_at)}</td>
                <td className="py-2.5 pr-0 text-right">
                  <button onClick={() => { setForm({ reason: '' }); setFreezeFor(r); }}
                    className="text-xs text-emerald-600 font-semibold hover:underline">Unfreeze</button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Treasury movements" subtitle="Every share that entered or left the society's own pool"
        actions={treasuryTxns.length > 0 && (
          <GhostButton icon="Download" onClick={() => exportCSV(treasuryTxns.map((t) => ({
            date: String(t.created_at).slice(0, 10), txn_no: t.txn_no, type: t.txn_type,
            shares: t.shares, price: t.price_per_share, balance_after: t.balance_after, notes: t.notes,
          })), 'treasury_movements')}>Export</GhostButton>
        )}>
        {treasuryTxns.length === 0 ? (
          <EmptyState icon="History" title="No treasury movements yet"
            hint="Issuing, selling, buying back or retiring shares writes a line here." />
        ) : (
          <Table columns={['Date', 'Ref', 'Movement', 'Shares', 'Price', 'Pool after', 'Note']}>
            {treasuryTxns.slice(0, 60).map((t) => (
              <tr key={t.id} className="border-b border-border/60">
                <td className="py-2.5 pr-4 text-muted-foreground whitespace-nowrap">{fmtDate(t.created_at)}</td>
                <td className="py-2.5 pr-4 text-muted-foreground font-mono text-xs">{t.txn_no}</td>
                <td className="py-2.5 pr-4 text-foreground">{TXN_LABELS[t.txn_type] || t.txn_type}</td>
                <td className={`py-2.5 pr-4 font-semibold ${int(t.shares) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {int(t.shares) > 0 ? '+' : ''}{int(t.shares).toLocaleString()}
                </td>
                <td className="py-2.5 pr-4 text-muted-foreground">{num(t.price_per_share) > 0 ? KES(t.price_per_share) : '—'}</td>
                <td className="py-2.5 pr-4 text-foreground">{int(t.balance_after).toLocaleString()}</td>
                <td className="py-2.5 pr-4 text-muted-foreground text-xs max-w-[220px] truncate">{t.notes || '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* ── Action modal ── */}
      <Modal open={!!action} onClose={() => setAction(null)}
        title={ACTIONS.find((a) => a.id === action)?.label || ''}
        footer={<>
          <GhostButton onClick={() => setAction(null)}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={run} disabled={saving}>{saving ? 'Working…' : 'Confirm'}</PrimaryButton>
        </>}>
        <p className="text-sm text-muted-foreground mb-4">
          {action === 'issue' && `New shares are created into the treasury pool (${pool.toLocaleString()} today). If the authorized cap would be breached it rises with the issue.`}
          {action === 'sell' && `The listing appears on every member's marketplace as “SACCO Treasury”. ${free.toLocaleString()} shares are free to offer.`}
          {action === 'buyback' && 'The society buys the member’s shares at the agreed price. This settles immediately and posts share capital to the ledger.'}
          {action === 'allot' && `Shares move straight from the treasury to the member — no marketplace, no waiting. ${free.toLocaleString()} shares are free.`}
          {action === 'retire' && `Retiring permanently reduces the shares in circulation. ${free.toLocaleString()} treasury shares are free to retire.`}
          {action === 'adjust' && 'A stock-take correction. It is recorded in the audit trail with your reason, exactly as entered.'}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(action === 'buyback' || action === 'allot') && (
            <div className="sm:col-span-2">
              <Field label={action === 'buyback' ? 'Selling member *' : 'Receiving member *'}>
                <Select value={form.member_id} onChange={(e) => set('member_id', e.target.value)}>
                  <option value="">Select member</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name}{action === 'buyback' ? ` — holds ${holdingOf(m.id).toLocaleString()}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}

          <Field label={action === 'adjust' ? 'Correction size (shares) *' : 'Shares *'}>
            <NumberInput value={form.shares} onChange={(e) => set('shares', e.target.value)} placeholder="500" />
          </Field>

          {action === 'adjust' && (
            <Field label="Direction *">
              <Select value={form.direction} onChange={(e) => set('direction', e.target.value)}>
                <option value="add">Add to the pool (shares found)</option>
                <option value="remove">Remove from the pool (shares over-counted)</option>
              </Select>
            </Field>
          )}

          {action === 'issue' && (
            <Field label="Par value (KES)">
              <NumberInput value={form.par_value} onChange={(e) => set('par_value', e.target.value)} placeholder="100" />
            </Field>
          )}

          {['sell', 'buyback', 'allot'].includes(action) && (
            <Field label="Price per share (KES)">
              <NumberInput value={form.price_per_share} onChange={(e) => set('price_per_share', e.target.value)} />
            </Field>
          )}

          {action === 'sell' && (
            <Field label="Listing expiry">
              <TextInput type="date" value={form.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} />
            </Field>
          )}

          {action !== 'sell' && (
            <div className="sm:col-span-2">
              <Field label={action === 'adjust' ? 'Reason *' : 'Reason'}>
                <TextInput value={form.reason} onChange={(e) => set('reason', e.target.value)}
                  placeholder={action === 'issue' ? 'Capital expansion' : action === 'retire' ? 'Treasury stock cancellation' : 'e.g. board resolution 12/2026'} />
              </Field>
            </div>
          )}
        </div>

        {int(form.shares) > 0 && ['sell', 'buyback', 'allot'].includes(action) && (
          <p className="text-xs text-muted-foreground mt-3">
            Total consideration:{' '}
            <strong className="text-foreground">{KES(int(form.shares) * num(form.price_per_share))}</strong>
            {action === 'buyback' && form.member_id && ` · ${memberName(form.member_id)} holds ${holdingOf(form.member_id).toLocaleString()} shares.`}
          </p>
        )}
      </Modal>

      {/* ── Freeze modal ── */}
      <Modal open={!!freezeFor} onClose={() => setFreezeFor(null)}
        title={freezeFor?.is_frozen ? 'Unfreeze holding' : 'Freeze holding'}
        footer={<>
          <GhostButton onClick={() => setFreezeFor(null)}>Cancel</GhostButton>
          <PrimaryButton icon={freezeFor?.is_frozen ? 'Unlock' : 'Snowflake'} onClick={doFreeze} disabled={saving || !freezeFor?.member_id}>
            {saving ? 'Working…' : freezeFor?.is_frozen ? 'Unfreeze' : 'Freeze'}
          </PrimaryButton>
        </>}>
        <p className="text-sm text-muted-foreground mb-4">
          {freezeFor?.is_frozen
            ? 'The member will be able to buy, sell and transfer again.'
            : 'A frozen holding cannot be sold, bought into or transferred, and any open sell orders are withdrawn immediately.'}
        </p>
        {freezeFor?.pick && (
          <Field label="Member *">
            <Select value={freezeFor.member_id} onChange={(e) => setFreezeFor((p) => ({ ...p, member_id: e.target.value }))}>
              <option value="">Select member</option>
              {shares.filter((r) => !r.is_frozen && int(r.shares_held) > 0).map((r) => (
                <option key={r.id} value={r.member_id}>
                  {r.member?.full_name || memberName(r.member_id)} — {int(r.shares_held).toLocaleString()} shares
                </option>
              ))}
            </Select>
          </Field>
        )}
        {!freezeFor?.is_frozen && (
          <div className="mt-4">
            <Field label="Reason *">
              <TextInput value={form.reason} onChange={(e) => set('reason', e.target.value)}
                placeholder="e.g. ownership disputed pending probate" />
            </Field>
          </div>
        )}
      </Modal>

      {/* ── Treasury settings ── */}
      <Modal open={setupOpen} onClose={() => setSetupOpen(false)} title="Treasury settings"
        footer={<>
          <GhostButton onClick={() => setSetupOpen(false)}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={saveSetup} disabled={saving}>{saving ? 'Saving…' : 'Save'}</PrimaryButton>
        </>}>
        <p className="text-sm text-muted-foreground mb-4">
          Members hold {ov.memberOwned.toLocaleString()} shares; the treasury holds {pool.toLocaleString()}.
          Editing the pool here is a straight correction — use <strong>Issue</strong> or <strong>Retire</strong>
          {' '}when you want the movement recorded as a real event.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Authorized shares (0 = no cap)"><NumberInput value={setupForm.authorized_shares} onChange={(e) => setSU('authorized_shares', e.target.value)} placeholder="100000" /></Field>
          <Field label="Treasury pool (shares)"><NumberInput value={setupForm.treasury_shares} onChange={(e) => setSU('treasury_shares', e.target.value)} placeholder="15000" /></Field>
          <Field label="Par value (KES)"><NumberInput value={setupForm.par_value} onChange={(e) => setSU('par_value', e.target.value)} placeholder="100" /></Field>
        </div>
      </Modal>
    </div>
  );
};

export default TreasuryPanel;

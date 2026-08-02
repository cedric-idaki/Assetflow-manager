import React, { useEffect, useState } from 'react';
import { useToast } from '../../../../components/Toast';
import Icon from '../../../../components/AppIcon';
import {
  Card, PrimaryButton, GhostButton, Modal, Field, TextInput, NumberInput, Select, KES,
} from '../_shared';
import { withDefaults, DAY_NAMES, marketIsOpen, num } from './_util';

const Toggle = ({ label, hint, checked, onChange }) => (
  <label className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/60 transition-all">
    <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
    <span>
      <span className="block text-sm font-medium text-foreground">{label}</span>
      <span className="block text-xs text-muted-foreground mt-0.5">{hint}</span>
    </span>
  </label>
);

const Section = ({ title, hint, children }) => (
  <div>
    <p className="text-sm font-semibold text-foreground">{title}</p>
    {hint && <p className="text-xs text-muted-foreground mb-3 mt-0.5">{hint}</p>}
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-3">{children}</div>
  </div>
);

/**
 * Share settings + trading controls — every rule the engine enforces, in one
 * place. Saving sends only the fields that changed, and the database revalidates
 * everything anyway: this screen is the explanation, not the enforcement.
 */
const SettingsPanel = ({ ctx, ov }) => {
  const { shareSettings, saveShareSettings, setTradingSuspended } = ctx;
  const toast = useToast();
  const live = withDefaults(shareSettings);

  const [form, setForm] = useState(live);
  const [saving, setSaving] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => { setForm(withDefaults(shareSettings)); }, [shareSettings]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const toggleDay = (d) => set('market_days',
    (form.market_days || []).includes(d)
      ? form.market_days.filter((x) => x !== d)
      : [...(form.market_days || []), d].sort());

  const dirty = JSON.stringify(form) !== JSON.stringify(live);

  const save = async () => {
    setSaving(true);
    try {
      // Only what actually changed — the RPC patches column by column.
      const patch = {};
      Object.keys(form).forEach((k) => {
        if (JSON.stringify(form[k]) !== JSON.stringify(live[k])) patch[k] = form[k];
      });
      delete patch.trading_suspended;   // owned by the suspend control
      delete patch.suspension_reason;
      if (Object.keys(patch).length === 0) { toast.success('Nothing to save.'); return; }
      await saveShareSettings(patch);
      toast.success('Share settings saved — the engine enforces them from now on.');
    } catch (e) { toast.error(e.message || 'Could not save the settings.'); } finally { setSaving(false); }
  };

  const doSuspend = async () => {
    setSaving(true);
    try {
      await setTradingSuspended(!live.trading_suspended, reason);
      toast.success(live.trading_suspended ? 'Trading resumed.' : 'Trading suspended across the society.');
      setSuspendOpen(false); setReason('');
    } catch (e) { toast.error(e.message || 'Could not change trading.'); } finally { setSaving(false); }
  };

  const open = marketIsOpen(shareSettings);

  return (
    <div className="space-y-6">
      {/* Trading controls sit above the rules — they are the emergency brake */}
      <Card title="Trading controls" subtitle="Immediate, society-wide">
        <div className={`flex flex-wrap items-center gap-4 p-4 rounded-xl border ${
          live.trading_suspended ? 'bg-red-50 border-red-200' : open ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
          <Icon name={live.trading_suspended ? 'Ban' : open ? 'CircleCheck' : 'Clock'} size={22}
            color={live.trading_suspended ? '#dc2626' : open ? '#059669' : '#ca8a04'} />
          <div className="flex-1 min-w-[240px]">
            <p className="text-sm font-semibold text-foreground">
              {live.trading_suspended ? 'Trading is suspended' : open ? 'Market is open' : 'Market is closed (outside hours)'}
            </p>
            <p className="text-xs text-muted-foreground">
              {live.trading_suspended
                ? (live.suspension_reason || 'No orders can be placed, edited or filled by anyone.')
                : `${ov.openOrders.length} open order${ov.openOrders.length === 1 ? '' : 's'} · ${ov.pendingTransfers.length} awaiting approval`}
            </p>
          </div>
          {live.trading_suspended ? (
            <PrimaryButton icon="Play" onClick={() => { setReason(''); setSuspendOpen(true); }}>Resume trading</PrimaryButton>
          ) : (
            <GhostButton icon="Ban" onClick={() => { setReason(''); setSuspendOpen(true); }}>Suspend trading</GhostButton>
          )}
        </div>
      </Card>

      <Card
        title="Share settings"
        subtitle="The rules the trading engine enforces on every order"
        actions={(
          <div className="flex items-center gap-2">
            {dirty && <GhostButton icon="Undo2" onClick={() => setForm(live)}>Discard</GhostButton>}
            <PrimaryButton icon="Check" onClick={save} disabled={saving || !dirty}>
              {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
            </PrimaryButton>
          </div>
        )}
      >
        <div className="space-y-7">
          <Section title="Value and holding limits"
            hint="A limit of 0 means no limit. Ownership caps are checked on every purchase before it settles.">
            <Field label="Par value (KES)">
              <NumberInput value={form.par_value} onChange={(e) => set('par_value', e.target.value)} />
            </Field>
            <Field label="Minimum holding (shares)">
              <NumberInput value={form.min_holding} onChange={(e) => set('min_holding', e.target.value)} />
            </Field>
            <Field label="Maximum holding (shares)">
              <NumberInput value={form.max_holding_shares} onChange={(e) => set('max_holding_shares', e.target.value)} />
            </Field>
            <Field label="Maximum holding (% of issue)">
              <NumberInput step="0.001" value={form.max_holding_percent} onChange={(e) => set('max_holding_percent', e.target.value)} />
            </Field>
            <Field label="Lock-in after purchase (days)">
              <NumberInput value={form.lock_in_days} onChange={(e) => set('lock_in_days', e.target.value)} />
            </Field>
            <Field label="Voting rights per share">
              <NumberInput step="0.0001" value={form.votes_per_share} onChange={(e) => set('votes_per_share', e.target.value)} />
            </Field>
          </Section>

          {num(form.max_holding_percent) > 0 && ov.totalIssued > 0 && (
            <p className="-mt-4 text-xs text-muted-foreground">
              At today's issue of {ov.totalIssued.toLocaleString()} shares, the {form.max_holding_percent}% cap is
              {' '}<strong className="text-foreground">{Math.floor(ov.totalIssued * num(form.max_holding_percent) / 100).toLocaleString()} shares</strong> per member.
            </p>
          )}

          <Section title="Fees and commission" hint="Charged on settlement and posted to commission income.">
            <Field label="Trading fee — buyer pays (%)">
              <NumberInput step="0.001" value={form.trading_fee_percent} onChange={(e) => set('trading_fee_percent', e.target.value)} />
            </Field>
            <Field label="Commission — seller pays (%)">
              <NumberInput step="0.001" value={form.commission_percent} onChange={(e) => set('commission_percent', e.target.value)} />
            </Field>
            <Field label="Certificate prefix">
              <TextInput value={form.certificate_prefix} onChange={(e) => set('certificate_prefix', e.target.value)} placeholder="CERT" />
            </Field>
          </Section>

          <Section title="Dividend policy" hint="Applied when a declaration is calculated.">
            <Field label="Dividend formula">
              <Select value={form.dividend_formula} onChange={(e) => set('dividend_formula', e.target.value)}>
                <option value="pro_rata">Pro-rata to shares held</option>
                <option value="per_share">Fixed rate per share</option>
              </Select>
            </Field>
            <Field label="Withholding tax (%)">
              <NumberInput step="0.001" value={form.dividend_tax_percent} onChange={(e) => set('dividend_tax_percent', e.target.value)} />
            </Field>
          </Section>

          <div>
            <p className="text-sm font-semibold text-foreground">Trading rules</p>
            <p className="text-xs text-muted-foreground mb-3 mt-0.5">How orders match and settle.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Toggle label="Settle trades automatically" checked={form.auto_settle}
                onChange={(v) => set('auto_settle', v)}
                hint="The engine moves the shares the moment an order is filled — no admin step." />
              <Toggle label="Require approval for every trade" checked={form.require_transfer_approval}
                onChange={(v) => set('require_transfer_approval', v)}
                hint="Matched trades wait in the approval queue instead of settling." />
              <Toggle label="Allow partial fills" checked={form.allow_partial_fills}
                onChange={(v) => set('allow_partial_fills', v)}
                hint="A buyer may take some of an order and leave the rest on the book." />
              <Toggle label="Price floor at par value" checked={form.price_floor_is_par}
                onChange={(v) => set('price_floor_is_par', v)}
                hint={`No order may be priced below ${KES(form.par_value)}.`} />
              <Toggle label="Allow member-to-member transfers" checked={form.allow_member_transfers}
                onChange={(v) => set('allow_member_transfers', v)}
                hint="Members can gift or transfer shares outside the marketplace." />
              <Toggle label="Require verified KYC to trade" checked={form.require_kyc_to_trade}
                onChange={(v) => set('require_kyc_to_trade', v)}
                hint="Unverified members cannot place or fill orders." />
            </div>
            {form.auto_settle && form.require_transfer_approval && (
              <p className="mt-3 text-xs text-amber-700">
                Approval wins: while “require approval” is on, trades queue for you even with automatic settlement enabled.
              </p>
            )}
          </div>

          <div>
            <p className="text-sm font-semibold text-foreground">Market hours</p>
            <p className="text-xs text-muted-foreground mb-3 mt-0.5">
              Local Kenyan time. Leave both times equal to keep the market open around the clock.
              Staff can always act on a member's behalf, even when the market is closed.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Opens">
                <TextInput type="time" value={String(form.market_open_time).slice(0, 5)}
                  onChange={(e) => set('market_open_time', e.target.value)} />
              </Field>
              <Field label="Closes">
                <TextInput type="time" value={String(form.market_close_time).slice(0, 5)}
                  onChange={(e) => set('market_close_time', e.target.value)} />
              </Field>
              <Field label="Large-trade review threshold (KES)">
                <NumberInput value={form.large_trade_threshold} onChange={(e) => set('large_trade_threshold', e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              {DAY_NAMES.map((d, i) => {
                const on = (form.market_days || []).includes(i);
                return (
                  <button key={d} type="button" onClick={() => toggleDay(i)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                      on ? 'border-primary/40 text-primary bg-primary/10' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      <Modal open={suspendOpen} onClose={() => setSuspendOpen(false)}
        title={live.trading_suspended ? 'Resume trading' : 'Suspend trading'}
        footer={<>
          <GhostButton onClick={() => setSuspendOpen(false)}>Cancel</GhostButton>
          <PrimaryButton icon="Check" onClick={doSuspend} disabled={saving}>{saving ? 'Working…' : 'Confirm'}</PrimaryButton>
        </>}>
        <p className="text-sm text-muted-foreground mb-4">
          {live.trading_suspended
            ? 'Members will be able to place and fill orders again immediately. Orders already on the book are untouched.'
            : 'Nobody — member or staff — can place, edit or fill an order until you resume. Orders already on the book stay there, and nothing already settled is affected.'}
        </p>
        {!live.trading_suspended && (
          <Field label="Reason (shown to members)">
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. suspended pending the AGM revaluation" />
          </Field>
        )}
      </Modal>
    </div>
  );
};

export default SettingsPanel;

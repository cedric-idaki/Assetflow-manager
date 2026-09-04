import React, { useEffect, useState } from 'react';
import { useToast } from '../../../components/Toast';
import Icon from '../../../components/AppIcon';
import {
  Card, PrimaryButton, Field, NumberInput, KES,
} from './_shared';

/**
 * The society's guarantee policy — the exposure cap the member portal enforces.
 *
 * This screen is the explanation, not the enforcement. The rule lives in
 * sacco_loan_guarantee_capacity() and is applied by
 * sacco_loan_guarantee_capacity_block(), which both the review and the confirm
 * steps consult; nothing a member can do reaches those figures from the
 * browser.
 *
 * A society that never opens this card still has a policy: the table defaults
 * (cap on, 1× the member's own deposits and shares, no limit on how many
 * loans). That is why the fallbacks below are the DB defaults, not zeroes —
 * showing 0× for an unsaved policy would misdescribe what the server does.
 */

const DEFAULTS = {
  enforce_exposure_cap: true,
  max_exposure_multiple: 1,
  count_share_value: true,
  max_active_guarantees: 0,
};

const withDefaults = (row) => ({ ...DEFAULTS, ...(row || {}) });

const Toggle = ({ label, hint, checked, onChange }) => (
  <label className="flex items-start gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted/60 transition-all">
    <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
    <span>
      <span className="block text-sm font-medium text-foreground">{label}</span>
      <span className="block text-xs text-muted-foreground mt-0.5">{hint}</span>
    </span>
  </label>
);

const GuaranteePolicyCard = ({ ctx }) => {
  const { guaranteeSettings, saveGuaranteeSettings } = ctx;
  const toast = useToast();
  const live = withDefaults(guaranteeSettings);

  const [form, setForm] = useState(live);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setForm(withDefaults(guaranteeSettings)); }, [guaranteeSettings]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const dirty = Object.keys(DEFAULTS).some((k) => String(form[k]) !== String(live[k]));

  const multiple = parseFloat(form.max_exposure_multiple) || 0;

  const save = async () => {
    if (!(multiple > 0)) { toast.error('The multiple must be greater than zero.'); return; }
    setSaving(true);
    try {
      // Only the columns this card owns, so a stale row read cannot write back
      // anything else.
      await saveGuaranteeSettings({
        enforce_exposure_cap:  !!form.enforce_exposure_cap,
        max_exposure_multiple: multiple,
        count_share_value:     !!form.count_share_value,
        max_active_guarantees: parseInt(form.max_active_guarantees, 10) || 0,
      });
      toast.success('Guarantee policy saved.');
    } catch (e) {
      toast.error(e.message || 'Could not save the policy.');
    } finally {
      setSaving(false);
    }
  };

  // A worked example beats a formula: this is the sentence a member will read.
  const example = 100000;
  const basis = form.count_share_value ? 'deposits and shares' : 'deposits';

  return (
    <Card
      title="Guarantee policy"
      subtitle="How much of their own money a member may stand behind on other members' loans"
      actions={
        <PrimaryButton icon="Save" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save policy'}
        </PrimaryButton>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Toggle
            label="Enforce the exposure cap"
            hint="Off shows members the figures but refuses nothing. On refuses a guarantee that would take them past their limit."
            checked={form.enforce_exposure_cap}
            onChange={(v) => set('enforce_exposure_cap', v)}
          />
          <Toggle
            label="Count share value as security"
            hint="Off backs guarantees on deposits alone — shares are slower to realise."
            checked={form.count_share_value}
            onChange={(v) => set('count_share_value', v)}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Multiple of a member's own security">
            <NumberInput
              step="0.25" min="0.25"
              value={form.max_exposure_multiple}
              onChange={(e) => set('max_exposure_multiple', e.target.value)}
            />
          </Field>
          <Field label="Most guarantees one member may carry (0 = no limit)">
            <NumberInput
              min="0"
              value={form.max_active_guarantees}
              onChange={(e) => set('max_active_guarantees', e.target.value)}
            />
          </Field>
        </div>

        <div className={`flex items-start gap-2 p-3 rounded-lg border ${
          form.enforce_exposure_cap ? 'bg-muted/50 border-border' : 'bg-amber-50 border-amber-200'
        }`}
        >
          <Icon
            name={form.enforce_exposure_cap ? 'Gauge' : 'ShieldOff'} size={15}
            color={form.enforce_exposure_cap ? '#1da8c5' : '#ca8a04'}
          />
          {form.enforce_exposure_cap ? (
            <p className="text-xs text-muted-foreground leading-relaxed">
              A member with {KES(example)} in {basis} may guarantee up to{' '}
              <strong className="text-foreground">{KES(example * (multiple || 0))}</strong> in total
              {parseInt(form.max_active_guarantees, 10) > 0
                ? `, across at most ${parseInt(form.max_active_guarantees, 10)} loan${
                  parseInt(form.max_active_guarantees, 10) === 1 ? '' : 's'}`
                : ', across any number of loans'}. Requests past that are refused when the member tries
              to accept them — they can still read the agreement and decline it.
            </p>
          ) : (
            <p className="text-xs text-amber-700 leading-relaxed">
              <strong>The cap is off.</strong> Members see what they already guarantee and what they are
              worth, but nothing stops them standing behind more than they can cover.
            </p>
          )}
        </div>

        {!guaranteeSettings && (
          <p className="text-xs text-muted-foreground">
            You have not set a policy yet, so these are the defaults already in force. Saving records them.
          </p>
        )}
      </div>
    </Card>
  );
};

export default GuaranteePolicyCard;

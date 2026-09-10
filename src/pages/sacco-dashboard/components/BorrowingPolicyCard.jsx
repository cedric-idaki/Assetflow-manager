import React, { useEffect, useState } from 'react';
import { useToast } from '../../../components/Toast';
import Icon from '../../../components/AppIcon';
import {
  Card, PrimaryButton, Field, NumberInput, KES,
} from './_shared';

/**
 * The society's borrowing multiple — how much a member may borrow against what
 * they hold.
 *
 * This screen is where the number is set; it is not where it is applied. The
 * arithmetic lives in sacco_member_borrowing_capacity() and the refusal in
 * sacco_member_borrowing_block(), which a BEFORE INSERT trigger on sacco_loans
 * runs on every member application. Members insert their own applications
 * under RLS, so a check in the browser would only be advice — the member
 * portal shows the same figures the trigger will use, and nothing more.
 *
 * A society that never opens this card still has a policy: the table defaults
 * (limit off, three times shares, deposits not counted, existing loans netted
 * off). The fallbacks below are those defaults rather than zeroes, because
 * showing 0x for an unsaved policy would misdescribe what the server does.
 */

const DEFAULTS = {
  enforce_borrowing_limit: false,
  borrowing_multiple: 3,
  count_deposits: false,
  net_off_existing_loans: true,
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

const BorrowingPolicyCard = ({ ctx }) => {
  const { borrowingSettings, saveBorrowingSettings } = ctx;
  const toast = useToast();
  const live = withDefaults(borrowingSettings);

  const [form, setForm] = useState(live);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setForm(withDefaults(borrowingSettings)); }, [borrowingSettings]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const dirty = Object.keys(DEFAULTS).some((k) => String(form[k]) !== String(live[k]));

  const multiple = parseFloat(form.borrowing_multiple) || 0;

  const save = async () => {
    if (!(multiple > 0)) { toast.error('The multiple must be greater than zero.'); return; }
    setSaving(true);
    try {
      // Only the columns this card owns, so a stale row read cannot write back
      // anything else.
      await saveBorrowingSettings({
        enforce_borrowing_limit: !!form.enforce_borrowing_limit,
        borrowing_multiple:      multiple,
        count_deposits:          !!form.count_deposits,
        net_off_existing_loans:  !!form.net_off_existing_loans,
      });
      toast.success('Borrowing policy saved.');
    } catch (e) {
      toast.error(e.message || 'Could not save the policy.');
    } finally {
      setSaving(false);
    }
  };

  // A worked example beats a formula: this is the sentence a member will read
  // on the apply screen.
  const example = 100000;
  const basis = form.count_deposits ? 'shares and savings' : 'shares';

  return (
    <Card
      title="Borrowing multiple"
      subtitle="How much a member may borrow against what they hold"
      actions={
        <PrimaryButton icon="Save" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save policy'}
        </PrimaryButton>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={`Multiple of a member's ${basis}`}>
            <NumberInput
              step="0.25" min="0.25"
              value={form.borrowing_multiple}
              onChange={(e) => set('borrowing_multiple', e.target.value)}
            />
          </Field>
          <Toggle
            label="Enforce the limit"
            hint="Off shows members what they are entitled to but refuses nothing. On refuses an application above it."
            checked={form.enforce_borrowing_limit}
            onChange={(v) => set('enforce_borrowing_limit', v)}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Toggle
            label="Count savings as well as shares"
            hint="Off is shares alone. On adds a member's deposit contributions to the basis — share capital is never counted twice."
            checked={form.count_deposits}
            onChange={(v) => set('count_deposits', v)}
          />
          <Toggle
            label="Deduct what they already owe"
            hint="On answers 'how much more may I borrow'. Off treats the multiple as a size limit on each loan instead."
            checked={form.net_off_existing_loans}
            onChange={(v) => set('net_off_existing_loans', v)}
          />
        </div>

        <div className={`flex items-start gap-2 p-3 rounded-lg border ${
          form.enforce_borrowing_limit ? 'bg-muted/50 border-border' : 'bg-amber-50 border-amber-200'
        }`}
        >
          <Icon
            name={form.enforce_borrowing_limit ? 'Gauge' : 'Eye'} size={15}
            color={form.enforce_borrowing_limit ? '#1da8c5' : '#ca8a04'}
          />
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground leading-relaxed">
              A member with {KES(example)} in {basis} may borrow up to{' '}
              <strong className="text-foreground">{KES(example * multiple)}</strong>
              {form.net_off_existing_loans
                ? ', less whatever is still outstanding on their current loans.'
                : ' on any one loan, however much they already owe.'}
            </p>
            {!form.enforce_borrowing_limit && (
              <p className="text-xs text-amber-700 leading-relaxed">
                <strong>The limit is not enforced.</strong> Members see this figure when they apply,
                but an application above it still reaches you for a decision. Turn enforcement on once
                your share register is up to date — a member with no shares recorded has no entitlement
                to compute, and would be refused outright.
              </p>
            )}
          </div>
        </div>

        {!borrowingSettings && (
          <p className="text-xs text-muted-foreground">
            You have not set a policy yet, so these are the defaults already in force. Saving records them.
          </p>
        )}
      </div>
    </Card>
  );
};

export default BorrowingPolicyCard;

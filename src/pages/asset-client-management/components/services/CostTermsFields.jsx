import React from 'react';
import Icon from '../../../../components/AppIcon';
import Input from '../../../../components/ui/Input';
import Select from '../../../../components/ui/Select';
import {
  BILLING_PERIODS,
  PRICING_MODELS,
  describeTerms,
  modelUses,
  pricingModelMeta,
} from '../../../../config/consultancyPricing';

// The unit goes in the label, as on the asset pricing form: a suffix inside a
// number input sits under the browser's spinner.
const UNIT = { money: ' (KES)', percent: ' (%)' };

export const MODEL_OPTIONS = PRICING_MODELS.map(m => ({ value: m.value, label: m.label }));

/**
 * Switching model keeps whatever was typed (switching back finds it again) and
 * gives a recurring model the monthly period it would start with anyway.
 */
export const withModel = (form, model) => ({
  ...form,
  pricing_model: model,
  billing_period: form.billing_period || (modelUses(model, 'billing_period') ? 'monthly' : ''),
});

/**
 * The terms a pricing model asks for, and nothing else.
 *
 * Used for a service's price options and for a client's agreed terms, which
 * are the same ten columns in the database. `value` is a form of strings (see
 * blankTermsForm); `onChange` receives a patch.
 */
const CostTermsFields = ({ value = {}, onChange }) => {
  const meta = pricingModelMeta(value.pricing_model);
  if (!meta) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {meta.fields.map((f) => {
        if (f.kind === 'period') {
          const periods = BILLING_PERIODS.filter(p => !(f.recurringOnly && p.value === 'one_off'));
          return (
            <Select
              key={f.key}
              label={f.label}
              required={f.required}
              options={periods.map(p => ({ value: p.value, label: p.label }))}
              value={value[f.key] || ''}
              onChange={v => onChange({ [f.key]: v })}
              placeholder="How often?"
            />
          );
        }
        const numeric = f.kind !== 'text';
        return (
          <Input
            key={f.key}
            label={`${f.label}${UNIT[f.kind] || ''}`}
            required={f.required}
            type={numeric ? 'number' : 'text'}
            inputMode={numeric ? 'decimal' : undefined}
            min={numeric ? 0 : undefined}
            max={f.kind === 'percent' ? 100 : undefined}
            step={numeric ? 'any' : undefined}
            placeholder={f.placeholder || (f.required ? '' : 'Optional')}
            value={value[f.key] ?? ''}
            onChange={e => onChange({ [f.key]: e.target.value })}
          />
        );
      })}
    </div>
  );
};

/** The terms in words: "KES 30,000 per month · Covers 8 hours per month". */
export const TermsSummary = ({ terms, className = '' }) => {
  const { headline, details } = describeTerms(terms);
  return (
    <p className={`text-sm text-foreground ${className}`}>
      <span className="font-semibold">{headline}</span>
      {details.map(d => (
        <span key={d} className="text-muted-foreground"> · {d}</span>
      ))}
    </p>
  );
};

/** The seven ways to price, as tiles — every option visible at once. */
export const PricingModelPicker = ({ onPick, onCancel }) => (
  <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-3">
    <div className="flex items-center justify-between mb-2">
      <p className="text-xs font-bold text-foreground uppercase tracking-wide">How is it priced?</p>
      {onCancel && (
        <button type="button" onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      )}
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {PRICING_MODELS.map(m => (
        <button
          key={m.value}
          type="button"
          onClick={() => onPick(m.value)}
          className="flex items-start gap-2.5 p-2.5 rounded-lg border border-border bg-card text-left hover:border-primary hover:bg-primary/5 transition-all"
        >
          <span className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Icon name={m.icon} size={16} color="#1A56DB" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">{m.label}</span>
            <span className="block text-xs text-muted-foreground leading-snug">{m.hint}</span>
          </span>
        </button>
      ))}
    </div>
  </div>
);

export default CostTermsFields;

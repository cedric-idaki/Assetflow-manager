import React, { useState } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import Select from '../../../../components/ui/Select';
import CostTermsFields, {
  MODEL_OPTIONS,
  PricingModelPicker,
  TermsSummary,
  withModel,
} from './CostTermsFields';
import {
  blankTermsForm,
  buildTerms,
  pricingModelMeta,
  termsToForm,
  validateTerms,
} from '../../../../config/consultancyPricing';

let _newOptionSeq = 0;

/** One way the service is sold: its model, its terms, and whether it leads. */
const PriceOptionRow = ({ row, isDefault, error, clientCount, onChange, onRemove, onMakeDefault }) => {
  const meta = pricingModelMeta(row.pricing_model);
  return (
    <div
      data-testid="price-option"
      className={`rounded-xl border p-4 space-y-3 ${error ? 'border-red-300 bg-red-50/40' : 'border-border bg-muted/20'}`}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mb-0.5">
          <Icon name={meta?.icon || 'Tag'} size={16} color="#1A56DB" />
        </div>
        <Select
          className="flex-1 min-w-[190px]"
          label="Pricing"
          options={MODEL_OPTIONS}
          value={row.pricing_model}
          onChange={v => onChange(withModel(row, v))}
        />
        <Input
          containerClassName="flex-1 min-w-[150px]"
          label="Label"
          placeholder="Optional, e.g. Standard"
          value={row.label}
          onChange={e => onChange({ label: e.target.value })}
        />
      </div>

      <CostTermsFields value={row} onChange={onChange} />

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <TermsSummary terms={row} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onMakeDefault}
            aria-pressed={isDefault}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
              isDefault
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {isDefault ? '★ Default' : 'Make default'}
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${meta?.label || 'price option'}`}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-all"
          >
            <Icon name="Trash2" size={14} color="currentColor" />
          </button>
        </div>
      </div>

      {clientCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {clientCount} {clientCount === 1 ? 'client was' : 'clients were'} mapped on this option.
          Changing or removing it here does not change what they agreed.
        </p>
      )}
      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1" role="alert">
          <Icon name="AlertCircle" size={12} color="currentColor" /> {error}
        </p>
      )}
    </div>
  );
};

/**
 * Add or edit a service together with its whole price list.
 *
 * The list is saved as a unit (save_consultancy_service), so what is on screen
 * when Save is pressed is exactly the price list afterwards: rows removed here
 * are removed there. Every row is checked against the same rules the database
 * applies before anything is sent.
 */
const ServiceFormModal = ({ service, options = [], categories = [], clientsByOption = {}, onSave, onClose }) => {
  const isEdit = !!service?.id;

  const [form, setForm] = useState({
    name:         service?.name || '',
    service_code: service?.service_code || '',
    category:     service?.category || '',
    description:  service?.description || '',
    is_active:    service ? service.is_active !== false : true,
  });
  const [rows, setRows] = useState(() => options.map(o => ({
    key: o.id, id: o.id, label: o.label || '', is_default: !!o.is_default, ...termsToForm(o),
  })));
  const [picking, setPicking] = useState(options.length === 0);
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  // The first option leads when none is chosen — the database does the same.
  const defaultKey = (rows.find(r => r.is_default) || rows[0])?.key;

  const set = (key, value) => {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(e => ({ ...e, [key]: undefined }));
  };

  const patchRow = (key, patch) => {
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));
    setErrors(e => ({ ...e, [key]: undefined }));
  };

  const addRow = (model) => {
    const key = `new-${++_newOptionSeq}`;
    setRows(rs => [...rs, { key, id: null, label: '', is_default: false, ...blankTermsForm(model) }]);
    setPicking(false);
  };

  const removeRow = (key) => setRows(rs => rs.filter(r => r.key !== key));
  const makeDefault = (key) => setRows(rs => rs.map(r => ({ ...r, is_default: r.key === key })));

  const validate = () => {
    const found = {};
    if (!form.name.trim()) found.name = 'Give the service a name.';
    rows.forEach((r) => {
      const problem = validateTerms(buildTerms(r));
      if (problem) found[r.key] = problem;
    });
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const handleSave = async () => {
    setSaveError('');
    if (!validate()) return;
    setSaving(true);
    try {
      await onSave({
        service: { id: service?.id, ...form },
        costStructures: rows.map(r => ({ ...r, is_default: r.key === defaultKey })),
      });
      onClose();
    } catch (err) {
      setSaveError(err?.message || 'The service could not be saved.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="service-form-title"
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Icon name="Briefcase" size={18} color="#1A56DB" />
            </div>
            <div>
              <h2 id="service-form-title" className="text-base font-bold text-foreground">
                {isEdit ? 'Edit Service' : 'Add Service'}
              </h2>
              <p className="text-xs text-muted-foreground">What you offer, and every way you charge for it</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <section className="space-y-4">
            <p className="text-xs font-bold text-foreground uppercase tracking-wide">Service</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input
                containerClassName="sm:col-span-2"
                label="Service name"
                required
                value={form.name}
                onChange={e => set('name', e.target.value)}
                error={errors.name}
                placeholder="e.g. Tax advisory, Business plan writing"
              />
              <Input
                label="Code"
                value={form.service_code}
                onChange={e => set('service_code', e.target.value)}
                placeholder={isEdit ? '' : 'Auto'}
                hint={isEdit ? undefined : 'Left blank, one is assigned'}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Category"
                list="consultancy-service-categories"
                value={form.category}
                onChange={e => set('category', e.target.value)}
                placeholder="e.g. Tax, Legal, Strategy"
              />
              <datalist id="consultancy-service-categories">
                {categories.map(c => <option key={c} value={c} />)}
              </datalist>
              <div className="space-y-1">
                <p className="block text-sm font-medium text-foreground">Availability</p>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.is_active}
                  aria-label="Offered to clients"
                  onClick={() => set('is_active', !form.is_active)}
                  className="flex items-center gap-3 h-[38px]"
                >
                  <span className={`w-10 h-6 rounded-full transition-colors flex items-center px-0.5 ${
                    form.is_active ? 'bg-primary justify-end' : 'bg-muted justify-start'}`}
                  >
                    <span className="w-5 h-5 rounded-full bg-white shadow" />
                  </span>
                  <span className="text-sm text-foreground">
                    {form.is_active ? 'Offered to clients' : 'Retired — kept on record, not offered'}
                  </span>
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="consultancy-service-description" className="block text-sm font-medium text-foreground">
                Description
              </label>
              <textarea
                id="consultancy-service-description"
                rows={3}
                value={form.description}
                onChange={e => set('description', e.target.value)}
                placeholder="What the client gets — scope, deliverables, typical timeline"
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
              />
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-foreground uppercase tracking-wide">Price options</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Add every way this service is sold. A client is mapped on one of these and keeps
                  the terms they agreed, even if you change the price here later.
                </p>
              </div>
              {!picking && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPicking(true)}
                  icon={<Icon name="Plus" size={14} color="currentColor" />}
                >
                  Add price option
                </Button>
              )}
            </div>

            {rows.map(row => (
              <PriceOptionRow
                key={row.key}
                row={row}
                isDefault={row.key === defaultKey}
                error={errors[row.key]}
                clientCount={row.id ? clientsByOption[row.id] || 0 : 0}
                onChange={patch => patchRow(row.key, patch)}
                onRemove={() => removeRow(row.key)}
                onMakeDefault={() => makeDefault(row.key)}
              />
            ))}

            {picking && (
              <PricingModelPicker
                onPick={addRow}
                onCancel={rows.length > 0 ? () => setPicking(false) : undefined}
              />
            )}
            {!picking && rows.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No price options yet. A service can be saved without one and priced per client when mapped.
              </p>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex-shrink-0 space-y-3">
          {saveError && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-sm" role="alert">
              <Icon name="AlertCircle" size={16} color="currentColor" className="mt-0.5 flex-shrink-0" />
              <span>{saveError}</span>
            </div>
          )}
          <div className="flex items-center justify-end gap-3">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} loading={saving}>
              {isEdit ? 'Save changes' : 'Save service'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ServiceFormModal;

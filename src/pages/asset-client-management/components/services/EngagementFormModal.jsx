import React, { useMemo, useState } from 'react';
import Icon from '../../../../components/AppIcon';
import Button from '../../../../components/ui/Button';
import Input from '../../../../components/ui/Input';
import Select from '../../../../components/ui/Select';
import CostTermsFields, { MODEL_OPTIONS, TermsSummary, withModel } from './CostTermsFields';
import {
  ENGAGEMENT_STATUSES,
  blankTermsForm,
  buildTerms,
  describeTerms,
  isCurrentEngagement,
  pricingModelLabel,
  termsDiffer,
  termsToForm,
  validateTerms,
} from '../../../../config/consultancyPricing';

export const CUSTOM_TERMS = 'custom';

/** Today in Kenya, as the yyyy-mm-dd a date input holds. */
const todayInNairobi = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());

const optionLabel = (o) => `${pricingModelLabel(o.pricing_model)}${o.label ? ` — ${o.label}` : ''}`;

/**
 * Map a client to a service, or change an existing mapping.
 *
 * The client is put on one of the service's price options, and the terms are
 * COPIED from it — then they may be adjusted for this client. What is saved is
 * what this client agreed, so a later change to the price list never re-prices
 * them. "Custom terms" is for a client on a deal the price list does not hold.
 */
const EngagementFormModal = ({
  engagement,
  presetServiceId,
  services = [],
  optionsByService = {},
  engagementsByService = {},
  clients = [],
  onSave,
  onDelete,
  onClose,
}) => {
  const isEdit = !!engagement?.id;

  const defaultOptionFor = (serviceId) => {
    const opts = optionsByService[serviceId] || [];
    return opts.find(o => o.is_default) || opts[0] || null;
  };

  const startService = engagement?.service_id || presetServiceId || '';
  const startOption = engagement ? null : defaultOptionFor(startService);

  const [serviceId, setServiceId] = useState(startService);
  const [clientId, setClientId] = useState(engagement?.client_id || '');
  const [optionId, setOptionId] = useState(() => {
    if (engagement) return engagement.cost_structure_id || CUSTOM_TERMS;
    if (startOption) return startOption.id;
    return startService ? CUSTOM_TERMS : '';
  });
  const [terms, setTerms] = useState(() => {
    if (engagement) return termsToForm(engagement);
    return startOption ? termsToForm(startOption) : blankTermsForm('');
  });
  const [adjusting, setAdjusting] = useState(false);
  const [status, setStatus] = useState(engagement?.status || 'active');
  const [startDate, setStartDate] = useState(engagement?.start_date || todayInNairobi());
  const [endDate, setEndDate] = useState(engagement?.end_date || '');
  const [notes, setNotes] = useState(engagement?.notes || '');
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState(false);

  const serviceOptions = useMemo(() => services
    .filter(s => s.is_active || s.id === engagement?.service_id)
    .map(s => ({
      value: s.id,
      label: `${s.name} (${s.service_code})`,
      description: s.is_active ? s.category || undefined : 'Retired',
    })), [services, engagement?.service_id]);

  const clientOptions = useMemo(() => {
    const list = clients.map(c => ({
      value: c._id,
      label: `${c.fullName} (${c.accountNumber})`,
      description: c.email || undefined,
    }));
    // The client of an existing mapping is always choosable, even if the
    // page's client list has not caught up with them.
    if (engagement?.client && !list.some(o => o.value === engagement.client_id)) {
      list.unshift({
        value: engagement.client_id,
        label: `${engagement.client.full_name} (${engagement.client.account_number})`,
      });
    }
    return list;
  }, [clients, engagement]);

  const priceOptions = optionsByService[serviceId] || [];
  const chosenOption = priceOptions.find(o => o.id === optionId) || null;
  const editingTerms = adjusting || optionId === CUSTOM_TERMS;
  const negotiated = !!chosenOption && termsDiffer(chosenOption, terms);

  // A second current mapping of the same client on the same service is
  // allowed — two projects, or a retainer beside a success fee — but it is
  // also what a double entry looks like, so say so before it is saved.
  const alreadyMapped = (engagementsByService[serviceId] || []).filter(e =>
    e.client_id === clientId && e.id !== engagement?.id && isCurrentEngagement(e.status));

  const clearError = (key) => setErrors(e => ({ ...e, [key]: undefined }));

  const chooseService = (id) => {
    setServiceId(id);
    clearError('service');
    const d = defaultOptionFor(id);
    setOptionId(d ? d.id : CUSTOM_TERMS);
    setTerms(d ? termsToForm(d) : blankTermsForm(''));
    setAdjusting(!d);
    clearError('terms');
  };

  const chooseOption = (id) => {
    setOptionId(id);
    clearError('terms');
    if (id === CUSTOM_TERMS) {
      setAdjusting(true);
      return;
    }
    const o = priceOptions.find(x => x.id === id);
    if (o) {
      setTerms(termsToForm(o));
      setAdjusting(false);
    }
  };

  const validate = () => {
    const found = {};
    if (!serviceId) found.service = 'Choose a service.';
    if (!clientId) found.client = 'Choose a client.';
    const problem = validateTerms(buildTerms(terms));
    if (problem) found.terms = problem;
    if (startDate && endDate && endDate < startDate) found.dates = 'The end date cannot be before the start date.';
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const handleSave = async () => {
    setSaveError('');
    if (!validate()) return;
    setBusy(true);
    try {
      await onSave({
        id: engagement?.id,
        service_id: serviceId,
        client_id: clientId,
        cost_structure_id: optionId === CUSTOM_TERMS ? null : optionId,
        status,
        start_date: startDate,
        end_date: endDate,
        notes,
        terms,
      });
      onClose();
    } catch (err) {
      setSaveError(err?.message || 'The mapping could not be saved.');
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    const who = engagement?.client?.full_name || 'this client';
    if (!window.confirm(`Remove ${who} from this service? The mapping and its agreed terms are deleted.`)) return;
    setSaveError('');
    setBusy(true);
    try {
      await onDelete(engagement.id);
      onClose();
    } catch (err) {
      setSaveError(err?.message || 'The mapping could not be removed.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="engagement-form-title"
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Icon name="UserPlus" size={18} color="#1A56DB" />
            </div>
            <div>
              <h2 id="engagement-form-title" className="text-base font-bold text-foreground">
                {isEdit ? 'Client Service Mapping' : 'Map Client to Service'}
              </h2>
              <p className="text-xs text-muted-foreground">Who takes the service, and on what terms</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <Select
            label="Service"
            required
            searchable
            options={serviceOptions}
            value={serviceId}
            onChange={chooseService}
            error={errors.service}
            placeholder="Choose a service"
          />
          <Select
            label="Client"
            required
            searchable
            options={clientOptions}
            value={clientId}
            onChange={(v) => { setClientId(v); clearError('client'); }}
            error={errors.client}
            placeholder={clientOptions.length ? 'Search and choose a client' : 'No clients yet — add one in the Clients tab'}
          />
          {alreadyMapped.length > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
              <Icon name="Info" size={14} color="currentColor" className="mt-0.5 flex-shrink-0" />
              <span>
                This client already has {alreadyMapped.length === 1 ? 'a current mapping' : `${alreadyMapped.length} current mappings`} on
                this service ({alreadyMapped.map(e => describeTerms(e).headline).join('; ')}). Saving adds another.
              </span>
            </div>
          )}

          {/* Terms */}
          {serviceId && (
            <section className="space-y-3">
              <p className="text-xs font-bold text-foreground uppercase tracking-wide">Terms</p>
              <Select
                label="Price option"
                options={[
                  ...priceOptions.map(o => ({ value: o.id, label: optionLabel(o), description: describeTerms(o).headline })),
                  { value: CUSTOM_TERMS, label: 'Custom terms for this client' },
                ]}
                value={optionId}
                onChange={chooseOption}
              />

              {editingTerms ? (
                <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                  <Select
                    label="Pricing"
                    required
                    options={MODEL_OPTIONS}
                    value={terms.pricing_model}
                    onChange={(v) => { setTerms(t => withModel(t, v)); clearError('terms'); }}
                    placeholder="How is this client charged?"
                  />
                  <CostTermsFields
                    value={terms}
                    onChange={(patch) => { setTerms(t => ({ ...t, ...patch })); clearError('terms'); }}
                  />
                  {terms.pricing_model && <TermsSummary terms={terms} />}
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/20 px-4 py-3">
                  <TermsSummary terms={terms} />
                  <button
                    type="button"
                    onClick={() => setAdjusting(true)}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Adjust for this client
                  </button>
                </div>
              )}
              {negotiated && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Icon name="Handshake" size={12} color="currentColor" />
                  Negotiated — differs from the listed price ({describeTerms(chosenOption).headline}).
                </p>
              )}
              {errors.terms && (
                <p className="text-xs text-red-600 flex items-center gap-1" role="alert">
                  <Icon name="AlertCircle" size={12} color="currentColor" /> {errors.terms}
                </p>
              )}
            </section>
          )}

          {/* Status and dates */}
          <section className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select
                label="Status"
                options={ENGAGEMENT_STATUSES.map(s => ({ value: s.value, label: s.label }))}
                value={status}
                onChange={setStatus}
              />
              <Input
                label="Start date"
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); clearError('dates'); }}
              />
              <Input
                label="End date"
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => { setEndDate(e.target.value); clearError('dates'); }}
                error={errors.dates}
                hint="Optional"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="engagement-notes" className="block text-sm font-medium text-foreground">Notes</label>
              <textarea
                id="engagement-notes"
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Scope agreed, reference, contact person…"
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
              />
            </div>
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
          <div className="flex items-center gap-3">
            {isEdit && onDelete && (
              <Button variant="ghost" onClick={handleDelete} disabled={busy} className="text-red-600">
                <Icon name="Trash2" size={14} color="currentColor" /> Remove
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} loading={busy}>
              {isEdit ? 'Save changes' : 'Map client'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EngagementFormModal;

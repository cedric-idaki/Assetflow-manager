import React, { useState, useMemo, useId } from 'react';
import Icon from '../../../components/AppIcon';
import PricingTierCard from './PricingTierCard';
import InvoiceBreakdown from './InvoiceBreakdown';
import {
  CLIENT_TYPE,
  tiersFor,
  defaultTierFor,
  productLineFor,
  quoteSubscription,
} from '../../../config/subscriptionPricing';
import { PRESETS, modulesForScope } from '../../../config/modules';
import { includedModules, moduleFeeFor } from '../../../config/systemBilling';

/**
 * Quote a subscription the way the client will actually be billed.
 *
 * Every figure on this screen comes from buildSystemInvoice(), the same engine
 * that prices the registration quote, both invoice renderers and the
 * server-side M-Pesa amount check — so a quote made here and the invoice the
 * client receives cannot disagree. The five components of a bill are all
 * present and all visible: base system price, user/member charges, additional
 * modules, installation, and VAT.
 */

const NumberInput = ({ label, value, onChange, min = 0, icon, hint }) => {
  // The label has to be bound to the field it names, or a screen reader
  // announces an unlabelled number box.
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="text-xs text-muted-foreground font-medium flex items-center gap-1.5"
      >
        <Icon name={icon} size={12} color="currentColor" />
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        value={value}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange(Math.max(min, parseInt(e.target.value, 10) || 0))}
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      {hint && (
        <p id={hintId} className="text-[11px] text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
};

const Toggle = ({ checked, onChange, label, hint }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className="w-full flex items-start gap-2.5 text-left px-3 py-2.5 rounded-lg border border-border hover:border-primary/40 transition-colors"
  >
    <span
      className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border ${
        checked ? 'bg-primary border-primary' : 'border-border bg-background'
      }`}
    >
      {checked && <Icon name="Check" size={11} color="#fff" />}
    </span>
    <span className="min-w-0">
      <span className="block text-xs font-semibold text-foreground">{label}</span>
      {hint && <span className="block text-[11px] text-muted-foreground mt-0.5">{hint}</span>}
    </span>
  </button>
);

const SubscriptionCalculator = () => {
  const [clientType, setClientType] = useState(CLIENT_TYPE.CORPORATE);
  const [selectedTier, setSelectedTier] = useState(defaultTierFor(CLIENT_TYPE.CORPORATE));
  const [autoTier, setAutoTier] = useState(true);
  const [seats, setSeats] = useState(10);
  const [storageGb, setStorageGb] = useState(0);
  const [firstInvoice, setFirstInvoice] = useState(true);

  const isCorporate = clientType === CLIENT_TYPE.CORPORATE;
  const productLine = productLineFor(clientType);
  const tiers = tiersFor(clientType);

  // Modules start at the preset the product line ships with, so the quote
  // reflects a real portal rather than an empty one.
  const [modules, setModules] = useState(PRESETS.company);

  const available = useMemo(() => modulesForScope(productLine), [productLine]);
  const bundled = useMemo(() => includedModules(productLine), [productLine]);

  const switchType = (value) => {
    setClientType(value);
    setSelectedTier(defaultTierFor(value));
    setModules(PRESETS[productLineFor(value)] || PRESETS.custom);
    setSeats(value === CLIENT_TYPE.SACCO ? 50 : 10);
  };

  const toggleModule = (key) =>
    setModules((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  // The quote. `tierId` is passed only when the operator has overridden the
  // automatic bracket, so by default the tier follows the seat count exactly
  // as it will on the real invoice.
  const quote = quoteSubscription({
    clientType,
    tierId: autoTier ? null : selectedTier,
    seats,
    modules,
    storageGb,
    chargeInstallation: firstInvoice,
  });

  const activeTierId = quote.tier?.id || selectedTier;
  const extras = modules.filter((k) => !bundled.includes(k));

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Subscription Calculator</h2>
          <p className="text-xs text-muted-foreground">
            Priced by the live billing engine — the same one that raises the invoice
          </p>
        </div>
        <Icon name="Calculator" size={18} color="var(--color-primary)" />
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ── Configuration ───────────────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-6">
          {/* Step 1 — Client type */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Step 1 · Client Type
            </p>
            <div className="flex gap-2">
              {[
                { value: CLIENT_TYPE.CORPORATE, label: 'Corporate', icon: 'Building2' },
                { value: CLIENT_TYPE.SACCO, label: 'SACCO', icon: 'Users' },
              ].map(({ value, label, icon }) => (
                <button
                  key={value}
                  onClick={() => switchType(value)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-semibold transition-all ${
                    clientType === value
                      ? 'border-primary bg-primary text-white'
                      : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                  }`}
                >
                  <Icon name={icon} size={14} color="currentColor" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Step 2 — Quantity */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Step 2 · Configure Quantity
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <NumberInput
                label={isCorporate ? 'Licensed Users' : 'Active SACCO Members'}
                value={seats}
                onChange={setSeats}
                min={0}
                icon={isCorporate ? 'User' : 'Users'}
                hint={
                  quote.minimumApplied
                    ? `Billed on ${quote.billedSeats} — the minimum for this line`
                    : null
                }
              />
              <NumberInput
                label="Storage Used (GB)"
                value={storageGb}
                onChange={setStorageGb}
                min={0}
                icon="HardDrive"
                hint={quote.tier ? `${quote.tier.storageGb} GB included on ${quote.tier.name}` : null}
              />
            </div>
          </div>

          {/* Step 3 — Tier */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Step 3 · Tier
              </p>
              <button
                onClick={() => setAutoTier((v) => !v)}
                className={`text-[11px] font-semibold px-2 py-1 rounded-md border transition-colors ${
                  autoTier
                    ? 'border-primary/40 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {autoTier ? 'Auto — from headcount' : 'Manual override'}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {Object.entries(tiers).map(([key, tier]) => (
                <PricingTierCard
                  key={key}
                  tier={tier}
                  type={clientType}
                  isSelected={activeTierId === key}
                  onSelect={() => {
                    setAutoTier(false);
                    setSelectedTier(key);
                  }}
                />
              ))}
            </div>
          </div>

          {/* Step 4 — Modules */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Step 4 · Modules
              <span className="ml-2 normal-case font-normal text-[11px]">
                {extras.length} beyond the plan bundle
              </span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {available.map((m) => {
                const on = modules.includes(m.key);
                const isExtra = on && !bundled.includes(m.key);
                const fee = moduleFeeFor(m.key);
                const title = bundled.includes(m.key)
                  ? 'Bundled with this plan'
                  : fee > 0
                    ? `Additional module — KES ${fee}/month`
                    : 'Additional module — included at no extra charge';
                return (
                  <button
                    key={m.key}
                    onClick={() => toggleModule(m.key)}
                    title={title}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-all ${
                      on
                        ? isExtra
                          ? 'border-primary/50 text-primary bg-primary/5'
                          : 'border-border bg-muted/50 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/30'
                    }`}
                  >
                    <Icon name={on ? 'Check' : 'Plus'} size={10} color="currentColor" />
                    {m.label}
                    {isExtra && fee > 0 && <span className="font-bold">+{fee}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 5 — Installation */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Step 5 · Invoice Type
            </p>
            <Toggle
              checked={firstInvoice}
              onChange={setFirstInvoice}
              label="First invoice — charge installation & onboarding"
              hint="One-time fee. Untick to quote a renewal, which must never re-charge it."
            />
          </div>
        </div>

        {/* ── The bill ────────────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <div className="lg:sticky lg:top-4 space-y-3">
            <InvoiceBreakdown quote={quote} productLine={productLine} modules={modules} />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {firstInvoice
                ? 'First invoice — installation is charged once. The recurring amount is this total less installation and its VAT.'
                : 'Recurring monthly invoice.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionCalculator;

import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import PricingTierCard from './PricingTierCard';
import InvoiceBreakdown from './InvoiceBreakdown';
import {
  CLIENT_TYPE,
  tiersFor,
  productLineFor,
  quoteSubscription,
} from '../../../config/subscriptionPricing';
import { PRESETS } from '../../../config/modules';

/**
 * Edit an existing subscription and see the invoice it will produce.
 *
 * The preview is a RENEWAL — installation is a one-time charge and an edit
 * must never re-raise it — priced through buildSystemInvoice() so what the
 * operator approves here is what the client is billed.
 */
const EditSubscriptionModal = ({ client, onClose, onSave }) => {
  const [tier, setTier] = useState(client?.tier ?? null);
  const [autoTier, setAutoTier] = useState(true);
  const [seats, setSeats] = useState(client?.seats ?? 0);
  const [storageGb, setStorageGb] = useState(client?.storageGb ?? 0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (client) {
      setTier(client.tier);
      setSeats(client.seats ?? 0);
      setStorageGb(client.storageGb ?? 0);
      setAutoTier(true);
    }
  }, [client]);

  if (!client) return null;

  const isCorporate = client.type === CLIENT_TYPE.CORPORATE;
  const productLine = productLineFor(client.type);
  const tiers = tiersFor(client.type);
  const modules = PRESETS[productLine] || PRESETS.custom;

  const quote = quoteSubscription({
    clientType: client.type,
    tierId: autoTier ? null : tier,
    seats,
    storageGb,
    modules,
    chargeInstallation: false,
  });

  const activeTierId = quote.tier?.id || tier;

  const handleSave = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 600)); // simulate API
    onSave?.({ ...client, tier: activeTierId, seats, storageGb });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
          <div>
            <h2 className="text-base font-semibold text-foreground">Edit Subscription</h2>
            <p className="text-xs text-muted-foreground">{client.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={16} color="var(--color-muted-foreground)" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Client type badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
                isCorporate ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
              }`}
            >
              <Icon name={isCorporate ? 'Building2' : 'Users'} size={12} color="currentColor" />
              {isCorporate ? 'Corporate Client' : 'SACCO Client'}
            </span>
            <span className="text-xs text-muted-foreground">
              · Model cannot be changed after setup
            </span>
          </div>

          {/* Tier selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Tier
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
              {Object.entries(tiers).map(([key, t]) => (
                <PricingTierCard
                  key={key}
                  tier={t}
                  type={client.type}
                  isSelected={activeTierId === key}
                  onSelect={() => {
                    setAutoTier(false);
                    setTier(key);
                  }}
                />
              ))}
            </div>
          </div>

          {/* Quantity */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {isCorporate ? 'Licensed Users' : 'Active SACCO Members'}
              </label>
              <input
                type="number"
                min={0}
                value={seats}
                onChange={(e) => setSeats(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Storage Used (GB)
              </label>
              <input
                type="number"
                min={0}
                value={storageGb}
                onChange={(e) => setStorageGb(Math.max(0, parseInt(e.target.value, 10) || 0))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>

          {/* The invoice this produces */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              New Monthly Invoice
            </p>
            <InvoiceBreakdown quote={quote} productLine={productLine} modules={modules} />
            <p className="text-[11px] text-muted-foreground mt-2">
              Renewal — the one-time installation fee is not re-charged.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2 sticky bottom-0 bg-card">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
          >
            {saving ? (
              <>
                <Icon name="Loader" size={14} color="#fff" className="animate-spin" /> Saving…
              </>
            ) : (
              <>
                <Icon name="Save" size={14} color="#fff" /> Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditSubscriptionModal;

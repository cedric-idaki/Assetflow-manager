import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import PricingTierCard from './PricingTierCard';
import {
  CLIENT_TYPE, TIER,
  CORPORATE_TIERS, SACCO_TIERS,
  calcCorporateTotal, calcSaccoTotal,
} from '../../../config/subscriptionPricing';

const fmt = (n) => `KES ${(n || 0).toLocaleString()}`;

const EditSubscriptionModal = ({ client, onClose, onSave }) => {
  const [tier, setTier]         = useState(client?.tier ?? TIER.BRONZE);
  const [users, setUsers]       = useState(client?.users ?? 10);
  const [members, setMembers]   = useState(client?.members ?? 50);
  const [extra, setExtra]       = useState(client?.extraSignings ?? 0);
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    if (client) {
      setTier(client.tier);
      setUsers(client.users);
      setMembers(client.members);
      setExtra(client.extraSignings);
    }
  }, [client]);

  if (!client) return null;

  const isCorporate = client.type === CLIENT_TYPE.CORPORATE;
  const tiers       = isCorporate ? CORPORATE_TIERS : SACCO_TIERS;

  const result = isCorporate
    ? calcCorporateTotal(tier, users, extra)
    : calcSaccoTotal(tier, members, extra);

  const handleSave = async () => {
    setSaving(true);
    await new Promise(r => setTimeout(r, 600)); // simulate API
    onSave?.({ ...client, tier, users, members, extraSignings: extra });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">

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
          <div className="flex items-center gap-2">
            <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
              isCorporate ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
            }`}>
              <Icon name={isCorporate ? 'Building2' : 'Users'} size={12} color="currentColor" />
              {isCorporate ? 'Corporate Client' : 'SACCO Client'}
            </span>
            <span className="text-xs text-muted-foreground">· Model cannot be changed after setup</span>
          </div>

          {/* Tier selection */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Select Tier</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {Object.entries(tiers).map(([key, t]) => (
                <PricingTierCard
                  key={key}
                  tierKey={key}
                  tier={t}
                  type={client.type}
                  isSelected={tier === key}
                  onSelect={() => setTier(key)}
                />
              ))}
            </div>
          </div>

          {/* Quantity */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {isCorporate ? 'Number of Users' : 'Number of SACCO Members'}
              </label>
              <input
                type="number"
                min={1}
                value={isCorporate ? users : members}
                onChange={e => isCorporate
                  ? setUsers(Math.max(1, parseInt(e.target.value) || 1))
                  : setMembers(Math.max(1, parseInt(e.target.value) || 1))
                }
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Extra External Signings
              </label>
              <input
                type="number"
                min={0}
                value={extra}
                onChange={e => setExtra(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>

          {/* Cost preview */}
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">New Monthly Total</p>
            <p className="text-3xl font-extrabold text-primary">{fmt(result.total)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {isCorporate
                ? `${isCorporate ? users : members} users × KES ${CORPORATE_TIERS[tier]?.pricePerUser?.toLocaleString()}`
                : `KES ${SACCO_TIERS[tier]?.baseFee} base + ${members} members × KES ${SACCO_TIERS[tier]?.perMemberFee}`
              }
              {extra > 0 && ` + ${extra} extra signings`}
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
              <><Icon name="Loader" size={14} color="#fff" className="animate-spin" /> Saving…</>
            ) : (
              <><Icon name="Save" size={14} color="#fff" /> Save Changes</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditSubscriptionModal;

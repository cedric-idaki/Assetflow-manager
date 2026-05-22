import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import PricingTierCard from './PricingTierCard';
import {
  CLIENT_TYPE, TIER,
  CORPORATE_TIERS, SACCO_TIERS,
  EXTRA_SIGNING_COST,
  calcCorporateTotal, calcSaccoTotal,
} from '../../../config/subscriptionPricing';

const fmt = (n) => `KES ${(n || 0).toLocaleString()}`;

const NumberInput = ({ label, value, onChange, min = 0, icon }) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
      <Icon name={icon} size={12} color="currentColor" />
      {label}
    </label>
    <input
      type="number"
      min={min}
      value={value}
      onChange={(e) => onChange(Math.max(min, parseInt(e.target.value) || 0))}
      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40"
    />
  </div>
);

const SummaryRow = ({ label, value, sub, highlight }) => (
  <div className={`flex items-center justify-between py-2 ${highlight ? 'border-t border-border mt-1 pt-3' : ''}`}>
    <div>
      <p className={`text-sm ${highlight ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>{label}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
    <p className={`font-bold ${highlight ? 'text-xl text-primary' : 'text-sm text-foreground'}`}>{value}</p>
  </div>
);

const SubscriptionCalculator = () => {
  const [clientType, setClientType] = useState(CLIENT_TYPE.CORPORATE);
  const [selectedTier, setSelectedTier] = useState(TIER.BRONZE);
  const [users, setUsers] = useState(10);
  const [members, setMembers] = useState(50);
  const [extraSignings, setExtraSignings] = useState(0);

  const tiers    = clientType === CLIENT_TYPE.CORPORATE ? CORPORATE_TIERS : SACCO_TIERS;
  const tierData = tiers[selectedTier];

  const result = clientType === CLIENT_TYPE.CORPORATE
    ? calcCorporateTotal(selectedTier, users, extraSignings)
    : calcSaccoTotal(selectedTier, members, extraSignings);

  const includedSignings = tierData?.externalSignings ?? 0;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Subscription Calculator</h2>
          <p className="text-xs text-muted-foreground">Configure client setup & preview pricing</p>
        </div>
        <Icon name="Calculator" size={18} color="var(--color-primary)" />
      </div>

      <div className="p-5 space-y-6">

        {/* Step 1 — Client type */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Step 1 · Client Type
          </p>
          <div className="flex gap-2">
            {[
              { value: CLIENT_TYPE.CORPORATE, label: 'Corporate', icon: 'Building2' },
              { value: CLIENT_TYPE.SACCO,     label: 'SACCO',     icon: 'Users' },
            ].map(({ value, label, icon }) => (
              <button
                key={value}
                onClick={() => { setClientType(value); setSelectedTier(TIER.BRONZE); }}
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

        {/* Step 2 — Tier */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Step 2 · Select Tier
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {Object.entries(tiers).map(([key, tier]) => (
              <PricingTierCard
                key={key}
                tierKey={key}
                tier={tier}
                type={clientType}
                isSelected={selectedTier === key}
                onSelect={() => setSelectedTier(key)}
              />
            ))}
          </div>
        </div>

        {/* Step 3 — Quantity */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Step 3 · Configure Quantity
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {clientType === CLIENT_TYPE.CORPORATE ? (
              <NumberInput
                label="Number of Users"
                value={users}
                onChange={setUsers}
                min={1}
                icon="User"
              />
            ) : (
              <NumberInput
                label="Number of SACCO Members"
                value={members}
                onChange={setMembers}
                min={1}
                icon="Users"
              />
            )}
            <NumberInput
              label={`Extra External Signings (beyond ${includedSignings} included)`}
              value={extraSignings}
              onChange={setExtraSignings}
              min={0}
              icon="FileSignature"
            />
          </div>
        </div>

        {/* Pricing summary */}
        <div className="bg-muted/40 rounded-xl p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Monthly Cost Breakdown
          </p>

          {clientType === CLIENT_TYPE.CORPORATE ? (
            <>
              <SummaryRow
                label="Subscription fee"
                sub={`${users} users × KES ${tierData?.pricePerUser?.toLocaleString()}/user`}
                value={fmt(result.base)}
              />
            </>
          ) : (
            <>
              <SummaryRow label="Base fee" value={fmt(result.baseFee)} />
              <SummaryRow
                label="Member fees"
                sub={`${members} members × KES ${tierData?.perMemberFee}/member`}
                value={fmt(result.memberFee)}
              />
            </>
          )}

          {extraSignings > 0 && (
            <SummaryRow
              label="Extra document signings"
              sub={`${extraSignings} × KES ${EXTRA_SIGNING_COST}`}
              value={fmt(result.extra)}
            />
          )}

          <SummaryRow label="Total Monthly Subscription" value={fmt(result.total)} highlight />

          <p className="text-xs text-muted-foreground mt-2">
            Includes <strong>{includedSignings}</strong> external document signings/month.
            {clientType === CLIENT_TYPE.CORPORATE && ' Unlimited internal staff accounts.'}
          </p>
        </div>

      </div>
    </div>
  );
};

export default SubscriptionCalculator;

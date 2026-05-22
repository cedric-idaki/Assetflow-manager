import React from 'react';
import Icon from '../../../components/AppIcon';
import { EXTRA_SIGNING_COST } from '../../../config/subscriptionPricing';

const Row = ({ icon, label, value, highlight }) => (
  <div className={`flex items-center justify-between py-2 border-b border-border last:border-0 ${highlight ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
    <span className="flex items-center gap-2 text-xs">
      <Icon name={icon} size={13} color="currentColor" />
      {label}
    </span>
    <span className={`text-xs font-bold ${highlight ? 'text-primary' : 'text-foreground'}`}>{value}</span>
  </div>
);

/**
 * Renders a single pricing tier card (Bronze / Silver / Gold).
 *
 * Props:
 *   tierKey       'bronze' | 'silver' | 'gold'
 *   tier          object from CORPORATE_TIERS or SACCO_TIERS
 *   type          'corporate' | 'sacco'
 *   isSelected    bool
 *   onSelect      fn()
 */
const PricingTierCard = ({ tierKey, tier, type, isSelected, onSelect }) => {
  const isCorporate = type === 'corporate';

  const tierIcons = {
    bronze: 'Award',
    silver: 'Shield',
    gold:   'Crown',
  };

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-xl border-2 p-4 transition-all hover:shadow-md focus:outline-none ${
        isSelected
          ? 'border-primary shadow-md'
          : 'border-border hover:border-primary/40'
      }`}
      style={isSelected ? { background: 'rgba(26,86,219,0.04)' } : { background: 'var(--color-card)' }}
    >
      {/* Tier badge */}
      <div className="flex items-center justify-between mb-3">
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold"
          style={{ background: tier.bg, color: tier.accent }}
        >
          <Icon name={tierIcons[tierKey]} size={12} color={tier.accent} />
          {tier.label}
        </div>
        {isSelected && (
          <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary">
            <Icon name="Check" size={11} color="#fff" />
          </div>
        )}
      </div>

      {/* Price */}
      {isCorporate ? (
        <div className="mb-3">
          <p className="text-2xl font-extrabold text-foreground">
            KES {tier.pricePerUser.toLocaleString()}
            <span className="text-xs font-normal text-muted-foreground ml-1">/user/month</span>
          </p>
        </div>
      ) : (
        <div className="mb-3">
          <p className="text-xl font-extrabold text-foreground leading-tight">
            KES {tier.baseFee.toLocaleString()}
            <span className="text-xs font-normal text-muted-foreground ml-1">base</span>
          </p>
          <p className="text-sm font-semibold text-foreground">
            + KES {tier.perMemberFee}/member
          </p>
        </div>
      )}

      {/* Features */}
      <div className="space-y-0">
        <Row
          icon="FileSignature"
          label="External signings/month"
          value={tier.externalSignings}
          highlight
        />
        {isCorporate && (
          <Row
            icon="Users"
            label="Internal staff"
            value={tier.internalStaff}
          />
        )}
        <Row
          icon="PlusCircle"
          label="Extra signing"
          value={`KES ${EXTRA_SIGNING_COST}/doc`}
        />
      </div>
    </button>
  );
};

export default PricingTierCard;

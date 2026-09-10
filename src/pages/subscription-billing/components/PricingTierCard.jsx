import React from 'react';
import Icon from '../../../components/AppIcon';
import { CLIENT_TYPE } from '../../../config/subscriptionPricing';

const Row = ({ icon, label, value, highlight }) => (
  <div
    className={`flex items-center justify-between py-2 border-b border-border last:border-0 ${
      highlight ? 'text-foreground font-semibold' : 'text-muted-foreground'
    }`}
  >
    <span className="flex items-center gap-2 text-xs">
      <Icon name={icon} size={13} color="currentColor" />
      {label}
    </span>
    <span className={`text-xs font-bold ${highlight ? 'text-primary' : 'text-foreground'}`}>
      {value}
    </span>
  </div>
);

/**
 * One pricing tier, as the catalogue actually defines it.
 *
 * The figures are projected from companyPlans.js / saccoTiers.js by
 * subscriptionPricing.js — this card holds none of its own. It previously
 * advertised an "external signings" quota and a per-document overage that no
 * plan grants and no invoice has ever charged; both are gone.
 *
 * Props:
 *   tier        entry from CORPORATE_TIERS or SACCO_TIERS (carries its own id and colour)
 *   type        CLIENT_TYPE.CORPORATE | CLIENT_TYPE.SACCO
 *   isSelected  bool
 *   onSelect    fn()
 */
const PricingTierCard = ({ tier, type, isSelected, onSelect }) => {
  const isCorporate = type === CLIENT_TYPE.CORPORATE;

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-xl border-2 p-4 transition-all hover:shadow-md focus:outline-none ${
        isSelected ? 'border-primary shadow-md' : 'border-border hover:border-primary/40'
      }`}
      style={
        isSelected
          ? { background: 'rgba(26,86,219,0.04)' }
          : { background: 'var(--color-card)' }
      }
    >
      {/* Tier badge */}
      <div className="flex items-center justify-between mb-3">
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold"
          style={{ background: tier.bg, color: tier.accent }}
        >
          <Icon name={tier.icon} size={12} color={tier.accent} />
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
          <p className="text-2xl font-extrabold text-foreground leading-tight">
            KES {tier.pricePerUser.toLocaleString()}
            <span className="text-xs font-normal text-muted-foreground ml-1">/user/month</span>
          </p>
          {tier.baseFee > 0 && (
            <p className="text-sm font-semibold text-foreground">
              + KES {tier.baseFee.toLocaleString()} base
            </p>
          )}
        </div>
      ) : (
        <div className="mb-3">
          <p className="text-xl font-extrabold text-foreground leading-tight">
            KES {tier.baseFee.toLocaleString()}
            <span className="text-xs font-normal text-muted-foreground ml-1">base/month</span>
          </p>
          <p className="text-sm font-semibold text-foreground">
            + KES {tier.perMemberFee}/member
          </p>
        </div>
      )}

      {/* What the tier actually covers */}
      <div className="space-y-0">
        <Row
          icon={isCorporate ? 'User' : 'Users'}
          label={isCorporate ? 'Users' : 'Members'}
          value={tier.range}
          highlight
        />
        <Row icon="HardDrive" label="Free storage" value={`${tier.storageGb} GB`} />
        {isCorporate && <Row icon="Users" label="Internal staff" value={tier.internalStaff} />}
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground">Prices include VAT.</p>
    </button>
  );
};

export default PricingTierCard;

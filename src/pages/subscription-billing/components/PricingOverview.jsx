import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import {
  CORPORATE_TIERS, SACCO_TIERS, EXTRA_SIGNING_COST,
} from '../../../config/subscriptionPricing';

const TierBadge = ({ tier, tierKey }) => {
  const icons = { bronze: 'Award', silver: 'Shield', gold: 'Crown' };
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
      style={{ background: tier.bg, color: tier.accent }}
    >
      <Icon name={icons[tierKey]} size={10} color={tier.accent} />
      {tier.label}
    </span>
  );
};

const ModelTable = ({ title, subtitle, icon, tiers, columns, extraRow }) => (
  <div className="bg-card border border-border rounded-xl overflow-hidden">
    <div className="px-5 py-4 border-b border-border flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center"
        style={{ background: 'rgba(26,86,219,0.1)' }}>
        <Icon name={icon} size={16} color="#1A56DB" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>

    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Tier</th>
            {columns.map(c => (
              <th key={c.key} className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground whitespace-nowrap">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(tiers).map(([key, tier]) => (
            <tr key={key} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
              <td className="px-5 py-3">
                <TierBadge tier={tier} tierKey={key} />
              </td>
              {columns.map(c => (
                <td key={c.key} className={`px-4 py-3 text-right text-xs font-semibold ${c.highlight ? 'text-primary' : 'text-foreground'}`}>
                  {c.render(tier)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    {/* Extra signing row */}
    <div className="px-5 py-3 bg-muted/20 border-t border-border flex items-center justify-between">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon name="PlusCircle" size={12} color="currentColor" />
        Extra external document signing
      </span>
      <span className="text-xs font-bold text-foreground">KES {EXTRA_SIGNING_COST} / document</span>
    </div>
  </div>
);

const PricingOverview = () => {
  const [activeModel, setActiveModel] = useState('both');

  const corporateColumns = [
    { key: 'price',    label: 'Price / User / Month', highlight: true, render: t => `KES ${t.pricePerUser.toLocaleString()}` },
    { key: 'signings', label: 'Ext. Signings Included', render: t => t.externalSignings },
    { key: 'staff',    label: 'Internal Staff',         render: t => t.internalStaff },
  ];

  const saccoColumns = [
    { key: 'base',     label: 'Base Fee',        highlight: true, render: t => `KES ${t.baseFee.toLocaleString()}` },
    { key: 'member',   label: 'Per Member',       highlight: true, render: t => `KES ${t.perMemberFee}` },
    { key: 'signings', label: 'Ext. Signings',                    render: t => t.externalSignings },
  ];

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Pricing Overview</h2>
          <p className="text-xs text-muted-foreground">All active subscription tiers at a glance</p>
        </div>

        <div className="flex gap-1">
          {[
            { id: 'both',      label: 'All' },
            { id: 'corporate', label: 'Corporate' },
            { id: 'sacco',     label: 'SACCO' },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveModel(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeModel === id
                  ? 'bg-primary text-white'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5 space-y-4">
        {(activeModel === 'both' || activeModel === 'corporate') && (
          <ModelTable
            title="Corporate Model"
            subtitle="Billed per licensed user per month"
            icon="Building2"
            tiers={CORPORATE_TIERS}
            columns={corporateColumns}
          />
        )}
        {(activeModel === 'both' || activeModel === 'sacco') && (
          <ModelTable
            title="SACCO Model"
            subtitle="Base fee + per-member charge per month"
            icon="Users"
            tiers={SACCO_TIERS}
            columns={saccoColumns}
          />
        )}
      </div>
    </div>
  );
};

export default PricingOverview;

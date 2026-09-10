import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import {
  CORPORATE_TIERS,
  SACCO_TIERS,
  COMPANY_INSTALLATION_FEE,
  SACCO_INSTALLATION_FEE,
} from '../../../config/subscriptionPricing';
import { VAT_RATE, VAT_INCLUSIVE_PRICES } from '../../../config/systemBilling';
import { MIN_BILLABLE_USERS } from '../../../config/companyPlans';
import { MIN_BILLABLE_MEMBERS } from '../../../config/saccoTiers';

/**
 * The published rate card, read straight off the catalogue the invoice is
 * priced from. It also states the two charges the old table left out entirely:
 * the one-time installation fee, and VAT.
 */

const TierBadge = ({ tier }) => (
  <span
    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
    style={{ background: tier.bg, color: tier.accent }}
  >
    <Icon name={tier.icon} size={10} color={tier.accent} />
    {tier.label}
  </span>
);

const ModelTable = ({ title, subtitle, icon, tiers, columns, footer }) => (
  <div className="bg-card border border-border rounded-xl overflow-hidden">
    <div className="px-5 py-4 border-b border-border flex items-center gap-3">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center"
        style={{ background: 'rgba(26,86,219,0.1)' }}
      >
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
            {columns.map((c) => (
              <th
                key={c.key}
                className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground whitespace-nowrap"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(tiers).map(([key, tier]) => (
            <tr
              key={key}
              className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors"
            >
              <td className="px-5 py-3">
                <TierBadge tier={tier} />
              </td>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-4 py-3 text-right text-xs font-semibold ${
                    c.highlight ? 'text-primary' : 'text-foreground'
                  }`}
                >
                  {c.render(tier)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    {/* The charges that are not per-tier — and used not to be shown at all. */}
    <div className="border-t border-border divide-y divide-border">
      {footer.map((f) => (
        <div key={f.label} className="px-5 py-2.5 bg-muted/20 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Icon name={f.icon} size={12} color="currentColor" />
            {f.label}
          </span>
          <span className="text-xs font-bold text-foreground whitespace-nowrap">{f.value}</span>
        </div>
      ))}
    </div>
  </div>
);

const PricingOverview = () => {
  const [activeModel, setActiveModel] = useState('both');

  const money = (n) => `KES ${(n || 0).toLocaleString()}`;

  const corporateColumns = [
    {
      key: 'price',
      label: 'Price / User / Month',
      highlight: true,
      render: (t) => money(t.pricePerUser),
    },
    { key: 'range', label: 'Users', render: (t) => t.range },
    { key: 'storage', label: 'Free Storage', render: (t) => `${t.storageGb} GB` },
    { key: 'staff', label: 'Internal Staff', render: (t) => t.internalStaff },
  ];

  const saccoColumns = [
    { key: 'base', label: 'Base Fee / Month', highlight: true, render: (t) => money(t.baseFee) },
    { key: 'member', label: 'Per Member', highlight: true, render: (t) => money(t.perMemberFee) },
    { key: 'range', label: 'Members', render: (t) => t.range },
    { key: 'storage', label: 'Free Storage', render: (t) => `${t.storageGb} GB` },
  ];

  const vatNote = VAT_INCLUSIVE_PRICES
    ? `${VAT_RATE}% — included in every price above`
    : `${VAT_RATE}% — added to every price above`;

  const corporateFooter = [
    { icon: 'Wrench', label: 'Installation & onboarding (one-time, first invoice)', value: money(COMPANY_INSTALLATION_FEE) },
    { icon: 'Blocks', label: 'Additional modules', value: 'Included — all modules bundled' },
    { icon: 'Users', label: 'Minimum billing', value: `${MIN_BILLABLE_USERS} users` },
    { icon: 'Receipt', label: 'VAT', value: vatNote },
  ];

  const saccoFooter = [
    { icon: 'Wrench', label: 'Installation & onboarding (one-time, first invoice)', value: money(SACCO_INSTALLATION_FEE) },
    { icon: 'Blocks', label: 'Additional modules', value: 'Included — all modules bundled' },
    { icon: 'Users', label: 'Minimum billing', value: `${MIN_BILLABLE_MEMBERS} members` },
    { icon: 'Receipt', label: 'VAT', value: vatNote },
  ];

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-foreground">Pricing Overview</h2>
          <p className="text-xs text-muted-foreground">
            The live rate card — the same catalogue every invoice is priced from
          </p>
        </div>

        <div className="flex gap-1">
          {[
            { id: 'both', label: 'All' },
            { id: 'corporate', label: 'Corporate' },
            { id: 'sacco', label: 'SACCO' },
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
            footer={corporateFooter}
          />
        )}
        {(activeModel === 'both' || activeModel === 'sacco') && (
          <ModelTable
            title="SACCO Model"
            subtitle="Base fee + per active member per month"
            icon="Users"
            tiers={SACCO_TIERS}
            columns={saccoColumns}
            footer={saccoFooter}
          />
        )}
      </div>
    </div>
  );
};

export default PricingOverview;

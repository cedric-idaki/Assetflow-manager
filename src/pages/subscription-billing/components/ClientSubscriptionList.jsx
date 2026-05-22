import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import {
  CLIENT_TYPE, TIER,
  CORPORATE_TIERS, SACCO_TIERS,
  calcCorporateTotal, calcSaccoTotal,
} from '../../../config/subscriptionPricing';

const fmt = (n) => `KES ${(n || 0).toLocaleString()}`;

// ─── Tier badge ────────────────────────────────────────────────────────────────
const TierBadge = ({ tierKey, type }) => {
  const tiers = type === CLIENT_TYPE.CORPORATE ? CORPORATE_TIERS : SACCO_TIERS;
  const tier  = tiers[tierKey];
  const icons = { bronze: 'Award', silver: 'Shield', gold: 'Crown' };
  if (!tier) return null;
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

// ─── Mock data ────────────────────────────────────────────────────────────────
const MOCK_CLIENTS = [
  { id: 1, name: 'Acme Kenya Ltd',      type: CLIENT_TYPE.CORPORATE, tier: TIER.GOLD,   users: 35,  members: 0,  extraSignings: 5,  status: 'active'   },
  { id: 2, name: 'Sunrise SACCO',       type: CLIENT_TYPE.SACCO,     tier: TIER.SILVER, users: 0,   members: 240, extraSignings: 0,  status: 'active'   },
  { id: 3, name: 'TechBridge Solutions',type: CLIENT_TYPE.CORPORATE, tier: TIER.SILVER, users: 18,  members: 0,  extraSignings: 2,  status: 'active'   },
  { id: 4, name: 'Fahari SACCO',        type: CLIENT_TYPE.SACCO,     tier: TIER.BRONZE, users: 0,   members: 120, extraSignings: 0,  status: 'active'   },
  { id: 5, name: 'Greenfield Corp',     type: CLIENT_TYPE.CORPORATE, tier: TIER.BRONZE, users: 8,   members: 0,  extraSignings: 0,  status: 'suspended'},
  { id: 6, name: 'Pamoja SACCO',        type: CLIENT_TYPE.SACCO,     tier: TIER.GOLD,   users: 0,   members: 600, extraSignings: 10, status: 'active'   },
];

const ClientSubscriptionList = ({ onEditClient }) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const filtered = MOCK_CLIENTS.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || c.type === filter || c.status === filter;
    return matchSearch && matchFilter;
  });

  const getTotal = (client) => {
    if (client.type === CLIENT_TYPE.CORPORATE) {
      return calcCorporateTotal(client.tier, client.users, client.extraSignings).total;
    }
    return calcSaccoTotal(client.tier, client.members, client.extraSignings).total;
  };

  const getQuantityLabel = (client) =>
    client.type === CLIENT_TYPE.CORPORATE
      ? `${client.users} users`
      : `${client.members} members`;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Client Subscriptions</h2>
          <p className="text-xs text-muted-foreground">{filtered.length} client{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Icon name="Search" size={13} color="var(--color-muted-foreground)"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search clients…"
              className="pl-8 pr-3 py-1.5 rounded-lg border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          {/* Filter */}
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="all">All clients</option>
            <option value={CLIENT_TYPE.CORPORATE}>Corporate</option>
            <option value={CLIENT_TYPE.SACCO}>SACCO</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground">Client</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Type</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Tier</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Quantity</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground">Monthly Total</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(client => (
              <tr key={client.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-5 py-3">
                  <p className="text-xs font-semibold text-foreground">{client.name}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                    client.type === CLIENT_TYPE.CORPORATE ? 'text-blue-600' : 'text-purple-600'
                  }`}>
                    <Icon
                      name={client.type === CLIENT_TYPE.CORPORATE ? 'Building2' : 'Users'}
                      size={11} color="currentColor"
                    />
                    {client.type === CLIENT_TYPE.CORPORATE ? 'Corporate' : 'SACCO'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <TierBadge tierKey={client.tier} type={client.type} />
                </td>
                <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                  {getQuantityLabel(client)}
                </td>
                <td className="px-4 py-3 text-right text-xs font-bold text-foreground">
                  {fmt(getTotal(client))}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                    client.status === 'active'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-red-100 text-red-700'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${client.status === 'active' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    {client.status === 'active' ? 'Active' : 'Suspended'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => onEditClient?.(client)}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    title="Edit subscription"
                  >
                    <Icon name="Settings" size={13} color="currentColor" />
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-xs text-muted-foreground">
                  No clients match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer totals */}
      <div className="px-5 py-3 bg-muted/20 border-t border-border flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Total monthly revenue</span>
        <span className="text-sm font-bold text-primary">
          {fmt(filtered.reduce((sum, c) => sum + getTotal(c), 0))}
        </span>
      </div>
    </div>
  );
};

export default ClientSubscriptionList;

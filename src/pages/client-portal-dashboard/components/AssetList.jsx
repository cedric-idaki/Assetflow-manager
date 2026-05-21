import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import AppImage from '../../../components/AppImage';

const statusConfig = {
  sold: { label: 'Owned', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  reserved: { label: 'Reserved', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  available: { label: 'Available', color: 'bg-muted text-muted-foreground' },
  under_maintenance: { label: 'Maintenance', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
};

const AssetCard = ({ asset, installmentPlans, payments, onViewSchedule, onViewStatement }) => {
  const formatCurrency = (val) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0 })?.format(val || 0);

  const plan = installmentPlans?.find(p => p?.asset_id === asset?.id);
  const assetPayments = payments?.filter(p => p?.asset_id === asset?.id && p?.payment_status === 'completed');
  const amountPaid = assetPayments?.reduce((sum, p) => sum + Number(p?.amount || 0), 0);
  const totalPrice = Number(asset?.selling_price || 0);
  const balanceRemaining = Math.max(0, totalPrice - amountPaid);
  const progressPct = totalPrice > 0 ? Math.min(100, (amountPaid / totalPrice) * 100) : 0;

  const cfg = statusConfig?.[asset?.asset_status] || statusConfig?.available;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-200 group">
      {/* Image */}
      <div className="relative h-40 bg-muted overflow-hidden">
        <AppImage
          src={asset?.image_url || ''}
          alt={`${asset?.description || 'Asset'} - ${asset?.asset_type || 'property'} image`}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        <div className="absolute top-2.5 left-2.5">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg?.color}`}>{cfg?.label}</span>
        </div>
        <div className="absolute top-2.5 right-2.5">
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-black/50 text-white capitalize">
            {asset?.asset_type?.replace('_', ' ') || 'Asset'}
          </span>
        </div>
      </div>
      {/* Content */}
      <div className="p-5">
        <h3 className="font-semibold text-foreground text-sm leading-tight line-clamp-2 mb-0.5">
          {asset?.description || 'Unnamed Asset'}
        </h3>
        <p className="text-xs text-muted-foreground mb-3">{asset?.asset_code}</p>

        {/* Financial breakdown */}
        <div className="space-y-1.5 mb-3">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Total Price</span>
            <span className="font-semibold text-foreground">{formatCurrency(totalPrice)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Amount Paid</span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(amountPaid)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Balance Remaining</span>
            <span className={`font-bold ${balanceRemaining > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {formatCurrency(balanceRemaining)}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        {totalPrice > 0 && (
          <div className="mb-3">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Payment progress</span>
              <span>{Math.round(progressPct)}%</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${progressPct}%`, background: 'linear-gradient(90deg, #1A56DB, #FF6B35)' }}
              />
            </div>
          </div>
        )}

        {/* Installment plan info */}
        {plan && (
          <div className="text-xs text-muted-foreground mb-3 p-2 bg-muted rounded-lg">
            <span className="font-medium text-foreground">{plan?.plan_name}</span>
            {' · '}{plan?.installments_paid}/{plan?.total_installments} installments
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => onViewSchedule?.(asset)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          >
            <Icon name="Calendar" size={13} />
            Schedule
          </button>
          <button
            onClick={() => onViewStatement?.(asset)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-muted text-muted-foreground hover:bg-border hover:text-foreground transition-colors"
          >
            <Icon name="FileText" size={13} />
            Statement
          </button>
        </div>
      </div>
    </div>
  );
};

const AssetList = ({ assets, installmentPlans, payments, onViewSchedule, onViewStatement }) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const filtered = assets?.filter(a => {
    const matchSearch = !search ||
      a?.description?.toLowerCase()?.includes(search?.toLowerCase()) ||
      a?.asset_code?.toLowerCase()?.includes(search?.toLowerCase());
    const matchFilter = filter === 'all' || a?.asset_status === filter;
    return matchSearch && matchFilter;
  });

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </span>
          <input
            type="text"
            placeholder="Search assets..."
            value={search}
            onChange={e => setSearch(e?.target?.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex gap-2">
          {['all', 'reserved', 'sold', 'available']?.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 text-xs font-medium rounded-lg capitalize transition-colors ${
                filter === f ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-border'
              }`}
            >
              {f === 'all' ? 'All' : f}
            </button>
          ))}
        </div>
      </div>
      {filtered?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <Icon name="Package" size={22} color="var(--color-muted-foreground)" />
          </div>
          <p className="text-sm font-medium text-foreground">No assets found</p>
          <p className="text-xs text-muted-foreground mt-1">Try adjusting your search or filter</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered?.map(asset => (
            <AssetCard
              key={asset?.id}
              asset={asset}
              installmentPlans={installmentPlans}
              payments={payments}
              onViewSchedule={onViewSchedule}
              onViewStatement={onViewStatement}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default AssetList;

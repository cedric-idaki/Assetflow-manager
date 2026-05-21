import React from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const ASSET_ICONS = {
  property: 'Home', vehicle: 'Car', construction_dealers: 'HardHat',
  electronics: 'Tv2', furnitures: 'Armchair', heavy_equipment: 'Truck',
  goods: 'Package', services: 'Briefcase', other: 'Box',
};

const STATUS_COLORS = {
  available: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40',
  reserved:  'text-amber-600 bg-amber-50 dark:bg-amber-950/40',
  sold:      'text-gray-500 bg-gray-100 dark:bg-gray-800',
};

const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const AssetCard = ({ asset, onEdit, onLink, onView }) => {
  const icon  = ASSET_ICONS[asset?.type] || 'Box';
  const color = STATUS_COLORS[asset?.status] || STATUS_COLORS.available;

  return (
    <div className="bg-card border border-border rounded-xl p-4 md:p-5 hover:shadow-md transition-all">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Icon name={icon} size={22} color="var(--color-primary)" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground text-sm md:text-base line-clamp-1">{asset?.description}</h3>
            <p className="text-xs text-muted-foreground">{asset?.id}</p>
          </div>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize flex-shrink-0 ${color}`}>
          {asset?.status}
        </span>
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Type</span>
          <span className="font-medium text-foreground capitalize">{(asset?.type || '').replace(/_/g, ' ')}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Selling Price</span>
          <span className="font-semibold text-foreground">{fmt(asset?.sellingPrice)}</span>
        </div>
        {asset?.linkedClient && (
          <div className="flex items-center justify-between text-sm pt-2 border-t border-border">
            <span className="text-muted-foreground">Client</span>
            <span className="font-medium text-primary truncate max-w-[180px]">{asset?.linkedClient}</span>
          </div>
        )}
      </div>

      {/* Type-specific summary */}
      {asset?.type === 'property' && asset?.propertyDetails && (
        <div className="mb-4 p-2.5 bg-muted rounded-lg text-xs text-muted-foreground">
          {[asset.propertyDetails.type, asset.propertyDetails.size, asset.propertyDetails.location].filter(Boolean).join(' · ')}
        </div>
      )}
      {asset?.type === 'vehicle' && asset?.vehicleDetails && (
        <div className="mb-4 p-2.5 bg-muted rounded-lg text-xs text-muted-foreground">
          {[asset.vehicleDetails.make, asset.vehicleDetails.model, asset.vehicleDetails.year, asset.vehicleDetails.plate].filter(Boolean).join(' · ')}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" iconName="Edit" iconPosition="left" onClick={() => onEdit(asset)}>Edit</Button>
        <Button variant="outline" size="sm" iconName="Link" iconPosition="left" onClick={() => onLink(asset)}>Link Client</Button>
        <Button variant="ghost"   size="sm" iconName="Eye"  iconPosition="left" onClick={() => onView(asset)}>View</Button>
      </div>
    </div>
  );
};

export default AssetCard;

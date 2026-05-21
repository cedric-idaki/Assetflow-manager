import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const ASSET_TYPE_META = {
  property:             { label: 'Property',              icon: 'Building2',  color: '#1A56DB', bg: 'bg-blue-100' },
  vehicle:              { label: 'Vehicle',               icon: 'Car',        color: '#059669', bg: 'bg-emerald-100' },
  construction_dealers: { label: 'Construction Dealers',  icon: 'HardHat',    color: '#d97706', bg: 'bg-amber-100' },
  electronics:          { label: 'Electronics',           icon: 'Cpu',        color: '#7c3aed', bg: 'bg-purple-100' },
  furnitures:           { label: 'Furniture',             icon: 'Sofa',       color: '#db2777', bg: 'bg-pink-100' },
  heavy_equipment:      { label: 'Heavy Equipment',       icon: 'Truck',      color: '#ea580c', bg: 'bg-orange-100' },
  other:                { label: 'Other',                 icon: 'Package',    color: '#6b7280', bg: 'bg-gray-100' },
};

const STATUS_META = {
  available:   { label: 'Available',   className: 'bg-emerald-100 text-emerald-700' },
  reserved:    { label: 'Reserved',    className: 'bg-yellow-100 text-yellow-700' },
  sold:        { label: 'Sold',        className: 'bg-blue-100 text-blue-700' },
  under_maintenance: { label: 'Maintenance', className: 'bg-red-100 text-red-700' },
};

const AssetDetailModal = ({ asset, onClose }) => {
  const meta = ASSET_TYPE_META[asset.asset_type] || ASSET_TYPE_META.other;
  const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${meta.bg}`}>
              <Icon name={meta.icon} size={20} color={meta.color} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">{asset.description}</h3>
              <p className="text-xs text-muted-foreground">{asset.asset_code}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Asset Type', value: meta.label },
              { label: 'Status', value: STATUS_META[asset.asset_status]?.label || asset.asset_status },
              { label: 'Selling Price', value: fmt(asset.selling_price) },
              { label: 'Current Value', value: fmt(asset.current_value) },
              { label: 'Location', value: asset.location || '—' },
              { label: 'Asset Code', value: asset.asset_code },
            ].map((item, i) => (
              <div key={i} className="bg-muted/30 rounded-xl p-4">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="text-sm font-semibold text-foreground mt-0.5">{item.value}</p>
              </div>
            ))}
          </div>

          {/* Vehicle details */}
          {asset.asset_type === 'vehicle' && (asset.make || asset.model) && (
            <div className="border border-border rounded-xl p-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Vehicle Details</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {asset.make && <div><span className="text-muted-foreground">Make: </span><span className="font-medium text-foreground">{asset.make}</span></div>}
                {asset.model && <div><span className="text-muted-foreground">Model: </span><span className="font-medium text-foreground">{asset.model}</span></div>}
                {asset.year && <div><span className="text-muted-foreground">Year: </span><span className="font-medium text-foreground">{asset.year}</span></div>}
                {asset.color && <div><span className="text-muted-foreground">Color: </span><span className="font-medium text-foreground">{asset.color}</span></div>}
                {asset.plate_number && <div><span className="text-muted-foreground">Plate: </span><span className="font-medium text-foreground">{asset.plate_number}</span></div>}
                {asset.chassis_number && <div><span className="text-muted-foreground">Chassis: </span><span className="font-medium text-foreground">{asset.chassis_number}</span></div>}
              </div>
            </div>
          )}

          {/* Property details */}
          {asset.asset_type === 'property' && (asset.property_type || asset.property_size) && (
            <div className="border border-border rounded-xl p-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Property Details</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {asset.property_type && <div><span className="text-muted-foreground">Type: </span><span className="font-medium text-foreground">{asset.property_type}</span></div>}
                {asset.property_size && <div><span className="text-muted-foreground">Size: </span><span className="font-medium text-foreground">{asset.property_size}</span></div>}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const MyAssetsTab = ({ assets }) => {
  const [selected, setSelected] = useState(null);

  const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center mb-4">
          <Icon name="Package" size={28} color="currentColor" />
        </div>
        <p className="text-base font-medium text-foreground">No assets linked yet</p>
        <p className="text-sm text-muted-foreground mt-1">
          Your admin will link assets to your account
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {assets.length} asset{assets.length !== 1 ? 's' : ''} linked to your account
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {assets.map(asset => {
          const meta = ASSET_TYPE_META[asset.asset_type] || ASSET_TYPE_META.other;
          const status = STATUS_META[asset.asset_status] || { label: asset.asset_status, className: 'bg-gray-100 text-gray-700' };
          return (
            <div
              key={asset.id}
              className="bg-card border border-border rounded-xl p-4 hover:shadow-md transition-all cursor-pointer"
              onClick={() => setSelected(asset)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${meta.bg}`}>
                    <Icon name={meta.icon} size={20} color={meta.color} />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground text-sm line-clamp-1">{asset.description}</p>
                    <p className="text-xs text-muted-foreground">{asset.asset_code}</p>
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${status.className}`}>
                  {status.label}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Value</p>
                  <p className="font-semibold text-foreground">{fmt(asset.selling_price)}</p>
                </div>
                {asset.location && (
                  <div>
                    <p className="text-muted-foreground">Location</p>
                    <p className="font-medium text-foreground truncate">{asset.location}</p>
                  </div>
                )}
                {asset.asset_type === 'vehicle' && asset.make && (
                  <div>
                    <p className="text-muted-foreground">Make</p>
                    <p className="font-medium text-foreground">{asset.make} {asset.model}</p>
                  </div>
                )}
                {asset.plate_number && (
                  <div>
                    <p className="text-muted-foreground">Plate</p>
                    <p className="font-medium text-foreground">{asset.plate_number}</p>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1 mt-3 pt-3 border-t border-border">
                <Icon name="Eye" size={13} color="var(--color-muted-foreground)" />
                <span className="text-xs text-muted-foreground">Click to view full details</span>
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <AssetDetailModal asset={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
};

export default MyAssetsTab;
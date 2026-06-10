import React from 'react';
import Icon from '../../../components/AppIcon';
import AssetCoverCarousel from './AssetCoverCarousel';

const ASSET_ICONS = {
  property: 'Home', vehicle: 'Car', construction_dealers: 'HardHat',
  electronics: 'Tv2', furnitures: 'Armchair', heavy_equipment: 'Truck',
  goods: 'Package', services: 'Briefcase', other: 'Box',
};

const STATUS = {
  available: { label: 'IN STOCK', dot: '#10b981', cls: 'text-emerald-700' },
  reserved:  { label: 'RESERVED', dot: '#f59e0b', cls: 'text-amber-700' },
  sold:      { label: 'SOLD',     dot: '#9ca3af', cls: 'text-gray-600' },
};

const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const imgSrc = (im) => (im ? (im.url || im.preview) : null);

// Title: vehicles read make/model, everything else uses the description.
const titleOf = (asset) => {
  if (asset?.type === 'vehicle') {
    const v = asset.vehicleDetails || {};
    return [v.make, v.model].filter(Boolean).join(' ') || asset?.description || 'Asset';
  }
  return asset?.description || 'Asset';
};

// A few headline specs to show as chips, per asset type.
const chipsOf = (asset) => {
  const m = asset?.metadata || {};
  switch (asset?.type) {
    case 'vehicle':
      return [
        m.vehicleMileage && `${Number(m.vehicleMileage).toLocaleString()} km`,
        m.vehicleGearbox,
        m.vehicleEngine && `${m.vehicleEngine}cc`,
        m.vehicleFuel,
      ];
    case 'property':
      return [asset.propertyDetails?.type, asset.propertyDetails?.size, m.propertyBedsath];
    case 'electronics':
      return [m.elecBrand, m.elecCondition, m.elecWarranty];
    case 'furnitures':
      return [m.furnCategory, m.furnMaterial, m.furnCondition];
    case 'construction_dealers':
      return [m.constCategory, m.constQty && `${m.constQty} ${m.constUnit || ''}`.trim(), m.constGrade];
    case 'heavy_equipment':
      return [m.heavyBrand, m.heavyModel, m.heavyHours && `${m.heavyHours} hrs`];
    default:
      return [asset?.specifications];
  }
};

const AssetCard = ({ asset, onEdit, onLink, onView }) => {
  const st    = STATUS[asset?.status] || STATUS.available;
  const chips = chipsOf(asset).filter(Boolean);
  const year  = asset?.vehicleDetails?.year || asset?.metadata?.heavyYear;

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden hover:shadow-lg transition-all flex flex-col">

      {/* Image / cover carousel */}
      <AssetCoverCarousel images={asset?.images} alt={titleOf(asset)} fallbackIcon={ASSET_ICONS[asset?.type] || 'Box'}>
        {year && (
          <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-white/95 text-gray-900 text-xs font-bold shadow">
            {year}
          </span>
        )}
        <span className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-white/95 text-xs font-bold shadow flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: st.dot }} />
          <span className={st.cls}>{st.label}</span>
        </span>
        {asset?.location && (
          <span className="absolute top-12 left-3 max-w-[60%] px-2.5 py-1 rounded-full bg-black/55 text-white text-xs font-medium flex items-center gap-1 truncate">
            <Icon name="MapPin" size={11} color="white" />
            <span className="truncate">{asset.location}</span>
          </span>
        )}
      </AssetCoverCarousel>

      {/* Body */}
      <div className="p-4 flex-1 flex flex-col">
        <p className="text-xs text-muted-foreground">Stock ID: {asset?.id}</p>
        <h3 className="font-bold text-foreground text-base mt-0.5 line-clamp-1 uppercase">{titleOf(asset)}</h3>

        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {chips.slice(0, 4).map((c, i) => (
              <span key={i} className="px-2 py-0.5 rounded-md bg-muted text-xs font-medium text-foreground capitalize">
                {c}
              </span>
            ))}
          </div>
        )}

        <p className="text-lg font-bold text-foreground mt-3">{fmt(asset?.sellingPrice)}</p>
        {asset?.linkedClient && (
          <p className="text-xs text-primary mt-0.5 truncate">Linked: {asset.linkedClient}</p>
        )}

        {/* Actions */}
        <div className="mt-3 space-y-2">
          <button
            onClick={() => onView(asset)}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
          >
            <Icon name="Eye" size={15} color="white" />
            View Details →
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => onEdit(asset)}
              className="flex-1 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all flex items-center justify-center gap-1.5"
            >
              <Icon name="Edit" size={13} color="currentColor" /> Edit
            </button>
            <button
              onClick={() => onLink(asset)}
              className="flex-1 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all flex items-center justify-center gap-1.5"
            >
              <Icon name="Link" size={13} color="currentColor" /> Link Client
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AssetCard;

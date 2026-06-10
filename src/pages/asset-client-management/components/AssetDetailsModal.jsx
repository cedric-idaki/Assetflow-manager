import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

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

const fmt = (n) => (n != null ? `KES ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—');
const imgSrc = (im) => (im ? (im.url || im.preview) : null);

const titleOf = (asset) => {
  if (asset?.type === 'vehicle') {
    const v = asset.vehicleDetails || {};
    return [v.make, v.model, v.year].filter(Boolean).join(' ') || asset?.description || 'Asset';
  }
  return asset?.description || 'Asset';
};

// [label, value] pairs per asset type.
const specsOf = (asset) => {
  const m = asset?.metadata || {};
  const v = asset?.vehicleDetails || {};
  switch (asset?.type) {
    case 'vehicle':
      return [
        ['Year', v.year],
        ['Mileage', m.vehicleMileage ? `${Number(m.vehicleMileage).toLocaleString()} km` : null],
        ['Transmission', m.vehicleGearbox],
        ['Fuel Type', m.vehicleFuel],
        ['Engine', m.vehicleEngine ? `${m.vehicleEngine} cc` : null],
        ['Color', v.color],
        ['Plate Number', v.plate],
        ['Chassis Number', v.chassis],
      ];
    case 'property':
      return [
        ['Property Type', asset.propertyDetails?.type],
        ['Size', asset.propertyDetails?.size],
        ['Beds / Baths', m.propertyBedsath],
        ['Title Deed No.', m.propertyTitle],
        ['Land Reference', m.propertyLandRef],
        ['Location', asset.location],
      ];
    case 'electronics':
      return [
        ['Brand', m.elecBrand], ['Model / SKU', m.elecModel], ['Serial No.', m.elecSerial],
        ['Condition', m.elecCondition], ['Warranty', m.elecWarranty], ['Color', m.elecColor],
      ];
    case 'furnitures':
      return [
        ['Category', m.furnCategory], ['Material', m.furnMaterial], ['Brand', m.furnBrand],
        ['Color', m.furnColor], ['Dimensions', m.furnDimension], ['Condition', m.furnCondition],
      ];
    case 'construction_dealers':
      return [
        ['Category', m.constCategory], ['Brand / Supplier', m.constBrand], ['Unit', m.constUnit],
        ['Quantity', m.constQty], ['Grade', m.constGrade], ['Warehouse', m.constWarehouse],
      ];
    case 'heavy_equipment':
      return [
        ['Brand / Make', m.heavyBrand], ['Model', m.heavyModel], ['Serial / VIN', m.heavySerial],
        ['Year', m.heavyYear], ['Operating Hours', m.heavyHours], ['Location', m.heavyLocation],
      ];
    default:
      return [['Category', m.category]];
  }
};

const SpecItem = ({ label, value }) => (
  <div className="bg-muted/40 rounded-lg px-3 py-2">
    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="text-sm font-semibold text-foreground capitalize break-words">{value}</p>
  </div>
);

const AssetDetailsModal = ({ asset, onClose }) => {
  const images = (asset?.images || []).filter(im => imgSrc(im));
  const [idx, setIdx] = useState(0);
  const st    = STATUS[asset?.status] || STATUS.available;
  const specs = specsOf(asset).filter(([, val]) => val != null && val !== '');
  const main  = images[idx] ? imgSrc(images[idx]) : null;

  const prev = () => setIdx(i => (i - 1 + images.length) % images.length);
  const next = () => setIdx(i => (i + 1) % images.length);

  return (
    <div className="fixed inset-0 bg-black/60 z-[110] flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <span className="px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 bg-muted">
              <span className="w-2 h-2 rounded-full" style={{ background: st.dot }} />
              <span className={st.cls}>{st.label}</span>
            </span>
            <span className="text-xs text-muted-foreground truncate">Stock ID: {asset?.id}</span>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors" aria-label="Close">
            <Icon name="X" size={18} color="var(--color-foreground)" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2">

            {/* Gallery */}
            <div className="p-5">
              <div className="relative rounded-xl overflow-hidden bg-muted aspect-[4/3]">
                {main ? (
                  <img src={main} alt={titleOf(asset)} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Icon name={ASSET_ICONS[asset?.type] || 'Box'} size={48} color="var(--color-muted-foreground)" />
                  </div>
                )}
                {images.length > 1 && (
                  <>
                    <button onClick={prev} className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center">
                      <Icon name="ChevronLeft" size={18} color="white" />
                    </button>
                    <button onClick={next} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center">
                      <Icon name="ChevronRight" size={18} color="white" />
                    </button>
                    <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full bg-black/55 text-white text-xs font-medium">
                      {idx + 1}/{images.length}
                    </span>
                  </>
                )}
              </div>

              {images.length > 1 && (
                <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
                  {images.map((im, i) => (
                    <button
                      key={i}
                      onClick={() => setIdx(i)}
                      className={`w-16 h-16 rounded-lg overflow-hidden border-2 flex-shrink-0 ${i === idx ? 'border-primary' : 'border-transparent'}`}
                    >
                      <img src={imgSrc(im)} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Details */}
            <div className="p-5 lg:border-l border-border space-y-5">
              <div>
                <h2 className="text-xl font-bold text-foreground uppercase">{titleOf(asset)}</h2>
                <p className="text-2xl font-extrabold text-primary mt-1">{fmt(asset?.sellingPrice)}</p>
                <p className="text-xs text-muted-foreground mt-1 capitalize">
                  {(asset?.type || '').replace(/_/g, ' ')}
                </p>
              </div>

              {specs.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Details</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {specs.map(([label, val]) => <SpecItem key={label} label={label} value={val} />)}
                  </div>
                </div>
              )}

              {asset?.specifications && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Description</h4>
                  <p className="text-sm text-foreground bg-muted/40 rounded-lg px-3 py-2 whitespace-pre-wrap">{asset.specifications}</p>
                </div>
              )}

              {asset?.linkedClient && (
                <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                  <Icon name="User" size={15} color="var(--color-primary)" />
                  <p className="text-sm font-medium text-foreground">Linked: {asset.linkedClient}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-3 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default AssetDetailsModal;

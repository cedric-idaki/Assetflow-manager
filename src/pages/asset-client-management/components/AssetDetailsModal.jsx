import React from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const ASSET_ICONS = {
  property: 'Home', vehicle: 'Car', construction_dealers: 'HardHat',
  electronics: 'Tv2', furnitures: 'Armchair', heavy_equipment: 'Truck',
  goods: 'Package', services: 'Briefcase', other: 'Box',
};

const STATUS_COLORS = {
  available: 'text-emerald-600 bg-emerald-50',
  reserved:  'text-amber-600 bg-amber-50',
  sold:      'text-gray-500 bg-gray-100',
};

const fmt = (n) => n != null ? `KES ${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—';

const Row = ({ label, value }) => value != null && value !== '' && value !== '—' ? (
  <div>
    <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
    <p className="text-sm font-medium text-foreground">{value}</p>
  </div>
) : null;

const AssetDetailsModal = ({ asset, onClose }) => {
  const icon  = ASSET_ICONS[asset?.type] || 'Box';
  const color = STATUS_COLORS[asset?.status] || STATUS_COLORS.available;
  const meta  = asset?.metadata || {};

  return (
    <div className="fixed inset-0 bg-black/50 z-[110] flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">

        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">Asset Details</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors" aria-label="Close">
            <Icon name="X" size={18} color="var(--color-foreground)" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Header */}
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Icon name={icon} size={28} color="var(--color-primary)" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-foreground">{asset?.description}</h3>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-sm text-muted-foreground">{asset?.id}</span>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${color}`}>{asset?.status}</span>
              </div>
            </div>
          </div>

          {/* Basic info — NO purchase price */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Basic Information</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Row label="Asset Type" value={(asset?.type || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} />
              <Row label="Status"     value={(asset?.status || '').replace(/\b\w/g, c => c.toUpperCase())} />
              <Row label="Selling Price" value={fmt(asset?.sellingPrice)} />
              {asset?.location && <Row label="Location" value={asset.location} />}
            </div>
          </div>

          {/* Property details */}
          {asset?.type === 'property' && asset?.propertyDetails && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Property Details</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Row label="Property Type"  value={asset.propertyDetails.type} />
                <Row label="Size"           value={asset.propertyDetails.size} />
                <Row label="Location"       value={asset.propertyDetails.location} />
                <Row label="Title Deed No." value={meta.propertyTitle} />
                <Row label="Beds / Baths"   value={meta.propertyBedsath} />
                <Row label="Land Reference" value={meta.propertyLandRef} />
              </div>
            </div>
          )}

          {/* Vehicle details */}
          {asset?.type === 'vehicle' && asset?.vehicleDetails && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Vehicle Details</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Row label="Make"           value={asset.vehicleDetails.make} />
                <Row label="Model"          value={asset.vehicleDetails.model} />
                <Row label="Year"           value={asset.vehicleDetails.year} />
                <Row label="Color"          value={asset.vehicleDetails.color} />
                <Row label="Plate Number"   value={asset.vehicleDetails.plate} />
                <Row label="Chassis Number" value={asset.vehicleDetails.chassis} />
                <Row label="Engine CC"      value={meta.engineCC} />
                <Row label="Fuel Type"      value={meta.fuelType} />
                <Row label="Mileage (km)"   value={meta.mileage} />
                <Row label="Gearbox"        value={meta.gearbox} />
              </div>
            </div>
          )}

          {/* Construction */}
          {asset?.type === 'construction_dealers' && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Construction Details</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Row label="Category"       value={meta.constCategory} />
                <Row label="Brand/Supplier" value={meta.constBrand} />
                <Row label="Unit"           value={meta.constUnit} />
                <Row label="Quantity"       value={meta.constQty} />
                <Row label="Grade/Standard" value={meta.constGrade} />
                <Row label="Warehouse"      value={meta.constWarehouse} />
              </div>
            </div>
          )}

          {/* Electronics */}
          {asset?.type === 'electronics' && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Electronics Details</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Row label="Brand"        value={meta.elecBrand} />
                <Row label="Model/SKU"    value={meta.elecModel} />
                <Row label="Serial No."   value={meta.elecSerial} />
                <Row label="Condition"    value={meta.elecCondition} />
                <Row label="Warranty"     value={meta.elecWarranty} />
              </div>
            </div>
          )}

          {/* Furniture */}
          {asset?.type === 'furnitures' && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Furniture Details</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Row label="Category"   value={meta.furnCategory} />
                <Row label="Material"   value={meta.furnMaterial} />
                <Row label="Brand"      value={meta.furnBrand} />
                <Row label="Color"      value={meta.furnColor} />
                <Row label="Dimensions" value={meta.furnDimension} />
                <Row label="Condition"  value={meta.furnCondition} />
              </div>
            </div>
          )}

          {/* Heavy equipment */}
          {asset?.type === 'heavy_equipment' && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Heavy Equipment Details</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Row label="Brand/Make"      value={meta.heavyBrand} />
                <Row label="Model"           value={meta.heavyModel} />
                <Row label="Serial/VIN"      value={meta.heavySerial} />
                <Row label="Year"            value={meta.heavyYear} />
                <Row label="Operating Hours" value={meta.heavyHours} />
                <Row label="Location"        value={meta.heavyLocation} />
              </div>
            </div>
          )}

          {/* Specifications (shared) */}
          {asset?.specifications && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Specifications</h4>
              <p className="text-sm text-foreground bg-muted rounded-lg px-3 py-2">{asset.specifications}</p>
            </div>
          )}

          {/* Asset images */}
          {asset?.images && asset.images.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Photos</h4>
              <div className="flex flex-wrap gap-3">
                {asset.images.map((img, i) => (
                  <img key={i} src={img.preview || img.url} alt={img.name || `Photo ${i+1}`}
                    className="w-24 h-24 object-cover rounded-xl border border-border" />
                ))}
              </div>
            </div>
          )}

          {/* Linked client */}
          {asset?.linkedClient && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Linked Client</h4>
              <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                <Icon name="User" size={15} color="var(--color-primary)" />
                <p className="text-sm font-medium text-foreground">{asset.linkedClient}</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
};

export default AssetDetailsModal;

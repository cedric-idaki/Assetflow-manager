import React, { useState, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';

// ── Asset-type smart field configs ────────────────────────────────────────────
const ASSET_CONFIGS = {
  vehicle: {
    label: 'Vehicle / Car',
    icon: 'Car',
    color: 'bg-blue-50 border-blue-200',
    iconColor: '#1d4ed8',
    fields: [
      { key: 'vehicleMake',    label: 'Make',           placeholder: 'e.g. Toyota',          required: true,  col: 1 },
      { key: 'vehicleModel',   label: 'Model',          placeholder: 'e.g. Land Cruiser',    required: true,  col: 1 },
      { key: 'vehicleYear',    label: 'Year',           placeholder: '2023',                 required: true,  col: 1, type: 'number' },
      { key: 'vehicleColor',   label: 'Color',          placeholder: 'e.g. Pearl White',     required: false, col: 1 },
      { key: 'vehiclePlate',   label: 'Plate Number',   placeholder: 'e.g. KAA 123B',        required: true,  col: 1, upper: true },
      { key: 'vehicleChassis', label: 'Chassis Number', placeholder: 'Enter chassis no.',    required: true,  col: 1, upper: true },
      { key: 'vehicleEngine',  label: 'Engine CC',      placeholder: 'e.g. 2000',            required: false, col: 1 },
      { key: 'vehicleFuel',    label: 'Fuel Type',      placeholder: 'Petrol/Diesel/Hybrid', required: false, col: 1 },
      { key: 'vehicleMileage', label: 'Mileage (km)',   placeholder: 'e.g. 45000',           required: false, col: 1, type: 'number' },
      { key: 'vehicleGearbox', label: 'Gearbox',        placeholder: 'Automatic / Manual',   required: false, col: 1 },
    ],
  },
  property: {
    label: 'Property / Land',
    icon: 'Home',
    color: 'bg-emerald-50 border-emerald-200',
    iconColor: '#059669',
    fields: [
      { key: 'propertyType',     label: 'Property Type',  placeholder: '',                              required: true,  col: 1, select: ['land','house','apartment','commercial','plot','bungalow','maisonette'] },
      { key: 'propertySize',     label: 'Size',           placeholder: 'e.g. 0.5 acres or 2500 sq ft', required: true,  col: 1 },
      { key: 'propertyLocation', label: 'Location',       placeholder: 'e.g. Westlands, Nairobi',       required: true,  col: 2 },
      { key: 'propertyTitle',    label: 'Title Deed No.', placeholder: 'e.g. IR 12345',                 required: false, col: 1 },
      { key: 'propertyBedsath',  label: 'Beds / Baths',   placeholder: 'e.g. 3 bed / 2 bath',           required: false, col: 1 },
      { key: 'propertyLandRef',  label: 'Land Reference', placeholder: 'e.g. LR No. 209/123',           required: false, col: 1 },
    ],
  },
  construction_dealers: {
    label: 'Construction Materials',
    icon: 'HardHat',
    color: 'bg-orange-50 border-orange-200',
    iconColor: '#c2410c',
    fields: [
      { key: 'constCategory',  label: 'Category',         placeholder: 'e.g. Steel, Cement, Timber',   required: true,  col: 1 },
      { key: 'constBrand',     label: 'Brand / Supplier', placeholder: 'e.g. Bamburi, Mabati Rolling', required: false, col: 1 },
      { key: 'constUnit',      label: 'Unit of Measure',  placeholder: 'e.g. bags, tons, metres',       required: true,  col: 1 },
      { key: 'constQty',       label: 'Quantity',         placeholder: '100',                           required: true,  col: 1, type: 'number' },
      { key: 'constGrade',     label: 'Grade / Standard', placeholder: 'e.g. Grade 43, BS 8500',        required: false, col: 1 },
      { key: 'constWarehouse', label: 'Warehouse / Location', placeholder: 'e.g. Embakasi Warehouse',  required: false, col: 2 },
      { key: 'specifications', label: 'Specifications',   placeholder: 'Additional technical details',  required: false, col: 2 },
    ],
  },
  electronics: {
    label: 'Electronics',
    icon: 'Tv2',
    color: 'bg-purple-50 border-purple-200',
    iconColor: '#7c3aed',
    fields: [
      { key: 'elecBrand',      label: 'Brand',          placeholder: 'e.g. Samsung, LG, Apple',  required: true,  col: 1 },
      { key: 'elecModel',      label: 'Model / SKU',    placeholder: 'e.g. UA55AU8000',           required: true,  col: 1 },
      { key: 'elecSerial',     label: 'Serial Number',  placeholder: 'Enter serial number',        required: false, col: 1, upper: true },
      { key: 'elecCondition',  label: 'Condition',      placeholder: 'New / Refurbished / Used',   required: true,  col: 1 },
      { key: 'elecWarranty',   label: 'Warranty',       placeholder: 'e.g. 1 Year Samsung',        required: false, col: 1 },
      { key: 'elecColor',      label: 'Color / Finish', placeholder: 'e.g. Space Grey',            required: false, col: 1 },
      { key: 'specifications', label: 'Specifications', placeholder: 'e.g. 55" 4K UHD, OLED',     required: false, col: 2 },
    ],
  },
  furnitures: {
    label: 'Furniture',
    icon: 'Armchair',
    color: 'bg-amber-50 border-amber-200',
    iconColor: '#d97706',
    fields: [
      { key: 'furnCategory',  label: 'Category',        placeholder: 'e.g. Sofa, Bed, Dining Set',   required: true,  col: 1 },
      { key: 'furnMaterial',  label: 'Material',        placeholder: 'e.g. Oak Wood, Leather',        required: true,  col: 1 },
      { key: 'furnBrand',     label: 'Brand / Maker',   placeholder: 'e.g. Mobilis, IKEA',            required: false, col: 1 },
      { key: 'furnColor',     label: 'Color / Finish',  placeholder: 'e.g. Walnut Brown',             required: false, col: 1 },
      { key: 'furnDimension', label: 'Dimensions',      placeholder: 'e.g. L180 x W90 x H75 cm',     required: false, col: 1 },
      { key: 'furnCondition', label: 'Condition',       placeholder: 'New / Refurbished / Used',       required: true,  col: 1 },
      { key: 'specifications', label: 'Additional Notes', placeholder: 'Other details',               required: false, col: 2 },
    ],
  },
  heavy_equipment: {
    label: 'Heavy Equipment',
    icon: 'Truck',
    color: 'bg-red-50 border-red-200',
    iconColor: '#b91c1c',
    fields: [
      { key: 'heavyBrand',    label: 'Brand / Make',        placeholder: 'e.g. Caterpillar, Komatsu', required: true,  col: 1 },
      { key: 'heavyModel',    label: 'Model',               placeholder: 'e.g. CAT 320D',             required: true,  col: 1 },
      { key: 'heavySerial',   label: 'Serial / VIN',        placeholder: 'Enter serial number',        required: true,  col: 1, upper: true },
      { key: 'heavyYear',     label: 'Year of Manufacture', placeholder: '2020',                      required: true,  col: 1, type: 'number' },
      { key: 'heavyHours',    label: 'Operating Hours',     placeholder: 'e.g. 3200 hrs',             required: false, col: 1, type: 'number' },
      { key: 'heavyLocation', label: 'Current Location',    placeholder: 'e.g. Mombasa Port',         required: false, col: 2 },
      { key: 'specifications', label: 'Specifications',     placeholder: 'Engine size, capacity etc.', required: false, col: 2 },
    ],
  },
  other: {
    label: 'Other Asset',
    icon: 'Package',
    color: 'bg-gray-50 border-gray-200',
    iconColor: '#6b7280',
    fields: [
      { key: 'category',     label: 'Category',       placeholder: 'Describe the asset category', required: true,  col: 1 },
      { key: 'specifications', label: 'Specifications', placeholder: 'Detailed specifications',   required: false, col: 2 },
    ],
  },
};

// ── Image Upload ──────────────────────────────────────────────────────────────
const ImageUpload = ({ images, onAdd, onRemove }) => {
  const fileRef = useRef();
  const handleFiles = (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (ev) => onAdd({ file, preview: ev.target.result, name: file.name });
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-xl bg-indigo-100 flex items-center justify-center">
          <Icon name="Image" size={13} color="#4338ca" />
        </div>
        <span className="text-sm font-semibold text-foreground">Asset Photos</span>
        <span className="text-xs text-muted-foreground ml-1">(min 2, max 20 )</span>
      </div>
      <div className="flex flex-wrap gap-3">
        {images.map((img, i) => (
          <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border-2 border-border group">
            <img src={img.preview} alt={img.name} className="w-full h-full object-cover" />
            <button type="button" onClick={() => onRemove(i)}
              className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Icon name="Trash2" size={14} color="white" />
            </button>
          </div>
        ))}
        {images.length < 20 && (
          <button type="button" onClick={() => fileRef.current?.click()}
            className="w-20 h-20 rounded-xl border-2 border-dashed border-border hover:border-primary hover:bg-primary/5 transition-colors flex flex-col items-center justify-center gap-1">
            <Icon name="Plus" size={16} color="var(--color-muted-foreground)" />
            <span className="text-xs text-muted-foreground">Add</span>
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
    </div>
  );
};

// ── Field component ───────────────────────────────────────────────────────────
const Field = ({ label, required, error, hint, children }) => (
  <div>
    <label className="block text-xs font-semibold text-muted-foreground mb-1">
      {label} {required && <span className="text-red-500">*</span>}
    </label>
    {children}
    {hint && !error && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
    {error && (
      <p className="text-xs text-red-500 mt-0.5 flex items-center gap-1">
        <Icon name="AlertCircle" size={11} color="#ef4444" /> {error}
      </p>
    )}
  </div>
);

const ic = (err) =>
  `w-full px-3 py-2.5 text-sm bg-background border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground placeholder:text-muted-foreground transition-colors ${
    err ? 'border-red-400 bg-red-50' : 'border-border'
  }`;

// ── Live pricing preview ──────────────────────────────────────────────────────
const PricingPreview = ({ pricing }) => {
  const sp    = parseFloat(pricing.sellingPrice)  || 0;
  const cp    = parseFloat(pricing.costPrice)     || 0;
  const minSp = parseFloat(pricing.minSellingPrice) || 0;
  const vat   = pricing.vatApplicable ? sp * 0.16 : 0;
  const total = sp + vat;
  const margin = cp > 0 ? (((sp - cp) / cp) * 100).toFixed(1) : null;
  const dep   = sp * (parseFloat(pricing.minDepositPct) || 20) / 100;

  if (!sp) return null;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
      <p className="text-xs font-bold text-blue-800 uppercase tracking-wide mb-2">📊 Live Pricing Preview</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
        {[
          { label: 'Selling Price',     value: `KES ${sp.toLocaleString()}`,           color: 'text-foreground font-bold' },
          { label: 'VAT (16%)',         value: pricing.vatApplicable ? `KES ${Math.round(vat).toLocaleString()}` : 'N/A', color: 'text-foreground' },
          { label: 'Client Pays',       value: `KES ${Math.round(total).toLocaleString()}`,  color: 'text-blue-700 font-bold' },
          { label: 'Min Deposit',       value: `KES ${Math.round(dep).toLocaleString()}`,   color: 'text-foreground' },
          { label: 'Gross Margin',      value: margin ? `${margin}%` : '—',                 color: parseFloat(margin) > 20 ? 'text-emerald-600 font-semibold' : 'text-amber-600 font-semibold' },
          { label: 'Min Sell Price',    value: minSp ? `KES ${minSp.toLocaleString()}` : '—', color: 'text-red-600' },
        ].map(r => (
          <div key={r.label} className="bg-white rounded-xl p-3 border border-blue-100">
            <p className="text-muted-foreground">{r.label}</p>
            <p className={r.color}>{r.value}</p>
          </div>
        ))}
      </div>
      {minSp > 0 && sp < minSp && (
        <p className="text-xs text-red-600 font-semibold">
          ⚠️ Selling price is below minimum selling price!
        </p>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN FORM
// ══════════════════════════════════════════════════════════════════════════════
const AssetRegistrationForm = ({ onClose, onSubmit, editData, allowedAssetTypes }) => {
  const yr = new Date().getFullYear();

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('details');

  // ── Asset details state ───────────────────────────────────────────────────
  const initial = editData || {
    assetType: '', description: '', status: 'available',
    // property
    propertySize: '', propertyLocation: '', propertyType: '', propertyTitle: '', propertyBedsath: '', propertyLandRef: '',
    // vehicle
    vehicleMake: '', vehicleModel: '', vehicleYear: '', vehiclePlate: '', vehicleChassis: '',
    vehicleColor: '', vehicleEngine: '', vehicleFuel: '', vehicleMileage: '', vehicleGearbox: '',
    // construction
    constCategory: '', constBrand: '', constUnit: '', constQty: '', constGrade: '', constWarehouse: '',
    // electronics
    elecBrand: '', elecModel: '', elecSerial: '', elecCondition: '', elecWarranty: '', elecColor: '',
    // furniture
    furnCategory: '', furnMaterial: '', furnBrand: '', furnColor: '', furnDimension: '', furnCondition: '',
    // heavy equipment
    heavyBrand: '', heavyModel: '', heavySerial: '', heavyYear: '', heavyHours: '', heavyLocation: '',
    // generic
    category: '', specifications: '',
  };

  // ── Pricing state (BRS 4.1 — all 14 fields) ──────────────────────────────
  const [pricing, setPricing] = useState({
    costPrice:              editData?.purchase_price            || editData?.costPrice              || '',
    sellingPrice:           editData?.selling_price             || editData?.sellingPrice            || '',
    minSellingPrice:        editData?.min_selling_price         || editData?.minSellingPrice         || '',
    maxDiscountPct:         editData?.max_discount_pct          || editData?.maxDiscountPct          || '10',
    vatApplicable:          editData?.vat_applicable            !== false,
    vatRate:                editData?.vat_rate                  || '16',
    installmentPremiumPct:  editData?.installment_premium_pct   || editData?.installmentPremiumPct   || '0',
    installmentInterestRate: editData?.installment_interest_rate || editData?.installmentInterestRate || '12',
    minDepositPct:          editData?.min_deposit_pct           || editData?.minDepositPct           || '20',
    maxInstallmentTenure:   editData?.max_installment_tenure    || editData?.maxInstallmentTenure    || '60',
    penaltyRateMonthly:     editData?.penalty_rate_monthly      || editData?.penaltyRateMonthly      || '2',
    gracePeriodDays:        editData?.grace_period_days         || editData?.gracePeriodDays         || '7',
    earlySettlementDiscount: editData?.early_settlement_discount || editData?.earlySettlementDiscount || '0',
    agentCommissionRate:    editData?.agent_commission_rate     || editData?.agentCommissionRate     || '5',
    commissionBasis:        editData?.commission_basis          || editData?.commissionBasis         || 'full_price',
    quantityAvailable:      editData?.quantity_available        || '1',
  });

  const [formData, setFormData]   = useState(initial);
  const [errors, setErrors]       = useState({});
  const [pricingErrors, setPricingErrors] = useState({});
  const [images, setImages]       = useState([]);

  const defaultAssetTypes = [
    { value: 'vehicle',              label: 'Vehicle / Car Dealer' },
    { value: 'property',             label: 'Property / Land' },
    { value: 'construction_dealers', label: 'Construction Materials' },
    { value: 'electronics',          label: 'Electronics' },
    { value: 'furnitures',           label: 'Furniture' },
    { value: 'heavy_equipment',      label: 'Heavy Equipment' },
    { value: 'other',                label: 'Other' },
  ];

  const assetTypeOptions = (allowedAssetTypes?.length > 0) ? allowedAssetTypes : defaultAssetTypes;

  const statusOptions = [
    { value: 'available', label: 'Available' },
    { value: 'reserved',  label: 'Reserved' },
    { value: 'sold',      label: 'Sold' },
  ];

  const commissionBasisOptions = [
    { value: 'deposit_only',    label: 'On Deposit Only' },
    { value: 'full_price',      label: 'On Full Price' },
    { value: 'each_installment', label: 'On Each Installment' },
  ];

  const cfg = formData.assetType ? ASSET_CONFIGS[formData.assetType] || ASSET_CONFIGS.other : null;

  // ── Real-time field setters ───────────────────────────────────────────────
  const set = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Real-time validation
    let err = '';
    if (field === 'description' && (!value || value.trim().length < 3)) err = 'Description must be at least 3 characters';
    if (field === 'assetType'   && !value) err = 'Asset type is required';
    setErrors(prev => ({ ...prev, [field]: err }));
  };

  const setP = (field, value) => {
    setPricing(prev => ({ ...prev, [field]: value }));
    // Real-time pricing validation
    let err = '';
    const numVal = parseFloat(value);
    if (field === 'costPrice'       && value && numVal <= 0) err = 'Cost price must be greater than 0';
    if (field === 'sellingPrice'    && (!value || numVal <= 0)) err = 'Selling price is required and must be greater than 0';
    if (field === 'minSellingPrice' && value && numVal <= 0) err = 'Minimum price must be greater than 0';
    if (field === 'minSellingPrice' && value && parseFloat(pricing.sellingPrice) > 0 && numVal > parseFloat(pricing.sellingPrice))
      err = 'Minimum price cannot exceed selling price';
    if (field === 'maxDiscountPct'  && (numVal < 0 || numVal > 100)) err = 'Discount must be between 0% and 100%';
    if (field === 'minDepositPct'   && (numVal < 0 || numVal > 100)) err = 'Deposit must be between 0% and 100%';
    if (field === 'installmentInterestRate' && numVal < 0) err = 'Interest rate cannot be negative';
    if (field === 'penaltyRateMonthly'      && numVal < 0) err = 'Penalty rate cannot be negative';
    if (field === 'gracePeriodDays'         && numVal < 0) err = 'Grace period cannot be negative';
    if (field === 'agentCommissionRate' && (numVal < 0 || numVal > 100)) err = 'Commission must be between 0% and 100%';
    if (field === 'quantityAvailable'   && (!value || numVal < 1)) err = 'Quantity must be at least 1';
    setPricingErrors(prev => ({ ...prev, [field]: err }));
  };

  // ── Validate all ──────────────────────────────────────────────────────────
  const validate = () => {
    const e  = {};
    const pe = {};

    // Asset details tab
    if (!formData.assetType) e.assetType = 'Asset type is required';
    if (!formData.description || formData.description.trim().length < 3) e.description = 'Description must be at least 3 characters';
    if (cfg) {
      cfg.fields.filter(f => f.required).forEach(f => {
        if (!formData[f.key] || String(formData[f.key]).trim() === '') e[f.key] = `${f.label} is required`;
      });
    }
    if (formData.assetType === 'vehicle' && formData.vehicleYear) {
      const y = parseInt(formData.vehicleYear);
      if (isNaN(y) || y < 1900 || y > yr + 1) e.vehicleYear = `Enter a valid year (1900–${yr + 1})`;
    }

    // Pricing tab (BRS 4.1)
    if (!pricing.sellingPrice || parseFloat(pricing.sellingPrice) <= 0)
      pe.sellingPrice = 'Selling price is required ';
    if (!pricing.minSellingPrice || parseFloat(pricing.minSellingPrice) <= 0)
      pe.minSellingPrice = 'Minimum selling price is required ';
    if (pricing.minSellingPrice && pricing.sellingPrice &&
        parseFloat(pricing.minSellingPrice) > parseFloat(pricing.sellingPrice))
      pe.minSellingPrice = 'Minimum price cannot exceed selling price';
    if (!pricing.maxDiscountPct) pe.maxDiscountPct = 'Maximum discount % is required ';
    if (!pricing.installmentInterestRate) pe.installmentInterestRate = 'Interest rate is required';
    if (!pricing.minDepositPct) pe.minDepositPct = 'Minimum deposit % is required ';
    if (!pricing.maxInstallmentTenure) pe.maxInstallmentTenure = 'Maximum tenure is required ';
    if (!pricing.penaltyRateMonthly) pe.penaltyRateMonthly = 'Penalty rate is required';
    if (!pricing.gracePeriodDays) pe.gracePeriodDays = 'Grace period is required ';
    if (!pricing.agentCommissionRate) pe.agentCommissionRate = 'Commission rate is required ';
    if (!pricing.commissionBasis) pe.commissionBasis = 'Commission basis is required ';
    if (!pricing.quantityAvailable || parseFloat(pricing.quantityAvailable) < 1)
      pe.quantityAvailable = 'Quantity must be at least 1';

    setErrors(e);
    setPricingErrors(pe);

    // Switch to tab with errors
    if (Object.keys(e).length > 0) { setActiveTab('details'); return false; }
    if (Object.keys(pe).length > 0) { setActiveTab('pricing'); return false; }
    return true;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    onSubmit({
      // Asset details
      type:            formData.assetType,
      description:     formData.description.trim(),
      status:          formData.status,
      // Pricing (BRS 4.1 — all fields)
      selling_price:              parseFloat(pricing.sellingPrice),
      purchase_price:             pricing.costPrice ? parseFloat(pricing.costPrice) : null,
      min_selling_price:          pricing.minSellingPrice ? parseFloat(pricing.minSellingPrice) : null,
      max_discount_pct:           parseFloat(pricing.maxDiscountPct) || 10,
      vat_applicable:             pricing.vatApplicable,
      vat_rate:                   parseFloat(pricing.vatRate) || 16,
      installment_premium_pct:    parseFloat(pricing.installmentPremiumPct) || 0,
      installment_interest_rate:  parseFloat(pricing.installmentInterestRate) || 12,
      min_deposit_pct:            parseFloat(pricing.minDepositPct) || 20,
      max_installment_tenure:     parseInt(pricing.maxInstallmentTenure) || 60,
      penalty_rate_monthly:       parseFloat(pricing.penaltyRateMonthly) || 2,
      grace_period_days:          parseInt(pricing.gracePeriodDays) || 7,
      early_settlement_discount:  parseFloat(pricing.earlySettlementDiscount) || 0,
      agent_commission_rate:      parseFloat(pricing.agentCommissionRate) || 5,
      commission_basis:           pricing.commissionBasis,
      quantity_available:         parseInt(pricing.quantityAvailable) || 1,
      // Asset type fields
      location:          formData.propertyLocation || '',
      propertyType:      formData.propertyType     || '',
      propertySize:      formData.propertySize      || '',
      propertyTitle:     formData.propertyTitle     || '',
      make:              formData.vehicleMake       || '',
      model:             formData.vehicleModel      || '',
      year:              formData.vehicleYear ? parseInt(formData.vehicleYear) : null,
      color:             formData.vehicleColor      || '',
      plateNumber:       formData.vehiclePlate      || '',
      chassisNumber:     formData.vehicleChassis    || '',
      specifications:    formData.specifications    || '',
      images:            images.map(img => ({ name: img.name, preview: img.preview })),
    });
  };

  // ── Type-specific fields renderer ─────────────────────────────────────────
  const renderTypeFields = () => {
    if (!cfg) return null;
    const singleCols = cfg.fields.filter(f => f.col === 1);
    const fullCols   = cfg.fields.filter(f => f.col === 2);
    const pairs = [];
    for (let i = 0; i < singleCols.length; i += 2) pairs.push(singleCols.slice(i, i + 2));

    return (
      <div className={`space-y-4 pt-4 border-t border-border rounded-xl p-4 ${cfg.color} border`}>
        <div className="flex items-center gap-2">
          <Icon name={cfg.icon} size={16} color={cfg.iconColor} />
          <h3 className="text-sm font-semibold text-foreground">{cfg.label} Details</h3>
        </div>
        {pairs.map((row, ri) => (
          <div key={ri} className={`grid grid-cols-1 ${row.length > 1 ? 'md:grid-cols-2' : ''} gap-4`}>
            {row.map(f => f.select ? (
              <Field key={f.key} label={f.label} required={f.required} error={errors[f.key]}>
                <select value={formData[f.key] || ''} onChange={e => set(f.key, e.target.value)}
                  className={ic(errors[f.key])}>
                  <option value="">Select {f.label}</option>
                  {f.select.map(opt => (
                    <option key={opt} value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</option>
                  ))}
                </select>
              </Field>
            ) : (
              <Input key={f.key} label={`${f.label}${f.required ? ' *' : ''}`}
                type={f.type || 'text'} value={formData[f.key] || ''}
                onChange={e => set(f.key, f.upper ? e.target.value.toUpperCase() : e.target.value)}
                error={errors[f.key]} placeholder={f.placeholder} />
            ))}
          </div>
        ))}
        {fullCols.map(f => (
          <Input key={f.key} label={`${f.label}${f.required ? ' *' : ''}`}
            type={f.type || 'text'} value={formData[f.key] || ''}
            onChange={e => set(f.key, e.target.value)}
            error={errors[f.key]} placeholder={f.placeholder} />
        ))}
      </div>
    );
  };

  const hasDetailErrors  = Object.values(errors).some(Boolean);
  const hasPricingErrors = Object.values(pricingErrors).some(Boolean);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Icon name="Package" size={18} color="#1A56DB" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">
                {editData ? 'Edit Asset' : 'Register New Asset'}
              </h2>
              <p className="text-xs text-muted-foreground">Asset & Pricing Configuration</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 px-6 py-3 border-b border-border bg-muted/20 flex-shrink-0">
          {[
            { id: 'details', label: 'Asset Details', icon: 'Package', hasError: hasDetailErrors },
            { id: 'pricing', label: 'Pricing Engine', icon: 'TrendingUp', hasError: hasPricingErrors },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border-2 transition-all relative ${
                activeTab === tab.id ? 'border-primary text-white' : 'border-border text-muted-foreground hover:border-primary/40'
              }`}
              style={activeTab === tab.id ? { background: 'linear-gradient(135deg,#1A56DB,#1E429F)' } : {}}>
              <Icon name={tab.icon} size={14} color={activeTab === tab.id ? 'white' : 'currentColor'} />
              {tab.label}
              {tab.hasError && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white text-xs">!</span>
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* ══ TAB 1: ASSET DETAILS ══ */}
          {activeTab === 'details' && (
            <>
              <Select label="Asset Type" required options={assetTypeOptions}
                value={formData.assetType} onChange={v => set('assetType', v)}
                error={errors.assetType} placeholder="Select asset type" />

              <Input label="Description" type="text" required value={formData.description}
                onChange={e => set('description', e.target.value)} error={errors.description}
                placeholder={
                  formData.assetType === 'vehicle'   ? 'e.g. 2022 Toyota Prado TX – Pearl White' :
                  formData.assetType === 'property'  ? 'e.g. 3-Bedroom House on 0.25 acres, Kileleshwa' :
                  'Enter asset description (min 3 characters)'
                } />

              <Select label="Status" required options={statusOptions}
                value={formData.status} onChange={v => set('status', v)}
                placeholder="Select status" />

              {renderTypeFields()}

              {formData.assetType && (
                <div className="pt-2">
                  <ImageUpload images={images}
                    onAdd={img => setImages(prev => [...prev, img])}
                    onRemove={i => setImages(prev => prev.filter((_, idx) => idx !== i))} />
                </div>
              )}
            </>
          )}

          {/* ══ TAB 2: PRICING ENGINE (BRS 4.1) ══ */}
          {activeTab === 'pricing' && (
            <div className="space-y-5">

              {/* Live preview */}
              <PricingPreview pricing={pricing} />

              {/* Pricing info banner */}
              <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800">
                <Icon name="Info" size={14} color="#1A56DB" />
                <p>Configure all pricing parameters These values are enforced at the POS — agents cannot override them without manager approval.</p>
              </div>

              {/* Price configuration */}
              <div>
                <p className="text-xs font-bold text-foreground uppercase tracking-wide mb-3">Price Configuration</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Cost Price / Purchase Price (KES)" error={pricingErrors.costPrice}
                    hint="Your purchase or production cost">
                    <input type="number" value={pricing.costPrice} onChange={e => setP('costPrice', e.target.value)}
                      placeholder="0.00" className={ic(pricingErrors.costPrice)} />
                  </Field>
                  <Field label="Standard Selling Price (KES)" required error={pricingErrors.sellingPrice}
                    hint="Default market price shown to clients">
                    <input type="number" value={pricing.sellingPrice} onChange={e => setP('sellingPrice', e.target.value)}
                      placeholder="0.00" className={ic(pricingErrors.sellingPrice)} />
                  </Field>
                  <Field label="Minimum Selling Price (KES)" required error={pricingErrors.minSellingPrice}
                    hint="Floor price — no sale allowed below this">
                    <input type="number" value={pricing.minSellingPrice} onChange={e => setP('minSellingPrice', e.target.value)}
                      placeholder="0.00" className={ic(pricingErrors.minSellingPrice)} />
                  </Field>
                  <Field label="Maximum Discount (%)" required error={pricingErrors.maxDiscountPct}
                    hint="Agent cannot give more than this without manager approval">
                    <input type="number" value={pricing.maxDiscountPct} onChange={e => setP('maxDiscountPct', e.target.value)}
                      placeholder="10" min="0" max="100" className={ic(pricingErrors.maxDiscountPct)} />
                  </Field>
                  <Field label="Quantity Available" required error={pricingErrors.quantityAvailable}
                    hint="Number of units in stock">
                    <input type="number" value={pricing.quantityAvailable} onChange={e => setP('quantityAvailable', e.target.value)}
                      placeholder="1" min="1" className={ic(pricingErrors.quantityAvailable)} />
                  </Field>
                </div>
              </div>

              {/* VAT */}
              <div>
                <p className="text-xs font-bold text-foreground uppercase tracking-wide mb-3">VAT Configuration</p>
                <div className="flex items-center gap-3 mb-3">
                  <button onClick={() => setP('vatApplicable', !pricing.vatApplicable)}
                    className={`w-10 h-6 rounded-full transition-colors flex items-center ${pricing.vatApplicable ? 'bg-primary justify-end' : 'bg-muted justify-start'}`}>
                    <span className="w-5 h-5 bg-white rounded-full shadow mx-0.5" />
                  </button>
                  <div>
                    <p className="text-sm font-medium text-foreground">VAT Applicable</p>
                    <p className="text-xs text-muted-foreground">
                      {pricing.vatApplicable ? 'VAT (16%) will be added to the selling price' : 'No VAT — zero-rated or exempt'}
                    </p>
                  </div>
                </div>
                {pricing.vatApplicable && (
                  <Field label="VAT Rate (%)" hint="Default 16% standard rate">
                    <input type="number" value={pricing.vatRate} onChange={e => setP('vatRate', e.target.value)}
                      placeholder="16" className={ic(false)} />
                  </Field>
                )}
              </div>

              {/* Installment pricing */}
              <div>
                <p className="text-xs font-bold text-foreground uppercase tracking-wide mb-3">Installment Pricing</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Installment Price Premium (%)" error={pricingErrors.installmentPremiumPct}
                    hint="Price uplift for installment buyers (on top of selling price)">
                    <input type="number" value={pricing.installmentPremiumPct} onChange={e => setP('installmentPremiumPct', e.target.value)}
                      placeholder="0" min="0" className={ic(pricingErrors.installmentPremiumPct)} />
                  </Field>
                  <Field label="Annual Interest Rate (% p.a.)" required error={pricingErrors.installmentInterestRate}
                    hint="Applied to the financed balance">
                    <input type="number" value={pricing.installmentInterestRate} onChange={e => setP('installmentInterestRate', e.target.value)}
                      placeholder="12" min="0" className={ic(pricingErrors.installmentInterestRate)} />
                  </Field>
                  <Field label="Minimum Deposit (%)" required error={pricingErrors.minDepositPct}
                    hint="Minimum deposit as % of selling price">
                    <input type="number" value={pricing.minDepositPct} onChange={e => setP('minDepositPct', e.target.value)}
                      placeholder="20" min="0" max="100" className={ic(pricingErrors.minDepositPct)} />
                  </Field>
                  <Field label="Maximum Installment Tenure (months)" required error={pricingErrors.maxInstallmentTenure}
                    hint="e.g. 6, 12, 24, 36, 60">
                    <select value={pricing.maxInstallmentTenure} onChange={e => setP('maxInstallmentTenure', e.target.value)}
                      className={ic(pricingErrors.maxInstallmentTenure)}>
                      {[6, 12, 18, 24, 36, 48, 60].map(m => (
                        <option key={m} value={m}>{m} months</option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>

              {/* Penalties & settlement */}
              <div>
                <p className="text-xs font-bold text-foreground uppercase tracking-wide mb-3">Penalties & Settlement</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Field label="Penalty Rate (% per month )" required error={pricingErrors.penaltyRateMonthly}
                    hint="Applied on overdue installments after grace period">
                    <input type="number" value={pricing.penaltyRateMonthly} onChange={e => setP('penaltyRateMonthly', e.target.value)}
                      placeholder="2" min="0" className={ic(pricingErrors.penaltyRateMonthly)} />
                  </Field>
                  <Field label="Grace Period (days)" required error={pricingErrors.gracePeriodDays}
                    hint="Days after due date before penalty applies">
                    <input type="number" value={pricing.gracePeriodDays} onChange={e => setP('gracePeriodDays', e.target.value)}
                      placeholder="7" min="0" className={ic(pricingErrors.gracePeriodDays)} />
                  </Field>
                  <Field label="Early Settlement Discount (%)" error={pricingErrors.earlySettlementDiscount}
                    hint="Reward for clients who pay off early">
                    <input type="number" value={pricing.earlySettlementDiscount} onChange={e => setP('earlySettlementDiscount', e.target.value)}
                      placeholder="0" min="0" max="100" className={ic(pricingErrors.earlySettlementDiscount)} />
                  </Field>
                </div>
              </div>

              {/* Agent commission */}
              <div>
                <p className="text-xs font-bold text-foreground uppercase tracking-wide mb-3">Agent Commission</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Commission Rate (%)" required error={pricingErrors.agentCommissionRate}
                    hint="% of sale value credited to agent on confirmation">
                    <input type="number" value={pricing.agentCommissionRate} onChange={e => setP('agentCommissionRate', e.target.value)}
                      placeholder="5" min="0" max="100" className={ic(pricingErrors.agentCommissionRate)} />
                  </Field>
                  <Field label="Commission Basis" required error={pricingErrors.commissionBasis}
                    hint="When is the commission calculated?">
                    <select value={pricing.commissionBasis} onChange={e => setP('commissionBasis', e.target.value)}
                      className={ic(pricingErrors.commissionBasis)}>
                      {commissionBasisOptions.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>

            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border flex-shrink-0 bg-card">
          <div className="flex items-center gap-2">
            {hasDetailErrors && (
              <span className="text-xs text-red-500 flex items-center gap-1">
                <Icon name="AlertCircle" size={12} color="#ef4444" /> Fix errors in Asset Details
              </span>
            )}
            {hasPricingErrors && (
              <span className="text-xs text-red-500 flex items-center gap-1">
                <Icon name="AlertCircle" size={12} color="#ef4444" /> Fix errors in Pricing Engine
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button variant="default" onClick={handleSubmit}>
              {editData ? 'Update Asset' : 'Register Asset'}
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
};

export default AssetRegistrationForm;

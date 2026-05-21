import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const ASSET_TYPE_META = {
  property:             { label: 'Property',             icon: 'Building2', color: '#1A56DB', bg: 'bg-blue-100' },
  vehicle:              { label: 'Vehicle',              icon: 'Car',       color: '#059669', bg: 'bg-emerald-100' },
  construction_dealers: { label: 'Construction',         icon: 'HardHat',   color: '#d97706', bg: 'bg-amber-100' },
  electronics:          { label: 'Electronics',          icon: 'Cpu',       color: '#7c3aed', bg: 'bg-purple-100' },
  furnitures:           { label: 'Furniture',            icon: 'Sofa',      color: '#db2777', bg: 'bg-pink-100' },
  heavy_equipment:      { label: 'Heavy Equipment',      icon: 'Truck',     color: '#ea580c', bg: 'bg-orange-100' },
  other:                { label: 'Other',                icon: 'Package',   color: '#6b7280', bg: 'bg-gray-100' },
};

const EnquiryModal = ({ asset, onClose, onSend, existingEnquiry }) => {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const meta = ASSET_TYPE_META[asset.asset_type] || ASSET_TYPE_META.other;
  const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  const handleSend = async () => {
    if (!message.trim()) return;
    setLoading(true);
    try {
      await onSend(asset.id, message);
      setSent(true);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${meta.bg}`}>
              <Icon name={meta.icon} size={20} color={meta.color} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Express Interest</h3>
              <p className="text-xs text-muted-foreground line-clamp-1">{asset.description}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        <div className="px-6 py-5">
          {sent || existingEnquiry ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                <Icon name="CheckCircle" size={28} color="#059669" />
              </div>
              <p className="font-bold text-foreground text-lg">Enquiry Sent!</p>
              <p className="text-sm text-muted-foreground mt-1">
                Your admin has been notified of your interest in this asset.
              </p>
              {existingEnquiry && (
                <p className="text-xs text-muted-foreground mt-2">
                  Status: <span className="font-semibold capitalize">{existingEnquiry.status}</span>
                </p>
              )}
              <button
                onClick={onClose}
                className="mt-4 w-full py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
              >
                Close
              </button>
            </div>
          ) : (
            <>
              {/* Asset summary */}
              <div className="p-3 rounded-xl bg-muted/30 border border-border mb-4">
                <p className="font-semibold text-foreground text-sm">{asset.description}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{asset.asset_code}</p>
                <p className="text-sm font-bold text-primary mt-1">
                  {fmt(asset.selling_price)}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Your message to the admin *
                </label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="e.g. I am interested in this vehicle. Please contact me to discuss payment options..."
                  rows={4}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground resize-none"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Your admin will contact you after reviewing your enquiry
                </p>
              </div>

              <div className="flex gap-3 mt-4">
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSend}
                  disabled={loading || !message.trim()}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                      </svg>
                      Sending...
                    </>
                  ) : (
                    <>
                      <Icon name="Send" size={15} color="currentColor" />
                      Send Enquiry
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const BrowseAssetsTab = ({ assets, enquiries, onEnquire }) => {
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  const filtered = assets.filter(a => {
    const matchSearch = !search ||
      a.description?.toLowerCase().includes(search.toLowerCase()) ||
      a.asset_code?.toLowerCase().includes(search.toLowerCase());
    const matchType = filterType === 'all' || a.asset_type === filterType;
    return matchSearch && matchType;
  });

  const types = [...new Set(assets.map(a => a.asset_type))];

  const hasEnquiry = (assetId) =>
    enquiries.find(e => e.asset_id === assetId);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center">
            <Icon name="ShoppingBag" size={16} color="#1A56DB" />
          </div>
          <h3 className="text-base font-semibold text-foreground">Browse Available Assets</h3>
        </div>
        <p className="text-xs text-muted-foreground ml-11">
          Explore other assets available from your company. Click "I'm Interested" to send an enquiry.
        </p>
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Icon name="Search" size={14} color="var(--color-muted-foreground)" className="absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search assets..."
            className="w-full pl-8 pr-3 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filterType === 'all' ? 'bg-primary text-white' : 'bg-card border border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            All
          </button>
          {types.map(type => {
            const meta = ASSET_TYPE_META[type] || ASSET_TYPE_META.other;
            return (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  filterType === type ? 'bg-primary text-white' : 'bg-card border border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Assets Grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground bg-card border border-border rounded-xl">
          <Icon name="ShoppingBag" size={32} color="currentColor" />
          <p className="text-sm mt-2 font-medium">No available assets</p>
          <p className="text-xs mt-1">Check back later for new listings</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filtered.map(asset => {
            const meta = ASSET_TYPE_META[asset.asset_type] || ASSET_TYPE_META.other;
            const enquiry = hasEnquiry(asset.id);
            return (
              <div key={asset.id} className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-md transition-all">
                {/* Asset Header */}
                <div className="p-4 border-b border-border">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${meta.bg}`}>
                        <Icon name={meta.icon} size={20} color={meta.color} />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground text-sm line-clamp-2">{asset.description}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{asset.asset_code}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Asset Details */}
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Price</span>
                    <span className="text-base font-bold text-foreground">{fmt(asset.selling_price)}</span>
                  </div>

                  {asset.location && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Icon name="MapPin" size={12} color="currentColor" />
                      {asset.location}
                    </div>
                  )}

                  {asset.asset_type === 'vehicle' && asset.make && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Icon name="Car" size={12} color="currentColor" />
                      {asset.make} {asset.model} {asset.year && `(${asset.year})`}
                    </div>
                  )}

                  <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium capitalize ${meta.bg}`}
                    style={{ color: meta.color }}>
                    {meta.label}
                  </span>
                </div>

                {/* Action */}
                <div className="px-4 pb-4">
                  {enquiry ? (
                    <div className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
                      <Icon name="CheckCircle" size={14} color="#059669" />
                      <span className="text-xs font-medium text-emerald-700">
                        Enquiry sent · {enquiry.status}
                      </span>
                    </div>
                  ) : (
                    <button
                      onClick={() => setSelected(asset)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
                      style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
                    >
                      <Icon name="Heart" size={14} color="currentColor" />
                      I'm Interested
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <EnquiryModal
          asset={selected}
          onClose={() => setSelected(null)}
          onSend={onEnquire}
          existingEnquiry={hasEnquiry(selected.id)}
        />
      )}
    </div>
  );
};

export default BrowseAssetsTab;
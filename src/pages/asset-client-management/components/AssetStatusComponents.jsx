import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabase';

// ── Status config ─────────────────────────────────────────────────────────────
export const STATUS_CONFIG = {
  available: {
    label:    'Available',
    color:    'bg-emerald-100 text-emerald-700 border-emerald-200',
    dot:      'bg-emerald-500',
    icon:     'CheckCircle',
    iconColor:'#059669',
  },
  reserved: {
    label:    'Reserved',
    color:    'bg-amber-100 text-amber-700 border-amber-200',
    dot:      'bg-amber-500',
    icon:     'Clock',
    iconColor:'#d97706',
  },
  on_installment: {
    label:    'On Installment',
    color:    'bg-blue-100 text-blue-700 border-blue-200',
    dot:      'bg-blue-500',
    icon:     'Calendar',
    iconColor:'#1d4ed8',
  },
  sold: {
    label:    'Sold',
    color:    'bg-gray-100 text-gray-700 border-gray-200',
    dot:      'bg-gray-500',
    icon:     'ShoppingBag',
    iconColor:'#374151',
  },
  completed: {
    label:    'Completed',
    color:    'bg-purple-100 text-purple-700 border-purple-200',
    dot:      'bg-purple-500',
    icon:     'Award',
    iconColor:'#7c3aed',
  },
  maintenance: {
    label:    'Maintenance',
    color:    'bg-orange-100 text-orange-700 border-orange-200',
    dot:      'bg-orange-500',
    icon:     'Tool',
    iconColor:'#c2410c',
  },
};

// ── Status Badge ──────────────────────────────────────────────────────────────
export const AssetStatusBadge = ({ status, showIcon = false, size = 'sm' }) => {
  const cfg = STATUS_CONFIG[status] || {
    label: status || 'Unknown',
    color: 'bg-gray-100 text-gray-600 border-gray-200',
    dot:   'bg-gray-400',
    icon:  'Circle',
    iconColor: '#6b7280',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border capitalize ${cfg.color}`}>
      {showIcon
        ? <Icon name={cfg.icon} size={11} color={cfg.iconColor} />
        : <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      }
      {cfg.label}
    </span>
  );
};

// ── Status History Timeline ───────────────────────────────────────────────────
const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) : '—';

export const AssetStatusHistory = ({ assetId, onClose }) => {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const { data: asset } = await supabase
          .from('assets')
          .select('asset_code, description, asset_status, status_history, reserved_at, sold_at, created_at')
          .eq('id', assetId)
          .single();
        setData(asset);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    if (assetId) load();
  }, [assetId]);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center">
              <Icon name="Activity" size={18} color="#1A56DB" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Status History</h3>
              <p className="text-xs text-muted-foreground">{data?.asset_code || '—'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {loading ? (
            <div className="space-y-3 animate-pulse">
              {[1,2,3].map(i => <div key={i} className="h-16 bg-muted rounded-xl" />)}
            </div>
          ) : !data ? (
            <p className="text-sm text-muted-foreground text-center py-8">Asset not found</p>
          ) : (
            <>
              {/* Current status */}
              <div className="flex items-center justify-between mb-5 p-3 bg-muted/30 rounded-xl border border-border">
                <div>
                  <p className="text-xs text-muted-foreground">Current Status</p>
                  <p className="font-semibold text-foreground mt-0.5">{data.description}</p>
                </div>
                <AssetStatusBadge status={data.asset_status} showIcon />
              </div>

              {/* Timeline */}
              <div className="relative">
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

                {/* Registration event */}
                <div className="relative flex gap-4 mb-4">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 border-2 border-background flex items-center justify-center flex-shrink-0 z-10">
                    <Icon name="Plus" size={14} color="#059669" />
                  </div>
                  <div className="flex-1 bg-muted/30 rounded-xl p-3 border border-border">
                    <p className="text-sm font-medium text-foreground">Asset Registered</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Initial status: Available</p>
                    <p className="text-xs text-muted-foreground mt-1">{fmtDateTime(data.created_at)}</p>
                  </div>
                </div>

                {/* Status change history */}
                {(data.status_history || []).map((entry, i) => {
                  const fromCfg = STATUS_CONFIG[entry.from] || {};
                  const toCfg   = STATUS_CONFIG[entry.to]   || {};
                  return (
                    <div key={i} className="relative flex gap-4 mb-4">
                      <div className={`w-8 h-8 rounded-full border-2 border-background flex items-center justify-center flex-shrink-0 z-10 ${toCfg.dot ? toCfg.dot.replace('bg-', 'bg-') : 'bg-blue-500'}`}
                        style={{ backgroundColor: toCfg.dot?.replace('bg-', '') }}>
                        <Icon name={toCfg.icon || 'ArrowRight'} size={14} color="white" />
                      </div>
                      <div className="flex-1 bg-muted/30 rounded-xl p-3 border border-border">
                        <div className="flex items-center gap-2 mb-1">
                          <AssetStatusBadge status={entry.from} />
                          <Icon name="ArrowRight" size={12} color="var(--color-muted-foreground)" />
                          <AssetStatusBadge status={entry.to} />
                        </div>
                        {entry.reason && (
                          <p className="text-xs text-foreground mt-1">{entry.reason}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {fmtDateTime(entry.changed_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}

                {/* Empty state */}
                {(!data.status_history || data.status_history.length === 0) && (
                  <div className="relative flex gap-4 mb-4">
                    <div className="w-8 h-8 rounded-full bg-muted border-2 border-background flex items-center justify-center flex-shrink-0 z-10">
                      <Icon name="Info" size={14} color="var(--color-muted-foreground)" />
                    </div>
                    <div className="flex-1 bg-muted/30 rounded-xl p-3 border border-border">
                      <p className="text-sm text-muted-foreground">
                        No status changes yet — history will appear here when the asset is sold or reserved.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="px-6 pb-5">
          <button onClick={onClose}
            className="w-full py-2.5 text-sm font-medium border border-border rounded-xl hover:bg-muted transition-colors text-foreground">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Status Summary Widget (for dashboard/asset list) ──────────────────────────
export const AssetStatusSummary = ({ assets = [] }) => {
  const counts = assets.reduce((acc, a) => {
    const s = a.asset_status || 'available';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  const statuses = ['available', 'reserved', 'on_installment', 'sold'];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {statuses.map(status => {
        const cfg   = STATUS_CONFIG[status];
        const count = counts[status] || 0;
        return (
          <div key={status} className={`flex items-center gap-3 p-3 rounded-xl border ${cfg.color}`}>
            <div className="w-9 h-9 rounded-xl bg-white/60 flex items-center justify-center flex-shrink-0">
              <Icon name={cfg.icon} size={18} color={cfg.iconColor} />
            </div>
            <div>
              <p className="text-2xl font-bold">{count}</p>
              <p className="text-xs font-medium">{cfg.label}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default AssetStatusBadge;

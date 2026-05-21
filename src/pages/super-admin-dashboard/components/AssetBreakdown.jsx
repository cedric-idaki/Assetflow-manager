import React from 'react';
import Icon from '../../../components/AppIcon';

const TYPE_META = {
  property: { label: 'Property',  color: '#1A56DB', bg: 'bg-blue-100',    icon: 'Building2' },
  vehicle:  { label: 'Vehicle',   color: '#059669', bg: 'bg-emerald-100', icon: 'Car' },
  equipment:{ label: 'Equipment', color: '#d97706', bg: 'bg-amber-100',   icon: 'Wrench' },
  other:    { label: 'Other',     color: '#7c3aed', bg: 'bg-purple-100',  icon: 'Package' },
};

const AssetBreakdown = ({ data }) => {
  const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const total = data.reduce((s, d) => s + d.totalValue, 0);

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-foreground">Asset Breakdown</h2>
        <span className="text-xs text-muted-foreground">By type · Total value</span>
      </div>

      {data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <Icon name="Package" size={28} color="currentColor" />
          <p className="text-sm mt-2">No assets registered</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((item) => {
            const meta = TYPE_META[item.type] || TYPE_META.other;
            const pct = total > 0 ? Math.round((item.totalValue / total) * 100) : 0;
            return (
              <div key={item.type}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${meta.bg}`}>
                      <Icon name={meta.icon} size={14} color={meta.color} />
                    </div>
                    <span className="text-sm font-medium text-foreground">{meta.label}</span>
                    <span className="text-xs text-muted-foreground">({item.count} assets)</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-semibold text-foreground">{fmt(item.totalValue)}</span>
                    <span className="text-xs text-muted-foreground ml-2">{pct}%</span>
                  </div>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, backgroundColor: meta.color }}
                  />
                </div>
                <div className="flex justify-between mt-0.5">
                  <span className="text-xs text-muted-foreground">{item.sold} sold</span>
                  <span className="text-xs text-muted-foreground">{item.count - item.sold} remaining</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AssetBreakdown;
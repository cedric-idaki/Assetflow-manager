import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const ASSET_COLORS = {
  property: '#1A56DB',
  vehicle: '#059669',
  construction_dealers: '#d97706',
  electronics: '#7c3aed',
  furnitures: '#db2777',
  heavy_equipment: '#ea580c',
  other: '#6b7280',
};

const SalesReportTab = ({ assets, payments, agents, clients, onExport }) => {
  const [activeChart, setActiveChart] = useState('assets');
  const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  // ── Asset type breakdown ───────────────────────────────────────────────────
  const assetBreakdown = assets.reduce((acc, asset) => {
    const type = asset.asset_type || 'other';
    if (!acc[type]) acc[type] = { type, count: 0, totalValue: 0, sold: 0 };
    acc[type].count++;
    acc[type].totalValue += parseFloat(asset.selling_price || 0);
    if (asset.asset_status === 'sold') acc[type].sold++;
    return acc;
  }, {});
  const assetData = Object.values(assetBreakdown);
  const totalAssetValue = assetData.reduce((s, d) => s + d.totalValue, 0);

  // ── Payment method breakdown ───────────────────────────────────────────────
  const paymentMethods = payments.reduce((acc, p) => {
    const method = p.payment_method || 'other';
    if (!acc[method]) acc[method] = { method, count: 0, total: 0 };
    acc[method].count++;
    acc[method].total += parseFloat(p.amount || 0);
    return acc;
  }, {});
  const paymentData = Object.values(paymentMethods);
  const totalPayments = paymentData.reduce((s, d) => s + d.total, 0);

  // ── Agent performance ──────────────────────────────────────────────────────
  const topAgents = [...agents]
    .sort((a, b) => parseFloat(b.total_sales || 0) - parseFloat(a.total_sales || 0))
    .slice(0, 5);

  // ── Monthly payments trend ─────────────────────────────────────────────────
  const monthlyTrend = payments.reduce((acc, p) => {
    if (!p.payment_date) return acc;
    const month = new Date(p.payment_date).toLocaleString('default', { month: 'short', year: '2-digit' });
    if (!acc[month]) acc[month] = { month, total: 0, count: 0 };
    acc[month].total += parseFloat(p.amount || 0);
    acc[month].count++;
    return acc;
  }, {});
  const trendData = Object.values(monthlyTrend).slice(-6);
  const maxTrend = Math.max(...trendData.map(d => d.total), 1);

  return (
    <div className="space-y-6">
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Assets', value: assets.length, icon: 'Package', color: 'bg-blue-100', iconColor: '#1A56DB' },
          { label: 'Assets Sold', value: assets.filter(a => a.asset_status === 'sold').length, icon: 'TrendingUp', color: 'bg-emerald-100', iconColor: '#059669' },
          { label: 'Total Revenue', value: fmt(payments.filter(p => p.payment_status === 'completed').reduce((s, p) => s + parseFloat(p.amount || 0), 0)), icon: 'DollarSign', color: 'bg-purple-100', iconColor: '#7c3aed' },
          { label: 'Active Clients', value: clients.filter(c => c.client_status === 'active').length, icon: 'Users', color: 'bg-teal-100', iconColor: '#0d9488' },
        ].map((item, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${item.color}`}>
                <Icon name={item.icon} size={16} color={item.iconColor} />
              </div>
            </div>
            <p className="text-2xl font-bold text-foreground">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Chart Tabs */}
      <div className="flex gap-1 flex-wrap">
        {[
          { id: 'assets', label: 'Asset Types' },
          { id: 'payments', label: 'Payment Methods' },
          { id: 'trend', label: 'Monthly Trend' },
          { id: 'agents', label: 'Agent Performance' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveChart(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeChart === tab.id
                ? 'bg-primary text-white'
                : 'bg-card border border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Asset Types Chart */}
      {activeChart === 'assets' && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-foreground">Asset Type Breakdown</h3>
            <button
              onClick={() => onExport(assetData, 'asset_breakdown')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Icon name="Download" size={13} color="currentColor" />
              Export
            </button>
          </div>
          {assetData.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Icon name="Package" size={28} color="currentColor" />
              <p className="text-sm mt-2">No assets registered yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {assetData.map(item => {
                const pct = totalAssetValue > 0 ? Math.round((item.totalValue / totalAssetValue) * 100) : 0;
                const color = ASSET_COLORS[item.type] || ASSET_COLORS.other;
                return (
                  <div key={item.type}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ background: color }} />
                        <span className="text-sm font-medium text-foreground capitalize">
                          {item.type.replace(/_/g, ' ')}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          ({item.count} assets · {item.sold} sold)
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-foreground">{fmt(item.totalValue)}</span>
                        <span className="text-xs text-muted-foreground ml-2">{pct}%</span>
                      </div>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, background: color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Payment Methods Chart */}
      {activeChart === 'payments' && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-foreground">Payment Methods</h3>
            <button
              onClick={() => onExport(paymentData, 'payment_methods')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Icon name="Download" size={13} color="currentColor" />
              Export
            </button>
          </div>
          {paymentData.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Icon name="CreditCard" size={28} color="currentColor" />
              <p className="text-sm mt-2">No payments recorded yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {paymentData.map((item, i) => {
                const pct = totalPayments > 0 ? Math.round((item.total / totalPayments) * 100) : 0;
                const colors = ['#1A56DB', '#059669', '#d97706', '#7c3aed', '#ea580c'];
                const color = colors[i % colors.length];
                return (
                  <div key={item.method}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ background: color }} />
                        <span className="text-sm font-medium text-foreground capitalize">
                          {item.method.replace(/_/g, ' ')}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          ({item.count} transactions)
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-foreground">{fmt(item.total)}</span>
                        <span className="text-xs text-muted-foreground ml-2">{pct}%</span>
                      </div>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, background: color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Monthly Trend */}
      {activeChart === 'trend' && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-foreground">Monthly Payment Trend</h3>
            <button
              onClick={() => onExport(trendData, 'monthly_trend')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Icon name="Download" size={13} color="currentColor" />
              Export
            </button>
          </div>
          {trendData.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Icon name="TrendingUp" size={28} color="currentColor" />
              <p className="text-sm mt-2">No payment data yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {trendData.map(item => {
                const pct = Math.round((item.total / maxTrend) * 100);
                return (
                  <div key={item.month}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-foreground w-16">{item.month}</span>
                      <div className="flex-1 mx-3">
                        <div className="h-6 bg-muted rounded-lg overflow-hidden">
                          <div
                            className="h-full rounded-lg transition-all duration-700 flex items-center px-2"
                            style={{ width: `${pct}%`, background: 'linear-gradient(135deg, #1A56DB, #1E429F)', minWidth: '2px' }}
                          />
                        </div>
                      </div>
                      <div className="text-right w-32">
                        <span className="text-sm font-semibold text-foreground">{fmt(item.total)}</span>
                        <span className="text-xs text-muted-foreground ml-1">({item.count})</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Agent Performance */}
      {activeChart === 'agents' && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-foreground">Top Agent Performance</h3>
            <button
              onClick={() => onExport(topAgents.map(a => ({
                name: a.full_name,
                total_sales: a.total_sales,
                commission: a.total_commission,
                target: a.target_amount,
              })), 'agent_performance')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Icon name="Download" size={13} color="currentColor" />
              Export
            </button>
          </div>
          {topAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Icon name="Users" size={28} color="currentColor" />
              <p className="text-sm mt-2">No agents yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {topAgents.map((agent, index) => {
                const pct = agent.target_amount > 0
                  ? Math.min(100, Math.round((agent.total_sales / agent.target_amount) * 100))
                  : 0;
                const medals = ['🥇', '🥈', '🥉'];
                return (
                  <div key={agent.id} className="flex items-center gap-4 p-3 rounded-xl bg-muted/30">
                    <span className="text-xl flex-shrink-0">
                      {medals[index] || `#${index + 1}`}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-semibold text-foreground truncate">{agent.full_name}</p>
                        <p className="text-sm font-bold text-emerald-600 flex-shrink-0 ml-2">
                          {fmt(agent.total_sales)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${pct}%`,
                              background: pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444'
                            }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground flex-shrink-0">{pct}% of target</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SalesReportTab;
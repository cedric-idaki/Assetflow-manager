import React from 'react';
import Icon from '../../../components/AppIcon';
import { Card, StatCard, KES } from './_shared';

const OverviewTab = ({ ctx, onNavigate }) => {
  const { stats, sacco, members, loans, motions } = ctx;
  const bill = stats.billing;
  const freeGb = stats.tier?.storageGb || 0;
  const usedGb = Number(sacco?.storage_used_gb || 0);
  const storagePct = freeGb ? Math.min(100, Math.round((usedGb / freeGb) * 100)) : 0;

  const quick = [
    { tab: 'members', icon: 'UserPlus', label: 'Add member' },
    { tab: 'contributions', icon: 'PiggyBank', label: 'Record contribution' },
    { tab: 'loans', icon: 'Banknote', label: 'New loan' },
    { tab: 'voting', icon: 'Vote', label: 'Raise a motion' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total members" value={stats.totalMembers} hint={`${stats.activeMembers} active`} icon="Users" />
        <StatCard label="Total savings" value={KES(stats.totalSavings)} hint="Paid contributions" icon="PiggyBank" tone="success" />
        <StatCard label="Active loans" value={stats.activeLoans} hint={`${loans.length} total`} icon="Banknote" tone="warning" />
        <StatCard label="Share value" value={KES(stats.totalShareValue)} hint="Across members" icon="PieChart" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Billing estimate */}
        <Card title="This month's estimate" subtitle={`${stats.tier?.name} tier`} className="lg:col-span-2">
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Base fee ({stats.tier?.name})</span>
              <span className="font-semibold text-foreground">{KES(bill.baseFee)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Per-member · {stats.activeMembers} × {KES(stats.tier?.perMemberFee)}</span>
              <span className="font-semibold text-foreground">{KES(bill.perMemberFeeTotal)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Storage excess · {bill.excessGb} GB</span>
              <span className="font-semibold text-foreground">{KES(bill.storageFee)}</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="font-bold text-foreground">Estimated monthly bill</span>
              <span className="text-xl font-bold text-foreground">{KES(bill.total)}</span>
            </div>
          </div>
          <button onClick={() => onNavigate('billing')} className="text-xs text-primary font-semibold mt-3 hover:underline">
            View billing details →
          </button>
        </Card>

        {/* Storage gauge */}
        <Card title="Storage" subtitle={`${freeGb} GB free on ${stats.tier?.name}`}>
          <div className="flex items-end justify-between">
            <p className="text-2xl font-bold text-foreground">{usedGb} GB</p>
            <p className="text-xs text-muted-foreground">of {freeGb} GB</p>
          </div>
          <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${storagePct}%`, background: storagePct >= 100 ? '#ef4444' : storagePct >= 80 ? '#f59e0b' : '#34c1dd' }} />
          </div>
          <p className="text-xs text-muted-foreground mt-2">{storagePct}% used · alerts at 80% and 100%</p>
        </Card>
      </div>

      {/* Quick actions */}
      <Card title="Quick actions">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {quick.map((q) => (
            <button key={q.tab} onClick={() => onNavigate(q.tab)}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border hover:border-primary/40 hover:bg-muted transition-all">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(52,193,221,0.12)' }}>
                <Icon name={q.icon} size={18} color="#1da8c5" />
              </div>
              <span className="text-xs font-medium text-foreground text-center">{q.label}</span>
            </button>
          ))}
        </div>
      </Card>

      {/* Open motions */}
      {motions.filter((m) => m.status === 'open').length > 0 && (
        <Card title="Open votes" subtitle="Motions currently open for voting">
          <div className="space-y-2">
            {motions.filter((m) => m.status === 'open').map((m) => (
              <div key={m.id} className="flex items-center justify-between p-3 rounded-lg border border-border">
                <div>
                  <p className="text-sm font-medium text-foreground">{m.title}</p>
                  <p className="text-xs text-muted-foreground capitalize">{m.ballot_type} ballot</p>
                </div>
                <button onClick={() => onNavigate('voting')} className="text-xs text-primary font-semibold hover:underline">Open →</button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};

export default OverviewTab;

import React from 'react';
import Icon from '../../../components/AppIcon';


const StatCard = ({ label, value, icon, color, subtext }) => (
  <div className="bg-card border border-border rounded-xl p-5">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
        {subtext && <p className="text-xs text-muted-foreground mt-0.5">{subtext}</p>}
      </div>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${color?.replace('text-', 'bg-')?.replace('500', '500/10')}`}>
        <Icon name={icon} size={18} color="currentColor" className={color} />
      </div>
    </div>
  </div>
);

const CompletionBar = ({ label, percentage, color }) => (
  <div className="space-y-1.5">
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold text-foreground">{percentage}%</span>
    </div>
    <div className="h-2 bg-muted rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-700 ${color}`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  </div>
);

const ComplianceDashboard = ({ clients = [] }) => {
  const total = clients?.length || 0;
  const verified = clients?.filter(c => c?.kycStatus === 'verified')?.length || 0;
  const pending = clients?.filter(c => c?.kycStatus === 'pending' || c?.kycStatus === 'under_review')?.length || 0;
  const rejected = clients?.filter(c => c?.kycStatus === 'rejected')?.length || 0;
  const incomplete = clients?.filter(c => c?.kycStatus === 'incomplete')?.length || 0;
  const completionRate = total > 0 ? Math.round((verified / total) * 100) : 0;

  const expiryAlerts = clients?.filter(c => {
    if (!c?.documentExpiry) return false;
    const expiry = new Date(c?.documentExpiry);
    const now = new Date();
    const daysUntilExpiry = (expiry - now) / (1000 * 60 * 60 * 24);
    return daysUntilExpiry <= 30 && daysUntilExpiry > 0;
  })?.length || 0;

  const stats = [
    { label: 'Total Clients', value: total, icon: 'Users', color: 'text-blue-500', subtext: 'Under KYC management' },
    { label: 'Verified', value: verified, icon: 'CheckCircle', color: 'text-emerald-500', subtext: `${completionRate}% completion rate` },
    { label: 'Pending Review', value: pending, icon: 'Clock', color: 'text-amber-500', subtext: 'Awaiting verification' },
    { label: 'Expiry Alerts', value: expiryAlerts, icon: 'AlertTriangle', color: 'text-red-500', subtext: 'Documents expiring soon' },
  ];

  return (
    <div className="space-y-5">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats?.map((stat, i) => (
          <StatCard key={i} {...stat} />
        ))}
      </div>

      {/* Completion Breakdown */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">KYC Completion Breakdown</h3>
          <span className="text-xs text-muted-foreground">{total} total clients</span>
        </div>
        <div className="space-y-3">
          <CompletionBar label="Verified" percentage={total > 0 ? Math.round((verified / total) * 100) : 0} color="bg-emerald-500" />
          <CompletionBar label="Pending / Under Review" percentage={total > 0 ? Math.round((pending / total) * 100) : 0} color="bg-amber-500" />
          <CompletionBar label="Rejected" percentage={total > 0 ? Math.round((rejected / total) * 100) : 0} color="bg-red-500" />
          <CompletionBar label="Incomplete" percentage={total > 0 ? Math.round((incomplete / total) * 100) : 0} color="bg-slate-400" />
        </div>
      </div>

      {/* Expiry Alerts */}
      {expiryAlerts > 0 && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="AlertTriangle" size={16} color="#ef4444" />
            <h3 className="text-sm font-semibold text-red-500">Document Expiry Alerts</h3>
            <span className="ml-auto text-xs font-bold text-red-500 bg-red-500/10 px-2 py-0.5 rounded-full">{expiryAlerts}</span>
          </div>
          <p className="text-xs text-muted-foreground">{expiryAlerts} client document(s) expiring within 30 days. Send renewal reminders.</p>
          <button className="mt-3 flex items-center gap-1.5 text-xs font-medium text-red-500 hover:underline">
            <Icon name="Send" size={11} color="currentColor" />
            Send Bulk Reminders
          </button>
        </div>
      )}
    </div>
  );
};

export default ComplianceDashboard;

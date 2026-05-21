import React from 'react';
import Icon from '../../../components/AppIcon';

const statusConfig = {
  verified: { label: 'Verified', icon: 'CheckCircle', bg: 'bg-emerald-500/10', text: 'text-emerald-500', border: 'border-emerald-500/20' },
  pending: { label: 'Pending', icon: 'Clock', bg: 'bg-amber-500/10', text: 'text-amber-500', border: 'border-amber-500/20' },
  rejected: { label: 'Rejected', icon: 'XCircle', bg: 'bg-red-500/10', text: 'text-red-500', border: 'border-red-500/20' },
  incomplete: { label: 'Incomplete', icon: 'AlertCircle', bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/20' },
  under_review: { label: 'Under Review', icon: 'Eye', bg: 'bg-blue-500/10', text: 'text-blue-500', border: 'border-blue-500/20' },
};

const KYCStatusBadge = ({ status = 'incomplete', size = 'sm' }) => {
  const config = statusConfig?.[status] || statusConfig?.incomplete;
  const sizeClasses = size === 'lg' ? 'px-3 py-1.5 text-sm gap-2' : 'px-2 py-1 text-xs gap-1.5';
  const iconSize = size === 'lg' ? 16 : 12;

  return (
    <span className={`inline-flex items-center rounded-full border font-medium ${config?.bg} ${config?.text} ${config?.border} ${sizeClasses}`}>
      <Icon name={config?.icon} size={iconSize} color="currentColor" />
      {config?.label}
    </span>
  );
};

export default KYCStatusBadge;

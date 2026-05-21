import React from 'react';

const statusConfig = {
  pending: { label: 'Pending', bg: 'bg-yellow-100', text: 'text-yellow-800', dot: 'bg-yellow-500' },
  submitted: { label: 'Submitted', bg: 'bg-blue-100', text: 'text-blue-800', dot: 'bg-blue-500' },
  under_review: { label: 'Under Review', bg: 'bg-orange-100', text: 'text-orange-800', dot: 'bg-orange-500' },
  approved: { label: 'Approved', bg: 'bg-green-100', text: 'text-green-800', dot: 'bg-green-500' },
  rejected: { label: 'Rejected', bg: 'bg-red-100', text: 'text-red-800', dot: 'bg-red-500' },
};

const urgencyConfig = {
  critical: { label: 'Critical', bg: 'bg-red-500', text: 'text-white' },
  high: { label: 'High', bg: 'bg-orange-500', text: 'text-white' },
  medium: { label: 'Medium', bg: 'bg-yellow-500', text: 'text-white' },
  low: { label: 'Low', bg: 'bg-blue-500', text: 'text-white' },
};

export const RenewalStatusBadge = ({ status }) => {
  const config = statusConfig?.[status] || statusConfig?.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config?.bg} ${config?.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config?.dot}`} />
      {config?.label}
    </span>
  );
};

export const UrgencyBadge = ({ urgency }) => {
  const config = urgencyConfig?.[urgency] || urgencyConfig?.low;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${config?.bg} ${config?.text}`}>
      {config?.label}
    </span>
  );
};

export default RenewalStatusBadge;

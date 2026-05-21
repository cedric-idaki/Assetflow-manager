import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { RenewalStatusBadge, UrgencyBadge } from './RenewalStatusBadge';

const getUrgency = (daysLeft) => {
  if (daysLeft <= 7) return 'critical';
  if (daysLeft <= 30) return 'high';
  if (daysLeft <= 60) return 'medium';
  return 'low';
};

const getDaysLeft = (expiryDate) => {
  const today = new Date();
  const expiry = new Date(expiryDate);
  return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
};

const RenewalQueue = ({ renewals, selectedId, onSelect, searchQuery, onSearchChange, statusFilter, onStatusFilterChange }) => {
  const filtered = renewals?.filter(r => {
    const matchSearch = !searchQuery ||
      r?.clientName?.toLowerCase()?.includes(searchQuery?.toLowerCase()) ||
      r?.clientId?.toLowerCase()?.includes(searchQuery?.toLowerCase());
    const matchStatus = statusFilter === 'all' || r?.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Search & Filter */}
      <div className="p-4 border-b border-border space-y-3">
        <div className="relative">
          <Icon name="Search" size={15} color="var(--color-muted-foreground)" className="absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search clients..."
            value={searchQuery}
            onChange={e => onSearchChange?.(e?.target?.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => onStatusFilterChange?.(e?.target?.value)}
          className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="submitted">Submitted</option>
          <option value="under_review">Under Review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>
      {/* Queue List */}
      <div className="flex-1 overflow-y-auto">
        {filtered?.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Icon name="FileSearch" size={32} color="currentColor" />
            <p className="mt-2 text-sm">No renewal requests found</p>
          </div>
        ) : (
          filtered?.map(renewal => {
            const daysLeft = getDaysLeft(renewal?.expiryDate);
            const urgency = getUrgency(daysLeft);
            const isSelected = renewal?.id === selectedId;
            return (
              <button
                key={renewal?.id}
                onClick={() => onSelect?.(renewal?.id)}
                className={`w-full text-left p-4 border-b border-border transition-smooth hover:bg-muted/50 ${
                  isSelected ? 'bg-primary/5 border-l-2 border-l-primary' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{renewal?.clientName}</p>
                    <p className="text-xs text-muted-foreground">{renewal?.clientId}</p>
                  </div>
                  <UrgencyBadge urgency={urgency} />
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="FileText" size={13} color="var(--color-muted-foreground)" />
                  <span className="text-xs text-muted-foreground">{renewal?.documentType}</span>
                </div>
                <div className="flex items-center justify-between">
                  <RenewalStatusBadge status={renewal?.status} />
                  <span className={`text-xs font-medium ${
                    daysLeft <= 0 ? 'text-red-600' :
                    daysLeft <= 7 ? 'text-red-500' :
                    daysLeft <= 30 ? 'text-orange-500' : 'text-muted-foreground'
                  }`}>
                    {daysLeft <= 0 ? 'Expired' : `${daysLeft}d left`}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

export default RenewalQueue;

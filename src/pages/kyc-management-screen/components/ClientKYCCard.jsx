import React from 'react';
import Icon from '../../../components/AppIcon';
import KYCStatusBadge from './KYCStatusBadge';

const ClientKYCCard = ({ client, isSelected, onClick }) => {
  const docChecks = [
    { key: 'idDocument', label: 'ID' },
    { key: 'photo', label: 'Photo' },
    { key: 'kraPin', label: 'KRA PIN' },
  ];

  const completedDocs = docChecks?.filter(d => !!client?.[d?.key])?.length;
  const completionPct = Math.round((completedDocs / docChecks?.length) * 100);

  const isExpiringSoon = () => {
    if (!client?.documentExpiry) return false;
    const expiry = new Date(client?.documentExpiry);
    const now = new Date();
    return (expiry - now) / (1000 * 60 * 60 * 24) <= 30;
  };

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-xl border transition-all ${
        isSelected
          ? 'border-primary bg-primary/5 shadow-sm'
          : 'border-border bg-card hover:border-primary/30 hover:bg-muted/30'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0">
            <Icon name="User" size={14} color="white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{client?.name}</p>
            <p className="text-xs text-muted-foreground truncate">{client?.email}</p>
          </div>
        </div>
        <KYCStatusBadge status={client?.kycStatus || 'incomplete'} />
      </div>

      {/* Completion bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {docChecks?.map(doc => (
              <span
                key={doc?.key}
                className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  client?.[doc?.key] ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground'
                }`}
              >
                {doc?.label}
              </span>
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground">{completionPct}%</span>
        </div>
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              completionPct === 100 ? 'bg-emerald-500' : completionPct >= 50 ? 'bg-amber-500' : 'bg-red-400'
            }`}
            style={{ width: `${completionPct}%` }}
          />
        </div>
      </div>

      {isExpiringSoon() && (
        <div className="flex items-center gap-1 mt-2">
          <Icon name="AlertTriangle" size={10} color="#ef4444" />
          <span className="text-[10px] text-red-500 font-medium">Document expiring soon</span>
        </div>
      )}
    </button>
  );
};

export default ClientKYCCard;

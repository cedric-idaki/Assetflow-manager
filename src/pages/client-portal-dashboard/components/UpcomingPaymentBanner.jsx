import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const UpcomingPaymentBanner = ({ nextPayment, installmentPlans, onPayNow }) => {
  const [dismissed, setDismissed] = useState(false);

  if (!nextPayment || dismissed) return null;

  const formatCurrency = (val) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0 })?.format(val || 0);

  const formatDate = (d) =>
    d ? new Date(d)?.toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

  const daysUntil = Math.ceil((new Date(nextPayment?.scheduled_date) - new Date()) / (1000 * 60 * 60 * 24));
  const isOverdue = daysUntil < 0;
  const isUrgent = daysUntil <= 3 && daysUntil >= 0;
  const isSoon = daysUntil <= 7 && daysUntil > 3;

  const planInfo = installmentPlans?.find(p => p?.id === nextPayment?.plan_id);
  const assetName = planInfo?.asset?.description || nextPayment?.plan?.asset?.description || 'Asset';
  const assetCode = planInfo?.asset?.asset_code || nextPayment?.plan?.asset?.asset_code || '';

  const config = isOverdue
    ? { bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-300 dark:border-red-700', icon: 'text-red-600', btn: 'bg-red-600 hover:bg-red-700', label: `${Math.abs(daysUntil)} day${Math.abs(daysUntil) !== 1 ? 's' : ''} overdue`, pulse: true }
    : isUrgent
    ? { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-300 dark:border-amber-700', icon: 'text-amber-600', btn: 'bg-amber-600 hover:bg-amber-700', label: daysUntil === 0 ? 'Due today' : `Due in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`, pulse: true }
    : isSoon
    ? { bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-300 dark:border-blue-700', icon: 'text-blue-600', btn: 'bg-blue-600 hover:bg-blue-700', label: `Due in ${daysUntil} days`, pulse: false }
    : { bg: 'bg-card', border: 'border-border', icon: 'text-primary', btn: 'bg-primary hover:bg-primary/90', label: `Due in ${daysUntil} days`, pulse: false };

  return (
    <div className={`relative mb-5 rounded-xl border-2 ${config?.bg} ${config?.border} overflow-hidden`}>
      {config?.pulse && (
        <div className={`h-1 w-full animate-pulse ${
          isOverdue ? 'bg-red-500' : 'bg-amber-500'
        }`} />
      )}
      <div className="flex items-center gap-4 p-4">
        <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${
          isOverdue ? 'bg-red-100 dark:bg-red-900/30' : isUrgent ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-primary/10'
        } ${config?.pulse ? 'animate-pulse' : ''}`}>
          <Icon name={isOverdue ? 'AlertCircle' : 'Bell'} size={18} className={config?.icon} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              isOverdue ? 'bg-red-600 text-white' : isUrgent ? 'bg-amber-600 text-white' : 'bg-primary/10 text-primary'
            }`}>
              {config?.label}
            </span>
            <span className="text-sm font-bold text-foreground">
              {formatCurrency(nextPayment?.amount)} due
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatDate(nextPayment?.scheduled_date)}
            {assetName && ` · ${assetName}`}
            {assetCode && ` (${assetCode})`}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => onPayNow?.(nextPayment)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white rounded-lg transition-colors ${config?.btn}`}
          >
            <Icon name="CreditCard" size={13} />
            Pay Now
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <Icon name="X" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default UpcomingPaymentBanner;

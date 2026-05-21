import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';

const KYCRenewalAlertBanner = ({ expiringKycDocs }) => {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !expiringKycDocs?.length) return null;

  const mostUrgent = expiringKycDocs?.[0];
  const days = mostUrgent?.daysUntilExpiry;

  const urgency = days <= 0 ? 'red' : days <= 7 ? 'red' : days <= 14 ? 'orange' : 'amber';
  const label = days <= 0 ? 'EXPIRED' : days <= 7 ? 'CRITICAL' : days <= 14 ? 'URGENT' : 'ACTION REQUIRED';
  const pulse = days <= 14;

  const colorMap = {
    red: {
      bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-300 dark:border-red-700',
      icon: 'text-red-600 dark:text-red-400', badge: 'bg-red-600 text-white',
      countdown: 'text-red-700 dark:text-red-300', button: 'bg-red-600 hover:bg-red-700 text-white',
      docBg: 'bg-red-100 dark:bg-red-900/30', docText: 'text-red-800 dark:text-red-200',
      docBadge: 'bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200', bar: 'bg-red-500',
    },
    orange: {
      bg: 'bg-orange-50 dark:bg-orange-950/30', border: 'border-orange-300 dark:border-orange-700',
      icon: 'text-orange-600 dark:text-orange-400', badge: 'bg-orange-600 text-white',
      countdown: 'text-orange-700 dark:text-orange-300', button: 'bg-orange-600 hover:bg-orange-700 text-white',
      docBg: 'bg-orange-100 dark:bg-orange-900/30', docText: 'text-orange-800 dark:text-orange-200',
      docBadge: 'bg-orange-200 dark:bg-orange-800 text-orange-800 dark:text-orange-200', bar: 'bg-orange-500',
    },
    amber: {
      bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-300 dark:border-amber-700',
      icon: 'text-amber-600 dark:text-amber-400', badge: 'bg-amber-600 text-white',
      countdown: 'text-amber-700 dark:text-amber-300', button: 'bg-amber-600 hover:bg-amber-700 text-white',
      docBg: 'bg-amber-100 dark:bg-amber-900/30', docText: 'text-amber-800 dark:text-amber-200',
      docBadge: 'bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200', bar: 'bg-amber-500',
    },
  };

  const c = colorMap?.[urgency];

  const getDocumentIcon = (docType) => {
    const t = docType?.toLowerCase() || '';
    if (t?.includes('passport')) return 'BookOpen';
    if (t?.includes('kra') || t?.includes('pin')) return 'Hash';
    return 'CreditCard';
  };

  return (
    <div className={`relative mb-5 rounded-xl border-2 ${c?.bg} ${c?.border} overflow-hidden shadow-sm`}>
      <div className={`h-1 w-full ${pulse ? 'animate-pulse' : ''} ${c?.bar}`} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
              urgency === 'red' ? 'bg-red-100 dark:bg-red-900/50' :
              urgency === 'orange' ? 'bg-orange-100 dark:bg-orange-900/50' : 'bg-amber-100 dark:bg-amber-900/50'
            } ${pulse ? 'animate-pulse' : ''}`}>
              <Icon name="AlertTriangle" size={20} className={c?.icon} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${c?.badge}`}>{label}</span>
                <h3 className={`text-sm font-bold ${c?.countdown}`}>KYC Document Renewal Required</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                {expiringKycDocs?.length === 1 ? '1 document' : `${expiringKycDocs?.length} documents`}
                {' '}{days <= 0 ? 'have expired' : 'expire'} — most urgent in{' '}
                <span className={`font-bold text-sm ${c?.countdown}`}>
                  {days <= 0 ? 'already expired' : days === 1 ? '1 day' : `${days} days`}
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                {expiringKycDocs?.map(doc => (
                  <div key={doc?.id} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${c?.docBg}`}>
                    <Icon name={getDocumentIcon(doc?.document_type)} size={13} className={c?.icon} />
                    <span className={`text-xs font-medium ${c?.docText}`}>{doc?.document_type}</span>
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${c?.docBadge}`}>
                      {doc?.daysUntilExpiry <= 0 ? 'Expired' : `${doc?.daysUntilExpiry}d`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-start gap-2 flex-shrink-0">
            <button
              onClick={() => navigate('/kyc-renewal-management-screen')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${c?.button}`}
            >
              <Icon name="RefreshCw" size={13} />
              Renew Now
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              <Icon name="X" size={15} />
            </button>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-current/10 flex items-center justify-between">
          <p className={`text-xs ${c?.icon} flex items-center gap-1`}>
            <Icon name="Info" size={12} />
            Expired KYC documents may restrict your account access and transactions.
          </p>
          <button
            onClick={() => navigate('/kyc-renewal-management-screen')}
            className={`text-xs font-medium underline underline-offset-2 ${c?.countdown} hover:opacity-80 transition-opacity`}
          >
            View renewal details →
          </button>
        </div>
      </div>
    </div>
  );
};

export default KYCRenewalAlertBanner;

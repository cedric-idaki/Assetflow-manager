import React from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';

const KYCBlockedBanner = ({ kycStatus, clientName }) => {
  const navigate = useNavigate();

  if (!kycStatus || kycStatus === 'verified') return null;

  const isUnverified = kycStatus === 'unverified' || kycStatus === 'incomplete';
  const isUnderReview = kycStatus === 'under_review';
  const isRejected = kycStatus === 'rejected';

  const config = {
    unverified: {
      bg: 'bg-red-500/10',
      border: 'border-red-500/30',
      icon: 'ShieldOff',
      iconColor: '#ef4444',
      titleColor: 'text-red-600',
      textColor: 'text-red-500',
      title: 'Payment Blocked — KYC Not Verified',
      message: `${clientName ? `${clientName}'s` : 'This client\'s'} KYC verification is incomplete. Identity documents must be verified before payments can be processed.`,
      action: 'Complete KYC Verification',
    },
    incomplete: {
      bg: 'bg-red-500/10',
      border: 'border-red-500/30',
      icon: 'ShieldOff',
      iconColor: '#ef4444',
      titleColor: 'text-red-600',
      textColor: 'text-red-500',
      title: 'Payment Blocked — KYC Incomplete',
      message: `${clientName ? `${clientName}'s` : 'This client\'s'} KYC documents are incomplete. All required documents must be submitted and verified before payments can be processed.`,
      action: 'Complete KYC Verification',
    },
    under_review: {
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/30',
      icon: 'ShieldAlert',
      iconColor: '#f59e0b',
      titleColor: 'text-amber-600',
      textColor: 'text-amber-600',
      title: 'Payment Blocked — KYC Under Review',
      message: `${clientName ? `${clientName}'s` : 'This client\'s'} KYC verification is currently under review. Payments cannot be processed until the review is complete and the client is verified.`,
      action: 'View KYC Status',
    },
    rejected: {
      bg: 'bg-red-500/10',
      border: 'border-red-500/30',
      icon: 'ShieldX',
      iconColor: '#ef4444',
      titleColor: 'text-red-600',
      textColor: 'text-red-500',
      title: 'Payment Blocked — KYC Rejected',
      message: `${clientName ? `${clientName}'s` : 'This client\'s'} KYC verification was rejected. The client must resubmit their documents and complete the verification process before payments can be processed.`,
      action: 'Resubmit KYC Documents',
    },
  };

  const c = config?.[kycStatus] || config?.unverified;

  return (
    <div className={`rounded-xl border ${c?.bg} ${c?.border} p-4 space-y-3`}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <Icon name={c?.icon} size={20} color={c?.iconColor} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className={`text-sm font-semibold ${c?.titleColor}`}>{c?.title}</h4>
          <p className={`text-xs mt-1 ${c?.textColor} leading-relaxed`}>{c?.message}</p>
        </div>
      </div>

      {/* Divider */}
      <div className={`border-t ${c?.border}`} />

      {/* Action Row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Icon name="Lock" size={12} color={c?.iconColor} />
          <span className={`text-xs font-medium ${c?.textColor}`}>Payment submission is disabled</span>
        </div>
        <button
          type="button"
          onClick={() => navigate('/kyc-management-screen')}
          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border ${c?.border} ${c?.textColor} hover:opacity-80 transition-opacity whitespace-nowrap`}
        >
          <Icon name="ExternalLink" size={12} color="currentColor" />
          {c?.action}
        </button>
      </div>
    </div>
  );
};

export default KYCBlockedBanner;

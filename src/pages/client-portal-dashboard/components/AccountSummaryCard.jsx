import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const AccountSummaryCard = ({ clientInfo, totalPaid, totalOutstanding, assets }) => {
  const formatCurrency = (val) =>
    new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0 })?.format(val || 0);

  const kycStatusConfig = {
    verified: { label: 'KYC Verified', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', icon: 'ShieldCheck' },
    pending: { label: 'KYC Pending', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: 'Clock' },
    unverified: { label: 'KYC Unverified', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: 'ShieldAlert' },
    expired: { label: 'KYC Expired', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: 'ShieldOff' },
    rejected: { label: 'KYC Rejected', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: 'ShieldX' },
  };

  const kyc = kycStatusConfig?.[clientInfo?.kyc_status] || kycStatusConfig?.unverified;

  const stats = [
    {
      label: 'Total Paid',
      value: formatCurrency(totalPaid),
      icon: 'CheckCircle',
      iconBg: 'bg-emerald-100 dark:bg-emerald-900/30',
      iconColor: 'var(--color-success)',
      sub: `${assets?.length || 0} asset(s) in portfolio`,
    },
    {
      label: 'Outstanding Balance',
      value: formatCurrency(totalOutstanding),
      icon: 'Wallet',
      iconBg: 'bg-blue-100 dark:bg-blue-900/30',
      iconColor: 'var(--color-primary)',
      sub: 'Total remaining balance',
    },
  ];

  return (
    <div className="bg-gradient-to-br from-blue-700 to-blue-900 rounded-2xl p-6 text-white shadow-lg shadow-blue-500/20 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        {/* Client Identity */}
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
            <Icon name="UserCircle" size={28} color="white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">
              {clientInfo?.full_name || 'Client'}
            </h2>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {clientInfo?.account_number && (
                <span className="flex items-center gap-1 text-xs font-mono bg-white/20 px-2.5 py-1 rounded-full">
                  <Icon name="Hash" size={11} color="white" />
                  {clientInfo?.account_number}
                </span>
              )}
              <span className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${kyc?.cls}`}>
                <Icon name={kyc?.icon} size={11} />
                {kyc?.label}
              </span>
            </div>
            {clientInfo?.email && (
              <p className="text-xs text-white/70 mt-1.5">{clientInfo?.email}</p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="flex gap-4">
          {stats?.map((stat, i) => (
            <div key={i} className="bg-white/15 backdrop-blur-sm rounded-xl p-4 min-w-[130px]">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon name={stat?.icon} size={13} color="rgba(255,255,255,0.8)" />
                <span className="text-xs text-white/70">{stat?.label}</span>
              </div>
              <p className="text-2xl font-bold text-white">{stat?.value}</p>
              <p className="text-xs text-white/60 mt-0.5">{stat?.sub}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AccountSummaryCard;

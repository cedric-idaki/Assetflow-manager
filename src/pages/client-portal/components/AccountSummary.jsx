import React from 'react';
import Icon from '../../../components/AppIcon';

const AccountSummary = ({ clientProfile, payments, installmentPlans }) => {
  const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  const totalPaid = payments
    .filter(p => p.payment_status === 'completed')
    .reduce((s, p) => s + parseFloat(p.amount || 0), 0);

  const nextPayment = installmentPlans
    .filter(p => p.plan_status === 'active')
    .sort((a, b) => new Date(a.next_charge_date) - new Date(b.next_charge_date))[0];

  const kycColor = {
    verified: 'bg-emerald-100 text-emerald-700',
    under_review: 'bg-yellow-100 text-yellow-700',
    unverified: 'bg-red-100 text-red-700',
    pending: 'bg-orange-100 text-orange-700',
  };

  return (
    <div className="space-y-4">
      {/* Welcome Card */}
      <div
        className="rounded-2xl p-6 text-white relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #1E429F 0%, #1A56DB 60%, #1C3FAA 100%)' }}
      >
        <div className="absolute top-0 right-0 w-40 h-40 rounded-full opacity-10"
          style={{ background: '#fff', transform: 'translate(30%, -30%)' }}
        />
        <div className="absolute bottom-0 left-0 w-32 h-32 rounded-full opacity-10"
          style={{ background: '#fff', transform: 'translate(-30%, 30%)' }}
        />
        <div className="relative z-10">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-blue-200 text-sm">Welcome back</p>
              <h2 className="text-2xl font-bold text-white mt-0.5">
                {clientProfile?.full_name || 'Client'}
              </h2>
              <p className="text-blue-200 text-sm mt-0.5">
                Account: {clientProfile?.account_number || '—'}
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
              <Icon name="User" size={22} color="white" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <p className="text-blue-200 text-xs">Outstanding Balance</p>
              <p className="text-2xl font-bold text-white">
                {fmt(clientProfile?.outstanding_balance)}
              </p>
            </div>
            <div>
              <p className="text-blue-200 text-xs">Total Paid</p>
              <p className="text-2xl font-bold text-white">{fmt(totalPaid)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* KYC + Next Payment Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* KYC Status */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-foreground">KYC Status</p>
            <Icon name="Shield" size={16} color="var(--color-muted-foreground)" />
          </div>
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold capitalize ${
            kycColor[clientProfile?.kyc_status || 'unverified']
          }`}>
            <span className="w-2 h-2 rounded-full bg-current" />
            {(clientProfile?.kyc_status || 'unverified').replace(/_/g, ' ')}
          </span>
          {clientProfile?.kyc_status !== 'verified' && (
            <p className="text-xs text-muted-foreground mt-2">
              Complete your KYC to unlock all features
            </p>
          )}
        </div>

        {/* Next Payment */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-foreground">Next Payment</p>
            <Icon name="Calendar" size={16} color="var(--color-muted-foreground)" />
          </div>
          {nextPayment ? (
            <>
              <p className="text-2xl font-bold text-foreground">
                {fmt(nextPayment.installment_amount)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Due: {nextPayment.next_charge_date
                  ? new Date(nextPayment.next_charge_date).toLocaleDateString()
                  : '—'}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No upcoming payments</p>
          )}
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: 'My Assets',
            value: clientProfile?.total_assets || 0,
            icon: 'Package',
            bg: 'bg-blue-100',
            color: '#1A56DB',
          },
          {
            label: 'Payments Made',
            value: payments.filter(p => p.payment_status === 'completed').length,
            icon: 'CheckCircle',
            bg: 'bg-emerald-100',
            color: '#059669',
          },
          {
            label: 'Active Plans',
            value: installmentPlans.filter(p => p.plan_status === 'active').length,
            icon: 'CreditCard',
            bg: 'bg-purple-100',
            color: '#7c3aed',
          },
        ].map((item, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-3 text-center">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center mx-auto mb-2 ${item.bg}`}>
              <Icon name={item.icon} size={16} color={item.color} />
            </div>
            <p className="text-2xl font-bold text-foreground">{item.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{item.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AccountSummary;
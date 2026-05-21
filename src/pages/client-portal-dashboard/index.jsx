import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MainLayout from '../../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';
import { useClientPortalContext } from '../../contexts/ClientPortalContext';
import Icon from '../../components/AppIcon';
import AccountSummaryCard from './components/AccountSummaryCard';
import AssetList from './components/AssetList';
import PaymentHistory from './components/PaymentHistory';
import InstallmentSchedule from './components/InstallmentSchedule';
import Statements from './components/Statements';
import KYCRenewalAlertBanner from './components/KYCRenewalAlertBanner';
import UpcomingPaymentBanner from './components/UpcomingPaymentBanner';

const TABS = [
  { id: 'assets', label: 'My Assets', icon: 'Package' },
  { id: 'schedule', label: 'Installment Schedule', icon: 'Calendar' },
  { id: 'history', label: 'Payment History', icon: 'Receipt' },
  { id: 'statements', label: 'Statements', icon: 'FileText' },
];

const SkeletonCard = () => (
  <div className="bg-card border border-border rounded-xl p-5 animate-pulse">
    <div className="h-3 bg-muted rounded w-1/3 mb-3" />
    <div className="h-7 bg-muted rounded w-2/3 mb-2" />
    <div className="h-3 bg-muted rounded w-1/2" />
  </div>
);

const LoadingSkeleton = () => (
  <div className="space-y-6">
    {/* Account card skeleton */}
    <div className="bg-gradient-to-br from-blue-200 to-blue-300 dark:from-blue-900/40 dark:to-blue-800/40 rounded-2xl p-6 animate-pulse">
      <div className="flex gap-4">
        <div className="w-14 h-14 rounded-2xl bg-white/30" />
        <div className="flex-1">
          <div className="h-5 bg-white/30 rounded w-1/3 mb-2" />
          <div className="h-3 bg-white/20 rounded w-1/4" />
        </div>
      </div>
    </div>
    {/* Stats skeletons */}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {[...Array(4)]?.map((_, i) => <SkeletonCard key={i} />)}
    </div>
    {/* Content skeleton */}
    <div className="bg-card border border-border rounded-xl p-5 animate-pulse">
      <div className="flex gap-4 mb-5">
        {[...Array(4)]?.map((_, i) => <div key={i} className="h-10 bg-muted rounded-lg w-28" />)}
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[...Array(3)]?.map((_, i) => (
          <div key={i} className="bg-muted rounded-xl h-48" />
        ))}
      </div>
    </div>
  </div>
);

const ClientPortalDashboard = () => {
  const navigate = useNavigate();
  const { user, userProfile } = useAuth();
  const [activeTab, setActiveTab] = useState('assets');
  const [selectedAsset, setSelectedAsset] = useState(null);

  const {
    clientInfo,
    assets,
    payments,
    installmentPlans,
    installmentCharges,
    expiringKycDocs,
    loading,
    syncing,
    error,
    isConnected,
    totalPaid,
    totalOutstanding,
    nextPayment,
    overdueCharges,
    refetch,
  } = useClientPortalContext();

  const handleViewSchedule = (asset) => {
    setSelectedAsset(asset);
    setActiveTab('schedule');
  };

  const handleViewStatement = (asset) => {
    setSelectedAsset(asset);
    setActiveTab('statements');
  };

  const handlePayNow = () => {
    navigate('/payment-collections-hub');
  };

  // Filter data by selected asset
  const filteredPayments = selectedAsset
    ? payments?.filter(p => p?.asset_id === selectedAsset?.id)
    : payments;

  const filteredCharges = selectedAsset
    ? installmentCharges?.filter(c => {
        const plan = installmentPlans?.find(p => p?.asset_id === selectedAsset?.id);
        return plan ? c?.plan_id === plan?.id : false;
      })
    : installmentCharges;

  const filteredAssets = selectedAsset
    ? assets?.filter(a => a?.id === selectedAsset?.id)
    : assets;

  // Pending installment count for badge
  const pendingCount = installmentCharges?.filter(c =>
    c?.charge_status === 'scheduled' && new Date(c?.scheduled_date) >= new Date()
  )?.length || 0;

  return (
    <MainLayout>
      <div className="max-w-7xl mx-auto">
        {/* Page Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Client Portal
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Welcome back, {clientInfo?.full_name || userProfile?.full_name || user?.email?.split('@')?.[0] || 'Client'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {syncing && (
              <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2.5 py-1.5 rounded-full">
                <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Syncing
              </span>
            )}
            {/* Connection status */}
            <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full ${
              isConnected
                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400' :'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
              }`} />
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
            <button
              onClick={refetch}
              className="p-2 rounded-lg bg-muted text-muted-foreground hover:text-foreground hover:bg-border transition-colors"
              title="Refresh data"
            >
              <Icon name="RefreshCw" size={15} />
            </button>
          </div>
        </div>

        {/* Loading State */}
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
              <Icon name="AlertCircle" size={24} color="var(--color-error)" />
            </div>
            <p className="text-sm font-semibold text-foreground mb-1">Failed to load portal data</p>
            <p className="text-xs text-muted-foreground mb-4">{error}</p>
            <button
              onClick={refetch}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Icon name="RefreshCw" size={14} />
              Try Again
            </button>
          </div>
        ) : !clientInfo ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
              <Icon name="UserX" size={24} color="var(--color-warning)" />
            </div>
            <p className="text-sm font-semibold text-foreground mb-1">No client account found</p>
            <p className="text-xs text-muted-foreground">
              No client record is linked to <strong>{user?.email}</strong>.
              Please contact your account manager.
            </p>
          </div>
        ) : (
          <>
            {/* KYC Renewal Alert */}
            <KYCRenewalAlertBanner expiringKycDocs={expiringKycDocs} />

            {/* Upcoming Payment Banner */}
            <UpcomingPaymentBanner
              nextPayment={nextPayment}
              installmentPlans={installmentPlans}
              onPayNow={handlePayNow}
            />

            {/* Account Summary Card */}
            <AccountSummaryCard
              clientInfo={clientInfo}
              totalPaid={totalPaid}
              totalOutstanding={totalOutstanding}
              assets={assets}
            />

            {/* Overdue alert */}
            {overdueCharges?.length > 0 && (
              <div className="flex items-center gap-3 mb-5 p-3.5 bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-700 rounded-xl">
                <Icon name="AlertTriangle" size={18} color="var(--color-error)" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                    {overdueCharges?.length} overdue installment{overdueCharges?.length !== 1 ? 's' : ''}
                  </p>
                  <p className="text-xs text-red-600 dark:text-red-500">
                    Total overdue: {new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0 })?.format(
                      overdueCharges?.reduce((s, c) => s + Number(c?.amount || 0), 0)
                    )}
                  </p>
                </div>
                <button
                  onClick={handlePayNow}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                >
                  <Icon name="CreditCard" size={13} />
                  Pay Now
                </button>
              </div>
            )}

            {/* Asset Filter Banner */}
            {selectedAsset && (
              <div className="flex items-center gap-3 mb-4 p-3 bg-primary/5 border border-primary/20 rounded-xl">
                <Icon name="Filter" size={15} color="var(--color-primary)" />
                <span className="text-sm text-foreground">
                  Filtered by: <strong>{selectedAsset?.description}</strong> ({selectedAsset?.asset_code})
                </span>
                <button
                  onClick={() => setSelectedAsset(null)}
                  className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <Icon name="X" size={13} />
                  Clear filter
                </button>
              </div>
            )}

            {/* Tabs */}
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
              {/* Tab Navigation */}
              <div className="flex overflow-x-auto border-b border-border">
                {TABS?.map(tab => (
                  <button
                    key={tab?.id}
                    onClick={() => setActiveTab(tab?.id)}
                    className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                      activeTab === tab?.id
                        ? 'border-primary text-primary bg-primary/5' :'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                  >
                    <Icon name={tab?.icon} size={15} color={activeTab === tab?.id ? 'var(--color-primary)' : 'currentColor'} />
                    {tab?.label}
                    {tab?.id === 'schedule' && pendingCount > 0 && (
                      <span className="flex items-center justify-center w-5 h-5 text-xs font-bold rounded-full bg-amber-500 text-white">
                        {pendingCount > 9 ? '9+' : pendingCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div className="p-5">
                {activeTab === 'assets' && (
                  <AssetList
                    assets={assets}
                    installmentPlans={installmentPlans}
                    payments={payments}
                    onViewSchedule={handleViewSchedule}
                    onViewStatement={handleViewStatement}
                  />
                )}
                {activeTab === 'schedule' && (
                  <InstallmentSchedule
                    installmentCharges={filteredCharges}
                    installmentPlans={installmentPlans}
                    assets={assets}
                    clientInfo={clientInfo}
                  />
                )}
                {activeTab === 'history' && (
                  <PaymentHistory payments={filteredPayments} />
                )}
                {activeTab === 'statements' && (
                  <Statements
                    assets={filteredAssets}
                    payments={payments}
                    clientInfo={clientInfo}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </MainLayout>
  );
};

export default ClientPortalDashboard;

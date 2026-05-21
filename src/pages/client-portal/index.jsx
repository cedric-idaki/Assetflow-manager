import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import MainLayout from '../../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';
import useClientPortal from '../../hooks/useClientPortal';
import Icon from '../../components/AppIcon';

import AccountSummary from './components/AccountSummary';
import MyAssetsTab from './components/MyAssetsTab';
import BrowseAssetsTab from './components/BrowseAssetsTab';
import PaymentsTab from './components/PaymentsTab';
import KYCTab from './components/KYCTab';
import DocumentCentreTab from './components/DocumentCentreTab';
import InstallmentScheduleTab from './components/InstallmentScheduleTab';
import SettlementQuoteTab from './components/SettlementQuoteTab';
import StatementDownloadTab from './components/StatementDownloadTab';
import ItemEnquiryTab from './components/ItemEnquiryTab';

const Sk = ({ className }) => (
  <div className={'animate-pulse bg-muted rounded-lg ' + (className || '')} />
);

const ClientPortal = () => {
  const location = useLocation();
  const { userProfile } = useAuth();
  const {
    clientProfile,
    myAssets,
    browseAssets,
    payments,
    installmentPlans,
    enquiries,
    loading,
    connectionStatus,
    refetch,
    sendEnquiry,
    initiateMpesaPayment,
    exportPayments,
  } = useClientPortal();

  // Read active tab from URL ?tab=xxx
  const params   = new URLSearchParams(location.search);
  const activeTab = params.get('tab') || 'overview';

  return (
    <MainLayout>
      <div className="space-y-5 p-1">
        {/* KYC warning */}
        {!loading && clientProfile && clientProfile.kyc_status !== 'verified' && (
          <div className="flex items-center justify-between p-4 rounded-xl bg-yellow-50 border border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800">
            <div className="flex items-center gap-3">
              <Icon name="AlertTriangle" size={18} color="#ca8a04" />
              <div>
                <p className="text-sm font-semibold text-foreground">KYC verification required</p>
                <p className="text-xs text-muted-foreground">Upload your documents in the KYC tab to complete verification</p>
              </div>
            </div>
            <a href="/client-portal?tab=kyc"
              className="px-3 py-1.5 rounded-lg bg-yellow-500 text-white text-xs font-semibold hover:bg-yellow-600 transition-all flex-shrink-0">
              Upload Now
            </a>
          </div>
        )}

        {/* Tab content */}
        {loading ? (
          <div className="space-y-4">
            <Sk className="h-48" />
            <div className="grid grid-cols-2 gap-4">
              <Sk className="h-24" /><Sk className="h-24" />
            </div>
          </div>
        ) : (
          <div>
            {activeTab === 'overview' && (
              <AccountSummary clientProfile={clientProfile} payments={payments} installmentPlans={installmentPlans} />
            )}
            {activeTab === 'myassets' && <MyAssetsTab assets={myAssets} />}
            {activeTab === 'browse' && (
              <BrowseAssetsTab assets={browseAssets} enquiries={enquiries} onEnquire={sendEnquiry} />
            )}
            {activeTab === 'payments' && (
              <PaymentsTab payments={payments} installmentPlans={installmentPlans}
                clientProfile={clientProfile} onPay={initiateMpesaPayment} onExport={exportPayments} />
            )}
            {activeTab === 'kyc' && <KYCTab clientProfile={clientProfile} />}
            {activeTab === 'documents' && <DocumentCentreTab clientProfile={clientProfile} />}
            {activeTab === 'schedule' && <InstallmentScheduleTab installmentPlans={installmentPlans} />}
            {activeTab === 'settlement' && (
              <SettlementQuoteTab installmentPlans={installmentPlans} clientProfile={clientProfile} />
            )}
            {activeTab === 'statement' && (
              <StatementDownloadTab payments={payments} installmentPlans={installmentPlans}
                clientProfile={clientProfile} companyProfile={null} />
            )}
            {activeTab === 'enquiry' && (
              <ItemEnquiryTab clientProfile={clientProfile} enquiries={enquiries} onRefetch={refetch} />
            )}
          </div>
        )}
      </div>
    </MainLayout>
  );
};

export default ClientPortal;

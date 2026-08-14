import React, { useState } from 'react';
import Icon from '../../components/AppIcon';
import UserManagementTab from './components/UserManagementTab';
import RolesPermissionsTab from './components/RolesPermissionsTab';
import MakerCheckerTab from './components/MakerCheckerTab';
import AuditTrailTab from './components/AuditTrailTab';
import UserDevicesTab from './components/UserDevicesTab';
import MainLayout from '../../layouts/MainLayout';
import ClosePageButton from '../../components/ui/ClosePageButton';
import { useAuth } from '../../contexts/AuthContext';

const SystemAdministration = () => {
  const { userProfile } = useAuth();
  const role = userProfile?.role || '';
  const isSuperAdmin = role === 'super_admin';

  const [activeTab, setActiveTab] = useState('users');
  const [makerCheckerCount, setMakerCheckerCount] = useState(null);

  // Super admin sees everything; admin only sees Users, Maker-Checker, and Audit Trail
  const allTabs = [
    { id: 'users',        label: 'User Management',    icon: 'Users',          count: null,               superOnly: false },
    { id: 'roles',        label: 'Roles & Permissions', icon: 'Shield',         count: null,               superOnly: true  },
    { id: 'maker-checker',label: 'Approval Queue',      icon: 'GitPullRequest', count: makerCheckerCount,  superOnly: false },
    { id: 'devices',      label: 'Devices',             icon: 'MonitorSmartphone', count: null,            superOnly: false },
    { id: 'audit',        label: 'Audit Trail',         icon: 'FileText',       count: null,               superOnly: false },
  ];

  const tabs = allTabs.filter(t => !t.superOnly || isSuperAdmin);

  // If current activeTab was hidden (e.g. roles for admin), reset to users
  const visibleIds = tabs.map(t => t.id);
  const safeTab = visibleIds.includes(activeTab) ? activeTab : 'users';

  const renderTabContent = () => {
    switch (safeTab) {
      case 'users':         return <UserManagementTab />;
      case 'roles':         return isSuperAdmin ? <RolesPermissionsTab /> : null;
      case 'maker-checker': return <MakerCheckerTab onBadgeCountChange={setMakerCheckerCount} />;
      case 'devices':       return <UserDevicesTab />;
      case 'audit':         return <AuditTrailTab />;
      default:              return <UserManagementTab />;
    }
  };

  return (
    <MainLayout>
      <div className="min-h-screen bg-background">
        <div className="space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                {isSuperAdmin ? 'System Administration' : 'Staff & System'}
              </h1>
              <p className="text-sm md:text-base text-muted-foreground mt-2">
                {isSuperAdmin
                  ? 'Manage users, roles, approvals, and monitor system activity'
                  : 'Manage your staff, approval queue, and monitor activity'}
              </p>
            </div>
            <ClosePageButton label="Close" />
          </div>

          <div className="bg-card rounded-lg border border-border overflow-hidden">
            <div className="border-b border-border overflow-x-auto scrollbar-custom">
              <div className="flex min-w-max lg:min-w-0">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 md:px-6 py-4 text-sm font-medium transition-smooth whitespace-nowrap ${
                      safeTab === tab.id
                        ? 'text-primary border-b-2 border-primary bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)]'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                  >
                    <Icon
                      name={tab.icon}
                      size={18}
                      color={safeTab === tab.id ? 'var(--color-primary)' : 'currentColor'}
                    />
                    <span>{tab.label}</span>
                    {tab.count !== null && tab.count !== undefined && (
                      <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-semibold ${
                        tab.id === 'maker-checker' && tab.count > 0
                          ? 'bg-red-500 text-white'
                          : safeTab === tab.id
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {tab.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-5 ">
              {renderTabContent()}
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
};

export default SystemAdministration;

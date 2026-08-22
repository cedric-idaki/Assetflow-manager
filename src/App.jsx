import React from 'react';
import Routes from './Routes';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './components/Toast';
import { AdminDashboardProvider } from './contexts/AdminDashboardContext';
import { SalesAgentProvider } from './contexts/SalesAgentContext';
import { FinanceHubProvider } from './contexts/FinanceHubContext';
import { ClientPortalProvider } from './contexts/ClientPortalContext';
import { RealtimeDashboardProvider } from './contexts/RealtimeDashboardContext';
import { AccountantDashboardProvider } from './contexts/AccountantDashboardContext';
import { DirectorDashboardProvider } from './contexts/DirectorDashboardContext';
import { CollectionsDashboardProvider } from './contexts/CollectionsDashboardContext';
import { StaffDashboardProvider } from './contexts/StaffDashboardContext';
import { SaccoDashboardProvider } from './contexts/SaccoDashboardContext';
import { SaccoMemberProvider } from './contexts/SaccoMemberContext';
import { TenantModulesProvider } from './contexts/TenantModulesContext';

function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        {/*
          All data providers live here — above the router — so they mount once
          and never unmount on navigation. This keeps fetched data, open modals,
          and realtime subscriptions alive when the user switches pages or tabs.

          TenantModulesProvider sits outermost of them: the sidebar, ModuleGuard
          and the Modules tab all ask it which modules this tenant switched on,
          so it has to be resolved before anything renders navigation.
        */}
        <TenantModulesProvider>
        <AdminDashboardProvider>
          <SalesAgentProvider>
            <FinanceHubProvider>
              <ClientPortalProvider>
                <RealtimeDashboardProvider>
                  <AccountantDashboardProvider>
                    <DirectorDashboardProvider>
                      <CollectionsDashboardProvider>
                        <StaffDashboardProvider>
                          <SaccoDashboardProvider>
                            <SaccoMemberProvider>
                              <Routes />
                            </SaccoMemberProvider>
                          </SaccoDashboardProvider>
                        </StaffDashboardProvider>
                      </CollectionsDashboardProvider>
                    </DirectorDashboardProvider>
                  </AccountantDashboardProvider>
                </RealtimeDashboardProvider>
              </ClientPortalProvider>
            </FinanceHubProvider>
          </SalesAgentProvider>
        </AdminDashboardProvider>
        </TenantModulesProvider>
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;

import React from "react";
import { BrowserRouter, Routes as RouterRoutes, Route } from "react-router-dom";
import ScrollToTop from "components/ScrollToTop";
import ErrorBoundary from "components/ErrorBoundary";
import ProtectedRoute from "components/ProtectedRoute";
import RoleGuard from "components/RoleGuard";
import NotFound from "pages/NotFound";
import LoginPage from "./pages/login";
import LandingPage from "./pages/landing";
import SystemAdministration from './pages/system-administration';
import ReportsAnalyticsCenter from './pages/reports-analytics-center';
import AssetClientManagement from './pages/asset-client-management';
import SalesAgentPortal from './pages/sales-agent-portal';
import RoleBasedDashboard from './pages/role-based-dashboard';
import PaymentCollectionsHub from './pages/payment-collections-hub';
import ClientPortalDashboard from './pages/client-portal-dashboard';
import PaymentConfirmationScreen from './pages/payment-confirmation-screen';
import UserRegistrationScreen from './pages/user-registration-screen';
import KYCManagementScreen from './pages/kyc-management-screen';
import KYCRenewalManagementScreen from './pages/kyc-renewal-management-screen';
import SuperAdminDashboard from './pages/super-admin-dashboard';
import AdminRegistration from './pages/admin-registration';
import AdminDashboard from './pages/admin-dashboard';
import FinanceHub from './pages/finance-hub';
import HRPage from './pages/hr-management';
import POSModule from './pages/pos-module';
import ESignaturePage from './pages/e-signature';
import ResetPassword from './pages/reset-password';
import ClientPortal from './pages/client-portal';
import SubscriptionBilling from './pages/subscription-billing';

const ADMIN_ROLES   = ['super_admin', 'admin', 'director', 'accountant', 'collections_officer', 'manager', 'finance', 'operations'];
const FINANCE_ROLES = ['super_admin', 'admin', 'accountant', 'finance', 'director', 'manager'];
const STAFF_ROLES   = ['super_admin', 'admin', 'director', 'accountant', 'collections_officer', 'manager', 'finance', 'operations'];
const ALL_INTERNAL  = ['super_admin', 'admin', 'director', 'accountant', 'collections_officer', 'manager', 'finance', 'operations', 'sales_agent', 'sales'];

const Routes = () => {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <ScrollToTop />
        <RouterRoutes>

          {/* ── Public routes ──────────────────────────────────────────── */}
          <Route path="/"                         element={<LandingPage />} />
          <Route path="/login"                    element={<LoginPage />} />
          <Route path="/reset-password"           element={<ResetPassword />} />
          <Route path="/user-registration-screen" element={<UserRegistrationScreen />} />
          <Route path="/admin-registration"       element={<AdminRegistration />} />

          {/* ── Super Admin only ───────────────────────────────────────── */}
          <Route path="/super-admin-dashboard" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['super_admin']}>
                <SuperAdminDashboard />
              </RoleGuard>
            </ProtectedRoute>
          } />

          <Route path="/subscription-billing" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['super_admin']}>
                <SubscriptionBilling />
              </RoleGuard>
            </ProtectedRoute>
          } />

          {/* ── Admin only ─────────────────────────────────────────────── */}
          <Route path="/admin-dashboard" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['admin']}>
                <AdminDashboard />
              </RoleGuard>
            </ProtectedRoute>
          } />

          {/* ── Staff role-based dashboard ─────────────────────────────── */}
          <Route path="/role-based-dashboard" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={ADMIN_ROLES}>
                <RoleBasedDashboard />
              </RoleGuard>
            </ProtectedRoute>
          } />

          {/* ── Sales agent only ───────────────────────────────────────── */}
          <Route path="/sales-agent-portal" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['sales_agent', 'sales']}>
                <SalesAgentPortal />
              </RoleGuard>
            </ProtectedRoute>
          } />

          {/* ── Client only ────────────────────────────────────────────── */}
          <Route path="/client-portal" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['client']}>
                <ClientPortal />
              </RoleGuard>
            </ProtectedRoute>
          } />
          <Route path="/client-portal-dashboard" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['client']}>
                <ClientPortalDashboard />
              </RoleGuard>
            </ProtectedRoute>
          } />

          {/* ── Admin + staff operational pages ───────────────────────── */}
          <Route path="/asset-client-management" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={STAFF_ROLES}>
                <AssetClientManagement />
              </RoleGuard>
            </ProtectedRoute>
          } />
          <Route path="/payment-collections-hub" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={STAFF_ROLES}>
                <PaymentCollectionsHub />
              </RoleGuard>
            </ProtectedRoute>
          } />
          <Route path="/payment-confirmation-screen" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={STAFF_ROLES}>
                <PaymentConfirmationScreen />
              </RoleGuard>
            </ProtectedRoute>
          } />
          <Route path="/kyc-management-screen" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={STAFF_ROLES}>
                <KYCManagementScreen />
              </RoleGuard>
            </ProtectedRoute>
          } />
          <Route path="/kyc-renewal-management-screen" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={STAFF_ROLES}>
                <KYCRenewalManagementScreen />
              </RoleGuard>
            </ProtectedRoute>
          } />

          {/* ── Reports ────────────────────────────────────────────────── */}
          <Route path="/reports-analytics-center" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={[...ADMIN_ROLES, 'super_admin']}>
                <ReportsAnalyticsCenter />
              </RoleGuard>
            </ProtectedRoute>
          } />

          {/* ── System administration ──────────────────────────────────── */}
          <Route path="/system-administration" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['super_admin', 'admin']}>
                <SystemAdministration />
              </RoleGuard>
            </ProtectedRoute>
          } />

          {/* ── POS Module ─────────────────────────────────────────────── */}
          <Route path="/pos" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['super_admin', 'admin', 'manager', 'sales_agent', 'sales', 'director', 'operations']}>
                <POSModule />
              </RoleGuard>
            </ProtectedRoute>
          } />

          {/* ── E-Signature ────────────────────────────────────────────── */}
          <Route path="/e-signature" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={ALL_INTERNAL}>
                <ESignaturePage />
              </RoleGuard>
            </ProtectedRoute>
          } />

          {/* ── Finance Hub ────────────────────────────────────────────── */}
          <Route path="/finance-hub" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={FINANCE_ROLES}>
                <FinanceHub />
              </RoleGuard>
            </ProtectedRoute>
          } />

          {/* ── HR Management — HR role + CEO (admin) only ─────────────── */}
          <Route path="/hr-management" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['hr', 'admin']}>
                <HRPage />
              </RoleGuard>
            </ProtectedRoute>
          } />

          <Route path="*" element={<NotFound />} />
        </RouterRoutes>
      </ErrorBoundary>
    </BrowserRouter>
  );
};

export default Routes;

import React from "react";
import { BrowserRouter, Routes as RouterRoutes, Route, Navigate } from "react-router-dom";
import { isAndroidAppContext } from "utils/androidApp";
import ScrollToTop from "components/ScrollToTop";
import ErrorBoundary from "components/ErrorBoundary";
import ProtectedRoute from "components/ProtectedRoute";
import RoleGuard from "components/RoleGuard";
// Module entitlements. RoleGuard answers "is this person allowed here";
// ModuleGuard answers "did this organisation switch this module on". See
// src/config/modules.js for the catalogue and which routes each module owns.
import ModuleGuard from "components/ModuleGuard";
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
import ExternalSignPage from './pages/external-sign';
import ResetPassword from './pages/reset-password';
import ClientPortal from './pages/client-portal';
import SubscriptionBilling from './pages/subscription-billing';
import ProfilePage from './pages/profile';
import SaccoDashboard from './pages/sacco-dashboard';
import SaccoMemberPortal from './pages/sacco-member-portal';
import SaccoOversight from './pages/sacco-oversight';
import ChoosePortal from './pages/choose-portal';
import PublicListing from './pages/public-listing';

const ADMIN_ROLES   = ['super_admin', 'admin', 'director', 'accountant', 'collections_officer', 'manager', 'finance', 'operations'];
// sacco_admin runs the same back-office tooling as a company admin (finance,
// e-sign, HR, staff & system) — its data stays tenant-isolated via admin_id.
const FINANCE_ROLES = ['super_admin', 'admin', 'accountant', 'finance', 'director', 'manager', 'sacco_admin'];
const STAFF_ROLES   = ['super_admin', 'admin', 'director', 'accountant', 'collections_officer', 'manager', 'finance', 'operations'];
// KYC Renewals is removed from the admin portal — only the super admin (and other
// internal staff roles) may access the renewal management screen.
const KYC_RENEWAL_ROLES = STAFF_ROLES.filter((r) => r !== 'admin');
const ALL_INTERNAL  = ['super_admin', 'admin', 'director', 'accountant', 'collections_officer', 'manager', 'finance', 'operations', 'sales_agent', 'sales', 'sacco_admin'];

/**
 * Routes the Play Store app must not show, because they sell a subscription.
 *
 * The Android build is a Trusted Web Activity — the same site, not a separate
 * bundle — so this is the only thing standing between a Play reviewer and a
 * pricing page that charges M-Pesa for a digital service, which is what Google
 * Play Billing policy covers. Signup and payment stay on the web; the app signs
 * existing customers in. See utils/androidApp.js.
 */
const WebOnly = ({ children }) =>
  isAndroidAppContext() ? <Navigate to="/login" replace /> : children;

const Routes = () => {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <ScrollToTop />
        <RouterRoutes>

          {/* ── Public routes ──────────────────────────────────────────── */}
          {/* The landing page leads with plans and pricing, so the app opens on
              sign-in instead. /user-registration-screen stays: it takes no payment. */}
          <Route path="/"                         element={<WebOnly><LandingPage /></WebOnly>} />
          <Route path="/login"                    element={<LoginPage />} />
          <Route path="/reset-password"           element={<ResetPassword />} />
          <Route path="/user-registration-screen" element={<UserRegistrationScreen />} />
          <Route path="/admin-registration"       element={<WebOnly><AdminRegistration /></WebOnly>} />
          {/* External signer one-time link (no auth — token-scoped via edge function) */}
          <Route path="/sign/:token"              element={<ExternalSignPage />} />
          {/* Shareable listing a sales agent sends a buyer. No auth: the token is
              the credential, and listing-public decides what is safe to show. */}
          <Route path="/listing/:token"           element={<PublicListing />} />
          {/* Embedded signing — same token flow, chrome-less, for iframes inside
              client apps; emits ararat-esign postMessage lifecycle events */}
          <Route path="/embed/sign/:token"        element={<ExternalSignPage embedded />} />

          {/* ── Super Admin only ───────────────────────────────────────── */}
          {/* Post-login portal chooser — Company portal vs Saccos portal */}
          <Route path="/choose-portal" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['super_admin']}>
                <ChoosePortal />
              </RoleGuard>
            </ProtectedRoute>
          } />

          {/* Global sacco oversight — registrations + activity across all saccos */}
          <Route path="/sacco-oversight" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['super_admin']}>
                <SaccoOversight />
              </RoleGuard>
            </ProtectedRoute>
          } />

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

          {/* ── Sacco admin only ───────────────────────────────────────── */}
          <Route path="/sacco-dashboard" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['sacco_admin', 'super_admin']}>
                <SaccoDashboard />
              </RoleGuard>
            </ProtectedRoute>
          } />

          {/* ── Sacco member self-service portal (BRS v3.0 Section 5) ──── */}
          <Route path="/sacco-member-portal" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['sacco_member']}>
                <SaccoMemberPortal />
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
          {/* Serves two modules — it still opens if only one of them is on. */}
          <Route path="/asset-client-management" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={STAFF_ROLES}>
                <ModuleGuard anyOf={['assets', 'clients']}>
                  <AssetClientManagement />
                </ModuleGuard>
              </RoleGuard>
            </ProtectedRoute>
          } />
          <Route path="/payment-collections-hub" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={STAFF_ROLES}>
                <ModuleGuard module="payments">
                  <PaymentCollectionsHub />
                </ModuleGuard>
              </RoleGuard>
            </ProtectedRoute>
          } />
          <Route path="/payment-confirmation-screen" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={STAFF_ROLES}>
                <ModuleGuard module="payments">
                  <PaymentConfirmationScreen />
                </ModuleGuard>
              </RoleGuard>
            </ProtectedRoute>
          } />
          <Route path="/kyc-management-screen" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={STAFF_ROLES}>
                <ModuleGuard module="kyc">
                  <KYCManagementScreen />
                </ModuleGuard>
              </RoleGuard>
            </ProtectedRoute>
          } />
          <Route path="/kyc-renewal-management-screen" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={KYC_RENEWAL_ROLES}>
                <ModuleGuard module="kyc">
                  <KYCRenewalManagementScreen />
                </ModuleGuard>
              </RoleGuard>
            </ProtectedRoute>
          } />

          {/* ── Reports ────────────────────────────────────────────────── */}
          <Route path="/reports-analytics-center" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={[...ADMIN_ROLES, 'super_admin']}>
                <ModuleGuard module="reports">
                  <ReportsAnalyticsCenter />
                </ModuleGuard>
              </RoleGuard>
            </ProtectedRoute>
          } />

          {/* ── System administration ──────────────────────────────────── */}
          <Route path="/system-administration" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['super_admin', 'admin', 'sacco_admin']}>
                <SystemAdministration />
              </RoleGuard>
            </ProtectedRoute>
          } />

          {/* ── POS Module ─────────────────────────────────────────────── */}
          <Route path="/pos" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['super_admin', 'admin', 'manager', 'sales_agent', 'sales', 'director', 'operations']}>
                <ModuleGuard module="pos">
                  <POSModule />
                </ModuleGuard>
              </RoleGuard>
            </ProtectedRoute>
          } />

          {/* ── E-Signature ────────────────────────────────────────────── */}
          <Route path="/e-signature" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={ALL_INTERNAL}>
                <ModuleGuard module="esign">
                  <ESignaturePage />
                </ModuleGuard>
              </RoleGuard>
            </ProtectedRoute>
          } />

          {/* ── Finance Hub ────────────────────────────────────────────── */}
          <Route path="/finance-hub" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={FINANCE_ROLES}>
                <ModuleGuard module="accounting">
                  <FinanceHub />
                </ModuleGuard>
              </RoleGuard>
            </ProtectedRoute>
          } />

          {/* ── HR Management — HR role + CEO (admin) + super admin ────── */}
          <Route path="/hr-management" element={
            <ProtectedRoute>
              <RoleGuard allowedRoles={['hr', 'admin', 'super_admin', 'sacco_admin']}>
                <ModuleGuard module="hr">
                  <HRPage />
                </ModuleGuard>
              </RoleGuard>
            </ProtectedRoute>
          } />

          {/* ── My Profile — any authenticated user ────────────────────── */}
          <Route path="/profile" element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          } />

          <Route path="*" element={<NotFound />} />
        </RouterRoutes>
      </ErrorBoundary>
    </BrowserRouter>
  );
};

export default Routes;

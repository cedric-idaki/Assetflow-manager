import React, { lazy, Suspense } from "react";
import { BrowserRouter, Routes as RouterRoutes, Route, Navigate } from "react-router-dom";
import { isAndroidAppContext } from "utils/androidApp";
import Icon from "components/AppIcon";
import ScrollToTop from "components/ScrollToTop";
import ErrorBoundary from "components/ErrorBoundary";
import ProtectedRoute from "components/ProtectedRoute";
import RoleGuard from "components/RoleGuard";
// Module entitlements. RoleGuard answers "is this person allowed here";
// ModuleGuard answers "did this organisation switch this module on". See
// src/config/modules.js for the catalogue and which routes each module owns.
import ModuleGuard from "components/ModuleGuard";
// Eager: the catch-all has to be able to render without fetching a chunk.
import NotFound from "pages/NotFound";

// Every page below is code-split. They used to be static imports, which put all
// 32 of them in the entry chunk — 3.29 MB, every byte of it downloaded before
// the login screen could paint, including the SACCO, HR, POS and e-signature
// modules a given user may have no entitlement to open at all.
const LoginPage                 = lazy(() => import('./pages/login'));
const LandingPage               = lazy(() => import('./pages/landing'));
const SystemAdministration      = lazy(() => import('./pages/system-administration'));
const ReportsAnalyticsCenter    = lazy(() => import('./pages/reports-analytics-center'));
const AssetClientManagement     = lazy(() => import('./pages/asset-client-management'));
const SalesAgentPortal          = lazy(() => import('./pages/sales-agent-portal'));
const RoleBasedDashboard        = lazy(() => import('./pages/role-based-dashboard'));
const PaymentCollectionsHub     = lazy(() => import('./pages/payment-collections-hub'));
const ClientPortalDashboard     = lazy(() => import('./pages/client-portal-dashboard'));
const PaymentConfirmationScreen = lazy(() => import('./pages/payment-confirmation-screen'));
const UserRegistrationScreen    = lazy(() => import('./pages/user-registration-screen'));
const KYCManagementScreen       = lazy(() => import('./pages/kyc-management-screen'));
const KYCRenewalManagementScreen= lazy(() => import('./pages/kyc-renewal-management-screen'));
const SuperAdminDashboard       = lazy(() => import('./pages/super-admin-dashboard'));
const AdminRegistration         = lazy(() => import('./pages/admin-registration'));
const AdminDashboard            = lazy(() => import('./pages/admin-dashboard'));
const FinanceHub                = lazy(() => import('./pages/finance-hub'));
const HRPage                    = lazy(() => import('./pages/hr-management'));
const POSModule                 = lazy(() => import('./pages/pos-module'));
const ESignaturePage            = lazy(() => import('./pages/e-signature'));
const ExternalSignPage          = lazy(() => import('./pages/external-sign'));
const ResetPassword             = lazy(() => import('./pages/reset-password'));
const ClientPortal              = lazy(() => import('./pages/client-portal'));
const SubscriptionBilling       = lazy(() => import('./pages/subscription-billing'));
const ProfilePage               = lazy(() => import('./pages/profile'));
const SaccoDashboard            = lazy(() => import('./pages/sacco-dashboard'));
const SaccoMemberPortal         = lazy(() => import('./pages/sacco-member-portal'));
const SaccoOversight            = lazy(() => import('./pages/sacco-oversight'));
const ChoosePortal              = lazy(() => import('./pages/choose-portal'));
const PublicListing             = lazy(() => import('./pages/public-listing'));
const VerifyCertificate         = lazy(() => import('./pages/verify-certificate'));

// Matches the splash ProtectedRoute shows while the session is restoring, so a
// cold load that has to do both does not visibly change skin halfway through.
const RouteFallback = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="flex flex-col items-center gap-4">
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center shadow-lg shadow-blue-500/30 animate-pulse">
        <Icon name="Building2" size={24} color="white" />
      </div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span className="text-sm">Loading…</span>
      </div>
    </div>
  </div>
);

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
        <Suspense fallback={<RouteFallback />}>
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

          {/* ── Certificate verification desk — any authenticated user ───
              Not role-gated and not tenant-scoped: whoever is handed a
              certificate has to be able to check it, and they are usually not
              of the organisation that issued it. system_certificate_verify()
              returns only what is printed on the face they are holding, and
              logs every check. The optional :serial makes a serial linkable. */}
          <Route path="/verify-certificate" element={
            <ProtectedRoute>
              <VerifyCertificate />
            </ProtectedRoute>
          } />
          <Route path="/verify-certificate/:serial" element={
            <ProtectedRoute>
              <VerifyCertificate />
            </ProtectedRoute>
          } />

          <Route path="*" element={<NotFound />} />
        </RouterRoutes>
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  );
};

export default Routes;

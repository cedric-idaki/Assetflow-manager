import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth, getRoleRedirectPath } from '../contexts/AuthContext';
import Icon from './AppIcon';


/**
 * RoleGuard wraps a dashboard route and ensures the logged-in user's role
 * matches the allowed roles for that route. If not, they are silently
 * redirected to their correct dashboard.
 *
 * Props:
 *  - allowedRoles: string[]  — roles permitted to view this route
 *  - children: ReactNode
 */
const RoleGuard = ({ allowedRoles = [], children }) => {
  const { user, userProfile, loading, profileLoading, reloadProfile, signOut } = useAuth();

  // Wait for both auth and profile to resolve
  if (loading || profileLoading) {
    return (
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
            <span className="text-sm">Verifying access...</span>
          </div>
        </div>
      </div>
    );
  }

  // Not authenticated — ProtectedRoute already handles this, but guard defensively
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const role = userProfile?.role;

  // Fail CLOSED. This used to `return children` when the role was unknown, which
  // meant anyone without a resolvable profile row reached whatever dashboard they
  // asked for — including the super-admin one. Loading is already handled above,
  // so reaching here means the profile genuinely did not resolve: either the
  // fetch failed, or the account has no user_profiles row. Neither is a reason
  // to grant access. Offer a retry so a transient network blip is recoverable
  // without an unexplained redirect loop.
  if (!role) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center">
            <Icon name="ShieldAlert" size={24} className="text-amber-500" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">We couldn't verify your access</h1>
          <p className="text-sm text-muted-foreground">
            Your profile could not be loaded, so we can't tell which workspace to open.
            This is usually temporary — try again, or sign in with a different account.
            If it keeps happening, ask your administrator to check that your account is set up.
          </p>
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => reloadProfile?.()}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
            >
              Try again
            </button>
            <button
              onClick={() => signOut?.()}
              className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Check if the user's role is permitted for this route
  if (!allowedRoles?.includes(role)) {
    const correctPath = getRoleRedirectPath(role);
    return <Navigate to={correctPath} replace />;
  }

  return children;
};

export default RoleGuard;

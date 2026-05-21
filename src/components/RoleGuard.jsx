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
  const { user, userProfile, loading, profileLoading } = useAuth();

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

  // Profile not yet loaded but user exists — wait a tick; avoid premature redirect
  // If role is still null after loading is done, fall through to default dashboard
  if (!role) {
    // No role info available — allow through (ProtectedRoute already confirmed auth)
    return children;
  }

  // Check if the user's role is permitted for this route
  if (!allowedRoles?.includes(role)) {
    const correctPath = getRoleRedirectPath(role);
    return <Navigate to={correctPath} replace />;
  }

  return children;
};

export default RoleGuard;

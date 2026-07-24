import React from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../AppIcon';
import { useAuth } from '../../contexts/AuthContext';

/**
 * A small ✕ "close this module" button for page headers.
 *
 * Clicking it returns the user to their own dashboard portal — the same
 * role-based destination they land on right after login
 * (admin → /admin-dashboard, super_admin → /super-admin-dashboard,
 * sacco_admin → /sacco-dashboard, other staff → /role-based-dashboard).
 * It does NOT sign the user out.
 */
const ClosePageButton = ({ label = 'Close', className = '' }) => {
  const navigate = useNavigate();
  const { userProfile, getRoleRedirectPath } = useAuth();

  const handleClose = () => navigate(getRoleRedirectPath(userProfile?.role));

  return (
    <button
      type="button"
      onClick={handleClose}
      title={label}
      aria-label={`${label} — return to dashboard`}
      className={`inline-flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground border border-border hover:text-red-600 hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors ${className}`}
    >
      <Icon name="X" size={18} color="currentColor" />
    </button>
  );
};

export default ClosePageButton;

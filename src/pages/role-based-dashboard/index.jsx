import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import AdminDashboard from './AdminDashboard';
import DirectorDashboard from './DirectorDashboard';
import AccountantDashboard from './AccountantDashboard';
import CollectionsDashboard from './CollectionsDashboard';
import StaffDashboard from './StaffDashboard';

const RoleBasedDashboard = () => {
  const { userProfile } = useAuth();
  const role = userProfile?.role;

  switch (role) {
    case 'admin':
    case 'manager':
    case 'finance':
    case 'operations':
      return <AdminDashboard />;

    case 'director':
      return <DirectorDashboard />;

    case 'accountant':
      return <AccountantDashboard />;

    case 'collections_officer':
    case 'collections':
      return <CollectionsDashboard />;

    case 'hr':
    case 'it_support':
    case 'staff':
      return <StaffDashboard />;

    default:
      return <AdminDashboard />;
  }
};

export default RoleBasedDashboard;
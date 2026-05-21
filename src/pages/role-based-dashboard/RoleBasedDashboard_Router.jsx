import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import SuperAdminDashboard from './SuperAdminDashboard';
// We will add more role dashboards here as we build them
// import DirectorDashboard from './DirectorDashboard';
// import AccountantDashboard from './AccountantDashboard';
// import CollectionsDashboard from './CollectionsDashboard';
import DefaultDashboard from './DefaultDashboard';

const RoleBasedDashboard = () => {
  const { userProfile, loading } = useAuth();

  if (loading) return null;

  const role = userProfile?.role;

  // Route each role to its own dashboard
  switch (role) {
    case 'super_admin':
      return <SuperAdminDashboard />;
    case 'admin':
      return <SuperAdminDashboard />; // Admin shares Super Admin layout for now
    // Uncomment as we build each dashboard:
    // case 'director':
    //   return <DirectorDashboard />;
    // case 'accountant':
    //   return <AccountantDashboard />;
    // case 'collections_officer':
    //   return <CollectionsDashboard />;
    default:
      return <DefaultDashboard />;
  }
};

export default RoleBasedDashboard;

import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Icon from './AppIcon';
import DeviceBlockedScreen from './DeviceBlockedScreen';


const Splash = ({ message }) => (
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
        <span className="text-sm">{message}</span>
      </div>
    </div>
  </div>
);

const ProtectedRoute = ({ children }) => {
  const { user, loading, deviceCheck, claimDeviceSlot, signOut } = useAuth();

  if (loading) {
    return <Splash message="Loading Ararat..." />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Device restriction: one mobile phone + one laptop/tablet per account. The
  // verdict comes from the server (AuthContext.verifyDevice); 'error' fails
  // open on purpose, so only an explicit rejection stops a session here.
  if (deviceCheck?.status === 'checking' || deviceCheck?.status === 'idle') {
    return <Splash message="Checking this device..." />;
  }

  if (deviceCheck?.status === 'blocked') {
    return (
      <DeviceBlockedScreen
        deviceCheck={deviceCheck}
        onClaim={claimDeviceSlot}
        onSignOut={signOut}
      />
    );
  }

  return children;
};

export default ProtectedRoute;

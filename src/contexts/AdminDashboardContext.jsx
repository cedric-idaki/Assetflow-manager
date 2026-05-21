/**
 * AdminDashboardContext
 * Mounts useAdminDashboard once at the app level so its data and realtime
 * subscriptions survive navigation between pages.
 * Also manages modal state so modals stay open when switching tabs.
 */
import React, { createContext, useContext, useState, useCallback } from 'react';
import { useAdminDashboard } from '../hooks/useAdminDashboard';

const AdminDashboardContext = createContext(null);

export const AdminDashboardProvider = ({ children }) => {
  const dashboard = useAdminDashboard();
  const [modals, setModals] = useState({
    inviteClient: false,
    createAgent: false,
    uploadContract: false,
    templateEditor: null,
    rejectKYC: null,
    settlementLetter: null,
  });

  const openModal = useCallback((name, data = null) => {
    setModals(prev => ({ ...prev, [name]: data ?? true }));
  }, []);

  const closeModal = useCallback((name) => {
    setModals(prev => ({ ...prev, [name]: false }));
  }, []);

  const value = {
    ...dashboard,
    modals,
    openModal,
    closeModal,
  };

  return (
    <AdminDashboardContext.Provider value={value}>
      {children}
    </AdminDashboardContext.Provider>
  );
};

export const useAdminDashboardContext = () => {
  const ctx = useContext(AdminDashboardContext);
  if (!ctx) throw new Error('useAdminDashboardContext must be used within AdminDashboardProvider');
  return ctx;
};

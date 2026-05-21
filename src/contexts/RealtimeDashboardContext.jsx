/**
 * RealtimeDashboardContext
 * Mounts useRealtimeDashboard once at the app level so KPI data and realtime
 * subscriptions survive navigation between pages.
 * Also manages modal state so modals stay open when switching tabs.
 */
import React, { createContext, useContext, useState, useCallback } from 'react';
import { useRealtimeDashboard } from '../hooks/useRealtimeDashboard';

const RealtimeDashboardContext = createContext(null);

export const RealtimeDashboardProvider = ({ children }) => {
  const dashboard = useRealtimeDashboard();
  const [modals, setModals] = useState({
    assetSchedule: null,
    statement: null,
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
    <RealtimeDashboardContext.Provider value={value}>
      {children}
    </RealtimeDashboardContext.Provider>
  );
};

export const useRealtimeDashboardContext = () => {
  const ctx = useContext(RealtimeDashboardContext);
  if (!ctx) throw new Error('useRealtimeDashboardContext must be used within RealtimeDashboardProvider');
  return ctx;
};

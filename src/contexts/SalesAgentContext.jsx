/**
 * SalesAgentContext
 * Mounts useSalesAgentPortal once at the app level so its data and realtime
 * subscriptions survive navigation between pages.
 * Also manages modal state so modals stay open when switching tabs.
 */
import React, { createContext, useContext, useState, useCallback } from 'react';
import { useSalesAgentPortal } from '../hooks/useSalesAgentPortal';

const SalesAgentContext = createContext(null);

export const SalesAgentProvider = ({ children }) => {
  const portal = useSalesAgentPortal();
  const [modals, setModals] = useState({
    leadRegistration: false,
    createClient: false,
    leadDetail: null,
  });

  const openModal = useCallback((name, data = null) => {
    setModals(prev => ({ ...prev, [name]: data ?? true }));
  }, []);

  const closeModal = useCallback((name) => {
    setModals(prev => ({ ...prev, [name]: false }));
  }, []);

  const value = {
    ...portal,
    modals,
    openModal,
    closeModal,
  };

  return (
    <SalesAgentContext.Provider value={value}>
      {children}
    </SalesAgentContext.Provider>
  );
};

export const useSalesAgentContext = () => {
  const ctx = useContext(SalesAgentContext);
  if (!ctx) throw new Error('useSalesAgentContext must be used within SalesAgentProvider');
  return ctx;
};

/**
 * ClientPortalContext
 * Mounts useClientPortal once at the app level so its data and realtime
 * subscriptions survive navigation between pages.
 * Also manages modal state so modals stay open when switching tabs.
 */
import React, { createContext, useContext, useState, useCallback } from 'react';
import { useClientPortal } from '../hooks/useClientPortal';

const ClientPortalContext = createContext(null);

export const ClientPortalProvider = ({ children }) => {
  const portal = useClientPortal();
  const [modals, setModals] = useState({
    payment: null,
    enquiry: null,
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
    <ClientPortalContext.Provider value={value}>
      {children}
    </ClientPortalContext.Provider>
  );
};

export const useClientPortalContext = () => {
  const ctx = useContext(ClientPortalContext);
  if (!ctx) throw new Error('useClientPortalContext must be used within ClientPortalProvider');
  return ctx;
};

/**
 * FinanceHubContext
 * Mounts useFinanceHub once at the app level so its data and realtime
 * subscriptions survive navigation between pages.
 * Also manages modal state so modals stay open when switching tabs.
 */
import React, { createContext, useContext, useState, useCallback } from 'react';
import { useFinanceHub } from '../hooks/useFinanceHub';

const FinanceHubContext = createContext(null);

export const FinanceHubProvider = ({ children }) => {
  const financeHub = useFinanceHub();
  const [modals, setModals] = useState({
    newJournal: false,
    newAccount: false,
    payrollRun: null,
  });

  const openModal = useCallback((name, data = null) => {
    setModals(prev => ({ ...prev, [name]: data ?? true }));
  }, []);

  const closeModal = useCallback((name) => {
    setModals(prev => ({ ...prev, [name]: false }));
  }, []);

  const value = {
    ...financeHub,
    modals,
    openModal,
    closeModal,
  };

  return (
    <FinanceHubContext.Provider value={value}>
      {children}
    </FinanceHubContext.Provider>
  );
};

export const useFinanceHubContext = () => {
  const ctx = useContext(FinanceHubContext);
  if (!ctx) throw new Error('useFinanceHubContext must be used within FinanceHubProvider');
  return ctx;
};

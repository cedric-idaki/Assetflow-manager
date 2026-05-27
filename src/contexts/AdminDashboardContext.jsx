/**
 * AdminDashboardContext
 * Mounts useAdminDashboard once at the app level so its data and realtime
 * subscriptions survive navigation between pages.
 * Also manages modal state so modals stay open when switching tabs.
 */
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from 'react';
import { useAdminDashboard } from '../hooks/useAdminDashboard';
import { useAuth } from '../contexts/AuthContext';

const AdminDashboardContext = createContext(null);

export const AdminDashboardProvider = ({ children }) => {
  const dashboard = useAdminDashboard();
  const { user } = useAuth();

  // ── MODAL STATE (FIXED: stable types, no false/null confusion) ──────────────
  const [modals, setModals] = useState(() => ({
    // Admin dashboard modals
    inviteClient: false,
    createAgent: false,
    uploadContract: false,
    templateEditor: null,
    rejectKYC: null,
    settlementLetter: null,
    // HR management modals
    hrEmployee: null,       // null = closed, object = employee being edited (or true = new)
    hrEmployeeDetail: null, // null = closed, object = employee being viewed
    hrPayroll: false,       // run payroll modal
  }));

  // ── OPEN MODAL (FIXED: consistent assignment) ───────────────────────────────
  const openModal = useCallback((name, data = true) => {
    setModals(prev => ({
      ...prev,
      [name]: data,
    }));
  }, []);

  // ── CLOSE MODAL (FIXED: preserves correct type semantics) ───────────────────
  const closeModal = useCallback((name) => {
    setModals(prev => {
      const current = prev[name];

      return {
        ...prev,
        [name]: typeof current === 'object' ? null : false,
      };
    });
  }, []);

  // ── RESET ON AUTH CHANGE (prevents stale UI state leaks) ────────────────────
  useEffect(() => {
    if (!user?.id) {
      setModals({
        inviteClient: false,
        createAgent: false,
        uploadContract: false,
        templateEditor: null,
        rejectKYC: null,
        settlementLetter: null,
        hrEmployee: null,
        hrEmployeeDetail: null,
        hrPayroll: false,
      });
    }
  }, [user?.id]);

  // ── CONTEXT VALUE ───────────────────────────────────────────────────────────
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
  if (!ctx) {
    throw new Error(
      'useAdminDashboardContext must be used within AdminDashboardProvider'
    );
  }
  return ctx;
};

export default AdminDashboardContext;
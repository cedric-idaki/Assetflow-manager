/**
 * SalesAgentContext
 * Mounts useSalesAgentPortal once at the app level so its data and realtime
 * subscriptions survive navigation between pages.
 * Also manages modal state so modals stay open when switching tabs.
 */
import React, { createContext, useContext, useState, useCallback } from 'react';
import { useSalesAgentPortal } from '../hooks/useSalesAgentPortal';
import { useAgentTickets } from '../hooks/useAgentTickets';
import { useAgentCatalog } from '../hooks/useAgentCatalog';
import { useAgentClients } from '../hooks/useAgentClients';

const SalesAgentContext = createContext(null);

export const SalesAgentProvider = ({ children }) => {
  const portal = useSalesAgentPortal();
  // Tickets hang off the agent profile the portal hook resolves, and mount here
  // so their realtime subscriptions survive navigation like everything else.
  const tickets = useAgentTickets(portal.agentProfile);
  // The shareable catalogue, same reasoning: a buyer opening a link changes the
  // counts while the agent is on another tab.
  const catalog = useAgentCatalog(portal.agentProfile);
  // The client book — who the agent signed and whether those accounts still
  // pay. It reads the portal's leads rather than re-fetching them, so it mounts
  // here where both are already resolved.
  const clientBook = useAgentClients(portal.agentProfile, portal.agentMode, portal.leads);
  const [activeView, setActiveView] = useState('portal');
  const [modals, setModals] = useState({
    leadRegistration: false,
    // createClient covers the agent's default entity (a client for admin-created
    // agents, a company for super-admin ones); createSacco is its own modal so a
    // super-admin agent can register either without changing agent mode.
    createClient: false,
    createSacco: false,
    leadDetail: null,
    showExport: false,
    selectedLead: null,
    prefillLead: null,
    scheduleFollowUp: false,
    prefillFollowUpLead: null,
    assist: false,
    assistInbox: false,
    tickets: false,
    newTicket: false,
    ticketThread: null,
    // Holds the asset being shared, so the modal knows what link to mint.
    shareListing: null,
    successPopup: null,
  });

  const openModal = useCallback((name, data = null) => {
    setModals(prev => ({ ...prev, [name]: data ?? true }));
  }, []);

  const closeModal = useCallback((name) => {
    setModals(prev => ({ ...prev, [name]: false }));
  }, []);

  const value = {
    ...portal,
    ...tickets,
    // Namespaced rather than spread: the catalogue has its own loading/error/
    // refetch, and spreading them would silently shadow the portal's.
    catalogAssets:      catalog.assets,
    shareLinks:         catalog.links,
    shareLinksByAsset:  catalog.linksByAsset,
    shareStats:         catalog.stats,
    catalogLoading:     catalog.loading,
    catalogError:       catalog.error,
    refetchCatalog:     catalog.refetch,
    // Namespaced for the same reason as the catalogue above.
    clientBook:            clientBook.clients,
    clientBookCounts:      clientBook.counts,
    clientsNeedingFollowUp: clientBook.needsFollowUp,
    clientBookLoading:     clientBook.loading,
    clientBookError:       clientBook.error,
    clientBookBlocked:     clientBook.subscriptionsBlocked,
    tracksSubscriptions:   clientBook.tracksSubscriptions,
    clientBookEnabled:     clientBook.enabled,
    refetchClientBook:     clientBook.refetch,
    activeView,
    setActiveView,
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

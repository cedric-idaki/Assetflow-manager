import React, { useState } from 'react';
import MainLayout from '../../layouts/MainLayout';
import { useAuth } from '../../contexts/AuthContext';
import Icon from '../../components/AppIcon';

import PricingOverview from './components/PricingOverview';
import SubscriptionCalculator from './components/SubscriptionCalculator';
import ClientSubscriptionList from './components/ClientSubscriptionList';
import EditSubscriptionModal from './components/EditSubscriptionModal';

// ── Tab helper ─────────────────────────────────────────────────────────────────
const Tab = ({ active, label, icon, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all border ${
      active
        ? 'border-primary/40 text-primary'
        : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted'
    }`}
    style={active ? { background: 'rgba(26,86,219,0.08)' } : {}}
  >
    <Icon name={icon} size={15} color="currentColor" />
    {label}
  </button>
);

const TABS = [
  { id: 'overview',    label: 'Pricing Overview',   icon: 'LayoutGrid' },
  { id: 'calculator', label: 'Calculator',           icon: 'Calculator' },
  { id: 'clients',    label: 'Client Subscriptions', icon: 'Building2' },
];

// ── Page ───────────────────────────────────────────────────────────────────────
const SubscriptionBilling = () => {
  const { userProfile } = useAuth();
  const [activeTab, setActiveTab]         = useState('overview');
  const [editingClient, setEditingClient] = useState(null);

  return (
    <MainLayout>
      <div className="space-y-6">

        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
            >
              <Icon name="CreditCard" size={20} color="#fff" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Subscription & Billing</h1>
              <p className="text-sm text-muted-foreground">
                Manage client pricing tiers and subscriptions
              </p>
            </div>
          </div>

          {/* Quick info badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-card text-xs font-medium text-muted-foreground">
              <Icon name="Building2" size={12} color="currentColor" />
              Corporate · KES 240–390/user
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-card text-xs font-medium text-muted-foreground">
              <Icon name="Users" size={12} color="currentColor" />
              SACCO · Base + KES 50/member
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 flex-wrap">
          {TABS.map(t => (
            <Tab
              key={t.id}
              active={activeTab === t.id}
              label={t.label}
              icon={t.icon}
              onClick={() => setActiveTab(t.id)}
            />
          ))}
        </div>

        {/* Content */}
        {activeTab === 'overview' && <PricingOverview />}
        {activeTab === 'calculator' && <SubscriptionCalculator />}
        {activeTab === 'clients' && (
          <ClientSubscriptionList onEditClient={setEditingClient} />
        )}

      </div>

      {/* Edit modal */}
      {editingClient && (
        <EditSubscriptionModal
          client={editingClient}
          onClose={() => setEditingClient(null)}
          onSave={(updated) => {
            // In production: call supabase to persist the change
            console.info('[SubscriptionBilling] Saved subscription:', updated);
            setEditingClient(null);
          }}
        />
      )}
    </MainLayout>
  );
};

export default SubscriptionBilling;

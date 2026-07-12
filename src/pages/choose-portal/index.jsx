import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import Icon from '../../components/AppIcon';

// Shown to the super admin right after login — pick which portal to work in.
// Both portals stay reachable afterwards via the sidebar and /profile.
const PortalCard = ({ icon, gradient, title, description, points, cta, onClick }) => (
  <button
    onClick={onClick}
    className="group text-left bg-card border border-border rounded-2xl p-6 w-full transition-all hover:border-primary/50 hover:shadow-lg hover:-translate-y-0.5"
  >
    <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4" style={{ background: gradient }}>
      <Icon name={icon} size={22} color="#fff" />
    </div>
    <h2 className="text-lg font-bold text-foreground">{title}</h2>
    <p className="text-sm text-muted-foreground mt-1">{description}</p>
    <ul className="mt-4 space-y-1.5">
      {points.map((p) => (
        <li key={p} className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon name="Check" size={13} color="#0891b2" />
          {p}
        </li>
      ))}
    </ul>
    <div className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
      {cta}
      <Icon name="ArrowRight" size={15} color="currentColor" className="transition-transform group-hover:translate-x-0.5" />
    </div>
  </button>
);

const ChoosePortal = () => {
  const navigate = useNavigate();
  const { userProfile, signOut } = useAuth();

  const logout = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: '#34c1dd' }}>
            <Icon name="Building2" size={18} color="#0c2037" />
          </div>
          <span className="font-bold text-foreground" style={{ fontFamily: 'Georgia, serif' }}>AssetFlow</span>
        </div>
        <button onClick={logout} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-red-500 transition-colors">
          <Icon name="LogOut" size={14} color="currentColor" />
          Sign out
        </button>
      </div>

      {/* Chooser */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-3xl">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-4"
              style={{ background: 'rgba(255,107,53,0.1)', color: '#E85D2F' }}>
              <Icon name="Crown" size={13} color="#E85D2F" />
              Super Admin
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
              Welcome back{userProfile?.full_name ? `, ${userProfile.full_name.split(' ')[0]}` : ''}
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              Choose which portal you want to work in. You can switch at any time from your profile.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <PortalCard
              icon="Building2"
              gradient="linear-gradient(135deg, #FF6B35, #E85D2F)"
              title="Company Portal"
              description="Asset-financing companies, clients, sales agents and system-wide operations."
              points={['Company registrations & analytics', 'Sales agents, contracts & KYC', 'Payments, settlements & reports']}
              cta="Open Company Portal"
              onClick={() => navigate('/super-admin-dashboard')}
            />
            <PortalCard
              icon="PiggyBank"
              gradient="linear-gradient(135deg, #0891b2, #34c1dd)"
              title="Saccos Portal"
              description="Saccos & chamas — their first-time registration details and live activity."
              points={['Sacco registration records', 'Members, contributions & loans', 'Motions, invoices & activity feed']}
              cta="Open Saccos Portal"
              onClick={() => navigate('/sacco-oversight')}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChoosePortal;

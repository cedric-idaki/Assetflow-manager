import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import AgentsTab from './AgentsTab';
import SalesTeamPanel from '../../../components/sales/SalesTeamPanel';

/**
 * The Sales Agents tab: the agent register and the team structure over it.
 *
 * Shared by the company admin dashboard and the sacco dashboard. Both run a
 * sales force in their own tenant and the screen is the same — whose agents
 * appear is settled by RLS on `agents` (admin_id = current_admin_id()), not by
 * anything passed in here. `ownerNoun` only changes the wording.
 */
const SalesAgentsSection = ({ agents, salesAnalytics, onCreateAgent, onExport, ownerNoun = 'company' }) => {
  // Which half of the tab is showing. Local rather than in the URL: the tab
  // itself is the thing worth linking to, and a second URL key would have to
  // be cleared every time the tab changed.
  const [view, setView] = useState('roster');

  return (
    <div className="space-y-4">
      {/* Roster and org chart are two views of the same people, so they live
          under one tab rather than competing for a place in the tab bar. The
          roster stays the default: it is what this tab has always shown. */}
      <div className="flex rounded-xl border border-border overflow-hidden w-fit">
        {[
          { id: 'roster', label: 'Agents',         icon: 'Users' },
          { id: 'teams',  label: 'Team structure', icon: 'Network' },
        ].map(v => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors ${
              view === v.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            <Icon name={v.icon} size={13} color="currentColor" />
            {v.label}
          </button>
        ))}
      </div>

      {view === 'roster' ? (
        <AgentsTab
          agents={agents}
          salesAnalytics={salesAnalytics}
          onCreateAgent={onCreateAgent}
          onExport={onExport}
          ownerNoun={ownerNoun}
        />
      ) : (
        <SalesTeamPanel onExport={onExport} />
      )}
    </div>
  );
};

export default SalesAgentsSection;

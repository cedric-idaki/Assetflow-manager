import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import LeadPipelineCard from './LeadPipelineCard';

const STAGE_CONFIG = {
  new_lead: { label: 'New Lead', color: 'bg-blue-500/10 border-blue-200 text-blue-700', headerBg: 'bg-blue-500/10' },
  contacted: { label: 'Contacted', color: 'bg-amber-500/10 border-amber-200 text-amber-700', headerBg: 'bg-amber-500/10' },
  qualified: { label: 'Qualified', color: 'bg-blue-500/10 border-blue-200 text-blue-700', headerBg: 'bg-blue-500/10' },
  proposal_sent: { label: 'Proposal Sent', color: 'bg-cyan-500/10 border-cyan-200 text-cyan-700', headerBg: 'bg-cyan-500/10' },
  closed: { label: 'Closed', color: 'bg-emerald-500/10 border-emerald-200 text-emerald-700', headerBg: 'bg-emerald-500/10' },
};

const PipelineStage = ({ stageKey, leads, onDrop, onLeadClick }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const config = STAGE_CONFIG?.[stageKey] || { label: stageKey, color: 'bg-muted', headerBg: 'bg-muted' };

  const handleDragOver = (e) => {
    e?.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleDrop = (e) => {
    e?.preventDefault();
    setIsDragOver(false);
    const leadId = e?.dataTransfer?.getData('leadId');
    if (leadId) onDrop(leadId, stageKey);
  };

  return (
    <div className="flex flex-col min-w-0">
      {/* Stage header */}
      <div className={`rounded-xl px-3 py-2.5 mb-3 border ${config?.color}`}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">{config?.label}</span>
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-card text-xs font-bold text-foreground shadow-sm">
            {leads?.length || 0}
          </span>
        </div>
      </div>
      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex-1 min-h-[320px] rounded-xl p-2 transition-all ${
          isDragOver
            ? 'bg-primary/5 border-2 border-dashed border-primary ring-1 ring-primary/20' :'bg-muted/30 border border-border/50'
        }`}
      >
        {leads?.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 text-center">
            <Icon name="Inbox" size={24} color="var(--color-muted-foreground)" />
            <p className="text-xs text-muted-foreground mt-1">Drop leads here</p>
          </div>
        ) : (
          leads?.map((lead) => (
            <LeadPipelineCard
              key={lead?.id}
              lead={lead}
              onDragStart={(e) => {
                e?.dataTransfer?.setData('leadId', lead?.id);
              }}
              onLeadClick={onLeadClick}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default PipelineStage;
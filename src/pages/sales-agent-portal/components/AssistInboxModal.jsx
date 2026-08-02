import React from 'react';
import Icon from '../../../components/AppIcon';
import AssistRequestsPanel from './AssistRequestsPanel';

// The "Assists" header button opens this. It used to be a plain #hash link, so
// it only did anything when the agent happened to be on the portal view with the
// panel mounted — from the Activity view the click was silently dead, and even on
// the portal it just scrolled to a card sitting below the KPIs, the pipeline, the
// clients list and the follow-ups. A gold agent clicking "Assists" wants to read
// the requests, so show them here instead of hoping the scroll lands.

const AssistInboxModal = ({ isOpen, onClose, ...panelProps }) => {
  if (!isOpen) return null;

  const pending = panelProps?.buckets?.pending?.length || 0;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl shadow-2xl w-full max-w-2xl my-8"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <div className="w-9 h-9 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0">
            <Icon name="LifeBuoy" size={17} color="#d97706" />
          </div>
          <div className="min-w-0">
            <h2 className="font-heading font-semibold text-base text-foreground">Assist Requests</h2>
            <p className="text-xs text-muted-foreground">
              {pending > 0
                ? `${pending} bronze agent${pending !== 1 ? 's' : ''} waiting on you`
                : 'Help bronze agents have asked you for'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <Icon name="X" size={17} color="currentColor" />
          </button>
        </div>

        <div className="p-5">
          <AssistRequestsPanel {...panelProps} embedded />
        </div>
      </div>
    </div>
  );
};

export default AssistInboxModal;

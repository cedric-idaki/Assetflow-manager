import React from 'react';
import Icon from '../../../components/AppIcon';
import TicketsPanel from './TicketsPanel';

// What the "Tickets" header button opens. The panel is also on the portal page,
// but an agent on the Activity view — or one who just got an email about a
// reply — should not have to find their way back and scroll to it.

const TicketsInboxModal = ({ isOpen, onClose, ...panelProps }) => {
  if (!isOpen) return null;

  const unread = panelProps?.buckets?.unreadCount || 0;
  const pool   = panelProps?.buckets?.pool?.length || 0;

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
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Icon name="Ticket" size={17} color="var(--color-primary)" />
          </div>
          <div className="min-w-0">
            <h2 className="font-heading font-semibold text-base text-foreground">Tickets</h2>
            <p className="text-xs text-muted-foreground">
              {unread > 0
                ? `${unread} ticket${unread !== 1 ? 's' : ''} with something new`
                : pool > 0
                ? `${pool} ticket${pool !== 1 ? 's' : ''} waiting to be claimed`
                : 'Your conversations with the other agents'}
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
          <TicketsPanel {...panelProps} embedded />
        </div>
      </div>
    </div>
  );
};

export default TicketsInboxModal;

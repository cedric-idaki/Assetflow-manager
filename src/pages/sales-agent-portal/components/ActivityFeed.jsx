import React from 'react';
import Icon from '../../../components/AppIcon';

const getActionIcon = (action) => {
  switch (action) {
    case 'create': return { name: 'PlusCircle', color: 'var(--color-success)' };
    case 'update': return { name: 'RefreshCw', color: 'var(--color-primary)' };
    case 'delete': return { name: 'Trash2', color: 'var(--color-error)' };
    case 'login': return { name: 'LogIn', color: 'var(--color-accent)' };
    case 'approve': return { name: 'CheckCircle', color: 'var(--color-success)' };
    default: return { name: 'Activity', color: 'var(--color-muted-foreground)' };
  }
};

const timeAgo = (ts) => {
  const diff = Date.now() - new Date(ts)?.getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
};

const ActivityFeed = ({ activities, loading }) => {
  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="h-5 bg-muted rounded w-32 animate-pulse" />
          <div className="h-5 w-5 bg-muted rounded animate-pulse" />
        </div>
        {[...Array(5)]?.map((_, i) => (
          <div key={i} className="flex gap-3 mb-4 animate-pulse">
            <div className="w-8 h-8 rounded-full bg-muted flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 bg-muted rounded w-3/4" />
              <div className="h-3 bg-muted rounded w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-heading font-semibold text-base text-foreground">Activity Feed</h3>
        <Icon name="Activity" size={18} color="var(--color-primary)" />
      </div>
      <div className="space-y-3 max-h-[380px] overflow-y-auto scrollbar-custom pr-1">
        {activities?.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Icon name="Inbox" size={28} color="var(--color-muted-foreground)" />
            <p className="text-sm text-muted-foreground mt-2">No recent activity</p>
          </div>
        ) : (
          activities?.map((item) => {
            const icon = getActionIcon(item?.action);
            return (
              <div key={item?.id} className="flex items-start gap-3 pb-3 border-b border-border last:border-0 last:pb-0">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center">
                  <Icon name={icon?.name} size={13} color={icon?.color} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground leading-relaxed">{item?.description || `${item?.action} on ${item?.table_name}`}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(item?.created_at)}</p>
                </div>
                {item?.severity && item?.severity !== 'info' && (
                  <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${
                    item?.severity === 'warning' ? 'bg-amber-500/10 text-amber-600' :
                    item?.severity === 'error'? 'bg-red-500/10 text-red-600' : 'bg-muted text-muted-foreground'
                  }`}>
                    {item?.severity}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ActivityFeed;
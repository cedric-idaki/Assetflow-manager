import React from 'react';
import Icon from '../../../components/AppIcon';

const ActivityItem = ({ type, title, description, timestamp, status }) => {
  const getTypeIcon = () => {
    switch (type) {
      case 'payment':
        return 'DollarSign';
      case 'asset':
        return 'Package';
      case 'client':
        return 'User';
      case 'approval':
        return 'CheckCircle';
      case 'alert':
        return 'AlertCircle';
      default:
        return 'Activity';
    }
  };

  const getTypeColor = () => {
    switch (type) {
      case 'payment':
        return 'var(--color-success)';
      case 'asset':
        return 'var(--color-primary)';
      case 'client':
        return 'var(--color-accent)';
      case 'approval':
        return 'var(--color-warning)';
      case 'alert':
        return 'var(--color-error)';
      default:
        return 'var(--color-muted-foreground)';
    }
  };

  const getStatusBadge = () => {
    if (!status) return null;

    const statusColors = {
      completed: 'bg-success bg-opacity-10 text-success',
      pending: 'bg-warning bg-opacity-10 text-warning',
      failed: 'bg-error bg-opacity-10 text-error',
    };

    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors?.[status] || ''}`}>
        {status?.charAt(0)?.toUpperCase() + status?.slice(1)}
      </span>
    );
  };

  return (
    <div className="flex items-start space-x-3 p-3 md:p-4 bg-card rounded-lg border border-border hover:bg-muted transition-smooth">
      <div
        className="flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0"
        style={{ backgroundColor: `${getTypeColor()}15` }}
      >
        <Icon name={getTypeIcon()} size={20} color={getTypeColor()} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between mb-1">
          <h5 className="text-sm md:text-base font-medium text-foreground line-clamp-1">{title}</h5>
          {getStatusBadge()}
        </div>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-1">{description}</p>
        <span className="text-xs text-muted-foreground">{timestamp}</span>
      </div>
    </div>
  );
};

export default ActivityItem;
import React from 'react';
import Icon from '../../../components/AppIcon';

const MetricCard = ({ title, value, change, changeType, icon, iconColor }) => {
  const getChangeColor = () => {
    if (changeType === 'positive') return 'text-success';
    if (changeType === 'negative') return 'text-error';
    return 'text-muted-foreground';
  };

  const getChangeIcon = () => {
    if (changeType === 'positive') return 'TrendingUp';
    if (changeType === 'negative') return 'TrendingDown';
    return 'Minus';
  };

  return (
    <div className="bg-card rounded-xl p-5 shadow-sm border border-border hover-lift transition-smooth">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <p className="text-sm text-muted-foreground mb-1">{title}</p>
          <h3 className="text-2xl md:text-2xl font-bold text-foreground">
            {value}
          </h3>
        </div>
        <div
          className="flex items-center justify-center w-12 h-12 rounded-lg"
          style={{ backgroundColor: `${iconColor}15` }}
        >
          <Icon name={icon} size={24} color={iconColor} />
        </div>
      </div>
      {change && (
        <div className="flex items-center space-x-1">
          <Icon name={getChangeIcon()} size={16} color={`var(--color-${changeType === 'positive' ? 'success' : changeType === 'negative' ? 'error' : 'muted-foreground'})`} />
          <span className={`text-sm font-medium ${getChangeColor()}`}>{change}</span>
          <span className="text-sm text-muted-foreground">vs last month</span>
        </div>
      )}
    </div>
  );
};

export default MetricCard;
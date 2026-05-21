import React from 'react';
import Icon from '../../../components/AppIcon';

const MetricCard = ({ title, value, change, changeType, icon, iconColor }) => {
  const isPositive = changeType === 'positive';
  const changeIcon = isPositive ? 'TrendingUp' : 'TrendingDown';
  const changeColor = isPositive ? 'text-success' : 'text-error';

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted-foreground">{title}</span>
        <div className={`flex items-center justify-center w-8 h-8 md:w-10 md:h-10 rounded-xl ${iconColor}`}>
          <Icon name={icon} size={18} color="currentColor" />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-2xl font-bold text-foreground data-text">{value}</p>
        {change && (
          <div className={`flex items-center space-x-1 ${changeColor}`}>
            <Icon name={changeIcon} size={14} color="currentColor" />
            <span className="text-xs md:text-sm font-medium">{change}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default MetricCard;
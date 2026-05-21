import React from 'react';
import Icon from '../../../components/AppIcon';

const AgingAnalysisCard = ({ period, count, amount, severity, onClick }) => {
  const getSeverityColor = () => {
    switch (severity) {
      case 'high':
        return 'bg-error bg-opacity-10 border-error text-error';
      case 'medium':
        return 'bg-warning bg-opacity-10 border-warning text-warning';
      case 'low':
        return 'bg-success bg-opacity-10 border-success text-success';
      default:
        return 'bg-muted border-border text-muted-foreground';
    }
  };

  const getSeverityIcon = () => {
    switch (severity) {
      case 'high':
        return 'AlertTriangle';
      case 'medium':
        return 'AlertCircle';
      case 'low':
        return 'Info';
      default:
        return 'Clock';
    }
  };

  return (
    <button
      onClick={onClick}
      className={`w-full bg-card rounded-xl p-4  border-2 ${getSeverityColor()} hover-lift press-scale transition-smooth text-left`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Icon name={getSeverityIcon()} size={20} color="currentColor" />
          <h4 className="text-base md:text-lg font-heading font-semibold">{period}</h4>
        </div>
        <Icon name="ChevronRight" size={20} color="currentColor" />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Accounts</span>
          <span className="text-lg font-semibold">{count}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Amount</span>
          <span className="text-lg font-semibold">{amount}</span>
        </div>
      </div>
    </button>
  );
};

export default AgingAnalysisCard;
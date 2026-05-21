import React from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const ReportCard = ({ 
  title, 
  description, 
  icon, 
  category, 
  lastGenerated, 
  onGenerate, 
  onSchedule 
}) => {
  return (
    <div className="bg-card border border-border rounded-lg p-4 md:p-6 hover-lift transition-smooth">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className="flex items-center justify-center w-10 h-10 md:w-12 md:h-12 rounded-lg bg-primary bg-opacity-10">
            <Icon name={icon} size={20} color="var(--color-primary)" />
          </div>
          <div>
            <h3 className="text-base md:text-lg font-semibold text-foreground">{title}</h3>
            <span className="inline-block mt-1 px-2 py-1 text-xs font-medium rounded-md bg-muted text-muted-foreground">
              {category}
            </span>
          </div>
        </div>
      </div>

      <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{description}</p>

      {lastGenerated && (
        <div className="flex items-center space-x-2 mb-4 text-xs text-muted-foreground">
          <Icon name="Clock" size={14} color="currentColor" />
          <span>Last generated: {lastGenerated}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <Button 
          variant="default" 
          size="sm" 
          iconName="FileText" 
          iconPosition="left"
          onClick={onGenerate}
          className="flex-1"
        >
          Generate
        </Button>
        <Button 
          variant="outline" 
          size="sm" 
          iconName="Calendar" 
          iconPosition="left"
          onClick={onSchedule}
        >
          Schedule
        </Button>
      </div>
    </div>
  );
};

export default ReportCard;
import React from 'react';

import Button from '../../../components/ui/Button';

const ChartContainer = ({ title, children, onExport, onRefresh }) => {
  return (
    <div className="bg-card border border-border rounded-xl p-5 ">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-3">
        <h3 className="text-base md:text-xl font-semibold text-foreground">{title}</h3>
        <div className="flex items-center gap-2">
          {onRefresh && (
            <Button 
              variant="ghost" 
              size="sm" 
              iconName="RefreshCw" 
              onClick={onRefresh}
            />
          )}
          {onExport && (
            <Button 
              variant="outline" 
              size="sm" 
              iconName="Download" 
              iconPosition="left"
              onClick={onExport}
            >
              Export
            </Button>
          )}
        </div>
      </div>
      <div className="w-full">
        {children}
      </div>
    </div>
  );
};

export default ChartContainer;
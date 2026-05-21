import React from 'react';
import Icon from '../../../components/AppIcon';

const StatCard = ({ title, value, subtitle, icon, iconBg, iconColor, badge, downloadable, onDownload }) => (
  <div className="bg-card border border-border rounded-xl p-5 hover:shadow-md transition-all group">
    <div className="flex items-start justify-between mb-3">
      <p className="text-sm text-muted-foreground font-medium leading-snug">{title}</p>
      <div className="flex items-center gap-1.5">
        {downloadable && (
          <button
            onClick={onDownload}
            title="Download CSV"
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-muted"
          >
            <Icon name="Download" size={13} color="var(--color-muted-foreground)" />
          </button>
        )}
        <div className={`flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0 ${iconBg}`}>
          <Icon name={icon} size={20} color={iconColor} />
        </div>
      </div>
    </div>
    <div className="flex items-end gap-2">
      <h3 className="text-2xl font-bold text-foreground leading-none">{value}</h3>
      {badge && (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold mb-0.5 ${badge.className}`}>
          {badge.label}
        </span>
      )}
    </div>
    {subtitle && <p className="text-xs text-muted-foreground mt-1.5">{subtitle}</p>}
  </div>
);

export default StatCard;
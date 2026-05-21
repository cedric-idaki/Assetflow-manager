import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const ACTION_META = {
  create:            { icon: 'PlusCircle',  color: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Added' },
  update:            { icon: 'Edit2',       color: 'text-blue-600',    bg: 'bg-blue-50',    label: 'Amended' },
  delete:            { icon: 'Trash2',      color: 'text-red-600',     bg: 'bg-red-50',     label: 'Deleted' },
  login:             { icon: 'LogIn',       color: 'text-slate-600',   bg: 'bg-slate-50',   label: 'Login' },
  logout:            { icon: 'LogOut',      color: 'text-slate-600',   bg: 'bg-slate-50',   label: 'Logout' },
  approve:           { icon: 'CheckCircle', color: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Approved' },
  reject:            { icon: 'XCircle',     color: 'text-red-600',     bg: 'bg-red-50',     label: 'Rejected' },
  kyc_status_change: { icon: 'Shield',      color: 'text-orange-600',  bg: 'bg-orange-50',  label: 'KYC Change' },
};

const FILTER_OPTIONS = [
  { value: 'all',    label: 'All Activity' },
  { value: 'delete', label: 'Deletions' },
  { value: 'update', label: 'Amendments' },
  { value: 'create', label: 'Additions' },
];

const AuditTrail = ({ data, onExport }) => {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const filtered = data.filter(log => {
    if (filter !== 'all' && log.action !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (log.description || '').toLowerCase().includes(q) ||
        (log.user?.full_name || '').toLowerCase().includes(q) ||
        (log.table_name || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div>
          <h2 className="text-base font-semibold text-foreground">Audit Trail</h2>
          <p className="text-xs text-muted-foreground">Deletions · Amendments · Additions · User activity</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1">
            {FILTER_OPTIONS.map(f => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  filter === f.value
                    ? 'bg-primary text-white'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => onExport(data, 'audit_trail')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <Icon name="Download" size={13} color="currentColor" />
            Export
          </button>
        </div>
      </div>

      <div className="px-5 py-3 border-b border-border">
        <div className="relative">
          <Icon name="Search" size={14} color="var(--color-muted-foreground)" className="absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by user, action, or table..."
            className="w-full pl-8 pr-3 py-2 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <Icon name="Activity" size={28} color="currentColor" />
          <p className="text-sm mt-2">No matching activity found</p>
        </div>
      ) : (
        <div className="divide-y divide-border max-h-[480px] overflow-y-auto">
          {filtered.map(log => {
            const meta = ACTION_META[log.action] || { icon: 'Activity', color: 'text-gray-600', bg: 'bg-gray-50', label: log.action };
            return (
              <div key={log.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-muted/30 transition-colors">
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${meta.bg}`}>
                  <Icon name={meta.icon} size={14} color="currentColor" className={meta.color} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>
                      {meta.label}
                    </span>
                    <span className="text-sm font-medium text-foreground truncate">
                      {log.user?.full_name || 'System'}
                    </span>
                    {log.user?.role && (
                      <span className="text-xs text-muted-foreground capitalize bg-muted px-1.5 py-0.5 rounded">
                        {log.user.role.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                    {log.description || `${log.action} on ${log.table_name || 'unknown'}`}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleString()}
                    </span>
                    {log.table_name && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground capitalize">
                        {log.table_name.replace(/_/g, ' ')}
                      </span>
                    )}
                    {log.severity && log.severity !== 'info' && (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium capitalize ${
                        log.severity === 'critical' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {log.severity}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AuditTrail;
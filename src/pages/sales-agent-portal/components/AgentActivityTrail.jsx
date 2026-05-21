import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../contexts/AuthContext';
import Icon from '../../../components/AppIcon';

// ── Action metadata ───────────────────────────────────────────────────────────
const ACTION_META = {
  create: {
    label: 'Created',
    icon: 'Plus',
    color: 'text-emerald-600',
    bg: 'bg-emerald-100',
  },
  update: {
    label: 'Updated',
    icon: 'Edit2',
    color: 'text-blue-600',
    bg: 'bg-blue-100',
  },
  user_created: {
    label: 'Client Created',
    icon: 'UserPlus',
    color: 'text-purple-600',
    bg: 'bg-purple-100',
  },
  login: {
    label: 'Login',
    icon: 'LogIn',
    color: 'text-gray-600',
    bg: 'bg-gray-100',
  },
  logout: {
    label: 'Logout',
    icon: 'LogOut',
    color: 'text-gray-500',
    bg: 'bg-gray-100',
  },
};

const getActionMeta = (action) =>
  ACTION_META[action] || { label: action, icon: 'Activity', color: 'text-gray-600', bg: 'bg-gray-100' };

const fmt = (d) =>
  new Date(d).toLocaleString('en-KE', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

const getTableLabel = (tableName) => {
  const map = {
    leads:         'Lead',
    clients:       'Client',
    agent_wallets: 'Commission',
    sales_expenses:'Expense',
    user_profiles: 'User',
    agents:        'Agent Profile',
    audit_logs:    'System',
  };
  return map[tableName] || tableName;
};

// ── Main Component ────────────────────────────────────────────────────────────
const AgentActivityTrail = () => {
  const { user } = useAuth();
  const [logs, setLogs]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState('all');
  const [search, setSearch]     = useState('');
  const [expanded, setExpanded] = useState(null);

  const fetchLogs = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setLogs(data || []);
    } catch (err) {
      console.error('AgentActivityTrail fetch error:', err?.message);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // Realtime subscription
  useEffect(() => {
    if (!user?.id) return;
    const ch = supabase
      .channel(`agent_audit_${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'audit_logs',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        setLogs(prev => [payload.new, ...prev].slice(0, 100));
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [user?.id]);

  // Filter + search
  const filtered = logs.filter(log => {
    const matchFilter = filter === 'all' || log.action === filter || log.table_name === filter;
    const matchSearch = !search ||
      log.description?.toLowerCase().includes(search.toLowerCase()) ||
      log.table_name?.toLowerCase().includes(search.toLowerCase()) ||
      log.action?.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  // Stats
  const stats = {
    total:    logs.length,
    leads:    logs.filter(l => l.table_name === 'leads').length,
    clients:  logs.filter(l => l.action === 'user_created' || l.table_name === 'clients').length,
    commissions: logs.filter(l => l.table_name === 'agent_wallets').length,
  };

  // Group by date
  const grouped = filtered.reduce((acc, log) => {
    const date = new Date(log.created_at).toLocaleDateString('en-KE', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    if (!acc[date]) acc[date] = [];
    acc[date].push(log);
    return acc;
  }, {});

  return (
    <div className="space-y-5">

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Actions',  value: stats.total,       icon: 'Activity',  color: 'text-blue-600',    bg: 'bg-blue-50' },
          { label: 'Lead Activities',value: stats.leads,       icon: 'Target',    color: 'text-amber-600',   bg: 'bg-amber-50' },
          { label: 'Clients Created',value: stats.clients,     icon: 'UserPlus',  color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Commission Logs',value: stats.commissions, icon: 'Award',     color: 'text-purple-600',  bg: 'bg-purple-50' },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-5 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center flex-shrink-0`}>
              <Icon name={s.icon} size={16} color="currentColor" className={s.color} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Icon name="Search" size={14} color="#9ca3af" className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search activity..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 bg-background"
            />
          </div>
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="text-sm border border-border rounded-xl px-3 py-2 focus:outline-none bg-background"
          >
            <option value="all">All Activity</option>
            <option value="leads">Leads</option>
            <option value="clients">Clients</option>
            <option value="create">Created</option>
            <option value="update">Updated</option>
            <option value="agent_wallets">Commission</option>
            <option value="sales_expenses">Expenses</option>
          </select>
          <button
            onClick={fetchLogs}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-border rounded-xl hover:bg-muted transition-colors"
          >
            <Icon name="RefreshCw" size={14} color="currentColor" />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Activity Log ── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">Activity History</h3>
          <span className="text-xs text-muted-foreground">{filtered.length} of {logs.length} entries</span>
        </div>

        {loading ? (
          <div className="p-8 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 animate-pulse">
                <div className="w-8 h-8 rounded-full bg-muted flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 bg-muted rounded w-3/4" />
                  <div className="h-2.5 bg-muted rounded w-1/2" />
                </div>
                <div className="h-3 bg-muted rounded w-20" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Icon name="Activity" size={36} color="currentColor" />
            <p className="mt-3 text-sm font-medium">No activity found</p>
            <p className="text-xs mt-1 opacity-60">
              {search || filter !== 'all' ? 'Try changing your filters' : 'Your actions will appear here'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {Object.entries(grouped).map(([date, entries]) => (
              <div key={date}>
                {/* Date group header */}
                <div className="px-5 py-2.5 bg-muted/30 border-b border-border">
                  <span className="text-xs font-semibold text-muted-foreground">{date}</span>
                </div>

                {entries.map(log => {
                  const meta     = getActionMeta(log.action);
                  const isOpen   = expanded === log.id;
                  const hasExtra = log.new_values || log.old_values;

                  return (
                    <div
                      key={log.id}
                      className={`px-5 py-3.5 hover:bg-muted/20 transition-colors ${hasExtra ? 'cursor-pointer' : ''}`}
                      onClick={() => hasExtra && setExpanded(isOpen ? null : log.id)}
                    >
                      <div className="flex items-start gap-3">
                        {/* Icon */}
                        <div className={`w-8 h-8 rounded-full ${meta.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                          <Icon name={meta.icon} size={14} color="currentColor" className={meta.color} />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>
                              {meta.label}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {getTableLabel(log.table_name)}
                            </span>
                          </div>
                          <p className="text-sm text-foreground mt-0.5 leading-snug">
                            {log.description || `${meta.label} ${getTableLabel(log.table_name)}`}
                          </p>

                          {/* Expanded details */}
                          {isOpen && hasExtra && (
                            <div className="mt-2 p-3 bg-muted/40 rounded-lg text-xs font-mono text-muted-foreground overflow-x-auto">
                              {log.new_values && (
                                <div>
                                  <span className="font-semibold text-emerald-600 not-mono" style={{ fontFamily: 'inherit' }}>Details: </span>
                                  {Object.entries(log.new_values).map(([k, v]) => (
                                    <div key={k} className="ml-2">
                                      <span className="text-foreground">{k}:</span> {String(v)}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Time + expand */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(log.created_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {hasExtra && (
                            <Icon
                              name={isOpen ? 'ChevronUp' : 'ChevronDown'}
                              size={14}
                              color="var(--color-muted-foreground)"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentActivityTrail;

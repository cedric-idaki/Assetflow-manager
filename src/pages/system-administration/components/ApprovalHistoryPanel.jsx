import React, { useState, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { supabase } from '../../../lib/supabase';
import { ACTION_TYPE_CONFIG, STATUS_CONFIG } from './ApprovalActionCard';

const ApprovalHistoryPanel = () => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const PAGE_SIZE = 10;

  useEffect(() => {
    fetchHistory();
  }, [page, filterStatus, filterType]);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      let query = supabase?.from('maker_checker_queue')?.select('*', { count: 'exact' })?.not('status', 'eq', 'pending')?.order('updated_at', { ascending: false })?.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (filterStatus !== 'all') query = query?.eq('status', filterStatus);
      if (filterType !== 'all') query = query?.eq('action_type', filterType);

      const { data, error, count } = await query;
      if (error) throw error;
      setHistory(data || []);
      setTotalCount(count || 0);
    } catch (err) {
      setError(err?.message);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr)?.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
  };

  const filteredHistory = history?.filter(item =>
    !searchQuery ||
    item?.title?.toLowerCase()?.includes(searchQuery?.toLowerCase()) ||
    item?.initiator_name?.toLowerCase()?.includes(searchQuery?.toLowerCase()) ||
    item?.checker_name?.toLowerCase()?.includes(searchQuery?.toLowerCase())
  );

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-foreground">Approval History</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{totalCount} total resolved actions</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { setPage(0); fetchHistory(); }} icon="RefreshCw">
          <Icon name="RefreshCw" size={14} className="mr-1" /> Refresh
        </Button>
      </div>
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Icon name="Search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search history..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e?.target?.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e?.target?.value); setPage(0); }}
          className="px-3 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="all">All Status</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="escalated">Escalated</option>
          <option value="expired">Expired</option>
        </select>
        <select
          value={filterType}
          onChange={(e) => { setFilterType(e?.target?.value); setPage(0); }}
          className="px-3 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="all">All Types</option>
          <option value="payment_split_change">Payment Split</option>
          <option value="debt_adjustment">Debt Adjustment</option>
          <option value="commission_override">Commission Override</option>
          <option value="role_change">Role Change</option>
          <option value="high_value_transaction">High Value Txn</option>
          <option value="kyc_approval">KYC Approval</option>
          <option value="user_creation">User Creation</option>
          <option value="asset_deletion">Asset Deletion</option>
          <option value="payment_refund">Payment Refund</option>
        </select>
      </div>
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-500">{error}</div>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Icon name="Loader2" size={20} className="animate-spin text-primary" />
          <span className="ml-2 text-sm text-muted-foreground">Loading history...</span>
        </div>
      ) : filteredHistory?.length === 0 ? (
        <div className="text-center py-10">
          <Icon name="History" size={32} className="text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No history records found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredHistory?.map((item) => {
            const typeConfig = ACTION_TYPE_CONFIG?.[item?.action_type] || ACTION_TYPE_CONFIG?.system_config;
            const statusConfig = STATUS_CONFIG?.[item?.status] || STATUS_CONFIG?.pending;
            return (
              <div key={item?.id} className="bg-card border border-border rounded-xl p-5 flex items-start gap-3">
                <div className={`w-9 h-9 rounded-xl ${typeConfig?.bg} flex items-center justify-center flex-shrink-0`}>
                  <Icon name={typeConfig?.icon} size={16} className={typeConfig?.color} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${statusConfig?.class}`}>
                      <Icon name={statusConfig?.icon} size={10} /> {statusConfig?.label}
                    </span>
                    <span className="text-xs text-muted-foreground">{typeConfig?.label}</span>
                  </div>
                  <p className="text-sm font-medium text-foreground leading-snug">{item?.title}</p>
                  <div className="flex flex-wrap gap-3 mt-1.5">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Icon name="User" size={10} /> Maker: {item?.initiator_name}
                    </span>
                    {item?.checker_name && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Icon name="UserCheck" size={10} /> Checker: {item?.checker_name}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Icon name="Calendar" size={10} /> {formatDate(item?.resolved_at || item?.updated_at)}
                    </span>
                  </div>
                  {item?.checker_comment && (
                    <p className="text-xs text-muted-foreground mt-1 italic">"{item?.checker_comment}"</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages} · {totalCount} records
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} icon="ChevronLeft">
              <Icon name="ChevronLeft" size={14} />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} icon="ChevronRight">
              <Icon name="ChevronRight" size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ApprovalHistoryPanel;

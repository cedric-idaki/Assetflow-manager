import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { supabase } from '../../../lib/supabase';
import ApprovalActionCard from './ApprovalActionCard';
import ApprovalThresholdConfig from './ApprovalThresholdConfig';
import ApprovalHistoryPanel from './ApprovalHistoryPanel';
import RealtimeStatusBar from '../../../components/ui/RealtimeStatusBar';
import LivePulseWidget from '../../../components/ui/LivePulseWidget';

let _makerCheckerChannelSeq = 0;

const TABS = [
  { id: 'queue', label: 'Pending Queue', icon: 'Clock' },
  { id: 'history', label: 'Approval History', icon: 'History' },
  { id: 'thresholds', label: 'Thresholds', icon: 'SlidersHorizontal' },
];

const FILTER_OPTIONS = [
  { value: 'all', label: 'All Actions' },
  { value: 'payment_split_change', label: 'Payment Split' },
  { value: 'debt_adjustment', label: 'Debt Adjustment' },
  { value: 'commission_override', label: 'Commission Override' },
  { value: 'role_change', label: 'Role Change' },
  { value: 'high_value_transaction', label: 'High Value Txn' },
  { value: 'kyc_approval', label: 'KYC Approval' },
  { value: 'user_creation', label: 'User Creation' },
  { value: 'asset_deletion', label: 'Asset Deletion' },
  { value: 'payment_refund', label: 'Payment Refund' },
];

const MakerCheckerTab = ({ onBadgeCountChange }) => {
  const [activeTab, setActiveTab] = useState('queue');
  const [queueItems, setQueueItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [selectedIds, setSelectedIds] = useState([]);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [processingId, setProcessingId] = useState(null);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkComment, setBulkComment] = useState('');
  const [bulkCommentError, setBulkCommentError] = useState('');
  const [showBulkPanel, setShowBulkPanel] = useState(false);
  const [toast, setToast] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [queueLastUpdated, setQueueLastUpdated] = useState(null);

  useEffect(() => {
    fetchQueue();
    const channel = supabase
      ?.channel(`maker_checker_realtime_${++_makerCheckerChannelSeq}`)
      ?.on('postgres_changes', { event: '*', schema: 'public', table: 'maker_checker_queue' }, (payload) => {
        setSyncing(true);
        fetchQueue()?.finally(() => setSyncing(false));
      })
      ?.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected');
          setLastUpdated(new Date());
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnectionStatus('disconnected');
        if (status === 'CLOSED') setConnectionStatus('connecting');
      });
    return () => supabase?.removeChannel(channel);
  }, []);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        ?.from('maker_checker_queue')
        ?.select('*')
        ?.in('status', ['pending', 'escalated'])
        ?.order('priority', { ascending: false })
        ?.order('created_at', { ascending: true });
      if (error) throw error;
      setQueueItems(data || []);
      const count = (data || [])?.length;
      setPendingCount(count);
      onBadgeCountChange?.(count);
      setQueueLastUpdated(new Date());
      setLastUpdated(new Date());
    } catch (err) {
      setError(err?.message);
    } finally {
      setLoading(false);
    }
  }, [onBadgeCountChange]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const sendNotification = async (item, status, checkerComment) => {
    try {
      await supabase?.functions?.invoke('maker-checker-notify', {
        body: {
          action_id: item?.id,
          action_type: item?.action_type,
          title: item?.title,
          description: item?.description,
          initiator_name: item?.initiator_name,
          initiator_email: item?.initiator_email || null,
          initiator_phone: item?.initiator_phone || null,
          checker_name: 'System Checker',
          status,
          checker_comment: checkerComment,
          affected_entity: item?.affected_entity,
        },
      });
    } catch (err) {
      console.warn('Notification failed:', err?.message);
    }
  };

  const handleApprove = async (id, comment) => {
    setProcessingId(id);
    try {
      const item = queueItems?.find(q => q?.id === id);
      const { error } = await supabase?.from('maker_checker_queue')?.update({
          status: 'approved',
          checker_comment: comment,
          checker_name: 'Current User',
          resolved_at: new Date()?.toISOString(),
          notification_sent: true,
        })?.eq('id', id);
      if (error) throw error;
      if (item) await sendNotification(item, 'approved', comment);
      showToast('Action approved successfully');
      await fetchQueue();
    } catch (err) {
      showToast(err?.message, 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (id, comment) => {
    setProcessingId(id);
    try {
      const item = queueItems?.find(q => q?.id === id);
      const { error } = await supabase?.from('maker_checker_queue')?.update({
          status: 'rejected',
          checker_comment: comment,
          checker_name: 'Current User',
          resolved_at: new Date()?.toISOString(),
          notification_sent: true,
        })?.eq('id', id);
      if (error) throw error;
      if (item) await sendNotification(item, 'rejected', comment);
      showToast('Action rejected', 'warning');
      await fetchQueue();
    } catch (err) {
      showToast(err?.message, 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleEscalate = async (id, comment) => {
    setProcessingId(id);
    try {
      const { error } = await supabase?.from('maker_checker_queue')?.update({
          status: 'escalated',
          escalation_reason: comment,
          escalated_at: new Date()?.toISOString(),
        })?.eq('id', id);
      if (error) throw error;
      showToast('Action escalated for senior review', 'warning');
      await fetchQueue();
    } catch (err) {
      showToast(err?.message, 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleBulkApprove = async () => {
    if (!bulkComment?.trim()) {
      setBulkCommentError('Comment is required for bulk approval.');
      return;
    }
    setBulkProcessing(true);
    try {
      const { error } = await supabase?.from('maker_checker_queue')?.update({
          status: 'approved',
          checker_comment: bulkComment,
          checker_name: 'Current User',
          resolved_at: new Date()?.toISOString(),
          notification_sent: true,
        })?.in('id', selectedIds);
      if (error) throw error;
      showToast(`${selectedIds?.length} actions approved successfully`);
      setSelectedIds([]);
      setIsBulkMode(false);
      setShowBulkPanel(false);
      setBulkComment('');
      await fetchQueue();
    } catch (err) {
      showToast(err?.message, 'error');
    } finally {
      setBulkProcessing(false);
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => prev?.includes(id) ? prev?.filter(i => i !== id) : [...prev, id]);
  };

  const filteredItems = queueItems?.filter(item => {
    const matchesType = filterType === 'all' || item?.action_type === filterType;
    const matchesPriority = filterPriority === 'all' || item?.priority === filterPriority;
    const matchesSearch = !searchQuery ||
      item?.title?.toLowerCase()?.includes(searchQuery?.toLowerCase()) ||
      item?.description?.toLowerCase()?.includes(searchQuery?.toLowerCase()) ||
      item?.initiator_name?.toLowerCase()?.includes(searchQuery?.toLowerCase()) ||
      item?.affected_entity?.toLowerCase()?.includes(searchQuery?.toLowerCase());
    return matchesType && matchesPriority && matchesSearch;
  });

  const selectAllBulkEligible = () => {
    const eligible = filteredItems?.filter(i => i?.is_bulk_eligible)?.map(i => i?.id);
    setSelectedIds(eligible);
  };

  const criticalCount = queueItems?.filter(i => i?.priority === 'critical')?.length;
  const escalatedCount = queueItems?.filter(i => i?.status === 'escalated')?.length;
  const bulkEligibleCount = filteredItems?.filter(i => i?.is_bulk_eligible)?.length;

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[300] flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
          toast?.type === 'error' ? 'bg-red-500 text-white' :
          toast?.type === 'warning' ? 'bg-orange-500 text-white' : 'bg-green-600 text-white'
        }`}>
          <Icon name={toast?.type === 'error' ? 'XCircle' : toast?.type === 'warning' ? 'AlertTriangle' : 'CheckCircle'} size={16} />
          {toast?.message}
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-heading font-semibold text-foreground flex items-center gap-2">
            Maker-Checker Queue
            {pendingCount > 0 && (
              <span className="inline-flex items-center justify-center w-6 h-6 text-xs font-bold rounded-full bg-red-500 text-white">
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Dual approval workflow for sensitive system actions</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {criticalCount > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs font-semibold text-red-500">{criticalCount} Critical</span>
            </div>
          )}
          {escalatedCount > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/10 border border-orange-500/20 rounded-lg">
              <Icon name="ArrowUpCircle" size={14} className="text-orange-500" />
              <span className="text-xs font-semibold text-orange-500">{escalatedCount} Escalated</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <Icon name="Clock" size={14} className="text-yellow-600" />
            <span className="text-xs font-semibold text-yellow-600">{pendingCount} Pending</span>
          </div>
        </div>
      </div>

      {/* Real-time Status Bar */}
      <RealtimeStatusBar
        connectionStatus={connectionStatus}
        lastUpdated={lastUpdated}
        syncing={syncing}
        label="Approval Queue"
      />

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-muted/50 rounded-xl p-1">
        {TABS?.map(tab => (
          <button
            key={tab?.id}
            onClick={() => setActiveTab(tab?.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all flex-1 justify-center ${
              activeTab === tab?.id
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon name={tab?.icon} size={15} />
            <span className="hidden sm:inline">{tab?.label}</span>
            {tab?.id === 'queue' && pendingCount > 0 && (
              <span className="w-4 h-4 text-xs font-bold rounded-full bg-red-500 text-white flex items-center justify-center">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>
      {/* Queue Tab */}
      {activeTab === 'queue' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Icon name="Search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search actions, entities, makers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e?.target?.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e?.target?.value)}
              className="px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {FILTER_OPTIONS?.map(opt => (
                <option key={opt?.value} value={opt?.value}>{opt?.label}</option>
              ))}
            </select>
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e?.target?.value)}
              className="px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">All Priority</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            {bulkEligibleCount > 0 && (
              <Button
                variant={isBulkMode ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setIsBulkMode(!isBulkMode); setSelectedIds([]); setShowBulkPanel(false); }}
                icon={<Icon name="CheckSquare" size={14} />}
              >
                Bulk Mode {isBulkMode ? 'ON' : `(${bulkEligibleCount})`}
              </Button>
            )}
          </div>

          {/* Bulk action bar */}
          {isBulkMode && (
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-5 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-foreground">
                  {selectedIds?.length} selected
                </span>
                <Button variant="outline" size="sm" onClick={selectAllBulkEligible}>
                  Select All Eligible ({bulkEligibleCount})
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSelectedIds([])}>
                  Clear
                </Button>
                {selectedIds?.length > 0 && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => setShowBulkPanel(!showBulkPanel)}
                    className="bg-green-600 hover:bg-green-700 text-white border-0"
                    icon={<Icon name="CheckCircle" size={14} />}
                  >
                    Bulk Approve ({selectedIds?.length})
                  </Button>
                )}
              </div>
              {showBulkPanel && (
                <div className="space-y-2 pt-2 border-t border-primary/20">
                  <label className="block text-xs font-medium text-foreground">
                    Bulk Approval Comment <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={bulkComment}
                    onChange={(e) => { setBulkComment(e?.target?.value); setBulkCommentError(''); }}
                    placeholder="Add comment for all selected approvals..."
                    className={`w-full min-h-[70px] px-3 py-2 text-sm border rounded-lg bg-background text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring ${
                      bulkCommentError ? 'border-red-500' : 'border-border'
                    }`}
                  />
                  {bulkCommentError && <p className="text-xs text-red-500">{bulkCommentError}</p>}
                  <div className="flex gap-2">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleBulkApprove}
                      disabled={bulkProcessing}
                      className="bg-green-600 hover:bg-green-700 text-white border-0"
                      icon={bulkProcessing ? <Icon name="Loader2" size={14} className="animate-spin" /> : undefined}
                    >
                      Confirm Bulk Approval
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setShowBulkPanel(false)}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-500 flex items-center gap-2">
              <Icon name="AlertCircle" size={16} />
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Icon name="Loader2" size={24} className="animate-spin text-primary" />
              <span className="ml-2 text-muted-foreground">Loading queue...</span>
            </div>
          ) : filteredItems?.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-xl bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                <Icon name="CheckCircle" size={32} className="text-green-500" />
              </div>
              <h3 className="font-semibold text-foreground mb-1">Queue is Clear</h3>
              <p className="text-sm text-muted-foreground">
                {searchQuery || filterType !== 'all' || filterPriority !== 'all' ? 'No items match your current filters.' : 'All pending actions have been reviewed. Great work!'}
              </p>
            </div>
          ) : (
            <LivePulseWidget lastUpdated={queueLastUpdated} syncing={syncing} label="Queue Items">
              <div className="space-y-3">
                {filteredItems?.map(item => (
                  <ApprovalActionCard
                    key={item?.id}
                    item={item}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onEscalate={handleEscalate}
                    isSelected={selectedIds?.includes(item?.id)}
                    onSelect={toggleSelect}
                    isBulkMode={isBulkMode && item?.is_bulk_eligible}
                    isProcessing={processingId === item?.id}
                  />
                ))}
              </div>
            </LivePulseWidget>
          )}
        </div>
      )}
      {/* History Tab */}
      {activeTab === 'history' && <ApprovalHistoryPanel />}
      {/* Thresholds Tab */}
      {activeTab === 'thresholds' && <ApprovalThresholdConfig />}
    </div>
  );
};

export default MakerCheckerTab;
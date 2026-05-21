import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

const ACTION_TYPE_CONFIG = {
  payment_split_change: { icon: 'GitBranch', color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'Payment Split Change' },
  debt_adjustment: { icon: 'TrendingDown', color: 'text-orange-500', bg: 'bg-orange-500/10', label: 'Debt Adjustment' },
  commission_override: { icon: 'DollarSign', color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: 'Commission Override' },
  role_change: { icon: 'Shield', color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'Role Change' },
  high_value_transaction: { icon: 'AlertTriangle', color: 'text-red-500', bg: 'bg-red-500/10', label: 'High Value Transaction' },
  kyc_approval: { icon: 'UserCheck', color: 'text-green-500', bg: 'bg-green-500/10', label: 'KYC Approval' },
  user_creation: { icon: 'UserPlus', color: 'text-teal-500', bg: 'bg-teal-500/10', label: 'User Creation' },
  asset_deletion: { icon: 'Trash2', color: 'text-red-600', bg: 'bg-red-600/10', label: 'Asset Deletion' },
  payment_refund: { icon: 'RotateCcw', color: 'text-orange-500', bg: 'bg-orange-500/10', label: 'Payment Refund' },
  system_config: { icon: 'Settings', color: 'text-gray-500', bg: 'bg-gray-500/10', label: 'System Config' },
};

const PRIORITY_CONFIG = {
  critical: { label: 'Critical', class: 'bg-red-500/10 text-red-500 border border-red-500/20' },
  high: { label: 'High', class: 'bg-orange-500/10 text-orange-500 border border-orange-500/20' },
  medium: { label: 'Medium', class: 'bg-yellow-500/10 text-yellow-600 border border-yellow-500/20' },
  low: { label: 'Low', class: 'bg-muted text-muted-foreground border border-border' },
};

const STATUS_CONFIG = {
  pending: { label: 'Pending', class: 'bg-yellow-500/10 text-yellow-600', icon: 'Clock' },
  approved: { label: 'Approved', class: 'bg-green-500/10 text-green-600', icon: 'CheckCircle' },
  rejected: { label: 'Rejected', class: 'bg-red-500/10 text-red-500', icon: 'XCircle' },
  escalated: { label: 'Escalated', class: 'bg-orange-500/10 text-orange-500', icon: 'ArrowUpCircle' },
  expired: { label: 'Expired', class: 'bg-muted text-muted-foreground', icon: 'Clock' },
};

const ApprovalActionCard = ({ item, onApprove, onReject, onEscalate, isSelected, onSelect, isBulkMode, isProcessing }) => {
  const [expanded, setExpanded] = useState(false);
  const [showActionPanel, setShowActionPanel] = useState(false);
  const [comment, setComment] = useState('');
  const [actionType, setActionType] = useState(null);
  const [commentError, setCommentError] = useState('');

  const typeConfig = ACTION_TYPE_CONFIG?.[item?.action_type] || ACTION_TYPE_CONFIG?.system_config;
  const priorityConfig = PRIORITY_CONFIG?.[item?.priority] || PRIORITY_CONFIG?.medium;
  const statusConfig = STATUS_CONFIG?.[item?.status] || STATUS_CONFIG?.pending;

  const isPending = item?.status === 'pending' || item?.status === 'escalated';

  const getTimeAgo = (dateStr) => {
    if (!dateStr) return 'Unknown';
    const diff = Date.now() - new Date(dateStr)?.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    return `${mins}m ago`;
  };

  const getDueStatus = (dueAt) => {
    if (!dueAt) return null;
    const diff = new Date(dueAt)?.getTime() - Date.now();
    const hours = Math.floor(diff / 3600000);
    if (diff < 0) return { label: 'Overdue', class: 'text-red-500' };
    if (hours < 6) return { label: `Due in ${hours}h`, class: 'text-red-500' };
    if (hours < 24) return { label: `Due in ${hours}h`, class: 'text-orange-500' };
    return { label: `Due in ${Math.floor(hours / 24)}d`, class: 'text-muted-foreground' };
  };

  const dueStatus = getDueStatus(item?.due_at);

  const handleActionClick = (type) => {
    setActionType(type);
    setShowActionPanel(true);
    setComment('');
    setCommentError('');
  };

  const handleSubmitAction = () => {
    if (!comment?.trim()) {
      setCommentError('Comment is required before approving or rejecting.');
      return;
    }
    if (actionType === 'approve') onApprove(item?.id, comment);
    else if (actionType === 'reject') onReject(item?.id, comment);
    else if (actionType === 'escalate') onEscalate(item?.id, comment);
    setShowActionPanel(false);
    setComment('');
    setActionType(null);
  };

  const changeDetails = item?.change_details || {};

  return (
    <div className={`bg-card rounded-xl border transition-all duration-200 ${
      isSelected ? 'border-primary shadow-md shadow-primary/10' : 'border-border hover:border-border/80 hover:shadow-sm'
    } ${item?.priority === 'critical' ? 'border-l-4 border-l-red-500' : item?.priority === 'high' ? 'border-l-4 border-l-orange-500' : ''}`}>
      {/* Header */}
      <div className="p-4 md:p-5">
        <div className="flex items-start gap-3">
          {isBulkMode && isPending && (
            <div className="flex-shrink-0 pt-0.5">
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onSelect(item?.id)}
                className="w-4 h-4 rounded border-border text-primary cursor-pointer"
              />
            </div>
          )}

          <div className={`w-10 h-10 rounded-lg ${typeConfig?.bg} flex items-center justify-center flex-shrink-0`}>
            <Icon name={typeConfig?.icon} size={20} className={typeConfig?.color} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${priorityConfig?.class}`}>
                {priorityConfig?.label}
              </span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${statusConfig?.class}`}>
                <Icon name={statusConfig?.icon} size={11} />
                {statusConfig?.label}
              </span>
              {item?.is_bulk_eligible && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20">
                  Bulk OK
                </span>
              )}
              {item?.status === 'escalated' && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-500 border border-orange-500/20 flex items-center gap-1">
                  <Icon name="ArrowUp" size={10} /> Escalated
                </span>
              )}
            </div>

            <h3 className="font-semibold text-foreground text-sm leading-snug mb-1">{item?.title}</h3>
            <p className="text-xs text-muted-foreground line-clamp-2">{item?.description}</p>

            <div className="flex flex-wrap items-center gap-3 mt-2">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Icon name="User" size={11} />
                {item?.initiator_name} &middot; {item?.initiator_role}
              </span>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Icon name="Clock" size={11} />
                {getTimeAgo(item?.created_at)}
              </span>
              {item?.affected_entity && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Icon name="Tag" size={11} />
                  {item?.affected_entity}
                </span>
              )}
              {dueStatus && (
                <span className={`text-xs font-medium flex items-center gap-1 ${dueStatus?.class}`}>
                  <Icon name="AlertCircle" size={11} />
                  {dueStatus?.label}
                </span>
              )}
            </div>
          </div>

          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors flex-shrink-0"
          >
            <Icon name={expanded ? 'ChevronUp' : 'ChevronDown'} size={16} className="text-muted-foreground" />
          </button>
        </div>

        {/* Action buttons for pending items */}
        {isPending && !isBulkMode && (
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border">
            <Button
              variant="default"
              size="sm"
              onClick={() => handleActionClick('approve')}
              disabled={isProcessing}
              className="bg-green-600 hover:bg-green-700 text-white border-0"
              icon={<Icon name="Check" size={14} />}
            >
              Approve
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => handleActionClick('reject')}
              disabled={isProcessing}
              icon={<Icon name="X" size={14} />}
            >
              Reject
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleActionClick('escalate')}
              disabled={isProcessing}
              icon={<Icon name="ArrowUpCircle" size={14} />}
            >
              Escalate
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              icon={<Icon name="Eye" size={14} />}
            >
              Details
            </Button>
          </div>
        )}

        {/* Resolved info */}
        {item?.status === 'approved' && item?.checker_name && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
            <Icon name="CheckCircle" size={14} className="text-green-500" />
            <span className="text-xs text-green-600">Approved by {item?.checker_name}</span>
            {item?.checker_comment && <span className="text-xs text-muted-foreground">&middot; &quot;{item?.checker_comment}&quot;</span>}
          </div>
        )}
        {item?.status === 'rejected' && item?.checker_name && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center gap-2">
              <Icon name="XCircle" size={14} className="text-red-500" />
              <span className="text-xs text-red-500">Rejected by {item?.checker_name}</span>
            </div>
            {item?.checker_comment && <p className="text-xs text-muted-foreground mt-1 pl-5">{item?.checker_comment}</p>}
          </div>
        )}
      </div>
      {/* Expanded change details */}
      {expanded && (
        <div className="px-4 md:px-5 pb-4 border-t border-border">
          <div className="pt-4 space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Change Details</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(changeDetails)?.map(([key, value]) => (
                <div key={key} className="bg-muted/50 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground capitalize mb-1">{key?.replace(/_/g, ' ')}</p>
                  <p className="text-sm font-medium text-foreground">
                    {Array.isArray(value) ? value?.join(', ') : String(value)}
                  </p>
                </div>
              ))}
            </div>
            {item?.escalation_reason && (
              <div className="bg-orange-500/5 border border-orange-500/20 rounded-lg p-3">
                <p className="text-xs font-medium text-orange-500 mb-1">Escalation Reason</p>
                <p className="text-sm text-foreground">{item?.escalation_reason}</p>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Action panel with comment */}
      {showActionPanel && (
        <div className="px-4 md:px-5 pb-4 border-t border-border">
          <div className="pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                actionType === 'approve' ? 'bg-green-500' : actionType === 'reject' ? 'bg-red-500' : 'bg-orange-500'
              }`} />
              <h4 className="text-sm font-semibold text-foreground capitalize">
                {actionType === 'approve' ? 'Approve Action' : actionType === 'reject' ? 'Reject Action' : 'Escalate Action'}
              </h4>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">
                Comment <span className="text-red-500">*</span> <span className="text-muted-foreground font-normal">(required)</span>
              </label>
              <textarea
                value={comment}
                onChange={(e) => { setComment(e?.target?.value); setCommentError(''); }}
                placeholder={`Add your ${actionType} reason or notes...`}
                className={`w-full min-h-[80px] px-3 py-2 text-sm border rounded-lg bg-background text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                  commentError ? 'border-red-500 focus:ring-red-500/20' : 'border-border'
                }`}
              />
              {commentError && <p className="text-xs text-red-500 mt-1">{commentError}</p>}
            </div>
            <div className="flex gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={handleSubmitAction}
                disabled={isProcessing}
                className={actionType === 'approve' ? 'bg-green-600 hover:bg-green-700 text-white border-0' : ''}
                icon={isProcessing ? <Icon name="Loader2" size={14} className="animate-spin" /> : null}
              >
                Confirm {actionType === 'approve' ? 'Approval' : actionType === 'reject' ? 'Rejection' : 'Escalation'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowActionPanel(false)} icon={null}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ApprovalActionCard;
export { ACTION_TYPE_CONFIG, PRIORITY_CONFIG, STATUS_CONFIG };

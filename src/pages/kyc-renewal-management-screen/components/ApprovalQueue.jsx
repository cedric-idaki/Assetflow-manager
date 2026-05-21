import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { RenewalStatusBadge } from './RenewalStatusBadge';

const ApprovalQueue = ({ renewals, onApprove, onReject, onRequestInfo, currentUser }) => {
  const [selectedIds, setSelectedIds] = useState([]);
  const [reviewingId, setReviewingId] = useState(null);
  const [comment, setComment] = useState('');
  const [actionType, setActionType] = useState(null); // 'approve' | 'reject' | 'info'
  const [processing, setProcessing] = useState(false);

  const pendingRenewals = renewals?.filter(r => r?.status === 'submitted' || r?.status === 'under_review');

  const toggleSelect = (id) => {
    setSelectedIds(prev =>
      prev?.includes(id) ? prev?.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds?.length === pendingRenewals?.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(pendingRenewals?.map(r => r?.id));
    }
  };

  const handleAction = async (type, id) => {
    setReviewingId(id);
    setActionType(type);
    setComment('');
  };

  const handleConfirmAction = async () => {
    if (!reviewingId || !actionType) return;
    setProcessing(true);
    await new Promise(r => setTimeout(r, 600));
    if (actionType === 'approve') onApprove?.(reviewingId, comment);
    else if (actionType === 'reject') onReject?.(reviewingId, comment);
    else if (actionType === 'info') onRequestInfo?.(reviewingId, comment);
    setReviewingId(null);
    setActionType(null);
    setComment('');
    setProcessing(false);
  };

  const handleBulkApprove = async () => {
    if (selectedIds?.length === 0) return;
    setProcessing(true);
    await new Promise(r => setTimeout(r, 800));
    selectedIds?.forEach(id => onApprove?.(id, 'Bulk approved'));
    setSelectedIds([]);
    setProcessing(false);
  };

  const actionLabels = { approve: 'Approve', reject: 'Reject', info: 'Request Info' };
  const actionColors = {
    approve: 'bg-green-600 hover:bg-green-700 text-white',
    reject: 'bg-red-600 hover:bg-red-700 text-white',
    info: 'bg-blue-600 hover:bg-blue-700 text-white',
  };

  return (
    <div className="space-y-4">
      {/* Header + Bulk Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Approval Queue</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{pendingRenewals?.length} pending review</p>
        </div>
        {selectedIds?.length > 0 && (
          <button
            onClick={handleBulkApprove}
            disabled={processing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-smooth"
          >
            <Icon name="CheckCheck" size={13} color="currentColor" />
            Approve {selectedIds?.length} Selected
          </button>
        )}
      </div>
      {/* Select All */}
      {pendingRenewals?.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={selectedIds?.length === pendingRenewals?.length && pendingRenewals?.length > 0}
            onChange={toggleSelectAll}
            className="rounded border-border"
          />
          Select all ({pendingRenewals?.length})
        </label>
      )}
      {/* Queue Items */}
      {pendingRenewals?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <Icon name="CheckCircle2" size={32} color="#22c55e" />
          <p className="mt-2 text-sm font-medium text-foreground">All caught up!</p>
          <p className="text-xs">No pending approvals</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pendingRenewals?.map(renewal => (
            <div key={renewal?.id} className="border border-border rounded-xl p-5 bg-card space-y-3">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedIds?.includes(renewal?.id)}
                  onChange={() => toggleSelect(renewal?.id)}
                  className="mt-1 rounded border-border"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{renewal?.clientName}</p>
                    <RenewalStatusBadge status={renewal?.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">{renewal?.clientId} · {renewal?.documentType}</p>
                  <p className="text-xs text-muted-foreground mt-1">Submitted: {new Date(renewal?.submittedAt || renewal?.createdAt)?.toLocaleDateString('en-KE')}</p>
                </div>
              </div>

              {/* Document Preview */}
              {renewal?.newDocUrl && (
                <div className="rounded-lg overflow-hidden border border-border bg-muted h-24">
                  <img src={renewal?.newDocUrl} alt="Submitted document" className="w-full h-full object-contain" />
                </div>
              )}

              {/* Action Buttons */}
              {reviewingId === renewal?.id ? (
                <div className="space-y-2">
                  <textarea
                    value={comment}
                    onChange={e => setComment(e?.target?.value)}
                    placeholder={`Add ${actionLabels?.[actionType]?.toLowerCase()} comment...`}
                    rows={2}
                    className="w-full px-3 py-2 text-xs bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground placeholder:text-muted-foreground resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setReviewingId(null); setActionType(null); }}
                      className="flex-1 px-3 py-1.5 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-smooth text-foreground"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleConfirmAction}
                      disabled={processing}
                      className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50 transition-smooth ${actionColors?.[actionType]}`}
                    >
                      {processing ? 'Processing...' : `Confirm ${actionLabels?.[actionType]}`}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAction('approve', renewal?.id)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-smooth dark:bg-green-900/20 dark:border-green-800 dark:text-green-400"
                  >
                    <Icon name="Check" size={12} color="currentColor" />
                    Approve
                  </button>
                  <button
                    onClick={() => handleAction('reject', renewal?.id)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition-smooth dark:bg-red-900/20 dark:border-red-800 dark:text-red-400"
                  >
                    <Icon name="X" size={12} color="currentColor" />
                    Reject
                  </button>
                  <button
                    onClick={() => handleAction('info', renewal?.id)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition-smooth dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-400"
                  >
                    <Icon name="HelpCircle" size={12} color="currentColor" />
                    Info
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ApprovalQueue;

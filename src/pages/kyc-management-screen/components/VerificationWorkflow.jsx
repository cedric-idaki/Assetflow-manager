import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import KYCStatusBadge from './KYCStatusBadge';

const VerificationWorkflow = ({ client, onApprove, onReject, onRequestInfo, currentUser }) => {
  const [comment, setComment] = useState('');
  const [showCommentBox, setShowCommentBox] = useState(false);
  const [actionType, setActionType] = useState(null); // 'approve' | 'reject' | 'info'

  const handleAction = (type) => {
    setActionType(type);
    setShowCommentBox(true);
    setComment('');
  };

  const handleSubmit = () => {
    if (actionType === 'approve') onApprove?.(client?.id, comment);
    else if (actionType === 'reject') onReject?.(client?.id, comment);
    else if (actionType === 'info') onRequestInfo?.(client?.id, comment);
    setShowCommentBox(false);
    setComment('');
    setActionType(null);
  };

  const docChecks = [
    { label: 'National ID / Passport', done: !!client?.idDocument, key: 'idDocument' },
    { label: 'Passport Photo', done: !!client?.photo, key: 'photo' },
    { label: 'KRA PIN', done: !!client?.kraPin, key: 'kraPin' },
    { label: 'KRA PIN Verified', done: !!client?.kraPinVerified, key: 'kraPinVerified' },
  ];

  const completedDocs = docChecks?.filter(d => d?.done)?.length;
  const completionPct = Math.round((completedDocs / docChecks?.length) * 100);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0">
            <Icon name="User" size={16} color="white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{client?.name || 'Unknown Client'}</p>
            <p className="text-xs text-muted-foreground">{client?.email || client?.id}</p>
          </div>
        </div>
        <KYCStatusBadge status={client?.kycStatus || 'incomplete'} />
      </div>

      {/* Document Checklist */}
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-foreground uppercase tracking-wide">Document Checklist</p>
          <span className="text-xs text-muted-foreground">{completedDocs}/{docChecks?.length} complete</span>
        </div>
        <div className="h-1.5 bg-muted rounded-full mb-3 overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${completionPct}%` }} />
        </div>
        <div className="space-y-2">
          {docChecks?.map((doc) => (
            <div key={doc?.key} className="flex items-center gap-2.5">
              <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${
                doc?.done ? 'bg-emerald-500' : 'bg-muted border border-border'
              }`}>
                {doc?.done && <Icon name="Check" size={10} color="white" />}
              </div>
              <span className={`text-xs ${doc?.done ? 'text-foreground' : 'text-muted-foreground'}`}>{doc?.label}</span>
              {!doc?.done && <span className="ml-auto text-xs text-red-400 font-medium">Missing</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Approval Actions */}
      {(client?.kycStatus === 'pending' || client?.kycStatus === 'under_review') && (
        <div className="px-5 py-4">
          {!showCommentBox ? (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleAction('approve')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors"
              >
                <Icon name="CheckCircle" size={13} color="white" />
                Approve KYC
              </button>
              <button
                onClick={() => handleAction('reject')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                <Icon name="XCircle" size={13} color="white" />
                Reject
              </button>
              <button
                onClick={() => handleAction('info')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-border text-muted-foreground rounded-lg hover:text-foreground hover:bg-muted transition-colors"
              >
                <Icon name="MessageSquare" size={13} color="currentColor" />
                Request Info
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className={`flex items-center gap-2 text-xs font-semibold ${
                actionType === 'approve' ? 'text-emerald-500' : actionType === 'reject' ? 'text-red-500' : 'text-blue-500'
              }`}>
                <Icon name={actionType === 'approve' ? 'CheckCircle' : actionType === 'reject' ? 'XCircle' : 'MessageSquare'} size={13} color="currentColor" />
                {actionType === 'approve' ? 'Approve KYC' : actionType === 'reject' ? 'Reject KYC' : 'Request More Info'}
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e?.target?.value)}
                placeholder={actionType === 'approve' ? 'Add approval notes (optional)...' : 'Add reason or instructions...'}
                rows={3}
                className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground placeholder:text-muted-foreground"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSubmit}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg text-white transition-colors ${
                    actionType === 'approve' ? 'bg-emerald-500 hover:bg-emerald-600' : actionType === 'reject' ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'
                  }`}
                >
                  Confirm
                </button>
                <button
                  onClick={() => { setShowCommentBox(false); setActionType(null); }}
                  className="px-3 py-1.5 text-xs font-medium border border-border text-muted-foreground rounded-lg hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Already processed */}
      {(client?.kycStatus === 'verified' || client?.kycStatus === 'rejected') && (
        <div className="px-5 py-3">
          <p className="text-xs text-muted-foreground">
            {client?.kycStatus === 'verified' ? '✓ KYC approved and verified.' : '✗ KYC rejected. Client must resubmit documents.'}
          </p>
        </div>
      )}
    </div>
  );
};

export default VerificationWorkflow;

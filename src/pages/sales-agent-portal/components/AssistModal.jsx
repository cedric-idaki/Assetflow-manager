import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

// Bronze agents use this to ask a gold agent to take an admin they registered
// through system onboarding. The request lands in the gold agent's portal; the
// KES 1000 is credited when they mark the onboarding complete, not before.
const ASSIST_FEE = 1000;

const AssistModal = ({ isOpen, onClose, goldAgents = [], onAssign, prefillAdminName = '' }) => {
  const [adminName, setAdminName]     = useState(prefillAdminName || '');
  const [goldAgentId, setGoldAgentId] = useState('');
  const [note, setNote]               = useState('');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [done, setDone]               = useState(null);

  if (!isOpen) return null;

  const selectedGold = goldAgents.find(g => g.id === goldAgentId);

  const handleClose = () => {
    setAdminName(''); setGoldAgentId(''); setNote(''); setError(''); setDone(null); setLoading(false);
    onClose();
  };

  const handleSubmit = async () => {
    setError('');
    if (!adminName.trim()) { setError('Enter the admin / company that needs help.'); return; }
    if (!goldAgentId)      { setError('Select a gold agent to ask.'); return; }
    setLoading(true);
    try {
      await onAssign({ goldAgentId, adminName: adminName.trim(), note: note.trim() });
      setDone({ adminName: adminName.trim(), gold: selectedGold });
    } catch (err) {
      setError(err.message || 'Could not send the assist request. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Success state ──────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mb-5">
            <div className="w-14 h-14 rounded-full bg-emerald-600 flex items-center justify-center">
              <Icon name="Send" size={26} color="white" />
            </div>
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-1">Request Sent!</h3>
          <p className="text-sm text-gray-500 mb-5">
            <span className="font-semibold text-gray-800">{done.gold?.full_name || 'The gold agent'}</span> has
            been asked to take <span className="font-semibold text-gray-800">{done.adminName}</span> through the
            system. You'll see their answer in your Assist Requests panel.
          </p>
          <div className="w-full bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center justify-between mb-5">
            <span className="text-xs font-semibold text-emerald-800">Paid to them on completion</span>
            <span className="text-sm font-bold text-emerald-700">KES {ASSIST_FEE.toLocaleString()}</span>
          </div>
          <button onClick={handleClose}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl transition-colors">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center">
              <Icon name="LifeBuoy" size={18} color="white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Ask a Gold Agent for Help</h2>
              <p className="text-xs text-gray-500">They onboard the admin; they're paid when it's done</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <Icon name="X" size={18} color="#6b7280" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Admin / Company needing help *</label>
            <input
              type="text"
              value={adminName}
              onChange={e => { setAdminName(e.target.value); setError(''); }}
              placeholder="e.g. Acme Ltd"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/30 bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Gold Agent *</label>
            {goldAgents.length === 0 ? (
              <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-xl p-3">
                No gold agents are available yet. Ask the super admin to create one.
              </div>
            ) : (
              <select
                value={goldAgentId}
                onChange={e => { setGoldAgentId(e.target.value); setError(''); }}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/30 bg-white"
                style={{ color: goldAgentId ? undefined : '#9ca3af' }}
              >
                <option value="" disabled>Select a gold agent to ask</option>
                {goldAgents.map(g => (
                  <option key={g.id} value={g.id} style={{ color: '#111827' }}>
                    {g.full_name} — {g.agent_code}{g.region ? ` · ${g.region}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              What do you need help with?
            </label>
            <textarea
              rows={3}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Client is ready but I can't run the training — needs a full system walkthrough this week"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/30 bg-white resize-none"
            />
            <p className="text-xs text-gray-400 mt-1">
              This is the first thing the gold agent sees — say what's actually needed.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 flex items-center gap-2">
              <Icon name="AlertCircle" size={14} color="#dc2626" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={handleClose} disabled={loading}
            className="px-5 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || goldAgents.length === 0}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl disabled:opacity-60"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                </svg>
                Sending…
              </>
            ) : (
              <><Icon name="LifeBuoy" size={15} color="white" /> Send Request</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AssistModal;

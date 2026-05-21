import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';

const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const CommissionDashboard = ({ kpis, walletTransactions, agentProfile, onRequestWithdrawal, loading }) => {
  const [showWithdrawForm, setShowWithdrawForm]   = useState(false);
  const [withdrawAmount, setWithdrawAmount]       = useState('');
  const [withdrawNote, setWithdrawNote]           = useState('');
  const [withdrawError, setWithdrawError]         = useState('');
  const [submitting, setSubmitting]               = useState(false);
  const [withdrawSuccess, setWithdrawSuccess]     = useState(false);
  const [activeTab, setActiveTab]                 = useState('overview'); // overview | history

  const commissionRate = agentProfile?.commission_rate || 5;
  const totalEarned    = kpis?.totalEarned    || 0;
  const totalWithdrawn = kpis?.totalWithdrawn || 0;
  const balance        = totalEarned - totalWithdrawn;
  const thisMonth      = kpis?.commissionThisMonth || 0;

  // Group transactions by month for history tab
  const groupedHistory = (walletTransactions || []).reduce((acc, tx) => {
    const month = new Date(tx.created_at).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
    if (!acc[month]) acc[month] = [];
    acc[month].push(tx);
    return acc;
  }, {});

  const handleWithdraw = async (e) => {
    e?.preventDefault();
    setWithdrawError('');
    const amt = parseFloat(withdrawAmount);
    if (!amt || amt <= 0)   { setWithdrawError('Enter a valid amount'); return; }
    if (amt > balance)      { setWithdrawError(`Exceeds available balance of ${fmt(balance)}`); return; }
    if (amt < 100)          { setWithdrawError('Minimum withdrawal is KES 100'); return; }

    setSubmitting(true);
    try {
      await onRequestWithdrawal(amt, withdrawNote || 'Commission withdrawal request');
      setWithdrawSuccess(true);
      setWithdrawAmount('');
      setWithdrawNote('');
      setTimeout(() => { setShowWithdrawForm(false); setWithdrawSuccess(false); }, 2000);
    } catch (err) {
      setWithdrawError(err?.message || 'Withdrawal failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-5 animate-pulse space-y-4">
        <div className="h-5 bg-muted rounded w-40" />
        <div className="h-12 bg-muted rounded w-48" />
        <div className="grid grid-cols-3 gap-3">
          {[1,2,3].map(i => <div key={i} className="h-14 bg-muted rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">

      {/* ── Wallet card ── */}
      <div
        style={{ background: 'linear-gradient(135deg, #065f46 0%, #047857 50%, #059669 100%)' }}
        className="p-5 text-white"
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold opacity-75 uppercase tracking-wider">Commission Wallet</span>
          <div className="flex items-center gap-1.5 text-xs opacity-75">
            <Icon name="Shield" size={12} color="white" />
            <span>Rate: {commissionRate}%</span>
          </div>
        </div>
        <div className="text-2xl font-bold mb-1">{fmt(balance)}</div>
        <div className="text-xs opacity-70">Available balance · Updated live</div>

        <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-white/20">
          <div>
            <div className="text-xs opacity-60 mb-0.5">Earned Total</div>
            <div className="text-sm font-bold">{fmt(totalEarned)}</div>
          </div>
          <div>
            <div className="text-xs opacity-60 mb-0.5">This Month</div>
            <div className="text-sm font-bold text-emerald-300">{fmt(thisMonth)}</div>
          </div>
          <div>
            <div className="text-xs opacity-60 mb-0.5">Withdrawn</div>
            <div className="text-sm font-bold">{fmt(totalWithdrawn)}</div>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex border-b border-border">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'history',  label: 'History' },
          { id: 'withdraw', label: 'Withdraw' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); if (tab.id === 'withdraw') setShowWithdrawForm(true); else setShowWithdrawForm(false); }}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
              activeTab === tab.id
                ? 'text-emerald-700 border-b-2 border-emerald-600 bg-emerald-50/50'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-5">

        {/* ── Overview tab ── */}
        {activeTab === 'overview' && (
          <div className="space-y-3">
            <div className="space-y-2">
              {[
                { label: 'Commission Rate',    value: `${commissionRate}% per closed deal`, icon: 'Percent',   color: 'text-emerald-600' },
                { label: 'Total Sales',        value: fmt(agentProfile?.total_sales),       icon: 'TrendingUp', color: 'text-blue-600' },
                { label: 'Target Amount',      value: fmt(agentProfile?.target_amount),     icon: 'Target',     color: 'text-amber-600' },
                { label: 'Total Commission',   value: fmt(agentProfile?.total_commission),  icon: 'Award',      color: 'text-purple-600' },
              ].map(stat => (
                <div key={stat.label} className="flex items-center justify-between p-2.5 rounded-xl bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Icon name={stat.icon} size={14} color="var(--color-muted-foreground)" />
                    <span className="text-xs text-muted-foreground">{stat.label}</span>
                  </div>
                  <span className={`text-xs font-bold ${stat.color}`}>{stat.value}</span>
                </div>
              ))}
            </div>

            {/* Target progress */}
            {agentProfile?.target_amount > 0 && (
              <div className="pt-1">
                <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                  <span>Target Progress</span>
                  <span className="font-semibold">
                    {Math.min(100, Math.round(((agentProfile?.total_sales || 0) / agentProfile.target_amount) * 100))}%
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-700"
                    style={{ width: `${Math.min(100, Math.round(((agentProfile?.total_sales || 0) / agentProfile.target_amount) * 100))}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>{fmt(agentProfile?.total_sales || 0)}</span>
                  <span>{fmt(agentProfile?.target_amount)}</span>
                </div>
              </div>
            )}

            <button
              onClick={() => setActiveTab('withdraw')}
              className="w-full py-2.5 text-xs font-semibold rounded-xl border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors"
            >
              Request Withdrawal →
            </button>
          </div>
        )}

        {/* ── History tab ── */}
        {activeTab === 'history' && (
          <div className="space-y-4 max-h-64 overflow-y-auto">
            {Object.keys(groupedHistory).length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Icon name="Wallet" size={28} color="currentColor" />
                <p className="text-xs mt-2">No commission history yet</p>
                <p className="text-xs opacity-60">Close deals to start earning</p>
              </div>
            ) : (
              Object.entries(groupedHistory).map(([month, txs]) => (
                <div key={month}>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{month}</div>
                  <div className="space-y-1.5">
                    {txs.map(tx => (
                      <div key={tx.id} className="flex items-center justify-between p-2.5 rounded-xl bg-muted/20">
                        <div className="flex items-center gap-2">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                            tx.tx_type === 'credit' ? 'bg-emerald-100' : 'bg-red-100'
                          }`}>
                            <Icon
                              name={tx.tx_type === 'credit' ? 'ArrowDownLeft' : 'ArrowUpRight'}
                              size={12}
                              color={tx.tx_type === 'credit' ? '#059669' : '#dc2626'}
                            />
                          </div>
                          <div>
                            <p className="text-xs font-medium text-foreground capitalize">
                              {tx.description || (tx.tx_type === 'credit' ? 'Commission earned' : 'Withdrawal')}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(tx.created_at).toLocaleDateString('en-KE')}
                            </p>
                          </div>
                        </div>
                        <span className={`text-xs font-bold ${tx.tx_type === 'credit' ? 'text-emerald-600' : 'text-red-600'}`}>
                          {tx.tx_type === 'credit' ? '+' : '-'}{fmt(tx.total_earned || tx.total_withdrawn || 0)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Withdraw tab ── */}
        {activeTab === 'withdraw' && (
          <div className="space-y-3">
            {withdrawSuccess ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Icon name="CheckCircle" size={24} color="#059669" />
                </div>
                <p className="text-sm font-semibold text-foreground">Withdrawal Requested!</p>
                <p className="text-xs text-muted-foreground mt-1">Your admin will process it shortly.</p>
              </div>
            ) : (
              <>
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <div className="text-xs text-emerald-700">
                    <span className="font-semibold">Available: {fmt(balance)}</span>
                    <span className="opacity-70"> · Min withdrawal: KES 100</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Amount (KES)</label>
                  <input
                    type="number"
                    value={withdrawAmount}
                    onChange={e => { setWithdrawAmount(e.target.value); setWithdrawError(''); }}
                    placeholder="e.g. 5000"
                    min="100"
                    max={balance}
                    className="w-full px-3 py-2.5 text-sm border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-background"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Note <span className="font-normal opacity-60">(optional)</span></label>
                  <input
                    type="text"
                    value={withdrawNote}
                    onChange={e => setWithdrawNote(e.target.value)}
                    placeholder="e.g. Monthly withdrawal"
                    className="w-full px-3 py-2.5 text-sm border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-background"
                  />
                </div>

                {withdrawError && (
                  <div className="flex items-center gap-2 p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                    <Icon name="AlertCircle" size={13} color="#dc2626" />
                    {withdrawError}
                  </div>
                )}

                <button
                  onClick={handleWithdraw}
                  disabled={submitting || !withdrawAmount}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                      </svg>
                      Submitting...
                    </>
                  ) : (
                    <><Icon name="ArrowUpRight" size={15} color="white" /> Request Withdrawal</>
                  )}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CommissionDashboard;

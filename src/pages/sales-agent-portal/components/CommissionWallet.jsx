import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';


const CommissionWallet = ({ kpis, onRequestWithdrawal, loading }) => {
  const [showWithdrawForm, setShowWithdrawForm] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawNote, setWithdrawNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [withdrawError, setWithdrawError] = useState('');

  const totalEarned = parseFloat(kpis?.totalEarned || 0);
  const totalWithdrawn = parseFloat(kpis?.totalWithdrawn || 0);
  const availableBalance = totalEarned - totalWithdrawn;

  const handleWithdraw = async (e) => {
    e?.preventDefault();
    const amt = parseFloat(withdrawAmount);
    if (!amt || amt <= 0) { setWithdrawError('Enter a valid amount'); return; }
    if (amt > availableBalance) { setWithdrawError('Amount exceeds available balance'); return; }
    setSubmitting(true);
    setWithdrawError('');
    try {
      await onRequestWithdrawal(amt, withdrawNote || 'Withdrawal request');
      setShowWithdrawForm(false);
      setWithdrawAmount('');
      setWithdrawNote('');
    } catch (err) {
      setWithdrawError(err?.message || 'Withdrawal failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-primary to-secondary rounded-xl p-6 text-primary-foreground shadow-lg animate-pulse">
        <div className="h-6 bg-primary-foreground/20 rounded w-40 mb-4" />
        <div className="h-10 bg-primary-foreground/20 rounded w-32 mb-3" />
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-primary-foreground/20">
          <div className="h-8 bg-primary-foreground/20 rounded" />
          <div className="h-8 bg-primary-foreground/20 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-primary to-secondary rounded-xl p-6 text-primary-foreground shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <h3 className=" text-base font-semibold text-lg">Commission Wallet</h3>
        <Icon name="Wallet" size={24} color="var(--color-primary-foreground)" />
      </div>
      <div className="mb-4">
        <p className="text-xs opacity-75 mb-1">Available Balance</p>
        <p className="text-3xl font-bold">${availableBalance?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
      </div>
      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-primary-foreground/20 mb-4">
        <div>
          <p className="text-xs opacity-75 mb-1">Total Earned</p>
          <p className="text-lg font-semibold">${totalEarned?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
        </div>
        <div>
          <p className="text-xs opacity-75 mb-1">Total Withdrawn</p>
          <p className="text-lg font-semibold">${totalWithdrawn?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
        </div>
      </div>
      {!showWithdrawForm ? (
        <button
          onClick={() => setShowWithdrawForm(true)}
          className="w-full py-2 px-4 rounded-lg bg-primary-foreground/20 hover:bg-primary-foreground/30 text-primary-foreground text-sm font-medium transition-all border border-primary-foreground/30"
        >
          Request Withdrawal
        </button>
      ) : (
        <form onSubmit={handleWithdraw} className="space-y-2">
          <input
            type="number"
            placeholder="Amount"
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e?.target?.value)}
            className="w-full px-3 py-2 rounded-lg bg-primary-foreground/20 border border-primary-foreground/30 text-primary-foreground placeholder:text-primary-foreground/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary-foreground/50"
            min="1"
            step="0.01"
          />
          <input
            type="text"
            placeholder="Note (optional)"
            value={withdrawNote}
            onChange={(e) => setWithdrawNote(e?.target?.value)}
            className="w-full px-3 py-2 rounded-lg bg-primary-foreground/20 border border-primary-foreground/30 text-primary-foreground placeholder:text-primary-foreground/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary-foreground/50"
          />
          {withdrawError && <p className="text-xs text-red-200">{withdrawError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2 px-3 rounded-lg bg-primary-foreground/30 hover:bg-primary-foreground/40 text-primary-foreground text-sm font-medium transition-all disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit'}
            </button>
            <button
              type="button"
              onClick={() => { setShowWithdrawForm(false); setWithdrawError(''); }}
              className="flex-1 py-2 px-3 rounded-lg bg-primary-foreground/10 hover:bg-primary-foreground/20 text-primary-foreground text-sm transition-all"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default CommissionWallet;
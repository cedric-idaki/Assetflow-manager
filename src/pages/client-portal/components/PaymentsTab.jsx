import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { formatKEPhone } from '../../../utils/phoneUtils';

const MpesaPaymentModal = ({ onClose, onPay, clientProfile }) => {
  const [phone, setPhone] = useState(clientProfile?.phone || '');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handlePay = async () => {
    if (!phone || phone.length < 10) return setError('Enter a valid phone number.');
    if (!amount || parseFloat(amount) <= 0) return setError('Enter a valid amount.');
    setLoading(true);
    setError('');
    try {
      await onPay(parseFloat(amount), phone, null);
      setSent(true);
    } catch (err) {
      setError(err.message || 'Payment failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center">
              <Icon name="Smartphone" size={18} color="#059669" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Mpesa Payment</h3>
              <p className="text-xs text-muted-foreground">STK Push to your phone</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        <div className="px-6 py-5">
          {sent ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                <Icon name="Smartphone" size={28} color="#059669" />
              </div>
              <p className="font-bold text-foreground text-lg">Check your phone!</p>
              <p className="text-sm text-muted-foreground mt-1">
                An Mpesa STK push has been sent to
              </p>
              <p className="font-bold text-primary text-base mt-1">{phone}</p>
              <p className="text-sm text-muted-foreground mt-2">
                Enter your Mpesa PIN to complete payment of{' '}
                <span className="font-bold text-foreground">
                  KES {parseFloat(amount).toLocaleString()}
                </span>
              </p>
              <button
                onClick={onClose}
                className="mt-5 w-full py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}
              >
                Done
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                  <Icon name="AlertCircle" size={14} color="currentColor" />
                  {error}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Amount (KES) *
                </label>
                <input
                  type="number"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="e.g. 5000"
                  className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Mpesa Phone Number *
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Icon name="Phone" size={14} color="var(--color-muted-foreground)" />
                  </div>
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(formatKEPhone(e.target.value))}
                    placeholder="+254 7XX XXX XXX"
                    className="w-full pl-9 pr-3 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  You will receive an STK push on this number
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-border text-muted-foreground hover:bg-muted transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePay}
                  disabled={loading}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                      </svg>
                      Processing...
                    </>
                  ) : (
                    <>
                      <Icon name="Smartphone" size={14} color="currentColor" />
                      Pay Now
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const PaymentsTab = ({ payments, installmentPlans, clientProfile, onPay, onExport }) => {
  const [showMpesa, setShowMpesa] = useState(false);
  const [activeView, setActiveView] = useState('history');
  const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <div className="space-y-4">
      {/* Pay Now Banner */}
      <div
        className="rounded-2xl p-5 text-white"
        style={{ background: 'linear-gradient(135deg, #059669 0%, #047857 100%)' }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-emerald-100 text-sm">Outstanding Balance</p>
            <p className="text-2xl font-bold text-white mt-0.5">
              {fmt(clientProfile?.outstanding_balance)}
            </p>
            <p className="text-emerald-100 text-xs mt-1">
              Account: {clientProfile?.account_number}
            </p>
          </div>
          <button
            onClick={() => setShowMpesa(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-emerald-700 text-sm font-bold hover:bg-emerald-50 transition-all"
          >
            <Icon name="Smartphone" size={16} color="currentColor" />
            Pay via Mpesa
          </button>
        </div>
      </div>

      {/* View Toggle */}
      <div className="flex gap-1 p-1 bg-muted rounded-xl w-fit">
        {[
          { id: 'history', label: 'Payment History' },
          { id: 'plans', label: 'Installment Plans' },
        ].map(v => (
          <button
            key={v.id}
            onClick={() => setActiveView(v.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeView === v.id
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Payment History */}
      {activeView === 'history' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-base font-semibold text-foreground">
              Payment History ({payments.length})
            </h3>
            <button
              onClick={onExport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              <Icon name="Download" size={13} color="currentColor" />
              Export CSV
            </button>
          </div>
          {payments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Icon name="CreditCard" size={28} color="currentColor" />
              <p className="text-sm mt-2">No payments yet</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {payments.map(p => (
                <div key={p.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                      p.payment_status === 'completed' ? 'bg-emerald-100' :
                      p.payment_status === 'pending' ? 'bg-yellow-100' : 'bg-red-100'
                    }`}>
                      <Icon
                        name={p.payment_status === 'completed' ? 'CheckCircle' : p.payment_status === 'pending' ? 'Clock' : 'XCircle'}
                        size={16}
                        color={p.payment_status === 'completed' ? '#059669' : p.payment_status === 'pending' ? '#ca8a04' : '#dc2626'}
                      />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {p.asset?.description || 'Payment'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.transaction_id} · {p.payment_method?.replace(/_/g, ' ')}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-foreground">{fmt(p.amount)}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.payment_date ? new Date(p.payment_date).toLocaleDateString() : '—'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Installment Plans */}
      {activeView === 'plans' && (
        <div className="space-y-3">
          {installmentPlans.length === 0 ? (
            <div className="bg-card border border-border rounded-xl flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Icon name="CreditCard" size={28} color="currentColor" />
              <p className="text-sm mt-2">No installment plans</p>
            </div>
          ) : (
            installmentPlans.map(plan => {
              const progress = plan.total_installments > 0
                ? Math.round((plan.installments_paid / plan.total_installments) * 100)
                : 0;
              return (
                <div key={plan.id} className="bg-card border border-border rounded-xl p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-foreground text-sm">{plan.plan_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {plan.asset?.description || '—'}
                      </p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${
                      plan.plan_status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                      plan.plan_status === 'completed' ? 'bg-blue-100 text-blue-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {plan.plan_status}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Total Amount</p>
                      <p className="text-sm font-bold text-foreground">{fmt(plan.total_amount)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Per Installment</p>
                      <p className="text-sm font-bold text-foreground">{fmt(plan.installment_amount)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Next Due</p>
                      <p className="text-sm font-bold text-foreground">
                        {plan.next_charge_date
                          ? new Date(plan.next_charge_date).toLocaleDateString()
                          : '—'}
                      </p>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">
                        {plan.installments_paid} of {plan.total_installments} paid
                      </span>
                      <span className="font-medium text-foreground">{progress}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${progress}%`,
                          background: progress === 100 ? '#059669' : 'linear-gradient(135deg, #1A56DB, #1E429F)'
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {showMpesa && (
        <MpesaPaymentModal
          onClose={() => setShowMpesa(false)}
          onPay={onPay}
          clientProfile={clientProfile}
        />
      )}
    </div>
  );
};

export default PaymentsTab;
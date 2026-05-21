import React, { useState, useEffect, useRef, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { formatKEPhone } from '../../../utils/phoneUtils';
import { supabase } from '../../../lib/supabase';

const fmt = (n) => `KES ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const STEPS = { ENTER: 'enter', WAITING: 'waiting', SUCCESS: 'success', FAILED: 'failed' };

const MpesaPaymentForm = ({ amount, clientId, accountRef, planId, chargeId, onSuccess, onCancel }) => {
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [step, setStep] = useState(STEPS.ENTER);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checkoutRequestId, setCheckoutRequestId] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const pollRef = useRef(null);
  const timerRef = useRef(null);

  // ── Cleanup on unmount ──────────────────────────────────────
  useEffect(() => {
    return () => {
      clearInterval(pollRef.current);
      clearInterval(timerRef.current);
    };
  }, []);

  // ── Elapsed timer ───────────────────────────────────────────
  useEffect(() => {
    if (step === STEPS.WAITING) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [step]);

  // ── Poll mpesa_transactions for status change ───────────────
  const startPolling = useCallback((reqId) => {
    let attempts = 0;
    const MAX = 36; // 3 minutes at 5s intervals

    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const { data } = await supabase
          .from('mpesa_transactions')
          .select('status, mpesa_receipt_number, result_desc, amount')
          .eq('checkout_request_id', reqId)
          .maybeSingle();

        if (data?.status === 'completed') {
          clearInterval(pollRef.current);
          setReceipt(data.mpesa_receipt_number);
          setStep(STEPS.SUCCESS);
          onSuccess?.({
            transactionId: data.mpesa_receipt_number,
            amount: data.amount,
            paymentMethod: 'mpesa',
            phone,
            clientId,
            planId,
            chargeId,
          });
        } else if (data?.status === 'failed' || data?.status === 'cancelled') {
          clearInterval(pollRef.current);
          setError(data.result_desc || (data.status === 'cancelled' ? 'Payment was cancelled by user.' : 'Payment failed.'));
          setStep(STEPS.FAILED);
        } else if (attempts >= MAX) {
          clearInterval(pollRef.current);
          setError('Payment timed out. Please try again or check with your bank.');
          setStep(STEPS.FAILED);
        }
      } catch (err) {
        console.warn('Poll error:', err.message);
      }
    }, 5000);
  }, [phone, clientId, planId, chargeId, onSuccess]);

  // ── Validate phone ──────────────────────────────────────────
  const validatePhone = (val) => {
    const stripped = val.replace(/\s+/g, '').replace(/^\+/, '').replace(/^0/, '254');
    if (!/^2547\d{8}$/.test(stripped)) return 'Enter a valid Safaricom number (07XX XXX XXX)';
    return '';
  };

  // ── Send STK Push ───────────────────────────────────────────
  const handleSend = async () => {
    const err = validatePhone(phone);
    if (err) { setPhoneError(err); return; }
    if (!amount || amount <= 0) { setError('Invalid amount'); return; }

    setLoading(true);
    setError('');

    try {
      const { data, error: fnErr } = await supabase.functions.invoke('mpesa-stk-push', {
        body: { phone, amount: Math.round(amount), accountRef, clientId, planId, chargeId },
      });

      if (fnErr || data?.error) throw new Error(data?.error || fnErr?.message || 'STK push failed');

      setCheckoutRequestId(data.checkoutRequestId);
      setStep(STEPS.WAITING);
      startPolling(data.checkoutRequestId);
    } catch (e) {
      setError(e.message || 'Could not initiate M-Pesa payment. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = () => {
    clearInterval(pollRef.current);
    setStep(STEPS.ENTER);
    setError('');
    setCheckoutRequestId(null);
    setElapsed(0);
  };

  // ── STEP: Enter phone ───────────────────────────────────────
  if (step === STEPS.ENTER) return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 p-4 rounded-xl bg-green-50 border border-green-200">
        <div className="w-10 h-10 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-sm">M</span>
        </div>
        <div>
          <p className="text-sm font-semibold text-green-800">M-Pesa STK Push</p>
          <p className="text-xs text-green-600">A prompt will appear on the customer's phone</p>
        </div>
      </div>

      {/* Amount display */}
      <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 text-center">
        <p className="text-xs text-muted-foreground mb-1">Amount to collect</p>
        <p className="text-2xl font-bold text-foreground">{fmt(amount)}</p>
        {accountRef && <p className="text-xs text-muted-foreground mt-1">Ref: {accountRef}</p>}
      </div>

      {/* Phone input */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">
          Safaricom Phone Number <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Icon name="Smartphone" size={16} color="#6b7280" />
          </div>
          <input
            type="tel"
            value={phone}
            onChange={e => { setPhone(formatKEPhone(e.target.value)); setPhoneError(''); }}
            onBlur={() => setPhoneError(validatePhone(phone))}
            placeholder="0712 345 678"
            className={`w-full pl-10 pr-4 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 transition-all ${
              phoneError ? 'border-red-300 focus:ring-red-400/30' : 'border-gray-200 focus:ring-green-500/30 focus:border-green-400'
            }`}
          />
        </div>
        {phoneError && (
          <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
            <Icon name="AlertCircle" size={12} color="currentColor" /> {phoneError}
          </p>
        )}
        <p className="mt-1.5 text-xs text-muted-foreground">Format: 07XX XXX XXX or 2547XX XXX XXX</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          <Icon name="AlertCircle" size={15} color="currentColor" className="flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={handleSend} disabled={loading || !phone}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-green-600 text-white text-sm font-bold hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
          {loading
            ? <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>Sending...</>
            : <><Icon name="Smartphone" size={16} color="white" />Send STK Push</>
          }
        </button>
        <button onClick={onCancel}
          className="px-5 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );

  // ── STEP: Waiting for customer ──────────────────────────────
  if (step === STEPS.WAITING) return (
    <div className="space-y-5 text-center py-4">
      <div className="relative w-20 h-20 mx-auto">
        <svg className="animate-spin w-20 h-20 text-green-200" viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="44" stroke="currentColor" strokeWidth="8"/>
        </svg>
        <svg className="animate-spin absolute inset-0 w-20 h-20 text-green-600" viewBox="0 0 100 100" fill="none" style={{ animationDuration: '1.5s' }}>
          <circle cx="50" cy="50" r="44" stroke="currentColor" strokeWidth="8" strokeDasharray="60 220" strokeLinecap="round"/>
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <Icon name="Smartphone" size={28} color="#16a34a" />
        </div>
      </div>

      <div>
        <p className="text-base font-bold text-foreground">Waiting for confirmation</p>
        <p className="text-sm text-muted-foreground mt-1">
          A prompt has been sent to <span className="font-semibold text-foreground">{phone}</span>
        </p>
      </div>

      <div className="p-4 rounded-xl bg-green-50 border border-green-200 text-left space-y-2">
        <p className="text-xs font-semibold text-green-800 uppercase tracking-wide">Instructions for customer</p>
        {['Check your phone for the M-Pesa PIN prompt', 'Enter your M-Pesa PIN to confirm', `Confirm payment of ${fmt(amount)}`].map((step, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-green-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
            <p className="text-xs text-green-700">{step}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-200">
        <span className="text-xs text-muted-foreground">Waiting... {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
        <span className="text-xs text-muted-foreground">Timeout in {Math.max(0, 180 - elapsed)}s</span>
      </div>

      <button onClick={handleRetry}
        className="text-sm text-muted-foreground hover:text-foreground hover:underline">
        ← Cancel and re-enter details
      </button>
    </div>
  );

  // ── STEP: Success ───────────────────────────────────────────
  if (step === STEPS.SUCCESS) return (
    <div className="space-y-5 text-center py-4">
      <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto">
        <Icon name="CheckCircle" size={40} color="#16a34a" />
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground">Payment Received!</p>
        <p className="text-sm text-muted-foreground mt-1">{fmt(amount)} collected via M-Pesa</p>
      </div>
      {receipt && (
        <div className="p-4 rounded-xl bg-green-50 border border-green-200">
          <p className="text-xs text-green-700 mb-1">M-Pesa Receipt Number</p>
          <p className="text-lg font-mono font-bold text-green-800 tracking-widest">{receipt}</p>
        </div>
      )}
      <button onClick={() => onSuccess?.()}
        className="w-full py-3 rounded-xl bg-green-600 text-white text-sm font-bold hover:bg-green-700 transition-colors">
        Done
      </button>
    </div>
  );

  // ── STEP: Failed ────────────────────────────────────────────
  if (step === STEPS.FAILED) return (
    <div className="space-y-5 text-center py-4">
      <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center mx-auto">
        <Icon name="XCircle" size={40} color="#dc2626" />
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground">Payment Unsuccessful</p>
        <p className="text-sm text-muted-foreground mt-1">{error}</p>
      </div>
      <div className="flex gap-3">
        <button onClick={handleRetry}
          className="flex-1 py-3 rounded-xl bg-green-600 text-white text-sm font-bold hover:bg-green-700 transition-colors">
          Try Again
        </button>
        <button onClick={onCancel}
          className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
          Use Different Method
        </button>
      </div>
    </div>
  );

  return null;
};

export default MpesaPaymentForm;

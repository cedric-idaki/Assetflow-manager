import React, { useState, useEffect, useCallback, useRef } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabase';
import { formatKEPhone } from '../../../utils/phoneUtils';

/**
 * Platform M-Pesa status and live test.
 *
 * Credentials are NOT editable here on purpose. The consumer key, secret and
 * passkey live in Supabase function secrets, never in the database and never in
 * the browser, so they are set with `supabase secrets set` and this screen only
 * reports whether they are present and whether Safaricom accepts them.
 */

const SECRET_LABELS = {
  consumerKey: 'MPESA_CONSUMER_KEY',
  consumerSecret: 'MPESA_CONSUMER_SECRET',
  shortcode: 'MPESA_SHORTCODE',
  passkey: 'MPESA_PASSKEY',
  credEncKey: 'MPESA_CRED_ENC_KEY',
};

const Row = ({ label, value, mono }) => (
  <div className="flex items-start justify-between gap-4 py-2.5 border-b border-border last:border-0">
    <span className="text-xs text-muted-foreground flex-shrink-0">{label}</span>
    <span className={`text-xs text-foreground text-right break-all ${mono ? 'font-mono' : 'font-medium'}`}>
      {value}
    </span>
  </div>
);

const MpesaSettingsTab = () => {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ── Test payment state ──────────────────────────────────────────────
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('1');
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const pollRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => () => {
    clearInterval(pollRef.current);
    clearInterval(timerRef.current);
  }, []);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('mpesa-config');
      if (fnErr || data?.error) throw new Error(data?.error || fnErr?.message);
      setConfig(data);
    } catch (e) {
      setError(e?.message || 'Could not load M-Pesa configuration');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const startPolling = useCallback((checkoutRequestId) => {
    let attempts = 0;
    const MAX = 36; // 3 minutes at 5s

    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);

    pollRef.current = setInterval(async () => {
      attempts += 1;
      const { data } = await supabase
        .from('mpesa_transactions')
        .select('status, mpesa_receipt_number, result_desc')
        .eq('checkout_request_id', checkoutRequestId)
        .maybeSingle();

      if (data && data.status !== 'pending') {
        clearInterval(pollRef.current);
        clearInterval(timerRef.current);
        setTesting(false);
        setTestResult({
          status: data.status,
          receipt: data.mpesa_receipt_number,
          desc: data.result_desc,
        });
      } else if (attempts >= MAX) {
        clearInterval(pollRef.current);
        clearInterval(timerRef.current);
        setTesting(false);
        // Timing out here means the STK push was accepted but no callback ever
        // arrived — almost always a callback URL that Safaricom cannot reach.
        setTestResult({
          status: 'timeout',
          desc: 'No callback received within 3 minutes. Check that your callback URL is registered with Safaricom and publicly reachable.',
        });
      }
    }, 5000);
  }, []);

  const handleTest = async () => {
    setTestError('');
    setTestResult(null);

    const amt = Math.round(Number(amount));
    if (!Number.isFinite(amt) || amt < 1) {
      setTestError('Amount must be at least KES 1');
      return;
    }

    setTesting(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('mpesa-stk-push', {
        body: {
          purpose: 'test',
          phone,
          amount: amt,
          accountRef: 'MPESA-TEST',
        },
      });
      if (fnErr || data?.error) throw new Error(data?.error || fnErr?.message || 'Test failed');
      startPolling(data.checkoutRequestId);
    } catch (e) {
      setTesting(false);
      setTestError(e?.message || 'Could not send the test payment');
    }
  };

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6 animate-pulse space-y-3">
        {[1, 2, 3, 4].map(i => <div key={i} className="h-4 bg-muted rounded w-full" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-5 flex items-start gap-3">
        <Icon name="AlertCircle" size={18} color="#dc2626" className="flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-800">Could not read M-Pesa configuration</p>
          <p className="text-xs text-red-600 mt-1">{error}</p>
          <button onClick={loadConfig} className="mt-3 text-xs font-medium text-red-700 hover:underline">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const isProduction = config?.environment === 'production';
  const ready = config?.credentialsValid && !config?.isSandboxDefault;
  // MPESA_CRED_ENC_KEY only gates tenant-owned paybills, so it must not be
  // reported as a blocker for the platform's own setup.
  const requiredMissing = (config?.missing || []).filter(k => k !== 'credEncKey');

  return (
    <div className="space-y-5">

      {/* ── Connection status ─────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
              config?.credentialsValid ? 'bg-green-100' : 'bg-red-100'
            }`}>
              <Icon
                name={config?.credentialsValid ? 'CheckCircle' : 'AlertCircle'}
                size={20}
                color={config?.credentialsValid ? '#16a34a' : '#dc2626'}
              />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">Platform M-Pesa</h3>
              <p className="text-xs text-muted-foreground">
                {config?.credentialsValid
                  ? 'Safaricom accepted these credentials'
                  : 'Safaricom did not accept these credentials'}
              </p>
            </div>
          </div>
          <button
            onClick={loadConfig}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <Icon name="RefreshCw" size={12} color="currentColor" />
            Recheck
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
            isProduction ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
          }`}>
            {isProduction ? 'PRODUCTION' : 'SANDBOX'}
          </span>
          <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-muted text-muted-foreground uppercase">
            {config?.accountType}
          </span>
        </div>

        <div className="rounded-xl border border-border px-4">
          <Row label="Shortcode" value={config?.shortcode || '— not set —'} mono />
          <Row label="Callback URL" value={config?.callbackUrl} mono />
        </div>

        {config?.credentialError && (
          <div className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200">
            <Icon name="AlertCircle" size={14} color="#dc2626" className="flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{config.credentialError}</p>
          </div>
        )}

        {config?.isSandboxDefault && (
          <div className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
            <Icon name="AlertTriangle" size={14} color="#d97706" className="flex-shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800">
              <span className="font-semibold">This is Safaricom's shared test shortcode (174379).</span>{' '}
              No real money can move until MPESA_SHORTCODE is your own paybill and
              MPESA_ENV is <code className="font-mono">production</code>.
            </div>
          </div>
        )}

        {requiredMissing.length > 0 && (
          <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200">
            <p className="text-xs font-semibold text-amber-800 mb-1.5">Required secrets not set</p>
            <div className="flex flex-wrap gap-1.5">
              {requiredMissing.map(k => (
                <code key={k} className="px-2 py-0.5 rounded bg-white/70 text-[11px] font-mono text-amber-900">
                  {SECRET_LABELS[k] || k}
                </code>
              ))}
            </div>
            <p className="text-[11px] text-amber-700 mt-2">
              Add these under Project Settings → Edge Functions → Secrets. They are never stored in the database.
            </p>
          </div>
        )}

        {/* Only needed to let OTHER companies store their own paybill. Shown
            separately so a missing value here never looks like a broken setup. */}
        {config?.missing?.includes('credEncKey') && (
          <div className="mt-3 flex items-start gap-2 p-3 rounded-xl bg-muted/50 border border-border">
            <Icon name="Info" size={14} color="#6b7280" className="flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-muted-foreground">
              <code className="font-mono">MPESA_CRED_ENC_KEY</code> is not set. Not needed for your own
              paybill — only when you let other companies or SACCOs connect their own M-Pesa.
            </p>
          </div>
        )}
      </div>

      {/* ── Live test ─────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-1">
          <Icon name="Smartphone" size={18} color="#16a34a" />
          <h3 className="text-base font-bold text-foreground">Send a test payment</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Sends a real STK push to the number below. {isProduction
            ? 'This moves real money and is not refundable through this system — use KES 1.'
            : 'On sandbox no real money moves.'}{' '}
          Test payments are recorded but never create a payment record or activate a subscription.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-foreground mb-1.5">Phone number</label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(formatKEPhone(e.target.value))}
              placeholder="0712 345 678"
              disabled={testing}
              className="w-full px-3 py-2.5 rounded-xl border border-border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-400 disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">Amount (KES)</label>
            <input
              type="number"
              min="1"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              disabled={testing}
              className="w-full px-3 py-2.5 rounded-xl border border-border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-400 disabled:opacity-60"
            />
          </div>
        </div>

        {testError && (
          <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200">
            <Icon name="AlertCircle" size={14} color="#dc2626" className="flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{testError}</p>
          </div>
        )}

        {testing && (
          <div className="mb-4 flex items-center gap-3 p-3 rounded-xl bg-green-50 border border-green-200">
            <svg className="animate-spin w-4 h-4 text-green-600 flex-shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <p className="text-xs text-green-800">
              Prompt sent. Waiting for confirmation on the phone…{' '}
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
            </p>
          </div>
        )}

        {testResult && (
          <div className={`mb-4 p-4 rounded-xl border ${
            testResult.status === 'completed'
              ? 'bg-green-50 border-green-200'
              : 'bg-red-50 border-red-200'
          }`}>
            <div className="flex items-start gap-2">
              <Icon
                name={testResult.status === 'completed' ? 'CheckCircle' : 'XCircle'}
                size={16}
                color={testResult.status === 'completed' ? '#16a34a' : '#dc2626'}
                className="flex-shrink-0 mt-0.5"
              />
              <div>
                <p className={`text-sm font-bold ${
                  testResult.status === 'completed' ? 'text-green-800' : 'text-red-800'
                }`}>
                  {testResult.status === 'completed'
                    ? 'End-to-end test passed'
                    : `Test ${testResult.status}`}
                </p>
                {testResult.receipt && (
                  <p className="text-xs text-green-700 mt-1">
                    M-Pesa receipt <span className="font-mono font-bold">{testResult.receipt}</span>
                  </p>
                )}
                {testResult.desc && (
                  <p className="text-xs text-muted-foreground mt-1">{testResult.desc}</p>
                )}
                {testResult.status === 'completed' && (
                  <p className="text-xs text-green-700 mt-2">
                    STK push, Safaricom callback and settlement all worked.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <button
          onClick={handleTest}
          disabled={testing || !phone || !ready}
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-green-600 text-white text-sm font-bold hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          <Icon name="Send" size={14} color="white" />
          {testing ? 'Waiting…' : 'Send test payment'}
        </button>

        {!ready && (
          <p className="text-xs text-muted-foreground mt-2">
            {config?.isSandboxDefault
              ? 'Set your own paybill in MPESA_SHORTCODE before testing.'
              : 'Fix the credential errors above before testing.'}
          </p>
        )}
      </div>
    </div>
  );
};

export default MpesaSettingsTab;

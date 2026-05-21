import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import Icon from '../../components/AppIcon';

const ResetPasswordPage = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [validSession, setValidSession] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  // ── Check Supabase has a valid recovery/invite session from the email link ──
  useEffect(() => {
    let timeoutId;

    // Attach listener BEFORE checking session to avoid race condition
    // where the SIGNED_IN / PASSWORD_RECOVERY event fires before we listen
    // Check for token_hash in URL (Gmail-scanner safe invite flow)
  const hashParams = new URLSearchParams(window.location.search);
  const tokenHash = hashParams.get('token_hash');
  const type = hashParams.get('type');

  if (tokenHash && type) {
    supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      .then(({ data, error }) => {
        if (error) {
          setCheckingSession(false);
        } else if (data?.session) {
          setValidSession(true);
          setCheckingSession(false);
        }
      });
    return;
  }

  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    if (
      event === 'PASSWORD_RECOVERY' ||
      event === 'SIGNED_IN' ||
      event === 'USER_UPDATED'
    ) {
      if (session) {
        setValidSession(true);
        setCheckingSession(false);
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
  });

  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      setValidSession(true);
      setCheckingSession(false);
      if (timeoutId) clearTimeout(timeoutId);
    } else {
      timeoutId = setTimeout(() => {
        setCheckingSession(false);
      }, 4000);
    }
  });

  return () => {
    subscription?.unsubscribe();
    if (timeoutId) clearTimeout(timeoutId);
  };
}, []);

  // ── Password strength ──
  const getStrength = (pw) => {
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[a-z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return score;
  };

  const strength = getStrength(password);
  const strengthLabel = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'][strength];
  const strengthColor = ['', '#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981'][strength];

  const handleSubmit = async () => {
    setError('');
    if (!password) return setError('Please enter a new password.');
    if (strength < 3) return setError('Password is too weak. Use at least 8 characters, uppercase, lowercase, and numbers.');
    if (password !== confirmPassword) return setError('Passwords do not match.');

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setSuccess(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err.message || 'Failed to update password. The reset link may have expired.');
    } finally {
      setLoading(false);
    }
  };

  // ── Loading state while checking session ──
  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(160deg, #0A1628 0%, #1B3A6B 50%, #0D2040 100%)' }}>
        <div className="flex flex-col items-center gap-4 text-white">
          <svg className="animate-spin w-8 h-8" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
          </svg>
          <p className="text-sm" style={{ color: '#A8BDD4' }}>Verifying your invitation link...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex" style={{ background: 'linear-gradient(160deg, #0A1628 0%, #1B3A6B 50%, #0D2040 100%)' }}>
      <div className="absolute top-0 left-0 right-0 h-1" style={{ background: 'linear-gradient(90deg, #C9A84C, #D4AF37, #C9A84C)' }} />

      <div className="flex-1 flex flex-col items-center justify-center p-6">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-10">
          <div className="flex items-center justify-center w-11 h-11 rounded-lg" style={{ background: 'linear-gradient(135deg, #C9A84C, #D4AF37)' }}>
            <Icon name="Building2" size={22} color="#0A1628" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">AssetFlow</h1>
            <p className="text-xs" style={{ color: '#C9A84C' }}>Financial Management Platform</p>
          </div>
        </div>

        {/* Card */}
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8">

          {success ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                <Icon name="CheckCircle" size={32} color="#10b981" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Password Set!</h2>
              <p className="text-sm text-gray-500 mb-6">
                Your account is ready. Redirecting you to login...
              </p>
              <div className="flex items-center justify-center gap-2 text-emerald-600 text-sm">
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                </svg>
                Redirecting to login...
              </div>
            </div>

          ) : !validSession ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <Icon name="LinkOff" size={32} color="#ef4444" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Link Expired</h2>
              <p className="text-sm text-gray-500 mb-6">
                This invitation link is invalid or has expired. Please contact your administrator to resend the invite.
              </p>
              <button
                onClick={() => navigate('/login')}
                className="w-full py-2.5 px-4 rounded-xl text-white text-sm font-semibold transition-colors"
                style={{ background: 'linear-gradient(135deg, #1B3A6B, #2C5282)' }}>
                Back to Login
              </button>
            </div>

          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-gray-900 mb-1">Set Your Password</h2>
                <p className="text-sm text-gray-500">Welcome to AssetFlow — choose a strong password to activate your account</p>
                <div className="mt-3 w-10 h-0.5" style={{ background: '#C9A84C' }} />
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                  <Icon name="AlertCircle" size={15} color="#ef4444" />
                  {error}
                </div>
              )}

              {/* New Password */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">New Password</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Icon name="Lock" size={16} color="#9ca3af" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Create a strong password"
                    className="w-full pl-10 pr-10 py-2.5 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 text-sm"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600">
                    <Icon name={showPassword ? 'EyeOff' : 'Eye'} size={16} color="currentColor" />
                  </button>
                </div>
                {password.length > 0 && (
                  <div className="mt-2">
                    <div className="flex gap-1 mb-1">
                      {[1,2,3,4,5].map(i => (
                        <div key={i} className="flex-1 h-1 rounded-full transition-colors"
                          style={{ background: i <= strength ? strengthColor : '#e5e7eb' }} />
                      ))}
                    </div>
                    <p className="text-xs font-medium" style={{ color: strengthColor }}>{strengthLabel}</p>
                  </div>
                )}
              </div>

              {/* Confirm Password */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm Password</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Icon name="Lock" size={16} color="#9ca3af" />
                  </div>
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    className={`w-full pl-10 pr-10 py-2.5 border rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 text-sm ${
                      confirmPassword && password !== confirmPassword
                        ? 'border-red-300 focus:ring-red-500/30'
                        : confirmPassword && password === confirmPassword
                        ? 'border-emerald-300 focus:ring-emerald-500/30'
                        : 'border-gray-200 focus:ring-blue-500/30'
                    }`}
                  />
                  <button type="button" onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600">
                    <Icon name={showConfirm ? 'EyeOff' : 'Eye'} size={16} color="currentColor" />
                  </button>
                </div>
                {confirmPassword && password === confirmPassword && (
                  <p className="mt-1.5 text-xs text-emerald-600 flex items-center gap-1">
                    <Icon name="CheckCircle" size={12} color="#10b981" /> Passwords match
                  </p>
                )}
              </div>

              {/* Requirements */}
              <div className="mb-6 p-3 bg-gray-50 rounded-xl space-y-1.5">
                {[
                  { label: 'At least 8 characters', met: password.length >= 8 },
                  { label: 'Uppercase letter', met: /[A-Z]/.test(password) },
                  { label: 'Lowercase letter', met: /[a-z]/.test(password) },
                  { label: 'Number', met: /[0-9]/.test(password) },
                ].map(req => (
                  <div key={req.label} className="flex items-center gap-2">
                    <Icon name={req.met ? 'CheckCircle' : 'Circle'} size={13}
                      color={req.met ? '#10b981' : '#d1d5db'} />
                    <span className={`text-xs ${req.met ? 'text-emerald-700' : 'text-gray-400'}`}>{req.label}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={handleSubmit}
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl text-white text-sm font-semibold transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg, #1B3A6B, #2C5282)' }}>
                {loading
                  ? <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>Setting Password...</>
                  : <><Icon name="ShieldCheck" size={16} color="white" />Activate My Account</>
                }
              </button>

              <button onClick={() => navigate('/login')}
                className="w-full mt-3 py-2.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
                ← Back to Login
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResetPasswordPage;

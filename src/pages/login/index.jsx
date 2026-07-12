import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import Icon from '../../components/AppIcon';

const LoginPage = () => {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState(false);
  const [forgotError, setForgotError] = useState('');

  const validateForm = function() {
    var errors = {};
    if (!email.trim()) {
      errors.email = 'Email address is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = 'Please enter a valid email address.';
    }
    if (!password) {
      errors.password = 'Password is required.';
    } else if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters.';
    }
    return errors;
  };

  const handleSubmit = async function(e) {
    e && e.preventDefault();
    setError('');
    setFieldErrors({});
    var errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setLoading(true);
    try {
      var result = await signIn(email.trim(), password);
      var signInError = result.error;
      var redirectPath = result.redirectPath;
      if (signInError) {
        setError(signInError.message || 'Invalid credentials. Please try again.');
      } else {
        navigate(redirectPath || '/role-based-dashboard');
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async function() {
    setForgotError('');
    if (!forgotEmail.trim()) {
      setForgotError('Please enter your email address.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forgotEmail.trim())) {
      setForgotError('Please enter a valid email address.');
      return;
    }
    setForgotLoading(true);
    try {
      var result = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), {
        redirectTo: window.location.origin + '/reset-password',
      });
      if (result.error) throw result.error;
      setForgotSuccess(true);
    } catch (err) {
      setForgotError(err.message || 'Failed to send reset email. Please try again.');
    } finally {
      setForgotLoading(false);
    }
  };

  // System colors
  const C = {
    primary:     '#34c1dd',
    primaryDark: '#1da8c5',
    navy:        '#0c2037',
    navyMid:     '#1a3a5c',
    bg:          '#f5f8fa',
    card:        '#ffffff',
    border:      '#d0dce6',
    inputBg:     '#f5f8fa',
    text:        '#0c2037',
    textMuted:   '#5a7185',
    error:       '#b91c1c',
    errorBg:     '#fef2f2',
    errorBorder: '#fecaca',
  };

  var inputStyle = function(hasError) {
    return {
      border: hasError ? '1.5px solid ' + C.error : '1.5px solid ' + C.border,
      color: C.text,
      background: hasError ? C.errorBg : C.inputBg,
      outline: 'none',
    };
  };

  return (
    <div className="min-h-screen flex" style={{ background: C.bg }}>

      {/* ── Left panel ─────────────────────────────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-[52%] flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #0c2037 0%, #1a3a5c 60%, #0c2037 100%)' }}
      >
        {/* Top accent line — system primary color */}
        <div className="absolute top-0 left-0 right-0 h-1"
          style={{ background: 'linear-gradient(90deg, #34c1dd, #5dd3e8, #34c1dd)' }} />

        {/* Decorative circles */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-16 right-16 w-72 h-72 rounded-full"
            style={{ border: '1.5px solid rgba(52,193,221,0.08)' }} />
          <div className="absolute top-32 right-32 w-44 h-44 rounded-full"
            style={{ border: '1px solid rgba(52,193,221,0.06)' }} />
          <div className="absolute bottom-32 left-8 w-56 h-56 rounded-full"
            style={{ border: '1px solid rgba(52,193,221,0.06)' }} />
          <div className="absolute bottom-16 left-24 w-32 h-32 rounded-full"
            style={{ border: '1px solid rgba(52,193,221,0.04)' }} />
          {/* Glow blob */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(52,193,221,0.06) 0%, transparent 70%)' }} />
        </div>

        {/* Brand */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #34c1dd, #1da8c5)', boxShadow: '0 4px 14px rgba(52,193,221,0.35)' }}>
            <Icon name="Building2" size={24} color="#0c2037" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">AssetFlow</h1>
            <p className="text-xs" style={{ color: '#34c1dd' }}>Financial Management Platform</p>
          </div>
        </div>

        {/* Headline */}
        <div className="relative z-10 flex-1 flex flex-col justify-center">
          <div className="w-12 h-0.5 mb-6" style={{ background: '#34c1dd' }} />
          <h2 className="text-4xl font-bold text-white leading-tight mb-4">
            Manage Your Assets<br />and Collections
          </h2>
          <p className="text-base leading-relaxed mb-10" style={{ color: '#7a9cb8' }}>
            A comprehensive financial management platform for tracking assets,
            processing payments, and managing client relationships.
          </p>

          {/* Feature list */}
          <div className="space-y-4">
            {[
              { icon: 'ShieldCheck', text: 'Role-based access with full audit trails'         },
              { icon: 'TrendingUp',  text: 'Real-time performance analytics and reports'      },
              { icon: 'CreditCard', text: 'Integrated payment processing and collections'     },
            ].map(function(item, i) {
              return (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(52,193,221,0.12)', border: '1px solid rgba(52,193,221,0.25)' }}>
                    <Icon name={item.icon} size={15} color="#34c1dd" />
                  </div>
                  <span className="text-sm" style={{ color: '#7a9cb8' }}>{item.text}</span>
                </div>
              );
            })}
          </div>

          {/* Stats strip */}
          <div className="mt-10 grid grid-cols-3 gap-4">
            {[
              { label: 'Modules',    value: '8+'  },
              { label: 'Roles',      value: '12+' },
              { label: 'Uptime',     value: '99%' },
            ].map(function(s) {
              return (
                <div key={s.label} className="rounded-xl p-4 text-center"
                  style={{ background: 'rgba(52,193,221,0.07)', border: '1px solid rgba(52,193,221,0.12)' }}>
                  <p className="text-2xl font-black text-white">{s.value}</p>
                  <p className="text-xs mt-0.5" style={{ color: '#7a9cb8' }}>{s.label}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10">
          <p className="text-xs" style={{ color: '#3a5a7a' }}>
            &copy; {new Date().getFullYear()} AssetFlow. All rights reserved.
          </p>
        </div>
      </div>

      {/* ── Right panel ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col justify-center items-center p-8" style={{ background: C.card }}>

        {/* Mobile logo */}
        <div className="lg:hidden mb-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl mb-3"
            style={{ background: 'linear-gradient(135deg, #34c1dd, #1da8c5)', boxShadow: '0 4px 14px rgba(52,193,221,0.35)' }}>
            <Icon name="Building2" size={26} color="#0c2037" />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: C.navy }}>AssetFlow</h1>
          <p className="text-xs mt-1" style={{ color: C.textMuted }}>Financial Management Platform</p>
        </div>

        <div className="w-full max-w-md">

          {/* ── Forgot Password ── */}
          {showForgot ? (
            <div>
              <button
                onClick={function() { setShowForgot(false); setForgotSuccess(false); setForgotError(''); setForgotEmail(''); }}
                className="flex items-center gap-1.5 text-sm mb-6 hover:underline transition-colors"
                style={{ color: C.textMuted }}
              >
                <Icon name="ArrowLeft" size={14} color="currentColor" /> Back to Login
              </button>

              {forgotSuccess ? (
                <div className="text-center py-6">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                    style={{ background: 'rgba(52,193,221,0.12)', border: '2px solid rgba(52,193,221,0.3)' }}>
                    <Icon name="MailCheck" size={28} color={C.primary} />
                  </div>
                  <h2 className="text-xl font-bold mb-2" style={{ color: C.navy }}>Check Your Email</h2>
                  <p className="text-sm mb-2" style={{ color: C.textMuted }}>We sent a password reset link to:</p>
                  <p className="text-sm font-bold mb-4" style={{ color: C.primary }}>{forgotEmail}</p>
                  <p className="text-xs" style={{ color: C.textMuted }}>
                    Click the link in the email to set a new password. Check your spam folder if you do not see it.
                  </p>
                </div>
              ) : (
                <div>
                  <div className="mb-6">
                    <h2 className="text-2xl font-bold mb-1" style={{ color: C.navy }}>Forgot Password?</h2>
                    <p className="text-sm" style={{ color: C.textMuted }}>Enter your email and we will send you a reset link</p>
                    <div className="mt-3 w-10 h-0.5" style={{ background: C.primary }} />
                  </div>

                  {forgotError && (
                    <div className="flex items-center gap-2 p-3 rounded-lg text-sm mb-4"
                      style={{ background: C.errorBg, border: '1px solid ' + C.errorBorder, color: C.error }}>
                      <Icon name="AlertCircle" size={15} color="currentColor" />
                      {forgotError}
                    </div>
                  )}

                  <div className="mb-5">
                    <label className="block text-sm font-semibold mb-1.5" style={{ color: C.navy }}>Email Address</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Icon name="Mail" size={15} color={C.textMuted} />
                      </div>
                      <input
                        type="email"
                        value={forgotEmail}
                        onChange={function(e) { setForgotEmail(e.target.value); }}
                        placeholder="you@example.com"
                        className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg transition-all"
                        style={{ border: '1.5px solid ' + C.border, color: C.text, background: C.inputBg, outline: 'none' }}
                        onFocus={function(e) { e.target.style.borderColor = C.primary; e.target.style.boxShadow = '0 0 0 3px rgba(52,193,221,0.15)'; }}
                        onBlur={function(e) { e.target.style.borderColor = C.border; e.target.style.boxShadow = 'none'; }}
                        onKeyDown={function(e) { if (e.key === 'Enter') handleForgotPassword(); }}
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleForgotPassword}
                    disabled={forgotLoading}
                    className="w-full py-3 px-4 text-sm font-bold rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-70"
                    style={{ background: 'linear-gradient(135deg, #34c1dd, #1da8c5)', color: C.navy, boxShadow: '0 4px 14px rgba(52,193,221,0.35)' }}
                  >
                    {forgotLoading ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                        </svg>
                        Sending...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Icon name="Send" size={15} color={C.navy} />
                        Send Reset Link
                      </span>
                    )}
                  </button>
                </div>
              )}
            </div>

          ) : (
            /* ── Sign In Form ── */
            <div>
              <div className="mb-8">
                <h2 className="text-2xl font-bold mb-1" style={{ color: C.navy }}>Welcome Back</h2>
                <p className="text-sm" style={{ color: C.textMuted }}>Sign in to access your dashboard</p>
                <div className="mt-3 w-10 h-0.5" style={{ background: C.primary }} />
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg text-sm mb-5"
                  style={{ background: C.errorBg, border: '1px solid ' + C.errorBorder, color: C.error }}>
                  <Icon name="AlertCircle" size={15} color="currentColor" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">

                {/* Email */}
                <div>
                  <label className="block text-sm font-semibold mb-1.5" style={{ color: C.navy }}>
                    Email Address
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Icon name="Mail" size={15} color={C.textMuted} />
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={function(e) { setEmail(e.target.value); setFieldErrors(function(p) { return Object.assign({}, p, { email: '' }); }); }}
                      placeholder="you@example.com"
                      autoComplete="email"
                      className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg transition-all"
                      style={Object.assign({ width: '100%' }, inputStyle(fieldErrors.email))}
                      onFocus={function(e) { if (!fieldErrors.email) { e.target.style.borderColor = C.primary; e.target.style.boxShadow = '0 0 0 3px rgba(52,193,221,0.15)'; }}}
                      onBlur={function(e) { if (!fieldErrors.email) { e.target.style.borderColor = C.border; e.target.style.boxShadow = 'none'; }}}
                    />
                  </div>
                  {fieldErrors.email && (
                    <p className="text-xs mt-1" style={{ color: C.error }}>{fieldErrors.email}</p>
                  )}
                </div>

                {/* Password */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-semibold" style={{ color: C.navy }}>Password</label>
                    <button
                      type="button"
                      onClick={function() { setShowForgot(true); setForgotEmail(email); }}
                      className="text-xs font-medium hover:underline transition-colors"
                      style={{ color: C.primary }}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Icon name="Lock" size={15} color={C.textMuted} />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={function(e) { setPassword(e.target.value); setFieldErrors(function(p) { return Object.assign({}, p, { password: '' }); }); }}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      className="w-full pl-10 pr-10 py-2.5 text-sm rounded-lg transition-all"
                      style={inputStyle(fieldErrors.password)}
                      onFocus={function(e) { if (!fieldErrors.password) { e.target.style.borderColor = C.primary; e.target.style.boxShadow = '0 0 0 3px rgba(52,193,221,0.15)'; }}}
                      onBlur={function(e) { if (!fieldErrors.password) { e.target.style.borderColor = C.border; e.target.style.boxShadow = 'none'; }}}
                    />
                    <button
                      type="button"
                      onClick={function() { setShowPassword(!showPassword); }}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center transition-colors"
                      style={{ color: C.textMuted }}
                      tabIndex={-1}
                    >
                      <Icon name={showPassword ? 'EyeOff' : 'Eye'} size={15} color="currentColor" />
                    </button>
                  </div>
                  {fieldErrors.password && (
                    <p className="text-xs mt-1" style={{ color: C.error }}>{fieldErrors.password}</p>
                  )}
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 text-sm font-bold rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
                  style={{
                    background: loading
                      ? 'linear-gradient(135deg, #1da8c5, #1596b0)'
                      : 'linear-gradient(135deg, #34c1dd, #1da8c5)',
                    color: C.navy,
                    opacity: loading ? 0.85 : 1,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 14px rgba(52,193,221,0.35)',
                    letterSpacing: '0.03em',
                  }}
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                      </svg>
                      Signing in...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Icon name="LogIn" size={16} color={C.navy} />
                      SIGN IN
                    </span>
                  )}
                </button>
              </form>

              {/* Register CTA */}
              <div className="mt-6 p-4 rounded-xl"
                style={{ border: '1px solid ' + C.border, background: C.bg }}>
                <p className="text-sm font-medium text-center mb-1" style={{ color: C.navy }}>
                  Are you a new company or sacco?
                </p>
                <p className="text-xs text-center mb-3" style={{ color: C.textMuted }}>
                  Register your business and choose a subscription plan
                </p>
                <button
                  onClick={function() { navigate('/admin-registration'); }}
                  className="w-full py-2.5 rounded-lg text-sm font-bold transition-all"
                  style={{
                    background: 'linear-gradient(135deg, #0c2037, #1a3a5c)',
                    color: '#34c1dd',
                    boxShadow: '0 4px 14px rgba(12,32,55,0.25)',
                  }}
                >
                  Register Your Company / Saccos
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoginPage;

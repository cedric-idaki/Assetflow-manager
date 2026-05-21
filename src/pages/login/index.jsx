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

  var inputStyle = function(hasError) {
    return {
      border: hasError ? '1.5px solid #ef4444' : '1.5px solid #D8DDE8',
      color: '#0A1628',
      background: hasError ? '#fef2f2' : '#FAFBFC',
      outline: 'none',
    };
  };

  return (
    <div className="min-h-screen flex">
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #1E429F 0%, #1A56DB 50%, #1C3FAA 100%)' }}
      >
        <div className="absolute top-0 left-0 right-0 h-1" style={{ background: 'linear-gradient(90deg, #FF6B35, #FF8C5A, #FF6B35)' }} />
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-20 right-20 w-64 h-64 rounded-full border-2 border-white" />
          <div className="absolute top-32 right-32 w-40 h-40 rounded-full border border-white" />
          <div className="absolute bottom-40 left-10 w-48 h-48 rounded-full border border-white" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-12 h-12 rounded-lg"
              style={{ background: 'linear-gradient(135deg, #FF6B35, #E85D2F)' }}>
              <Icon name="Building2" size={24} color="#0A1628" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">AssetFlow</h1>
              <p className="text-xs" style={{ color: '#FF8C5A' }}>Financial Management Platform</p>
            </div>
          </div>
        </div>
        <div className="relative z-10 flex-1 flex flex-col justify-center">
          <div className="w-12 h-0.5 mb-6" style={{ background: '#FF6B35' }} />
          <h2 className="text-4xl font-bold text-white leading-tight mb-4">
            Manage Your Assets and Collections
          </h2>
          <p className="text-base leading-relaxed mb-8" style={{ color: '#A8BDD4' }}>
            A comprehensive financial management platform for tracking assets, processing payments, and managing client relationships.
          </p>
          <div className="space-y-4">
            {[
              { icon: 'ShieldCheck', text: 'Role-based access with full audit trails' },
              { icon: 'TrendingUp', text: 'Real-time performance analytics and reports' },
              { icon: 'CreditCard', text: 'Integrated payment processing and collections' },
            ].map(function(item, i) {
              return (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-md flex-shrink-0"
                    style={{ background: 'rgba(201,168,76,0.15)', border: '1px solid rgba(201,168,76,0.3)' }}>
                    <Icon name={item.icon} size={15} color="#C9A84C" />
                  </div>
                  <span className="text-sm" style={{ color: '#A8BDD4' }}>{item.text}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="relative z-10">
          <p className="text-xs" style={{ color: '#5A7A9A' }}>
            &copy; {new Date().getFullYear()} AssetFlow. All rights reserved.
          </p>
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-center items-center p-8 bg-white">
        <div className="lg:hidden mb-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-lg mb-3"
            style={{ background: 'linear-gradient(135deg, #1B3A6B, #2C5282)' }}>
            <Icon name="Building2" size={26} color="white" />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: '#0A1628' }}>AssetFlow</h1>
        </div>

        <div className="w-full max-w-md">
          {showForgot ? (
            <div>
              <button
                onClick={function() { setShowForgot(false); setForgotSuccess(false); setForgotError(''); setForgotEmail(''); }}
                className="flex items-center gap-1.5 text-sm mb-6 hover:underline"
                style={{ color: '#5A6A85' }}
              >
                <Icon name="ArrowLeft" size={14} color="currentColor" /> Back to Login
              </button>

              {forgotSuccess ? (
                <div className="text-center py-6">
                  <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                    <Icon name="MailCheck" size={28} color="#10b981" />
                  </div>
                  <h2 className="text-xl font-bold mb-2" style={{ color: '#0A1628' }}>Check Your Email</h2>
                  <p className="text-sm mb-2" style={{ color: '#5A6A85' }}>We sent a password reset link to:</p>
                  <p className="text-sm font-bold mb-4" style={{ color: '#1B3A6B' }}>{forgotEmail}</p>
                  <p className="text-xs" style={{ color: '#94A3B8' }}>
                    Click the link in the email to set a new password. Check your spam folder if you do not see it.
                  </p>
                </div>
              ) : (
                <div>
                  <div className="mb-6">
                    <h2 className="text-2xl font-bold mb-1" style={{ color: '#0A1628' }}>Forgot Password?</h2>
                    <p className="text-sm" style={{ color: '#5A6A85' }}>Enter your email and we will send you a reset link</p>
                    <div className="mt-3 w-10 h-0.5" style={{ background: '#C9A84C' }} />
                  </div>
                  {forgotError && (
                    <div className="flex items-center gap-2 p-3 rounded-md text-sm mb-4"
                      style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#C0392B' }}>
                      <Icon name="AlertCircle" size={15} color="currentColor" />
                      {forgotError}
                    </div>
                  )}
                  <div className="mb-5">
                    <label className="block text-sm font-semibold mb-1.5" style={{ color: '#1B3A6B' }}>Email Address</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Icon name="Mail" size={15} color="#5A6A85" />
                      </div>
                      <input
                        type="email"
                        value={forgotEmail}
                        onChange={function(e) { setForgotEmail(e.target.value); }}
                        placeholder="you@example.com"
                        className="w-full pl-10 pr-4 py-2.5 text-sm rounded-md transition-all"
                        style={{ border: '1.5px solid #D8DDE8', color: '#0A1628', background: '#FAFBFC', outline: 'none' }}
                        onFocus={function(e) { e.target.style.borderColor = '#1B3A6B'; e.target.style.boxShadow = '0 0 0 3px rgba(27,58,107,0.1)'; }}
                        onBlur={function(e) { e.target.style.borderColor = '#D8DDE8'; e.target.style.boxShadow = 'none'; }}
                        onKeyDown={function(e) { if (e.key === 'Enter') handleForgotPassword(); }}
                      />
                    </div>
                  </div>
                  <button
                    onClick={handleForgotPassword}
                    disabled={forgotLoading}
                    className="w-full py-3 px-4 text-sm font-bold rounded-md flex items-center justify-center gap-2 disabled:opacity-70"
                    style={{ background: 'linear-gradient(135deg, #1B3A6B, #2C5282)', color: '#FFFFFF', boxShadow: '0 4px 14px rgba(27,58,107,0.35)' }}
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
                        <Icon name="Send" size={15} color="white" />
                        Send Reset Link
                      </span>
                    )}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="mb-8">
                <h2 className="text-2xl font-bold mb-1" style={{ color: '#0A1628' }}>Welcome Back</h2>
                <p className="text-sm" style={{ color: '#5A6A85' }}>Sign in to access your dashboard</p>
                <div className="mt-3 w-10 h-0.5" style={{ background: '#C9A84C' }} />
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 rounded-md text-sm mb-5"
                  style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#C0392B' }}>
                  <Icon name="AlertCircle" size={15} color="currentColor" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold mb-1.5" style={{ color: '#1B3A6B' }}>Email Address</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Icon name="Mail" size={15} color="#5A6A85" />
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={function(e) { setEmail(e.target.value); setFieldErrors(function(p) { return Object.assign({}, p, { email: '' }); }); }}
                      placeholder="you@example.com"
                      className="w-full pl-10 pr-4 py-2.5 text-sm rounded-md transition-all"
                      style={Object.assign({ width: '100%' }, inputStyle(fieldErrors.email))}
                      onFocus={function(e) { if (!fieldErrors.email) { e.target.style.borderColor = '#1B3A6B'; e.target.style.boxShadow = '0 0 0 3px rgba(27,58,107,0.1)'; }}}
                      onBlur={function(e) { if (!fieldErrors.email) { e.target.style.borderColor = '#D8DDE8'; e.target.style.boxShadow = 'none'; }}}
                    />
                  </div>
                  {fieldErrors.email && (
                    <p className="text-xs mt-1" style={{ color: '#ef4444' }}>{fieldErrors.email}</p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-semibold" style={{ color: '#1B3A6B' }}>Password</label>
                    <button
                      type="button"
                      onClick={function() { setShowForgot(true); setForgotEmail(email); }}
                      className="text-xs font-medium hover:underline"
                      style={{ color: '#C9A84C' }}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Icon name="Lock" size={15} color="#5A6A85" />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={function(e) { setPassword(e.target.value); setFieldErrors(function(p) { return Object.assign({}, p, { password: '' }); }); }}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-10 py-2.5 text-sm rounded-md transition-all"
                      style={inputStyle(fieldErrors.password)}
                      onFocus={function(e) { if (!fieldErrors.password) { e.target.style.borderColor = '#1B3A6B'; e.target.style.boxShadow = '0 0 0 3px rgba(27,58,107,0.1)'; }}}
                      onBlur={function(e) { if (!fieldErrors.password) { e.target.style.borderColor = '#D8DDE8'; e.target.style.boxShadow = 'none'; }}}
                    />
                    <button
                      type="button"
                      onClick={function() { setShowPassword(!showPassword); }}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center"
                      style={{ color: '#5A6A85' }}
                    >
                      <Icon name={showPassword ? 'EyeOff' : 'Eye'} size={15} color="currentColor" />
                    </button>
                  </div>
                  {fieldErrors.password && (
                    <p className="text-xs mt-1" style={{ color: '#ef4444' }}>{fieldErrors.password}</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 text-sm font-bold rounded-md transition-all duration-200 flex items-center justify-center gap-2"
                  style={{ background: loading ? '#2C5282' : 'linear-gradient(135deg, #1B3A6B, #2C5282)', color: '#FFFFFF', opacity: loading ? 0.8 : 1, cursor: loading ? 'not-allowed' : 'pointer', boxShadow: '0 4px 14px rgba(27,58,107,0.35)', letterSpacing: '0.03em' }}
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <Icon name="Loader2" size={16} color="white" />
                      Signing in...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Icon name="LogIn" size={16} color="white" />
                      SIGN IN
                    </span>
                  )}
                </button>
              </form>

              <div className="mt-6 p-4 rounded-xl border border-border bg-muted/30 text-center">
                <p className="text-sm font-medium text-foreground mb-1">Are you a new company?</p>
                <p className="text-xs text-muted-foreground mb-3">
                  Register your business and choose a subscription plan
                </p>
                <button
                  onClick={function() { navigate('/admin-registration'); }}
                  className="w-full py-2.5 rounded-lg text-sm font-bold transition-all"
                  style={{ background: 'linear-gradient(135deg, #FF6B35, #E85D2F)', color: '#fff' }}
                >
                  Register Your Company
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

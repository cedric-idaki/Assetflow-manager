import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase, setRememberDevice as persistRememberChoice, REMEMBER_DEVICE_KEY } from '../../lib/supabase';
import Icon from '../../components/AppIcon';
import BrandPreviewPanel from '../../components/BrandPreviewPanel';
import { isAndroidAppContext } from '../../utils/androidApp';

const STEPS = [
  'Sign in with the account your team set up for you.',
  ['Land on ', 'your', ' portal — client, member, or admin.'],
  'Apply, vote, sign, and track balances — same day.',
];

// System colors — unchanged from the previous login screen.
const C = {
  primary:     '#34c1dd',
  primaryDark: '#1da8c5',
  // Small accent text on light: #1da8c5 only reaches 2.8:1. Shared with the
  // landing page's --accent-deep so the two screens use one accent.
  accentDeep:  '#0a4a5a',
  primarySoft: '#5dd3e8',
  navy:        '#0c2037',
  navyMid:     '#1a3a5c',
  // Cyan ground with a white form card, matching the landing page.
  bg:          '#34c1dd',
  bg2:         '#effafd',
  card:        '#ffffff',
  border:      '#d0dce6',
  inputBg:     '#f5f8fa',
  text:        '#0c2037',
  // Darkened off #5a7185, which only reached 3.2:1 against the cyan ground.
  textMuted:   '#1f3d4d',
  onNavy:      '#ffffff',
  onNavyMuted: '#7a9cb8',
  onNavyFaint: '#3a5a7a',
  lineOnNavy:  'rgba(52,193,221,0.16)',
  error:       '#b91c1c',
  errorBg:     '#fef2f2',
  errorBorder: '#fecaca',
};

// The system's own type roles standing in for the mock-up's three families:
// Georgia = display, Open Sans = body and labels, Courier = figures only.
const SERIF = { fontFamily: "Georgia, 'Times New Roman', serif" };

// Courier is this system's data face — reserve it for numbers, the way
// `.data-text` does in tailwind.css. Using it for UI labels reads as typewriter.
const MONO = { fontFamily: "'Courier New', Courier, monospace", fontVariantNumeric: 'tabular-nums' };

// Small uppercase labels get their character from tracking, not from a mono face.
const LABEL = {
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
};

/* ── Page ─────────────────────────────────────────────────────────────────── */

const LoginPage = () => {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  // Remembered by default — matches how the app behaved before this option existed.
  const [rememberDevice, setRememberDevice] = useState(function() {
    try {
      return window.localStorage.getItem(REMEMBER_DEVICE_KEY) !== 'session-only';
    } catch {
      return true;
    }
  });

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
      // Decide where the session gets written *before* it is issued.
      persistRememberChoice(rememberDevice);
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

  var primaryButtonStyle = function(isBusy) {
    return {
      background: isBusy
        ? 'linear-gradient(135deg, #1da8c5, #1596b0)'
        : 'linear-gradient(135deg, #34c1dd, #1da8c5)',
      color: C.navy,
      opacity: isBusy ? 0.85 : 1,
      cursor: isBusy ? 'not-allowed' : 'pointer',
      boxShadow: '0 4px 14px rgba(52,193,221,0.35)',
      letterSpacing: '0.03em',
    };
  };

  const brand = (
    <div className="relative z-10 flex items-center gap-3">
      {/* Navy tile with a cyan glyph — the landing page's brand-mark. A cyan
          tile would disappear into the cyan ground. */}
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: C.navy, boxShadow: '0 4px 14px rgba(12,32,55,0.30)' }}
      >
        <Icon name="Building2" size={22} color={C.primary} />
      </div>
      <div style={{ ...SERIF, fontSize: '20px', fontWeight: 700, letterSpacing: '-0.01em', color: C.navy }}>Ararat</div>
    </div>
  );

  return (
    <div
      className="min-h-screen lg:grid"
      style={{ background: C.bg, gridTemplateColumns: '1fr 1.12fr' }}
    >
      {/* Focus rings, the signature stroke and the stamp fade need real CSS. */}
      <style>{`
        .al-shell {
          display: flex;
          align-items: center;
          background: ${C.inputBg};
          border: 1.5px solid ${C.border};
          border-radius: 8px;
          transition: border-color .15s ease, box-shadow .15s ease;
        }
        .al-shell:focus-within {
          border-color: ${C.primary};
          box-shadow: 0 0 0 3px rgba(52,193,221,0.15);
        }
        .al-shell.al-shell-error {
          background: ${C.errorBg};
          border-color: ${C.error};
        }
        .al-shell input {
          flex: 1;
          min-width: 0;
          border: none;
          background: transparent;
          outline: none;
          font-size: 14px;
          padding: 11px 14px;
          color: ${C.text};
        }
        .al-shell input::placeholder { color: #9aacba; }
        .al-check {
          appearance: none;
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          flex-shrink: 0;
          margin: 0;
          border: 1.5px solid ${C.border};
          border-radius: 3px;
          background: ${C.card};
          cursor: pointer;
          position: relative;
          transition: background .15s ease, border-color .15s ease;
        }
        .al-check:checked {
          background: ${C.primaryDark};
          border-color: ${C.primaryDark};
        }
        .al-check:checked::after {
          content: "";
          position: absolute;
          left: 4px;
          top: 0.5px;
          width: 4px;
          height: 8px;
          border: solid ${C.card};
          border-width: 0 2px 2px 0;
          transform: rotate(40deg);
        }
        .al-check:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px rgba(52,193,221,0.25);
        }
      `}</style>

      {/* ── Left: sign-in ──────────────────────────────────────────────── */}
      <div
        className="relative flex flex-col min-h-screen px-6 py-8 sm:px-12 sm:py-9"
        style={{
          background: 'radial-gradient(700px 340px at 10% -10%, rgba(255,255,255,0.30), transparent 60%), ' + C.bg,
        }}
      >
        {brand}

        {/* The form sits in a white card on the cyan, the way the landing page
            floats its cards — so every control inside keeps its light-ground
            colours and needs no re-tuning. */}
        <div
          className="relative z-10 flex flex-col justify-center w-full max-w-[440px] mx-auto my-auto px-7 py-9 sm:px-9 rounded-2xl"
          style={{ background: C.card, boxShadow: '0 24px 56px -28px rgba(12,32,55,0.45)' }}
        >

          {/* ── Forgot password ── */}
          {showForgot ? (
            <div>
              <button
                onClick={function() { setShowForgot(false); setForgotSuccess(false); setForgotError(''); setForgotEmail(''); }}
                className="flex items-center gap-1.5 text-sm mb-6 hover:underline transition-colors"
                style={{ color: C.textMuted }}
              >
                <Icon name="ArrowLeft" size={14} color="currentColor" /> Back to sign in
              </button>

              {forgotSuccess ? (
                <div className="text-center py-6">
                  <div
                    className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                    style={{ background: 'rgba(52,193,221,0.12)', border: '2px solid rgba(52,193,221,0.3)' }}
                  >
                    <Icon name="MailCheck" size={28} color={C.primary} />
                  </div>
                  <h2 style={{ ...SERIF, fontSize: '24px', fontWeight: 700, color: C.navy, marginBottom: '8px' }}>
                    Check your email
                  </h2>
                  <p className="text-sm mb-2" style={{ color: C.textMuted }}>We sent a password reset link to:</p>
                  <p className="text-sm font-bold mb-4" style={{ ...MONO, color: C.accentDeep }}>{forgotEmail}</p>
                  <p className="text-xs" style={{ color: C.textMuted }}>
                    Click the link in the email to set a new password. Check your spam folder if you do not see it.
                  </p>
                </div>
              ) : (
                <div>
                  <div
                    className="inline-flex items-center gap-2 rounded mb-5"
                    style={{ ...LABEL, fontSize: '12px', color: C.accentDeep, background: C.bg2, border: '1px solid ' + C.border, padding: '6px 11px 6px 9px', width: 'fit-content' }}
                  >
                    <span className="rounded-full" style={{ width: '6px', height: '6px', background: C.primary }} />
                    Password reset
                  </div>
                  <h1 style={{ ...SERIF, fontSize: 'clamp(26px, 3.2vw, 34px)', lineHeight: 1.12, fontWeight: 700, letterSpacing: '-0.01em', color: C.navy }}>
                    Let&rsquo;s get you<br />back in<span style={{ color: C.accentDeep }}>.</span>
                  </h1>
                  <p className="mt-2.5 text-sm" style={{ color: C.textMuted, maxWidth: '38ch' }}>
                    Enter your email address and we&rsquo;ll send you a link to set a new password.
                  </p>

                  {forgotError && (
                    <div
                      className="flex items-center gap-2 p-3 rounded-lg text-sm mt-5"
                      style={{ background: C.errorBg, border: '1px solid ' + C.errorBorder, color: C.error }}
                    >
                      <Icon name="AlertCircle" size={15} color="currentColor" />
                      {forgotError}
                    </div>
                  )}

                  <div className="mt-6 mb-4">
                    <label htmlFor="forgot-email" className="block mb-1.5" style={{ ...LABEL, color: C.textMuted }}>
                      Email address
                    </label>
                    <div className="al-shell">
                      <span className="pl-3.5 flex items-center">
                        <Icon name="Mail" size={15} color={C.textMuted} />
                      </span>
                      <input
                        id="forgot-email"
                        type="email"
                        value={forgotEmail}
                        onChange={function(e) { setForgotEmail(e.target.value); }}
                        placeholder="you@yourbusiness.co.ke"
                        autoComplete="email"
                        onKeyDown={function(e) { if (e.key === 'Enter') handleForgotPassword(); }}
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleForgotPassword}
                    disabled={forgotLoading}
                    className="w-full py-3 px-4 text-sm font-bold rounded-lg flex items-center justify-center gap-2 transition-all"
                    style={primaryButtonStyle(forgotLoading)}
                  >
                    {forgotLoading ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                        </svg>
                        Sending...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Icon name="Send" size={15} color={C.navy} />
                        Send reset link
                      </span>
                    )}
                  </button>
                </div>
              )}
            </div>

          ) : (
            /* ── Sign in ── */
            <div>
              <div
                className="inline-flex items-center gap-2 rounded mb-5"
                style={{ ...LABEL, fontSize: '12px', color: C.accentDeep, background: C.bg2, border: '1px solid ' + C.border, padding: '6px 11px 6px 9px', width: 'fit-content' }}
              >
                <span className="rounded-full" style={{ width: '6px', height: '6px', background: C.primary }} />
                Member sign-in
              </div>

              <h1 style={{ ...SERIF, fontSize: 'clamp(26px, 3.2vw, 34px)', lineHeight: 1.12, fontWeight: 700, letterSpacing: '-0.01em', color: C.navy }}>
                Good to see you<br />back<span style={{ color: C.accentDeep }}>.</span>
              </h1>
              <p className="mt-2.5 text-sm" style={{ color: C.textMuted, maxWidth: '38ch' }}>
                Sign in and pick up right where you left off no re-learning, no lost work.
              </p>

              {error && (
                <div
                  className="flex items-center gap-2 p-3 rounded-lg text-sm mt-5"
                  style={{ background: C.errorBg, border: '1px solid ' + C.errorBorder, color: C.error }}
                >
                  <Icon name="AlertCircle" size={15} color="currentColor" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-6">

                {/* Email */}
                <div className="mb-4">
                  <label htmlFor="login-email" className="block mb-1.5" style={{ ...LABEL, color: C.textMuted }}>
                    Email address
                  </label>
                  <div className={'al-shell' + (fieldErrors.email ? ' al-shell-error' : '')}>
                    <span className="pl-3.5 flex items-center">
                      <Icon name="Mail" size={15} color={C.textMuted} />
                    </span>
                    <input
                      id="login-email"
                      type="email"
                      value={email}
                      onChange={function(e) { setEmail(e.target.value); setFieldErrors(function(p) { return Object.assign({}, p, { email: '' }); }); }}
                      placeholder="you@yourbusiness.co.ke"
                      autoComplete="email"
                    />
                  </div>
                  {fieldErrors.email && (
                    <p className="text-xs mt-1" style={{ color: C.error }}>{fieldErrors.email}</p>
                  )}
                </div>

                {/* Password */}
                <div className="mb-1">
                  <label htmlFor="login-password" className="block mb-1.5" style={{ ...LABEL, color: C.textMuted }}>
                    Password
                  </label>
                  <div className={'al-shell' + (fieldErrors.password ? ' al-shell-error' : '')}>
                    <span className="pl-3.5 flex items-center">
                      <Icon name="Lock" size={15} color={C.textMuted} />
                    </span>
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={function(e) { setPassword(e.target.value); setFieldErrors(function(p) { return Object.assign({}, p, { password: '' }); }); }}
                      placeholder="Enter your password"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={function() { setShowPassword(!showPassword); }}
                      className="flex items-center px-3.5 self-stretch transition-colors"
                      style={{ color: C.textMuted, background: 'none', border: 'none', cursor: 'pointer' }}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      tabIndex={-1}
                    >
                      <Icon name={showPassword ? 'EyeOff' : 'Eye'} size={16} color="currentColor" />
                    </button>
                  </div>
                  {fieldErrors.password && (
                    <p className="text-xs mt-1" style={{ color: C.error }}>{fieldErrors.password}</p>
                  )}
                </div>

                {/* Remember this device / forgot password */}
                <div className="flex items-center justify-between mt-2.5 mb-5">
                  <label
                    className="flex items-center gap-2.5 cursor-pointer text-[13.5px]"
                    style={{ color: C.textMuted }}
                  >
                    <input
                      type="checkbox"
                      className="al-check"
                      checked={rememberDevice}
                      onChange={function(e) { setRememberDevice(e.target.checked); }}
                    />
                    Remember this device
                  </label>
                  <button
                    type="button"
                    onClick={function() { setShowForgot(true); setForgotEmail(email); }}
                    className="text-[13.5px] font-semibold hover:underline transition-colors"
                    style={{ color: C.accentDeep, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    Forgot password?
                  </button>
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 text-sm font-bold rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
                  style={primaryButtonStyle(loading)}
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
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

              {/* Register CTA — web only. In the Play Store app this whole block
                  is gone: it advertises subscription plans and leads to the
                  M-Pesa checkout, which is the flow Google Play Billing policy
                  governs. Customers register on the web and sign in here. */}
              {!isAndroidAppContext() && (
                <div>
                  <div
                    className="flex items-center gap-3.5 my-5"
                    style={{ ...LABEL, color: C.textMuted }}
                  >
                    <span className="flex-1" style={{ height: '1px', background: C.border }} />
                    New to Ararat?
                    <span className="flex-1" style={{ height: '1px', background: C.border }} />
                  </div>

                  <p className="text-sm text-center mb-3" style={{ color: C.textMuted }}>
                    Register your organization and choose a subscription plan
                  </p>

                  {/* Two entry points — `orgType` preselects the "I'm registering a"
                      choice on the first step of the registration form. */}
                  <div className="space-y-2">
                    <button
                      onClick={function() { navigate('/admin-registration', { state: { orgType: 'company' } }); }}
                      className="w-full py-2.5 rounded-lg text-sm font-bold transition-all"
                      style={{
                        background: 'linear-gradient(135deg, #0c2037, #1a3a5c)',
                        color: C.primary,
                        boxShadow: '0 4px 14px rgba(12,32,55,0.25)',
                      }}
                    >
                      Register Your Company
                    </button>
                    <button
                      onClick={function() { navigate('/admin-registration', { state: { orgType: 'sacco' } }); }}
                      className="w-full py-2.5 rounded-lg text-sm font-bold transition-all"
                      style={{ background: C.card, color: C.navy, border: '1.5px solid ' + C.navy }}
                    >
                      Register Your Chama / Sacco
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="relative z-10 pt-3 text-xs" style={{ color: C.textMuted }}>
          Every shilling accounted for. Every payment tracked.
        </div>
      </div>

      {/* ── Right: product preview ─────────────────────────────────────── */}
      <BrandPreviewPanel steps={STEPS} />
    </div>
  );
};

export default LoginPage;

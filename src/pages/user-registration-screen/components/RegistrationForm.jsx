/**
 * Direct client registration.
 *
 * The door a client uses to join a company WITHOUT a sales agent. Before this
 * the form was a bare supabase.auth.signUp: no tenant, no clients row, and
 * handle_new_user() clamped the role to 'operations', so the account it made
 * could not open the client portal it was sent to. Nothing linked to the page,
 * which is probably why nobody noticed.
 *
 * Two codes drive it, and which of them is present is the whole feature:
 *
 *   • the COMPANY's registration code — required, and the only thing that says
 *     whose client book this person joins. Every clients row is tenant-scoped
 *     by admin_id, so there is no such thing as a client of nobody.
 *   • the SALES AGENT's code — optional. Supply one and the account is recorded
 *     as agent-acquired and the agent keeps their commission; leave it blank and
 *     it is recorded as direct.
 *
 * Neither decision is made here. The page posts both codes to the
 * `register-client` Edge Function, which resolves them inside
 * register_direct_client() — so a crafted request cannot pick its own tenant,
 * claim someone else's agent, or set its own acquisition channel.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import Icon from '../../../components/AppIcon';
import TermsModal from '../../../components/TermsModal';
import { formatKEPhone } from '../../../utils/phoneUtils';
import { isPasswordStrong } from '../../../utils/validation';
import PasswordStrengthMeter from './PasswordStrengthMeter';

const C = {
  navy:      '#0A1628',
  gold:      '#C9A84C',
  goldDeep:  '#8A6D1F',
  muted:     '#5A6A85',
  border:    '#E2E8F0',
  inputBg:   '#F8FAFC',
};

const emailOk = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());

/**
 * Call the public backend.
 *
 * Same treatment PublicListing gives listing-public: the server's own wording is
 * written for a member of the public and is passed straight through, while a
 * transport failure ("Failed to send a request to the Edge Function") becomes
 * plain language, because that sentence tells a registrant nothing.
 */
async function callRegisterClient(body) {
  const { data, error } = await supabase.functions.invoke('register-client', { body });

  if (error) {
    let serverMessage = null;
    let serverCode = null;
    try {
      const j = await error.context?.json?.();
      if (j?.error) serverMessage = j.error;
      if (j?.code) serverCode = j.code;
    } catch { /* no JSON body — a transport failure */ }

    if (serverMessage) {
      const err = new Error(serverMessage);
      err.code = serverCode;
      throw err;
    }

    const err = new Error('We could not reach the registration service just now. Check your connection and try again.');
    err.retryable = true;
    throw err;
  }

  if (data?.error) throw new Error(data.error);
  return data;
}

// ── Field shell ─────────────────────────────────────────────────────────────
const Field = ({ label, error, hint, children }) => (
  <div>
    <label className="block text-sm font-medium mb-1.5" style={{ color: C.navy }}>{label}</label>
    {children}
    {error ? (
      <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
        <Icon name="AlertCircle" size={12} color="currentColor" />
        {error}
      </p>
    ) : hint ? (
      <p className="mt-1.5 text-xs" style={{ color: C.muted }}>{hint}</p>
    ) : null}
  </div>
);

const inputClass = (invalid, valid) =>
  `w-full pl-10 pr-10 py-2.5 border rounded-xl text-sm transition-all focus:outline-none focus:ring-2 ${
    invalid ? 'border-red-400 focus:ring-red-200'
    : valid  ? 'border-emerald-400 focus:ring-emerald-200'
             : 'border-slate-300 focus:ring-blue-200 focus:border-blue-400'
  }`;

// ── Success ─────────────────────────────────────────────────────────────────
/**
 * What the client is told they have.
 *
 * Deliberately not "you're all set". A self-registered account is created
 * `pending` — the company has never met this person — so the screen says what
 * exists (a login, an account number) and what has not happened yet
 * (activation), rather than implying they can start transacting.
 */
const RegistrationSuccess = ({ result, onSignIn }) => (
  <div className="text-center">
    <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-5">
      <Icon name="CheckCircle" size={30} color="#059669" />
    </div>

    <h3 className="text-xl font-bold mb-1" style={{ color: C.navy, fontFamily: 'Merriweather, serif' }}>
      Account created
    </h3>
    <p className="text-sm mb-5" style={{ color: C.muted }}>
      You are now registered with {result.company?.name || 'the company'}.
    </p>

    <div className="rounded-xl p-4 space-y-2.5 text-left mb-4" style={{ background: C.inputBg, border: `1px solid ${C.border}` }}>
      <div className="flex justify-between items-center text-sm">
        <span style={{ color: C.muted }}>Account number</span>
        <span className="font-mono font-semibold" style={{ color: C.navy }}>{result.accountNumber || '—'}</span>
      </div>
      <div className="flex justify-between items-center text-sm">
        <span style={{ color: C.muted }}>Registered</span>
        <span className="font-semibold" style={{ color: C.navy }}>
          {result.acquisitionChannel === 'agent'
            ? `Through ${result.agentName || 'a sales agent'}`
            : 'Directly'}
        </span>
      </div>
    </div>

    <div className="rounded-xl p-3 text-left text-xs mb-5 bg-amber-50 border border-amber-200 text-amber-800">
      <div className="flex items-start gap-2">
        <Icon name="Clock" size={14} color="currentColor" />
        <span>
          Your account is awaiting activation by {result.company?.name || 'the company'}. You can sign in
          now and upload your KYC documents — the rest opens up once they activate you.
        </span>
      </div>
    </div>

    <button
      onClick={onSignIn}
      className="w-full py-2.5 px-4 text-white font-semibold rounded-xl text-sm transition-all"
      style={{ background: `linear-gradient(135deg, ${C.navy}, #1B3A6B)` }}
    >
      Sign in to your portal
    </button>
  </div>
);

// ── Main form ───────────────────────────────────────────────────────────────
const RegistrationForm = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // Both codes may arrive in the link — that is the point of the link. `agent`
  // is what turns a shared registration URL into an attributed one.
  const codeFromUrl  = (params.get('code')  || '').trim();
  const agentFromUrl = (params.get('agent') || '').trim();

  const [code, setCode] = useState(codeFromUrl);
  const [company, setCompany] = useState(null);      // resolved tenant, or null
  const [resolving, setResolving] = useState(Boolean(codeFromUrl));
  const [codeError, setCodeError] = useState('');

  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    agentCode: agentFromUrl,
    password: '',
    confirmPassword: '',
    agreeTerms: false,
  });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');
  const [result, setResult] = useState(null);
  const [showTerms, setShowTerms] = useState(false);

  // ── Resolve the company code ──────────────────────────────────────────────
  const resolveCode = useCallback(async (raw) => {
    const value = String(raw || '').trim();
    if (!value) {
      setCodeError('Enter the registration code your company gave you.');
      return;
    }
    setResolving(true);
    setCodeError('');
    try {
      const data = await callRegisterClient({ action: 'resolve', code: value });
      setCompany(data?.company || null);
      setCode(value);
    } catch (err) {
      setCompany(null);
      setCodeError(err?.message || 'That registration code was not recognised.');
    } finally {
      setResolving(false);
    }
  }, []);

  useEffect(() => {
    if (codeFromUrl) resolveCode(codeFromUrl);
    // Only on the code the page was opened with; later attempts go through the
    // form's own button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeFromUrl]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : (name === 'phone' ? formatKEPhone(value) : value),
    }));
    if (errors?.[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
    setServerError('');
  };

  const validate = () => {
    const next = {};
    if (!formData.fullName.trim()) next.fullName = 'Your full name is required';
    else if (formData.fullName.trim().length < 2) next.fullName = 'Please give your full name';

    if (!formData.email) next.email = 'Email is required';
    else if (!emailOk(formData.email)) next.email = 'Please enter a valid email address';

    if (!formData.password) next.password = 'Password is required';
    else if (!isPasswordStrong(formData.password)) next.password = 'Password does not meet all requirements';

    if (!formData.confirmPassword) next.confirmPassword = 'Please confirm your password';
    else if (formData.password !== formData.confirmPassword) next.confirmPassword = 'Passwords do not match';

    if (!formData.agreeTerms) next.agreeTerms = 'You must accept the terms of service';
    return next;
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setLoading(true);
    setServerError('');
    try {
      const data = await callRegisterClient({
        action: 'register',
        code,
        fullName: formData.fullName.trim(),
        email: formData.email.trim().toLowerCase(),
        phone: formData.phone.trim() || null,
        agentCode: formData.agentCode.trim() || null,
        password: formData.password,
      });
      setResult(data);
    } catch (err) {
      setServerError(err?.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return <RegistrationSuccess result={result} onSignIn={() => navigate('/login')} />;
  }

  // ── Step 1: which company? ────────────────────────────────────────────────
  // Until the code resolves there is nothing useful to ask. A name and a
  // password with no tenant behind them is exactly the orphaned account this
  // page used to produce.
  if (!company) {
    return (
      <div className="space-y-5">
        <div className="rounded-xl p-4" style={{ background: C.inputBg, border: `1px solid ${C.border}` }}>
          <div className="flex items-start gap-2.5">
            <Icon name="Info" size={15} color={C.goldDeep} />
            <p className="text-xs leading-relaxed" style={{ color: C.muted }}>
              Client accounts belong to the company you deal with. Enter the registration
              code from their link, card or poster — or ask them for it.
            </p>
          </div>
        </div>

        <Field
          label="Registration code"
          error={codeError}
          hint="8 characters, e.g. K7M2PQR4"
        >
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Icon name="KeyRound" size={16} color="#94A3B8" />
            </div>
            <input
              type="text"
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); resolveCode(code); } }}
              placeholder="K7M2PQR4"
              autoComplete="off"
              spellCheck={false}
              maxLength={16}
              className={`${inputClass(Boolean(codeError), false)} font-mono tracking-widest uppercase`}
              style={{ background: '#fff' }}
            />
          </div>
        </Field>

        <button
          type="button"
          onClick={() => resolveCode(code)}
          disabled={resolving}
          className="w-full py-2.5 px-4 text-white font-semibold rounded-xl text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{ background: `linear-gradient(135deg, ${C.navy}, #1B3A6B)` }}
        >
          {resolving ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              Checking…
            </>
          ) : (
            <>
              <Icon name="ArrowRight" size={16} color="white" />
              Continue
            </>
          )}
        </button>
      </div>
    );
  }

  const passwordsMatch = formData.confirmPassword.length > 0 && formData.password === formData.confirmPassword;
  const passwordMismatch = formData.confirmPassword.length > 0 && formData.password !== formData.confirmPassword;

  // ── Step 2: the client's details ──────────────────────────────────────────
  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {/* Which company — the answer to "whose client am I becoming?" */}
        <div className="rounded-xl p-3.5 flex items-start justify-between gap-3" style={{ background: C.inputBg, border: `1px solid ${C.border}` }}>
          <div className="flex items-start gap-2.5 min-w-0">
            <Icon name="Building2" size={16} color={C.goldDeep} />
            <div className="min-w-0">
              <p className="text-xs" style={{ color: C.muted }}>Registering with</p>
              <p className="text-sm font-semibold truncate" style={{ color: C.navy }}>
                {company.name}{company.city ? ` · ${company.city}` : ''}
              </p>
            </div>
          </div>
          {!codeFromUrl && (
            <button
              type="button"
              onClick={() => { setCompany(null); setCode(''); }}
              className="text-xs font-medium hover:underline flex-shrink-0"
              style={{ color: C.goldDeep }}
            >
              Change
            </button>
          )}
        </div>

        {serverError && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            <Icon name="AlertCircle" size={16} color="currentColor" />
            <span>{serverError}</span>
          </div>
        )}

        {/* Full name */}
        <Field label="Full name" error={errors.fullName}>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Icon name="User" size={16} color="#94A3B8" />
            </div>
            <input
              type="text"
              name="fullName"
              value={formData.fullName}
              onChange={handleChange}
              placeholder="As it appears on your ID"
              autoComplete="name"
              className={inputClass(Boolean(errors.fullName), false)}
            />
          </div>
        </Field>

        {/* Email */}
        <Field label="Email address" error={errors.email}>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Icon name="Mail" size={16} color="#94A3B8" />
            </div>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="you@example.com"
              autoComplete="email"
              className={inputClass(Boolean(errors.email), formData.email && !errors.email && emailOk(formData.email))}
            />
            {formData.email && !errors.email && emailOk(formData.email) && (
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <Icon name="CheckCircle" size={16} color="#059669" />
              </div>
            )}
          </div>
        </Field>

        {/* Phone */}
        <Field label="Phone number" hint="Optional — how the company reaches you about your account">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Icon name="Phone" size={16} color="#94A3B8" />
            </div>
            <input
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              placeholder="+254 7XX XXX XXX"
              autoComplete="tel"
              className={inputClass(false, false)}
            />
          </div>
        </Field>

        {/* Sales agent code — the one field that decides the acquisition channel */}
        <Field
          label="Sales agent code"
          hint={
            formData.agentCode.trim()
              ? 'Your account will be credited to this agent.'
              : 'Optional. Leave blank if nobody referred you — you will be registered as a direct client.'
          }
        >
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Icon name={formData.agentCode.trim() ? 'UserCheck' : 'UserPlus'} size={16} color="#94A3B8" />
            </div>
            <input
              type="text"
              name="agentCode"
              value={formData.agentCode}
              onChange={handleChange}
              placeholder="e.g. AGT-1042"
              autoComplete="off"
              spellCheck={false}
              maxLength={32}
              className={`${inputClass(false, false)} font-mono`}
            />
          </div>
        </Field>

        {/* Password */}
        <Field label="Password" error={errors.password}>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Icon name="Lock" size={16} color="#94A3B8" />
            </div>
            <input
              type={showPassword ? 'text' : 'password'}
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Create a strong password"
              autoComplete="new-password"
              className={inputClass(Boolean(errors.password), false)}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
            >
              <Icon name={showPassword ? 'EyeOff' : 'Eye'} size={16} color="currentColor" />
            </button>
          </div>
          <PasswordStrengthMeter password={formData.password} />
        </Field>

        {/* Confirm password */}
        <Field
          label="Confirm password"
          error={errors.confirmPassword || (passwordMismatch ? 'Passwords do not match' : '')}
        >
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Icon name="Lock" size={16} color="#94A3B8" />
            </div>
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="Re-enter your password"
              autoComplete="new-password"
              className={inputClass(Boolean(errors.confirmPassword) || passwordMismatch, passwordsMatch)}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
            >
              <Icon name={showConfirmPassword ? 'EyeOff' : 'Eye'} size={16} color="currentColor" />
            </button>
          </div>
          {passwordsMatch && !errors.confirmPassword && (
            <p className="mt-1.5 text-xs text-emerald-600 flex items-center gap-1">
              <Icon name="CheckCircle" size={12} color="currentColor" />
              Passwords match
            </p>
          )}
        </Field>

        {/* Terms */}
        <div>
          <label className="flex items-start gap-3 cursor-pointer group">
            <div className="relative mt-0.5 flex-shrink-0">
              <input
                type="checkbox"
                name="agreeTerms"
                checked={formData.agreeTerms}
                onChange={handleChange}
                className="sr-only"
              />
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                formData.agreeTerms
                  ? 'bg-blue-600 border-blue-600'
                  : errors.agreeTerms
                  ? 'border-red-400 bg-white'
                  : 'border-slate-400 bg-white group-hover:border-blue-500'
              }`}>
                {formData.agreeTerms && (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </div>
            <span className="text-sm leading-tight" style={{ color: C.muted }}>
              I agree to the{' '}
              <button
                type="button"
                onClick={() => setShowTerms(true)}
                className="font-medium underline underline-offset-2"
                style={{ color: C.goldDeep }}
              >
                Terms &amp; Privacy Policy
              </button>
            </span>
          </label>
          {errors.agreeTerms && (
            <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
              <Icon name="AlertCircle" size={12} color="currentColor" />
              {errors.agreeTerms}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 px-4 text-white font-semibold rounded-xl text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={{ background: `linear-gradient(135deg, ${C.navy}, #1B3A6B)` }}
        >
          {loading ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <span>Creating account…</span>
            </>
          ) : (
            <>
              <Icon name="UserPlus" size={16} color="white" />
              <span>Create Account</span>
            </>
          )}
        </button>

        <p className="text-xs text-center leading-relaxed" style={{ color: C.muted }}>
          Are you a company looking to use Ararat?{' '}
          <Link to="/admin-registration" className="font-medium hover:underline" style={{ color: C.goldDeep }}>
            Register your business
          </Link>
        </p>
      </form>

      <TermsModal open={showTerms} onClose={() => setShowTerms(false)} />
    </>
  );
};

export default RegistrationForm;

import React, { useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { formatKEPhone } from '../../../utils/phoneUtils';
import { useAuth } from '../../../contexts/AuthContext';
import Icon from '../../../components/AppIcon';

// ── Subscription plans (mirrors the "Register Your Company" flow) ───────────────
// Flat KES 360 / month per plan. The plan sets the company's staff-portal user
// limit; extra users beyond the tier cost KES 360 each (upgrade).
const PLANS = [
  { id: 'bronze', name: 'Bronze', price: 360, maxUsers: 5,    storageGb: 5,  userRange: '1–5 users',  color: '#CD7F32' },
  { id: 'silver', name: 'Silver', price: 360, maxUsers: 16,   storageGb: 10, userRange: '6–16 users', color: '#C0C0C0', popular: true },
  { id: 'gold',   name: 'Gold',   price: 360, maxUsers: null, storageGb: 15, userRange: '17+ users',  color: '#C9A84C' },
];

const ASSET_TYPES = [
  'Vehicles', 'Property/Land', 'Construction Dealers',
  'Electronics', 'Furnitures', 'Heavy Equipment',
];

// ── Password strength ─────────────────────────────────────────────────────────
const getPasswordStrength = (pwd) => {
  if (!pwd) return { score: 0, label: '', color: '' };
  let score = 0;
  if (pwd.length >= 8)           score++;
  if (pwd.length >= 12)          score++;
  if (/[A-Z]/.test(pwd))         score++;
  if (/[0-9]/.test(pwd))         score++;
  if (/[^A-Za-z0-9]/.test(pwd))  score++;
  if (score <= 1) return { score, label: 'Weak',        color: 'bg-red-500' };
  if (score <= 2) return { score, label: 'Fair',        color: 'bg-amber-500' };
  if (score <= 3) return { score, label: 'Good',        color: 'bg-yellow-500' };
  if (score <= 4) return { score, label: 'Strong',      color: 'bg-emerald-500' };
  return              { score, label: 'Very Strong',  color: 'bg-emerald-600' };
};

const ic = (err) =>
  `w-full px-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 bg-white transition-colors ${
    err ? 'border-red-400 bg-red-50' : 'border-gray-200'
  }`;

// ── Helper: call Edge Function safely (keeps the agent's session intact) ───────
// A plain supabase.auth.signUp would swap the logged-in agent for the new admin.
// The create-staff-user function provisions the auth user server-side instead.
const callEdgeFunction = async (payload) => {
  const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnon) {
    throw new Error('Supabase environment variables are missing. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }

  // Force-refresh the session to guarantee a non-expired token
  const { data: refreshData } = await supabase.auth.refreshSession();

  // Fall back to getSession if refresh fails (e.g. already fresh)
  let accessToken = refreshData?.session?.access_token;
  if (!accessToken) {
    const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr || !session) throw new Error('Session expired. Please log out and log in again.');
    accessToken = session.access_token;
  }

  const makeRequest = async (token) => {
    return fetch(`${supabaseUrl}/functions/v1/create-staff-user`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        // Both headers are required — apikey for Supabase gateway, Authorization for the function itself
        'Authorization': `Bearer ${token}`,
        'apikey':        supabaseAnon,
      },
      body: JSON.stringify(payload),
    });
  };

  let res = await makeRequest(accessToken);

  // If still 401, the token may have just expired mid-request — try once more with a forced refresh
  if (res.status === 401) {
    const { data: retryRefresh } = await supabase.auth.refreshSession();
    const retryToken = retryRefresh?.session?.access_token;
    if (!retryToken) throw new Error('Your session has expired. Please log out and log back in, then try again.');
    res = await makeRequest(retryToken);
  }

  // Try to parse JSON regardless of status for better error messages
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Server returned an unexpected response (HTTP ${res.status}). Please try again.`);
  }

  if (!res.ok) {
    // Surface the exact error from the Edge Function if available
    const msg = data?.error || data?.message || data?.msg || `Request failed (${res.status})`;
    throw new Error(msg);
  }

  return data;
};

// ── Success Popup ─────────────────────────────────────────────────────────────
const SuccessPopup = ({ account, onDone }) => (
  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 flex flex-col items-center text-center animate-[scaleIn_0.25s_ease-out]">
      {/* Animated checkmark circle */}
      <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mb-5">
        <div className="w-14 h-14 rounded-full bg-emerald-600 flex items-center justify-center">
          <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>

      <h3 className="text-2xl font-bold text-gray-900 mb-1">Company Account Created!</h3>
      <p className="text-sm text-gray-500 mb-5">
        An admin portal account is ready for
      </p>

      {/* Account summary card */}
      <div className="w-full bg-gray-50 rounded-xl p-4 space-y-2 text-left mb-6">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Company</span>
          <span className="font-semibold text-gray-900 truncate ml-4">{account.company_name}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Admin</span>
          <span className="font-semibold text-gray-900 truncate ml-4">{account.full_name}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Login Email</span>
          <span className="font-semibold text-gray-900 truncate ml-4">{account.email}</span>
        </div>
        {account.plan_name && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Plan</span>
            <span className="font-semibold text-emerald-700 capitalize">{account.plan_name}</span>
          </div>
        )}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 mb-3 text-left w-full">
        ⚠️ Share the login email and password securely — the password cannot be retrieved later.
      </div>
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700 mb-6 text-left w-full">
        The admin logs in at the portal and lands on the admin dashboard to manage their company.
      </div>

      <button
        onClick={onDone}
        className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl transition-colors"
      >
        Done
      </button>
    </div>
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────
const CreateClientModal = ({ isOpen, onClose, agentProfile, prefillLead, onSuccess }) => {
  const { user } = useAuth();

  const [step, setStep]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState(false);
  const [createdAccount, setCreatedAccount] = useState(null);

  const [form, setForm] = useState({
    // Admin contact (prefilled from a lead when converting one)
    full_name:        prefillLead?.full_name || '',
    email:            prefillLead?.email || '',
    phone:            prefillLead?.phone || '',
    // Company details
    company_name:        '',
    business_reg_number: '',
    business_type:       '',
    location:            '',
    city:                '',
    asset_types:         [],
    plan:                '',
    // Credentials
    password:         '',
    confirm_password: '',
  });
  const [errors, setErrors]     = useState({});
  const [showPwd, setShowPwd]   = useState(false);
  const [showConf, setShowConf] = useState(false);

  const pwdStrength = getPasswordStrength(form.password);

  const set = (k, v) => {
    setForm(p => ({ ...p, [k]: v }));
    setErrors(p => ({ ...p, [k]: '' }));
    setError('');
  };

  const toggleAssetType = (type) => {
    set('asset_types', form.asset_types.includes(type)
      ? form.asset_types.filter(t => t !== type)
      : [...form.asset_types, type]
    );
  };

  // ── Validation ────────────────────────────────────────────────────────────
  const validateStep1 = () => {
    const e = {};
    if (!form.full_name.trim())    e.full_name    = 'Admin full name is required';
    if (!form.email.trim())        e.email        = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email';
    if (!form.phone.trim())        e.phone        = 'Phone number is required';
    if (!form.company_name.trim()) e.company_name = 'Company name is required';
    if (!form.location.trim())     e.location     = 'Location is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep2 = () => {
    const e = {};
    if (form.asset_types.length === 0) e.asset_types = 'Select at least one asset type';
    if (!form.plan)                    e.plan        = 'Select a subscription plan';
    if (!form.password)                e.password    = 'Password is required';
    else if (form.password.length < 8) e.password    = 'Minimum 8 characters';
    else if (pwdStrength.score < 2)    e.password    = 'Password too weak';
    if (form.password !== form.confirm_password) e.confirm_password = 'Passwords do not match';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    if (step === 1 && validateStep1()) setStep(2);
    if (step === 2 && validateStep2()) setStep(3);
  };

  const handleBack = () => {
    setError('');
    setStep(s => s - 1);
  };

  // ── Reset & close ─────────────────────────────────────────────────────────
  const handleClose = () => {
    setStep(1);
    setForm({
      full_name: '', email: '', phone: '',
      company_name: '', business_reg_number: '', business_type: '',
      location: '', city: '', asset_types: [], plan: '',
      password: '', confirm_password: '',
    });
    setErrors({});
    setError('');
    setSuccess(false);
    setCreatedAccount(null);
    onClose();
  };

  // ── Submit — provision an admin / company account ───────────────────────────
  const handleSubmit = async () => {
    setLoading(true);
    setError('');

    try {
      const email = form.email.trim().toLowerCase();

      // Create the admin/company account via the Edge Function. Doing this
      // server-side keeps the acting sales agent logged in (a client-side
      // supabase.auth.signUp would swap their session) and provisions the
      // company_profiles + company_subscriptions rows with the service role
      // (bypassing RLS). The function authorises sales agents to create admins.
      const result = await callEdgeFunction({
        email,
        password:            form.password,
        full_name:           form.full_name.trim(),
        role:                'admin',
        phone:               form.phone.trim(),
        department:          '',
        admin_id:            null, // an admin is the top of their own company tree
        // Company details (used server-side when role === 'admin')
        company_name:        form.company_name.trim(),
        business_reg_number: form.business_reg_number.trim() || null,
        business_type:       form.business_type.trim() || null,
        location:            form.location.trim(),
        city:                form.city.trim() || null,
        asset_types:         form.asset_types,
        plan:                form.plan,
      });

      const newUserId = result.id;
      if (!newUserId) throw new Error('Account creation returned no user ID.');

      // Audit log — links the new company account to the acting agent.
      try {
        const { auditLogsService } = await import('../../../services/supabaseService');
        await auditLogsService.log(
          'user_created',
          'company_profiles',
          `Sales agent ${agentProfile?.full_name || 'Agent'} (${agentProfile?.agent_code || ''}) registered company "${form.company_name.trim()}" with admin ${form.full_name.trim()} (${email})`,
          newUserId,
          user?.id,
          {
            email,
            phone:            form.phone.trim(),
            company_name:     form.company_name.trim(),
            plan:             form.plan,
            created_by_agent: agentProfile?.agent_code,
            agent_name:       agentProfile?.full_name,
          }
        );
      } catch (auditErr) {
        console.warn('Audit log skipped:', auditErr.message);
      }

      const accountDetails = {
        full_name:    form.full_name.trim(),
        email,
        phone:        form.phone.trim(),
        company_name: form.company_name.trim(),
        plan_name:    form.plan,
      };

      setCreatedAccount(accountDetails);
      setSuccess(true);
      onSuccess?.(accountDetails);

    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Render: success popup replaces the modal ──────────────────────────────
  if (success && createdAccount) {
    return <SuccessPopup account={createdAccount} onDone={handleClose} />;
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center">
              <Icon name="Building2" size={18} color="white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Register Company</h2>
              <p className="text-xs text-gray-500">Admin portal account · Step {step} of 3</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <Icon name="X" size={18} color="#6b7280" />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2 px-6 py-3 bg-gray-50 border-b border-gray-100">
          {['Company & Admin', 'Plan & Access', 'Review'].map((label, i) => (
            <React.Fragment key={label}>
              <div className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  step > i + 1 ? 'bg-emerald-600 text-white' :
                  step === i + 1 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'
                }`}>
                  {step > i + 1 ? '✓' : i + 1}
                </div>
                <span className={`text-xs font-medium hidden sm:block ${step === i + 1 ? 'text-blue-600' : 'text-gray-400'}`}>
                  {label}
                </span>
              </div>
              {i < 2 && <div className={`flex-1 h-0.5 ${step > i + 1 ? 'bg-emerald-600' : 'bg-gray-200'}`} />}
            </React.Fragment>
          ))}
        </div>

        <div className="px-6 py-5">

          {/* ── Step 1: Company & Admin ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Company Name *</label>
                <input type="text" value={form.company_name} onChange={e => set('company_name', e.target.value)}
                  placeholder="e.g. Acme Ltd" className={ic(errors.company_name)} />
                {errors.company_name && <p className="mt-1 text-xs text-red-500">{errors.company_name}</p>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    Business Reg. No. <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input type="text" value={form.business_reg_number} onChange={e => set('business_reg_number', e.target.value)}
                    placeholder="e.g. CPR/2024/001" className={ic(false)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    Business Type <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input type="text" value={form.business_type} onChange={e => set('business_type', e.target.value)}
                    placeholder="e.g. Limited Company" className={ic(false)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Location / Address *</label>
                  <input type="text" value={form.location} onChange={e => set('location', e.target.value)}
                    placeholder="e.g. Westlands, Nairobi" className={ic(errors.location)} />
                  {errors.location && <p className="mt-1 text-xs text-red-500">{errors.location}</p>}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    City <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input type="text" value={form.city} onChange={e => set('city', e.target.value)}
                    placeholder="Nairobi" className={ic(false)} />
                </div>
              </div>

              <div className="pt-2 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Admin Account Holder</p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Full Name *</label>
                    <input type="text" value={form.full_name} onChange={e => set('full_name', e.target.value)}
                      placeholder="e.g. Jane Mwangi" className={ic(errors.full_name)} />
                    {errors.full_name && <p className="mt-1 text-xs text-red-500">{errors.full_name}</p>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">Email Address *</label>
                      <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                        placeholder="admin@company.com" className={ic(errors.email)} />
                      {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">Phone Number *</label>
                      <input type="tel" value={form.phone} onChange={e => set('phone', formatKEPhone(e.target.value))}
                        placeholder="+254 7XX XXX XXX" className={ic(errors.phone)} />
                      {errors.phone && <p className="mt-1 text-xs text-red-500">{errors.phone}</p>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: Plan & Access ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">Asset Types Dealt In *</label>
                <div className="grid grid-cols-2 gap-2">
                  {ASSET_TYPES.map(type => {
                    const active = form.asset_types.includes(type);
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => toggleAssetType(type)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm border text-left transition-all ${
                          active ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-medium' : 'border-gray-200 text-gray-600 hover:border-emerald-300'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 ${active ? 'bg-emerald-600' : 'border border-gray-300'}`}>
                          {active && <Icon name="Check" size={10} color="white" />}
                        </div>
                        {type}
                      </button>
                    );
                  })}
                </div>
                {errors.asset_types && <p className="mt-1 text-xs text-red-500">{errors.asset_types}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">Subscription Plan *</label>
                <div className="grid grid-cols-3 gap-2">
                  {PLANS.map(plan => {
                    const active = form.plan === plan.id;
                    return (
                      <button
                        key={plan.id}
                        type="button"
                        onClick={() => set('plan', plan.id)}
                        className={`relative p-3 rounded-xl border-2 text-left transition-all ${
                          active ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-emerald-300'
                        }`}
                      >
                        <div className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs text-white mb-1.5"
                          style={{ background: plan.color }}>
                          {plan.name[0]}
                        </div>
                        <p className="text-sm font-bold text-gray-900">{plan.name}</p>
                        <p className="text-xs text-gray-500">KES {plan.price.toLocaleString()}/mo</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {plan.userRange} · {plan.storageGb}GB
                        </p>
                      </button>
                    );
                  })}
                </div>
                {errors.plan && <p className="mt-1 text-xs text-red-500">{errors.plan}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Password *</label>
                <div className="relative">
                  <input type={showPwd ? 'text' : 'password'} value={form.password}
                    onChange={e => set('password', e.target.value)}
                    placeholder="Min 8 characters" className={ic(errors.password)} />
                  <button type="button" onClick={() => setShowPwd(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <Icon name={showPwd ? 'EyeOff' : 'Eye'} size={15} color="currentColor" />
                  </button>
                </div>
                {form.password && (
                  <div className="mt-2">
                    <div className="flex gap-1 mb-1">
                      {[1,2,3,4,5].map(i => (
                        <div key={i} className={`flex-1 h-1 rounded-full ${i <= pwdStrength.score ? pwdStrength.color : 'bg-gray-200'}`} />
                      ))}
                    </div>
                    <p className="text-xs text-gray-500">Strength: <span className="font-semibold">{pwdStrength.label}</span></p>
                  </div>
                )}
                {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Confirm Password *</label>
                <div className="relative">
                  <input type={showConf ? 'text' : 'password'} value={form.confirm_password}
                    onChange={e => set('confirm_password', e.target.value)}
                    placeholder="Repeat password" className={ic(errors.confirm_password)} />
                  <button type="button" onClick={() => setShowConf(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <Icon name={showConf ? 'EyeOff' : 'Eye'} size={15} color="currentColor" />
                  </button>
                </div>
                {errors.confirm_password && <p className="mt-1 text-xs text-red-500">{errors.confirm_password}</p>}
              </div>
            </div>
          )}

          {/* ── Step 3: Review ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-xl p-5 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Company</p>
                {[
                  { label: 'Company Name',  value: form.company_name },
                  { label: 'Reg. Number',   value: form.business_reg_number || '—' },
                  { label: 'Business Type', value: form.business_type || '—' },
                  { label: 'Location',      value: form.location || '—' },
                  { label: 'City',          value: form.city || '—' },
                  { label: 'Asset Types',   value: form.asset_types.join(', ') || '—' },
                  { label: 'Plan',          value: form.plan ? `${PLANS.find(p => p.id === form.plan)?.name} (KES ${PLANS.find(p => p.id === form.plan)?.price.toLocaleString()}/mo)` : '—' },
                ].map(r => (
                  <div key={r.label} className="flex justify-between text-sm gap-4">
                    <span className="text-gray-500 flex-shrink-0">{r.label}</span>
                    <span className="font-medium text-gray-900 text-right">{r.value}</span>
                  </div>
                ))}
              </div>

              <div className="bg-gray-50 rounded-xl p-5 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Admin Account</p>
                {[
                  { label: 'Name',       value: form.full_name },
                  { label: 'Email',      value: form.email },
                  { label: 'Phone',      value: form.phone },
                  { label: 'Role',       value: 'Admin (admin portal)' },
                  { label: 'Created By', value: `${agentProfile?.full_name || 'Sales Agent'} (${agentProfile?.agent_code || '—'})` },
                ].map(r => (
                  <div key={r.label} className="flex justify-between text-sm gap-4">
                    <span className="text-gray-500 flex-shrink-0">{r.label}</span>
                    <span className="font-medium text-gray-900 text-right break-all">{r.value}</span>
                  </div>
                ))}
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                ⚠️ Note the password — it cannot be retrieved after creation. Share it securely with the company admin.
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 flex items-center gap-2">
                  <Icon name="AlertCircle" size={14} color="#dc2626" />
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
          {step > 1 && (
            <button onClick={handleBack} disabled={loading}
              className="px-5 py-2.5 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50 disabled:opacity-50">
              ← Back
            </button>
          )}
          <button
            onClick={step < 3 ? handleNext : handleSubmit}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl disabled:opacity-60"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                </svg>
                Creating Account...
              </>
            ) : step < 3 ? 'Next →' : (
              <><Icon name="Building2" size={15} color="white" /> Register Company</>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};

export default CreateClientModal;

import React, { useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { formatKEPhone } from '../../../utils/phoneUtils';
import { useAuth } from '../../../contexts/AuthContext';
import Icon from '../../../components/AppIcon';

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

// ── Helper: call Edge Function safely ────────────────────────────────────────
const callEdgeFunction = async (payload) => {
  const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnon) {
    throw new Error('Supabase environment variables are missing. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }

  // Force-refresh the session to guarantee a non-expired token
  const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
  
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
const SuccessPopup = ({ client, agentName, onDone }) => (
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

      <h3 className="text-2xl font-bold text-gray-900 mb-1">Client Created!</h3>
      <p className="text-sm text-gray-500 mb-5">
        Account successfully registered for
      </p>

      {/* Client summary card */}
      <div className="w-full bg-gray-50 rounded-xl p-4 space-y-2 text-left mb-6">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Name</span>
          <span className="font-semibold text-gray-900">{client.full_name}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Email</span>
          <span className="font-semibold text-gray-900 truncate ml-4">{client.email}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Phone</span>
          <span className="font-semibold text-gray-900">{client.phone}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Account No.</span>
          <span className="font-semibold text-emerald-700">{client.account_number}</span>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 mb-6 text-left w-full">
        ⚠️ Share the login credentials securely with the client — the password cannot be retrieved later.
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
const CreateClientModal = ({ isOpen, onClose, agentProfile, onSuccess }) => {
  const { user, userProfile } = useAuth();

  const [step, setStep]           = useState(1);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState(false);         // ✅ was missing
  const [createdClient, setCreatedClient] = useState(null);  // ✅ was missing

  const [form, setForm] = useState({
    full_name:        '',
    email:            '',
    phone:            '',
    national_id:      '',
    password:         '',
    confirm_password: '',
    asset_interest:   '',
    budget_range:     '',
    notes:            '',
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

  // ── Validation ────────────────────────────────────────────────────────────
  const validateStep1 = () => {
    const e = {};
    if (!form.full_name.trim()) e.full_name = 'Full name is required';
    if (!form.email.trim())     e.email     = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email';
    if (!form.phone.trim())     e.phone     = 'Phone number is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep2 = () => {
    const e = {};
    if (!form.password)                e.password         = 'Password is required';
    else if (form.password.length < 8) e.password         = 'Minimum 8 characters';
    else if (pwdStrength.score < 2)    e.password         = 'Password too weak';
    if (form.password !== form.confirm_password) e.confirm_password = 'Passwords do not match';
    if (!form.asset_interest)          e.asset_interest   = 'Asset interest is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    if (step === 1 && validateStep1()) setStep(2);
    if (step === 2 && validateStep2()) setStep(3);
  };

  // ✅ handleBack was referenced but never defined
  const handleBack = () => {
    setError('');
    setStep(s => s - 1);
  };

  // ── Reset & close ─────────────────────────────────────────────────────────
  const handleClose = () => {
    setStep(1);
    setForm({
      full_name: '', email: '', phone: '', national_id: '',
      password: '', confirm_password: '', asset_interest: '', budget_range: '', notes: '',
    });
    setErrors({});
    setError('');
    setSuccess(false);       // ✅ now defined
    setCreatedClient(null);  // ✅ now defined
    onClose();
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setLoading(true);
    setError('');

    try {
      const adminId = agentProfile?.admin_id || userProfile?.admin_id;
      if (!adminId) throw new Error('Cannot determine admin. Contact support.');

      // Step 1: Create auth user via Edge Function
      const result = await callEdgeFunction({
        email:      form.email.trim().toLowerCase(),
        password:   form.password,
        full_name:  form.full_name.trim(),
        role:       'client',
        phone:      form.phone.trim(),
        department: '',
        admin_id:   adminId,
      });

      const newUserId = result.id;
      if (!newUserId) throw new Error('User creation returned no ID.');

      // Step 2: Create client record
      const accountNumber = `ACC-${Date.now().toString().slice(-6)}`;

      const { data: clientRecord, error: clientErr } = await supabase
        .from('clients')
        .insert({
          admin_id:       adminId,
          full_name:      form.full_name.trim(),
          email:          form.email.trim().toLowerCase(),
          phone:          form.phone.trim(),
          national_id:    form.national_id.trim() || null,
          account_number: accountNumber,
          client_status:  'pending',
          kyc_status:     'unverified',
          notes:          form.notes.trim() || null,
        })
        .select()
        .single();

      if (clientErr) throw new Error('Client record error: ' + clientErr.message);

      // Step 3: Audit log — includes agent info so admin portal also sees it
      // ✅ user_id is now passed so the audit links to the agent AND appears for admin
      try {
        const { auditLogsService } = await import('../../../services/supabaseService');
        await auditLogsService.log(
          'user_created',
          'clients',
          `Sales agent ${agentProfile?.full_name || 'Agent'} (${agentProfile?.agent_code || ''}) created client "${form.full_name.trim()}" (${form.email.trim().toLowerCase()}) — Account: ${accountNumber}`,
          clientRecord.id,
          user?.id,   // ✅ was null before — now links the log to the acting user
          {
            email:            form.email.trim().toLowerCase(),
            phone:            form.phone.trim(),
            account_number:   accountNumber,
            created_by_agent: agentProfile?.agent_code,
            agent_name:       agentProfile?.full_name,
            asset_interest:   form.asset_interest,
            budget_range:     form.budget_range,
            admin_id:         adminId,
          }
        );
      } catch (auditErr) {
        console.warn('Audit log skipped:', auditErr.message);
      }

      // Step 4: Mark existing lead as closed / create closed lead record
      if (agentProfile?.id) {
        await supabase
          .from('leads')
          .update({ stage: 'closed', updated_at: new Date().toISOString() })
          .eq('agent_id', agentProfile.id)
          .eq('email', form.email.trim().toLowerCase())
          .catch(() => {});

        await supabase.from('leads').insert({
          agent_id:       agentProfile.id,
          full_name:      form.full_name.trim(),
          email:          form.email.trim().toLowerCase(),
          phone:          form.phone.trim(),
          asset_interest: form.asset_interest,
          budget_range:   form.budget_range,
          stage:          'closed',
          priority:       'medium',
          source:         'direct_client',
          notes:          `Direct client created by agent. ${form.notes || ''}`.trim(),
        }).catch(() => {});
      }

      // ✅ Show success popup INSTEAD of opening the client portal
      const clientDetails = {
        full_name:      form.full_name.trim(),
        email:          form.email.trim().toLowerCase(),
        phone:          form.phone.trim(),
        account_number: accountNumber,
      };

      setCreatedClient(clientDetails);
      setSuccess(true);           // triggers success popup
      onSuccess?.(clientDetails); // notify parent (e.g. refresh list) without navigating

    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Render: success popup replaces the modal ──────────────────────────────
  if (success && createdClient) {
    return (
      <SuccessPopup
        client={createdClient}
        agentName={agentProfile?.full_name}
        onDone={handleClose}
      />
    );
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center">
              <Icon name="UserPlus" size={18} color="white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Create Client Account</h2>
              {/* ✅ Was a plain string — now properly interpolated */}
              <p className="text-xs text-gray-500">Step {step} of 3</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <Icon name="X" size={18} color="#6b7280" />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2 px-6 py-3 bg-gray-50 border-b border-gray-100">
          {['Personal Info', 'Account Setup', 'Review'].map((label, i) => (
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

          {/* ── Step 1: Personal Info ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Full Name *</label>
                <input type="text" value={form.full_name} onChange={e => set('full_name', e.target.value)}
                  placeholder="e.g. Jane Mwangi" className={ic(errors.full_name)} />
                {errors.full_name && <p className="mt-1 text-xs text-red-500">{errors.full_name}</p>}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Email Address *</label>
                <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                  placeholder="client@example.com" className={ic(errors.email)} />
                {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Phone Number *</label>
                <input type="tel" value={form.phone} onChange={e => set('phone', formatKEPhone(e.target.value))}
                  placeholder="+254 7XX XXX XXX" className={ic(errors.phone)} />
                {errors.phone && <p className="mt-1 text-xs text-red-500">{errors.phone}</p>}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                  National ID <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input type="text" value={form.national_id} onChange={e => set('national_id', e.target.value)}
                  placeholder="ID Number" className={ic(false)} />
              </div>
            </div>
          )}

          {/* ── Step 2: Account Setup ── */}
          {step === 2 && (
            <div className="space-y-4">
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

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Asset Interest *</label>
                <select value={form.asset_interest} onChange={e => set('asset_interest', e.target.value)}
                  className={ic(errors.asset_interest)}>
                  <option value="">Select asset type...</option>
                  <option value="land">Land</option>
                  <option value="apartment">Apartment</option>
                  <option value="commercial_property">Commercial Property</option>
                  <option value="vehicle">Vehicle</option>
                  <option value="equipment">Equipment</option>
                  <option value="other">Other</option>
                </select>
                {errors.asset_interest && <p className="mt-1 text-xs text-red-500">{errors.asset_interest}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Budget Range</label>
                <select value={form.budget_range} onChange={e => set('budget_range', e.target.value)} className={ic(false)}>
                  <option value="">Select range...</option>
                  <option value="under_500k">Under KES 500,000</option>
                  <option value="500k_1m">KES 500K – 1M</option>
                  <option value="1m_3m">KES 1M – 3M</option>
                  <option value="3m_5m">KES 3M – 5M</option>
                  <option value="above_5m">Above KES 5M</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                  Notes <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
                  placeholder="Any relevant notes about this client..."
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 bg-white resize-none" />
              </div>
            </div>
          )}

          {/* ── Step 3: Review ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-xl p-5 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Personal Info</p>
                {[
                  { label: 'Name',        value: form.full_name },
                  { label: 'Email',       value: form.email },
                  { label: 'Phone',       value: form.phone },
                  { label: 'National ID', value: form.national_id || '—' },
                ].map(r => (
                  <div key={r.label} className="flex justify-between text-sm">
                    <span className="text-gray-500">{r.label}</span>
                    <span className="font-medium text-gray-900">{r.value}</span>
                  </div>
                ))}
              </div>

              <div className="bg-gray-50 rounded-xl p-5 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Account Details</p>
                {[
                  { label: 'Asset Interest', value: form.asset_interest.replace(/_/g, ' ') },
                  { label: 'Budget Range',   value: form.budget_range ? form.budget_range.replace(/_/g, ' ') : '—' },
                  { label: 'Role',           value: 'Client' },
                  { label: 'Created By',     value: agentProfile?.full_name || 'Sales Agent' },
                  { label: 'Agent Code',     value: agentProfile?.agent_code || '—' },
                ].map(r => (
                  <div key={r.label} className="flex justify-between text-sm">
                    <span className="text-gray-500">{r.label}</span>
                    <span className="font-medium text-gray-900 capitalize">{r.value}</span>
                  </div>
                ))}
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                ⚠️ Make sure to note the password — it cannot be retrieved after creation. Share it securely with the client.
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
            // ✅ handleBack is now defined above
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
              <><Icon name="UserPlus" size={15} color="white" /> Create Client Account</>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};

export default CreateClientModal;

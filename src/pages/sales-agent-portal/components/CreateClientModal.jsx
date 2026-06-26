import React, { useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { formatKEPhone } from '../../../utils/phoneUtils';
import { useAuth } from '../../../contexts/AuthContext';
import Icon from '../../../components/AppIcon';

// ── Input class helper ──────────────────────────────────────────────────────────
const ic = (err) =>
  `w-full px-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white transition-colors ${
    err ? 'border-red-400 bg-red-50' : 'border-gray-200'
  }`;

// ── Account number (matches the admin client form: AF-YYYY-NNNNNN) ──────────────
const generateAccountNumber = () => {
  const year = new Date().getFullYear();
  const seq  = String(Math.floor(Math.random() * 999999) + 1).padStart(6, '0');
  return `AF-${year}-${seq}`;
};

// ── Strong temporary password (>= 8 chars, one of each class, no ambiguous) ─────
const generatePassword = () => {
  const pick = (s) => s[Math.floor(Math.random() * s.length)];
  const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', L = 'abcdefghijkmnpqrstuvwxyz', D = '23456789', SY = '@#$%';
  let pwd = pick(U) + pick(L) + pick(D) + pick(SY);
  for (let i = 0; i < 8; i++) pwd += pick(U + L + D + SY);
  return pwd;
};

// ── Resolve a Supabase Edge Function URL ────────────────────────────────────────
const fnUrl = (name) => {
  const raw  = import.meta.env.VITE_SUPABASE_URL || '';
  const base = raw.startsWith('http') ? raw : `https://${raw}.supabase.co`;
  return `${base}/functions/v1/${name}`;
};

// ── Success Popup ─────────────────────────────────────────────────────────────
const SuccessPopup = ({ account, onDone }) => {
  const [copied, setCopied] = useState('');
  const copy = (label, value) => {
    navigator.clipboard?.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(''), 1500);
  };

  const emailLabel = {
    sent:    { text: 'Login details emailed to the client.', cls: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
    failed:  { text: 'Email could not be delivered — share the details below manually.', cls: 'bg-amber-50 border-amber-200 text-amber-800' },
    skipped: { text: 'Share the login details below with the client.', cls: 'bg-blue-50 border-blue-200 text-blue-700' },
  }[account.emailStatus] || { text: 'Share the login details below with the client.', cls: 'bg-blue-50 border-blue-200 text-blue-700' };

  return (
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
          {account.full_name} is now a client of your company
        </p>

        {/* Account summary card */}
        <div className="w-full bg-gray-50 rounded-xl p-4 space-y-2 text-left mb-4">
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-500">Account No.</span>
            <span className="font-semibold text-gray-900 truncate ml-4">{account.account_number}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-500">Login Email</span>
            <span className="font-semibold text-gray-900 truncate ml-4">{account.email}</span>
          </div>
          {account.password && (
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">Temp. Password</span>
              <button
                onClick={() => copy('pwd', account.password)}
                className="font-mono font-semibold text-gray-900 ml-4 flex items-center gap-1.5 hover:text-emerald-700"
                title="Click to copy"
              >
                {account.password}
                <Icon name={copied === 'pwd' ? 'Check' : 'Copy'} size={13} color="currentColor" />
              </button>
            </div>
          )}
        </div>

        {/* Login provisioning / email status */}
        {account.loginCreated ? (
          <div className={`border rounded-xl p-3 text-xs mb-3 text-left w-full ${emailLabel.cls}`}>
            {emailLabel.text}
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 mb-3 text-left w-full">
            ⚠️ The client record was saved, but the portal login could not be created
            {account.loginError ? `: ${account.loginError}` : ''}. An admin can provision it later.
          </div>
        )}

        <button
          onClick={onDone}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────
const CreateClientModal = ({ isOpen, onClose, agentProfile, prefillLead, onSuccess }) => {
  const { user, userProfile } = useAuth();

  const [step, setStep]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState(false);
  const [createdAccount, setCreatedAccount] = useState(null);

  const [form, setForm] = useState({
    // Client contact (prefilled from a lead when converting one)
    full_name:        prefillLead?.full_name || '',
    email:            prefillLead?.email || '',
    phone:            prefillLead?.phone || '',
    national_id:      '',
    kra_pin:          prefillLead?.kra_pin || '',
    // Address & next of kin (KYC — optional, carried over from the lead)
    physical_address: prefillLead?.physical_address || '',
    postal_address:   prefillLead?.postal_address || '',
    city:             '',
    nok_name:         prefillLead?.next_of_kin_name || '',
    nok_phone:        prefillLead?.next_of_kin_phone || '',
    nok_relationship: prefillLead?.next_of_kin_relationship || '',
  });
  const [errors, setErrors] = useState({});

  const set = (k, v) => {
    setForm(p => ({ ...p, [k]: v }));
    setErrors(p => ({ ...p, [k]: '' }));
    setError('');
  };

  // ── Validation ────────────────────────────────────────────────────────────
  const validateStep1 = () => {
    const e = {};
    if (!form.full_name.trim())    e.full_name = 'Client full name is required';
    if (!form.email.trim())        e.email     = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email';
    if (!form.phone.trim())        e.phone     = 'Phone number is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    if (step === 1 && validateStep1()) setStep(2);
  };

  const handleBack = () => {
    setError('');
    setStep(s => s - 1);
  };

  // ── Reset & close ─────────────────────────────────────────────────────────
  const handleClose = () => {
    setStep(1);
    setForm({
      full_name: '', email: '', phone: '', national_id: '', kra_pin: '',
      physical_address: '', postal_address: '', city: '',
      nok_name: '', nok_phone: '', nok_relationship: '',
    });
    setErrors({});
    setError('');
    setSuccess(false);
    setCreatedAccount(null);
    onClose();
  };

  // ── Provision the client's portal login (service role bypasses RLS) ─────────
  // create-staff-user creates the auth account (email auto-confirmed) and links
  // it to the clients row via client_id. Keeps the agent's session intact.
  const provisionLogin = async ({ clientId, email, fullName, phone, adminId, password }) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('No active session — cannot create login.');

      const res = await fetch(fnUrl('create-staff-user'), {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          email, password, full_name: fullName, role: 'client',
          phone: phone || '', admin_id: adminId, client_id: clientId,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || json?.message || 'Login creation failed');
      return { success: true };
    } catch (err) {
      return { success: false, error: err?.message };
    }
  };

  // ── Email the login credentials to the client (best-effort, via Resend) ─────
  const sendCredentialsEmail = async ({ email, fullName, password, accountNumber }) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(fnUrl('send-email'), {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          type: 'client_welcome',
          to: email,
          data: { fullName, email, password, accountNumber, portalUrl: `${window.location.origin}/login` },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Email failed');
      return { success: true };
    } catch (err) {
      return { success: false, error: err?.message };
    }
  };

  // ── Submit — create the client record + portal login ────────────────────────
  const handleSubmit = async () => {
    setLoading(true);
    setError('');

    try {
      const email   = form.email.trim().toLowerCase();
      // The client belongs to the agent's own company.
      const adminId = agentProfile?.admin_id || userProfile?.admin_id || null;
      const accountNumber = generateAccountNumber();

      // 1. Insert the client row (RLS: authenticated_manage_clients allows this).
      //    safeKeys mirrors the admin client form so any column absent in this
      //    environment is dropped instead of throwing a schema-cache error.
      const insertPayload = {
        account_number:   accountNumber,
        full_name:        form.full_name.trim(),
        email,
        phone:            form.phone.trim()            || null,
        national_id:      form.national_id.trim()      || null,
        kra_pin:          form.kra_pin.trim()          || null,
        physical_address: form.physical_address.trim() || null,
        postal_address:   form.postal_address.trim()   || null,
        city:             form.city.trim()             || null,
        country:          'Kenya',
        nok_name:         form.nok_name.trim()         || null,
        nok_phone:        form.nok_phone.trim()        || null,
        nok_relationship: form.nok_relationship.trim() || null,
        client_status:    'active',
        kyc_status:       'unverified',
        admin_id:         adminId,
        created_by:       user?.id || null,
        agent_id:         agentProfile?.id || null,
      };
      const safeKeys = [
        'account_number', 'full_name', 'email', 'phone', 'national_id', 'kra_pin',
        'physical_address', 'postal_address', 'city', 'country',
        'nok_name', 'nok_phone', 'nok_relationship',
        'client_status', 'kyc_status', 'admin_id', 'created_by', 'agent_id',
      ];
      const safePayload = Object.fromEntries(
        Object.entries(insertPayload).filter(([k, v]) => safeKeys.includes(k) && v !== undefined)
      );

      const { data: newClient, error: clientErr } = await supabase
        .from('clients')
        .insert(safePayload)
        .select('id, account_number')
        .single();
      if (clientErr) throw clientErr;

      // 2. Provision the portal login and link it to the client row.
      const password  = generatePassword();
      const provision = await provisionLogin({
        clientId: newClient.id,
        email,
        fullName: form.full_name.trim(),
        phone:    form.phone.trim(),
        adminId,
        password,
      });

      // 3. Email the credentials (best-effort — falls back to on-screen display).
      let emailStatus = 'skipped';
      if (provision.success) {
        const res = await sendCredentialsEmail({
          email,
          fullName:      form.full_name.trim(),
          password,
          accountNumber: newClient.account_number,
        });
        emailStatus = res.success ? 'sent' : 'failed';
      }

      // 4. Audit log — links the new client to the acting agent + lead.
      try {
        const { auditLogsService } = await import('../../../services/supabaseService');
        await auditLogsService.log(
          'create',
          'clients',
          `Sales agent ${agentProfile?.full_name || 'Agent'} (${agentProfile?.agent_code || ''}) registered client "${form.full_name.trim()}" (${email}) — Acc ${newClient.account_number}`,
          newClient.id,
          user?.id,
          {
            email,
            account_number:   newClient.account_number,
            phone:            form.phone.trim(),
            created_by_agent: agentProfile?.agent_code,
            agent_name:       agentProfile?.full_name,
            from_lead_id:     prefillLead?.id || null,
          }
        );
      } catch (auditErr) {
        console.warn('Audit log skipped:', auditErr.message);
      }

      const accountDetails = {
        full_name:      form.full_name.trim(),
        email,
        account_number: newClient.account_number,
        password:       provision.success ? password : null,
        loginCreated:   provision.success,
        loginError:     provision.error,
        emailStatus,
        leadId:         prefillLead?.id || null,
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
              <Icon name="UserPlus" size={18} color="white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Create Client</h2>
              <p className="text-xs text-gray-500">Client portal account · Step {step} of 2</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <Icon name="X" size={18} color="#6b7280" />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2 px-6 py-3 bg-gray-50 border-b border-gray-100">
          {['Client Details', 'Review'].map((label, i) => (
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
              {i < 1 && <div className={`flex-1 h-0.5 ${step > i + 1 ? 'bg-emerald-600' : 'bg-gray-200'}`} />}
            </React.Fragment>
          ))}
        </div>

        <div className="px-6 py-5">

          {/* ── Step 1: Client details ── */}
          {step === 1 && (
            <div className="space-y-4">
              {prefillLead && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-700 flex items-start gap-2">
                  <Icon name="Info" size={14} color="#047857" />
                  Converting lead <span className="font-semibold">{prefillLead.full_name}</span> — their details are prefilled below.
                </div>
              )}

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
                    placeholder="client@email.com" className={ic(errors.email)} />
                  {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Phone Number *</label>
                  <input type="tel" value={form.phone} onChange={e => set('phone', formatKEPhone(e.target.value))}
                    placeholder="+254 7XX XXX XXX" className={ic(errors.phone)} />
                  {errors.phone && <p className="mt-1 text-xs text-red-500">{errors.phone}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    National ID <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input type="text" value={form.national_id} onChange={e => set('national_id', e.target.value)}
                    placeholder="e.g. 12345678" className={ic(false)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    KRA PIN <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input type="text" value={form.kra_pin} onChange={e => set('kra_pin', e.target.value.toUpperCase())}
                    placeholder="A123456789B" maxLength={11} className={ic(false)} />
                </div>
              </div>

              <div className="pt-2 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Address & Next of Kin <span className="text-gray-400 font-normal normal-case">(optional)</span>
                </p>
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">Physical Address</label>
                      <input type="text" value={form.physical_address} onChange={e => set('physical_address', e.target.value)}
                        placeholder="County, Estate, Plot" className={ic(false)} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">City</label>
                      <input type="text" value={form.city} onChange={e => set('city', e.target.value)}
                        placeholder="Nairobi" className={ic(false)} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Postal Address</label>
                    <input type="text" value={form.postal_address} onChange={e => set('postal_address', e.target.value)}
                      placeholder="e.g. P.O. Box 123-00100" className={ic(false)} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">Next of Kin</label>
                      <input type="text" value={form.nok_name} onChange={e => set('nok_name', e.target.value)}
                        placeholder="Full name" className={ic(false)} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">NoK Phone</label>
                      <input type="tel" value={form.nok_phone} onChange={e => set('nok_phone', formatKEPhone(e.target.value))}
                        placeholder="+254 7XX XXX XXX" className={ic(false)} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">Relationship</label>
                      <input type="text" value={form.nok_relationship} onChange={e => set('nok_relationship', e.target.value)}
                        placeholder="e.g. Spouse" className={ic(false)} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: Review ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-xl p-5 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Client</p>
                {[
                  { label: 'Full Name',    value: form.full_name },
                  { label: 'Email',        value: form.email },
                  { label: 'Phone',        value: form.phone },
                  { label: 'National ID',  value: form.national_id || '—' },
                  { label: 'KRA PIN',      value: form.kra_pin || '—' },
                  { label: 'Address',      value: form.physical_address || '—' },
                  { label: 'City',         value: form.city || '—' },
                  { label: 'Next of Kin',  value: form.nok_name ? `${form.nok_name}${form.nok_relationship ? ` (${form.nok_relationship})` : ''}` : '—' },
                ].map(r => (
                  <div key={r.label} className="flex justify-between text-sm gap-4">
                    <span className="text-gray-500 flex-shrink-0">{r.label}</span>
                    <span className="font-medium text-gray-900 text-right break-all">{r.value}</span>
                  </div>
                ))}
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700 flex items-start gap-2">
                <Icon name="Info" size={14} color="#1d4ed8" />
                A client-portal login is created automatically and the credentials are emailed to the client.
                They will also be shown here so you can share them directly.
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
            onClick={step < 2 ? handleNext : handleSubmit}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl disabled:opacity-60"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                </svg>
                Creating Client...
              </>
            ) : step < 2 ? 'Next →' : (
              <><Icon name="UserPlus" size={15} color="white" /> Create Client</>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};

export default CreateClientModal;

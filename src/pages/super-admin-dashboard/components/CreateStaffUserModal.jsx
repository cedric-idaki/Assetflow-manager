import React, { useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { formatKEPhone } from '../../../utils/phoneUtils';
import { useAuth } from '../../../contexts/AuthContext';
import { emailLoginCredentials } from '../../../services/credentialsEmailService';
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
  if (score <= 1) return { score, label: 'Weak',       color: 'bg-red-500' };
  if (score <= 2) return { score, label: 'Fair',       color: 'bg-amber-500' };
  if (score <= 3) return { score, label: 'Good',       color: 'bg-yellow-500' };
  if (score <= 4) return { score, label: 'Strong',     color: 'bg-emerald-500' };
  return              { score, label: 'Very Strong', color: 'bg-emerald-600' };
};

const ic = (err) =>
  `w-full px-3 py-2 text-sm bg-background border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground transition-colors ${
    err ? 'border-red-400 bg-red-50' : 'border-border'
  }`;

// ── Role definitions ──────────────────────────────────────────────────────────
const STAFF_ROLES = [
  { value: 'accountant',  label: 'Accountant',    icon: 'Calculator', desc: 'Manages finances, invoices & reports' },
  { value: 'hr',          label: 'HR Manager',    icon: 'Users',      desc: 'Handles staff records & payroll' },
  { value: 'manager',     label: 'Manager',       icon: 'Briefcase',  desc: 'Oversees teams and operations' },
  { value: 'it_support',  label: 'IT / Support',  icon: 'Monitor',    desc: 'Technical support & system access' },
  { value: 'staff',       label: 'General Staff', icon: 'User',       desc: 'Standard employee access' },
];

const DEPARTMENTS = [
  'Finance & Accounts',
  'Human Resources',
  'Operations',
  'Sales & Marketing',
  'IT & Technology',
  'Legal & Compliance',
  'Customer Support',
  'Administration',
];

// ── Edge Function caller ──────────────────────────────────────────────────────
const callEdgeFunction = async (payload) => {
  const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnon) throw new Error('Supabase environment variables are missing.');

  const { data: refreshData } = await supabase.auth.refreshSession();
  let accessToken = refreshData?.session?.access_token;
  if (!accessToken) {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) throw new Error('Session expired. Please log out and log in again.');
    accessToken = session.access_token;
  }

  // Only send fields the Edge Function accepts — extra fields cause 400
  const safePayload = {
    email:      payload.email,
    password:   payload.password,
    full_name:  payload.full_name,
    role:       payload.role,
    phone:      payload.phone || '',
    department: payload.department || '',
    admin_id:   payload.admin_id,
  };

  const makeRequest = (token) =>
    fetch(`${supabaseUrl}/functions/v1/create-staff-user`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey':        supabaseAnon,
      },
      body: JSON.stringify(safePayload),
    });

  let res = await makeRequest(accessToken);
  if (res.status === 401) {
    const { data: retry } = await supabase.auth.refreshSession();
    const retryToken = retry?.session?.access_token;
    if (!retryToken) throw new Error('Your session has expired. Please log in again.');
    res = await makeRequest(retryToken);
  }

  let data;
  try { data = await res.json(); }
  catch { throw new Error(`Unexpected server response (HTTP ${res.status})`); }

  if (!res.ok) throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
  return data;
};

// ── Success Popup ─────────────────────────────────────────────────────────────
const SuccessPopup = ({ staff, onDone }) => (
  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-8 flex flex-col items-center text-center">
      <div className="w-20 h-20 rounded-full bg-blue-100 flex items-center justify-center mb-5">
        <div className="w-14 h-14 rounded-full flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}>
          <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>
      <h3 className="text-2xl font-bold text-foreground mb-1">Staff Account Created!</h3>
      <p className="text-sm text-muted-foreground mb-5">The user can now log in to the portal.</p>

      <div className="w-full bg-muted/50 rounded-xl p-4 space-y-2 text-left mb-5">
        {[
          { label: 'Name',       value: staff.full_name },
          { label: 'Email',      value: staff.email },
          { label: 'Role',       value: STAFF_ROLES.find(r => r.value === staff.role)?.label || staff.role },
          { label: 'Department', value: staff.department || '—' },
        ].map(r => (
          <div key={r.label} className="flex justify-between text-sm">
            <span className="text-muted-foreground">{r.label}</span>
            <span className="font-semibold text-foreground capitalize">{r.value}</span>
          </div>
        ))}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 mb-6 text-left w-full">
        ⚠️ The login credentials have been emailed to the staff member. They must set their own
        password on first login. The password cannot be retrieved after this point.
      </div>

      <button
        onClick={onDone}
        className="w-full py-2.5 text-white font-semibold text-sm rounded-lg transition-all"
        style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
      >
        Done
      </button>
    </div>
  </div>
);

// ── Role Card ─────────────────────────────────────────────────────────────────
const RoleCard = ({ role, selected, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(role.value)}
    className={`w-full flex items-center gap-3 p-3.5 rounded-xl border-2 text-left transition-all ${
      selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted'
    }`}
  >
    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
      selected ? 'bg-primary' : 'bg-muted'
    }`}>
      <Icon name={role.icon} size={16} color={selected ? 'white' : 'var(--color-muted-foreground)'} />
    </div>
    <div className="min-w-0">
      <p className={`text-sm font-semibold ${selected ? 'text-primary' : 'text-foreground'}`}>{role.label}</p>
      <p className="text-xs text-muted-foreground truncate">{role.desc}</p>
    </div>
    {selected && (
      <div className="ml-auto w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    )}
  </button>
);

// ── Main Component ────────────────────────────────────────────────────────────
const CreateStaffUserModal = ({ isOpen, onClose, onSuccess }) => {
  const { user, userProfile } = useAuth();

  const [step, setStep]               = useState(1);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [success, setSuccess]         = useState(false);
  const [createdStaff, setCreatedStaff] = useState(null);

  const [form, setForm] = useState({
    role: '', full_name: '', email: '', phone: '',
    department: '', password: '', confirm_password: '', notes: '',
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
    if (!form.role) e.role = 'Please select a role';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep2 = () => {
    const e = {};
    if (!form.full_name.trim())        e.full_name        = 'Full name is required';
    if (!form.email.trim())            e.email            = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email address';
    if (!form.department)              e.department       = 'Department is required';
    if (!form.password)                e.password         = 'Password is required';
    else if (form.password.length < 8) e.password         = 'Minimum 8 characters';
    else if (pwdStrength.score < 2)    e.password         = 'Password is too weak';
    if (form.password !== form.confirm_password) e.confirm_password = 'Passwords do not match';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    if (step === 1 && validateStep1()) setStep(2);
    if (step === 2 && validateStep2()) setStep(3);
  };

  const handleBack = () => { setError(''); setStep(s => s - 1); };

  const handleClose = () => {
    setStep(1);
    setForm({ role: '', full_name: '', email: '', phone: '', department: '', password: '', confirm_password: '', notes: '' });
    setErrors({});
    setError('');
    setSuccess(false);
    setCreatedStaff(null);
    onClose();
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      const adminId = userProfile?.id || user?.id;
      if (!adminId) throw new Error('Cannot determine super admin identity. Please refresh.');

      const result = await callEdgeFunction({
        email:      form.email.trim().toLowerCase(),
        password:   form.password,
        full_name:  form.full_name.trim(),
        role:       form.role,
        phone:      form.phone.trim() || null,
        department: form.department,
        admin_id:   adminId,
      });

      const newUserId = result.id;
      if (!newUserId) throw new Error('User creation returned no ID.');

      // Upsert into user_profiles — only columns that exist in your table
      const { error: profileErr } = await supabase
        .from('user_profiles')
        .upsert({
          id:         newUserId,
          full_name:  form.full_name.trim(),
          email:      form.email.trim().toLowerCase(),
          phone:      form.phone.trim() || null,
          role:       form.role,
          department: form.department,
          admin_id:   adminId,
          is_active:  true,
        }, { onConflict: 'id' });

      if (profileErr) console.warn('Profile upsert skipped (non-fatal):', profileErr.message);

      // Audit log
      try {
        await supabase.from('audit_logs').insert({
          action:      'create',
          table_name:  'user_profiles',
          record_id:   newUserId,
          user_id:     user?.id,
          description: `Super admin created staff account: "${form.full_name.trim()}" (${form.email.trim().toLowerCase()}) — Role: ${form.role}, Dept: ${form.department}`,
          new_values: {
            email:      form.email.trim().toLowerCase(),
            role:       form.role,
            department: form.department,
            created_by: userProfile?.full_name || 'Super Admin',
          },
        });
      } catch (auditErr) {
        console.warn('Audit log skipped:', auditErr.message);
      }

      // Auto-email the credentials to the new staff member (non-fatal).
      emailLoginCredentials({
        to: form.email.trim().toLowerCase(),
        type: 'staff_welcome',
        data: {
          fullName:   form.full_name.trim(),
          email:      form.email.trim().toLowerCase(),
          password:   form.password,
          role:       form.role,
          department: form.department,
        },
      });

      const staffDetails = {
        full_name:  form.full_name.trim(),
        email:      form.email.trim().toLowerCase(),
        role:       form.role,
        department: form.department,
      };

      setCreatedStaff(staffDetails);
      setSuccess(true);
      onSuccess?.(staffDetails);

    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Success state ─────────────────────────────────────────────────────────
  if (success && createdStaff) {
    return <SuccessPopup staff={createdStaff} onDone={handleClose} />;
  }

  if (!isOpen) return null;

  const selectedRole = STAFF_ROLES.find(r => r.value === form.role);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center">
              <Icon name="UserCog" size={18} color="#1A56DB" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Create Staff Account</h3>
              <p className="text-xs text-muted-foreground">Step {step} of 3</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2 px-6 py-3 bg-muted/30 border-b border-border">
          {['Select Role', 'Staff Details', 'Review'].map((label, i) => (
            <React.Fragment key={label}>
              <div className="flex items-center gap-2">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                    step > i + 1 ? 'bg-primary text-white' :
                    step === i + 1 ? 'text-white' : 'bg-muted text-muted-foreground'
                  }`}
                  style={step === i + 1 ? { background: 'linear-gradient(135deg, #1A56DB, #1E429F)' } : {}}
                >
                  {step > i + 1 ? '✓' : i + 1}
                </div>
                <span className={`text-xs font-medium hidden sm:block ${step === i + 1 ? 'text-primary' : 'text-muted-foreground'}`}>
                  {label}
                </span>
              </div>
              {i < 2 && <div className={`flex-1 h-0.5 ${step > i + 1 ? 'bg-primary' : 'bg-border'}`} />}
            </React.Fragment>
          ))}
        </div>

        <div className="px-6 py-5">

          {/* ── Step 1: Select Role ── */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground mb-4">
                Choose the role for this staff member. This determines what they can access in the portal.
              </p>
              {STAFF_ROLES.map(role => (
                <RoleCard key={role.value} role={role} selected={form.role === role.value} onSelect={v => set('role', v)} />
              ))}
              {errors.role && (
                <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                  <Icon name="AlertCircle" size={12} color="#ef4444" /> {errors.role}
                </p>
              )}
            </div>
          )}

          {/* ── Step 2: Staff Details ── */}
          {step === 2 && (
            <div className="space-y-4">
              {selectedRole && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-muted/30">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Icon name={selectedRole.icon} size={13} color="#1A56DB" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-primary">{selectedRole.label}</p>
                    <p className="text-xs text-muted-foreground">{selectedRole.desc}</p>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Full Name *</label>
                <input type="text" value={form.full_name} onChange={e => set('full_name', e.target.value)}
                  placeholder="e.g. John Kamau" className={ic(errors.full_name)} />
                {errors.full_name && <p className="mt-1 text-xs text-red-500">{errors.full_name}</p>}
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Email Address *</label>
                <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                  placeholder="staff@company.com" className={ic(errors.email)} />
                {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Phone</label>
                <input type="tel" value={form.phone} onChange={e => set('phone', formatKEPhone(e.target.value))}
                  placeholder="+254 7XX XXX XXX" className={ic(false)} />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Department *</label>
                <select value={form.department} onChange={e => set('department', e.target.value)} className={ic(errors.department)}>
                  <option value="">Select department...</option>
                  {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                {errors.department && <p className="mt-1 text-xs text-red-500">{errors.department}</p>}
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Password *</label>
                <div className="relative">
                  <input type={showPwd ? 'text' : 'password'} value={form.password}
                    onChange={e => set('password', e.target.value)}
                    placeholder="Min 8 characters" className={ic(errors.password)} />
                  <button type="button" onClick={() => setShowPwd(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    <Icon name={showPwd ? 'EyeOff' : 'Eye'} size={15} color="currentColor" />
                  </button>
                </div>
                {form.password && (
                  <div className="mt-2">
                    <div className="flex gap-1 mb-1">
                      {[1,2,3,4,5].map(i => (
                        <div key={i} className={`flex-1 h-1 rounded-full ${i <= pwdStrength.score ? pwdStrength.color : 'bg-muted'}`} />
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">Strength: <span className="font-semibold">{pwdStrength.label}</span></p>
                  </div>
                )}
                {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password}</p>}
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Confirm Password *</label>
                <div className="relative">
                  <input type={showConf ? 'text' : 'password'} value={form.confirm_password}
                    onChange={e => set('confirm_password', e.target.value)}
                    placeholder="Repeat password" className={ic(errors.confirm_password)} />
                  <button type="button" onClick={() => setShowConf(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    <Icon name={showConf ? 'EyeOff' : 'Eye'} size={15} color="currentColor" />
                  </button>
                </div>
                {errors.confirm_password && <p className="mt-1 text-xs text-red-500">{errors.confirm_password}</p>}
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Notes <span className="text-muted-foreground/60 font-normal">(optional)</span>
                </label>
                <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
                  placeholder="Any additional notes about this staff member..."
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground resize-none" />
              </div>
            </div>
          )}

          {/* ── Step 3: Review ── */}
          {step === 3 && (
            <div className="space-y-4">
              {selectedRole && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-white"
                  style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}>
                  <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center">
                    <Icon name={selectedRole.icon} size={16} color="white" />
                  </div>
                  <div>
                    <p className="text-sm font-bold">{selectedRole.label}</p>
                    <p className="text-xs opacity-75">{selectedRole.desc}</p>
                  </div>
                </div>
              )}

              <div className="bg-muted/30 rounded-xl p-4 space-y-2 border border-border">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Personal Info</p>
                {[
                  { label: 'Full Name', value: form.full_name },
                  { label: 'Email',     value: form.email },
                  { label: 'Phone',     value: form.phone || '—' },
                ].map(r => (
                  <div key={r.label} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className="font-medium text-foreground">{r.value}</span>
                  </div>
                ))}
              </div>

              <div className="bg-muted/30 rounded-xl p-4 space-y-2 border border-border">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Access Details</p>
                {[
                  { label: 'Role',         value: selectedRole?.label || form.role },
                  { label: 'Department',   value: form.department },
                  { label: 'Created By',   value: userProfile?.full_name || 'Super Admin' },
                  { label: 'Access Level', value: 'Staff Portal' },
                ].map(r => (
                  <div key={r.label} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className="font-medium text-foreground capitalize">{r.value}</span>
                  </div>
                ))}
              </div>

              {form.notes && (
                <div className="bg-muted/30 rounded-xl p-4 border border-border">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
                  <p className="text-sm text-foreground">{form.notes}</p>
                </div>
              )}

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                ⚠️ Note the password before proceeding — it cannot be retrieved after creation. Share it securely.
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                  <Icon name="AlertCircle" size={15} color="currentColor" />
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          {step > 1 && (
            <button onClick={handleBack} disabled={loading}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-all disabled:opacity-50">
              ← Back
            </button>
          )}
          <button
            onClick={step < 3 ? handleNext : handleSubmit}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #1A56DB, #1E429F)' }}
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                </svg>
                Creating…
              </>
            ) : step < 3 ? (
              'Next →'
            ) : (
              <><Icon name="UserCog" size={15} color="currentColor" /> Create Staff Account</>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};

export default CreateStaffUserModal;

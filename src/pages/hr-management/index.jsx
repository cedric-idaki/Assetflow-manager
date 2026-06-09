import React, { useState, useEffect, useCallback, useRef } from 'react';
import MainLayout from '../../layouts/MainLayout';
import { supabase } from '../../lib/supabase';
import Icon from '../../components/AppIcon';
import { useAdminDashboardContext } from '../../contexts/AdminDashboardContext';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const fmt     = (n) => `KES ${parseFloat(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

// HR employees exist purely as payroll records (they never log in), so the role value
// carries no permissions — it's just a label. We store the already-valid 'staff' enum
// value and display it as "Employee"; no new enum value or DB migration is required.
// `value` = role stored on the profile (valid user_role enum value); `label` = UI text.
const ROLES = [
  { value: 'staff',               label: 'Employee' },
  { value: 'accountant',          label: 'Accountant' },
  { value: 'collections_officer', label: 'Collections Officer' },
  { value: 'manager',             label: 'Manager' },
  { value: 'finance',             label: 'Finance' },
  { value: 'operations',          label: 'Operations' },
  { value: 'sales_agent',         label: 'Sales Agent' },
];
const DEPTS = ['Finance','Sales','Operations','Administration','HR','IT','Management'];
const EMP_TYPES = ['full_time','part_time','contract','intern'];

// Display label for a stored role value (e.g. 'staff' → 'Employee'). Falls back to a
// title-cased version of the raw value for any role not in the ROLES list.
const roleLabel = (role) => {
  const found = ROLES.find(r => r.value === role);
  if (found) return found.label;
  return (role || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

const S = {
  input:  'w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all',
  select: 'w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all',
  label:  'block text-xs font-semibold text-muted-foreground mb-1.5',
  btnPri: 'inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors',
  btnSec: 'inline-flex items-center gap-2 bg-muted text-foreground px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-muted/70 transition-colors',
  th:     'text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40',
  td:     'px-4 py-3 text-sm text-muted-foreground border-t border-border',
  tdF:    'px-4 py-3 text-sm font-medium text-foreground border-t border-border',
};

const Sk = ({ className = '' }) => <div className={`animate-pulse bg-muted rounded-md ${className}`} />;

const Badge = ({ status }) => {
  const map = {
    true:      'bg-emerald-100 text-emerald-700',
    false:     'bg-red-100    text-red-700',
    full_time: 'bg-blue-100   text-blue-700',
    part_time: 'bg-amber-100  text-amber-700',
    contract:  'bg-violet-100 text-violet-700',
    intern:    'bg-gray-100   text-gray-600',
  };
  const label = status === true ? 'Active' : status === false ? 'Inactive' : String(status).replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${map[String(status)] || 'bg-gray-100 text-gray-500'}`}>
      {label}
    </span>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// EMPLOYEE FORM MODAL
// ─────────────────────────────────────────────────────────────────────────────
const EmployeeModal = ({ employee, adminId, onClose, onSaved }) => {
  const isEdit = !!employee;
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const [form, setForm] = useState({
    full_name:           employee?.full_name           || '',
    email:               employee?.email               || '',
    phone:               employee?.phone               || '',
    role:                employee?.role                || 'staff',
    department:          employee?.department          || '',
    employment_type:     employee?.employment_type     || 'full_time',
    date_joined:         employee?.date_joined         || '',
    basic_salary:        employee?.basic_salary        || '',
    housing_allowance:   employee?.housing_allowance   || '',
    transport_allowance: employee?.transport_allowance || '',
    national_id:         employee?.national_id         || '',
    kra_pin:             employee?.kra_pin             || '',
    nssf_number:         employee?.nssf_number         || '',
    sha_number:          employee?.sha_number          || '',
    bank_name:           employee?.bank_name           || '',
    bank_account:        employee?.bank_account        || '',
    bank_branch:         employee?.bank_branch         || '',
    leave_balance:       employee?.leave_balance       ?? 21,
    is_active:           employee?.is_active           ?? true,
  });

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.full_name || !form.email) { setError('Full name and email are required'); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        full_name:           form.full_name,
        phone:               form.phone               || null,
        role:                form.role,
        department:          form.department          || null,
        employment_type:     form.employment_type,
        date_joined:         form.date_joined         || null,
        basic_salary:        parseFloat(form.basic_salary)        || 0,
        housing_allowance:   parseFloat(form.housing_allowance)   || 0,
        transport_allowance: parseFloat(form.transport_allowance) || 0,
        national_id:         form.national_id         || null,
        kra_pin:             form.kra_pin             || null,
        nssf_number:         form.nssf_number         || null,
        sha_number:          form.sha_number          || null,
        bank_name:           form.bank_name           || null,
        bank_account:        form.bank_account        || null,
        bank_branch:         form.bank_branch         || null,
        leave_balance:       parseInt(form.leave_balance) || 21,
        is_active:           form.is_active,
        // On create → tag the record with the creator's account id.
        // On edit  → preserve the original owner so editing never reassigns it.
        admin_id:            isEdit ? (employee.admin_id || adminId) : adminId,
        updated_at:          new Date().toISOString(),
      };

      if (isEdit) {
        // Edit: safe to update user_profiles directly — auth user already exists
        const { error: err } = await supabase.from('user_profiles').update(payload).eq('id', employee.id);
        if (err) throw err;
      } else {
        // New employee: must go through the Edge Function to satisfy user_profiles_id_fkey.
        // A strong random password is auto-generated — HR never sees it and the employee
        // receives no credentials. This is a payroll record, not a login account.
        const autoPassword = `${Date.now()}-${Math.random().toString(36).substring(2)}-${Math.random().toString(36).substring(2)}`;

        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        if (!accessToken) throw new Error('Session expired. Please refresh and try again.');

        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-staff-user`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              email:      form.email.trim().toLowerCase(),
              password:   autoPassword,
              full_name:  form.full_name.trim(),
              role:       form.role,
              phone:      form.phone || '',
              department: form.department || '',
              admin_id:   adminId,
            }),
          }
        );
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Failed to create employee record.');

        // Patch the profile with the HR-specific fields the Edge Function doesn't set.
        // Critically, admin_id must be written here — the handle_new_user trigger only
        // copies id/email/full_name/role, so without this the new employee would have a
        // NULL admin_id and never appear in the creator's scoped list.
        if (result.id) {
          await supabase.from('user_profiles').update({
            admin_id:            payload.admin_id,
            department:          payload.department,
            is_active:           payload.is_active,
            employment_type:     payload.employment_type,
            date_joined:         payload.date_joined,
            basic_salary:        payload.basic_salary,
            housing_allowance:   payload.housing_allowance,
            transport_allowance: payload.transport_allowance,
            national_id:         payload.national_id,
            kra_pin:             payload.kra_pin,
            nssf_number:         payload.nssf_number,
            sha_number:          payload.sha_number,
            bank_name:           payload.bank_name,
            bank_account:        payload.bank_account,
            bank_branch:         payload.bank_branch,
            leave_balance:       payload.leave_balance,
            updated_at:          payload.updated_at,
          }).eq('id', result.id);
        }
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const Section = ({ title }) => (
    <div className="col-span-2 pt-2 pb-1 border-b border-border">
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{title}</p>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">{isEdit ? `Edit — ${employee.full_name}` : 'Add New Employee'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="var(--muted-foreground)" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5">
          <div className="grid grid-cols-2 gap-4">
            <Section title="Personal Information" />
            <div>
              <label className={S.label}>Full Name *</label>
              <input className={S.input} value={form.full_name} onChange={e => set('full_name', e.target.value)} />
            </div>
            <div>
              <label className={S.label}>Email *</label>
              <input type="email" className={S.input} value={form.email} onChange={e => set('email', e.target.value)} disabled={isEdit} />
            </div>
            <div>
              <label className={S.label}>Phone</label>
              <input className={S.input} placeholder="+254 7XX XXX XXX" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </div>
            <div>
              <label className={S.label}>National ID</label>
              <input className={S.input} value={form.national_id} onChange={e => set('national_id', e.target.value)} />
            </div>

            <Section title="Employment Details" />
            <div>
              <label className={S.label}>Role</label>
              <select className={S.select} value={form.role} onChange={e => set('role', e.target.value)}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className={S.label}>Department</label>
              <select className={S.select} value={form.department} onChange={e => set('department', e.target.value)}>
                <option value="">— Select —</option>
                {DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className={S.label}>Employment Type</label>
              <select className={S.select} value={form.employment_type} onChange={e => set('employment_type', e.target.value)}>
                {EMP_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
              </select>
            </div>
            <div>
              <label className={S.label}>Date Joined</label>
              <input type="date" className={S.input} value={form.date_joined} onChange={e => set('date_joined', e.target.value)} />
            </div>
            <div>
              <label className={S.label}>Leave Balance (days)</label>
              <input type="number" className={S.input} value={form.leave_balance} onChange={e => set('leave_balance', e.target.value)} />
            </div>
            <div className="flex items-center gap-3 pt-5">
              <input type="checkbox" id="is_active" checked={form.is_active} onChange={e => set('is_active', e.target.checked)}
                className="w-4 h-4 accent-primary" />
              <label htmlFor="is_active" className="text-sm font-medium text-foreground">Active Employee</label>
            </div>

            <Section title="Compensation" />
            <div>
              <label className={S.label}>Basic Salary (KES)</label>
              <input type="number" className={S.input} placeholder="0" value={form.basic_salary} onChange={e => set('basic_salary', e.target.value)} />
            </div>
            <div>
              <label className={S.label}>Housing Allowance (KES)</label>
              <input type="number" className={S.input} placeholder="0" value={form.housing_allowance} onChange={e => set('housing_allowance', e.target.value)} />
            </div>
            <div>
              <label className={S.label}>Transport Allowance (KES)</label>
              <input type="number" className={S.input} placeholder="0" value={form.transport_allowance} onChange={e => set('transport_allowance', e.target.value)} />
            </div>

            <Section title="Statutory Details" />
            <div>
              <label className={S.label}>KRA PIN</label>
              <input className={S.input} placeholder="A000000000X" value={form.kra_pin} onChange={e => set('kra_pin', e.target.value)} />
            </div>
            <div>
              <label className={S.label}>NSSF Number</label>
              <input className={S.input} value={form.nssf_number} onChange={e => set('nssf_number', e.target.value)} />
            </div>
            <div>
              <label className={S.label}>SHA Number</label>
              <input className={S.input} value={form.sha_number} onChange={e => set('sha_number', e.target.value)} />
            </div>

            <Section title="Bank Details" />
            <div>
              <label className={S.label}>Bank Name</label>
              <input className={S.input} placeholder="e.g. Equity Bank" value={form.bank_name} onChange={e => set('bank_name', e.target.value)} />
            </div>
            <div>
              <label className={S.label}>Account Number</label>
              <input className={S.input} value={form.bank_account} onChange={e => set('bank_account', e.target.value)} />
            </div>
            <div>
              <label className={S.label}>Branch</label>
              <input className={S.input} value={form.bank_branch} onChange={e => set('bank_branch', e.target.value)} />
            </div>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">{error}</div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose} className={S.btnSec}>Cancel</button>
          <button onClick={handleSave} disabled={saving} className={S.btnPri}>
            {saving ? <><Icon name="Loader" size={14} color="currentColor" className="animate-spin" /> Saving…</> : <><Icon name="CheckCircle" size={14} color="currentColor" /> {isEdit ? 'Save Changes' : 'Add Employee'}</>}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// EMPLOYEE DETAIL DRAWER
// ─────────────────────────────────────────────────────────────────────────────
const EmployeeDetail = ({ employee, payrollHistory, onEdit, onClose }) => {
  const gross = parseFloat(employee.basic_salary || 0) + parseFloat(employee.housing_allowance || 0) + parseFloat(employee.transport_allowance || 0);

  const Row = ({ label, value }) => (
    <div className="flex justify-between items-center py-2.5 border-b border-border">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground text-right max-w-48 truncate">{value || '—'}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end md:items-center justify-end p-0 md:p-4">
      <div className="bg-card border-l border-border w-full md:w-[480px] h-full md:h-auto md:max-h-[90vh] flex flex-col shadow-2xl md:rounded-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <span className="text-base font-bold text-primary">{employee.full_name?.charAt(0)}</span>
            </div>
            <div>
              <p className="text-base font-semibold">{employee.full_name}</p>
              <p className="text-xs text-muted-foreground">{roleLabel(employee.role)} · {employee.department || '—'}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={onEdit} className={S.btnSec + ' text-xs py-1.5'}>
              <Icon name="Edit" size={13} color="currentColor" /> Edit
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
              <Icon name="X" size={18} color="var(--muted-foreground)" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
          <div className="flex gap-2">
            <Badge status={employee.is_active} />
            <Badge status={employee.employment_type} />
          </div>

          <div className="bg-primary/5 border border-primary/20 rounded-xl p-5">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Compensation</p>
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { label: 'Basic Salary', value: fmt(employee.basic_salary) },
                { label: 'Housing',      value: fmt(employee.housing_allowance) },
                { label: 'Transport',    value: fmt(employee.transport_allowance) },
              ].map(({ label, value }) => (
                <div key={label} className="bg-card rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-sm font-bold font-mono text-foreground mt-0.5">{value}</p>
                </div>
              ))}
            </div>
            <div className="flex justify-between items-center mt-3 pt-3 border-t border-primary/20">
              <span className="text-sm font-bold text-foreground">Gross Package</span>
              <span className="text-lg font-black font-mono text-primary">{fmt(gross)}</span>
            </div>
          </div>

          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Personal</p>
            <Row label="Email"         value={employee.email} />
            <Row label="Phone"         value={employee.phone} />
            <Row label="National ID"   value={employee.national_id} />
            <Row label="Date Joined"   value={fmtDate(employee.date_joined)} />
            <Row label="Leave Balance" value={`${employee.leave_balance ?? 21} days`} />
          </div>

          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Statutory</p>
            <Row label="KRA PIN"  value={employee.kra_pin} />
            <Row label="NSSF No." value={employee.nssf_number} />
            <Row label="SHA No."  value={employee.sha_number} />
          </div>

          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Bank Details</p>
            <Row label="Bank"    value={employee.bank_name} />
            <Row label="Account" value={employee.bank_account} />
            <Row label="Branch"  value={employee.bank_branch} />
          </div>

          {payrollHistory.length > 0 && (
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Recent Payroll</p>
              {payrollHistory.slice(0, 4).map(p => (
                <div key={p.id} className="flex justify-between items-center py-2.5 border-b border-border">
                  <span className="text-xs text-muted-foreground">{p.pay_month}</span>
                  <div className="text-right">
                    <p className="text-sm font-mono font-semibold text-emerald-600">{fmt(p.net_salary)}</p>
                    <p className="text-xs text-muted-foreground">Gross {fmt(p.gross_salary)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// RUN PAYROLL MODAL
// ─────────────────────────────────────────────────────────────────────────────
const RunPayrollModal = ({ employees, adminId, onClose, onSaved }) => {
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const [payMonth,  setPayMonth]  = useState(currentMonth);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');

  // Per-employee additional payments — keyed by employee id
  const [extras, setExtras] = useState(() => {
    const init = {};
    employees.forEach(e => {
      init[e.id] = { loan: '', meal: '', advance: '', bonus: '', gift: '' };
    });
    return init;
  });

  const setExtra = (empId, field, val) =>
    setExtras(prev => ({ ...prev, [empId]: { ...prev[empId], [field]: val } }));

  // Kenya statutory deduction calculators
  const calcPAYE = (gross) => {
    // Simplified Kenya PAYE tax bands 2024
    if (gross <= 24000)  return 0;
    if (gross <= 32333)  return (gross - 24000) * 0.10;
    if (gross <= 40667)  return 833 + (gross - 32333) * 0.25;
    if (gross <= 57333)  return 2917 + (gross - 40667) * 0.30;
    return 7917 + (gross - 57333) * 0.35;
  };
  const calcNSSF  = (gross) => Math.min(gross * 0.06, 2160); // 6% capped at 2160
  const calcSHIF  = (gross) => gross * 0.0275;               // 2.75% (SHA/SHIF)

  const computeRow = (emp) => {
    const basic     = parseFloat(emp.basic_salary || 0);
    const housing   = parseFloat(emp.housing_allowance || 0);
    const transport = parseFloat(emp.transport_allowance || 0);
    const ex        = extras[emp.id] || {};
    const loan      = parseFloat(ex.loan    || 0);
    const meal      = parseFloat(ex.meal    || 0);
    const advance   = parseFloat(ex.advance || 0);
    const bonus     = parseFloat(ex.bonus   || 0);
    const gift      = parseFloat(ex.gift    || 0);

    const grossAdditions = basic + housing + transport + meal + bonus + gift;
    const paye    = calcPAYE(grossAdditions);
    const nssf    = calcNSSF(grossAdditions);
    const shif    = calcSHIF(grossAdditions);
    const totalDeductions = paye + nssf + shif + loan + advance;
    const netPay  = grossAdditions - totalDeductions;

    return { basic, housing, transport, meal, bonus, gift, loan, advance, grossAdditions, paye, nssf, shif, totalDeductions, netPay };
  };

  const handleRunPayroll = async () => {
    if (!payMonth) { setError('Please select a pay month.'); return; }
    if (employees.length === 0) { setError('No employees to process.'); return; }
    setSaving(true); setError(''); setSuccess('');
    try {
      const records = employees.filter(e => e.is_active).map(emp => {
        const r = computeRow(emp);
        return {
          employee_id:  emp.id,
          admin_id:     adminId,
          pay_month:    payMonth,
          gross_salary: r.grossAdditions,
          basic_salary: r.basic,
          housing_allowance:   r.housing,
          transport_allowance: r.transport,
          meal_allowance:      r.meal,
          bonus:               r.bonus,
          gift:                r.gift,
          loan_deduction:      r.loan,
          advance_deduction:   r.advance,
          paye:        r.paye,
          nssf:        r.nssf,
          shif:        r.shif,
          net_salary:  r.netPay,
          status:      'pending',
          created_at:  new Date().toISOString(),
        };
      });

      const { error: err } = await supabase.from('payroll_records').insert(records);
      if (err) throw err;

      setSuccess(`Payroll for ${payMonth} processed successfully for ${records.length} employee(s).`);
      setTimeout(() => { onSaved(); onClose(); }, 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const activeEmployees = employees.filter(e => e.is_active);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h3 className="text-base font-semibold text-foreground">Run Payroll</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Set additional payments per employee, then process</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="var(--muted-foreground)" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

          {/* Pay month selector */}
          <div className="flex items-center gap-4">
            <div>
              <label className={S.label}>Pay Month *</label>
              <input
                type="month"
                value={payMonth}
                onChange={e => setPayMonth(e.target.value)}
                className={S.input + ' w-48'}
              />
            </div>
            <div className="text-xs text-muted-foreground pt-5">
              Processing payroll for <strong>{activeEmployees.length}</strong> active employee(s)
            </div>
          </div>

          {/* Per-employee extras table */}
          {activeEmployees.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Icon name="Users" size={28} color="var(--muted-foreground)" />
              <p className="text-sm text-muted-foreground mt-2">No active employees to process</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {['Employee', 'Basic', 'Housing', 'Transport', 'Meal Allow.', 'Bonus', 'Gift', 'Loan Deduct.', 'Advance Deduct.', 'Est. Net Pay'].map(h => (
                      <th key={h} className={S.th + ' whitespace-nowrap'}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeEmployees.map(emp => {
                    const r = computeRow(emp);
                    const ex = extras[emp.id] || {};
                    return (
                      <tr key={emp.id} className="border-t border-border hover:bg-muted/20 transition-colors">
                        <td className={S.tdF + ' whitespace-nowrap'}>
                          <p className="font-medium">{emp.full_name}</p>
                          <p className="text-xs text-muted-foreground">{emp.department || '—'}</p>
                        </td>
                        <td className={S.td + ' font-mono'}>{fmt(emp.basic_salary)}</td>
                        <td className={S.td + ' font-mono'}>{fmt(emp.housing_allowance)}</td>
                        <td className={S.td + ' font-mono'}>{fmt(emp.transport_allowance)}</td>

                        {/* Meal Allowance */}
                        <td className={S.td}>
                          <input
                            type="number"
                            min="0"
                            placeholder="0"
                            value={ex.meal}
                            onChange={e => setExtra(emp.id, 'meal', e.target.value)}
                            className="w-24 bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </td>

                        {/* Bonus */}
                        <td className={S.td}>
                          <input
                            type="number"
                            min="0"
                            placeholder="0"
                            value={ex.bonus}
                            onChange={e => setExtra(emp.id, 'bonus', e.target.value)}
                            className="w-24 bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </td>

                        {/* Gift */}
                        <td className={S.td}>
                          <input
                            type="number"
                            min="0"
                            placeholder="0"
                            value={ex.gift}
                            onChange={e => setExtra(emp.id, 'gift', e.target.value)}
                            className="w-24 bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </td>

                        {/* Loan deduction */}
                        <td className={S.td}>
                          <input
                            type="number"
                            min="0"
                            placeholder="0"
                            value={ex.loan}
                            onChange={e => setExtra(emp.id, 'loan', e.target.value)}
                            className="w-24 bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </td>

                        {/* Advance deduction */}
                        <td className={S.td}>
                          <input
                            type="number"
                            min="0"
                            placeholder="0"
                            value={ex.advance}
                            onChange={e => setExtra(emp.id, 'advance', e.target.value)}
                            className="w-24 bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </td>

                        {/* Estimated net pay */}
                        <td className={S.td}>
                          <span className={`font-mono font-bold text-sm ${r.netPay >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                            {fmt(r.netPay)}
                          </span>
                          <p className="text-xs text-muted-foreground">
                            Deductions: {fmt(r.totalDeductions)}
                          </p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {error   && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">{error}</div>}
          {success && <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700">{success}</div>}

          {/* Statutory note */}
          <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700">
            <strong>Statutory deductions applied automatically:</strong> PAYE (Kenya tax bands), NSSF (6% capped at KES 2,160), SHA/SHIF (2.75%)
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose} className={S.btnSec}>Cancel</button>
          <button
            onClick={handleRunPayroll}
            disabled={saving || activeEmployees.length === 0}
            className={S.btnPri}
          >
            {saving
              ? <><Icon name="Loader" size={14} color="currentColor" className="animate-spin" /> Processing…</>
              : <><Icon name="Play" size={14} color="currentColor" /> Run Payroll for {payMonth}</>
            }
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
const HRPage = () => {
  const { modals, openModal, closeModal } = useAdminDashboardContext();

  const [employees,      setEmployees]      = useState([]);
  const [payrollRecords, setPayrollRecords] = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [adminId,        setAdminId]        = useState(null);
  const [search,         setSearch]         = useState('');
  const [deptFilter,     setDeptFilter]     = useState('all');
  const [activeTab,      setActiveTab]      = useState('employees');
  const [payrollFilter,  setPayrollFilter]  = useState('');
  const adminIdRef = useRef(null);
  const hasLoaded  = useRef(false);

  // Derive modal state from context
  const showModal    = !!modals.hrEmployee;
  const editEmployee = modals.hrEmployee === true ? null : modals.hrEmployee;
  const selected     = modals.hrEmployeeDetail;
  const showPayroll  = !!modals.hrPayroll;

  const resolveAdminId = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: profile } = await supabase.from('user_profiles').select('id, role, admin_id').eq('id', user.id).maybeSingle();
    // admin & super_admin own the records they create (scope by their own id).
    // Other staff inherit their parent admin's scope via admin_id.
    return (profile?.role === 'admin' || profile?.role === 'super_admin')
      ? user.id
      : (profile?.admin_id || user.id);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const aId = await resolveAdminId();
    setAdminId(aId);
    adminIdRef.current = aId;
    if (!aId) { setLoading(false); return; }

    const [empRes, payRes] = await Promise.all([
      supabase.from('user_profiles')
        .select('id, full_name, email, role, department, phone, is_active, employment_type, date_joined, leave_balance, basic_salary, housing_allowance, transport_allowance, kra_pin, nssf_number, sha_number, national_id, bank_name, bank_account, bank_branch')
        // Scoped to the viewer's account: an admin sees all staff under their account;
        // a super admin sees only the staff they created. Account-holder roles
        // (client / admin / super_admin) are never listed as "employees".
        .eq('admin_id', aId)
        .not('role', 'in', '("client","super_admin","admin")')
        .order('full_name'),
      supabase.from('payroll_records')
        .select('id, employee_id, pay_month, gross_salary, net_salary, paye, nssf, shif, status, meal_allowance, bonus, gift, loan_deduction, advance_deduction')
        .eq('admin_id', aId)
        .order('pay_month', { ascending: false })
        .limit(200),
    ]);

    setEmployees(empRes.data || []);
    setPayrollRecords(payRes.data || []);
    hasLoaded.current = true;
    setLoading(false);
  }, [resolveAdminId]);

  // Run once on mount — hasLoaded guard prevents re-fetch on tab-switch remount
  useEffect(() => {
    if (hasLoaded.current) return;
    fetchAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = employees.filter(e => {
    const q = search.toLowerCase();
    const matchSearch = !search || e.full_name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q) || (e.department || '').toLowerCase().includes(q);
    const matchDept = deptFilter === 'all' || e.department === deptFilter;
    return matchSearch && matchDept;
  });

  const depts = [...new Set(employees.map(e => e.department).filter(Boolean))];
  const empPayroll = (empId) => payrollRecords.filter(p => p.employee_id === empId);

  // Payroll tab filter by month
  const filteredPayroll = payrollFilter
    ? payrollRecords.filter(p => p.pay_month === payrollFilter)
    : payrollRecords;

  // Unique months for filter dropdown
  const payMonths = [...new Set(payrollRecords.map(p => p.pay_month))].sort().reverse();

  // KPI totals
  const totalPayroll = employees.reduce((s, e) => s + parseFloat(e.basic_salary || 0) + parseFloat(e.housing_allowance || 0) + parseFloat(e.transport_allowance || 0), 0);
  const activeCount  = employees.filter(e => e.is_active).length;

  // Export payroll to CSV
  const exportPayrollCSV = () => {
    const rows = filteredPayroll.map(p => {
      const emp = employees.find(e => e.id === p.employee_id);
      return {
        Employee:   emp?.full_name || '—',
        Email:      emp?.email || '—',
        Department: emp?.department || '—',
        Pay_Month:  p.pay_month,
        Basic:      p.basic_salary || 0,
        Housing:    p.housing_allowance || 0,
        Transport:  p.transport_allowance || 0,
        Meal:       p.meal_allowance || 0,
        Bonus:      p.bonus || 0,
        Gift:       p.gift || 0,
        Gross:      p.gross_salary,
        PAYE:       p.paye,
        NSSF:       p.nssf,
        SHIF:       p.shif,
        Loan_Deduction:    p.loan_deduction || 0,
        Advance_Deduction: p.advance_deduction || 0,
        Net_Pay:    p.net_salary,
        Status:     p.status,
      };
    });
    if (!rows.length) return;
    const keys = Object.keys(rows[0]);
    const csv  = [keys.join(','), ...rows.map(r => keys.map(k => `"${r[k]}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `payroll_${payrollFilter || 'all'}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <MainLayout>
      <div className="p-6 space-y-6">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-foreground tracking-tight">HR Management</h1>
            <p className="text-sm text-muted-foreground mt-1">Employee records, compensation and statutory details</p>
          </div>
          <button className={S.btnPri} onClick={() => openModal('hrEmployee', true)}>
            <Icon name="UserPlus" size={15} color="currentColor" /> Add Employee
          </button>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Employees', value: employees.length,  icon: 'Users',       bg: 'bg-blue-100 dark:bg-blue-900/30',       color: '#3b82f6' },
            { label: 'Active',          value: activeCount,       icon: 'UserCheck',   bg: 'bg-emerald-100 dark:bg-emerald-900/30', color: '#10b981' },
            { label: 'Departments',     value: depts.length,      icon: 'Building2',   bg: 'bg-violet-100 dark:bg-violet-900/30',   color: '#8b5cf6' },
            { label: 'Monthly Payroll', value: fmt(totalPayroll), icon: 'DollarSign',  bg: 'bg-amber-100 dark:bg-amber-900/30',     color: '#f59e0b' },
          ].map(({ label, value, icon, bg, color }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-5">
              {loading ? <Sk className="h-12 w-full" /> : (
                <>
                  <div className="flex items-start justify-between mb-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${bg}`}>
                      <Icon name={icon} size={15} color={color} />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-foreground font-mono">{value}</p>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-border pb-1">
          {[
            { id: 'employees', label: 'Employee Records', icon: 'Users'    },
            { id: 'payroll',   label: 'Payroll',          icon: 'Receipt'  },
          ].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}>
              <Icon name={t.icon} size={13} color="currentColor" />
              {t.label}
            </button>
          ))}
        </div>

        {/* ── EMPLOYEES TAB ─────────────────────────────────────────────── */}
        {activeTab === 'employees' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-48">
                <Icon name="Search" size={14} color="var(--muted-foreground)" className="absolute left-3 top-1/2 -translate-y-1/2" />
                <input className={`${S.input} pl-9`} placeholder="Search by name, email, department…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <select className={`${S.select} w-auto`} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
                <option value="all">All Departments</option>
                {depts.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      {['Employee', 'Role', 'Department', 'Type', 'Gross Package', 'Leave', 'Status', ''].map(h => (
                        <th key={h} className={S.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      Array(5).fill(0).map((_, i) => (
                        <tr key={i}>{Array(8).fill(0).map((_, j) => <td key={j} className={S.td}><Sk className="h-4 w-full" /></td>)}</tr>
                      ))
                    ) : filtered.length === 0 ? (
                      <tr><td colSpan={8}>
                        <div className="flex flex-col items-center justify-center py-16">
                          <Icon name="Users" size={28} color="var(--muted-foreground)" />
                          <p className="text-sm font-medium text-foreground mt-3">No employees found</p>
                          <p className="text-xs text-muted-foreground">Click "Add Employee" to create the first record</p>
                        </div>
                      </td></tr>
                    ) : filtered.map(emp => {
                      const gross = parseFloat(emp.basic_salary || 0) + parseFloat(emp.housing_allowance || 0) + parseFloat(emp.transport_allowance || 0);
                      return (
                        <tr key={emp.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => openModal('hrEmployeeDetail', emp)}>
                          <td className={S.tdF}>
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                                <span className="text-xs font-bold text-primary">{emp.full_name?.charAt(0)}</span>
                              </div>
                              <div>
                                <p className="font-medium text-foreground">{emp.full_name}</p>
                                <p className="text-xs text-muted-foreground">{emp.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className={S.td}>{roleLabel(emp.role)}</td>
                          <td className={S.td}>{emp.department || '—'}</td>
                          <td className={S.td}><Badge status={emp.employment_type} /></td>
                          <td className={`${S.td} font-mono font-semibold text-foreground`}>{fmt(gross)}</td>
                          <td className={S.td}>{emp.leave_balance ?? 21} days</td>
                          <td className={S.td}><Badge status={emp.is_active} /></td>
                          <td className={S.td}>
                            <button className="text-xs text-primary hover:underline" onClick={e => { e.stopPropagation(); openModal('hrEmployee', emp); }}>
                              Edit
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── PAYROLL TAB ───────────────────────────────────────────────── */}
        {activeTab === 'payroll' && (
          <div className="space-y-4">

            {/* Payroll toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <select
                  className={`${S.select} w-48`}
                  value={payrollFilter}
                  onChange={e => setPayrollFilter(e.target.value)}
                >
                  <option value="">All months</option>
                  {payMonths.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <span className="text-xs text-muted-foreground">
                  {filteredPayroll.length} record(s)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={exportPayrollCSV}
                  disabled={filteredPayroll.length === 0}
                  className={S.btnSec + ' disabled:opacity-50'}
                >
                  <Icon name="Download" size={14} color="currentColor" />
                  Export CSV
                </button>
                <button
                  onClick={() => openModal('hrPayroll', true)}
                  className={S.btnPri}
                >
                  <Icon name="Play" size={14} color="currentColor" />
                  Run Payroll
                </button>
              </div>
            </div>

            {/* Payroll summary cards for selected month */}
            {filteredPayroll.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Total Gross',      value: fmt(filteredPayroll.reduce((s, p) => s + parseFloat(p.gross_salary || 0), 0)),  color: 'text-foreground' },
                  { label: 'Total Net Pay',     value: fmt(filteredPayroll.reduce((s, p) => s + parseFloat(p.net_salary   || 0), 0)),  color: 'text-emerald-600' },
                  { label: 'Total PAYE',        value: fmt(filteredPayroll.reduce((s, p) => s + parseFloat(p.paye         || 0), 0)),  color: 'text-red-500' },
                  { label: 'Total NSSF + SHIF', value: fmt(filteredPayroll.reduce((s, p) => s + parseFloat(p.nssf || 0) + parseFloat(p.shif || 0), 0)), color: 'text-orange-500' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-card border border-border rounded-xl p-4">
                    <p className="text-xs text-muted-foreground mb-1">{label}</p>
                    <p className={`text-lg font-bold font-mono ${color}`}>{value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Payroll records table */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      {['Employee', 'Pay Month', 'Basic', 'Allowances', 'Additions', 'Gross', 'PAYE', 'NSSF', 'SHA', 'Other Deduct.', 'Net Pay', 'Status'].map(h => (
                        <th key={h} className={S.th + ' whitespace-nowrap'}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      Array(5).fill(0).map((_, i) => <tr key={i}>{Array(12).fill(0).map((_, j) => <td key={j} className={S.td}><Sk className="h-4 w-full" /></td>)}</tr>)
                    ) : filteredPayroll.length === 0 ? (
                      <tr><td colSpan={12}>
                        <div className="flex flex-col items-center justify-center py-16">
                          <Icon name="Receipt" size={28} color="var(--muted-foreground)" />
                          <p className="text-sm font-medium text-foreground mt-3">No payroll records yet</p>
                          <p className="text-xs text-muted-foreground mt-1">Click <strong>Run Payroll</strong> to process your first payroll</p>
                        </div>
                      </td></tr>
                    ) : filteredPayroll.map(p => {
                      const emp         = employees.find(e => e.id === p.employee_id);
                      const allowances  = parseFloat(p.housing_allowance || 0) + parseFloat(p.transport_allowance || 0);
                      const additions   = parseFloat(p.meal_allowance || 0) + parseFloat(p.bonus || 0) + parseFloat(p.gift || 0);
                      const otherDeduct = parseFloat(p.loan_deduction || 0) + parseFloat(p.advance_deduction || 0);
                      return (
                        <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                          <td className={S.tdF + ' whitespace-nowrap'}>
                            <p>{emp?.full_name || '—'}</p>
                            <p className="text-xs text-muted-foreground">{emp?.department || '—'}</p>
                          </td>
                          <td className={S.td}>{p.pay_month}</td>
                          <td className={`${S.td} font-mono`}>{fmt(p.basic_salary)}</td>
                          <td className={`${S.td} font-mono`}>{fmt(allowances)}</td>
                          <td className={`${S.td} font-mono text-blue-600`}>{fmt(additions)}</td>
                          <td className={`${S.td} font-mono font-semibold`}>{fmt(p.gross_salary)}</td>
                          <td className={`${S.td} font-mono text-red-500`}>({fmt(p.paye)})</td>
                          <td className={`${S.td} font-mono text-red-500`}>({fmt(p.nssf)})</td>
                          <td className={`${S.td} font-mono text-red-500`}>({fmt(p.shif)})</td>
                          <td className={`${S.td} font-mono text-orange-500`}>{otherDeduct > 0 ? `(${fmt(otherDeduct)})` : '—'}</td>
                          <td className={`${S.td} font-mono font-bold text-emerald-600`}>{fmt(p.net_salary)}</td>
                          <td className={S.td}>
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${
                              p.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                            }`}>{p.status}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Employee detail drawer */}
      {selected && (
        <EmployeeDetail
          employee={selected}
          payrollHistory={empPayroll(selected.id)}
          onEdit={() => openModal('hrEmployee', selected)}
          onClose={() => closeModal('hrEmployeeDetail')}
        />
      )}

      {/* Add/Edit modal */}
      {showModal && (
        <EmployeeModal
          employee={editEmployee}
          adminId={adminIdRef.current || adminId}
          onClose={() => closeModal('hrEmployee')}
          onSaved={fetchAll}
        />
      )}

      {/* Run Payroll modal */}
      {showPayroll && (
        <RunPayrollModal
          employees={employees}
          adminId={adminIdRef.current || adminId}
          onClose={() => closeModal('hrPayroll')}
          onSaved={fetchAll}
        />
      )}
    </MainLayout>
  );
};

export default HRPage;

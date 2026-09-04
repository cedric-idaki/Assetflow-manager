import React, { useState, useEffect, useCallback, useRef } from 'react';
import MainLayout from '../../layouts/MainLayout';
import ClosePageButton from '../../components/ui/ClosePageButton';
import { supabase } from '../../lib/supabase';
import { openStoredFile } from '../../lib/storageUrl';
import { useSignedUrl } from '../../hooks/useSignedUrl';
import Icon from '../../components/AppIcon';
import { useAdminDashboardContext } from '../../contexts/AdminDashboardContext';
import { generateTempPassword } from '../../services/credentialsEmailService';
import { PII_FIELDS, emptyPii, fetchEmployeePii, saveEmployeePii } from '../../services/employeePiiService';
import { computePayroll, payrollInputForEmployee, payrollRecordFrom, resolveRateSchedule, resolvePayrollRecord } from '../../utils/kenyaPayroll';
import { payslipDocument } from '../../utils/payslipDocument';
import { buildP10Rows, p10Totals, p10Exceptions, P10_COLUMNS } from '../../utils/payeReturns';
import { downloadCSV } from '../../utils/exportUtils';
import { useStatutoryCalendar } from '../../hooks/useStatutoryCalendar';
import { dueDateFor } from '../../utils/statutoryCalendar';
import { findReturn } from '../../config/statutoryReturns';
import StatutoryCalendarPanel from './components/StatutoryCalendarPanel';

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
// Licensed Kenyan commercial banks — drives the Bank Name dropdown in the
// employee form. Kept alphabetical so a name is easy to find.
const BANKS = [
  'Absa Bank Kenya',
  'Access Bank Kenya',
  'Bank of Africa',
  'Bank of Baroda',
  'Bank of India',
  'Citibank',
  'Consolidated Bank',
  'Co-operative Bank',
  'Credit Bank',
  'Development Bank of Kenya',
  'Diamond Trust Bank (DTB)',
  'Ecobank',
  'Equity Bank',
  'Family Bank',
  'First Community Bank',
  'Guaranty Trust Bank (GTBank)',
  'Gulf African Bank',
  'Housing Finance (HFC)',
  'I&M Bank',
  'KCB Bank',
  'Kingdom Bank',
  'Middle East Bank',
  'NCBA Bank',
  'National Bank of Kenya',
  'Paramount Bank',
  'Prime Bank',
  'SBM Bank Kenya',
  'Sidian Bank',
  'Stanbic Bank',
  'Standard Chartered Bank',
  'UBA Kenya',
  'Victoria Commercial Bank',
];

// Every field in the Add / Edit Employee form is mandatory. This drives both the
// red-border highlighting and the "missing fields" message on save. The auto-
// calculated Housing Levy and the Active toggle are intentionally excluded — they
// are derived / always have a value, so there is nothing to "fill in".
const REQUIRED_FIELDS = [
  ['full_name',                      'Full Name'],
  ['email',                          'Email'],
  ['phone',                          'Phone'],
  ['national_id',                    'National ID'],
  ['gender',                         'Gender'],
  ['date_of_birth',                  'Date of Birth'],
  ['next_of_kin_name',               'Next of Kin Name'],
  ['next_of_kin_relationship',       'Next of Kin Relationship'],
  ['next_of_kin_phone',              'Next of Kin Phone'],
  ['next_of_kin_id',                 'Next of Kin ID Number'],
  ['secondary_contact_name',         'Secondary Contact Name'],
  ['secondary_contact_relationship', 'Secondary Contact Relationship'],
  ['secondary_contact_phone',        'Secondary Contact Phone'],
  ['role',                           'Role'],
  ['department',                     'Department'],
  ['employment_type',                'Employment Type'],
  ['date_joined',                    'Date Joined'],
  ['leave_balance',                  'Leave Balance'],
  // Compensation (basic_salary / housing_allowance / transport_allowance) is
  // intentionally optional — it can be set later, and payroll defaults blanks to 0.
  ['kra_pin',                        'KRA PIN'],
  ['nssf_number',                    'NSSF Number'],
  ['sha_number',                     'SHA Number'],
  ['bank_name',                      'Bank Name'],
  ['bank_account',                   'Account Number'],
  ['bank_branch',                    'Branch'],
];
const isEmpty = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

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

// "Not uploaded" placeholder shared by the Documents tab cells.
const NoDoc = () => (
  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
    <Icon name="Minus" size={12} color="currentColor" /> Not uploaded
  </span>
);

// A compact link to an uploaded employee document (ID/passport, CV).
const DocLink = ({ url, label }) => url ? (
  <a href={url} onClick={(e) => { e.preventDefault(); openStoredFile(url); }}
    target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
    <Icon name="FileText" size={13} color="currentColor" /> {label}
  </a>
) : <NoDoc />;

// Thumbnail preview for an uploaded employee photo (links to the full image).
// employee-documents is a private bucket, so the <img> needs a signed URL rather
// than the stored one.
const DocThumb = ({ url }) => {
  const { url: signed } = useSignedUrl(url);
  if (!url) return <NoDoc />;
  return (
    <a href={url} onClick={(e) => { e.preventDefault(); openStoredFile(url); }}
      target="_blank" rel="noopener noreferrer" className="inline-block">
      {signed
        ? <img src={signed} alt="Employee" loading="lazy" className="w-10 h-10 rounded-lg object-cover border border-border hover:ring-2 hover:ring-primary/40 transition-all" />
        : <span className="inline-block w-10 h-10 rounded-lg border border-border bg-muted" />}
    </a>
  );
};

/**
 * What this employee's compensation actually costs and nets, priced live off
 * the form as it is filled in.
 *
 * This replaces a read-only "Housing Levy (AHL 1.5%)" box that computed the
 * levy inline and was the only statutory figure the form showed — a number
 * that no payroll run ever deducted. Everything here comes from the same
 * engine that runs payroll, so what is quoted at hire is what gets paid.
 */
const StatutoryPreview = ({ form }) => {
  const r = computePayroll({
    basic:                  form.basic_salary,
    housingAllowance:       form.housing_allowance,
    transportAllowance:     form.transport_allowance,
    pension:                form.pension_contribution,
    mortgageInterest:       form.mortgage_interest,
    insurancePremiums:      form.insurance_premiums,
    postRetirementMedical:  form.post_retirement_medical,
    hasDisabilityExemption: !!form.has_disability_exemption,
  });

  if (!r.grossCash) {
    return (
      <div className="p-3 bg-muted/30 border border-border rounded-lg text-xs text-muted-foreground">
        Enter a basic salary to see the statutory deductions and take-home pay.
      </div>
    );
  }

  const Row = ({ label, value, negative, strong }) => (
    <div className={`flex justify-between py-1.5 text-xs ${strong ? 'font-semibold border-t border-border pt-2 mt-1' : ''}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${negative ? 'text-red-500' : 'text-foreground'}`}>
        {negative ? `(${fmt(value)})` : fmt(value)}
      </span>
    </div>
  );

  return (
    <div className="p-4 bg-muted/20 border border-border rounded-xl">
      <p className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">Monthly Statutory Position</p>
      <Row label="Gross pay" value={r.grossCash} />
      <Row label="NSSF" value={r.nssf} negative />
      <Row label="SHIF" value={r.shif} negative />
      <Row label="Affordable Housing Levy" value={r.housingLevy} negative />
      <Row label={`PAYE (on taxable pay of ${fmt(r.taxablePay)})`} value={r.paye} negative />
      {r.voluntaryDeductions > 0 && <Row label="Pension / medical fund" value={r.voluntaryDeductions} negative />}
      <Row label="Net pay" value={r.netPay} strong />
      <p className="text-[11px] text-muted-foreground mt-2 pt-2 border-t border-border">
        Employer also owes {fmt(r.employerNssf + r.employerHousingLevy)} a month in matching NSSF and housing levy —
        total cost of employment {fmt(r.grossCash + r.employerNssf + r.employerHousingLevy)}.
      </p>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// EMPLOYEE FORM MODAL
// ─────────────────────────────────────────────────────────────────────────────
const EmployeeModal = ({ employee, adminId, onClose, onSaved }) => {
  const isEdit = !!employee;
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const [invalid, setInvalid] = useState(new Set());
  // Newly-picked document files, keyed by column. null = keep whatever URL the
  // record already has (stored in form.*_url). Uploaded to the
  // `employee-documents` bucket on save once the employee id is known.
  const [docFiles, setDocFiles] = useState({ id_document_url: null, cv_url: null, photo_url: null });
  const [form, setForm] = useState({
    full_name:           employee?.full_name           || '',
    email:               employee?.email               || '',
    phone:               employee?.phone               || '',
    gender:              employee?.gender              || '',
    date_of_birth:       employee?.date_of_birth       || '',
    next_of_kin_name:               employee?.next_of_kin_name               || '',
    next_of_kin_relationship:       employee?.next_of_kin_relationship       || '',
    next_of_kin_phone:              employee?.next_of_kin_phone              || '',
    // Encrypted — not on the employee row. Filled in by the fetch below.
    next_of_kin_id:                 '',
    secondary_contact_name:         employee?.secondary_contact_name         || '',
    secondary_contact_relationship: employee?.secondary_contact_relationship || '',
    secondary_contact_phone:        employee?.secondary_contact_phone        || '',
    role:                employee?.role                || 'staff',
    department:          employee?.department          || '',
    employment_type:     employee?.employment_type     || 'full_time',
    date_joined:         employee?.date_joined         || '',
    basic_salary:        employee?.basic_salary        || '',
    housing_allowance:   employee?.housing_allowance   || '',
    transport_allowance: employee?.transport_allowance || '',
    // Standing tax-deductible items — see the Tax Reliefs & Deductions section.
    pension_contribution:     employee?.pension_contribution     || '',
    mortgage_interest:        employee?.mortgage_interest        || '',
    insurance_premiums:       employee?.insurance_premiums       || '',
    post_retirement_medical:  employee?.post_retirement_medical  || '',
    has_disability_exemption: employee?.has_disability_exemption ?? false,
    national_id:         employee?.national_id         || '',
    kra_pin:             employee?.kra_pin             || '',
    nssf_number:         '',   // encrypted — see the fetch below
    sha_number:          employee?.sha_number          || '',
    bank_name:           employee?.bank_name           || '',
    bank_account:        '',   // encrypted — see the fetch below
    bank_branch:         employee?.bank_branch         || '',
    leave_balance:       employee?.leave_balance       ?? 21,
    is_active:           employee?.is_active           ?? true,
    id_document_url:     employee?.id_document_url     || '',
    cv_url:              employee?.cv_url              || '',
    photo_url:           employee?.photo_url           || '',
  });

  // Bank account, NSSF and next-of-kin ID are encrypted at rest and are NOT on
  // the employee row — they come from the employee-pii function on open. See
  // src/services/employeePiiService.js.
  //
  // piiOk === false means the fetch failed, NOT that the fields are empty. The
  // inputs are locked in that state: the form would otherwise show blanks that
  // a save would write over the real values.
  const [piiLoading, setPiiLoading] = useState(isEdit);
  const [piiOk,      setPiiOk]      = useState(true);

  useEffect(() => {
    if (!isEdit || !employee?.id) return;
    let cancelled = false;

    (async () => {
      const pii = await fetchEmployeePii(employee.id);
      if (cancelled) return;
      if (pii.ok) {
        setForm(p => ({
          ...p,
          ...PII_FIELDS.reduce((acc, f) => ({ ...acc, [f]: pii[f] ?? '' }), {}),
        }));
      } else {
        setPiiOk(false);
        setError(
          `Encrypted fields (bank account, NSSF, next-of-kin ID) could not be read: ${pii.error} ` +
          'They are shown blank and locked so saving cannot overwrite them.',
        );
      }
      setPiiLoading(false);
    })();

    return () => { cancelled = true; };
  }, [isEdit, employee?.id]);

  const set = (k, v) => {
    setForm(p => ({ ...p, [k]: v }));
    // Clear the red highlight as soon as the user starts fixing the field.
    setInvalid(prev => {
      if (!prev.has(k)) return prev;
      const next = new Set(prev);
      next.delete(k);
      return next;
    });
  };

  // Appended to a field's className when it failed required-field validation.
  const inv = (k) => invalid.has(k) ? ' !border-red-400 focus:!ring-red-300' : '';

  // Shared props for the three encrypted fields. They are unusable until the
  // decrypted values arrive, and stay locked if they never do — typing into a
  // blank that only looks empty would overwrite a stored value on save.
  const encrypted = (k) => ({
    className: S.input + inv(k) + (piiLoading || !piiOk ? ' opacity-60' : ''),
    value: form[k],
    onChange: (e) => set(k, e.target.value),
    disabled: piiLoading || !piiOk,
    title: piiOk
      ? 'Encrypted at rest — stored separately from the employee record.'
      : 'Unavailable: this value could not be decrypted. It will be left unchanged when you save.',
  });

  // Upload a picked document to the employee-documents bucket and return its
  // public URL. Files are namespaced under the employee id so each person's
  // documents stay grouped. `field` doubles as the document-type prefix.
  const uploadDoc = async (empId, field, file) => {
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${empId}/${field}_${Date.now()}_${cleanName}`;
    const { error: upErr } = await supabase.storage
      .from('employee-documents')
      .upload(path, file, { cacheControl: '3600', upsert: true, contentType: file.type || undefined });
    if (upErr) throw upErr;
    return supabase.storage.from('employee-documents').getPublicUrl(path).data.publicUrl;
  };

  // Resolve the three document URLs for a given employee id: upload any newly
  // picked file, otherwise keep the URL already on the form.
  const resolveDocUrls = async (empId) => {
    const out = { id_document_url: form.id_document_url || null, cv_url: form.cv_url || null, photo_url: form.photo_url || null };
    for (const field of ['id_document_url', 'cv_url', 'photo_url']) {
      if (docFiles[field]) out[field] = await uploadDoc(empId, field, docFiles[field]);
    }
    return out;
  };

  const handleSave = async () => {
    // When the encrypted fields could not be read they are blank and locked, so
    // requiring them would make the record unsaveable for reasons the operator
    // cannot fix from this form. They are left untouched on save instead.
    const required = piiOk
      ? REQUIRED_FIELDS
      : REQUIRED_FIELDS.filter(([k]) => !PII_FIELDS.includes(k));
    const missing = required.filter(([k]) => isEmpty(form[k]));
    if (missing.length) {
      setInvalid(new Set(missing.map(([k]) => k)));
      setError(`Please fill in all required fields: ${missing.map(([, label]) => label).join(', ')}.`);
      return;
    }
    setInvalid(new Set());
    setSaving(true); setError('');
    try {
      const payload = {
        full_name:           form.full_name,
        phone:               form.phone               || null,
        gender:              form.gender              || null,
        date_of_birth:       form.date_of_birth       || null,
        next_of_kin_name:               form.next_of_kin_name               || null,
        next_of_kin_relationship:       form.next_of_kin_relationship       || null,
        next_of_kin_phone:              form.next_of_kin_phone              || null,
        secondary_contact_name:         form.secondary_contact_name         || null,
        secondary_contact_relationship: form.secondary_contact_relationship || null,
        secondary_contact_phone:        form.secondary_contact_phone        || null,
        role:                form.role,
        department:          form.department          || null,
        employment_type:     form.employment_type,
        date_joined:         form.date_joined         || null,
        basic_salary:        parseFloat(form.basic_salary)        || 0,
        housing_allowance:   parseFloat(form.housing_allowance)   || 0,
        transport_allowance: parseFloat(form.transport_allowance) || 0,
        pension_contribution:     parseFloat(form.pension_contribution)    || 0,
        mortgage_interest:        parseFloat(form.mortgage_interest)       || 0,
        insurance_premiums:       parseFloat(form.insurance_premiums)      || 0,
        post_retirement_medical:  parseFloat(form.post_retirement_medical) || 0,
        has_disability_exemption: !!form.has_disability_exemption,
        national_id:         form.national_id         || null,
        kra_pin:             form.kra_pin             || null,
        sha_number:          form.sha_number          || null,
        bank_name:           form.bank_name           || null,
        bank_branch:         form.bank_branch         || null,
        leave_balance:       parseInt(form.leave_balance) || 21,
        is_active:           form.is_active,
        // On create → tag the record with the creator's account id.
        // On edit  → preserve the original owner so editing never reassigns it.
        admin_id:            isEdit ? (employee.admin_id || adminId) : adminId,
        updated_at:          new Date().toISOString(),
      };

      // The profile id the encrypted fields are attached to, known only after
      // creation on the new-employee path.
      let savedId = isEdit ? employee.id : null;

      if (isEdit) {
        // Edit: safe to update user_profiles directly — auth user already exists.
        // Upload any newly-picked documents first so their URLs go in the update.
        const docs = await resolveDocUrls(employee.id);
        const { error: err } = await supabase.from('user_profiles').update({ ...payload, ...docs }).eq('id', employee.id);
        if (err) throw err;
      } else {
        // New employee: must go through the Edge Function to satisfy user_profiles_id_fkey.
        // A strong random password is auto-generated — HR never sees it and the employee
        // receives no credentials. This is a payroll record, not a login account.
        // Must satisfy the password policy now enforced by the edge function.
        const autoPassword = generateTempPassword();

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

        if (result.id) {
          // Stamp admin_id FIRST, on its own. The handle_new_user trigger only copies
          // id/email/full_name/role, leaving admin_id NULL. Previously this was bundled
          // into the full field patch below — so any one bad/missing column failed the
          // whole update and ORPHANED the record (NULL admin_id ⇒ invisible to the
          // creator's scoped list). Isolating it guarantees the record is always owned.
          const { error: adminErr } = await supabase
            .from('user_profiles')
            .update({ admin_id: payload.admin_id })
            .eq('id', result.id);
          if (adminErr) throw adminErr;

          // Upload any picked documents now that the new employee id exists, so
          // their URLs are saved alongside the rest of the HR fields below.
          const docs = await resolveDocUrls(result.id);

          // Then patch the remaining HR fields. Errors are surfaced (they used to be
          // swallowed); even if this fails, the record still belongs to its admin and
          // appears in the list, and the details can simply be re-saved.
          const { error: patchErr } = await supabase.from('user_profiles').update({
            ...docs,
            gender:              payload.gender,
            date_of_birth:       payload.date_of_birth,
            next_of_kin_name:               payload.next_of_kin_name,
            next_of_kin_relationship:       payload.next_of_kin_relationship,
            next_of_kin_phone:              payload.next_of_kin_phone,
            secondary_contact_name:         payload.secondary_contact_name,
            secondary_contact_relationship: payload.secondary_contact_relationship,
            secondary_contact_phone:        payload.secondary_contact_phone,
            department:          payload.department,
            is_active:           payload.is_active,
            employment_type:     payload.employment_type,
            date_joined:         payload.date_joined,
            basic_salary:        payload.basic_salary,
            housing_allowance:   payload.housing_allowance,
            transport_allowance: payload.transport_allowance,
            national_id:         payload.national_id,
            kra_pin:             payload.kra_pin,
            sha_number:          payload.sha_number,
            bank_name:           payload.bank_name,
            bank_branch:         payload.bank_branch,
            leave_balance:       payload.leave_balance,
            updated_at:          payload.updated_at,
          }).eq('id', result.id);
          if (patchErr) throw patchErr;

          savedId = result.id;
        }
      }

      // Encrypted fields last, and only once the profile row exists — the vault
      // table has a foreign key onto it. Skipped entirely when the fetch failed,
      // because the inputs are blank-and-locked in that state and writing them
      // would destroy the stored values.
      if (savedId && piiOk) {
        await saveEmployeePii(
          savedId,
          PII_FIELDS.reduce((acc, f) => ({ ...acc, [f]: form[f] || '' }), {}),
        );
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

  // One document upload slot. Shows the picked file's name, or a link to the
  // already-stored document, with a button to choose / replace the file.
  const setDoc = (field, file) => setDocFiles(p => ({ ...p, [field]: file }));
  const DocField = ({ field, label, accept, hint }) => {
    const picked   = docFiles[field];
    const existing = form[field];
    return (
      <div>
        <label className={S.label}>{label}</label>
        <div className="flex items-center gap-2">
          <label className={`${S.btnSec} cursor-pointer`}>
            <Icon name="Upload" size={13} color="currentColor" />
            {picked || existing ? 'Replace' : 'Upload'}
            <input
              type="file"
              accept={accept}
              className="hidden"
              onChange={e => setDoc(field, e.target.files?.[0] || null)}
            />
          </label>
          {picked ? (
            <span className="flex items-center gap-1.5 text-xs text-foreground min-w-0">
              <Icon name="Paperclip" size={12} color="var(--muted-foreground)" />
              <span className="truncate max-w-[160px]">{picked.name}</span>
              <button type="button" onClick={() => setDoc(field, null)} className="text-muted-foreground hover:text-red-500">
                <Icon name="X" size={12} color="currentColor" />
              </button>
            </span>
          ) : existing ? (
            <a href={existing} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
              <Icon name="ExternalLink" size={12} color="currentColor" /> View current
            </a>
          ) : (
            <span className="text-xs text-muted-foreground">No file uploaded</span>
          )}
        </div>
        {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
      </div>
    );
  };

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
              <input className={S.input + inv('full_name')} value={form.full_name} onChange={e => set('full_name', e.target.value)} />
            </div>
            <div>
              <label className={S.label}>Email *</label>
              <input type="email" className={S.input + inv('email')} value={form.email} onChange={e => set('email', e.target.value)} disabled={isEdit} />
            </div>
            <div>
              <label className={S.label}>Phone *</label>
              <input className={S.input + inv('phone')} placeholder="+254 7XX XXX XXX" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </div>
            <div>
              <label className={S.label}>National ID *</label>
              <input className={S.input + inv('national_id')} value={form.national_id} onChange={e => set('national_id', e.target.value)} />
            </div>
            <div>
              <label className={S.label}>Gender *</label>
              <select className={S.select + inv('gender')} value={form.gender} onChange={e => set('gender', e.target.value)}>
                <option value="">— Select —</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            <div>
              <label className={S.label}>Date of Birth *</label>
              <input type="date" className={S.input + inv('date_of_birth')} value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} />
            </div>

            <Section title="Next of Kin" />
            <div>
              <label className={S.label}>Full Name *</label>
              <input className={S.input + inv('next_of_kin_name')} value={form.next_of_kin_name} onChange={e => set('next_of_kin_name', e.target.value)} />
            </div>
            <div>
              <label className={S.label}>Relationship *</label>
              <input className={S.input + inv('next_of_kin_relationship')} placeholder="e.g. Spouse, Parent, Sibling" value={form.next_of_kin_relationship} onChange={e => set('next_of_kin_relationship', e.target.value)} />
            </div>
            <div>
              <label className={S.label}>Phone *</label>
              <input className={S.input + inv('next_of_kin_phone')} placeholder="+254 7XX XXX XXX" value={form.next_of_kin_phone} onChange={e => set('next_of_kin_phone', e.target.value)} />
            </div>
            <div>
              <label className={S.label}>ID Number *</label>
              <input {...encrypted('next_of_kin_id')} placeholder={piiLoading ? 'Decrypting…' : 'National ID / Passport No.'} />
            </div>

            <Section title="Secondary Contact" />
            <div>
              <label className={S.label}>Full Name *</label>
              <input className={S.input + inv('secondary_contact_name')} value={form.secondary_contact_name} onChange={e => set('secondary_contact_name', e.target.value)} />
            </div>
            <div>
              <label className={S.label}>Relationship *</label>
              <input className={S.input + inv('secondary_contact_relationship')} placeholder="e.g. Friend, Colleague" value={form.secondary_contact_relationship} onChange={e => set('secondary_contact_relationship', e.target.value)} />
            </div>
            <div>
              <label className={S.label}>Phone *</label>
              <input className={S.input + inv('secondary_contact_phone')} placeholder="+254 7XX XXX XXX" value={form.secondary_contact_phone} onChange={e => set('secondary_contact_phone', e.target.value)} />
            </div>

            <Section title="Employment Details" />
            <div>
              <label className={S.label}>Role *</label>
              <select className={S.select + inv('role')} value={form.role} onChange={e => set('role', e.target.value)}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className={S.label}>Department *</label>
              <select className={S.select + inv('department')} value={form.department} onChange={e => set('department', e.target.value)}>
                <option value="">— Select —</option>
                {DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className={S.label}>Employment Type *</label>
              <select className={S.select + inv('employment_type')} value={form.employment_type} onChange={e => set('employment_type', e.target.value)}>
                {EMP_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
              </select>
            </div>
            <div>
              <label className={S.label}>Date Joined *</label>
              <input type="date" className={S.input + inv('date_joined')} value={form.date_joined} onChange={e => set('date_joined', e.target.value)} />
            </div>
            <div>
              <label className={S.label}>Leave Balance (days) *</label>
              <input type="number" className={S.input + inv('leave_balance')} value={form.leave_balance} onChange={e => set('leave_balance', e.target.value)} />
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
              <label className={S.label}>KRA PIN *</label>
              <input className={S.input + inv('kra_pin')} placeholder="A000000000X" value={form.kra_pin} onChange={e => set('kra_pin', e.target.value)} />
            </div>
            <div>
              <label className={S.label}>NSSF Number *</label>
              <input {...encrypted('nssf_number')} placeholder={piiLoading ? 'Decrypting…' : ''} />
            </div>
            <div>
              <label className={S.label}>SHA Number *</label>
              <input className={S.input + inv('sha_number')} value={form.sha_number} onChange={e => set('sha_number', e.target.value)} />
            </div>

            {/* Tax-deductible items the employee funds. They belong on the person
                rather than in each payroll run: they are standing monthly
                figures, and re-keying them every month is how they end up
                different every month. Payroll reads them from here. */}
            <Section title="Tax Reliefs & Deductions" />
            <div>
              <label className={S.label}>Pension Contribution (KES/month)</label>
              <input type="number" className={S.input} placeholder="0" value={form.pension_contribution} onChange={e => set('pension_contribution', e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">Registered scheme · deductible before PAYE, sharing one ceiling with NSSF</p>
            </div>
            <div>
              <label className={S.label}>Mortgage Interest (KES/month)</label>
              <input type="number" className={S.input} placeholder="0" value={form.mortgage_interest} onChange={e => set('mortgage_interest', e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">Owner-occupier only · lowers tax, never withheld from pay</p>
            </div>
            <div>
              <label className={S.label}>Insurance Premiums (KES/month)</label>
              <input type="number" className={S.input} placeholder="0" value={form.insurance_premiums} onChange={e => set('insurance_premiums', e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">Life / health / education · 15% relief, capped at KES 5,000</p>
            </div>
            <div>
              <label className={S.label}>Post-Retirement Medical Fund (KES/month)</label>
              <input type="number" className={S.input} placeholder="0" value={form.post_retirement_medical} onChange={e => set('post_retirement_medical', e.target.value)} />
              <p className="text-[11px] text-muted-foreground mt-1">Deductible up to KES 15,000</p>
            </div>
            <div className="flex items-start gap-3 pt-5 md:col-span-2">
              <input type="checkbox" id="has_disability_exemption" checked={form.has_disability_exemption}
                onChange={e => set('has_disability_exemption', e.target.checked)}
                className="w-4 h-4 accent-primary mt-0.5" />
              <label htmlFor="has_disability_exemption" className="text-sm font-medium text-foreground">
                Holds a KRA disability exemption certificate
                <span className="block text-[11px] font-normal text-muted-foreground">Exempts the first KES 150,000 of monthly pay from tax</span>
              </label>
            </div>

            {/* What this employee's pay actually resolves to. Previously a lone
                hardcoded 1.5% levy box that payroll then ignored — the levy was
                displayed here and never deducted anywhere. */}
            <div className="md:col-span-2">
              <StatutoryPreview form={form} />
            </div>

            <Section title="Bank Details" />
            <div>
              <label className={S.label}>Bank Name *</label>
              <select className={S.select + inv('bank_name')} value={form.bank_name} onChange={e => set('bank_name', e.target.value)}>
                <option value="">— Select —</option>
                {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                {/* Preserve a previously-stored bank that isn't in the current list */}
                {form.bank_name && !BANKS.includes(form.bank_name) && (
                  <option value={form.bank_name}>{form.bank_name}</option>
                )}
              </select>
            </div>
            <div>
              <label className={S.label}>Account Number *</label>
              <input {...encrypted('bank_account')} placeholder={piiLoading ? 'Decrypting…' : ''} />
            </div>
            <div>
              <label className={S.label}>Branch *</label>
              <input className={S.input + inv('bank_branch')} value={form.bank_branch} onChange={e => set('bank_branch', e.target.value)} />
            </div>

            <Section title="Documents" />
            <DocField
              field="id_document_url"
              label="ID / Passport"
              accept="image/*,application/pdf"
              hint="National ID or passport scan · image or PDF"
            />
            <DocField
              field="cv_url"
              label="CV"
              accept="application/pdf,.doc,.docx,image/*"
              hint="PDF, Word or image"
            />
            <DocField
              field="photo_url"
              label="Employee Photo"
              accept="image/*"
              hint="Passport-style photo · image only"
            />
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
const EmployeeDetail = ({ employee, payrollHistory, onEdit, onDelete, onClose }) => {
  const gross = parseFloat(employee.basic_salary || 0) + parseFloat(employee.housing_allowance || 0) + parseFloat(employee.transport_allowance || 0);

  // Bank account, NSSF and next-of-kin ID are encrypted and are not part of the
  // employee row — fetched here for the one record being viewed, rather than
  // decrypting the whole list on every render of the table behind this drawer.
  const [pii, setPii] = useState(emptyPii());
  const [piiState, setPiiState] = useState('loading'); // loading | ready | failed

  useEffect(() => {
    if (!employee?.id) return;
    let cancelled = false;

    (async () => {
      const result = await fetchEmployeePii(employee.id);
      if (cancelled) return;
      setPii(result);
      setPiiState(result.ok ? 'ready' : 'failed');
    })();

    return () => { cancelled = true; };
  }, [employee?.id]);

  const Row = ({ label, value }) => (
    <div className="flex justify-between items-center py-2.5 border-b border-border">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground text-right max-w-48 truncate">{value || '—'}</span>
    </div>
  );

  // An encrypted row must never fall through to the plain '—' that Row shows for
  // an empty value: "not set" and "could not be decrypted" are different facts,
  // and confusing them is how someone concludes a bank account is missing.
  const SecureRow = ({ label, field }) => (
    <Row
      label={label}
      value={
        piiState === 'loading' ? 'Decrypting…'
          : piiState === 'failed' ? 'Unavailable'
          : pii[field]
      }
    />
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
            {onDelete && (
              <button onClick={onDelete} className="inline-flex items-center gap-2 bg-red-50 text-red-600 px-3 py-1.5 rounded-lg text-xs font-medium border border-red-200 hover:bg-red-100 transition-colors">
                <Icon name="Trash2" size={13} color="currentColor" /> Delete
              </button>
            )}
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
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
            <Row label="Gender"        value={employee.gender ? employee.gender.charAt(0).toUpperCase() + employee.gender.slice(1) : ''} />
            <Row label="Date of Birth" value={fmtDate(employee.date_of_birth)} />
            <Row label="Date Joined"   value={fmtDate(employee.date_joined)} />
            <Row label="Leave Balance" value={`${employee.leave_balance ?? 21} days`} />
          </div>

          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Next of Kin</p>
            <Row label="Name"         value={employee.next_of_kin_name} />
            <Row label="Relationship" value={employee.next_of_kin_relationship} />
            <Row label="Phone"        value={employee.next_of_kin_phone} />
            <SecureRow label="ID Number" field="next_of_kin_id" />
          </div>

          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Secondary Contact</p>
            <Row label="Name"         value={employee.secondary_contact_name} />
            <Row label="Relationship" value={employee.secondary_contact_relationship} />
            <Row label="Phone"        value={employee.secondary_contact_phone} />
          </div>

          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Statutory</p>
            <Row label="KRA PIN"  value={employee.kra_pin} />
            <SecureRow label="NSSF No." field="nssf_number" />
            <Row label="SHA No."  value={employee.sha_number} />
          </div>

          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Bank Details</p>
            <Row label="Bank"    value={employee.bank_name} />
            <SecureRow label="Account" field="bank_account" />
            <Row label="Branch"  value={employee.bank_branch} />
          </div>

          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Documents</p>
            <div className="flex items-center justify-between py-2.5 border-b border-border">
              <span className="text-xs text-muted-foreground">ID / Passport</span>
              <DocLink url={employee.id_document_url} label="View ID" />
            </div>
            <div className="flex items-center justify-between py-2.5 border-b border-border">
              <span className="text-xs text-muted-foreground">CV</span>
              <DocLink url={employee.cv_url} label="View CV" />
            </div>
            <div className="flex items-center justify-between py-2.5 border-b border-border">
              <span className="text-xs text-muted-foreground">Photo</span>
              <DocThumb url={employee.photo_url} />
            </div>
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
// DELETE EMPLOYEE CONFIRMATION MODAL
// ─────────────────────────────────────────────────────────────────────────────
// Permanent, irreversible deletion of a staff account. Routes through the
// delete-staff-user edge function (RLS prevents deleting another user's profile
// from the browser, and only the service role can remove the auth user). The
// employee's audit trail is always retained — see the edge function header.
const DeleteEmployeeModal = ({ employee, onClose, onDeleted }) => {
  const [deleting,    setDeleting]    = useState(false);
  const [error,       setError]       = useState('');
  const [confirmText, setConfirmText] = useState('');
  // Typing the name guards against deleting the wrong record by reflex-clicking.
  const canConfirm = confirmText.trim() === 'DELETE';

  const handleDelete = async () => {
    if (!canConfirm) return;
    setDeleting(true); setError('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('Session expired. Please refresh and try again.');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-staff-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ user_id: employee.id }),
        }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to delete employee.');

      onDeleted();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-md flex flex-col shadow-2xl">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
          <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
            <Icon name="AlertTriangle" size={18} color="#dc2626" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">Permanently delete employee</h3>
            <p className="text-xs text-muted-foreground mt-0.5">This action cannot be undone</p>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-foreground">
            You are about to permanently delete <strong>{employee.full_name}</strong>
            {employee.email ? <> (<span className="text-muted-foreground">{employee.email}</span>)</> : null}.
            Their login and employee record will be removed for good.
          </p>

          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 flex gap-2">
            <Icon name="ShieldCheck" size={14} color="#059669" className="flex-shrink-0 mt-0.5" />
            <span>Their <strong>audit trail is retained</strong>. A snapshot of this record is written to the audit log before deletion, and their activity history is preserved.</span>
          </div>

          <div>
            <label className={S.label}>Type <span className="font-mono text-foreground">DELETE</span> to confirm</label>
            <input
              autoFocus
              className={S.input}
              placeholder="DELETE"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && canConfirm && !deleting) handleDelete(); }}
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">{error}</div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-border">
          <button onClick={onClose} disabled={deleting} className={S.btnSec}>Cancel</button>
          <button
            onClick={handleDelete}
            disabled={deleting || !canConfirm}
            className="inline-flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deleting
              ? <><Icon name="Loader" size={14} color="currentColor" className="animate-spin" /> Deleting…</>
              : <><Icon name="Trash2" size={14} color="currentColor" /> Delete Permanently</>}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// RUN PAYROLL MODAL
// ─────────────────────────────────────────────────────────────────────────────
const RunPayrollModal = ({ employees, adminId, onClose, onSaved, initialMonth }) => {
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const [payMonth,  setPayMonth]  = useState(initialMonth || currentMonth);
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

  // This modal used to carry its own copy of the Kenya tax rules — pre-2023
  // bands, no personal relief, a stale NSSF cap and no housing levy at all —
  // which disagreed with the Finance Hub's copy while writing to the same
  // table. Both are gone: src/utils/kenyaPayroll.js is now the only engine, so
  // a figure here and the same figure there cannot drift apart.
  const computeRow = (emp) =>
    computePayroll(payrollInputForEmployee(emp, extras[emp.id] || {}, payMonth));

  // The schedule this run will be priced under, for the note below the table.
  const rates = resolveRateSchedule(payMonth);

  const handleRunPayroll = async () => {
    if (!payMonth) { setError('Please select a pay month.'); return; }
    if (employees.length === 0) { setError('No employees to process.'); return; }
    setSaving(true); setError(''); setSuccess('');
    try {
      const eligible = employees.filter(e => e.is_active);
      const records = eligible.map(emp => {
        const r = computeRow(emp);
        return {
          employee_id:  emp.id,
          // Tag each record to the employee's owning account so a super admin
          // running payroll system-wide doesn't reassign records away from the
          // admin that owns the employee. Falls back to the runner's id.
          admin_id:     emp.admin_id || adminId,
          pay_month:    payMonth,
          basic_salary:        r.basic,
          housing_allowance:   r.housingAllowance,
          transport_allowance: r.transportAllowance,
          meal_allowance:      r.mealAllowance,
          bonus:               r.bonus,
          gift:                r.gift,
          loan_deduction:      r.loanDeduction,
          advance_deduction:   r.advanceDeduction,
          // gross_salary, taxable_pay, paye, nssf, shif, housing_levy, the
          // reliefs, the totals and the rate version this was priced under.
          ...payrollRecordFrom(r),
          status:      'pending',
          created_at:  new Date().toISOString(),
        };
      }).filter(rec => parseFloat(rec.gross_salary) > 0); // skip employees with no salary set

      const skipped = eligible.length - records.length;
      if (records.length === 0) {
        setError('No active employee has a gross salary set. Add a basic salary or allowance before running payroll.');
        setSaving(false);
        return;
      }

      // Upsert so re-running payroll for a month recomputes existing records
      // instead of failing on the (employee_id, pay_month) unique constraint.
      const { error: err } = await supabase
        .from('payroll_records')
        .upsert(records, { onConflict: 'employee_id,pay_month' });
      if (err) throw err;

      setSuccess(`Payroll for ${payMonth} processed for ${records.length} employee(s)${skipped ? `, ${skipped} skipped (no salary set)` : ''}.`);
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
                    {['Employee', 'Basic', 'Housing', 'Transport', 'Meal Allow.', 'Bonus', 'Gift', 'Loan Deduct.', 'Advance Deduct.', 'PAYE', 'NSSF', 'SHIF', 'AHL', 'Est. Net Pay'].map(h => (
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

                        {/* Statutory deductions, itemised. A single "deductions"
                            total gives nobody a way to spot a wrong tax before
                            the run is committed. */}
                        <td className={`${S.td} font-mono text-red-500 whitespace-nowrap`}>({fmt(r.paye)})</td>
                        <td className={`${S.td} font-mono text-red-500 whitespace-nowrap`}>({fmt(r.nssf)})</td>
                        <td className={`${S.td} font-mono text-red-500 whitespace-nowrap`}>({fmt(r.shif)})</td>
                        <td className={`${S.td} font-mono text-red-500 whitespace-nowrap`}>({fmt(r.housingLevy)})</td>

                        {/* Estimated net pay */}
                        <td className={S.td}>
                          <span className={`font-mono font-bold text-sm ${r.netPay >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                            {fmt(r.netPay)}
                          </span>
                          <p className="text-xs text-muted-foreground whitespace-nowrap">
                            Taxable {fmt(r.taxablePay)} · Gross {fmt(r.grossCash)}
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

          {/* Statutory note — read off the rate schedule that will actually be
              applied to this pay month, so it can never describe rates other
              than the ones the run is about to use. */}
          <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700 space-y-1">
            <p>
              <strong>Statutory deductions applied automatically:</strong> NSSF (6% to a ceiling of{' '}
              {fmt(rates.nssf.upperLimit * rates.nssf.rate)}), SHIF ({(rates.shif.rate * 100).toFixed(2)}%, minimum{' '}
              {fmt(rates.shif.min)}), Affordable Housing Levy ({(rates.housingLevy.rate * 100).toFixed(1)}%), then PAYE.
            </p>
            <p>
              PAYE is charged on gross pay <strong>less</strong> NSSF, SHIF and the housing levy, and reduced by
              personal relief of {fmt(rates.personalRelief)}.
            </p>
            <p className="text-blue-600/80">Rates in force for {payMonth}: {rates.label}.</p>
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
  const [viewerRole,     setViewerRole]     = useState(null);
  const [search,         setSearch]         = useState('');
  const [deptFilter,     setDeptFilter]     = useState('all');
  const [activeTab,      setActiveTab]      = useState('employees');
  const [payrollFilter,  setPayrollFilter]  = useState('');   // single month (YYYY-MM)
  const [payrollStatus,  setPayrollStatus]  = useState('all'); // status filter
  const [payrollDept,    setPayrollDept]    = useState('all'); // department filter
  const [payrollRole,    setPayrollRole]    = useState('all'); // role filter (e.g. sales_agent)
  const [payrollSearch,  setPayrollSearch]  = useState('');    // name / email / ID
  const [payrollFrom,    setPayrollFrom]    = useState('');    // date range start (YYYY-MM)
  const [payrollTo,      setPayrollTo]      = useState('');    // date range end (YYYY-MM)
  // Letterhead for printed payslips (name, KRA PIN, address).
  const [companyProfile, setCompanyProfile] = useState(null);
  // Result of an export — shown in the payroll tab rather than as a toast,
  // because "3 employees have no KRA PIN" is something to read and act on, not
  // something to catch before it fades.
  const [payrollNotice,  setPayrollNotice]  = useState(null);
  const adminIdRef = useRef(null);
  const hasLoaded  = useRef(false);

  // Statutory deadlines. Its figures come from statutory_payroll_periods(),
  // which aggregates in Postgres — NOT from payrollRecords above, which is
  // capped at 200 rows. A tenant with 250 staff would otherwise be shown a
  // PAYE liability a fifth short of what they owe.
  const statutory = useStatutoryCalendar();

  // Derive modal state from context
  const showModal    = !!modals.hrEmployee;
  const editEmployee = modals.hrEmployee === true ? null : modals.hrEmployee;
  const selected     = modals.hrEmployeeDetail;
  const deleteTarget = modals.hrEmployeeDelete;
  const showPayroll  = !!modals.hrPayroll;

  // Permanent staff deletion is confined to account-holder admins (and super
  // admins who oversee everything). Managers/other staff who can reach this page
  // see no delete control; the edge function enforces the same rule server-side.
  const canDelete = viewerRole === 'admin' || viewerRole === 'super_admin';

  // Resolves the viewer's payroll scope:
  //  • id      — the admin_id used to tag records this viewer creates.
  //  • isSuper — super admins oversee the whole organisation, so their HR view is
  //              NOT scoped to a single admin_id (see fetchAll). They see every
  //              employee and payroll record in the system, regardless of which
  //              admin created them.
  const resolveScope = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { id: null, isSuper: false };
    const { data: profile } = await supabase.from('user_profiles').select('id, role, admin_id').eq('id', user.id).maybeSingle();
    const isSuper = profile?.role === 'super_admin';
    // admin & super_admin own the records they create (scope by their own id).
    // Other staff inherit their parent admin's scope via admin_id.
    const id = (profile?.role === 'admin' || isSuper) ? user.id : (profile?.admin_id || user.id);
    return { id, isSuper, role: profile?.role || null };
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const { id: aId, isSuper, role } = await resolveScope();
    setViewerRole(role);
    setAdminId(aId);
    adminIdRef.current = aId;
    if (!aId) { setLoading(false); return; }

    // Account-holder roles (client / admin / super_admin) are never listed as
    // "employees". An admin sees only the staff under their own account, but a
    // super admin oversees the whole system — so we drop the admin_id scope for
    // them and list every employee (and payroll record) regardless of which admin
    // created them. Without this, anyone created under a different admin never
    // showed up in the super admin's HR / payroll filters.
    //
    // Columns added by later migrations (next-of-kin, secondary contact) are kept
    // separate: if that migration hasn't been applied yet, selecting them makes the
    // ENTIRE query fail, which silently wiped the whole employee list. We try the
    // full set first and transparently fall back to the base columns so staff still
    // load even when a migration is still pending.
    // bank_account, nssf_number and next_of_kin_id are deliberately absent: they
    // are encrypted in employee_private_data and fetched per-record through the
    // employee-pii function. Naming them here would fail the query outright once
    // the plaintext columns are dropped.
    const BASE_EMP_COLS = 'id, admin_id, full_name, email, role, department, phone, gender, date_of_birth, is_active, employment_type, date_joined, leave_balance, basic_salary, housing_allowance, transport_allowance, kra_pin, sha_number, national_id, bank_name, bank_branch';
    // The statutory profile (20260829120000) rides in the enriched set for the
    // same reason next-of-kin does: naming a not-yet-migrated column fails the
    // whole query, and an empty staff list is far worse than a blank field.
    const FULL_EMP_COLS = `${BASE_EMP_COLS}, next_of_kin_name, next_of_kin_relationship, next_of_kin_phone, secondary_contact_name, secondary_contact_relationship, secondary_contact_phone, id_document_url, cv_url, photo_url, pension_contribution, mortgage_interest, post_retirement_medical, insurance_premiums, has_disability_exemption`;

    const runEmpQuery = (cols) => {
      let q = supabase.from('user_profiles')
        .select(cols)
        .not('role', 'in', '("client","super_admin","admin")')
        .order('full_name');
      if (!isSuper) q = q.eq('admin_id', aId);
      return q;
    };

    const BASE_PAY_COLS = 'id, employee_id, admin_id, pay_month, gross_salary, basic_salary, housing_allowance, transport_allowance, net_salary, paye, nssf, shif, status, meal_allowance, bonus, gift, loan_deduction, advance_deduction';
    const FULL_PAY_COLS = `${BASE_PAY_COLS}, taxable_pay, housing_levy, personal_relief, insurance_relief, pension_contribution, non_cash_benefits, rate_version`;

    const runPayQuery = (cols) => {
      const q = supabase.from('payroll_records')
        .select(cols)
        .order('pay_month', { ascending: false })
        .limit(200);
      return isSuper ? q : q.eq('admin_id', aId);
    };

    let [empRes, payRes] = await Promise.all([runEmpQuery(FULL_EMP_COLS), runPayQuery(FULL_PAY_COLS)]);

    // Pending migration → enriched select errors. Fall back to base columns so the
    // list still loads (the new contact fields just won't populate until migrated).
    if (empRes.error) {
      console.warn('HR: enriched employee query failed — falling back to base columns. Apply the latest migrations to enable next-of-kin / secondary-contact fields.', empRes.error.message);
      empRes = await runEmpQuery(BASE_EMP_COLS);
    }
    // Same guard on payroll: the statutory breakdown columns land in
    // 20260829120000, and the history table must still render without them.
    if (payRes.error) {
      console.warn('HR: enriched payroll query failed — falling back to base columns. Apply migration 20260829120000 to see the PAYE breakdown.', payRes.error.message);
      payRes = await runPayQuery(BASE_PAY_COLS);
    }
    if (empRes.error)  console.error('HR: employee query failed:', empRes.error.message);
    if (payRes.error)  console.error('HR: payroll query failed:',  payRes.error.message);

    // Letterhead for payslips. Failing to load it is not worth blocking the
    // page for — payslipDocument falls back to a default company name.
    supabase.from('company_profiles').select('*').eq('admin_id', aId).maybeSingle()
      .then(({ data }) => setCompanyProfile(data))
      .catch(() => setCompanyProfile(null));

    setEmployees(empRes.data || []);
    setPayrollRecords(payRes.data || []);
    hasLoaded.current = true;
    setLoading(false);
  }, [resolveScope]);

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
  // Roles that actually exist among the loaded employees — these drive the payroll
  // Role filter (mirrors `depts`). A hardcoded list silently offered roles nobody is
  // stored as (e.g. "Employee" → 'staff', which isn't even a valid user_role enum
  // value) so those options always returned zero records, while real roles like 'hr'
  // or the default 'operations' were missing. Deriving from data keeps the dropdown
  // and the stored values in sync, so every option returns its records.
  const empRoles = [...new Set(employees.map(e => e.role).filter(Boolean))]
    .sort((a, b) => roleLabel(a).localeCompare(roleLabel(b)));
  const empPayroll = (empId) => payrollRecords.filter(p => p.employee_id === empId);

  // ── Payroll filters: month, status, department, search, date range ──────────
  const empById = (id) => employees.find(e => e.id === id);
  const filteredPayroll = payrollRecords.filter(p => {
    const emp = empById(p.employee_id);
    // Single month
    if (payrollFilter && p.pay_month !== payrollFilter) return false;
    // Status
    if (payrollStatus !== 'all' && (p.status || 'pending') !== payrollStatus) return false;
    // Department
    if (payrollDept !== 'all' && (emp?.department || '') !== payrollDept) return false;
    // Role
    if (payrollRole !== 'all' && (emp?.role || '') !== payrollRole) return false;
    // Date range (pay_month is YYYY-MM, so string compare is chronological)
    if (payrollFrom && p.pay_month < payrollFrom) return false;
    if (payrollTo && p.pay_month > payrollTo) return false;
    // Search by name / email / national ID
    if (payrollSearch) {
      const q = payrollSearch.toLowerCase();
      const hay = [emp?.full_name, emp?.email, emp?.national_id].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // What the filtered month actually costs and what has to be remitted.
  //
  // NSSF and the Affordable Housing Levy are matched pound for pound by the
  // employer, so the cheque written to each fund is twice what appears on the
  // payslips. SHIF and PAYE are withheld only. Legacy rows carry no housing
  // levy — they contribute 0 rather than being back-filled with a rate that
  // may not have applied when they were run.
  const payrollTotals = (() => {
    const sum = (fn) => filteredPayroll.reduce((s, p) => s + (parseFloat(fn(p)) || 0), 0);
    const nssf = sum(p => p.nssf);
    const shif = sum(p => p.shif);
    const ahl  = sum(p => p.housing_levy);
    return {
      gross: sum(p => p.gross_salary),
      net:   sum(p => p.net_salary),
      paye:  sum(p => p.paye),
      remittance: (nssf * 2) + shif + (ahl * 2),
    };
  })();

  // What the PAYE card says underneath the figure. One month on screen gets its
  // own deadline; several get the range's, which is the one that matters,
  // because it is the earliest thing still unfiled. No months at all falls back
  // to naming the rule rather than a date that would belong to no period.
  const payeDeadlineNote = (() => {
    const months = [...new Set(filteredPayroll.map(p => p.pay_month).filter(Boolean))].sort();
    if (!months.length) return 'By the 9th of the following month';
    const due = dueDateFor(findReturn('paye'), months[0]);
    if (!due) return 'By the 9th of the following month';
    const shown = fmtDate(due.dueDate);
    return months.length === 1
      ? `Due ${shown}`
      : `Earliest due ${shown} (${months.length} months shown)`;
  })();

  const hasPayrollFilters = !!(payrollFilter || payrollStatus !== 'all' || payrollDept !== 'all' || payrollRole !== 'all' || payrollSearch || payrollFrom || payrollTo);
  const clearPayrollFilters = () => {
    setPayrollFilter(''); setPayrollStatus('all'); setPayrollDept('all'); setPayrollRole('all');
    setPayrollSearch(''); setPayrollFrom(''); setPayrollTo('');
  };

  // Unique months for filter dropdown
  const payMonths = [...new Set(payrollRecords.map(p => p.pay_month))].sort().reverse();
  // Status options — the standard set plus any actually present
  const payStatuses = [...new Set(['pending', 'paid', 'draft', 'rejected', ...payrollRecords.map(p => p.status).filter(Boolean)])];

  // Employees that Run Payroll should process — honours the role / department /
  // search filters so e.g. filtering to Sales Agents only runs them.
  const payrollEmployees = employees.filter(e => {
    if (payrollDept !== 'all' && (e.department || '') !== payrollDept) return false;
    if (payrollRole !== 'all' && e.role !== payrollRole) return false;
    if (payrollSearch) {
      const q = payrollSearch.toLowerCase();
      const hay = [e.full_name, e.email, e.national_id].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  // Month to run for: the selected month filter, else the range start, else current.
  const payrollRunMonth = payrollFilter || payrollFrom || new Date().toISOString().slice(0, 7);

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
        // The statutory working, so this export can be reconciled against a
        // P10 return instead of just tying back to the net pay column.
        Non_Cash_Benefits: p.non_cash_benefits ?? 0,
        NSSF:       p.nssf,
        SHIF:       p.shif,
        Housing_Levy: p.housing_levy ?? '',
        Pension:    p.pension_contribution ?? 0,
        Taxable_Pay: p.taxable_pay ?? '',
        Personal_Relief:  p.personal_relief ?? '',
        Insurance_Relief: p.insurance_relief ?? '',
        PAYE:       p.paye,
        Loan_Deduction:    p.loan_deduction || 0,
        Advance_Deduction: p.advance_deduction || 0,
        Net_Pay:    p.net_salary,
        Status:     p.status,
        // Blank on rows written before rates were versioned. Left blank rather
        // than stamped with today's, so a reconciliation can tell them apart.
        Rate_Basis: p.rate_version ?? '',
      };
    });
    // Serialised through the shared writer: the inline version quoted every
    // field but never doubled an internal quote, so one employee with a quote
    // in their name shifted every column after it.
    downloadCSV(rows, `payroll_${payrollFilter || 'all'}_${new Date().toISOString().split('T')[0]}`);
  };

  /**
   * The PAYE return figures, in P10 column order.
   *
   * Exports whatever the payroll filters currently show, so the usual flow —
   * pick a month, export — gives one month's return. Exceptions are raised
   * here rather than buried in the file: a missing KRA PIN is a rejected
   * return, and iTax is an expensive place to find that out.
   */
  const exportP10 = () => {
    const employeesById = Object.fromEntries(employees.map(e => [e.id, e]));
    const rows = buildP10Rows({ records: filteredPayroll, employeesById });
    const months = [...new Set(filteredPayroll.map(p => p.pay_month))];
    const label = months.length === 1 ? months[0] : `${months.length}_months`;

    if (!downloadCSV(rows, `P10_${label}`, P10_COLUMNS)) return;

    const totals = p10Totals(rows);
    const { missingPin, reconstructed } = p10Exceptions(rows);
    if (missingPin.length) {
      setPayrollNotice({ tone: 'error', text: `P10 exported, but ${missingPin.length} employee(s) have no KRA PIN on file — KRA will reject those rows. Missing: ${missingPin.slice(0, 5).join(', ')}${missingPin.length > 5 ? '…' : ''}` });
    } else if (reconstructed) {
      setPayrollNotice({ tone: 'warn', text: `P10 exported — ${totals.employees} employee(s), PAYE ${fmt(totals.paye)}. ${reconstructed} row(s) predate the stored tax base and were reconstructed at their own month's rates; check them before filing.` });
    } else {
      setPayrollNotice({ tone: 'ok', text: `P10 exported — ${totals.employees} employee(s), gross ${fmt(totals.grossPay)}, PAYE ${fmt(totals.paye)} due to KRA.` });
    }
  };

  /**
   * Every payslip the filters currently show, as one page-broken document.
   *
   * HR had no payslip printing at all — running payroll here and then walking
   * over to the Finance Hub to print each slip one at a time was the only way
   * to hand staff their payslips.
   */
  const printPayslips = () => {
    if (!filteredPayroll.length) return;
    const w = window.open('', '_blank');
    if (!w) {
      setPayrollNotice({ tone: 'error', text: 'Allow pop-ups to print payslips.' });
      return;
    }
    w.document.write(payslipDocument(filteredPayroll.map(p => {
      const emp = employees.find(e => e.id === p.employee_id) || {};
      return {
        company: companyProfile,
        employee: { id: p.employee_id, full_name: emp.full_name, department: emp.department, email: emp.email, kra_pin: emp.kra_pin },
        month: p.pay_month,
        data: resolvePayrollRecord(p),
      };
    })));
    w.document.close();
    w.focus();
    w.print();
    setPayrollNotice({ tone: 'ok', text: `${filteredPayroll.length} payslip(s) ready — print, or choose "Save as PDF" in the print dialog.` });
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
          <div className="flex items-center gap-2">
            <button className={S.btnPri} onClick={() => openModal('hrEmployee', true)}>
              <Icon name="UserPlus" size={15} color="currentColor" /> Add Employee
            </button>
            <ClosePageButton label="Close HR Management" />
          </div>
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
            { id: 'documents', label: 'Documents',        icon: 'FileText' },
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
                            <div className="flex items-center gap-3">
                              <button className="text-xs text-primary hover:underline" onClick={e => { e.stopPropagation(); openModal('hrEmployee', emp); }}>
                                Edit
                              </button>
                              {canDelete && (
                                <button className="text-xs text-red-600 hover:underline" onClick={e => { e.stopPropagation(); openModal('hrEmployeeDelete', emp); }}>
                                  Delete
                                </button>
                              )}
                            </div>
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

        {/* ── DOCUMENTS TAB ─────────────────────────────────────────────── */}
        {activeTab === 'documents' && (
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
                      {['Employee', 'ID / Passport', 'CV', 'Photo'].map(h => (
                        <th key={h} className={S.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      Array(5).fill(0).map((_, i) => (
                        <tr key={i}>{Array(4).fill(0).map((_, j) => <td key={j} className={S.td}><Sk className="h-4 w-full" /></td>)}</tr>
                      ))
                    ) : filtered.length === 0 ? (
                      <tr><td colSpan={4}>
                        <div className="flex flex-col items-center justify-center py-16">
                          <Icon name="FileText" size={28} color="var(--muted-foreground)" />
                          <p className="text-sm font-medium text-foreground mt-3">No employees found</p>
                          <p className="text-xs text-muted-foreground">Upload documents from the employee's Edit form</p>
                        </div>
                      </td></tr>
                    ) : filtered.map(emp => (
                      <tr key={emp.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => openModal('hrEmployeeDetail', emp)}>
                        <td className={S.tdF}>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-bold text-primary">{emp.full_name?.charAt(0)}</span>
                            </div>
                            <div>
                              <p className="font-medium text-foreground">{emp.full_name}</p>
                              <p className="text-xs text-muted-foreground">{emp.department || '—'}</p>
                            </div>
                          </div>
                        </td>
                        <td className={S.td} onClick={e => e.stopPropagation()}><DocLink url={emp.id_document_url} label="View ID" /></td>
                        <td className={S.td} onClick={e => e.stopPropagation()}><DocLink url={emp.cv_url} label="View CV" /></td>
                        <td className={S.td} onClick={e => e.stopPropagation()}><DocThumb url={emp.photo_url} /></td>
                      </tr>
                    ))}
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
            <div className="space-y-3">
              {/* Row 1: search + actions */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex-1 min-w-[200px] max-w-md">
                  <Icon name="Search" size={14} color="var(--muted-foreground)" className="absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    className={`${S.input} pl-9`}
                    placeholder="Search by name, email or ID number…"
                    value={payrollSearch}
                    onChange={e => setPayrollSearch(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={exportPayrollCSV}
                    disabled={filteredPayroll.length === 0}
                    className={S.btnSec + ' disabled:opacity-50'}
                  >
                    <Icon name="Download" size={14} color="currentColor" />
                    Export CSV
                  </button>
                  <button
                    onClick={exportP10}
                    disabled={filteredPayroll.length === 0}
                    className={S.btnSec + ' disabled:opacity-50'}
                    title="PAYE return figures in KRA P10 column order"
                  >
                    <Icon name="Landmark" size={14} color="currentColor" />
                    P10 Return
                  </button>
                  <button
                    onClick={printPayslips}
                    disabled={filteredPayroll.length === 0}
                    className={S.btnSec + ' disabled:opacity-50'}
                    title="All payslips shown, as one document"
                  >
                    <Icon name="Printer" size={14} color="currentColor" />
                    Payslips
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

              {/* Row 2: filters */}
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className={S.label}>Month</label>
                  <select className={`${S.select} w-40`} value={payrollFilter} onChange={e => setPayrollFilter(e.target.value)}>
                    <option value="">All months</option>
                    {payMonths.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className={S.label}>Status</label>
                  <select className={`${S.select} w-36`} value={payrollStatus} onChange={e => setPayrollStatus(e.target.value)}>
                    <option value="all">All statuses</option>
                    {payStatuses.map(s => <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className={S.label}>Department</label>
                  <select className={`${S.select} w-40`} value={payrollDept} onChange={e => setPayrollDept(e.target.value)}>
                    <option value="all">All departments</option>
                    {depts.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className={S.label}>Role</label>
                  <select className={`${S.select} w-40`} value={payrollRole} onChange={e => setPayrollRole(e.target.value)}>
                    <option value="all">All roles</option>
                    {empRoles.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                  </select>
                </div>
                <div>
                  <label className={S.label}>From</label>
                  <input type="month" className={`${S.input} w-36`} value={payrollFrom} onChange={e => setPayrollFrom(e.target.value)} />
                </div>
                <div>
                  <label className={S.label}>To</label>
                  <input type="month" className={`${S.input} w-36`} value={payrollTo} onChange={e => setPayrollTo(e.target.value)} />
                </div>
                <div className="flex items-center gap-3 pb-0.5">
                  <span className="text-xs text-muted-foreground">{filteredPayroll.length} record(s)</span>
                  {hasPayrollFilters && (
                    <button onClick={clearPayrollFilters} className="text-xs font-medium text-primary hover:underline flex items-center gap-1">
                      <Icon name="X" size={12} color="currentColor" /> Clear
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Export result — sticks around so a missing-PIN warning can be
                acted on rather than missed. */}
            {payrollNotice && (
              <div className={`flex items-start gap-3 p-3 rounded-xl border text-xs ${
                payrollNotice.tone === 'error' ? 'bg-red-50 border-red-200 text-red-700'
                : payrollNotice.tone === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              }`}>
                <Icon
                  name={payrollNotice.tone === 'ok' ? 'CheckCircle' : 'AlertTriangle'}
                  size={15}
                  color="currentColor"
                  className="mt-0.5 shrink-0"
                />
                <p className="flex-1">{payrollNotice.text}</p>
                <button onClick={() => setPayrollNotice(null)} className="shrink-0 opacity-60 hover:opacity-100">
                  <Icon name="X" size={14} color="currentColor" />
                </button>
              </div>
            )}

            {/* Statutory deadlines. Above the summary cards and the table on
                purpose: what is overdue matters more than what was paid, and
                putting it below a 200-row table means it is never seen. */}
            <StatutoryCalendarPanel
              loading={statutory.loading}
              error={statutory.error}
              saving={statutory.saving}
              calendar={statutory.calendar}
              history={statutory.history}
              summary={statutory.summary}
              settings={statutory.settings}
              onFile={statutory.markFiled}
              onUnfile={statutory.unmarkFiled}
              onSaveSettings={statutory.saveSettings}
            />

            {/* Payroll summary cards for selected month */}
            {filteredPayroll.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Total Gross',   value: fmt(payrollTotals.gross), color: 'text-foreground',
                    sub: `${filteredPayroll.length} employee(s)` },
                  { label: 'Total Net Pay', value: fmt(payrollTotals.net),   color: 'text-emerald-600',
                    sub: 'Paid to staff' },
                  // The deadline is now a real date rather than the sentence
                  // "By the 9th of next month" that used to sit here: that
                  // string was true of whatever month you were looking at only
                  // by coincidence, and said nothing when the filter spanned
                  // several. Resolved through the same schedule the calendar
                  // panel and the reminder emails use.
                  { label: 'PAYE Due to KRA', value: fmt(payrollTotals.paye), color: 'text-red-500',
                    sub: payeDeadlineNote },
                  // NSSF and the housing levy are matched by the employer, so the
                  // cash that actually leaves the business is roughly double what
                  // was withheld. Showing only the withheld half understates the
                  // month's statutory bill.
                  { label: 'Statutory Remittance', value: fmt(payrollTotals.remittance), color: 'text-orange-500',
                    sub: 'NSSF + SHIF + AHL, incl. employer match' },
                ].map(({ label, value, color, sub }) => (
                  <div key={label} className="bg-card border border-border rounded-xl p-4">
                    <p className="text-xs text-muted-foreground mb-1">{label}</p>
                    <p className={`text-lg font-bold font-mono ${color}`}>{value}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
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
                      {['Employee', 'Pay Month', 'Basic', 'Allowances', 'Additions', 'Gross', 'Taxable Pay', 'PAYE', 'NSSF', 'SHIF', 'AHL', 'Other Deduct.', 'Net Pay', 'Status'].map(h => (
                        <th key={h} className={S.th + ' whitespace-nowrap'}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      Array(5).fill(0).map((_, i) => <tr key={i}>{Array(14).fill(0).map((_, j) => <td key={j} className={S.td}><Sk className="h-4 w-full" /></td>)}</tr>)
                    ) : filteredPayroll.length === 0 ? (
                      <tr><td colSpan={14}>
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
                          {/* Records written before the statutory breakdown existed
                              have no value here. A dash reads as "not recorded";
                              a zero would read as "no tax base", which is a lie. */}
                          <td className={`${S.td} font-mono`}>{p.taxable_pay == null ? '—' : fmt(p.taxable_pay)}</td>
                          <td className={`${S.td} font-mono text-red-500`}>({fmt(p.paye)})</td>
                          <td className={`${S.td} font-mono text-red-500`}>({fmt(p.nssf)})</td>
                          <td className={`${S.td} font-mono text-red-500`}>({fmt(p.shif)})</td>
                          <td className={`${S.td} font-mono text-red-500`}>{p.housing_levy == null ? '—' : `(${fmt(p.housing_levy)})`}</td>
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
          onDelete={canDelete ? () => openModal('hrEmployeeDelete', selected) : undefined}
          onClose={() => closeModal('hrEmployeeDetail')}
        />
      )}

      {/* Permanent delete confirmation */}
      {deleteTarget && (
        <DeleteEmployeeModal
          employee={deleteTarget}
          onClose={() => closeModal('hrEmployeeDelete')}
          onDeleted={() => { closeModal('hrEmployeeDetail'); fetchAll(); }}
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
          employees={payrollEmployees}
          initialMonth={payrollRunMonth}
          onClose={() => closeModal('hrPayroll')}
          onSaved={fetchAll}
          adminId={adminIdRef.current || adminId}
        />
      )}
    </MainLayout>
  );
};

export default HRPage;

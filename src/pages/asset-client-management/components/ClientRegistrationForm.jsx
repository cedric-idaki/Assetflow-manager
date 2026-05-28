import React, { useState } from 'react';
import Icon from '../../../components/AppIcon';
import { supabase } from '../../../lib/supabase';

// ── Helpers ───────────────────────────────────────────────────────────────────
const ic = (err) =>
  `w-full px-3 py-2.5 text-sm bg-background border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground placeholder:text-muted-foreground transition-colors ${
    err ? 'border-red-400 bg-red-50' : 'border-border'
  }`;

const FieldError = ({ msg }) =>
  msg ? <p className="mt-1 text-xs text-red-500 flex items-center gap-1"><Icon name="AlertCircle" size={11} color="#ef4444" /> {msg}</p> : null;

const Label = ({ children, required }) => (
  <label className="block text-xs font-semibold text-muted-foreground mb-1">
    {children} {required && <span className="text-red-500">*</span>}
  </label>
);

const SectionHeader = ({ title, subtitle }) => (
  <div className="pt-4 border-t border-border">
    <h3 className="text-sm font-bold text-foreground">{title}</h3>
    {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
  </div>
);

// ── Generate account number (BRS 3.4: AF-YYYY-000001) ────────────────────────
const generateAccountNumber = () => {
  const year = new Date().getFullYear();
  const seq  = String(Math.floor(Math.random() * 999999) + 1).padStart(6, '0');
  return `AF-${year}-${seq}`;
};

// ── Age validation ────────────────────────────────────────────────────────────
const isOver18 = (dob) => {
  if (!dob) return false;
  const today    = new Date();
  const birthDate = new Date(dob);
  const age = today.getFullYear() - birthDate.getFullYear() -
    (today < new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate()) ? 1 : 0);
  return age >= 18;
};

// ── KRA PIN validation (AXXXXXXXXXA) ──────────────────────────────────────────
const isValidKRAPin = (pin) => /^[A-Z]\d{9}[A-Z]$/.test(pin.toUpperCase());

// ── Director row (BRS 3.2.1) ──────────────────────────────────────────────────
const DirectorRow = ({ director, index, onChange, onRemove, errors }) => {
  const set = (k, v) => onChange(index, k, v);
  const e   = errors || {};

  return (
    <div className="border border-border rounded-xl p-4 space-y-3 bg-muted/20">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-foreground">Director / Beneficial Owner {index + 1}</p>
        {index > 0 && (
          <button onClick={() => onRemove(index)} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
            <Icon name="Trash2" size={12} color="currentColor" /> Remove
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label required>Full Name</Label>
          <input type="text" value={director.full_name} onChange={e => set('full_name', e.target.value)}
            placeholder="e.g. Jane Mwangi" className={ic(e.full_name)} />
          <FieldError msg={e.full_name} />
        </div>
        <div>
          <Label required>ID / Passport Number</Label>
          <input type="text" value={director.id_number} onChange={e => set('id_number', e.target.value)}
            placeholder="ID or Passport Number" className={ic(e.id_number)} />
          <FieldError msg={e.id_number} />
        </div>
        <div>
          <Label required>KRA PIN</Label>
          <input type="text" value={director.kra_pin} onChange={e => set('kra_pin', e.target.value.toUpperCase())}
            placeholder="A123456789B" className={ic(e.kra_pin)} maxLength={11} />
          <FieldError msg={e.kra_pin} />
        </div>
        <div>
          <Label required>Phone Number</Label>
          <input type="tel" value={director.phone} onChange={e => set('phone', e.target.value)} onBlur={e => set('phone', formatKEPhone(e.target.value))}
            placeholder="+254 7XX XXX XXX" className={ic(e.phone)} />
          <FieldError msg={e.phone} />
        </div>
        <div>
          <Label required>Email Address</Label>
          <input type="email" value={director.email} onChange={e => set('email', e.target.value)}
            placeholder="director@company.com" className={ic(e.email)} />
          <FieldError msg={e.email} />
        </div>
        <div>
          <Label required>Ownership Percentage (%)</Label>
          <input type="number" value={director.ownership_pct} onChange={e => set('ownership_pct', e.target.value)}
            placeholder="e.g. 50" min="1" max="100" className={ic(e.ownership_pct)} />
          <FieldError msg={e.ownership_pct} />
        </div>
      </div>

      {/* PEP status (BRS 3.2.1) */}
      <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <input type="checkbox" id={`pep-${index}`} checked={director.is_pep}
          onChange={e => set('is_pep', e.target.checked)}
          className="w-4 h-4 rounded border-border accent-primary" />
        <div>
          <label htmlFor={`pep-${index}`} className="text-xs font-semibold text-amber-800 cursor-pointer">
            Politically Exposed Person (PEP)
          </label>
          <p className="text-xs text-amber-700">Check if this director holds or has held a prominent public position</p>
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
const ClientRegistrationForm = ({ onClose, onSubmit, editData }) => {
  // ── Client type toggle ────────────────────────────────────────────────────
  const [clientType, setClientType] = useState(editData?.client_type || 'individual');

  // ── Individual form ───────────────────────────────────────────────────────
  const [form, setForm] = useState({
    // BRS 3.1 — Individual
    full_name:        editData?.full_name        || editData?.fullName        || '',
    national_id:      editData?.national_id      || editData?.nationalId      || '',
    passport_number:  editData?.passport_number  || editData?.passportNumber  || '',
    kra_pin:          editData?.kra_pin          || editData?.kraPin          || '',
    email:            editData?.email            || '',
    phone:            editData?.phone            || '',
    alternate_phone:  editData?.alternate_phone  || editData?.alternatePhone  || '',
    date_of_birth:    editData?.date_of_birth    || '',
    occupation:       editData?.occupation       || '',
    employer_name:    editData?.employer_name    || '',
    employer_address: editData?.employer_address || '',
    employer_phone:   editData?.employer_phone   || '',
    monthly_income:   editData?.monthly_income   || '',
    physical_address: editData?.physical_address || editData?.physicalAddress || '',
    postal_address:   editData?.postal_address   || editData?.postalAddress   || '',
    city:             editData?.city             || '',
    country:          editData?.country          || 'Kenya',
    photo_url:        editData?.photo_url        || editData?.photoUrl        || '',
    // Next of Kin (BRS 3.1 — mandatory)
    nok_name:         editData?.nok_name         || '',
    nok_phone:        editData?.nok_phone        || '',
    nok_relationship: editData?.nok_relationship || '',
    // Company fields (BRS 3.2)
    company_name:          editData?.company_name          || '',
    company_reg_number:    editData?.company_reg_number    || '',
    company_kra_pin:       editData?.company_kra_pin       || '',
    company_email:         editData?.company_email         || '',
    company_phone:         editData?.company_phone         || '',
    company_address:       editData?.company_address       || '',
  });

  const [directors, setDirectors] = useState(
    editData?.directors || [{ full_name: '', id_number: '', kra_pin: '', phone: '', email: '', ownership_pct: '', is_pep: false }]
  );

  const [photoPreview, setPhotoPreview] = useState(editData?.photo_url || editData?.photoUrl || '');
  const [errors, setErrors]             = useState({});
  const [dirErrors, setDirErrors]       = useState([{}]);
  const [showEmployer, setShowEmployer] = useState(!!editData?.employer_name);
  const [submitting, setSubmitting]     = useState(false);

  // Validates a single field immediately and clears error when valid
  const validateField = (k, v, formSnapshot) => {
    const f = { ...formSnapshot, [k]: v };
    let err = '';

    switch (k) {
      case 'full_name':
        if (!v.trim() || v.trim().length < 3) err = 'Full name must be at least 3 characters';
        else if (!/^[a-zA-Z\s\''-]+$/.test(v.trim())) err = 'Full name should only contain letters';
        break;
      case 'kra_pin':
        if (!v.trim()) err = 'KRA PIN is required ';
        else if (v.trim().length > 0 && !isValidKRAPin(v.trim())) err = 'Invalid KRA PIN — must be AXXXXXXXXXA (e.g. A123456789B)';
        break;
      case 'email':
        if (!v.trim()) err = 'Email is required';
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) err = 'Invalid email address';
        break;
      case 'phone':
        if (!v.trim()) err = 'Phone number is required';
        else if (!/^[+\d\s()-]{7,15}$/.test(v.trim())) err = 'Enter a valid phone number (+254 7XX XXX XXX)';
        break;
      case 'date_of_birth':
        if (!v) err = 'Date of birth is required ';
        else if (!isOver18(v)) err = 'Client must be at least 18 years old ';
        break;
      case 'physical_address':
        if (!v.trim() || v.trim().length < 5) err = 'Physical address is required (County, Sub-county, Estate, Plot)';
        break;
      case 'nok_name':
        if (!v.trim()) err = 'Next of Kin name is required ';
        break;
      case 'nok_phone':
        if (!v.trim()) err = 'Next of Kin phone is required ';
        else if (v.trim() === f.phone?.trim()) err = 'Next of Kin phone must differ from client phone';
        break;
      case 'nok_relationship':
        if (!v) err = 'Relationship is required ';
        break;
      case 'employer_name':
        if (showEmployer && !v.trim()) err = 'Employer name is required when employed';
        break;
      case 'employer_address':
        if (showEmployer && !v.trim()) err = 'Employer address is required when employed';
        break;
      // Company fields
      case 'company_name':
        if (!v.trim()) err = 'Company name is required';
        break;
      case 'company_reg_number':
        if (!v.trim()) err = 'Company registration number is required';
        break;
      case 'company_kra_pin':
        if (!v.trim()) err = 'Company KRA PIN is required';
        break;
      case 'company_email':
        if (!v.trim()) err = 'Company email is required';
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) err = 'Invalid email address';
        break;
      case 'company_phone':
        if (!v.trim()) err = 'Company phone is required';
        break;
      case 'company_address':
        if (!v.trim()) err = 'Registered address is required';
        break;
      default:
        break;
    }
    return err;
  };

  const set = (k, v) => {
    setForm(p => {
      const updated = { ...p, [k]: v };
      // Validate this field immediately against the updated form
      const err = validateField(k, v, updated);
      setErrors(prev => ({ ...prev, [k]: err }));
      return updated;
    });
  };

  // ── Photo upload ──────────────────────────────────────────────────────────
  const [photoUploading, setPhotoUploading] = useState(false);

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size
    if (file.size > 2 * 1024 * 1024) {
      setErrors(p => ({ ...p, photo_url: 'Photo must be less than 2MB' }));
      return;
    }
    // Validate type
    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(file.type)) {
      setErrors(p => ({ ...p, photo_url: 'Only JPG and PNG images are allowed' }));
      return;
    }

    // Show local preview immediately while uploading
    const reader = new FileReader();
    reader.onloadend = () => setPhotoPreview(reader.result);
    reader.readAsDataURL(file);

    setPhotoUploading(true);
    setErrors(p => ({ ...p, photo_url: '' }));

    try {
      // Ensure the bucket exists (creates it if missing — idempotent)
      await supabase.storage.createBucket('client-photos', {
        public: true,
        allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png'],
        fileSizeLimit: 2 * 1024 * 1024,
      }).catch(() => {}); // ignore error if bucket already exists

      // Upload to Supabase Storage bucket 'client-photos'
      const ext      = file.name.split('.').pop();
      // Use client ID in filename when editing so the file overwrites the old one
      const clientId = editData?._id || editData?.id || Date.now();
      const fileName = `client_${clientId}.${ext}`;

      // Use fetch directly with the auth token to bypass RLS on storage
      // (the JS client upload respects RLS; direct REST upload uses the JWT)
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const uploadRes = await fetch(
        `${supabaseUrl}/storage/v1/object/client-photos/${fileName}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token || supabaseAnonKey}`,
            'apikey': supabaseAnonKey,
            'Content-Type': file.type,
            'x-upsert': 'true',
          },
          body: file,
        }
      );

      if (!uploadRes.ok) {
        const errJson = await uploadRes.json().catch(() => ({}));
        throw new Error(errJson?.message || `Upload failed with status ${uploadRes.status}`);
      }

      // Build the public URL
      const publicUrl = `${supabaseUrl}/storage/v1/object/public/client-photos/${fileName}`;

      setForm(p => ({ ...p, photo_url: publicUrl }));
      setErrors(p => ({ ...p, photo_url: '' }));
    } catch (err) {
      // Storage upload failed — show error to user instead of silently falling back
      console.error('[AssetFlow] Storage upload failed:', err?.message);
      setErrors(p => ({
        ...p,
        photo_url: `Photo upload failed: ${err?.message || 'Storage error'}. Please ensure the "client-photos" bucket exists in Supabase Storage and is set to public.`,
      }));
      // Revert preview to nothing so user knows upload didn't succeed
      setPhotoPreview('');
      setForm(p => ({ ...p, photo_url: '' }));
    } finally {
      setPhotoUploading(false);
    }
  };

  // ── Director handlers ─────────────────────────────────────────────────────
  const updateDirector = (index, key, value) => {
    setDirectors(prev => prev.map((d, i) => i === index ? { ...d, [key]: value } : d));
    // Validate director field immediately
    setDirErrors(prev => prev.map((e, i) => {
      if (i !== index) return e;
      let err = '';
      if (key === 'full_name'   && !value.trim()) err = 'Director name is required';
      if (key === 'id_number'   && !value.trim()) err = 'ID/Passport is required';
      if (key === 'kra_pin'     && !value.trim()) err = 'KRA PIN is required';
      if (key === 'kra_pin'     && value.trim() && !isValidKRAPin(value)) err = 'Invalid KRA PIN format';
      if (key === 'phone'       && !value.trim()) err = 'Phone is required';
      if (key === 'email'       && !value.trim()) err = 'Email is required';
      if (key === 'ownership_pct' && !value)      err = 'Ownership % is required';
      return { ...e, [key]: err };
    }));
  };

  const addDirector = () => {
    setDirectors(prev => [...prev, { full_name: '', id_number: '', kra_pin: '', phone: '', email: '', ownership_pct: '', is_pep: false }]);
    setDirErrors(prev => [...prev, {}]);
  };

  const removeDirector = (index) => {
    setDirectors(prev => prev.filter((_, i) => i !== index));
    setDirErrors(prev => prev.filter((_, i) => i !== index));
  };

  // ── Validation ────────────────────────────────────────────────────────────
  const isEditMode = !!editData;

  const validateIndividual = () => {
    const e = {};

    // Full name
    if (!form.full_name.trim() || form.full_name.trim().length < 3)
      e.full_name = 'Full name must be at least 3 characters';
    else if (!/^[a-zA-Z\s''-]+$/.test(form.full_name.trim()))
      e.full_name = 'Full name should only contain letters';

    // ID or Passport required
    if (!form.national_id.trim() && !form.passport_number.trim())
      e.national_id = 'National ID or Passport number is required';

    // KRA PIN — mandatory (BRS 3.1)
    if (!form.kra_pin.trim())
      e.kra_pin = 'KRA PIN is required ';
    else if (!isValidKRAPin(form.kra_pin.trim()))
      e.kra_pin = 'Invalid KRA PIN format — must be AXXXXXXXXXA (e.g. A123456789B)';

    // Email
    if (!form.email.trim()) e.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Invalid email address';

    // Phone (Kenyan format)
    if (!form.phone.trim()) e.phone = 'Phone number is required';
    else if (!/^[+\d\s()-]{7,15}$/.test(form.phone.trim())) e.phone = 'Enter a valid phone number (+254 7XX XXX XXX)';

    // Date of birth — mandatory with 18+ validation (BRS 3.1)
    if (!form.date_of_birth) e.date_of_birth = 'Date of birth is required ';
    else if (!isOver18(form.date_of_birth)) e.date_of_birth = 'Client must be at least 18 years old ';

    // Physical address
    if (!form.physical_address.trim() || form.physical_address.trim().length < 5)
      e.physical_address = 'Physical address is required (County, Sub-county, Estate, Plot)';

    // Passport photo — only required on new registration, not on edit
    // if (!isEditMode && !form.photo_url) e.photo_url = 'Passport photo is required ';

    // Next of Kin — all 3 fields mandatory (BRS 3.1)
    if (!form.nok_name.trim())          e.nok_name         = 'Next of Kin name is required ';
    if (!form.nok_phone.trim())         e.nok_phone        = 'Next of Kin phone is required';
    if (form.nok_phone.trim() === form.phone.trim()) e.nok_phone = 'Next of Kin phone must differ from client phone';
    if (!form.nok_relationship)         e.nok_relationship = 'Relationship is required ';

    // Employer fields — conditional
    if (showEmployer) {
      if (!form.employer_name.trim()) e.employer_name = 'Employer name is required when employed';
      if (!form.employer_address.trim()) e.employer_address = 'Employer address is required when employed';
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateCompany = () => {
    const e = {};
    if (!form.company_name.trim())       e.company_name       = 'Company name is required';
    if (!form.company_reg_number.trim()) e.company_reg_number = 'Company registration number is required';
    if (!form.company_kra_pin.trim())    e.company_kra_pin    = 'Company KRA PIN is required';
    if (!form.company_email.trim())      e.company_email      = 'Company email is required';
    if (!form.company_phone.trim())      e.company_phone      = 'Company phone is required';
    if (!form.company_address.trim())    e.company_address    = 'Registered address is required';

    // Validate directors
    const dErrors = directors.map(d => {
      const de = {};
      if (!d.full_name.trim())   de.full_name   = 'Director name is required';
      if (!d.id_number.trim())   de.id_number   = 'ID/Passport is required';
      if (!d.kra_pin.trim())     de.kra_pin     = 'KRA PIN is required';
      else if (!isValidKRAPin(d.kra_pin)) de.kra_pin = 'Invalid KRA PIN format';
      if (!d.phone.trim())       de.phone       = 'Phone is required';
      if (!d.email.trim())       de.email       = 'Email is required';
      if (!d.ownership_pct)      de.ownership_pct = 'Ownership % is required';
      return de;
    });
    setDirErrors(dErrors);
    const dirValid = dErrors.every(de => Object.keys(de).length === 0);

    setErrors(e);
    return Object.keys(e).length === 0 && dirValid;
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const valid = clientType === 'individual' ? validateIndividual() : validateCompany();
    if (!valid) return;

    setSubmitting(true);
    try {
      // BRS 3.4: Generate account number in AF-YYYY-000001 format
      const accountNumber = editData?.account_number || generateAccountNumber();

      const payload = clientType === 'individual' ? {
        client_type:      'individual',
        full_name:        form.full_name.trim(),
        national_id:      form.national_id.trim()       || null,
        passport_number:  form.passport_number.trim()   || null,
        kra_pin:          form.kra_pin.trim().toUpperCase(),
        email:            form.email.trim().toLowerCase(),
        phone:            form.phone.trim(),
        alternate_phone:  form.alternate_phone.trim()   || null,
        date_of_birth:    form.date_of_birth,
        occupation:       form.occupation.trim()        || null,
        employer_name:    form.employer_name.trim()     || null,
        employer_address: form.employer_address.trim()  || null,
        employer_phone:   form.employer_phone.trim()    || null,
        monthly_income:   form.monthly_income ? parseFloat(form.monthly_income) : null,
        physical_address: form.physical_address.trim(),
        postal_address:   form.postal_address.trim()    || null,
        city:             form.city.trim()              || null,
        country:          form.country.trim()           || 'Kenya',
        photo_url:        form.photo_url                || null,
        // Next of Kin
        nok_name:         form.nok_name.trim(),
        nok_phone:        form.nok_phone.trim(),
        nok_relationship: form.nok_relationship,
        // Meta
        account_number:   accountNumber,
        client_status:    'pending',
        kyc_status:       'incomplete',
      } : {
        client_type:         'company',
        full_name:           form.company_name.trim(), // full_name = company name for company clients
        company_name:        form.company_name.trim(),
        company_reg_number:  form.company_reg_number.trim(),
        kra_pin:             form.company_kra_pin.trim().toUpperCase(),
        email:               form.company_email.trim().toLowerCase(),
        phone:               form.company_phone.trim(),
        physical_address:    form.company_address.trim(),
        directors:           directors,
        account_number:      accountNumber,
        client_status:       'pending',
        kyc_status:          'incomplete',
      };

      await onSubmit(payload);
    } catch (err) {
      setErrors({ submit: err.message || 'Registration failed. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Icon name="UserPlus" size={18} color="#1A56DB" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">
                {editData ? 'Edit Client' : 'Register New Client'}
              </h2>
              <p className="text-xs text-muted-foreground">KYC Compliance</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <Icon name="X" size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        {/* Client type selector */}
        <div className="flex gap-2 px-6 py-3 border-b border-border bg-muted/20 flex-shrink-0">
          <p className="text-xs font-semibold text-muted-foreground self-center mr-2">Client Type:</p>
          {[
            { value: 'individual', label: 'Individual',    icon: 'User' },
            { value: 'company',    label: 'Company / Corporate', icon: 'Building2' },
          ].map(t => (
            <button key={t.value} onClick={() => setClientType(t.value)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border-2 transition-all ${
                clientType === t.value ? 'border-primary text-white' : 'border-border text-muted-foreground hover:border-primary/40'
              }`}
              style={clientType === t.value ? { background: 'linear-gradient(135deg,#1A56DB,#1E429F)' } : {}}>
              <Icon name={t.icon} size={14} color={clientType === t.value ? 'white' : 'currentColor'} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Form body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {errors.submit && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
              <Icon name="AlertCircle" size={15} color="currentColor" /> {errors.submit}
            </div>
          )}

          {/* ══ INDIVIDUAL CLIENT FORM ══ */}
          {clientType === 'individual' && (
            <>
              {/* Passport photo */}
              <div className="flex flex-col items-center gap-3 p-4 bg-muted/30 rounded-xl border border-border">
                <div className="relative">
                  {photoPreview ? (
                    <img src={photoPreview} alt="Client" className="w-28 h-28 rounded-full object-cover border-4 border-primary" />
                  ) : (
                    <div className="w-28 h-28 rounded-full bg-muted flex items-center justify-center border-4 border-dashed border-border">
                      <Icon name="User" size={40} color="var(--color-muted-foreground)" />
                    </div>
                  )}
                </div>
                <div className="text-center">
                  <label htmlFor="photo-upload"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium cursor-pointer hover:bg-muted transition-all">
                    {photoUploading
                      ? <><Icon name="Loader2" size={14} color="currentColor" /> Uploading...</>
                      : <><Icon name="Upload" size={14} color="currentColor" /> {photoPreview ? 'Change Photo' : 'Upload Passport Photo *'}</>
                    }
                  </label>
                  <input id="photo-upload" type="file" accept="image/jpeg,image/jpg,image/png"
                    onChange={handlePhotoUpload} className="hidden" disabled={photoUploading} />
                  <p className="text-xs text-muted-foreground mt-1">JPG or PNG, max 2MB, clear face visible</p>
                  <FieldError msg={errors.photo_url} />
                </div>
              </div>

              {/* Personal Information */}
              <SectionHeader title="Personal Information" subtitle=" All mandatory fields must be completed" />

              <div>
                <Label required>Full Legal Name</Label>
                <input type="text" value={form.full_name} onChange={e => set('full_name', e.target.value)}
                  placeholder="Must match National ID exactly" className={ic(errors.full_name)} />
                <FieldError msg={errors.full_name} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>National ID Number</Label>
                  <input type="text" value={form.national_id} onChange={e => set('national_id', e.target.value)}
                    placeholder="ID Number" className={ic(errors.national_id)} />
                  <FieldError msg={errors.national_id} />
                </div>
                <div>
                  <Label>Passport Number</Label>
                  <input type="text" value={form.passport_number}
                    onChange={e => set('passport_number', e.target.value.toUpperCase())}
                    placeholder="For non-citizens" className={ic(false)} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label required>KRA PIN</Label>
                  <input type="text" value={form.kra_pin}
                    onChange={e => set('kra_pin', e.target.value.toUpperCase())}
                    placeholder="e.g. A123456789B" className={ic(errors.kra_pin)} maxLength={11} />
                  <p className="text-xs text-muted-foreground mt-0.5">Format: AXXXXXXXXXA</p>
                  <FieldError msg={errors.kra_pin} />
                </div>
                <div>
                  <Label required>Date of Birth</Label>
                  <input type="date" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)}
                    max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().split('T')[0]}
                    className={ic(errors.date_of_birth)} />
                  <p className="text-xs text-muted-foreground mt-0.5">Must be 18+ years </p>
                  <FieldError msg={errors.date_of_birth} />
                </div>
              </div>

              {/* Contact Information */}
              <SectionHeader title="Contact Information" />

              <div>
                <Label required>Email Address</Label>
                <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                  placeholder="email@example.com" className={ic(errors.email)} />
                <FieldError msg={errors.email} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label required>Primary Phone</Label>
                  <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} onBlur={e => set('phone', formatKEPhone(e.target.value))}
                    placeholder="+254 7XX XXX XXX" className={ic(errors.phone)} />
                  <FieldError msg={errors.phone} />
                </div>
                <div>
                  <Label>Secondary Phone</Label>
                  <input type="tel" value={form.alternate_phone} onChange={e => set('alternate_phone', e.target.value)} onBlur={e => set('alternate_phone', formatKEPhone(e.target.value))}
                    placeholder="+254 7XX XXX XXX" className={ic(false)} />
                </div>
              </div>

              {/* Address */}
              <SectionHeader title="Address Information" />

              <div>
                <Label required>Physical Address</Label>
                <input type="text" value={form.physical_address} onChange={e => set('physical_address', e.target.value)}
                  placeholder="County, Sub-county, Estate, Plot No." className={ic(errors.physical_address)} />
                <FieldError msg={errors.physical_address} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <Label>Postal Address</Label>
                  <input type="text" value={form.postal_address} onChange={e => set('postal_address', e.target.value)}
                    placeholder="P.O. Box XXXXX" className={ic(false)} />
                </div>
                <div>
                  <Label>City</Label>
                  <input type="text" value={form.city} onChange={e => set('city', e.target.value)}
                    placeholder="e.g. Nairobi" className={ic(false)} />
                </div>
                <div>
                  <Label>Country</Label>
                  <input type="text" value={form.country} onChange={e => set('country', e.target.value)}
                    placeholder="e.g. Kenya" className={ic(false)} />
                </div>
              </div>

              {/* Employment Information */}
              <SectionHeader title="Employment Information" subtitle="Optional — required for installment credit assessment" />

              <div>
                <Label>Occupation</Label>
                <input type="text" value={form.occupation} onChange={e => set('occupation', e.target.value)}
                  placeholder="e.g. Engineer, Teacher, Business Owner" className={ic(false)} />
              </div>

              <div className="flex items-center gap-3">
                <button onClick={() => setShowEmployer(s => !s)}
                  className={`w-10 h-6 rounded-full transition-colors flex items-center ${showEmployer ? 'bg-primary justify-end' : 'bg-muted justify-start'}`}>
                  <span className="w-5 h-5 bg-white rounded-full shadow mx-0.5" />
                </button>
                <label className="text-sm text-foreground">Currently employed</label>
              </div>

              {showEmployer && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-2 border-l-2 border-primary/30">
                  <div>
                    <Label required>Employer Name</Label>
                    <input type="text" value={form.employer_name} onChange={e => set('employer_name', e.target.value)}
                      placeholder="Company / Organisation" className={ic(errors.employer_name)} />
                    <FieldError msg={errors.employer_name} />
                  </div>
                  <div>
                    <Label>Employer Phone</Label>
                    <input type="tel" value={form.employer_phone} onChange={e => set('employer_phone', e.target.value)} onBlur={e => set('employer_phone', formatKEPhone(e.target.value))}
                      placeholder="+254 XX XXX XXXX" className={ic(false)} />
                  </div>
                  <div className="sm:col-span-2">
                    <Label required>Employer Address</Label>
                    <input type="text" value={form.employer_address} onChange={e => set('employer_address', e.target.value)}
                      placeholder="Physical address of employer" className={ic(errors.employer_address)} />
                    <FieldError msg={errors.employer_address} />
                  </div>
                  <div>
                    <Label>Monthly Income (KES)</Label>
                    <input type="number" value={form.monthly_income} onChange={e => set('monthly_income', e.target.value)}
                      placeholder="Estimated monthly income" className={ic(false)} />
                    <p className="text-xs text-muted-foreground mt-0.5">Used for installment eligibility assessment</p>
                  </div>
                </div>
              )}

              {/* Next of Kin — BRS 3.1 Mandatory */}
              <SectionHeader
                title="Next of Kin"
                subtitle="Mandatory. All three fields are required."
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                <div>
                  <Label required>Full Name</Label>
                  <input type="text" value={form.nok_name} onChange={e => set('nok_name', e.target.value)}
                    placeholder="Next of Kin name" className={ic(errors.nok_name)} />
                  <FieldError msg={errors.nok_name} />
                </div>
                <div>
                  <Label required>Phone Number</Label>
                  <input type="tel" value={form.nok_phone} onChange={e => set('nok_phone', e.target.value)} onBlur={e => set('nok_phone', formatKEPhone(e.target.value))}
                    placeholder="+254 7XX XXX XXX" className={ic(errors.nok_phone)} />
                  <p className="text-xs text-muted-foreground mt-0.5">Must differ from client phone</p>
                  <FieldError msg={errors.nok_phone} />
                </div>
                <div>
                  <Label required>Relationship</Label>
                  <select value={form.nok_relationship} onChange={e => { set('nok_relationship', e.target.value); }}
                    className={ic(errors.nok_relationship)}>
                    <option value="">Select relationship...</option>
                    <option value="parent">Parent</option>
                    <option value="spouse">Spouse</option>
                    <option value="sibling">Sibling</option>
                    <option value="child">Child</option>
                    <option value="other">Other</option>
                  </select>
                  <FieldError msg={errors.nok_relationship} />
                </div>
              </div>
            </>
          )}

          {/* ══ COMPANY CLIENT FORM ══ */}
          {clientType === 'company' && (
            <>
              <SectionHeader title="Company Information" subtitle="Company / Corporate Client Registration" />

              <div>
                <Label required>Company Name</Label>
                <input type="text" value={form.company_name} onChange={e => set('company_name', e.target.value)}
                  placeholder="As registered with the Registrar of Companies" className={ic(errors.company_name)} />
                <FieldError msg={errors.company_name} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label required>Company Registration Number</Label>
                  <input type="text" value={form.company_reg_number}
                    onChange={e => set('company_reg_number', e.target.value.toUpperCase())}
                    placeholder="e.g. PVT-2024-001234" className={ic(errors.company_reg_number)} />
                  <FieldError msg={errors.company_reg_number} />
                </div>
                <div>
                  <Label required>Company KRA PIN</Label>
                  <input type="text" value={form.company_kra_pin}
                    onChange={e => set('company_kra_pin', e.target.value.toUpperCase())}
                    placeholder="e.g. P051234567X" className={ic(errors.company_kra_pin)} />
                  <FieldError msg={errors.company_kra_pin} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label required>Company Email</Label>
                  <input type="email" value={form.company_email} onChange={e => set('company_email', e.target.value)}
                    placeholder="info@company.co.ke" className={ic(errors.company_email)} />
                  <FieldError msg={errors.company_email} />
                </div>
                <div>
                  <Label required>Company Phone</Label>
                  <input type="tel" value={form.company_phone} onChange={e => set('company_phone', e.target.value)} onBlur={e => set('company_phone', formatKEPhone(e.target.value))}
                    placeholder="+254 XX XXX XXXX" className={ic(errors.company_phone)} />
                  <FieldError msg={errors.company_phone} />
                </div>
              </div>

              <div>
                <Label required>Registered Physical Address</Label>
                <input type="text" value={form.company_address} onChange={e => set('company_address', e.target.value)}
                  placeholder="Official registered office address" className={ic(errors.company_address)} />
                <FieldError msg={errors.company_address} />
              </div>

              {/* Directors — BRS 3.2.1 */}
              <SectionHeader
                title="Directors / Beneficial Owners"
                subtitle="At least one director required. Add all directors with ownership ≥ 10%."
              />

              <div className="space-y-3">
                {directors.map((director, index) => (
                  <DirectorRow
                    key={index}
                    director={director}
                    index={index}
                    onChange={updateDirector}
                    onRemove={removeDirector}
                    errors={dirErrors[index] || {}}
                  />
                ))}
              </div>

              <button onClick={addDirector}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium border-2 border-dashed border-border text-muted-foreground rounded-xl hover:border-primary/40 hover:text-primary transition-all w-full justify-center">
                <Icon name="Plus" size={14} color="currentColor" /> Add Another Director
              </button>

              
            </>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border flex-shrink-0 bg-card">
          <button onClick={onClose} disabled={submitting}
            className="px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-all">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={submitting}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60 transition-all"
            style={{ background: 'linear-gradient(135deg,#1A56DB,#1E429F)' }}>
            {submitting ? (
              <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
              </svg> Registering...</>
            ) : (
              <><Icon name="UserPlus" size={15} color="white" />
                {editData ? 'Update Client' : `Register ${clientType === 'company' ? 'Company' : 'Client'}`}
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};

export default ClientRegistrationForm;

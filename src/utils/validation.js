/**
 * SECURITY FIX: Input validation for all API / Supabase write operations
 *
 * This module provides:
 *  1. Pure validator functions (no external deps) for every entity
 *  2. A sanitise() helper to strip dangerous characters from strings
 *  3. Field-level error maps compatible with the existing form error pattern
 *
 * Usage:
 *   import { validatePayment, sanitise } from '../utils/validation';
 *   const { errors, data } = validatePayment(rawFormData);
 *   if (errors) return setFieldErrors(errors);
 *   // use data (sanitised + coerced)
 */

// ── String sanitisation ───────────────────────────────────────────────────────
/**
 * Strips characters that are dangerous in HTML/SQL contexts.
 * NOTE: Supabase uses parameterised queries so SQL injection is already
 * prevented at the driver level — this is an extra defence-in-depth layer
 * to keep stored data clean.
 */
export const sanitise = (value) => {
  if (value === null || value === undefined) return '';
  return String(value)
    .trim()
    .replace(/[<>"'`]/g, '');        // strip basic XSS chars
};

export const sanitiseEmail = (value) =>
  sanitise(value).toLowerCase().replace(/\s+/g, '');

// ── Reusable field rules ──────────────────────────────────────────────────────
const rules = {
  required: (value, label) =>
    !value || String(value).trim() === '' ? `${label} is required.` : null,

  email: (value) => {
    if (!value) return null; // use required() separately
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      ? null
      : 'Please enter a valid email address.';
  },

  minLength: (value, min, label) =>
    value && String(value).length < min
      ? `${label} must be at least ${min} characters.`
      : null,

  maxLength: (value, max, label) =>
    value && String(value).length > max
      ? `${label} must not exceed ${max} characters.`
      : null,

  positiveNumber: (value, label) => {
    const n = parseFloat(value);
    return isNaN(n) || n <= 0 ? `${label} must be a positive number.` : null;
  },

  nonNegativeNumber: (value, label) => {
    const n = parseFloat(value);
    return isNaN(n) || n < 0 ? `${label} must be 0 or greater.` : null;
  },

  oneOf: (value, options, label) =>
    !options.includes(value)
      ? `${label} must be one of: ${options.join(', ')}.`
      : null,

  phone: (value) => {
    if (!value) return null;
    // Accepts Kenyan numbers: +254XXXXXXXXX, 07XXXXXXXX, 01XXXXXXXX
    return /^(\+254|0)[71]\d{8}$/.test(value.replace(/\s/g, ''))
      ? null
      : 'Please enter a valid Kenyan phone number (e.g. 0712345678).';
  },

  nationalId: (value) => {
    if (!value) return null;
    return /^\d{7,8}$/.test(value)
      ? null
      : 'National ID must be 7–8 digits.';
  },

  strongPassword: (value) => {
    if (!value) return null;
    const checks = [
      { test: value.length >= 8,       msg: 'at least 8 characters' },
      { test: /[A-Z]/.test(value),     msg: 'an uppercase letter' },
      { test: /[a-z]/.test(value),     msg: 'a lowercase letter' },
      { test: /[0-9]/.test(value),     msg: 'a number' },
      { test: /[^A-Za-z0-9]/.test(value), msg: 'a special character' },
    ];
    const failed = checks.filter((c) => !c.test).map((c) => c.msg);
    return failed.length > 0
      ? `Password must include ${failed.join(', ')}.`
      : null;
  },
};

// ── Collect errors helper ─────────────────────────────────────────────────────
const collect = (checks) => {
  const errors = {};
  for (const [field, error] of Object.entries(checks)) {
    if (error) errors[field] = error;
  }
  return Object.keys(errors).length > 0 ? errors : null;
};

// ── Payment validation ────────────────────────────────────────────────────────
const PAYMENT_METHODS = ['mpesa', 'bank_transfer', 'cash', 'cheque', 'stripe'];
const PAYMENT_STATUSES = ['pending', 'completed', 'failed', 'cancelled'];

export const validatePayment = (raw) => {
  const data = {
    clientId:       raw.clientId,
    assetId:        raw.assetId       || null,
    agentId:        raw.agentId       || null,
    amount:         parseFloat(raw.amount),
    paymentMethod:  sanitise(raw.paymentMethod),
    status:         sanitise(raw.status || 'pending'),
    referenceNumber: sanitise(raw.referenceNumber || ''),
    notes:          sanitise(raw.notes || ''),
  };

  const errors = collect({
    clientId:      rules.required(raw.clientId,      'Client'),
    amount:        rules.positiveNumber(raw.amount,  'Amount'),
    paymentMethod: rules.oneOf(data.paymentMethod, PAYMENT_METHODS, 'Payment method'),
    status:        rules.oneOf(data.status,        PAYMENT_STATUSES, 'Status'),
    notes:         rules.maxLength(data.notes, 500, 'Notes'),
  });

  return { errors, data };
};

// ── Client validation ─────────────────────────────────────────────────────────
export const validateClient = (raw) => {
  const data = {
    fullName:        sanitise(raw.fullName),
    email:           sanitiseEmail(raw.email || ''),
    phone:           sanitise(raw.phone || ''),
    nationalId:      sanitise(raw.nationalId || ''),
    physicalAddress: sanitise(raw.physicalAddress || raw.address || ''),
    city:            sanitise(raw.city || ''),
    country:         sanitise(raw.country || 'Kenya'),
    notes:           sanitise(raw.notes || ''),
    status:          sanitise(raw.status || 'active'),
  };

  const errors = collect({
    fullName:   rules.required(data.fullName, 'Full name')
              || rules.minLength(data.fullName, 2, 'Full name')
              || rules.maxLength(data.fullName, 100, 'Full name'),
    email:      rules.email(data.email),
    phone:      rules.phone(data.phone),
    nationalId: rules.nationalId(data.nationalId),
    notes:      rules.maxLength(data.notes, 1000, 'Notes'),
  });

  return { errors, data };
};

// ── Asset validation ──────────────────────────────────────────────────────────
const ASSET_TYPES   = ['vehicle', 'property', 'equipment', 'other'];
const ASSET_STATUSES = ['available', 'reserved', 'sold', 'maintenance'];

export const validateAsset = (raw) => {
  const data = {
    description:   sanitise(raw.description),
    type:          sanitise(raw.type || 'other'),
    purchasePrice: parseFloat(raw.purchasePrice) || 0,
    sellingPrice:  parseFloat(raw.sellingPrice)  || 0,
    currentValue:  parseFloat(raw.currentValue  || raw.sellingPrice) || 0,
    status:        sanitise(raw.status || 'available'),
    location:      sanitise(raw.location || ''),
    make:          sanitise(raw.make || ''),
    model:         sanitise(raw.model || ''),
    year:          raw.year ? parseInt(raw.year, 10) : null,
    color:         sanitise(raw.color || ''),
    plateNumber:   sanitise(raw.plateNumber || ''),
    chassisNumber: sanitise(raw.chassisNumber || ''),
    notes:         sanitise(raw.notes || ''),
  };

  const errors = collect({
    description:   rules.required(data.description, 'Description')
                 || rules.maxLength(data.description, 500, 'Description'),
    type:          rules.oneOf(data.type, ASSET_TYPES, 'Asset type'),
    purchasePrice: rules.nonNegativeNumber(data.purchasePrice, 'Purchase price'),
    sellingPrice:  rules.nonNegativeNumber(data.sellingPrice,  'Selling price'),
    status:        rules.oneOf(data.status, ASSET_STATUSES, 'Status'),
    year: data.year && (data.year < 1900 || data.year > new Date().getFullYear() + 1)
      ? 'Year is out of valid range.'
      : null,
  });

  return { errors, data };
};

// ── Agent validation ──────────────────────────────────────────────────────────
export const validateAgent = (raw) => {
  const data = {
    fullName:       sanitise(raw.fullName),
    email:          sanitiseEmail(raw.email || ''),
    phone:          sanitise(raw.phone || ''),
    commissionRate: parseFloat(raw.commissionRate) || 5.0,
    targetAmount:   parseFloat(raw.targetAmount)   || 0,
    region:         sanitise(raw.region || ''),
    status:         sanitise(raw.status || 'active'),
  };

  const errors = collect({
    fullName: rules.required(data.fullName, 'Full name')
            || rules.maxLength(data.fullName, 100, 'Full name'),
    email: rules.required(data.email, 'Email')
         || rules.email(data.email),
    phone:          rules.phone(data.phone),
    commissionRate: rules.nonNegativeNumber(data.commissionRate, 'Commission rate'),
    targetAmount:   rules.nonNegativeNumber(data.targetAmount,   'Target amount'),
  });

  return { errors, data };
};

// ── Login validation ──────────────────────────────────────────────────────────
export const validateLogin = (raw) => {
  const data = {
    email:    sanitiseEmail(raw.email || ''),
    password: raw.password || '',            // do NOT sanitise passwords (strip chars = break auth)
  };

  const errors = collect({
    email:    rules.required(data.email, 'Email') || rules.email(data.email),
    password: rules.required(data.password, 'Password')
            || rules.minLength(data.password, 6, 'Password'),
  });

  return { errors, data };
};

// ── Registration validation ───────────────────────────────────────────────────
export const validateRegistration = (raw) => {
  const data = {
    email:           sanitiseEmail(raw.email || ''),
    password:        raw.password        || '',
    confirmPassword: raw.confirmPassword || '',
  };

  const passwordStrengthError = rules.strongPassword(data.password);

  const errors = collect({
    email:    rules.required(data.email, 'Email') || rules.email(data.email),
    password: rules.required(data.password, 'Password') || passwordStrengthError,
    confirmPassword:
      rules.required(data.confirmPassword, 'Confirm password') ||
      (data.password !== data.confirmPassword ? 'Passwords do not match.' : null),
  });

  return { errors, data };
};

// ── File upload validation ────────────────────────────────────────────────────
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export const validateFileUpload = (file) => {
  if (!file) return 'No file selected.';
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return `Invalid file type. Allowed: JPEG, PNG, WEBP, PDF.`;
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `File exceeds 5 MB limit (${(file.size / 1048576).toFixed(1)} MB uploaded).`;
  }
  return null; // valid
};

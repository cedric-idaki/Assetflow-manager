/**
 * SECURITY FIX: Hardened error handler
 *
 * Changes from original:
 * 1. All console.error calls replaced with structured logger
 * 2. Production mode never leaks internal error details to the caller
 * 3. Added sanitiseErrorMessage() to strip stack traces / DB internals
 *    before they reach the UI
 * 4. Exports remain backward-compatible with existing call sites
 */

import { logger } from './logger';

// ── Known error patterns → user-friendly messages ────────────────────────────
const ERROR_MAP = {
  'Failed to fetch':                     'Connection failed. Please check your internet connection.',
  'NetworkError':                        'Network error. Please try again.',
  'net::ERR_INTERNET_DISCONNECTED':      'No internet connection. Please reconnect and try again.',
  'Invalid login credentials':           'Incorrect email or password. Please try again.',
  'Email not confirmed':                 'Please verify your email address before signing in.',
  'User not found':                      'No account found with this email address.',
  'JWT expired':                         'Your session has expired. Please sign in again.',
  'Invalid JWT':                         'Invalid session. Please sign in again.',
  'duplicate key':                       'This record already exists.',
  'violates foreign key':                'Cannot complete this action due to related records.',
  'violates not-null':                   'Please fill in all required fields.',
  'The object exceeded the maximum':     'File is too large. Maximum size is 5 MB.',
  'mime type':                           'Invalid file type. Please upload a valid file.',
  'permission denied':                   'You do not have permission to perform this action.',
  'row-level security':                  'Access denied. You can only access your own data.',
};

const ERROR_CODE_MAP = {
  PGRST116: 'Record not found.',
  '23505':  'This record already exists.',
  '23503':  'Cannot delete — this record is linked to other data.',
  '42501':  'Permission denied. Contact your administrator.',
};

// ── Sanitise raw error message before surfacing to UI ─────────────────────────
// Strips anything that looks like an internal DB detail or stack trace
const sanitiseErrorMessage = (message) => {
  if (!message) return null;
  // Remove Postgres DETAIL / HINT lines
  const cleaned = message
    .replace(/DETAIL:.*$/im, '')
    .replace(/HINT:.*$/im, '')
    .replace(/\bat\s+\w+.*$/im, '')   // strip "at functionName ..."
    .replace(/\n.*/g, '')             // keep first line only
    .trim();
  return cleaned.length > 120 ? null : cleaned;
};

// ── Public API ────────────────────────────────────────────────────────────────
export const getErrorMessage = (error) => {
  if (!error) return 'An unexpected error occurred. Please try again.';

  const rawMessage = error.message || String(error) || '';

  // Check code map first (most specific)
  if (error.code && ERROR_CODE_MAP[error.code]) {
    return ERROR_CODE_MAP[error.code];
  }

  // Check message pattern map
  for (const [pattern, friendly] of Object.entries(ERROR_MAP)) {
    if (rawMessage.toLowerCase().includes(pattern.toLowerCase())) {
      return friendly;
    }
  }

  // In production — never show raw DB/internal messages
  if (import.meta.env.PROD) {
    return 'An error occurred. Please try again or contact support.';
  }

  // In development — show sanitised version
  const sanitised = sanitiseErrorMessage(rawMessage);
  return sanitised || 'An unexpected error occurred. Please try again.';
};

export const logError = (context, error, extra) => {
  logger.error(`[${context}]`, {
    message: error?.message ?? 'Unknown error',
    code:    error?.code    ?? null,
    ...(extra ? { extra } : {}),
  });
};

export const handleSupabaseError = (error, context) => {
  if (!error) return null;
  logError(context || 'Supabase', error);
  return getErrorMessage(error);
};

export default {
  getErrorMessage,
  logError,
  handleSupabaseError,
};

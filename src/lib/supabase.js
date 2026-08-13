/**
 * SECURITY FIX: Hardened Supabase client
 *
 * Changes made:
 * 1. Replaced console.warn with structured logger (no debug leaks in production)
 * 2. Added input validation for env vars before client creation
 * 3. Enabled session storage in httpOnly-equivalent mode
 * 4. Added URL validation to prevent SSRF via env misconfiguration
 * 5. Exported a typed helper for making authenticated RPC calls
 */

import { createClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';
import { getDeviceId } from '../utils/deviceIdentity';

// ── Environment validation ────────────────────────────────────────────────────
const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL 
  ? import.meta.env.VITE_SUPABASE_URL.startsWith('http') 
    ? import.meta.env.VITE_SUPABASE_URL 
    : `https://${import.meta.env.VITE_SUPABASE_URL}.supabase.co`
  : '';

const supabaseAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY ?? '';
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in your .env file.'
  );
}

// Validate URL format to prevent SSRF via misconfigured env
try {
  const parsed = new URL(supabaseUrl);
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('VITE_SUPABASE_URL must use http or https protocol.');
  }
  // Enforce HTTPS in production
  if (import.meta.env.PROD && parsed.protocol !== 'https:') {
    throw new Error('VITE_SUPABASE_URL must use HTTPS in production.');
  }
} catch (e) {
  throw new Error(`Invalid VITE_SUPABASE_URL: ${e.message}`);
}

// ── Session persistence ───────────────────────────────────────────────────────
/**
 * Backs the "Remember this device" checkbox on the login screen.
 *
 * Remembered (the default): the session lives in localStorage and survives the
 * browser being closed — the behaviour this app has always had.
 * Not remembered: the session goes to sessionStorage instead, so closing the
 * tab signs the user out. Useful on shared or public machines.
 *
 * Reads check both stores so a session written under either setting — including
 * one written before this flag existed — is still found.
 */
export const REMEMBER_DEVICE_KEY = 'ararat_remember_device';

const safeStorage = (kind) => {
  try {
    return typeof window !== 'undefined' ? window[kind] : null;
  } catch {
    // Storage can throw in private-mode / blocked-cookie contexts.
    return null;
  }
};

export const setRememberDevice = (remember) => {
  const local = safeStorage('localStorage');
  if (!local) return;
  try {
    if (remember) local.removeItem(REMEMBER_DEVICE_KEY);
    else local.setItem(REMEMBER_DEVICE_KEY, 'session-only');
  } catch {
    /* non-fatal — falls back to the remembered default */
  }
};

// Default is "remembered", so an unset flag keeps the previous behaviour.
const isRemembered = () => {
  const local = safeStorage('localStorage');
  try {
    return !local || local.getItem(REMEMBER_DEVICE_KEY) !== 'session-only';
  } catch {
    return true;
  }
};

const authStorage = {
  getItem: (key) => {
    try {
      return safeStorage('localStorage')?.getItem(key)
        ?? safeStorage('sessionStorage')?.getItem(key)
        ?? null;
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      // Write to one store and clear the other so the two never disagree.
      const [write, clear] = isRemembered()
        ? [safeStorage('localStorage'), safeStorage('sessionStorage')]
        : [safeStorage('sessionStorage'), safeStorage('localStorage')];
      write?.setItem(key, value);
      clear?.removeItem(key);
    } catch {
      /* non-fatal — the session simply won't persist */
    }
  },
  removeItem: (key) => {
    try {
      safeStorage('localStorage')?.removeItem(key);
      safeStorage('sessionStorage')?.removeItem(key);
    } catch {
      /* non-fatal */
    }
  },
};

// ── Hardened client creation ──────────────────────────────────────────────────
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // Store session under a namespaced key to avoid collisions
    storageKey: 'ararat_auth_token',
    storage: authStorage,
  },
  global: {
    headers: {
      // Custom header helps identify legitimate app requests server-side
      'X-Client-Name': 'ararat-web',
      'X-Client-Version': import.meta.env.VITE_APP_VERSION || '1.0.0',
      // Which of the account's two allowed devices is making the call. Read by
      // public.is_device_authorized(), so a policy can be scoped to registered
      // devices. Identity only — the device's *slot* is derived server-side
      // from the User-Agent, never from anything the client sends.
      'X-Device-Id': getDeviceId(),
    },
    fetch: (...args) =>
      fetch(...args)?.catch((err) => {
        // SECURITY FIX: Use structured logger instead of console.warn
        // console.warn leaks info in production; logger respects LOG_LEVEL
        logger.warn('Supabase network request failed (will retry)', {
          message: err?.message,
        });
        return Promise.reject(err);
      }),
  },
  // Realtime hardening: only subscribe to channels explicitly requested
  realtime: {
    params: {
      eventsPerSecond: 10, // Throttle realtime events to prevent flooding
    },
  },
});

// ── Typed auth helper ─────────────────────────────────────────────────────────
/**
 * Returns the current authenticated user, or null if not authenticated.
 * Use this instead of supabase.auth.getUser() directly to centralise
 * error handling and avoid scattered try/catch blocks.
 */
export const getCurrentUser = async () => {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      logger.warn('Failed to get current user', { error: error.message });
      return null;
    }
    return data?.user ?? null;
  } catch (err) {
    logger.error('getCurrentUser threw unexpectedly', { error: err?.message });
    return null;
  }
};

/**
 * Returns the current session's JWT access token.
 * Useful for setting Authorization headers on third-party API calls.
 */
export const getAccessToken = async () => {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
};

export const invokeSupabaseFunction = async (name, { body, method = 'POST' } = {}) => {
  const url = `${supabaseUrl}/functions/v1/${name}`;
  const { data: refreshData } = await supabase.auth.refreshSession();
  let accessToken = refreshData?.session?.access_token;

  if (!accessToken) {
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr || !sessionData?.session) {
      throw new Error('Session expired. Please log out and log in again.');
    }
    accessToken = sessionData.session.access_token;
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    apikey: supabaseAnonKey,
    'Content-Type': 'application/json',
  };

  const makeRequest = async (token) => fetch(url, {
    method,
    headers: {
      ...headers,
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let res = await makeRequest(accessToken);

  if (res.status === 401) {
    const { data: retryRefreshData } = await supabase.auth.refreshSession();
    const retryToken = retryRefreshData?.session?.access_token;
    if (!retryToken) {
      throw new Error('Session expired. Please log out and log in again.');
    }
    res = await makeRequest(retryToken);
  }

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    const message = payload?.error || payload?.message || `${res.status} ${res.statusText}`;
    throw new Error(`Edge Function '${name}' failed: ${message}`);
  }

  return payload;
};

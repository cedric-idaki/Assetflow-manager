/**
 * SECURITY FIX: Hardened AuthContext
 *
 * Changes from original:
 * 1. CLIENT-SIDE login rate limiting (5 attempts / 15 min) to slow brute-force
 * 2. Session inactivity timeout (30 min) — auto sign-out on idle
 * 3. All console.error/warn replaced with structured logger
 * 4. signIn no longer leaks role data before auth is confirmed
 * 5. updateProfile validates input before sending to Supabase
 * 6. Added signUp method with server-side duplicate prevention
 * 7. Exposes sessionExpiresAt so UI can warn users before forced logout
 * 8. Device restriction: every session is checked against the account's two
 *    allowed devices (one phone + one laptop/tablet) — see verifyDevice below
 */

import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { clearTenantCache } from '../lib/tenant';
import { logger } from '../utils/logger';
import { registerCurrentDevice } from '../services/deviceService';

const AuthContext = createContext({});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

// ── Role → dashboard path ─────────────────────────────────────────────────────
const ROLE_REDIRECT_MAP = {
  // Super admin first picks a portal (Company vs Saccos) after login.
  super_admin:         '/choose-portal',
  admin:               '/admin-dashboard',
  director:            '/role-based-dashboard',
  accountant:          '/role-based-dashboard',
  collections_officer: '/role-based-dashboard',
  collections:         '/role-based-dashboard',
  finance:             '/role-based-dashboard',
  manager:             '/role-based-dashboard',
  operations:          '/role-based-dashboard',
  hr:                  '/hr-management',
  it_support:          '/role-based-dashboard',
  staff:               '/role-based-dashboard',
  sales:               '/sales-agent-portal',
  sales_agent:         '/sales-agent-portal',
  client:              '/client-portal',
  sacco_admin:         '/sacco-dashboard',
  sacco_member:        '/sacco-member-portal',
};

export const getRoleRedirectPath = (role) =>
  ROLE_REDIRECT_MAP[role] ?? '/role-based-dashboard';

// ── Rate limiter (client-side, in-memory) ─────────────────────────────────────
// NOTE: This is a UX-layer safeguard only. Real brute-force protection MUST
// also be enforced server-side (Supabase Auth settings → rate limits).
const RATE_LIMIT_MAX      = 5;      // max attempts
const RATE_LIMIT_WINDOW   = 15 * 60 * 1000; // 15 minutes
const loginAttempts       = { count: 0, windowStart: Date.now() };

const checkRateLimit = () => {
  const now = Date.now();
  if (now - loginAttempts.windowStart > RATE_LIMIT_WINDOW) {
    loginAttempts.count       = 0;
    loginAttempts.windowStart = now;
  }
  if (loginAttempts.count >= RATE_LIMIT_MAX) {
    const waitMs      = RATE_LIMIT_WINDOW - (now - loginAttempts.windowStart);
    const waitMinutes = Math.ceil(waitMs / 60000);
    return `Too many login attempts. Please wait ${waitMinutes} minute(s) before trying again.`;
  }
  loginAttempts.count++;
  return null; // no error
};

const resetRateLimit = () => {
  loginAttempts.count = 0;
};

// ── Session inactivity timeout ────────────────────────────────────────────────
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ── Device restriction ────────────────────────────────────────────────────────
// How often an already-approved device re-announces itself. This refreshes
// last_seen_at and, more to the point, is how a session on a device an admin
// has just revoked finds out and gets kicked out.
const DEVICE_RECHECK_MS = 5 * 60 * 1000; // 5 minutes

const IDLE_DEVICE_CHECK = { status: 'idle' };

// ── Provider ──────────────────────────────────────────────────────────────────
export const AuthProvider = ({ children }) => {
  const [user,           setUser]           = useState(null);
  const [userProfile,    setUserProfile]    = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [sessionExpiresAt, setSessionExpiresAt] = useState(null);
  const [deviceCheck,    setDeviceCheck]    = useState(IDLE_DEVICE_CHECK);

   const inactivityTimer  = useRef(null);
  const currentUserIdRef = useRef(null);
  const deviceCheckAtRef = useRef(0);
  const deviceInFlightRef = useRef(null);
  const lastVerdictRef   = useRef(null);

  // ── Inactivity timer ────────────────────────────────────────────────────────
  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    inactivityTimer.current = setTimeout(() => {
      logger.info('Session timed out due to inactivity — signing out');
      signOut();
    }, INACTIVITY_TIMEOUT_MS);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, resetInactivityTimer, { passive: true }));
    return () => {
      events.forEach((e) => window.removeEventListener(e, resetInactivityTimer));
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    };
  }, [resetInactivityTimer]);

  // ── Profile loader (isolated, never called synchronously from auth callback) ─
  // Always keyed by the auth user id, and every write back into state is gated
  // on that id still being the signed-in one. A sign-out or a switch of user
  // while this request is in flight must not paint the previous user's profile
  // over the new session.
  const loadProfile = async (userId) => {
    if (!userId) return;
    setProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      // Stale response — the session moved on while we were waiting.
      if (currentUserIdRef.current !== userId) return;

      if (error) {
        logger.warn('Profile load error', { userId, error: error.message });
        // Fail closed: never leave the previous user's profile in state. A
        // null profile is handled by RoleGuard, which offers a retry.
        setUserProfile(null);
      } else {
        setUserProfile(data);
      }
    } catch (err) {
      logger.error('Profile load threw unexpectedly', { error: err?.message });
      if (currentUserIdRef.current === userId) setUserProfile(null);
    } finally {
      if (currentUserIdRef.current === userId) setProfileLoading(false);
    }
  };

  const clearProfile = () => {
    setUserProfile(null);
    setProfileLoading(false);
    clearTenantCache();
  };

  // ── Device restriction ───────────────────────────────────────────────────────
  // Announces this browser to the device registry and records the verdict. An
  // account gets one phone plus one laptop/tablet; which slot a device belongs
  // to is decided server-side from the User-Agent, so this call can only ask,
  // never assert.
  //
  // Fails OPEN: a network blip or an RPC that is not deployed yet must not lock
  // a legitimate user out of their workspace, so only an explicit "no" from the
  // server blocks a session. This is a session-layer gate — see the migration
  // header for what that does and does not buy.
  const verifyDevice = useCallback(async ({ replace = false, force = false } = {}) => {
    if (!currentUserIdRef.current) return null;

    // Sign-in and the SIGNED_IN event both land here moments apart; one answer
    // covers both.
    if (!replace && !force && Date.now() - deviceCheckAtRef.current < 30_000) {
      return lastVerdictRef.current;
    }
    if (deviceInFlightRef.current && !replace && !force) return deviceInFlightRef.current;

    const run = (async () => {
      // A background re-check must not flash the "checking" screen over a
      // session that is already approved.
      setDeviceCheck((prev) => (prev.status === 'allowed' ? prev : { status: 'checking' }));

      const result = await registerCurrentDevice({ replace })
        .catch((err) => ({ error: { message: err?.message || 'Device check failed' } }));
      deviceCheckAtRef.current = Date.now();

      if (result.error) {
        logger.warn('Device check did not complete — session allowed through', {
          error: result.error.message,
        });
        setDeviceCheck({ status: 'error', error: result.error.message });
        lastVerdictRef.current = { allowed: true, degraded: true };
        return lastVerdictRef.current;
      }

      if (result.allowed) {
        setDeviceCheck({
          status:           'allowed',
          device:           result.device,
          changesRemaining: result.changesRemaining,
        });
        lastVerdictRef.current = { allowed: true };
        return lastVerdictRef.current;
      }

      logger.warn('Device is not authorised for this account', {
        reason: result.reason, slot: result.slot,
      });
      setDeviceCheck({
        status:           'blocked',
        reason:           result.reason,
        slot:             result.slot,
        deviceType:       result.deviceType,
        occupiedBy:       result.occupiedBy,
        changesRemaining: result.changesRemaining,
      });
      lastVerdictRef.current = { allowed: false, reason: result.reason };
      return lastVerdictRef.current;
    })();

    deviceInFlightRef.current = run;
    try {
      return await run;
    } finally {
      deviceInFlightRef.current = null;
    }
  }, []);

  const resetDeviceCheck = () => {
    setDeviceCheck(IDLE_DEVICE_CHECK);
    deviceCheckAtRef.current = 0;
    lastVerdictRef.current = null;
  };

  // Re-announce an approved device periodically and whenever the tab regains
  // focus, so a device revoked from elsewhere stops working here too.
  useEffect(() => {
    if (deviceCheck.status !== 'allowed') return undefined;

    const maybeRecheck = () => {
      if (Date.now() - deviceCheckAtRef.current < DEVICE_RECHECK_MS) return;
      verifyDevice();
    };

    const timer = setInterval(maybeRecheck, DEVICE_RECHECK_MS);
    window.addEventListener('focus', maybeRecheck);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', maybeRecheck);
    };
  }, [deviceCheck.status, verifyDevice]);

  // ── Auth state listener ──────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setUser(session?.user ?? null);
        currentUserIdRef.current = session?.user?.id ?? null;
        setLoading(false);
        if (session?.user) {
          loadProfile(session.user.id);
          verifyDevice();
          setSessionExpiresAt(session.expires_at ? new Date(session.expires_at * 1000) : null);
          resetInactivityTimer();
        }
      })
      .catch(() => {
        setUser(null);
        setLoading(false);
        clearProfile();
        resetDeviceCheck();
      });

   const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const incomingId = session?.user?.id ?? null;

      // TOKEN_REFRESHED / USER_UPDATED: same user, just a new token — don't
      // update the user object so downstream effects don't re-run needlessly.
      if (
        (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') &&
        incomingId === currentUserIdRef.current
      ) {
        // Only update the expiry timestamp — nothing else changes.
        setSessionExpiresAt(session?.expires_at ? new Date(session.expires_at * 1000) : null);
        return;
      }

      // SIGNED_IN for the same user (e.g. StrictMode double-invoke) — ignore.
      if (
        event === 'SIGNED_IN' &&
        currentUserIdRef.current &&
        incomingId === currentUserIdRef.current
      ) return;

      // The authenticated user is changing (sign-out, or a different account
      // signing in on this tab). Drop the outgoing user's profile NOW rather
      // than when the new fetch lands, so nothing of theirs is ever rendered
      // inside the incoming session.
      if (incomingId !== currentUserIdRef.current) {
        clearProfile();
        resetDeviceCheck();
      }

      setUser(session?.user ?? null);
      currentUserIdRef.current = incomingId;
      setLoading(false);
      setSessionExpiresAt(session?.expires_at ? new Date(session.expires_at * 1000) : null);

      if (session?.user) {
        loadProfile(session.user.id); // fire-and-forget (intentional)
        verifyDevice();               // ditto — the gate lives in ProtectedRoute
        resetInactivityTimer();
      } else {
        clearProfile();
        resetDeviceCheck();
        if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      }
    });

    return () => subscription?.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── signIn ───────────────────────────────────────────────────────────────────
  const signIn = async (email, password) => {
    // 1. Input sanitisation
    const cleanEmail = (email ?? '').trim().toLowerCase();
    if (!cleanEmail || !password) {
      return { error: { message: 'Email and password are required.' } };
    }

    // 2. Client-side rate limit
    const rateLimitError = checkRateLimit();
    if (rateLimitError) {
      return { error: { message: rateLimitError } };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        logger.warn('Sign-in failed', { email: cleanEmail, error: error.message });
        return { data, error };
      }

      // Success — reset rate limit counter
      resetRateLimit();

      // Fetch role for redirect path
      const userId = data?.user?.id;
      let redirectPath = '/role-based-dashboard';

      if (userId) {
        try {
          const { data: profile, error: profileError } = await supabase
            .from('user_profiles')
            .select('role')
            .eq('id', userId)
            .maybeSingle();

          if (!profileError && profile?.role) {
            redirectPath = getRoleRedirectPath(profile.role);
            // Only merge into a profile that belongs to THIS user; otherwise
            // start a fresh one. Merging blindly would graft the new user's
            // role onto whatever profile happened to still be in state.
            setUserProfile((prev) =>
              prev && prev.id === userId
                ? { ...prev, role: profile.role }
                : { id: userId, role: profile.role }
            );
          }
        } catch (profileFetchError) {
          logger.warn('Role fetch error during sign-in', { error: profileFetchError?.message });
        }
      }

      resetInactivityTimer();
      currentUserIdRef.current = data?.user?.id ?? null;

      // Settle the device question while the sign-in button is still spinning.
      // ProtectedRoute renders the block screen either way — awaiting here is
      // what stops a rejected device from flashing a dashboard on the way to it.
      await verifyDevice({ force: true });

      return { data, error: null, redirectPath };
    } catch (err) {
      logger.error('signIn threw unexpectedly', { error: err?.message });
      return { error: { message: 'Network error. Please try again.' } };
    }
  };

  // ── signOut ──────────────────────────────────────────────────────────────────
  const signOut = async () => {
    try {
     const { error } = await supabase.auth.signOut();
      if (!error) {
        setUser(null);
        currentUserIdRef.current = null;
        setSessionExpiresAt(null);
        clearProfile();
        resetDeviceCheck();
        if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      }
      return { error };
    } catch (err) {
      logger.error('signOut threw unexpectedly', { error: err?.message });
      return { error: { message: 'Network error. Please try again.' } };
    }
  };

  // ── signUp ───────────────────────────────────────────────────────────────────
  const signUp = async (email, password) => {
    const cleanEmail = (email ?? '').trim().toLowerCase();
    if (!cleanEmail || !password) {
      return { error: { message: 'Email and password are required.' } };
    }
    try {
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          // Require email confirmation before account is active
          emailRedirectTo: `${window.location.origin}/login`,
        },
      });
      if (error) logger.warn('Sign-up failed', { email: cleanEmail, error: error.message });
      return { data, error };
    } catch (err) {
      logger.error('signUp threw unexpectedly', { error: err?.message });
      return { error: { message: 'Network error. Please try again.' } };
    }
  };

  // ── updateProfile ─────────────────────────────────────────────────────────────
  const updateProfile = async (updates) => {
    if (!user) return { error: { message: 'No user logged in.' } };

    // Whitelist allowed fields to prevent mass-assignment
    const ALLOWED_FIELDS = ['full_name', 'phone', 'avatar_url', 'preferences'];
    const safeUpdates = Object.fromEntries(
      Object.entries(updates).filter(([key]) => ALLOWED_FIELDS.includes(key))
    );

    if (Object.keys(safeUpdates).length === 0) {
      return { error: { message: 'No valid fields to update.' } };
    }

    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .update(safeUpdates)
        .eq('id', user.id)
        .select()
        .maybeSingle();

      if (!error) setUserProfile(data);
      return { data, error };
    } catch (err) {
      logger.error('updateProfile threw unexpectedly', { error: err?.message });
      return { error: { message: 'Network error. Please try again.' } };
    }
  };

  const value = {
    user,
    userProfile,
    loading,
    profileLoading,
    sessionExpiresAt,
    signIn,
    signOut,
    signUp,
    updateProfile,
    // Lets a guard retry a profile fetch that failed transiently, instead of
    // stranding the user on the "profile unavailable" screen. See RoleGuard.
    reloadProfile: () => loadProfile(currentUserIdRef.current),
    // Device restriction — consumed by ProtectedRoute / DeviceBlockedScreen.
    deviceCheck,
    recheckDevice: () => verifyDevice({ force: true }),
    // "This is my device now": drops whichever device holds the slot and takes
    // it over. Spends one of the user's self-service device changes.
    claimDeviceSlot: () => verifyDevice({ replace: true }),
    isAuthenticated: !!user,
    getRoleRedirectPath,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

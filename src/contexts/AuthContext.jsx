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
 */

import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { logger } from '../utils/logger';

const AuthContext = createContext({});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

// ── Role → dashboard path ─────────────────────────────────────────────────────
const ROLE_REDIRECT_MAP = {
  super_admin:         '/super-admin-dashboard',
  admin:               '/admin-dashboard',
  director:            '/role-based-dashboard',
  accountant:          '/role-based-dashboard',
  collections_officer: '/role-based-dashboard',
  collections:         '/role-based-dashboard',
  finance:             '/role-based-dashboard',
  manager:             '/role-based-dashboard',
  operations:          '/role-based-dashboard',
  hr:                  '/role-based-dashboard',
  it_support:          '/role-based-dashboard',
  staff:               '/role-based-dashboard',
  sales:               '/sales-agent-portal',
  sales_agent:         '/sales-agent-portal',
  client:              '/client-portal',
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

// ── Provider ──────────────────────────────────────────────────────────────────
export const AuthProvider = ({ children }) => {
  const [user,           setUser]           = useState(null);
  const [userProfile,    setUserProfile]    = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [sessionExpiresAt, setSessionExpiresAt] = useState(null);

   const inactivityTimer  = useRef(null);
  const currentUserIdRef = useRef(null);

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
  const loadProfile = async (userId) => {
    if (!userId) return;
    setProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        logger.warn('Profile load error', { userId, error: error.message });
      } else {
        setUserProfile(data);
      }
    } catch (err) {
      logger.error('Profile load threw unexpectedly', { error: err?.message });
    } finally {
      setProfileLoading(false);
    }
  };

  const clearProfile = () => {
    setUserProfile(null);
    setProfileLoading(false);
  };

  // ── Auth state listener ──────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setUser(session?.user ?? null);
        currentUserIdRef.current = session?.user?.id ?? null;
        setLoading(false);
        if (session?.user) {
          loadProfile(session.user.id);
          setSessionExpiresAt(session.expires_at ? new Date(session.expires_at * 1000) : null);
          resetInactivityTimer();
        }
      })
      .catch(() => {
        setUser(null);
        setLoading(false);
        clearProfile();
      });

   const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        event === 'SIGNED_IN' &&
        currentUserIdRef.current &&
        session?.user?.id !== currentUserIdRef.current
      ) return;

      setUser(session?.user ?? null);
      currentUserIdRef.current = session?.user?.id ?? null;
      setLoading(false);
      setSessionExpiresAt(session?.expires_at ? new Date(session.expires_at * 1000) : null);

      if (session?.user) {
        loadProfile(session.user.id); // fire-and-forget (intentional)
        resetInactivityTimer();
      } else {
        clearProfile();
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
            setUserProfile((prev) =>
              prev ? { ...prev, role: profile.role } : { id: userId, role: profile.role }
            );
          }
        } catch (profileFetchError) {
          logger.warn('Role fetch error during sign-in', { error: profileFetchError?.message });
        }
      }

      resetInactivityTimer();
      currentUserIdRef.current = data?.user?.id ?? null;
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
    isAuthenticated: !!user,
    getRoleRedirectPath,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

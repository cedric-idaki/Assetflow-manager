import { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';

/**
 * Ties a data provider's lifecycle to the authenticated user.
 *
 * Every dashboard provider in this app is mounted above the router (see
 * App.jsx) so its data and realtime channels survive navigation. The cost of
 * that is that they also survive a SIGN-OUT: the provider stays mounted, its
 * `hasLoaded` ref stays true, and the next user to sign in on the same tab
 * inherits the previous user's clients, assets, payments and company name
 * until something happens to trigger a refetch.
 *
 * This hook closes that hole in one place:
 *
 *   • `reset` runs whenever the authenticated user id CHANGES — including
 *     on sign-out — so the previous user's rows are cleared from React state
 *     before anything new is fetched or rendered.
 *   • `load` runs once per signed-in user, and never while signed out, which
 *     also removes the old race where providers fetched on mount before the
 *     session had been restored.
 *
 * Returns the current user id so callers can key realtime channels on it.
 *
 * @param {() => void} load  fetches this user's data (usually fetchAll)
 * @param {() => void} reset clears every piece of user-specific state
 */
export const useAuthScopedLoader = (load, reset) => {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  // Refs so a caller does not have to memoise anything for correctness: the
  // effect depends on the user id alone, never on callback identity.
  const loadRef  = useRef(load);
  const resetRef = useRef(reset);
  loadRef.current  = load;
  resetRef.current = reset;

  // `undefined` (not null) so the first pass is always treated as a change.
  const loadedForRef = useRef(undefined);

  useEffect(() => {
    if (loadedForRef.current === userId) return;
    loadedForRef.current = userId;

    resetRef.current?.();
    if (userId) loadRef.current?.();
  }, [userId]);

  return userId;
};

export default useAuthScopedLoader;

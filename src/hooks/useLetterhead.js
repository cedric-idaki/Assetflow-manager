/**
 * The signed-in user's letterhead, for screens that build a document
 * synchronously — a print button has to hand the browser a finished page on
 * the click, so the letterhead must already be here when it is pressed.
 *
 * Loads on mount, re-loads when the user changes or the branding is saved
 * (invalidateLetterhead), and starts from the cached value so a screen opened
 * after the first fetch never paints an empty header.
 *
 *   const { letterhead } = useLetterhead();          // own tenant
 *   const { letterhead } = useLetterhead(adminId);   // a named tenant
 *
 * `letterhead` is null while loading and when there is none — callers fall
 * back to whatever company record they already hold (mergeLetterhead).
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchLetterhead, onLetterheadChange, peekLetterhead } from '../lib/letterhead';

export const useLetterhead = (tenantId = null) => {
  const { user } = useAuth();
  const userId = user?.id || null;

  const [letterhead, setLetterhead] = useState(() => peekLetterhead(tenantId) ?? null);
  const [loading, setLoading] = useState(() => peekLetterhead(tenantId) === undefined);

  useEffect(() => {
    if (!userId) {
      setLetterhead(null);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const run = () => {
      setLoading(true);
      fetchLetterhead({ tenantId }).then((lh) => {
        if (cancelled) return;
        setLetterhead(lh);
        setLoading(false);
      });
    };

    run();
    const off = onLetterheadChange(run);
    return () => {
      cancelled = true;
      off();
    };
  }, [userId, tenantId]);

  return { letterhead, loading };
};

export default useLetterhead;

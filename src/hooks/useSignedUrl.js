/**
 * Resolve a stored storage URL into a signed one for use in href/src.
 *
 * The private buckets (see lib/storageUrl) can no longer be linked to directly,
 * but an <a href> or <iframe src> needs the value up front rather than behind an
 * await. This hook signs the value on mount and re-signs whenever it changes.
 *
 * Values pointing outside the private buckets resolve to themselves, so callers
 * can use this unconditionally on any URL column.
 */

import { useEffect, useState } from 'react';
import { resolveFileUrl, DEFAULT_TTL_SECONDS } from '../lib/storageUrl';

export const useSignedUrl = (value, { bucket = null, expiresIn = DEFAULT_TTL_SECONDS } = {}) => {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(!!value);

  useEffect(() => {
    let cancelled = false;

    if (!value) {
      setUrl(null);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    resolveFileUrl(value, { bucket, expiresIn })
      .then((resolved) => {
        if (!cancelled) {
          setUrl(resolved);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUrl(null);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [value, bucket, expiresIn]);

  return { url, loading };
};

export default useSignedUrl;

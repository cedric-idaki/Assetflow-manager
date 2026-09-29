/**
 * The Branding settings screen's data: read the tenant's letterhead, save it.
 *
 * Reads through get_tenant_letterhead() — the same call every document makes —
 * so the preview on the settings screen is exactly what will print.
 *
 * A save is two steps, in this order:
 *
 *   1. a new logo, if any, is uploaded under "<tenant>/logo-<time>.<ext>" — a
 *      fresh name every time, so a cached copy of the old logo can never be
 *      served in place of the new one;
 *   2. save_tenant_branding() records it with the text fields, validating
 *      everything server-side and writing the audit trail.
 *
 * If step 2 refuses, the file from step 1 is removed again; if it succeeds,
 * the file it replaced is removed. Both removals are best-effort — an orphaned
 * logo costs a few KB of storage, never a save.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getTenantAdminId } from '../lib/tenant';
import { logger } from '../utils/logger';
import { normaliseLetterhead } from '../utils/letterhead';
import {
  BRANDING_BUCKET, invalidateLetterhead, loadLogoImage, logoPublicUrl,
} from '../lib/letterhead';

/** The editable fields, as the form holds them. */
export const BRANDING_FIELDS = [
  'motto', 'phone', 'email', 'website', 'physicalAddress', 'postalAddress', 'kraPin',
];

export const emptyBrandingForm = () =>
  BRANDING_FIELDS.reduce((f, k) => ({ ...f, [k]: '' }), {});

/** The form as saved — only what the tenant typed, never the fallbacks. */
export const formFromBranding = (branding) => ({
  motto:           branding?.motto || '',
  phone:           branding?.phone || '',
  email:           branding?.email || '',
  website:         branding?.website || '',
  physicalAddress: branding?.physical_address || '',
  postalAddress:   branding?.postal_address || '',
  kraPin:          branding?.kra_pin || '',
});

/** What prints when a field is left blank: the registration record. */
export const defaultsFrom = (raw) => ({
  phone:           raw?.defaults?.phone || '',
  email:           raw?.defaults?.email || '',
  physicalAddress: raw?.defaults?.physical_address || '',
  kraPin:          raw?.defaults?.kra_pin || '',
});

const errorMessage = (err) => {
  const msg = err?.message || String(err || '');
  if (/get_tenant_letterhead|save_tenant_branding|PGRST202|schema cache/i.test(msg)) {
    return 'Branding is not switched on for this system yet. Ask your system administrator to run the latest update.';
  }
  if (/row-level security|violates|42501|permission/i.test(msg) && !/administrator/i.test(msg)) {
    return 'Only an administrator can change the business branding.';
  }
  return msg || 'Something went wrong.';
};

export const useTenantBranding = () => {
  const [raw, setRaw]         = useState(null);   // the RPC payload as returned
  const [logo, setLogo]       = useState(null);   // the stored logo, loaded
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('get_tenant_letterhead', { p_admin_id: null });
      if (rpcError) throw rpcError;
      setRaw(data || null);

      const path = data?.logo_path;
      if (path) {
        try {
          setLogo(await loadLogoImage(logoPublicUrl(path)));
        } catch (err) {
          logger.warn('Stored logo could not be loaded', { error: err?.message });
          setLogo(null);
        }
      } else {
        setLogo(null);
      }
    } catch (err) {
      setError(errorMessage(err));
      setRaw(null);
      setLogo(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * Save the form.
   *
   * @param form        the BRANDING_FIELDS values
   * @param newLogo     the output of prepareLogo(), or null to keep the logo
   * @param removeLogo  true to take the logo off every document
   */
  const save = useCallback(async ({ form, newLogo = null, removeLogo = false }) => {
    const tenantId = raw?.admin_id || await getTenantAdminId();
    if (!tenantId) throw new Error('You are not signed in.');

    let uploadedPath = null;
    if (newLogo?.blob) {
      uploadedPath = `${tenantId}/logo-${Date.now()}.${newLogo.extension || 'png'}`;
      const { error: upError } = await supabase.storage
        .from(BRANDING_BUCKET)
        .upload(uploadedPath, newLogo.blob, {
          contentType: newLogo.contentType || 'image/png',
          cacheControl: '31536000',
          upsert: false,
        });
      if (upError) throw new Error(`The logo could not be uploaded: ${errorMessage(upError)}`);
    }

    const { data, error: saveError } = await supabase.rpc('save_tenant_branding', {
      p_motto:            form.motto ?? '',
      p_phone:            form.phone ?? '',
      p_email:            form.email ?? '',
      p_website:          form.website ?? '',
      p_physical_address: form.physicalAddress ?? '',
      p_postal_address:   form.postalAddress ?? '',
      p_kra_pin:          form.kraPin ?? '',
      p_logo_path:        uploadedPath,
      p_remove_logo:      Boolean(removeLogo) && !uploadedPath,
    });

    if (saveError) {
      if (uploadedPath) {
        supabase.storage.from(BRANDING_BUCKET).remove([uploadedPath]).catch(() => {});
      }
      throw new Error(errorMessage(saveError));
    }

    const previous = data?.previous_logo_path;
    if (previous && previous !== uploadedPath) {
      supabase.storage.from(BRANDING_BUCKET).remove([previous]).then(({ error: rmError }) => {
        if (rmError) logger.warn('Replaced logo was not removed', { error: rmError.message });
      }).catch(() => {});
    }

    // Every document this session produces from here on carries the change.
    invalidateLetterhead();
    await load();
    return normaliseLetterhead(data);
  }, [raw, load]);

  return {
    raw,
    letterhead: normaliseLetterhead(raw ? { ...raw, logo } : null),
    logo,
    branding: raw?.branding || null,
    defaults: defaultsFrom(raw),
    loading,
    error,
    reload: load,
    save,
  };
};

export default useTenantBranding;

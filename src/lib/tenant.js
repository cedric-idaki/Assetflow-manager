import { supabase } from './supabase';

/**
 * Tenant resolution for the browser, mirroring public.current_admin_id() in SQL.
 *
 *   an admin / sacco_admin  → owns its tenant  → its own auth uid
 *   anyone else (staff,
 *   agent, client, member)  → user_profiles.admin_id, the admin that owns them
 *
 * Always derived from the CURRENT SESSION — never from props, localStorage or a
 * value a form supplied. A query filtered with this can only ever ask for the
 * caller's own tenant, and RLS rejects it server-side if it somehow asks for
 * another one.
 *
 * The result is cached per auth user id, because the admin dashboard resolves
 * the tenant once per fetcher and that was a profile round-trip each time. The
 * cache is keyed by user id, so signing in as somebody else cannot read the
 * previous user's tenant out of it.
 */
let cache = { userId: null, adminId: null };

export const getTenantAdminId = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    cache = { userId: null, adminId: null };
    return null;
  }

  if (cache.userId === user.id && cache.adminId) return cache.adminId;

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('admin_id')
    .eq('id', user.id)
    .maybeSingle();

  // No profile row, or a tenant owner (admin_id IS NULL): the user is their
  // own tenant. Same COALESCE the database applies.
  const adminId = profile?.admin_id || user.id;
  cache = { userId: user.id, adminId };
  return adminId;
};

/** Called on sign-out so nothing survives into the next session. */
export const clearTenantCache = () => {
  cache = { userId: null, adminId: null };
};

export default getTenantAdminId;

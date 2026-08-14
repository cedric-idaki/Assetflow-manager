/**
 * Device registry client — thin wrapper over the RPCs added in
 * supabase/migrations/20260813120000_user_device_restrictions.sql.
 *
 * The two-device rule lives in the database (a unique index on the live
 * device slot per user). Nothing here decides policy; these calls just carry
 * the question and translate the answer for the UI.
 */

import { supabase } from '../lib/supabase';
import { logger } from '../utils/logger';
import { currentDeviceDescriptor } from '../utils/deviceIdentity';

/** Shape the jsonb the RPC returns into something the components can read. */
const normalizeDevice = (d) => (d ? {
  id:          d.id,
  deviceId:    d.device_id,
  slot:        d.device_slot,
  deviceType:  d.device_type,
  deviceName:  d.device_name,
  firstSeenAt: d.first_seen_at,
  lastSeenAt:  d.last_seen_at,
  revokedAt:   d.revoked_at,
} : null);

const normalizeResult = (payload) => ({
  allowed:           payload?.allowed === true,
  status:            payload?.status ?? null,
  reason:            payload?.reason ?? null,
  slot:              payload?.slot ?? payload?.device?.device_slot ?? null,
  deviceType:        payload?.device_type ?? payload?.device?.device_type ?? null,
  changesRemaining:  payload?.changes_remaining ?? null,
  device:            normalizeDevice(payload?.device),
  occupiedBy:        normalizeDevice(payload?.occupied_by),
});

/**
 * Announce this device and ask whether it may be used.
 *
 * @param {{ replace?: boolean }} [options] replace: revoke whichever device
 *        currently holds this device's slot and take it over. Costs one of the
 *        user's self-service device changes.
 * @returns {Promise<{ allowed, reason, slot, occupiedBy, changesRemaining, error }>}
 */
export const registerCurrentDevice = async ({ replace = false } = {}) => {
  try {
    const { deviceId, deviceType, deviceName } = currentDeviceDescriptor();

    const { data, error } = await supabase.rpc('register_current_device', {
      p_device_id:    deviceId,
      p_device_label: deviceName,
      p_client_hint:  deviceType,
      p_replace:      replace,
    });

    if (error) {
      logger.warn('Device registration failed', { error: error.message, replace });
      return { ...normalizeResult(null), error };
    }

    return { ...normalizeResult(data), error: null };
  } catch (err) {
    // This sits on the sign-in path: it must always resolve to a verdict the
    // caller can act on, never reject. AuthContext treats an error as "allow".
    logger.error('Device registration threw unexpectedly', { error: err?.message });
    return { ...normalizeResult(null), error: { message: err?.message || 'Device check failed' } };
  }
};

/**
 * Devices for one user — defaults to the caller. RLS decides what comes back:
 * yourself, staff you own, or everything for super_admin / director.
 */
export const listDevices = async (userId) => {
  let query = supabase
    .from('user_devices')
    .select('id, user_id, device_id, device_slot, device_type, device_name, first_seen_at, last_seen_at, revoked_at, revoked_reason')
    .order('device_slot', { ascending: true })
    .order('last_seen_at', { ascending: false });

  if (userId) query = query.eq('user_id', userId);

  const { data, error } = await query;
  if (error) {
    logger.warn('Could not load devices', { error: error.message });
    return { devices: [], error };
  }
  return { devices: data ?? [], error: null };
};

/**
 * Every device the caller has authority over, with its owner attached — the
 * administrator's view. Same RLS policy, just a wider net and a join.
 */
export const listManagedDevices = async ({ includeRevoked = false } = {}) => {
  let query = supabase
    .from('user_devices')
    .select(`
      id, user_id, device_id, device_slot, device_type, device_name,
      first_seen_at, last_seen_at, revoked_at, revoked_reason,
      user:user_profiles!user_devices_user_id_fkey ( id, full_name, email, role )
    `)
    .order('last_seen_at', { ascending: false });

  if (!includeRevoked) query = query.is('revoked_at', null);

  const { data, error } = await query;
  if (error) {
    logger.warn('Could not load managed devices', { error: error.message });
    return { devices: [], error };
  }
  return { devices: data ?? [], error: null };
};

/**
 * Sign a device out of the account for good. Allowed for the device's owner
 * (spends one device change) and for the tenant admin / super_admin (free).
 */
export const revokeDevice = async (deviceRowId) => {
  try {
    const { data, error } = await supabase.rpc('revoke_user_device', { p_id: deviceRowId });
    if (error) {
      logger.warn('Device revoke failed', { error: error.message });
      return { revoked: false, reason: null, error };
    }
    return {
      revoked:          data?.revoked === true,
      reason:           data?.reason ?? null,
      changesRemaining: data?.changes_remaining ?? null,
      error:            null,
    };
  } catch (err) {
    logger.error('Device revoke threw unexpectedly', { error: err?.message });
    return { revoked: false, reason: null, error: { message: err?.message || 'Could not remove the device' } };
  }
};

/** How many self-service device changes the user has left in the rolling window. */
export const getChangesRemaining = async (userId) => {
  const { data, error } = await supabase.rpc('device_changes_remaining', {
    p_user_id: userId ?? null,
  });
  if (error) {
    logger.warn('Could not read device change quota', { error: error.message });
    return { changesRemaining: null, error };
  }
  return { changesRemaining: typeof data === 'number' ? data : null, error: null };
};

export default {
  registerCurrentDevice,
  listDevices,
  listManagedDevices,
  revokeDevice,
  getChangesRemaining,
};

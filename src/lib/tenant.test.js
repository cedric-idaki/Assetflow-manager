import { describe, it, expect, vi, beforeEach } from 'vitest';

// The tenant resolver only ever talks to auth.getUser() and user_profiles.
const getUser = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: (...args) => getUser(...args) },
    from: (...args) => from(...args),
  },
}));

const { getTenantAdminId, clearTenantCache } = await import('./tenant');

const ADMIN_A = '11111111-1111-4111-8111-111111111111';
const STAFF_A = '22222222-2222-4222-8222-222222222222';
const ADMIN_B = '33333333-3333-4333-8333-333333333333';

const signedInAs = (id) => getUser.mockResolvedValue({ data: { user: { id } } });
const profileSays = (adminId) => maybeSingle.mockResolvedValue({ data: { admin_id: adminId } });

beforeEach(() => {
  clearTenantCache();
  getUser.mockReset();
  maybeSingle.mockReset();
  eq.mockClear();
  select.mockClear();
  from.mockClear();
});

describe('getTenantAdminId', () => {
  it('gives a tenant owner their own id — an admin has no admin_id above them', async () => {
    signedInAs(ADMIN_A);
    profileSays(null);
    expect(await getTenantAdminId()).toBe(ADMIN_A);
  });

  it("gives a staff member their admin's id, not their own", async () => {
    // This is the whole point: staff query their employer's rows, never a set
    // of rows keyed to themselves, and never anybody else's tenant.
    signedInAs(STAFF_A);
    profileSays(ADMIN_A);
    expect(await getTenantAdminId()).toBe(ADMIN_A);
  });

  it('falls back to the auth id when there is no profile row yet', async () => {
    signedInAs(ADMIN_A);
    maybeSingle.mockResolvedValue({ data: null });
    expect(await getTenantAdminId()).toBe(ADMIN_A);
  });

  it('returns null when nobody is signed in, so callers cannot query blind', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await getTenantAdminId()).toBeNull();
  });

  it('never serves one user the tenant it cached for another', async () => {
    signedInAs(STAFF_A);
    profileSays(ADMIN_A);
    expect(await getTenantAdminId()).toBe(ADMIN_A);

    // Same tab, different account. The cache is keyed by auth user id, so this
    // must re-resolve rather than hand back tenant A.
    signedInAs(ADMIN_B);
    profileSays(null);
    expect(await getTenantAdminId()).toBe(ADMIN_B);
  });

  it('drops the cached tenant on sign-out', async () => {
    signedInAs(ADMIN_A);
    profileSays(null);
    await getTenantAdminId();

    getUser.mockResolvedValue({ data: { user: null } });
    expect(await getTenantAdminId()).toBeNull();

    // And a fresh sign-in re-reads the profile instead of reusing anything.
    signedInAs(ADMIN_B);
    profileSays(null);
    expect(await getTenantAdminId()).toBe(ADMIN_B);
  });

  it('reuses the cached tenant within one session instead of re-reading the profile', async () => {
    signedInAs(STAFF_A);
    profileSays(ADMIN_A);
    await getTenantAdminId();
    await getTenantAdminId();
    await getTenantAdminId();
    expect(from).toHaveBeenCalledTimes(1);
  });
});

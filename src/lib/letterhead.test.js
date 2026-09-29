import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const getSession = vi.fn();

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...args) => rpc(...args),
    auth: { getSession: (...args) => getSession(...args) },
    storage: {
      from: () => ({
        getPublicUrl: (path) => ({ data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/tenant-branding/${path}` } }),
      }),
    },
  },
}));

const {
  fetchLetterhead, peekLetterhead, currentLetterhead, invalidateLetterhead,
  clearLetterheadCache, onLetterheadChange, logoPublicUrl,
} = await import('./letterhead');

const signedInAs = (id) => getSession.mockResolvedValue({ data: { session: id ? { user: { id } } : null } });
const row = (over = {}) => ({ admin_id: 'tenant-a', name: 'Acme Ltd', motto: 'Built right', ...over });

beforeEach(() => {
  rpc.mockReset();
  getSession.mockReset();
  clearLetterheadCache();
  signedInAs('user-1');
});

describe('fetchLetterhead', () => {
  it('asks for the caller\'s own tenant and normalises the answer', async () => {
    rpc.mockResolvedValue({ data: row(), error: null });
    const lh = await fetchLetterhead();
    expect(rpc).toHaveBeenCalledWith('get_tenant_letterhead', { p_admin_id: null });
    expect(lh).toMatchObject({ tenantId: 'tenant-a', name: 'Acme Ltd', motto: 'Built right' });
  });

  it('fetches once and serves the cache after that — including by tenant id', async () => {
    rpc.mockResolvedValue({ data: row(), error: null });
    await fetchLetterhead();
    await fetchLetterhead();
    await fetchLetterhead({ tenantId: 'tenant-a' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('never rejects — a failure is "no letterhead", and is retried later', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'PGRST202 function not found' } });
    await expect(fetchLetterhead()).resolves.toBeNull();
    rpc.mockRejectedValue(new Error('offline'));
    await expect(fetchLetterhead({ tenantId: 'x' })).resolves.toBeNull();
  });

  it('returns null without a session and asks nothing', async () => {
    signedInAs(null);
    await expect(fetchLetterhead()).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('never serves one user\'s letterhead to the next user to sign in', async () => {
    rpc.mockResolvedValueOnce({ data: row({ name: 'First Co' }), error: null });
    expect((await fetchLetterhead()).name).toBe('First Co');

    signedInAs('user-2');
    rpc.mockResolvedValueOnce({ data: row({ admin_id: 'tenant-b', name: 'Second Co' }), error: null });
    expect((await fetchLetterhead()).name).toBe('Second Co');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('prints without the logo when the image cannot be loaded, keeping everything else', async () => {
    rpc.mockResolvedValue({ data: row({ logo_path: 'tenant-a/logo-1.png' }), error: null });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    const lh = await fetchLetterhead();
    expect(lh.name).toBe('Acme Ltd');
    expect(lh.logo).toBeNull();
    fetchSpy.mockRestore();
  });
});

describe('the synchronous cache', () => {
  it('is empty before the first fetch and full after it', async () => {
    expect(peekLetterhead()).toBeUndefined();
    expect(currentLetterhead()).toBeNull();
    rpc.mockResolvedValue({ data: row(), error: null });
    await fetchLetterhead();
    expect(currentLetterhead().name).toBe('Acme Ltd');
  });

  it('is dropped on save, and every subscriber is told to refetch', async () => {
    rpc.mockResolvedValue({ data: row(), error: null });
    await fetchLetterhead();
    const listener = vi.fn();
    const off = onLetterheadChange(listener);

    invalidateLetterhead();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(currentLetterhead()).toBeNull();

    rpc.mockResolvedValue({ data: row({ motto: 'New motto' }), error: null });
    expect((await fetchLetterhead()).motto).toBe('New motto');
    off();
    invalidateLetterhead();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('logoPublicUrl', () => {
  it('builds the public URL from the stored path', () => {
    expect(logoPublicUrl('tenant-a/logo-1.png'))
      .toBe('https://project.supabase.co/storage/v1/object/public/tenant-branding/tenant-a/logo-1.png');
    expect(logoPublicUrl(null)).toBeNull();
  });
});

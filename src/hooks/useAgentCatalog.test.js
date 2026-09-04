import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Records every table the hook touches, so "did it query at all?" is testable
// rather than inferred from the returned state.
const touched = [];
const channels = [];

const builder = (rows) => {
  const b = {};
  for (const m of ['select', 'in', 'eq', 'order']) b[m] = () => b;
  b.limit = () => Promise.resolve({ data: rows, error: null });
  return b;
};

const ASSETS = [{ id: 'a1', description: 'Toyota Hilux', asset_status: 'available', images: [] }];
const LINKS  = [{ id: 'l1', asset_id: 'a1', token: 't1', is_active: true, view_count: 3, enquiry_count: 1 }];

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table) => {
      touched.push(table);
      return builder(table === 'assets' ? ASSETS : LINKS);
    },
    channel: (name) => {
      channels.push(name);
      const ch = { on: () => ch, subscribe: () => ch };
      return ch;
    },
    removeChannel: () => {},
  },
}));

const { useAgentCatalog, firstImage } = await import('./useAgentCatalog');

const AGENT = { id: 'agent-1', full_name: 'Jane Doe' };

beforeEach(() => {
  touched.length = 0;
  channels.length = 0;
});

describe('useAgentCatalog — who gets a catalogue', () => {
  it('loads the catalogue for an agent created by a company admin', async () => {
    const { result } = renderHook(() => useAgentCatalog(AGENT, true));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(touched).toContain('assets');
    expect(touched).toContain('asset_share_links');
    expect(result.current.assets).toHaveLength(1);
    expect(result.current.stats.totalViews).toBe(3);
    expect(result.current.stats.totalEnquiries).toBe(1);
  });

  it('stays completely inert for a platform or sacco agent', async () => {
    // The portal hides the tab, but the hook must not fetch either — a
    // super-admin-created agent's current_admin_id() resolves to the SUPER
    // ADMIN's tenant, so a query here would load stock they may never share.
    const { result } = renderHook(() => useAgentCatalog(AGENT, false));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(touched).toEqual([]);
    expect(channels).toEqual([]);
    expect(result.current.assets).toEqual([]);
    expect(result.current.links).toEqual([]);
  });

  it('defaults to off when the caller does not say which kind of agent it is', async () => {
    // Fail closed: a new call site that forgets the flag gets no catalogue
    // rather than someone else's.
    const { result } = renderHook(() => useAgentCatalog(AGENT));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(touched).toEqual([]);
  });

  it('does not query before the agent profile has resolved', async () => {
    const { result } = renderHook(() => useAgentCatalog(null, true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(touched).toEqual([]);
  });

  it('opens a realtime channel only for a company agent', async () => {
    const { result } = renderHook(() => useAgentCatalog(AGENT, true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Matched by prefix, not equality: the name carries a module-level counter
    // suffix so a remount never reuses a still-subscribed channel name. The
    // counter is shared across every renderHook in this file, so its value is
    // not meaningful here — what matters is that exactly one channel opened and
    // it is scoped to this agent.
    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatch(/^agent_share_links_agent-1_\d+$/);
  });
});

describe('firstImage', () => {
  it('accepts both shapes the assets rows use', () => {
    expect(firstImage({ images: ['https://x.test/a.jpg'] })).toBe('https://x.test/a.jpg');
    expect(firstImage({ images: [{ url: 'https://x.test/b.jpg' }] })).toBe('https://x.test/b.jpg');
    expect(firstImage({ images: [{ src: 'https://x.test/c.jpg' }] })).toBe('https://x.test/c.jpg');
  });

  it('refuses anything that is not http(s), so a row cannot inject a javascript: src', () => {
    expect(firstImage({ images: ['javascript:alert(1)'] })).toBeNull();
    expect(firstImage({ images: ['data:image/png;base64,AAAA'] })).toBeNull();
    expect(firstImage({ images: [] })).toBeNull();
    expect(firstImage({})).toBeNull();
  });
});

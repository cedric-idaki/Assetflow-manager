import React, { StrictMode } from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Regression test for the crash that blanked the CRM tab:
 *
 *   cannot add `postgres_changes` callbacks for realtime:crm_oversight_… after
 *   `subscribe()`
 *
 * supabase.channel(name) RETURNS AN EXISTING channel when the name is already
 * in use, and calling .on() on a channel that has already subscribed throws.
 * Both CRM hooks used to suffix the name with Date.now(), which is NOT unique
 * across React StrictMode's double mount — the two runs regularly land inside
 * the same millisecond, so the second reused the first's subscribed channel and
 * the error boundary swallowed the whole page.
 *
 * The mock below reproduces that Supabase behaviour exactly: same name ⇒ same
 * object, and .on() after subscribe() throws. If the names ever collide again
 * these tests fail instead of the UI.
 */

const channelNames = [];
const channelsByName = new Map();

const makeChannel = (name) => {
  const ch = {
    name,
    subscribed: false,
    on(...args) {
      if (this.subscribed) {
        throw new Error(
          `cannot add \`postgres_changes\` callbacks for realtime:${name} after \`subscribe()\`.`,
        );
      }
      return this;
    },
    subscribe() { this.subscribed = true; return this; },
  };
  return ch;
};

const builder = () => {
  const b = {
    select: () => b, eq: () => b, in: () => b, gte: () => b, lte: () => b,
    order: () => b, limit: () => b,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return b;
};

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => builder(),
    channel: (name) => {
      channelNames.push(name);
      // The behaviour that made the bug possible: a name already in use hands
      // back the SAME channel rather than a fresh one.
      if (!channelsByName.has(name)) channelsByName.set(name, makeChannel(name));
      return channelsByName.get(name);
    },
    removeChannel: () => {},
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}));

vi.mock('../lib/tenant', () => ({
  getTenantAdminId: () => Promise.resolve('admin-1'),
  default: () => Promise.resolve('admin-1'),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    userProfile: { id: 'user-1', role: 'admin', admin_id: null },
  }),
}));

const { useCrmOversight }   = await import('./useCrmOversight');
const { useCrmInteractions } = await import('./useCrmInteractions');

const OversightProbe = () => { useCrmOversight(); return <div>oversight</div>; };
const InteractionsProbe = () => {
  useCrmInteractions({ id: 'agent-1', full_name: 'Jane' });
  return <div>interactions</div>;
};

beforeEach(() => {
  channelNames.length = 0;
  channelsByName.clear();
  // THE POINT OF THIS TEST. The bug only bites when both StrictMode passes land
  // inside the same millisecond, which happens in a real browser but not
  // reliably in a slow test runner — leaving the suite green against broken
  // code. Freezing the clock makes the collision deterministic: with a
  // Date.now() suffix both mounts ask for the SAME channel name, get back the
  // first (already joining) channel, and .on() throws exactly as it did in the
  // CRM tab. With a counter the names differ and nothing collides.
  vi.spyOn(Date, 'now').mockReturnValue(1787299315228);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('CRM realtime channel naming', () => {
  it('survives a StrictMode double mount without reusing a subscribed channel', async () => {
    // StrictMode mounts, unmounts and remounts the effect. With Date.now() both
    // passes produced the same name and this render threw.
    expect(() => render(
      <StrictMode><OversightProbe /></StrictMode>,
    )).not.toThrow();

    await waitFor(() => expect(channelNames.length).toBeGreaterThan(0));
    expect(new Set(channelNames).size).toBe(channelNames.length);
  });

  it('gives the interactions hook a unique channel per mount too', async () => {
    expect(() => render(
      <StrictMode><InteractionsProbe /></StrictMode>,
    )).not.toThrow();

    await waitFor(() => expect(channelNames.length).toBeGreaterThan(0));
    expect(new Set(channelNames).size).toBe(channelNames.length);
  });

  it('never hands the same name to two mounts of the same hook', async () => {
    render(<OversightProbe />);
    render(<OversightProbe />);
    await waitFor(() => expect(channelNames.length).toBeGreaterThanOrEqual(2));
    expect(new Set(channelNames).size).toBe(channelNames.length);
  });

  // Guards the mock itself: if this stopped throwing, the tests above would
  // pass for the wrong reason.
  it('the mock really does reject .on() after subscribe()', () => {
    const ch = makeChannel('x');
    ch.subscribe();
    expect(() => ch.on()).toThrow(/after `subscribe\(\)`/);
  });
});

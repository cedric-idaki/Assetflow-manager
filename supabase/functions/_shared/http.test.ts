// @vitest-environment node
//
// The node environment is required: http.ts uses WebCrypto (hashedIp) and
// jsdom's `crypto` has no `subtle`. Same reason as crypto.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// SUPABASE_URL and the service-role key are read once at module load (the same
// pattern as _shared/auth.ts, and correct under Deno where env is present
// before the first import), so they must be in place BEFORE the dynamic import
// below or the limiter never builds a client and every test silently measures
// the in-process fallback instead of the database path.
const env: Record<string, string | undefined> = {
  SUPABASE_URL: 'https://project.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-tests',
};
(globalThis as unknown as { Deno: unknown }).Deno = {
  env: { get: (k: string) => env[k] },
};

// http.ts pulls supabase-js from a URL that vitest cannot fetch, and these
// tests deliberately exercise the DB-unavailable path anyway. A factory mock is
// intercepted before resolution, so the URL is never hit.
const rpc = vi.fn();
vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({
  createClient: () => ({ rpc }),
}));

const {
  ApiError,
  callerIdentity,
  consumeRateLimit,
  corsFor,
  hashedIp,
  isAllowedOrigin,
  negotiateVersion,
  openRequest,
  resetHttpCache,
} = await import('./http.ts');

const req = (
  url = 'https://api.test/functions/v1/demo',
  init: RequestInit = {},
): Request => new Request(url, { method: 'POST', ...init });

beforeEach(() => {
  for (const k of Object.keys(env)) delete env[k];
  env.SUPABASE_URL = 'https://project.supabase.test';
  env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-tests';
  env.ALLOWED_ORIGINS = 'https://app.ararat.test, https://*.vercel.app';
  rpc.mockReset();
  resetHttpCache();
});

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

describe('origin allowlist', () => {
  it('accepts an exactly listed origin', () => {
    expect(isAllowedOrigin('https://app.ararat.test')).toBe(true);
  });

  it('rejects an origin that is not listed', () => {
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
  });

  it('rejects a look-alike that merely starts with a trusted origin', () => {
    expect(isAllowedOrigin('https://app.ararat.test.evil.example')).toBe(false);
  });

  it('rejects the same host over a different scheme', () => {
    expect(isAllowedOrigin('http://app.ararat.test')).toBe(false);
  });

  it('matches one label through a wildcard', () => {
    expect(isAllowedOrigin('https://ararat-git-abc.vercel.app')).toBe(true);
  });

  it('does not let a wildcard cross a dot', () => {
    // The classic bypass: hang the trusted suffix off a domain you control.
    expect(isAllowedOrigin('https://a.b.vercel.app.evil.example')).toBe(false);
    expect(isAllowedOrigin('https://evil.com.vercel.app.co')).toBe(false);
  });

  it('never treats "*" as a value that matches everything', () => {
    env.ALLOWED_ORIGINS = '*';
    resetHttpCache();
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
  });

  it('folds in PORTAL_URL and ESIGN_ALLOWED_PORTALS', () => {
    env.ALLOWED_ORIGINS = '';
    env.PORTAL_URL = 'https://portal.ararat.test';
    env.ESIGN_ALLOWED_PORTALS = 'https://sign.partner.test';
    resetHttpCache();
    expect(isAllowedOrigin('https://portal.ararat.test')).toBe(true);
    expect(isAllowedOrigin('https://sign.partner.test')).toBe(true);
  });

  it('tolerates a trailing slash in configuration', () => {
    env.ALLOWED_ORIGINS = 'https://app.ararat.test/';
    resetHttpCache();
    expect(isAllowedOrigin('https://app.ararat.test')).toBe(true);
  });

  it('allows localhost only when nothing is configured', () => {
    expect(isAllowedOrigin('http://localhost:4028')).toBe(false);
    env.ALLOWED_ORIGINS = '';
    resetHttpCache();
    expect(isAllowedOrigin('http://localhost:4028')).toBe(true);
  });
});

describe('CORS headers', () => {
  it('never emits a wildcard Access-Control-Allow-Origin', () => {
    const { headers } = corsFor(req('https://api.test/x', {
      headers: { Origin: 'https://app.ararat.test' },
    }));
    expect(headers['Access-Control-Allow-Origin']).toBe('https://app.ararat.test');
    expect(Object.values(headers)).not.toContain('*');
  });

  it('omits the allow header entirely for an untrusted origin', () => {
    const decision = corsFor(req('https://api.test/x', {
      headers: { Origin: 'https://evil.example' },
    }));
    expect(decision.rejected).toBe(true);
    expect(decision.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('does not echo an untrusted origin back in any header', () => {
    const { headers } = corsFor(req('https://api.test/x', {
      headers: { Origin: 'https://evil.example' },
    }));
    expect(JSON.stringify(headers)).not.toContain('evil.example');
  });

  it('passes a request with no Origin through untouched', () => {
    // Safaricom's M-Pesa callback, a dealer server on x-api-key, pg_cron.
    // CORS is a browser mechanism; these are not browsers and must not break.
    const decision = corsFor(req());
    expect(decision.rejected).toBe(false);
    expect(decision.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('varies on Origin so a shared cache cannot cross origins', () => {
    expect(corsFor(req()).headers['Vary']).toBe('Origin');
  });
});

describe('preflight', () => {
  it('answers a trusted preflight with 204 and no body', async () => {
    const api = await openRequest(
      req('https://api.test/x', {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.ararat.test' },
      }),
      { fn: 'demo' },
    );
    expect(api.halt?.status).toBe(204);
    expect(api.halt?.headers.get('Access-Control-Allow-Origin')).toBe('https://app.ararat.test');
  });

  it('refuses a preflight from an untrusted origin', async () => {
    const api = await openRequest(
      req('https://api.test/x', {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.example' },
      }),
      { fn: 'demo' },
    );
    expect(api.halt?.status).toBe(403);
  });

  it('stops an untrusted origin before the handler runs', async () => {
    const api = await openRequest(
      req('https://api.test/x', { headers: { Origin: 'https://evil.example' } }),
      { fn: 'demo' },
    );
    expect(api.halt).not.toBeNull();
    expect(api.halt?.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// VERSIONING
// ---------------------------------------------------------------------------

describe('version negotiation', () => {
  const supported = ['2026-08-21', '2026-11-01'];

  it('gives a client that sends nothing the OLDEST version', () => {
    // The whole contract: every client already deployed sends no header, so
    // every client already deployed keeps the shape it was written against.
    expect(negotiateVersion(req(), supported)).toEqual({ ok: true, version: '2026-08-21' });
  });

  it('honours an explicitly requested newer version', () => {
    const r = req('https://api.test/x', { headers: { 'X-Api-Version': '2026-11-01' } });
    expect(negotiateVersion(r, supported)).toEqual({ ok: true, version: '2026-11-01' });
  });

  it('accepts the query fallback for callers that cannot set headers', () => {
    const r = req('https://api.test/x?api_version=2026-11-01');
    expect(negotiateVersion(r, supported)).toEqual({ ok: true, version: '2026-11-01' });
  });

  it('rejects an unknown version instead of silently downgrading', () => {
    const r = req('https://api.test/x', { headers: { 'X-Api-Version': '2099-01-01' } });
    const result = negotiateVersion(r, supported);
    expect(result.ok).toBe(false);
    expect((result as { status: number }).status).toBe(400);
  });

  it('echoes the negotiated version on the response', async () => {
    const api = await openRequest(req(), { fn: 'demo', versions: supported });
    expect(api.json({}).headers.get('X-Api-Version')).toBe('2026-08-21');
  });

  it('halts a request asking for a version we cannot produce', async () => {
    const api = await openRequest(
      req('https://api.test/x', { headers: { 'X-Api-Version': 'banana' } }),
      { fn: 'demo', versions: supported },
    );
    expect(api.halt?.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// RATE LIMITING
// ---------------------------------------------------------------------------

describe('rate limiting', () => {
  // Mirrors the RETURNS TABLE of public.api_rate_limit_hit — `hit_count`, not
  // `hits`; see the note on the rename in the migration.
  const ok = (hits: number, limit: number) => ({
    data: [{
      allowed: hits <= limit,
      hit_count: hits,
      limit_value: limit,
      reset_at: new Date(Date.now() + 60_000).toISOString(),
      retry_after: 60,
    }],
    error: null,
  });

  it('passes a request inside the budget', async () => {
    rpc.mockResolvedValue(ok(1, 5));
    expect((await consumeRateLimit('demo:send:u1', 5, 60)).allowed).toBe(true);
  });

  it('blocks once the budget is spent', async () => {
    rpc.mockResolvedValue(ok(6, 5));
    const verdict = await consumeRateLimit('demo:send:u1', 5, 60);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfter).toBeGreaterThan(0);
  });

  it('returns a 429 carrying Retry-After', async () => {
    rpc.mockResolvedValue(ok(6, 5));
    const api = await openRequest(req(), { fn: 'demo' });
    const res = await api.enforceLimit({
      action: 'send', identity: 'u1', limit: 5, windowSeconds: 60,
    });
    expect(res?.status).toBe(429);
    expect(res?.headers.get('Retry-After')).toBe('60');
    expect(res?.headers.get('X-RateLimit-Limit')).toBe('5');
  });

  it('returns null — meaning proceed — when inside the budget', async () => {
    rpc.mockResolvedValue(ok(1, 5));
    const api = await openRequest(req(), { fn: 'demo' });
    expect(await api.enforceLimit({
      action: 'send', identity: 'u1', limit: 5, windowSeconds: 60,
    })).toBeNull();
  });

  it('charges separate identities separately', async () => {
    rpc.mockResolvedValue(ok(1, 5));
    const api = await openRequest(req(), { fn: 'demo' });
    await api.enforceLimit({ action: 'send', identity: 'u1', limit: 5, windowSeconds: 60 });
    await api.enforceLimit({ action: 'send', identity: 'u2', limit: 5, windowSeconds: 60 });
    expect(rpc.mock.calls[0][1].p_bucket).toBe('demo:send:u1');
    expect(rpc.mock.calls[1][1].p_bucket).toBe('demo:send:u2');
  });

  it('exempts internal service traffic', async () => {
    // A nightly reminder batch calls send-email once per recipient with the
    // service-role key. Metering that against a per-caller budget would throttle
    // the platform's own scheduled work.
    const api = await openRequest(req(), { fn: 'demo' });
    expect(callerIdentity({ kind: 'service' })).toBeNull();
    expect(await api.enforceLimit({
      action: 'send', identity: null, limit: 1, windowSeconds: 60,
    })).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('identifies an end user by user id, not by address', () => {
    expect(callerIdentity({ kind: 'user', userId: 'abc-123' })).toBe('user:abc-123');
  });

  it('pools an unidentified caller rather than letting it through unlimited', async () => {
    rpc.mockResolvedValue(ok(1, 5));
    const api = await openRequest(req(), { fn: 'demo' });
    await api.enforceLimit({ action: 'send', identity: '', limit: 5, windowSeconds: 60 });
    expect(rpc.mock.calls[0][1].p_bucket).toBe('demo:send:unidentified');
  });

  it('still limits, in-process, when the database call fails', async () => {
    // Neither fail-open (abuse endpoints wide open during an incident) nor
    // fail-closed (a DB blip stops payments) is acceptable, so a weaker
    // per-isolate counter takes over.
    rpc.mockResolvedValue({ data: null, error: new Error('connection refused') });
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consumeRateLimit('demo:fb:u1', 3, 60));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3].degraded).toBe(true);
  });

  it('falls back rather than throwing when the RPC rejects outright', async () => {
    rpc.mockRejectedValue(new Error('boom'));
    const verdict = await consumeRateLimit('demo:throw:u1', 2, 60);
    expect(verdict.degraded).toBe(true);
    expect(verdict.allowed).toBe(true);
  });
});

describe('hashedIp', () => {
  it('never returns the address itself', async () => {
    const r = req('https://api.test/x', { headers: { 'x-forwarded-for': '41.90.1.2' } });
    const hash = await hashedIp(r, 'demo');
    expect(hash).not.toContain('41.90');
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is stable for one address and salt', async () => {
    const r = () => req('https://api.test/x', { headers: { 'x-forwarded-for': '41.90.1.2' } });
    expect(await hashedIp(r(), 'demo')).toBe(await hashedIp(r(), 'demo'));
  });

  it('gives different endpoints different hashes for one visitor', async () => {
    const r = () => req('https://api.test/x', { headers: { 'x-forwarded-for': '41.90.1.2' } });
    expect(await hashedIp(r(), 'listing')).not.toBe(await hashedIp(r(), 'esign'));
  });

  it('takes the client address from the front of x-forwarded-for', async () => {
    const client = req('https://api.test/x', { headers: { 'x-forwarded-for': '41.90.1.2' } });
    const proxied = req('https://api.test/x', {
      headers: { 'x-forwarded-for': '41.90.1.2, 10.0.0.1, 10.0.0.2' },
    });
    expect(await hashedIp(proxied, 'demo')).toBe(await hashedIp(client, 'demo'));
  });
});

// ---------------------------------------------------------------------------
// ERROR HIDING
// ---------------------------------------------------------------------------

describe('fail()', () => {
  const body = async (res: Response) => await res.json();

  it('replaces an internal error with a generic message', async () => {
    const api = await openRequest(req(), { fn: 'demo' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = api.fail(new Error('relation "user_profiles" does not exist'));
    const payload = await body(res);

    expect(res.status).toBe(500);
    expect(payload.error).not.toContain('user_profiles');
    expect(payload.code).toBe('internal_error');
  });

  it('never ships a stack trace', async () => {
    const api = await openRequest(req(), { fn: 'demo' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('kaboom');
    err.stack = 'Error: kaboom\n    at /home/deno/functions/demo/index.ts:42:7';
    const text = await api.fail(err).text();

    expect(text).not.toContain('index.ts');
    expect(text).not.toContain('kaboom');
    expect(text).not.toContain('stack');
  });

  it('logs the real detail server-side so an operator can still debug', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = await openRequest(req(), { fn: 'demo' });
    api.fail(new Error('relation "user_profiles" does not exist'));
    expect(JSON.stringify(spy.mock.calls)).toContain('user_profiles');
  });

  it('correlates the client response with the log line by requestId', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = await openRequest(req(), { fn: 'demo' });
    const payload = await body(api.fail(new Error('boom')));
    expect(payload.requestId).toBeTruthy();
    expect(JSON.stringify(spy.mock.calls)).toContain(payload.requestId);
  });

  it('passes a deliberate ApiError message through unchanged', async () => {
    const api = await openRequest(req(), { fn: 'demo' });
    const res = api.fail(new ApiError('Phone number is required.', 422, 'invalid_phone'));
    const payload = await body(res);

    expect(res.status).toBe(422);
    expect(payload.error).toBe('Phone number is required.');
    expect(payload.code).toBe('invalid_phone');
  });

  it('hides a non-Error throw just as thoroughly', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = await openRequest(req(), { fn: 'demo' });
    const text = await api.fail({ secret: 'service-role-key-leaked' }).text();
    expect(text).not.toContain('service-role-key-leaked');
  });
});

describe('response hygiene', () => {
  it('marks responses no-store and nosniff', async () => {
    const api = await openRequest(req(), { fn: 'demo' });
    const res = api.json({ ok: true });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

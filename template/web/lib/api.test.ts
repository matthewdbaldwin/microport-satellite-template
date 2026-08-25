import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, ApiError } from './api';

/**
 * Replaces window.location with a controllable stub so we can assert on
 * `href` ASSIGNMENTS without jsdom's "not implemented: navigation" noise —
 * same technique ssoLoopGuard.test.ts uses for sessionStorage.
 */
function installLocation(pathname: string) {
  const hrefSets: string[] = [];
  const loc = {
    pathname,
    get href() { return `https://__APP_SLUG__.microport.com${pathname}`; },
    set href(v: string) { hrefSets.push(v); },
  };
  Object.defineProperty(window, 'location', { value: loc, configurable: true, writable: true });
  return hrefSets;
}

function mockFetch(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

let originalLocation: Location;
beforeEach(() => { originalLocation = window.location; });
afterEach(() => {
  Object.defineProperty(window, 'location', { value: originalLocation, configurable: true, writable: true });
  vi.unstubAllGlobals();
});

describe('api() — the /auth/me 401 redirect', () => {
  it('does NOT redirect when a 401 on /auth/me arrives while already on /login', async () => {
    // This is the production bug: AuthContext probes /auth/me once on mount;
    // on /login while logged out that 401s every time. Redirecting to '/login'
    // while already AT '/login' reassigns window.location.href to the SAME
    // URL — Chrome/Firefox silently no-op that, but iOS Safari performs a
    // genuine reload, which remounts AuthContext and repeats the probe. A
    // ~300ms flash-reload loop confirmed live in prod (screen recording +
    // CloudWatch, 2026-08-25) — the page never reaches the sign-in button.
    const hrefSets = installLocation('/login');
    vi.stubGlobal('fetch', mockFetch(401, { error: 'unauthenticated' }));

    await expect(api('/api/auth/me')).rejects.toBeInstanceOf(ApiError);

    expect(hrefSets).toEqual([]);
  });

  it('does NOT redirect when the 401 arrives on /auth/callback (exchange in flight)', async () => {
    // The root-layout AuthProvider probes /auth/me the instant /auth/callback
    // loads — before POST /sso/exchange has set the cookie — so this 401 is
    // expected. Navigating to /login here races the in-flight exchange: on a
    // slow device the navigation wins every round, the cookie never lands, and
    // the /login loop brake dead-ends a user whose hub session is valid
    // (confirmed on one iPhone, 2026-08-25).
    const hrefSets = installLocation('/auth/callback');
    vi.stubGlobal('fetch', mockFetch(401, { error: 'unauthenticated' }));

    await expect(api('/api/auth/me')).rejects.toBeInstanceOf(ApiError);

    expect(hrefSets).toEqual([]);
  });

  it('still redirects to /login when the 401 arrives on some OTHER page', async () => {
    const hrefSets = installLocation('/');
    vi.stubGlobal('fetch', mockFetch(401, { error: 'unauthenticated' }));

    await expect(api('/api/auth/me')).rejects.toBeInstanceOf(ApiError);

    expect(hrefSets).toEqual(['/login']);
  });

  it('never redirects for a 401 from a non-/auth/me endpoint, regardless of page', async () => {
    const hrefSets = installLocation('/dashboard');
    vi.stubGlobal('fetch', mockFetch(401, { error: 'unauthenticated' }));

    await expect(api('/api/widgets/some-proxied-thing')).rejects.toBeInstanceOf(ApiError);

    expect(hrefSets).toEqual([]);
  });
});

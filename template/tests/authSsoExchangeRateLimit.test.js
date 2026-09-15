// tests/authSsoExchangeRateLimit.test.js
// POST /api/auth/sso/exchange is this scaffold's only pre-auth attempt
// surface (pure-SSO satellite: no local login/forgot paths), capped at
// 20/15 min per IP (hubport#107 punch list; matches finport/productport).
// Tested through the REAL app.js chain, because the limiter is mounted
// there, not in the router: a router-level test would pass with the limiter
// absent from app.js.
//
// makeLimiters bakes in ciOnlySkip (skip ONLY when CI=true), so the test
// flips CI off for the duration and restores it after.
'use strict';

process.env.NODE_ENV = 'test';
process.env.WEB_ORIGIN = 'https://app.microport.com';
process.env.IDP_API_URL = 'https://hub-dev.microport.com';

jest.mock('../src/lib/db', () => ({ user: { findMany: jest.fn() }, session: { update: jest.fn() } }));
// The real pino logger stays: pino-http needs its level table, a stub breaks app load.

const request = require('supertest');
const app = require('../src/app');

describe('POST /api/auth/sso/exchange — rate limit (CI=false so ciOnlySkip does not skip)', () => {
  const ORIGINAL_CI = process.env.CI;
  beforeEach(() => {
    process.env.CI = 'false';
    // Cheapest shape per hit: the IdP denies the code. The limiter sits in
    // front of the handler, so what the IdP answers is irrelevant to the cap.
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ code: 'INVALID_CODE' }) });
  });
  afterEach(() => {
    delete global.fetch;
    if (ORIGINAL_CI === undefined) delete process.env.CI; else process.env.CI = ORIGINAL_CI;
  });

  test('21st exchange attempt from one IP inside 15 min → 429 with the fleet message', async () => {
    for (let i = 0; i < 20; i++) {
      const res = await request(app).post('/api/auth/sso/exchange').send({ code: 'x'.repeat(40) });
      expect(res.status).toBe(401);
    }
    const blocked = await request(app).post('/api/auth/sso/exchange').send({ code: 'x'.repeat(40) });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'Too many authentication attempts. Please try again later.' });
    expect(global.fetch).toHaveBeenCalledTimes(20); // the blocked attempt never reached the IdP
  });

  test('the cap is exchange-only: a neighbouring auth route is not throttled by it', async () => {
    const res = await request(app).get('/api/auth/role-catalog');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBeUndefined();
  });
});

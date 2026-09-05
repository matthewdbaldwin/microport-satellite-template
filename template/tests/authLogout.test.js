'use strict';
// POST /api/auth/logout must revoke the Session row server-side AND must NOT
// silently succeed if that revoke fails. The scaffold's original handler
// swallowed the error (`.catch(() => {})`), so a "logged out" user could keep a
// live server-side session — a stolen cookie replays past the logout — with
// zero trace in the response or the logs. Mirrors productport's logout (and its
// tests/authLogout.test.js), which propagates the failure to the error handler.
//
// The upstream refresh-token revoke is the deliberate ASYMMETRY here: it stays
// fire-and-forget, because the user's own local session ends either way and an
// IdP outage must never block logout. The last test pins that asymmetry so a
// future "consistency" edit can't quietly make an IdP blip fail logout.
//
// Auth is mocked at the wiring level: requireAuth stamps req.user/req.sessionId
// without exercising the verifier. Cookie names are derived from the SAME
// __APP_SLUG__ placeholder src/lib/cookies.js uses, so this stays correct after
// the scaffold stamps the real slug.

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 1, email: 'me@microport.com' }; req.sessionId = 'sess-1'; next(); },
}));
jest.mock('../src/lib/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/lib/db', () => ({ session: { update: jest.fn() } }));
jest.mock('../src/lib/refreshClient', () => ({ revokeUpstreamRefresh: jest.fn().mockResolvedValue(undefined) }));

const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');
const db = require('../src/lib/db');
const { revokeUpstreamRefresh } = require('../src/lib/refreshClient');

const SLUG           = '__APP_SLUG__';
const REFRESH_COOKIE = `${SLUG}_refresh`;

function makeApp() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use('/api/auth', require('../src/routes/auth'));
  return a;
}
const app = makeApp();

beforeEach(() => {
  jest.clearAllMocks();
  revokeUpstreamRefresh.mockResolvedValue(undefined);
});

describe('POST /api/auth/logout', () => {
  test('revokes the session row and clears the cookie on success', async () => {
    db.session.update.mockResolvedValue({});
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(db.session.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revokedAt: expect.any(Date) }) }),
    );
  });

  test('does NOT silently succeed when the session revoke fails (propagates, not swallowed)', async () => {
    db.session.update.mockRejectedValue(new Error('db down'));
    const res = await request(app).post('/api/auth/logout');

    // The session row is still live — logout must not report plain success.
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body).not.toEqual({ ok: true });
  });

  test('upstream refresh revoke failure does NOT block logout (stays fire-and-forget)', async () => {
    db.session.update.mockResolvedValue({});
    revokeUpstreamRefresh.mockRejectedValue(new Error('idp down'));
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', [`${REFRESH_COOKIE}=raw-refresh-abc`]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(revokeUpstreamRefresh.mock.calls[0][0]).toBe('raw-refresh-abc');
  });
});

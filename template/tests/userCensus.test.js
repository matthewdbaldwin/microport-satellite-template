// tests/userCensus.test.js
//
// Route-level tests for the HubPort fleet-union census endpoint
// (POST /api/internal/user-census), ported from finport/productport's
// canonical test (same per-app SELECT/toDTO shape: no soft-delete, no
// last-login tracking). Prisma is MOCKED; the HMAC signature is REAL
// (signed with the same HUBPORT_CENSUS_SECRET the guard verifies).
//
// Router-level only (minimal express app, rawBody captured the same way
// app.js does) — DTO shape, no-credential-leak, isLocalCapable derivation,
// cursor pagination, 401 on missing/bad signature. Not yet wired through the
// real app.js in a test here: HUBPORT_CENSUS_SECRET and hubport's own
// registration of this satellite are provisioned as part of onboarding (see
// scaffold.mjs's printed checklist), so the route 503s in a freshly-minted
// deploy until that checkpoint happens — this test proves the route itself
// is correct ahead of that checkpoint.

process.env.NODE_ENV = 'test';
const SECRET = 'census-shared-secret-test';
process.env.HUBPORT_CENSUS_SECRET = SECRET;

// The scaffold's default User model has no soft-delete (no deletedAt column)
// so there is no exclusion case to test; WHERE is `{}` and every fixture is
// visible.
jest.mock('../src/lib/db', () => {
  const rows = [
    // live, local-capable bcrypt hash, mixed-case email (proves lowercasing)
    { email: 'Alice@microport.com', name: 'Alice Anders', password: '$2b$10$abcdefghijklmnopqrstuv', role: 'admin', active: true, createdAt: new Date('2026-01-02T03:04:05.000Z') },
    // live, SSO-only — password is null (the scaffold's real convention, NOT a sentinel) → isLocalCapable false
    { email: 'bob@microport.com', name: null, password: null, role: 'admin', active: true, createdAt: new Date('2026-01-03T00:00:00.000Z') },
    // disabled → active false, bcrypt $2a → isLocalCapable true (disabled locals ARE included in the census)
    { email: 'carol@microport.com', name: 'Carol Chen', password: '$2a$10$abcdefghijklmnopqrstuv', role: 'admin', active: false, createdAt: new Date('2026-01-04T00:00:00.000Z') },
  ];
  const findMany = jest.fn(async (args = {}) => {
    let data = rows.slice();
    data.sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
    if (args.cursor && args.cursor.email != null) {
      const idx = data.findIndex((r) => r.email === args.cursor.email);
      if (idx >= 0) data = data.slice(idx + (typeof args.skip === 'number' ? args.skip : 0));
    }
    if (typeof args.take === 'number') data = data.slice(0, Math.max(0, args.take));
    return data;
  });
  return { user: { findMany } };
});

const express = require('express');
const request = require('supertest');
const { signWebhookBody } = require('@matthewdbaldwin/microport-auth');
const db = require('../src/lib/db');

const routerApp = express();
routerApp.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
routerApp.use('/api/internal/user-census', require('../src/routes/userCensus'));

function signedPost(app, bodyObj) {
  const body = JSON.stringify(bodyObj);
  return request(app)
    .post('/api/internal/user-census')
    .set('Content-Type', 'application/json')
    .set('x-hubport-signature', signWebhookBody(SECRET, body))
    .send(body);
}

describe('census route — DTO shape + credential safety', () => {
  it('returns the canonical DTO for all users (no soft-delete to exclude)', async () => {
    const res = await signedPost(routerApp, { take: 100 });
    expect(res.status).toBe(200);
    expect(res.body.nextCursor).toBeNull();

    expect(res.body.users.map((u) => u.email)).toEqual([
      'alice@microport.com', 'bob@microport.com', 'carol@microport.com',
    ]);

    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, orderBy: { email: 'asc' } }),
    );

    expect(res.body.users[0]).toEqual({
      email: 'alice@microport.com',
      name: 'Alice Anders',
      active: true,
      localRole: 'admin',
      isLocalCapable: true,
      lastLoginAt: null,
      createdAt: '2026-01-02T03:04:05.000Z',
    });
  });

  it('never emits password anywhere in the body', async () => {
    const res = await signedPost(routerApp, { take: 100 });
    expect(res.status).toBe(200);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/passwordHash|password|\$2[aby]\$/);
    for (const u of res.body.users) expect(u).not.toHaveProperty('id');
  });

  it('derives isLocalCapable from the bcrypt prefix', async () => {
    const res = await signedPost(routerApp, { take: 100 });
    const byEmail = Object.fromEntries(res.body.users.map((u) => [u.email, u]));
    expect(byEmail['alice@microport.com'].isLocalCapable).toBe(true);  // $2b$ hash
    expect(byEmail['bob@microport.com'].isLocalCapable).toBe(false);   // password: null (SSO-only)
    expect(byEmail['carol@microport.com'].isLocalCapable).toBe(true);  // $2a$ hash
    expect(byEmail['bob@microport.com'].lastLoginAt).toBeNull();
    expect(byEmail['carol@microport.com'].active).toBe(false);         // disabled local, still included
  });
});

describe('census route — cursor pagination', () => {
  it('paginates over the POST body { cursor, take } and terminates cleanly', async () => {
    const p1 = await signedPost(routerApp, { take: 2 });
    expect(p1.status).toBe(200);
    expect(p1.body.users.map((u) => u.email)).toEqual(['alice@microport.com', 'bob@microport.com']);
    expect(p1.body.nextCursor).toBe('bob@microport.com');

    const p2 = await signedPost(routerApp, { cursor: p1.body.nextCursor, take: 2 });
    expect(p2.status).toBe(200);
    expect(p2.body.users.map((u) => u.email)).toEqual(['carol@microport.com']);
    expect(p2.body.nextCursor).toBeNull();
  });
});

describe('census route — signature enforcement', () => {
  it('401s when the signature header is missing', async () => {
    const res = await request(routerApp)
      .post('/api/internal/user-census')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ take: 100 }));
    expect(res.status).toBe(401);
  });

  it('401s when the signature is computed with the wrong secret', async () => {
    const body = JSON.stringify({ take: 100 });
    const res = await request(routerApp)
      .post('/api/internal/user-census')
      .set('Content-Type', 'application/json')
      .set('x-hubport-signature', signWebhookBody('the-wrong-secret', body))
      .send(body);
    expect(res.status).toBe(401);
  });
});

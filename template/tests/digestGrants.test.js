// tests/digestGrants.test.js
//
// Route-level tests for the fleet conformance sweep's grant-seam digest
// endpoint (POST /api/internal/digest-grants, hubport#84 §9-§11). Prisma is
// MOCKED; the HMAC signature is REAL (signed with the same
// HUBPORT_DIGEST_SECRET the guard verifies) — mirrors tests/userCensus.test.js
// (the proven precedent for this route's shape/guard), but this endpoint
// carries digests only, never raw field values.
//
// GRANT_ADAPTERS is also MOCKED: a freshly-minted satellite has no real entry
// in microport-contracts' GRANT_ADAPTERS until the onboarding step
// scaffold.mjs prints (add "__APP_SLUG__" to src/digestAdapters.ts and
// publish) actually happens, so this test stands in a same-shaped adapter
// (roleOnly + liveByActive, matching the scaffold's default User model: no
// deletedAt, active: Boolean) to prove the route's own logic ahead of that
// checkpoint. Delete this mock once "__APP_SLUG__" is a real GRANT_ADAPTERS
// entry and this test will exercise the real one.
process.env.NODE_ENV = 'test';
const SECRET = 'digest-shared-secret-test';
process.env.HUBPORT_DIGEST_SECRET = SECRET;

jest.mock('@matthewdbaldwin/microport-contracts/digestAdapters', () => ({
  GRANT_ADAPTERS: {
    __APP_SLUG__: {
      satellite: '__APP_SLUG__',
      fields: ['role'],
      setFields: [],
      falseIsAbsentFields: [],
      roles: ['__PRIMARY_ROLE__'],
      // liveByActive, inlined: notDeleted() && active !== false.
      isLive: (row) => (row.deletedAt === null || row.deletedAt === undefined) && row.active !== false,
    },
  },
}));

jest.mock('../src/lib/db', () => ({
  user: { findMany: jest.fn() },
}));

const request = require('supertest');
const { signWebhookBody } = require('@matthewdbaldwin/microport-auth');
const app = require('../src/app');
const prisma = require('../src/lib/db');

function signed(body) {
  const raw = JSON.stringify(body);
  return request(app)
    .post('/api/internal/digest-grants')
    .set('x-hubport-signature', signWebhookBody(SECRET, raw))
    .set('Content-Type', 'application/json')
    .send(raw);
}

describe('POST /api/internal/digest-grants', () => {
  it('rejects an unsigned request', async () => {
    const res = await request(app).post('/api/internal/digest-grants').send({});
    expect(res.status).toBe(401);
  });

  it('returns digests for active users', async () => {
    prisma.user.findMany.mockResolvedValue([
      { email: 'live@example.com', role: 'admin', active: true },
      { email: 'gone@example.com', role: 'admin', active: false },
    ]);
    const res = await signed({ take: 10 });
    expect(res.status).toBe(200);
    expect(res.body.digests).toHaveLength(1);
    expect(res.body.digests[0].stableId).toBe('live@example.com');
    expect(res.body.digestVersion).toBe(1);
    expect(typeof res.body.contractsVersion).toBe('string');
  });

  it('never includes raw role values in the response — digests only', async () => {
    prisma.user.findMany.mockResolvedValue([
      { email: 'a@example.com', role: 'admin', active: true },
    ]);
    const res = await signed({ take: 10 });
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/"role":"admin"/);
  });
});

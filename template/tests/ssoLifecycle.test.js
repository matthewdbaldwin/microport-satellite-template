// tests/ssoLifecycle.test.js
//
// POST /api/sso/lifecycle/event — inbound HMAC-signed lifecycle webhook.
// These cases cover the receiver's IDEMPOTENCY contract specifically: a row
// existing under the sender's event id is not proof the event was applied, so
// dedup keys off processedAt, and the transition from "unprocessed row" to
// "mine to process" is an atomic claim rather than a read.
//
// The defect this closes, and the reason it lives in the TEMPLATE: dedup on row
// EXISTENCE meant a retry of an event whose first delivery threw mid-processing
// was silently discarded — a revoked user kept access. Every satellite minted
// from this template inherited that; none should again. Prisma MOCKED, HMAC REAL.
'use strict';

process.env.SALESPORT_LIFECYCLE_SECRET = 'tpl-test-lifecycle-secret'; // guard reads at require time

jest.mock('../src/lib/db', () => ({
  user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
  userLifecycleEvent: {
    findUnique: jest.fn(),
    create:     jest.fn(),
    update:     jest.fn().mockResolvedValue({}),
    // Atomic claim — default to "wins the claim" so cases not exercising the
    // race proceed exactly as a single delivery would.
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
}));
jest.mock('../src/lib/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { signWebhookBody } = require('@matthewdbaldwin/microport-auth');
const db = require('../src/lib/db');
const router = require('../src/routes/ssoLifecycle');

const SECRET = 'tpl-test-lifecycle-secret';
const app = express();
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use('/api/sso/lifecycle', router);

const revokeEvent = {
  id: 'evt-1', email: 'gone@test.local', kind: 'revoke',
  prevRole: 'viewer', newRole: null, actorEmail: 'admin@test.local', actorRole: 'admin',
};

function postSigned(bodyObj, { eventId = null, secret = SECRET } = {}) {
  const str = JSON.stringify(bodyObj);
  const req = request(app).post('/api/sso/lifecycle/event')
    .set('Content-Type', 'application/json')
    .set('x-salesport-signature', signWebhookBody(secret, str));
  if (eventId) req.set('X-Lifecycle-Event-Id', eventId);
  return req.send(str);
}

beforeEach(() => {
  jest.clearAllMocks();
  db.userLifecycleEvent.findUnique.mockResolvedValue(null);
  db.userLifecycleEvent.create.mockResolvedValue({ id: 'ule-1' });
  db.userLifecycleEvent.update.mockResolvedValue({});
  db.userLifecycleEvent.updateMany.mockResolvedValue({ count: 1 });
  db.user.findUnique.mockResolvedValue(null);
  db.user.update.mockResolvedValue({});
});

describe('POST /event — baseline', () => {
  test('a signed revoke on an active user deactivates it and writes one audit row', async () => {
    db.user.findUnique.mockResolvedValue({ id: 7, active: true });

    const res = await postSigned(revokeEvent);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, eventId: 'ule-1', applied: true });
    expect(db.userLifecycleEvent.create).toHaveBeenCalledTimes(1);
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { active: false } });
  });
});

describe('POST /event — dedup keys off processedAt, not row existence', () => {
  test('a FINISHED prior delivery (processedAt set) short-circuits without reprocessing', async () => {
    db.userLifecycleEvent.findUnique.mockResolvedValue({ id: 'ule-done', processedAt: new Date() });

    const res = await postSigned(revokeEvent, { eventId: 'outbox-1' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, eventId: 'ule-done', deduplicated: true });
    expect(db.userLifecycleEvent.create).not.toHaveBeenCalled();
    expect(db.userLifecycleEvent.updateMany).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  // (a) The core regression. A first delivery logged the audit row, then threw
  // mid-processing (500 → the emitter retries with the same event id). The row
  // exists but processedAt is null. Under the old existence-only dedup this
  // retry returned deduplicated:true and the revoke was NEVER applied — the
  // user kept access permanently.
  test('a retry after a mid-processing throw IS reprocessed, reusing the same unprocessed row', async () => {
    // First delivery: fresh row, processing blows up.
    db.userLifecycleEvent.findUnique.mockResolvedValueOnce(null);
    db.user.findUnique.mockRejectedValueOnce(new Error('connection reset'));

    const first = await postSigned(revokeEvent, { eventId: 'outbox-42' });
    expect(first.status).toBe(500);
    expect(db.userLifecycleEvent.create).toHaveBeenCalledTimes(1);
    // The failed attempt released its claim, so the row is reclaimable.
    expect(db.userLifecycleEvent.update).toHaveBeenCalledWith({
      where: { id: 'ule-1' },
      data:  { processedAt: null, error: expect.any(String) },
    });

    jest.clearAllMocks();
    db.userLifecycleEvent.update.mockResolvedValue({});
    db.userLifecycleEvent.updateMany.mockResolvedValue({ count: 1 });
    // Retry: the dedup lookup resolves the SAME row, still unprocessed.
    db.userLifecycleEvent.findUnique.mockResolvedValue({ id: 'ule-1', processedAt: null });
    db.user.findUnique.mockResolvedValue({ id: 7, active: true });
    db.user.update.mockResolvedValue({});

    const retry = await postSigned(revokeEvent, { eventId: 'outbox-42' });

    expect(retry.status).toBe(200);
    expect(retry.body).not.toMatchObject({ deduplicated: true });
    // No second create — senderEventId is @unique, that would throw.
    expect(db.userLifecycleEvent.create).not.toHaveBeenCalled();
    // The revoke actually landed this time.
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { active: false } });
    expect(db.userLifecycleEvent.update).toHaveBeenLastCalledWith({
      where: { id: 'ule-1' },
      data:  { processedAt: expect.any(Date), error: null },
    });
  });
});

describe('POST /event — atomic claim', () => {
  test('the claim is one updateMany scoped by id AND processedAt:null, in the statement that sets processedAt', async () => {
    db.userLifecycleEvent.findUnique.mockResolvedValue({ id: 'ule-shape', processedAt: null });
    db.user.findUnique.mockResolvedValue({ id: 7, active: true });

    await postSigned(revokeEvent, { eventId: 'outbox-shape' });

    expect(db.userLifecycleEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'ule-shape', processedAt: null },
      data:  { processedAt: expect.any(Date) },
    });
  });

  // (b) Two concurrent deliveries both read the same processedAt:null row —
  // only the atomic claim can tell them apart. The mock enforces the ordering
  // Postgres guarantees for a single conditional UPDATE on one row.
  test('two concurrent deliveries of the same event process exactly once', async () => {
    db.userLifecycleEvent.findUnique.mockResolvedValue({ id: 'ule-race', processedAt: null });
    db.userLifecycleEvent.updateMany
      .mockResolvedValueOnce({ count: 1 })   // first to reach the DB: wins
      .mockResolvedValueOnce({ count: 0 });  // second: row is no longer processedAt:null
    db.user.findUnique.mockResolvedValue({ id: 7, active: true });

    const [a, b] = await Promise.all([
      postSigned(revokeEvent, { eventId: 'outbox-race' }),
      postSigned(revokeEvent, { eventId: 'outbox-race' }),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // Exactly one loser.
    expect([!!a.body.deduplicated, !!b.body.deduplicated].filter(Boolean)).toHaveLength(1);
    // The side effect on User fired ONCE across both deliveries, not twice.
    expect(db.user.update).toHaveBeenCalledTimes(1);
    expect(db.userLifecycleEvent.updateMany).toHaveBeenCalledTimes(2);
  });

  test('the loser of the claim never reads or writes the User row', async () => {
    db.userLifecycleEvent.findUnique.mockResolvedValue({ id: 'ule-lost', processedAt: null });
    db.userLifecycleEvent.updateMany.mockResolvedValue({ count: 0 });

    const res = await postSigned(revokeEvent, { eventId: 'outbox-lost' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, eventId: 'ule-lost', deduplicated: true });
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  test('a throw after winning the claim releases it (processedAt back to null) so a retry can reclaim', async () => {
    db.userLifecycleEvent.findUnique.mockResolvedValue({ id: 'ule-fail', processedAt: null });
    db.user.findUnique.mockRejectedValue(new Error('db exploded'));

    const res = await postSigned(revokeEvent, { eventId: 'outbox-fail' });

    expect(res.status).toBe(500);
    expect(db.userLifecycleEvent.update).toHaveBeenCalledWith({
      where: { id: 'ule-fail' },
      data:  { processedAt: null, error: expect.any(String) },
    });
  });
});

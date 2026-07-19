// Bug-report SENDER surface (screenshot parity + hub-first forward). This
// satellite forwards filed reports to the central queue; this proves the
// server-side guards + the two forward legs:
//   1. screenshot mime allowlist — accept="image/*" is client-side only, so the
//      multer fileFilter must 400 (cleanly) on a non-image, and the 2 MB ceiling
//      must 413 an oversize upload — BEFORE the handler ever runs;
//   2. multipart forward — when a screenshot IS attached AND the target is
//      multipart-capable (BUGREPORT_FORWARD_URL set = the hub), forward
//      multipart/form-data: a `payload` string field + a `screenshot` part +
//      an `x-bugreport-signature` HMAC over the payload STRING;
//   3. JSON-only fallback — a file present but BUGREPORT_FORWARD_URL unset (still
//      pointed at SalesPort's JSON receiver) drops the image (warn) and sends the
//      text leg unchanged;
//   4. rate limit — per-user filing limiter (limiters skip only when CI=true, so
//      the rate-limit test flips CI off around its 429 assertion).
// Auth is mocked at the wiring level: requireAuth stamps req.user without
// exercising the verifier. The channel secret env name is derived the SAME way
// the route derives it (SLUG.toUpperCase()), so this stays correct after the
// scaffold stamps __APP_SLUG__ to the real (lowercase) slug.
'use strict';

const { signWebhookBody } = require('@matthewdbaldwin/microport-auth');

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 1, email: 'me@microport.com' }; next(); },
}));
jest.mock('../src/lib/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const express = require('express');
const request = require('supertest');
const logger  = require('../src/lib/logger');

const SLUG       = '__APP_SLUG__';
const SECRET_ENV = `WEBHOOK_SECRET_${SLUG.toUpperCase()}_SALESPORT`;
const SECRET     = 'chan-secret-123';

function makeApp() {
  const a = express();
  a.use(express.json());
  a.use('/api/bug-reports', require('../src/routes/bugReports'));
  return a;
}
const app = makeApp();

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CI = 'true'; // limiters skip by default; rate-limit test flips this off
  delete process.env.BUGREPORT_FORWARD_URL;
  delete process.env.BUGREPORT_FORWARD_SECRET;
  process.env.SALESPORT_API_URL = 'https://sp.example';
  process.env[SECRET_ENV] = SECRET;
  global.fetch = jest.fn(async () => ({ ok: true, status: 201, json: async () => ({ id: 99 }) }));
});

// ── 1. Screenshot mime allowlist + size ceiling (multer, before the handler) ──
describe('screenshot intake guards', () => {
  test('non-image upload → clean 400, nothing forwarded', async () => {
    const res = await request(app).post('/api/bug-reports')
      .field('title', 'Sneaky pdf')
      .attach('screenshot', Buffer.from('%PDF-1.7'), { filename: 'shot.png', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PNG, JPEG, WebP, or GIF/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('image/svg+xml (scriptable) → 400', async () => {
    const res = await request(app).post('/api/bug-reports')
      .field('title', 'svg smuggle')
      .attach('screenshot', Buffer.from('<svg onload=alert(1)/>'), { filename: 'shot.svg', contentType: 'image/svg+xml' });
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('oversize (> 2 MB) image → 413, nothing forwarded', async () => {
    const big = Buffer.alloc(2 * 1024 * 1024 + 100, 0);
    const res = await request(app).post('/api/bug-reports')
      .field('title', 'huge shot')
      .attach('screenshot', big, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(413);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ── 2. Multipart forward to a multipart-capable target (the hub) ──────────────
describe('multipart forward', () => {
  test('screenshot + BUGREPORT_FORWARD_URL set → multipart POST with payload + signature + screenshot part', async () => {
    process.env.BUGREPORT_FORWARD_URL    = 'https://hub.example';
    process.env.BUGREPORT_FORWARD_SECRET = SECRET;

    const res = await request(app).post('/api/bug-reports')
      .field('title', 'Broken button')
      .field('description', 'The save button does nothing')
      .field('priority', 'high')
      .field('eventId', 'evt-mp-1')
      .attach('screenshot', Buffer.from('PNGDATA'), { filename: 'shot.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://hub.example/api/bug-reports/cross-app');

    // Body is a FormData (NOT a JSON string) — no Content-Type header (the
    // runtime sets the multipart boundary itself).
    const form = opts.body;
    expect(typeof form).not.toBe('string');
    expect(opts.headers['Content-Type']).toBeUndefined();

    const payloadStr = form.get('payload');
    expect(typeof payloadStr).toBe('string');
    const payload = JSON.parse(payloadStr);
    expect(payload.sourceApp).toBe(SLUG);
    expect(payload.title).toBe('Broken button');
    expect(payload.eventId).toBe('evt-mp-1');

    // HMAC is over the payload STRING — reproducible with the same secret.
    expect(opts.headers['x-bugreport-signature']).toBe(signWebhookBody(SECRET, payloadStr));

    // The screenshot rides as a file part.
    const shot = form.get('screenshot');
    expect(shot).toBeTruthy();
    expect(shot.name).toBe('shot.png');
  });
});

// ── 3. JSON-only fallback: file present but forward target is JSON-only ───────
describe('JSON-only fallback', () => {
  test('screenshot present but BUGREPORT_FORWARD_URL unset → JSON leg + a warn (image dropped)', async () => {
    // SALESPORT_API_URL is set (baseline); BUGREPORT_FORWARD_URL is not.
    const res = await request(app).post('/api/bug-reports')
      .field('title', 'JSON-only receiver')
      .field('eventId', 'evt-json-1')
      .attach('screenshot', Buffer.from('PNGDATA'), { filename: 'shot.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://sp.example/api/bug-reports/cross-app');
    // JSON leg — a string body with the JSON Content-Type + signature header.
    expect(typeof opts.body).toBe('string');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['x-bugreport-signature']).toBe(signWebhookBody(SECRET, opts.body));

    // The dropped screenshot is logged (warn), not silently discarded.
    const warned = logger.warn.mock.calls.some((c) => /screenshot dropped/.test(String(c[1])));
    expect(warned).toBe(true);
  });
});

// ── 4. Filing rate limit (CI=false so ciOnlySkip does not skip) ───────────────
describe('rate limit', () => {
  afterEach(() => { process.env.CI = 'true'; });

  test('6th filing inside a minute for the same user → 429 RATE_LIMITED', async () => {
    process.env.CI = 'false';
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/bug-reports').send({ title: `report ${i}`, eventId: `rl-${i}` });
      expect(res.status).toBe(201);
    }
    const blocked = await request(app).post('/api/bug-reports').send({ title: 'one too many', eventId: 'rl-6' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(global.fetch).toHaveBeenCalledTimes(5); // the 6th never reached the handler/forward
  });
});

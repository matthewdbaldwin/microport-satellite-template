'use strict';
// CORS must fail CLOSED in production. With WEB_ORIGIN unset, src/app.js used to
// fall back to `origin: true` with `credentials: true`, which reflects any Origin
// header back and lets any site make credentialed requests. In production the
// app now refuses to load; outside production the permissive local-dev fallback
// is unchanged.
//
// dotenv is mocked so a developer's local .env cannot re-supply WEB_ORIGIN, and
// the DB / auth / logger modules are mocked so app.js loads without Prisma or keys.

jest.mock('dotenv', () => ({ config: jest.fn() }));
// pino-http needs a real pino instance, so a silent one rather than a jest.fn stub.
jest.mock('../src/lib/logger', () => require('pino')({ level: 'silent' }));
jest.mock('../src/lib/db', () => ({}));
jest.mock('../src/middleware/auth', () => ({
  requireAuth: (_req, _res, next) => next(),
  withFreshAccessToken: (_req, _res, next) => next(),
}));

const request = require('supertest');

const ORIGINAL = { NODE_ENV: process.env.NODE_ENV, WEB_ORIGIN: process.env.WEB_ORIGIN };

function loadApp(env) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  let app;
  jest.isolateModules(() => { app = require('../src/app'); });
  return app;
}

afterEach(() => {
  for (const [k, v] of Object.entries(ORIGINAL)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('CORS fail-closed', () => {
  test('production with WEB_ORIGIN unset refuses to load', () => {
    expect(() => loadApp({ NODE_ENV: 'production', WEB_ORIGIN: undefined }))
      .toThrow(/WEB_ORIGIN must be set in production/);
  });

  test('production with WEB_ORIGIN blank / only separators refuses to load', () => {
    expect(() => loadApp({ NODE_ENV: 'production', WEB_ORIGIN: ' , ' }))
      .toThrow(/WEB_ORIGIN must be set in production/);
  });

  test('production with WEB_ORIGIN set loads and does not reflect a foreign origin', async () => {
    const app = loadApp({ NODE_ENV: 'production', WEB_ORIGIN: 'https://app.example.com' });

    const allowed = await request(app).get('/health').set('Origin', 'https://app.example.com');
    expect(allowed.status).toBe(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const foreign = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('non-production with WEB_ORIGIN unset keeps the permissive dev fallback', async () => {
    const app = loadApp({ NODE_ENV: 'development', WEB_ORIGIN: undefined });
    const res = await request(app).get('/health').set('Origin', 'http://localhost:3999');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3999');
  });
});

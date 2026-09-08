const {
  classifySeedTarget, assertSeedTargetAllowed,
  classifyCaptureTarget, assertCaptureTargetAllowed,
} = require('../prisma/seed-guard');

const url = (host, db) => `postgresql://user:pass@${host}:5432/${db}?schema=public`;
const PROD = url('platform-db.czi8ie8iy77d.eu-central-1.rds.amazonaws.com', 'salesport');
const PROD_V2 = url('platform-db-v2.czi8ie8iy77d.eu-central-1.rds.amazonaws.com', 'salesport');
const DEV_RDS = url('platform-db-dev.czi8ie8iy77d.eu-central-1.rds.amazonaws.com', 'salesport_dev');

describe('seed-guard classifySeedTarget', () => {
  test.each([
    ['localhost', 'salesport'],
    ['127.0.0.1', 'anything'],
    ['[::1]', 'x'],
    ['host.docker.internal', 'x'],
  ])('allows the local host %s', (host, db) => {
    const v = classifySeedTarget({ DATABASE_URL: url(host, db) });
    expect(v.allowed).toBe(true);
    expect(v.db).toBe(db);
  });

  test('allows the platform-db-dev RDS instance by its _dev database name', () => {
    const v = classifySeedTarget({ DATABASE_URL: DEV_RDS });
    expect(v).toMatchObject({ allowed: true, db: 'salesport_dev' });
  });

  test.each(['_test', '_local', '_DEV'])('allows a database name ending in %s (case-insensitive)', (suffix) => {
    expect(classifySeedTarget({ DATABASE_URL: url('db.example.internal', `app${suffix}`) }).allowed).toBe(true);
  });

  test('refuses the production RDS instance', () => {
    const v = classifySeedTarget({ DATABASE_URL: PROD });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('platform-db.czi8ie8iy77d.eu-central-1.rds.amazonaws.com');
    expect(v.reason).toContain('salesport');
  });

  test.each(['postgres', 'pgbouncer', 'db'])('allows the docker-compose service host %s', (host) => {
    expect(classifySeedTarget({ DATABASE_URL: url(host, 'app') }).allowed).toBe(true);
  });

  test('allows the platform-db-dev host with a plain database name (productport)', () => {
    const v = classifySeedTarget({
      DATABASE_URL: url('platform-db-dev.czi8ie8iy77d.eu-central-1.rds.amazonaws.com', 'productport'),
    });
    expect(v).toMatchObject({ allowed: true, reason: expect.stringContaining('dev host') });
  });

  test('refuses the production host with a plain database name (productport)', () => {
    expect(classifySeedTarget({
      DATABASE_URL: url('platform-db.czi8ie8iy77d.eu-central-1.rds.amazonaws.com', 'productport'),
    }).allowed).toBe(false);
  });

  test.each(['devbox.example.com', 'mydev.example.com', 'devices.internal'])(
    'does not treat %s as a dev host (label must be exactly dev)', (host) => {
      expect(classifySeedTarget({ DATABASE_URL: url(host, 'app') }).allowed).toBe(false);
    },
  );

  test('allows a _dev database name even on the production host (deliberate: the name rule is independent of the host)', () => {
    expect(classifySeedTarget({
      DATABASE_URL: url('platform-db.czi8ie8iy77d.eu-central-1.rds.amazonaws.com', 'salesport_dev'),
    }).allowed).toBe(true);
  });

  test('refuses a malformed percent escape in the database name as unparseable', () => {
    expect(classifySeedTarget({ DATABASE_URL: 'postgresql://u:p@platform-db.example.com:5432/sales%port' }))
      .toMatchObject({ allowed: false, reason: 'DATABASE_URL could not be parsed' });
  });

  test('an empty SEED_ALLOW_PROD is not an override', () => {
    expect(classifySeedTarget({ DATABASE_URL: PROD, SEED_ALLOW_PROD: '' }).allowed).toBe(false);
  });

  test('refuses the platform-db-v2 instance too', () => {
    expect(classifySeedTarget({ DATABASE_URL: PROD_V2 }).allowed).toBe(false);
  });

  test('refuses a remote host whose database name merely contains dev', () => {
    expect(classifySeedTarget({ DATABASE_URL: url('db.example.internal', 'devices') }).allowed).toBe(false);
  });

  test('refuses an unset DATABASE_URL', () => {
    expect(classifySeedTarget({})).toMatchObject({ allowed: false, reason: 'DATABASE_URL is not set' });
  });

  test('refuses an unparseable DATABASE_URL', () => {
    expect(classifySeedTarget({ DATABASE_URL: 'not a url' })).toMatchObject({ allowed: false, reason: 'DATABASE_URL could not be parsed' });
  });

  test('SEED_ALLOW_PROD=1 overrides a refusal', () => {
    expect(classifySeedTarget({ DATABASE_URL: PROD, SEED_ALLOW_PROD: '1' })).toMatchObject({ allowed: true, reason: 'SEED_ALLOW_PROD=1 override' });
  });

  test('only the exact value 1 counts as the override', () => {
    expect(classifySeedTarget({ DATABASE_URL: PROD, SEED_ALLOW_PROD: 'true' }).allowed).toBe(false);
  });

  test('ignores NODE_ENV: a _dev target is allowed even under NODE_ENV=production', () => {
    expect(classifySeedTarget({ DATABASE_URL: DEV_RDS, NODE_ENV: 'production' }).allowed).toBe(true);
  });
});

describe('seed-guard assertSeedTargetAllowed', () => {
  const fakeLog = () => ({ log: jest.fn(), error: jest.fn() });

  test('exits with code 2 and names the target on refusal', () => {
    const exit = jest.fn();
    const log = fakeLog();
    assertSeedTargetAllowed({ DATABASE_URL: PROD }, { exit, log });
    expect(exit).toHaveBeenCalledWith(2);
    expect(log.error.mock.calls[0][0]).toMatch(/^REFUSING to seed platform-db\.czi8ie8iy77d.*\/salesport/);
    expect(log.error.mock.calls[1][0]).toContain('SEED_ALLOW_PROD=1');
    expect(log.log).not.toHaveBeenCalled();
  });

  test('returns the verdict, logs the target and does not exit when allowed', () => {
    const exit = jest.fn();
    const log = fakeLog();
    const v = assertSeedTargetAllowed({ DATABASE_URL: url('localhost', 'salesport') }, { exit, log });
    expect(v.allowed).toBe(true);
    expect(exit).not.toHaveBeenCalled();
    expect(log.log).toHaveBeenCalledWith(expect.stringContaining('localhost/salesport'));
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe('seed-guard classifyCaptureTarget (stricter than classifySeedTarget)', () => {
  test.each([
    ['localhost', 'app'],
    ['127.0.0.1', 'app'],
    ['[::1]', 'app'],
    ['host.docker.internal', 'app'],
    ['postgres', 'app'],
    ['pgbouncer', 'app'],
    ['db', 'app'],
  ])('allows the local host %s', (host, db) => {
    expect(classifyCaptureTarget({ DATABASE_URL: url(host, db) })).toMatchObject({ verdict: 'ok' });
  });

  test('refuses the platform-db-dev RDS host — unlike classifySeedTarget, a "-dev" host is NOT a free pass here', () => {
    expect(classifyCaptureTarget({ DATABASE_URL: DEV_RDS })).toMatchObject({ verdict: 'refuse' });
  });

  test('refuses a _dev database name on an otherwise-unrecognised host — unlike classifySeedTarget', () => {
    expect(classifyCaptureTarget({ DATABASE_URL: url('db.example.internal', 'app_dev') }))
      .toMatchObject({ verdict: 'refuse' });
  });

  test('refuses the production RDS instance', () => {
    const v = classifyCaptureTarget({ DATABASE_URL: PROD });
    expect(v.verdict).toBe('refuse');
    expect(v.reason).toContain('platform-db.czi8ie8iy77d.eu-central-1.rds.amazonaws.com');
  });

  test('warns rather than refuses when DATABASE_URL is not set — this process cannot see what the already-running app is wired to', () => {
    expect(classifyCaptureTarget({})).toMatchObject({ verdict: 'warn', host: null, db: null });
  });

  test('refuses an unparseable DATABASE_URL', () => {
    expect(classifyCaptureTarget({ DATABASE_URL: 'not a url' }))
      .toMatchObject({ verdict: 'refuse', reason: 'DATABASE_URL could not be parsed' });
  });

  test('CAPTURE_ALLOW_REMOTE_DB overrides only when it names the EXACT resolved host', () => {
    expect(classifyCaptureTarget({ DATABASE_URL: PROD, CAPTURE_ALLOW_REMOTE_DB: 'platform-db.czi8ie8iy77d.eu-central-1.rds.amazonaws.com' }))
      .toMatchObject({ verdict: 'ok' });
  });

  test('CAPTURE_ALLOW_REMOTE_DB naming a different host does not override', () => {
    expect(classifyCaptureTarget({ DATABASE_URL: PROD, CAPTURE_ALLOW_REMOTE_DB: 'some-other-host.example.com' }))
      .toMatchObject({ verdict: 'refuse' });
  });

  test('a bare CAPTURE_ALLOW_REMOTE_DB=1 (the seed guard\'s override shape) does NOT override — a named host is required', () => {
    expect(classifyCaptureTarget({ DATABASE_URL: PROD, CAPTURE_ALLOW_REMOTE_DB: '1' })).toMatchObject({ verdict: 'refuse' });
  });
});

describe('seed-guard assertCaptureTargetAllowed', () => {
  const fakeLog = () => ({ log: jest.fn(), warn: jest.fn(), error: jest.fn() });

  test('exits with code 2 and names the target on refusal', () => {
    const exit = jest.fn();
    const log = fakeLog();
    assertCaptureTargetAllowed({ DATABASE_URL: DEV_RDS }, { exit, log });
    expect(exit).toHaveBeenCalledWith(2);
    expect(log.error.mock.calls[0][0]).toContain('REFUSING to capture');
    expect(log.log).not.toHaveBeenCalled();
  });

  test('warns and proceeds (does not exit) when DATABASE_URL is unset', () => {
    const exit = jest.fn();
    const log = fakeLog();
    const v = assertCaptureTargetAllowed({}, { exit, log });
    expect(v.verdict).toBe('warn');
    expect(exit).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  test('logs and proceeds (does not exit) when the target is local', () => {
    const exit = jest.fn();
    const log = fakeLog();
    const v = assertCaptureTargetAllowed({ DATABASE_URL: url('localhost', 'app') }, { exit, log });
    expect(v.verdict).toBe('ok');
    expect(exit).not.toHaveBeenCalled();
    expect(log.log).toHaveBeenCalledWith(expect.stringContaining('localhost/app'));
  });
});

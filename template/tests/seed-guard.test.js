const { classifySeedTarget, assertSeedTargetAllowed } = require('../prisma/seed-guard');

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

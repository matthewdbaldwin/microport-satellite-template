// The migration runner must never log database credentials. Ported from
// hubport#142 (hubport 9627b44) so new satellites never inherit the leak.
//
// scripts/db-migrate.js used to end with `console.error('[db-migrate] failed:', e)`.
// Node prints the raw error's message AND stack, and a driver-level connection
// failure can put the full `postgresql://user:password@host/db` string in both.
// Those lines ship to CloudWatch. The runner must still fail loud and exit
// non-zero, but with the credentials redacted.
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { redactSecrets, formatError } = require('../scripts/lib/redactSecrets');

const SECRET = 'S3cretPa55';
const URL_WITH_CREDS = `postgresql://app_owner:${SECRET}@db.example.internal:5432/app`;

describe('redactSecrets', () => {
  test('strips userinfo from a scheme://user:password@ URL', () => {
    const out = redactSecrets(`connect failed: ${URL_WITH_CREDS}`);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain('app_owner');
    expect(out).toContain('postgresql://[REDACTED]@db.example.internal:5432/app');
  });

  test('masks a password containing an unencoded @', () => {
    expect(redactSecrets('postgresql://u:p@ss@host/db')).toBe('postgresql://[REDACTED]@host/db');
  });

  test('strips userinfo with no password (scheme://user@)', () => {
    expect(redactSecrets('postgres://someone@host/db')).toBe('postgres://[REDACTED]@host/db');
  });

  test('strips a password= query parameter', () => {
    const out = redactSecrets(`postgresql://host/db?sslmode=require&password=${SECRET}&x=1`);
    expect(out).not.toContain(SECRET);
    expect(out).toContain('password=[REDACTED]&x=1');
  });

  test('strips libpq key=value password forms, quoted or not', () => {
    expect(redactSecrets(`host=h user=u password=${SECRET} dbname=d`)).not.toContain(SECRET);
    expect(redactSecrets(`host=h password='${SECRET} with space' dbname=d`)).not.toContain(SECRET);
    expect(redactSecrets(`PASSWORD: "${SECRET}"`)).not.toContain(SECRET);
  });

  test('leaves ordinary text alone', () => {
    const msg = 'P1001: Can\'t reach database server at `db.example.internal:5432`';
    expect(redactSecrets(msg)).toBe(msg);
  });

  test('tolerates non-strings', () => {
    expect(redactSecrets(undefined)).toBe('');
    expect(redactSecrets(42)).toBe('42');
  });
});

describe('formatError', () => {
  test('keeps name, code and message, redacts message AND stack', () => {
    const e = new Error(`getaddrinfo ENOTFOUND while connecting to ${URL_WITH_CREDS}`);
    e.code = 'ENOTFOUND';
    const out = formatError(e);
    expect(e.stack).toContain(SECRET); // vacuity guard: the stack really carried it
    expect(out).not.toContain(SECRET);
    expect(out).toContain('Error');
    expect(out).toContain('ENOTFOUND');
    expect(out).toContain('getaddrinfo ENOTFOUND');
  });

  test('redacts secrets carried on a nested cause', () => {
    const e = new Error('migrate failed', { cause: new Error(`bad url ${URL_WITH_CREDS}`) });
    expect(formatError(e)).not.toContain(SECRET);
    expect(formatError(e)).toContain('bad url');
  });

  test('handles a thrown non-Error', () => {
    expect(formatError(URL_WITH_CREDS)).not.toContain(SECRET);
    expect(formatError(null)).toBe('null');
  });
});

describe('scripts/db-migrate.js end to end', () => {
  // Drives the REAL runner in a child process and inspects everything it
  // writes. The RDS CA guard throws before any network I/O and interpolates
  // RDS_CA_BUNDLE into its message, so pointing that at a path containing a
  // credentialed URL puts the connection string inside a thrown error's
  // message and stack, exactly as a driver failure would, with no database.
  test('a postgresql://user:pass@host/db string inside the error never reaches the log', () => {
    const res = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'db-migrate.js')], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        MIGRATE_DATABASE_URL: URL_WITH_CREDS,
        RDS_CA_BUNDLE: `/nonexistent/${URL_WITH_CREDS}`,
      },
      encoding: 'utf8',
      timeout: 60000,
    });
    const output = `${res.stdout}\n${res.stderr}`;
    // Vacuity guards: the runner really failed, through the catch-all.
    expect(res.status).toBe(1);
    expect(output).toContain('[db-migrate] failed:');
    expect(output).toContain('RDS CA bundle not found');
    // The point.
    expect(output).not.toContain(SECRET);
    expect(output).not.toContain(`app_owner:${SECRET}@`);
  });
});

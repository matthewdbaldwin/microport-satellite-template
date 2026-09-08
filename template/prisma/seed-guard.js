// prisma/seed-guard.js — refuse to seed a production database by accident.
//
// The seed scripts write demo users with known passwords, fixture contacts
// and test data. Run against production they would plant those rows in a
// live system (2026-09-05: a review recommended `npm run db:seed` on SalesPort
// prod — it would have upserted admin@microport.com / Admin123!).
//
// Allowed WITHOUT an override — the target is recognisably not production:
//   • DATABASE_URL host is local: localhost, 127.0.0.1, ::1, host.docker.internal,
//     or a docker-compose service name (postgres, pgbouncer, db)
//   • or the host carries a "dev" label: platform-db-dev.<id>.rds.amazonaws.com
//     (productport's dev database is plain `productport` on that host)
//   • or the database name ends in _dev, _test or _local (the other satellites
//     use <app>_dev on the dev instance)
// Refused otherwise — including the platform-db / platform-db-v2 production
// instances and an unset or unparseable DATABASE_URL — unless the caller sets
// SEED_ALLOW_PROD=1 explicitly:
//
//   SEED_ALLOW_PROD=1 DATABASE_URL=... node prisma/seed.js
//
// NODE_ENV is deliberately NOT consulted: dev containers run with
// NODE_ENV=production for parity against <app>_dev, so it would refuse a
// legitimate dev seed while saying nothing about the URL that matters.
//
// Known limitation: a production database reached through an SSH tunnel on
// localhost is allowed — the guard sees only the URL. Production access on
// this fleet is ECS exec, where DATABASE_URL is the RDS host and is refused.
//
// Pure string checks on the URL — no Prisma client, no network — so it is safe
// to call before the client is constructed.
'use strict';

const LOCAL_HOSTS = new Set([
  'localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal',
  // docker-compose service names — single-label, can never be an RDS endpoint
  'postgres', 'pgbouncer', 'db',
]);
const DEV_HOST = /(^|[.-])dev([.-]|$)/i;
const NON_PROD_DB_SUFFIX = /(_dev|_test|_local)$/i;

function parseTarget(databaseUrl) {
  if (!databaseUrl) return null;
  try {
    const url = new URL(databaseUrl);
    const host = url.hostname.toLowerCase();
    // decodeURIComponent throws on a malformed escape — treat as unparseable
    const db = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return { host, db };
  } catch {
    return null;
  }
}

/**
 * Classify a seed target from an env-like object (defaults to process.env).
 * @returns {{ allowed: boolean, reason: string, host: string|null, db: string|null }}
 */
function classifySeedTarget(env = process.env) {
  const target = parseTarget(env.DATABASE_URL);
  const host = target ? target.host : null;
  const db = target ? target.db : null;

  if (env.SEED_ALLOW_PROD === '1') {
    return { allowed: true, reason: 'SEED_ALLOW_PROD=1 override', host, db };
  }
  if (!env.DATABASE_URL) {
    return { allowed: false, reason: 'DATABASE_URL is not set', host, db };
  }
  if (!target) {
    return { allowed: false, reason: 'DATABASE_URL could not be parsed', host, db };
  }
  if (LOCAL_HOSTS.has(host)) {
    return { allowed: true, reason: `local host ${host}`, host, db };
  }
  if (DEV_HOST.test(host)) {
    return { allowed: true, reason: `dev host ${host}`, host, db };
  }
  if (NON_PROD_DB_SUFFIX.test(db)) {
    return { allowed: true, reason: `non-production database name ${db}`, host, db };
  }
  return {
    allowed: false,
    reason: `host ${host} / database ${db} is not a recognised non-production target`,
    host,
    db,
  };
}

/**
 * Log the seed target and exit the process with code 2 unless it is allowed.
 * `exit` and `log` are injectable for tests.
 */
function assertSeedTargetAllowed(env = process.env, { exit = process.exit, log = console } = {}) {
  const verdict = classifySeedTarget(env);
  const where = verdict.host ? `${verdict.host}/${verdict.db}` : '(no DATABASE_URL)';
  if (verdict.allowed) {
    log.log(`seed target ${where} — allowed (${verdict.reason})`);
    return verdict;
  }
  log.error(`REFUSING to seed ${where}: ${verdict.reason}.`);
  log.error('Seeds write demo users, fixtures and test data. If this target really is intended, re-run with SEED_ALLOW_PROD=1.');
  exit(2);
  return verdict; // reached only when `exit` was injected
}

/**
 * Classify a help-media CAPTURE target from an env-like object (defaults to
 * process.env). Deliberately STRICTER than classifySeedTarget above: a
 * capture drives a real browser session against whatever app is already
 * running, started by hand outside this process (every help-capture config
 * ships no `webServer` on purpose — recording does not parallelise), so this
 * process's own DATABASE_URL may not even be the database that app is
 * talking to. A "-dev" host or a "_dev"/"_test" database name is exactly the
 * shared-dev-Postgres scenario a capture must not write demo/fixture rows
 * into, so unlike seeding, NEITHER is treated as safe here — only a truly
 * local database is. See execport's prisma/seed/demoPlan.js for why a named
 * host-pin beats a boolean override: DEMO_SEED_EXPECT_HOST cannot be pasted
 * without first reading the host it's pinning, the way SEED_ALLOW_PROD=1 can.
 * CAPTURE_ALLOW_REMOTE_DB follows the same shape here.
 *
 * An UNSET DATABASE_URL does not refuse — it warns. Refusing would be a false
 * signal of safety's absence when the real app (not this process) may be
 * pointed at production; there is nothing here to check. It proceeds loudly
 * instead, so the operator confirms the running app's target by hand.
 *
 * @returns {{ verdict: 'ok'|'warn'|'refuse', reason: string, host: string|null, db: string|null }}
 */
function classifyCaptureTarget(env = process.env) {
  const target = parseTarget(env.DATABASE_URL);
  const host = target ? target.host : null;
  const db = target ? target.db : null;

  if (!env.DATABASE_URL) {
    return {
      verdict: 'warn',
      reason: 'DATABASE_URL is not set in this process, so it cannot be checked. '
        + 'This capture runs no webServer of its own — confirm by hand that the '
        + 'app you are recording is pointed at your LOCAL capture database.',
      host, db,
    };
  }
  if (!target) {
    return { verdict: 'refuse', reason: 'DATABASE_URL could not be parsed', host, db };
  }
  if (LOCAL_HOSTS.has(host)) {
    return { verdict: 'ok', reason: `local host ${host}`, host, db };
  }
  if (env.CAPTURE_ALLOW_REMOTE_DB && env.CAPTURE_ALLOW_REMOTE_DB === host) {
    return { verdict: 'ok', reason: `explicitly named via CAPTURE_ALLOW_REMOTE_DB=${host}`, host, db };
  }
  return {
    verdict: 'refuse',
    reason: `host ${host} is not local. Captures must run against a local database — `
      + `if you really mean to capture against ${host}, re-run with `
      + `CAPTURE_ALLOW_REMOTE_DB=${host}.`,
    host, db,
  };
}

/**
 * Log the capture DB target; exit the process with code 2 on 'refuse', warn
 * and proceed on 'warn', log and proceed on 'ok'. `exit` and `log` are
 * injectable for tests.
 */
function assertCaptureTargetAllowed(env = process.env, { exit = process.exit, log = console } = {}) {
  const verdict = classifyCaptureTarget(env);
  const where = verdict.host ? `${verdict.host}/${verdict.db}` : '(no DATABASE_URL in this process)';
  if (verdict.verdict === 'ok') {
    log.log(`capture DB target ${where} — ok (${verdict.reason})`);
    return verdict;
  }
  if (verdict.verdict === 'warn') {
    log.warn(`⚠ capture DB target unconfirmed: ${verdict.reason}`);
    return verdict;
  }
  log.error(`REFUSING to capture against ${where}: ${verdict.reason}`);
  exit(2);
  return verdict; // reached only when `exit` was injected
}

module.exports = {
  classifySeedTarget, assertSeedTargetAllowed,
  classifyCaptureTarget, assertCaptureTargetAllowed,
};

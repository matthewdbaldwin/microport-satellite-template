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

module.exports = { classifySeedTarget, assertSeedTargetAllowed };

// scripts/db-migrate.js — startup migration runner. feedback_db_migrate_pattern.
//
// Rules baked in:
//  - `prisma migrate deploy` (NEVER `db push`).
//  - Construct PrismaClient WITH the PrismaPg adapter — a bare `new PrismaClient()`
//    crashes under Prisma 7. feedback_prisma7_bare_client_trap.
//  - Migrations are NOT transactional under adapter-pg → every migration's DDL
//    must be `IF NOT EXISTS` / idempotent. feedback_prisma7_non_transactional_migrations.
//  - eu-central-1 RDS needs the CA bundle for SSL. feedback_prisma_adapter_pg_ssl.
//  - P3005 (non-empty DB, no migration history) → baseline the first migration
//    as applied instead of failing.
'use strict';

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const MIGRATE_URL = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!MIGRATE_URL) {
  console.error('[db-migrate] no DATABASE_URL / MIGRATE_DATABASE_URL');
  process.exit(1);
}

// RDS CA — local URLs don't need it; eu-central-1 RDS does. NEVER disable TLS
// verification (rejectUnauthorized:false is a MITM hole) — require the CA bundle
// and fail loud if it's missing. feedback_prisma_adapter_pg_ssl.
function sslConfig(url) {
  if (/localhost|127\.0\.0\.1/.test(url)) return undefined;
  const caPath = process.env.RDS_CA_BUNDLE || '/app/rds-ca-eu-central-1.pem';
  if (!fs.existsSync(caPath)) {
    throw new Error(
      `[db-migrate] RDS CA bundle not found at ${caPath}. Set RDS_CA_BUNDLE or ` +
      `COPY the eu-central-1 bundle into the image; refusing to connect without ` +
      `verified TLS. feedback_prisma_adapter_pg_ssl`,
    );
  }
  return { ca: fs.readFileSync(caPath, 'utf8') };
}

async function main() {
  const adapter = new PrismaPg({ connectionString: MIGRATE_URL, ssl: sslConfig(MIGRATE_URL) });
  const db = new PrismaClient({ adapter });

  try {
    execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: MIGRATE_URL } });
    console.log('[db-migrate] migrate deploy OK');
  } catch (err) {
    const out = String(err.stdout || '') + String(err.message || '');
    if (out.includes('P3005')) {
      // Non-empty DB without history — baseline the earliest migration.
      // Strict pattern (timestamp_name) so the value is safe to pass to the CLI.
      const first = fs.readdirSync('prisma/migrations').filter((d) => /^\d{14}_[a-z0-9_]+$/i.test(d)).sort()[0];
      if (first) {
        console.warn(`[db-migrate] P3005 — baselining ${first} as applied`);
        execSync(`npx prisma migrate resolve --applied ${first}`, { stdio: 'inherit', env: { ...process.env, DATABASE_URL: MIGRATE_URL } });
        execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: MIGRATE_URL } });
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

main().catch((e) => {
  console.error('[db-migrate] failed:', e);
  process.exit(1);
});

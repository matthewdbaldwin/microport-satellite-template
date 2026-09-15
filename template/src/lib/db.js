// Prisma client — Prisma 7 REQUIRES the driver adapter. A bare
// `new PrismaClient()` crashes. feedback_prisma7_bare_client_trap.
'use strict';
const fs = require('node:fs');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const url = process.env.DATABASE_URL;

// eu-central-1 RDS needs the CA bundle; NEVER disable TLS verification.
// feedback_prisma_adapter_pg_ssl.
function ssl() {
  if (!url || /localhost|127\.0\.0\.1/.test(url)) return undefined;
  const caPath = process.env.RDS_CA_BUNDLE || '/app/rds-ca-eu-central-1.pem';
  if (!fs.existsSync(caPath)) {
    throw new Error(`[db] RDS CA bundle missing at ${caPath}; refusing unverified TLS.`);
  }
  return { ca: fs.readFileSync(caPath, 'utf8') };
}

// pool cap 5 — rds_connection_pool_exhaustion.
// statement_timeout is the server-side kill switch that makes that small pool
// safe: with only 5 connections, one runaway query would otherwise hold a
// connection indefinitely and starve 20% of capacity. Postgres aborts any
// single statement past this. 30s default; DB_STATEMENT_TIMEOUT (ms) overrides.
// Matches salesport/opsport/clinicport/execport/reviewport.
const adapter = new PrismaPg({
  connectionString: url,
  ssl: ssl(),
  max: 5,
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT || '30000', 10),
});
const db = new PrismaClient({ adapter });

module.exports = db;

// prisma.config.mjs — Prisma 7 config.
//
// MUST be `.mjs` at the repo ROOT (not inside prisma/), and the Dockerfile MUST
// `COPY prisma.config.mjs ./` — otherwise `prisma migrate deploy` can't find it
// in the container and startup fails. feedback_prisma_config_mjs_not_ts.
//
// Prisma 7.8 removed `url = env()` from schema.prisma — the datasource URL for
// Migrate now lives HERE. .mjs (not .ts) so the production install (devDeps
// stripped, no TS loader) can still load it: Prisma silently skips a .ts config
// when no TS loader is present → the cryptic "datasource.url is required" error.
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

// In prod the task injects MIGRATE_DATABASE_URL (platformadmin, schema owner)
// alongside the least-priv runtime DATABASE_URL (app_runtime). db_hardening_plan.
const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;

if (!url) {
  const seen = Object.keys(process.env).filter((k) => /DB|DATABASE/i.test(k));
  // eslint-disable-next-line no-console
  console.error(
    '[prisma.config] DATABASE_URL is not set. ' +
      `DB-related env vars present: ${seen.length ? seen.join(', ') : '(none)'}.`,
  );
}

export default {
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: { url },
};

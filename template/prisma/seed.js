// prisma/seed.js — local/dev seed. Run: `npm run db:seed`.
//
// Only ever seeds a local or dev database: seed-guard.js refuses any
// DATABASE_URL that is not a local/docker-compose host, a *-dev host, or a
// *_dev / *_test / *_local database. SEED_ALLOW_PROD=1 overrides — don't.
// Keep demo users, demo rows and anything carrying a password out of
// production. Reference data that MUST reach production belongs in a
// migration or in a separate, clearly named script, not here.
require('dotenv').config();
const { assertSeedTargetAllowed } = require('./seed-guard');

// Refuses production targets (platform-db*.rds) — SEED_ALLOW_PROD=1 to override.
assertSeedTargetAllowed();

// Prisma 7 requires the PrismaPg driver adapter — a bare `new PrismaClient()`
// throws before any row is written. The app singleton carries the adapter and
// the RDS CA bundle. feedback_prisma7_bare_client_trap.
const prisma = require('../src/lib/db');

async function main() {
  // Add upserts here, keyed on a natural unique field so re-running is safe:
  //   await prisma.user.upsert({ where: { email }, update: {}, create: { ... } });
  console.log('[seed] nothing to seed yet');
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

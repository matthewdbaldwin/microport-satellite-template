#!/usr/bin/env node
// scaffold.mjs — mint a new MicroPort satellite from this template.
//
// Usage:
//   node scaffold.mjs [config.json] [--dry]
//
// Reads scaffold.config.json (or the path given), copies template/ into the
// target directory, and replaces the __TOKEN__ placeholders in both file
// CONTENTS and file PATHS. Prints the manual runbook steps the generator
// cannot do for you (AWS, CI package-access grants, contracts roles.ts edit,
// webhook secrets) at the end.
//
// Zero dependencies — Node 18+ ESM only.

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(HERE, 'template');

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const configPath = path.resolve(argv.find((a) => !a.startsWith('--')) || 'scaffold.config.json');

function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

if (!existsSync(configPath)) {
  die(`No config at ${configPath}. Copy scaffold.config.example.json → scaffold.config.json and fill it in.`);
}

const cfg = JSON.parse(await readFile(configPath, 'utf8'));

// ── Phase 0 identity → tokens ───────────────────────────────────────────────
const required = ['appName', 'appSlug', 'primaryRole', 'fkTable', 'targetDir'];
for (const k of required) if (!cfg[k]) die(`config.${k} is required`);
if (!/^[a-z][a-z0-9-]*$/.test(cfg.appSlug)) die(`appSlug must be lower-kebab (got "${cfg.appSlug}")`);
if (!['users', 'User'].includes(cfg.fkTable)) die(`fkTable must be "users" (@@map) or "User" — see feedback_prisma_migration_fk_table_naming_per_repo`);

const TOKENS = {
  __APP_NAME__: cfg.appName,                 // "ServicePort"
  __APP_SLUG__: cfg.appSlug,                 // "serviceport"
  __APP_TITLE__: cfg.appTitle || cfg.appName, // nav title
  __PRIMARY_ROLE__: cfg.primaryRole,         // "agent"
  __FK_TABLE__: cfg.fkTable,                  // "users" | "User"
  __DB_NAME__: cfg.dbName || cfg.appSlug,
};

function applyTokens(s) {
  for (const [tok, val] of Object.entries(TOKENS)) s = s.split(tok).join(val);
  return s;
}

const targetDir = path.resolve(cfg.targetDir);
if (existsSync(targetDir) && !dry) {
  die(`Target ${targetDir} already exists. Refusing to overwrite. Remove it or pick another targetDir.`);
}

// ── Walk + stamp ─────────────────────────────────────────────────────────────
let written = 0;
async function walk(srcDir, destDir) {
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const src = path.join(srcDir, e.name);
    const dest = path.join(destDir, applyTokens(e.name));
    if (e.isDirectory()) {
      if (!dry) await mkdir(dest, { recursive: true });
      await walk(src, dest);
    } else {
      const raw = await readFile(src, 'utf8');
      const out = applyTokens(raw);
      if (!dry) {
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, out, 'utf8');
      }
      written++;
      if (dry) console.log(`  would write ${path.relative(targetDir, dest)}`);
    }
  }
}

console.log(`\n▸ Minting ${cfg.appName} (${cfg.appSlug}) → ${targetDir}${dry ? '  [DRY RUN]' : ''}`);
await walk(TEMPLATE_DIR, targetDir);
console.log(`✓ ${written} files ${dry ? 'would be' : ''} stamped.\n`);

// ── The steps the generator CANNOT do (manual runbook tail) ──────────────────
const manual = `
NEXT — manual steps the generator can't do (full detail in RUNBOOK.md):

  Phase 2  Grant the new repo "Manage Actions (Read)" on EACH private
           @matthewdbaldwin/* package BEFORE first CI, or every npm ci 403s.
           (feedback_new_private_package_ci_access)
  Phase 4  Add "${cfg.appSlug}" + role "${cfg.primaryRole}" to microport-contracts
           roles.ts ROLE_CONTRACTS (ssoGrantable + mapRole) and publish, or every
           hire 403s / unknown_role at SSO login. (prd_microport_contracts)
  Phase 5  Register canonical webhook channels WEBHOOK_SECRET_<FROM>_<TO> and set
           the secret on BOTH task defs' ${cfg.appSlug}-api container.
  Phase 7  AWS: ECR repo, ECS service in microport-dev then microport (bare-named),
           ALB target group + rule, prod task role (+SES only if it emails),
           dev task-role clone MINUS ses:SendEmail, Secrets Manager + app_runtime,
           pool cap 5 / maximumPercent 150.
  Phase 8  GHA OIDC role; confirm NODE_AUTH_TOKEN is on the CI test job step.
  Phase 9  Footgun gate (recon, prisma-migrate-safe, vern, role-permission-audit,
           code-error-sweep) → ship consumers-first, SalesPort last.

  Then:  cd ${cfg.targetDir} && npm install && (cd web && npm install)
`;
console.log(manual);

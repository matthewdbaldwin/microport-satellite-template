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

// ── Fleet Manifest — collision checks against every existing App ────────────
// microport-infra/fleet.json is the one hand-edited list of every App in the
// Fleet (vocabulary + WHY in microport-contracts/src/fleet.ts). Read as a
// sibling checkout by convention — same as deploy-local (see
// ~/memory/recipes/deploy-local.md) — overridable via FLEET_JSON. A missing or
// unparsable manifest only warns: this scaffolder must still work in a
// checkout where infra isn't cloned as a sibling.
// TODO(W1.1): read fleet.json instead of this hardcoded copy of deploy-local's
// app table (devbox-tooling bin/deploy-local, verified 2026-09-13). RESOLVED
// below — but note the hardcoded table this replaced enforced apiPort
// UNIQUENESS, which fleet.ts explicitly says is wrong (reviewport and
// clinicport both listen on 4001 by design). That die()-on-collision check is
// removed, not ported forward; see the apiPort section below.
const FLEET_JSON = process.env.FLEET_JSON || path.join(HERE, '..', 'microport-infra', 'fleet.json');
let fleet = null;
try {
  const parsed = JSON.parse(await readFile(FLEET_JSON, 'utf8'));
  if (parsed && Array.isArray(parsed.apps)) {
    fleet = parsed;
  } else {
    console.warn(`⚠ Fleet Manifest at ${FLEET_JSON} has no "apps" array. Skipping fleet collision checks.`);
  }
} catch (err) {
  console.warn(`⚠ Could not read Fleet Manifest at ${FLEET_JSON} (${err.code || err.message}). Skipping fleet collision checks — this is fine if microport-infra isn't cloned as a sibling.`);
}

const alias = cfg.alias || cfg.appSlug;

if (fleet) {
  const slugHit = fleet.apps.find((a) => a.id === cfg.appSlug);
  if (slugHit) die(`appSlug "${cfg.appSlug}" collides with existing App "${slugHit.label}" (id: ${slugHit.id}) in fleet.json. Pick a different appSlug.`);

  const aliasHit = fleet.apps.find((a) => a.alias === alias);
  if (aliasHit) die(`alias "${alias}" collides with existing App "${aliasHit.label}" (id: ${aliasHit.id}) in fleet.json. Pick a different alias.`);

  const targetBase = path.basename(path.resolve(cfg.targetDir));
  const repoDirHit = fleet.apps.find((a) => a.repoDir === targetBase);
  if (repoDirHit) die(`targetDir "${cfg.targetDir}" (basename "${targetBase}") collides with existing App "${repoDirHit.label}" (id: ${repoDirHit.id})'s repoDir in fleet.json. Pick a different targetDir.`);

  const portsInUse = fleet.apps.map((a) => a.apiPort).sort((a, b) => a - b);
  console.log(`Existing API ports in use: ${portsInUse.join(', ')} — pick one that doesn't matter (ports aren't required unique) or a fresh one.`);
}

// ── API port — no uniqueness requirement ─────────────────────────────────────
// Ports are container-local, not fleet-unique (see the "API PORTS ARE NOT
// UNIQUE" note in microport-contracts/src/fleet.ts) — do not add a uniqueness
// die() here. Only sanity-check the shape.
const DEFAULT_API_PORT = 4008;
const apiPort = cfg.apiPort ?? DEFAULT_API_PORT;
if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535) {
  die(`apiPort must be an integer 1024-65535 (got ${JSON.stringify(cfg.apiPort)})`);
}

const TOKENS = {
  __APP_NAME__: cfg.appName,                 // "ServicePort"
  __APP_SLUG__: cfg.appSlug,                 // "serviceport"
  __APP_TITLE__: cfg.appTitle || cfg.appName, // nav title
  __PRIMARY_ROLE__: cfg.primaryRole,         // "agent"
  __FK_TABLE__: cfg.fkTable,                  // "users" | "User"
  __DB_NAME__: cfg.dbName || cfg.appSlug,
  __API_PORT__: String(apiPort),              // 4008
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
// Never stamp build/install artifacts: a template tree that has had `npm ci` or
// `next build` run inside it (e.g. during a driftwatch verification) must still
// mint clean. Symlinks inside node_modules also crash the utf8 read (EISDIR).
const SKIP = new Set(['node_modules', '.next', '.git', 'next-env.d.ts', 'tsconfig.tsbuildinfo', '.DS_Store']);
let written = 0;
async function walk(srcDir, destDir) {
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
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
           Also add "${cfg.appSlug}" to microport-contracts src/fleet.ts
           FLEET_MANIFEST (id, label, tagline, repoDir, alias: "${alias}",
           apiPort: ${apiPort}, webPort, stage: 'dev', flags) and publish —
           it's the single source Terraform, deploy-local, and this
           scaffolder's own collision check (above) all read against.
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

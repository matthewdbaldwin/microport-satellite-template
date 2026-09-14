#!/usr/bin/env node
// test/scaffold-fleet-check.mjs — ad-hoc smoke test for scaffold.mjs's Fleet
// Manifest awareness (W1.1). No test runner in this repo (see package.json
// scripts) — this is a plain executable Node script, not wired into `npm
// test`. Run directly: `node test/scaffold-fleet-check.mjs`.
//
// Never touches the real filesystem outside a temp dir: writes a fake
// fleet.json + scaffold config under os.tmpdir(), points scaffold.mjs at the
// fake fleet via FLEET_JSON, and always runs scaffold.mjs with --dry so
// nothing is ever minted onto disk.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCAFFOLD = path.join(HERE, '..', 'scaffold.mjs');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok — ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL — ${name}\n    ${err.message}`);
  }
}

function run(configPath, env) {
  const result = spawnSync(process.execPath, [SCAFFOLD, configPath, '--dry'], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const dir = mkdtempSync(path.join(tmpdir(), 'scaffold-fleet-check-'));

const fakeFleet = {
  manifestVersion: 1,
  apps: [
    {
      id: 'widgetport',
      label: 'WidgetPort',
      tagline: 'Widgets',
      repoDir: 'widgetport',
      alias: 'wp',
      apiPort: 4001,
      webPort: 3000,
      hub: false,
      stage: 'live',
      flags: {},
    },
    {
      id: 'gizmoport',
      label: 'GizmoPort',
      tagline: 'Gizmos',
      repoDir: 'gizmoport',
      alias: 'gp',
      apiPort: 4001, // deliberately non-unique, like reviewport/clinicport
      webPort: 3000,
      hub: false,
      stage: 'live',
      flags: {},
    },
  ],
};
const fleetPath = path.join(dir, 'fleet.json');
writeFileSync(fleetPath, JSON.stringify(fakeFleet, null, 2));

function makeConfig(overrides) {
  const cfg = {
    appName: 'ServicePort',
    appSlug: 'serviceport',
    appTitle: 'ServicePort',
    primaryRole: 'agent',
    fkTable: 'User',
    dbName: 'serviceport',
    targetDir: path.join(dir, 'serviceport'),
    apiPort: 4001, // same port as the fakes, on purpose — ports are NOT unique
    ...overrides,
  };
  const p = path.join(dir, `config-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify(cfg, null, 2));
  return p;
}

console.log('Fleet Manifest awareness — scaffold.mjs smoke test\n');

// (a) appSlug collides with an existing fleet.json id → must die() nonzero,
// with a stderr message naming the colliding App.
check('dies on appSlug collision with existing App id', () => {
  const cfgPath = makeConfig({ appSlug: 'widgetport' });
  const { code, stderr } = run(cfgPath, { FLEET_JSON: fleetPath });
  if (code === 0) throw new Error('expected non-zero exit, got 0');
  if (!stderr.includes('appSlug') || !stderr.includes('widgetport') || !stderr.includes('WidgetPort')) {
    throw new Error(`stderr did not name the collision:\n${stderr}`);
  }
});

// alias collision (distinct appSlug, alias matches an existing App's alias)
check('dies on alias collision with existing App alias', () => {
  const cfgPath = makeConfig({ appSlug: 'brandnewport', alias: 'gp' });
  const { code, stderr } = run(cfgPath, { FLEET_JSON: fleetPath });
  if (code === 0) throw new Error('expected non-zero exit, got 0');
  if (!stderr.includes('alias') || !stderr.includes('GizmoPort')) {
    throw new Error(`stderr did not name the alias collision:\n${stderr}`);
  }
});

// repoDir collision via targetDir basename
check('dies on targetDir basename collision with existing App repoDir', () => {
  const cfgPath = makeConfig({ appSlug: 'brandnewport', targetDir: path.join(dir, 'widgetport') });
  const { code, stderr } = run(cfgPath, { FLEET_JSON: fleetPath });
  if (code === 0) throw new Error('expected non-zero exit, got 0');
  if (!stderr.includes('repoDir') || !stderr.includes('WidgetPort')) {
    throw new Error(`stderr did not name the repoDir collision:\n${stderr}`);
  }
});

// (b) a genuinely novel appSlug/alias/targetDir must NOT die, and must mint
// (dry-run) successfully — including reusing an existing apiPort, since
// ports are explicitly not required to be unique.
check('mints successfully (--dry) with a novel slug, sharing an existing apiPort', () => {
  const cfgPath = makeConfig({ appSlug: 'brandnewport', alias: 'bnp', targetDir: path.join(dir, 'brandnewport') });
  const { code, stdout, stderr } = run(cfgPath, { FLEET_JSON: fleetPath });
  if (code !== 0) throw new Error(`expected exit 0, got ${code}\nstderr:\n${stderr}`);
  if (!stdout.includes('Minting')) throw new Error(`stdout missing mint banner:\n${stdout}`);
  if (!stdout.includes('Existing API ports in use: 4001, 4001')) {
    throw new Error(`stdout missing the non-unique port hint:\n${stdout}`);
  }
});

// missing/unparsable fleet.json → warn on stderr, continue, still mint (exit 0)
check('warns and continues (does not die) when FLEET_JSON is missing', () => {
  const cfgPath = makeConfig({ appSlug: 'brandnewport', alias: 'bnp', targetDir: path.join(dir, 'brandnewport2') });
  const { code, stdout, stderr } = run(cfgPath, { FLEET_JSON: path.join(dir, 'does-not-exist.json') });
  if (code !== 0) throw new Error(`expected exit 0 (warn, not die), got ${code}\nstderr:\n${stderr}`);
  if (!stderr.includes('Could not read Fleet Manifest')) {
    throw new Error(`expected a warning on stderr, got:\n${stderr}`);
  }
  if (!stdout.includes('Minting')) throw new Error(`stdout missing mint banner:\n${stdout}`);
});

rmSync(dir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n✗ ${failures} check(s) failed.\n`);
  process.exit(1);
}
console.log('\n✓ all checks passed.\n');

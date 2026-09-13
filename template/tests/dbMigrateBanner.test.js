// template#5 — scripts/db-migrate.js must print `<app>-api@<version> migrate`
// before anything that can exit, so a failed migration still names the build.
// Fleet deploy verification greps for that shape (server.js prints ` start`).
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RUNNER = path.join(__dirname, '..', 'scripts', 'db-migrate.js');
const pkg = require('../package.json');

function run(scriptPath, cwd, envOverrides) {
  const env = { ...process.env, ...envOverrides };
  for (const k of Object.keys(envOverrides)) if (envOverrides[k] === undefined) delete env[k];
  return spawnSync(process.execPath, [scriptPath], { cwd, env, encoding: 'utf8', timeout: 60000 });
}

describe('db-migrate version banner', () => {
  test('prints <name>-api@<version> migrate as the first line, before the env guard exits', () => {
    const res = run(RUNNER, path.join(__dirname, '..'), {
      DATABASE_URL: undefined,
      MIGRATE_DATABASE_URL: undefined,
    });
    const apiName = pkg.name.endsWith('-api') ? pkg.name : `${pkg.name}-api`;
    // Vacuity guard: this really is the env-guard exit path.
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('no DATABASE_URL / MIGRATE_DATABASE_URL');
    expect(res.stdout.split('\n')[0]).toBe(`${apiName}@${pkg.version} migrate`);
  });

  test('normalises a package name without the -api suffix, and precedes the requires', () => {
    // Copy the runner into a bare dir: no node_modules, so the first require
    // after the banner throws. The banner must already be out by then.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-migrate-banner-'));
    try {
      fs.mkdirSync(path.join(dir, 'scripts'));
      fs.copyFileSync(RUNNER, path.join(dir, 'scripts', 'db-migrate.js'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fooport', version: '9.8.7' }));
      const res = run(path.join(dir, 'scripts', 'db-migrate.js'), dir, {
        DATABASE_URL: undefined,
        MIGRATE_DATABASE_URL: undefined,
        NODE_PATH: undefined,
      });
      expect(res.status).not.toBe(0);
      expect(res.stdout.split('\n')[0]).toBe('fooport-api@9.8.7 migrate');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

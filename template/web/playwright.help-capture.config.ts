// web/playwright.help-capture.config.ts
// A capture run, not a test run. Separate from playwright.config.ts because
// almost every setting differs: video is always on at a fixed size, there is
// no webServer (the operator brings up the app against the local capture
// database by hand, see tools/help-media/README.md), and each spec runs as
// the role its article is written for.
//
// ⚠ There is deliberately NO webServer. Recording does not parallelise —
// two concurrent runs contend for CPU and the dropped frames land in the
// deliverable — so the operator starts the app once, by hand, and keeps the
// run serial (fullyParallel: false, workers: 1 below).
//
// It reuses e2e/auth.setup.ts unchanged, so a capture signs in exactly the
// way the test suite does.
//
// Role comes from the filename: <slug>.<role>.capture.ts.

import { defineConfig, devices } from '@playwright/test';
import { RAW_DIR } from './e2e/help-captures/helpers/paths';

const VIEWPORT = { width: 1280, height: 720 };

// The roles this app records as. Each needs a matching e2e/.auth/<role>.json
// produced by auth.setup.ts, and capture files named
// e2e/help-captures/<slug>.<role>.capture.ts.
//
// The scaffold ships one. SalesPort records as sales / admin / marketing —
// add entries here and the projects below follow without further edits.
const ROLES = ['admin'] as const;

// ── Guard ────────────────────────────────────────────────────────────
// Captures must come from the LOCAL fictional seed and must never touch
// production or a shared dev environment, either of which may hold real
// clinician and customer names. The sibling e2e config trains operators to
// export BASE_URL for exactly that kind of target, so a stray value left in a
// shell is a realistic input, not a hypothetical. This is the recording twin
// of the demo seed's own database guard: that one stops a write to a remote
// database, this one stops a recording of a remote app.
//
// Parse with the real WHATWG URL parser rather than a substring check, so
// e.g. `http://localhost.evil.example.com` is correctly rejected. Accept
// localhost, 127.0.0.1 and ::1 (including the bracketed `[::1]` form a URL's
// `.hostname` returns), compare case-insensitively, and fail closed: an
// unparseable BASE_URL is refused, not passed through.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function resolveBaseURL(raw: string | undefined): string {
  // 3100 matches the scaffold's own `next dev -p 3100`.
  if (!raw) return 'http://localhost:3100';

  let hostname: string;
  try {
    hostname = new URL(raw).hostname;
  } catch {
    console.error(`[help-capture] refusing to run: BASE_URL could not be parsed: ${raw}`);
    process.exit(2);
  }

  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!LOCAL_HOSTS.has(normalized)) {
    console.error(
      `[help-capture] refusing to run.\n` +
      `  BASE_URL: ${raw}\n` +
      `  host:     ${normalized || '(empty)'}\n` +
      `  Captures must run against localhost only, never production or a shared dev environment.`,
    );
    process.exit(2);
  }
  return raw;
}

const BASE_URL = resolveBaseURL(process.env.BASE_URL);

export default defineConfig({
  testDir: './e2e',
  // Playwright's own artifacts, not the deliverables. clip.ts writes the
  // keepers to tools/help-media/.out/<slug>/ and deletes the copy here.
  // RAW_DIR comes from paths.ts, the same module clip.ts's OUT_ROOT does,
  // so the two can't independently drift.
  outputDir: RAW_DIR,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: 'list',

  use: {
    baseURL:       BASE_URL,
    viewport:      VIEWPORT,
    video:         { mode: 'on', size: VIEWPORT },
    trace:         'off',
    screenshot:    'off',
    colorScheme:   'light',
    locale:        'en-US',
    contextOptions: {
      // Never inherit the operator's OS setting: these clips are the source
      // material, and a reduced-motion recording would flatten the app's own
      // transitions. The rendered clip still respects the reader's setting,
      // but that is MediaFigure's job, not the recorder's. This has to sit
      // under contextOptions: 'use' has no top-level reducedMotion field,
      // Playwright reads it only from here before it spreads onto
      // browser.newContext().
      reducedMotion: 'no-preference',
    },
  },

  projects: [
    // No video: these are Playwright's own setup tests, not capture
    // material, and there is nothing here worth recording or transcoding.
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { video: 'off' } },
    ...ROLES.map((role) => ({
      name: role,
      testMatch: new RegExp(`help-captures/.*\\.${role}\\.capture\\.ts`),
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORT, storageState: `./e2e/.auth/${role}.json` },
      dependencies: ['setup'],
    })),
  ],
});

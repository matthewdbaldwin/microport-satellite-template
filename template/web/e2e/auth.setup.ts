/**
 * e2e/auth.setup.ts
 * Signs in as admin once and saves the browser storage state, so the rest of
 * the suite (and the help-media capture pass) starts already authenticated
 * instead of driving the login UI in every spec.
 *
 * FLOW (three hosts, not two). __APP_NAME__ is SSO-only:
 *   1. /login auto-redirects to /api/auth/sso/start,
 *   2. which 302s to `${PORTAL_WEB}/login?sso=__APP_SLUG__&returnTo=<web>/auth/callback`,
 *   3. the portal authenticates and mints a short-lived one-time handoff code,
 *   4. /auth/callback POSTs that code to /api/auth/sso/exchange, which relays to
 *      the IdP and sets the HttpOnly `__APP_SLUG___token` cookie,
 *   5. then a FULL navigation home.
 *
 * ⚠ The broker is the HUB front door, not SalesPort — src/routes/auth.js
 * resolves `PORTAL_WEB_URL` FIRST and only falls back to the CRM host
 * (`SALESPORT_WEB_URL`). Several comments in that file and in the login page
 * still say "SalesPort login"; they predate the branded-front-door cutover.
 * So this drives the HUB's form testids (`login-identifier` /
 * `login-password` / `login-submit`), which live on the broker's page, not on
 * this app's — which is why the scaffold's own login page has no testids and
 * needs none.
 *
 * ⚠ CAVEAT, carried from the donor: this harness has NOT been verified end to
 * end from the scaffold. It is productport's file at 46def45 — the shape that
 * WAS verified against the live mesh — with the three app-specific knobs
 * parameterised. Run it once against a real satellite before trusting it.
 *
 * The three knobs a new satellite touches: APP_ORIGIN (dev port), the
 * SESSION_COOKIE name, and the credentials. Everything else is fleet-shared.
 *
 * Against a deployed dev mesh:
 *   TEST_USER_EMAIL=... TEST_USER_PASSWORD=... \
 *     BASE_URL=https://<app>-dev.microport.com npx playwright test --project=chromium
 */

import { test as setup, expect } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '.auth', 'admin.json');
// 3100 matches the scaffold's own `next dev -p 3100`.
const APP_ORIGIN = process.env.BASE_URL || 'http://localhost:3100';
const EMAIL      = process.env.TEST_USER_EMAIL    || 'cross-admin@test.local';
const PASSWORD   = process.env.TEST_USER_PASSWORD || 'Test1234!';

// The session cookie the SSO exchange sets (src/lib/cookies.js). Asserted below
// by name: a storage state saved WITHOUT it looks fine on disk and turns every
// later test into a login loop, which is a miserable thing to debug from the
// far end.
const SESSION_COOKIE = '__APP_SLUG___token';

setup('authenticate as admin', async ({ page }) => {
  await page.goto('/login');

  // /login → /api/auth/sso/start → the portal's form. Generous timeout: this is
  // two redirects across hosts, and on a cold dev server the first compile of
  // the login route dominates.
  // The broker fronts a passkey-first chooser (data-testid "panel-choose", open
  // by default) that renders ON TOP of the identifier/password form and
  // INTERCEPTS clicks on login-submit — the fields underneath still fill fine,
  // so this fails at the submit, not at the typing, which makes it look like a
  // credentials problem. Live finding from clinicport's harness (2026-08-31,
  // verified against the dev mesh); older harnesses predate it and do not
  // dismiss the chooser. Optional by design: if some environment doesn't show
  // it, we fall through to the identifier wait below unchanged.
  const usePassword = page.getByTestId('login-use-password');
  if (await usePassword.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)) {
    await usePassword.click();
  }

  await expect(page.getByTestId('login-identifier')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('login-identifier').fill(EMAIL);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();

  // Wait until we are back on the APP's own origin AND off both the login and
  // callback routes. Matching on the app ORIGIN rather than on "the host isn't
  // the hub" is load-bearing for LOCAL runs — which is exactly what the capture
  // pass is. Locally every host is localhost and only the port differs, so a
  // host-substring check silently passes while the browser is still sitting on
  // the broker. Do not replace this with a host regex.
  // Leaving the callback matters as much as leaving the login form: the code
  // exchange happens THERE, so a state snapshotted mid-handshake has no session
  // cookie yet.
  const appOrigin = new URL(APP_ORIGIN).origin;
  await page.waitForURL(
    (url) => url.origin === appOrigin && !/^\/(login|auth\/callback)\b/.test(url.pathname),
    { timeout: 25_000 },
  );
  await page.waitForLoadState('networkidle');

  // Fail loudly HERE if the handshake did not actually stick. Without this the
  // setup goes green, writes a logged-out state, and the failure resurfaces as
  // unrelated redirect loops in whatever spec happens to run first.
  const state = await page.context().storageState({ path: authFile });
  const names = state.cookies.map((c) => c.name);
  expect(
    names,
    `no ${SESSION_COOKIE} cookie after SSO — saved a signed-OUT state; got: ${names.join(', ') || '(none)'}`,
  ).toContain(SESSION_COOKIE);
});

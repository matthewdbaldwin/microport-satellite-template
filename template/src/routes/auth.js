// Auth routes — SSO start / exchange / logout / me. SalesPort is the hub.
//
// SSO shape matches the fleet (clinicport/productport/execport/reviewport are
// the reference — cross-checked 2026-08-08, driftwatch blocker):
//   1. GET  /api/auth/sso/start      → 302 to SalesPort /login?sso=__APP_SLUG__
//                                       &returnTo=<web>/auth/callback
//   2. SalesPort authenticates, mints a short-lived one-time handoff code,
//      and redirects back to <web>/auth/callback?code=...
//   3. The web callback page (SsoCallbackPage from microport-ui) POSTs the
//      code to POST /api/auth/sso/exchange, which relays it server-to-server
//      to SalesPort's /api/auth/handoff/exchange, sets the HttpOnly session
//      cookie on success, and forwards the payload verbatim. The raw JWT
//      never appears in a URL.
//
// LOOP GUARD (feedback_sso_callback_loop_trap): a denied/failed exchange is
// now surfaced INLINE on /auth/callback (SsoCallbackPage's error/accessDenied
// state), not via a server redirect back into /login. The web login page
// still honors a legacy ?sso_err=<code> param plus a sessionStorage attempt
// counter as a defense-in-depth loop brake (see web/app/login/page.tsx) —
// that pair is what breaks a redirect loop if the error signal is ever lost
// (e.g. callback → home → /auth/me 401 → /login with no query).
'use strict';
const express = require('express');
const logger = require('../lib/logger');
const { requireAuth } = require('../middleware/auth');
const { setSessionCookie, clearSessionCookie } = require('../lib/cookies');
const db = require('../lib/db');
const { buildAppLauncherApps } = require('@matthewdbaldwin/microport-contracts');

const router = express.Router();
const WEB       = process.env.WEB_ORIGIN || '';
const SALESPORT = process.env.SALESPORT_WEB_URL || process.env.SALESPORT_API_URL || '';
// Login funnels through the hub/portal host (PORTAL_WEB_URL), falling back to
// the CRM host if the split var isn't set yet. feedback pattern from productport.
const PORTAL_WEB = process.env.PORTAL_WEB_URL || SALESPORT;

// GET /api/auth/sso/start — browser entry point; redirect to SalesPort login.
router.get('/sso/start', (req, res) => {
  if (!PORTAL_WEB) return res.status(503).json({ error: 'SSO not configured on this instance.' });
  const web = WEB || `${req.protocol}://${req.get('host')}`;
  const returnTo = encodeURIComponent(`${web}/auth/callback`);
  res.redirect(`${PORTAL_WEB}/login?sso=__APP_SLUG__&returnTo=${returnTo}`);
});

// POST /api/auth/sso/exchange — satellite-side proxy for the one-time-code SSO
// handoff. The browser POSTs the short-lived code it received from SalesPort;
// we relay it server-to-server to SalesPort's /api/auth/handoff/exchange
// endpoint (bootstrap-pathed in middleware/csrf.js, so no CSRF header is
// required). The response — { token, role, redirectTo, user } — is forwarded
// verbatim to the browser. On success we also set the HttpOnly session cookie
// BEFORE returning, so the cookie-authed path is live the moment the client
// sees a 2xx. No requireAuth — the code itself is the credential.
router.post('/sso/exchange', async (req, res, next) => {
  try {
    // SSO exchange target — split off the overloaded SALESPORT_API_URL so the
    // IdP can be repointed (HubPort) without disturbing SALESPORT_API_URL's
    // other uses (theme-write, profile proxy, etc.). Unset ⇒ identical to
    // SALESPORT_API_URL.
    const idpApi = process.env.IDP_API_URL || process.env.SALESPORT_API_URL;
    if (!idpApi) {
      return res.status(503).json({ error: 'SSO not configured on this instance.' });
    }

    const { code } = req.body || {};

    const upstream = await fetch(`${idpApi.replace(/\/$/, '')}/api/auth/handoff/exchange`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Correlation-Id': req.id },
      body:    JSON.stringify({ code }),
      // Bound the IdP call — this is the login critical path; a hung hub must
      // fail the exchange fast (→ error handler), never hang the request.
      signal:  AbortSignal.timeout(10_000),
    });

    const payload = await upstream.json().catch(() => ({}));

    if (upstream.ok && payload.token) {
      setSessionCookie(res, payload.token);
    } else {
      logger.warn({ status: upstream.status, code: payload && payload.code }, '[sso] handoff exchange denied');
    }

    return res.status(upstream.status).json(payload);
  } catch (err) { next(err); }
});

router.post('/logout', requireAuth, async (req, res) => {
  if (req.sessionId) await db.session.update({ where: { id: req.sessionId }, data: { revokedAt: new Date() } }).catch(() => {});
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => res.json(req.user));

// PATCH /api/auth/me/theme — fire-and-forget relay to the IdP, which OWNS the
// theme. This app deliberately has no local `theme` column: the IdP persists
// the pick and stamps it into the SSO token's `theme` claim, and requireAuth
// reads it back from that claim (middleware/auth.js) — never from our table. A
// local column would be written and never read, so this needs no migration.
// Free-form ≤64 chars by design, so each app validates against its own ThemeId
// union; null clears.
//
// Satellites relay over the /api/service channel (per-satellite
// THEME_SERVICE_KEY, constant-time compare, fail-closed) rather than
// forwarding the caller's bearer/cookie token upstream. Inert (skip + warn)
// until IDP_API_URL + THEME_SERVICE_KEY are provisioned.
router.patch('/me/theme', requireAuth, async (req, res) => {
  const { theme } = req.body || {};
  if (theme !== null && (typeof theme !== 'string' || theme.length === 0 || theme.length > 64)) {
    return res.status(400).json({ error: 'theme must be a non-empty string ≤ 64 chars, or null to clear.' });
  }

  const idpApi     = process.env.IDP_API_URL || '';
  const serviceKey = process.env.THEME_SERVICE_KEY || '';
  if (!idpApi || !serviceKey) {
    logger.warn('IDP_API_URL/THEME_SERVICE_KEY not configured — theme write skipped');
    return res.json({ ok: true });
  }

  // Fire-and-forget: a failed upstream write must never surface to the user,
  // whose local cache still wins the session. But it MUST be visible to us —
  // checking only `.catch` is what made the original bug invisible, since fetch
  // resolves (not rejects) on a 4xx.
  fetch(`${idpApi.replace(/\/$/, '')}/api/service/users/theme`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Theme-Service-Key': serviceKey },
    body:    JSON.stringify({ email: req.user.email, theme: theme ?? null }),
  })
    .then(r => {
      if (!r.ok) logger.error({ status: r.status, idpApi }, 'IdP theme write rejected');
    })
    .catch(err => logger.error({ err: err.message, idpApi }, 'IdP theme write failed'));

  res.json({ ok: true });
});

// GET /api/auth/role-catalog — public catalog of this satellite's roles.
// SalesPort's People & Access aggregator pulls this to build the role picker.
// __PRIMARY_ROLE__ is the universal default (every employee has it); the
// others are the explicit grants an admin assigns. Keep in sync with the
// Role enum in prisma/schema.prisma and with the ROLE_CONTRACTS entry
// added in RUNBOOK Phase 4.
router.get('/role-catalog', (_req, res) => {
  res.json({
    satellite: '__APP_SLUG__',
    roles: [
      { key: '__PRIMARY_ROLE__', label: 'Primary role', description: 'Default role. Every employee has this by default — no grant needed.' },
      { key: 'admin',            label: 'Admin',         description: 'Full __APP_NAME__ administrator. Manages data + access.' },
      { key: 'superuser',        label: 'Superuser',      description: 'Platform-wide override. Grant sparingly.' },
    ],
  });
});

// GET /api/auth/app-launcher — public list of sibling MicroPort apps this
// deployment can link to (only those whose *_WEB_URL env is set). Surfaced in
// the AppSwitcher. URLs are safe to reveal publicly. The host app is excluded
// from its own list. The directory + filter/map logic is shared via
// microport-contracts (SATELLITE_DIRECTORY / buildAppLauncherApps) instead of
// a hand-copied array — every satellite used to hand-copy this array locally,
// and it drifted silently twice in prod on 2026-08-14.
router.get('/app-launcher', (_req, res) => {
  const apps = buildAppLauncherApps('__APP_SLUG__', (entry) => process.env[entry.envVar]);
  // The "Company portal" target in the app switcher lives on the hub host, not
  // the SalesPort CRM host. Echo PORTAL_WEB_URL so the switcher stops deriving
  // it from the SalesPort tile (→ CRM/portal). Null when unset → the switcher
  // keeps its legacy CRM-derived fallback.
  const portalUrl = (process.env.PORTAL_WEB_URL || '').split(',')[0].trim() || null;
  res.json({ apps, portalUrl });
});

module.exports = router;

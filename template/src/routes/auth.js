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

const router = express.Router();
const WEB       = process.env.WEB_ORIGIN || '';
const SALESPORT = process.env.SALESPORT_WEB_URL || process.env.SALESPORT_API_URL || '';

// GET /api/auth/sso/start — browser entry point; redirect to SalesPort login.
router.get('/sso/start', (req, res) => {
  if (!SALESPORT) return res.status(503).json({ error: 'SSO not configured on this instance.' });
  const web = WEB || `${req.protocol}://${req.get('host')}`;
  const returnTo = encodeURIComponent(`${web}/auth/callback`);
  res.redirect(`${SALESPORT}/login?sso=__APP_SLUG__&returnTo=${returnTo}`);
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

module.exports = router;

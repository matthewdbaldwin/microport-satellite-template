// src/lib/cookies.js
// Thin adapter over microport-auth's createCookieHelpers. The shared module owns
// the HttpOnly cookie security envelope ({ httpOnly, secure: isProd, sameSite:
// 'lax', path: '/' }) so the flag tuple can't drift per repo, plus the clear-
// path attribute mirroring and the optional "remember me" maxAgeMs override on
// setSessionCookie. This file injects the per-app cookie name(s) + the session
// Max-Age (jwtTtlSec) and re-exports the same names every call site imports,
// matching the fleet's src/lib/cookies.js (clinicport/opsport/reviewport/
// productport/execport).
//
// Sets `maxAge` on the session cookie (via jwtTtlSec()) — hand-rolling
// `res.cookie(COOKIE_NAME, token, {...})` inline with no maxAge (the prior
// scaffold shape) yields a browser-session-only cookie, which is NOT what the
// fleet intends. Routing the SSO exchange through this adapter instead is a
// kevlar hardening finding, ported from productport's 2026-08-05 fix.
//
// REFRESH COOKIE — REFRESH_COOKIE_NAME / setRefreshCookie / clearRefreshCookie
// are exported for shape parity with the fleet's lib/cookies.js, but this
// scaffold's SSO exchange (src/routes/auth.js) never requests the (access,
// refresh) pair from the IdP (no X-Satellite-Refresh header) — the IdP's
// handoff/exchange only mints a refresh token when a satellite opts in, so
// there is no server-side refresh token to carry in a cookie yet. Wiring an
// actual refresh flow (feature flag + a refreshClient.js + opportunistic-
// refresh middleware, mirroring clinicport's B1 Phase 4a.1) is a separate,
// larger change — out of scope for this scaffold.

'use strict';
const { createCookieHelpers } = require('@matthewdbaldwin/microport-auth');
const { jwtTtlSec } = require('./jwtTtl');

module.exports = createCookieHelpers({
  cookieName:         '__APP_SLUG___token',   // matches middleware/auth.js's prior inline COOKIE_NAME
  refreshCookieName:  '__APP_SLUG___refresh', // reserved, unused (see file header)
  getSessionMaxAgeMs: () => jwtTtlSec() * 1000,
});

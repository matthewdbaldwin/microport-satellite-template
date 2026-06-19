// Auth routes — SSO start / callback / logout / me. SalesPort is the hub.
//
// LOOP GUARD (feedback_sso_callback_loop_trap): the callback NEVER bounces an
// access-denied user back into the SSO entry point. On a role-deny or claims
// failure it redirects to <web>/login?sso_err=<code>, and the web login page
// honors ?sso_err (+ a sessionStorage attempt counter) to dead-end instead of
// re-looping. The pair is what breaks the redirect loop.
'use strict';
const express = require('express');
const logger = require('../lib/logger');
const { requireAuth, COOKIE_NAME } = require('../middleware/auth');
const db = require('../lib/db');

const router = express.Router();
const WEB = process.env.WEB_ORIGIN || '';
const SALESPORT = process.env.SALESPORT_WEB_URL || process.env.SALESPORT_API_URL || '';

// Kick off SSO — server-redirect to SalesPort with the hop params it recognizes.
router.get('/sso/start', (req, res) => {
  const returnTo = encodeURIComponent(`${WEB}/`);
  res.redirect(`${SALESPORT}/login?sso=__APP_SLUG__&returnTo=${returnTo}`);
});

// SSO callback — exchange the handoff, set the cookie, send the user home.
// Any access problem → /login?sso_err=<code>, NOT back to /sso/start.
router.get('/sso/callback', async (req, res) => {
  try {
    // SCAFFOLD: exchange req.query.code with SalesPort, mint a __APP_SLUG__ token
    // (createSessionAndSignToken) carrying jti, and set it as the HttpOnly cookie.
    const token = await exchangeHandoff(req.query.code); // throws SsoDenied on no-role
    res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
    return res.redirect(`${WEB}/`);
  } catch (err) {
    const code = err && err.code === 'NO_ROLE' ? 'no_role' : (err && err.code === 'CLAIMS' ? 'claims' : 'failed');
    logger.warn({ code, err: err && err.message }, '[sso] callback denied — dead-ending to /login');
    return res.redirect(`${WEB}/login?sso_err=${code}`);
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  if (req.sessionId) await db.session.update({ where: { id: req.sessionId }, data: { revokedAt: new Date() } }).catch(() => {});
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => res.json(req.user));

// SCAFFOLD: implement against SalesPort's handoff exchange. Throw an error with
// .code 'NO_ROLE' when mapContractRole returns null so the callback dead-ends.
async function exchangeHandoff(_code) {
  throw Object.assign(new Error('exchangeHandoff not implemented'), { code: 'failed' });
}

module.exports = router;

// src/middleware/limiters.js
// Rate limits, built via microport-auth's makeLimiters(), which bakes in the
// ONE correct skip policy (ciOnlySkip — CI only, NEVER NODE_ENV=development,
// so the internet-reachable AWS dev mesh stays throttled) plus the canonical
// header flags.
'use strict';
const { makeLimiters } = require('@matthewdbaldwin/microport-auth');

const { authLimiter } = makeLimiters({
  // Tight limit on the SSO token exchange — SCAFFOLD apps are pure-SSO (no
  // local login/forgot paths), so the exchange is the only pre-auth attempt
  // surface. 20 attempts / 15 min per IP, the fleet value.
  authLimiter: {
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Too many authentication attempts. Please try again later.' },
  },
});

module.exports = { authLimiter };

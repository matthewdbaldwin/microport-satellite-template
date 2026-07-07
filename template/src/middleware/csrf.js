// src/middleware/csrf.js
// CSRF guard for cookie-authed mutations. The guard logic — X-Requested-With
// requirement + Origin allowlist + mount-prefix-safe path recomposition — lives
// in microport-auth's createCsrfGuard. Per-app config is the required header
// value, any exact pre-auth bootstrap paths, and the Origin allowlist. The
// platform-standard bootstrap prefixes (/api/webhooks/, /api/sso/lifecycle) are
// the module default, so they can't drift per-repo
// (feedback_csrf_bootstrap_allowlist_drift).
// Origins are pinned to WEB_ORIGIN — the same env this app's CORS reads — NOT
// the module's FRONTEND_ORIGIN default
// (feedback_shared_module_default_replaces_per_app_env).
'use strict';

const { createCsrfGuard } = require('@matthewdbaldwin/microport-auth');

const csrfGuard = createCsrfGuard({
  headerValue: '__APP_SLUG__-web',
  bootstrapPaths: [
    // Add exact full paths that authenticate via a one-time code instead of the
    // session cookie, e.g. '/api/auth/sso/exchange' if this app adds a POST
    // exchange route. The default GET /sso/callback needs no bypass (safe method).
  ],
  allowedOrigins: () => {
    const list = (process.env.WEB_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
    return list.length ? list : ['http://localhost:3100'];
  },
});

module.exports = { csrfGuard };

// CSRF guard — mutating /api requests must carry X-Requested-With: __APP_SLUG__-web
// (a header a cross-site form can't set). Signature-authed ingress (webhooks,
// SSO lifecycle) bypass via BOOTSTRAP_PATHS — they verify their own HMAC.
// feedback_csrf_bootstrap_allowlist_drift. Fan this list out to all receivers in
// the same commit when you add an ingress route.
'use strict';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXPECTED = '__APP_SLUG__-web';

// Paths (relative to the /api mount) that authenticate via signature, not cookie.
const BOOTSTRAP_PATHS = [
  /^\/webhooks(\/|$)/,
  /^\/sso\/lifecycle(\/|$)/,
];

function csrfGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  // req.path is relative to the /api mount here; guard against mount-prefix drift.
  const p = (req.baseUrl && req.baseUrl.replace(/^\/api/, '')) + req.path;
  if (BOOTSTRAP_PATHS.some((re) => re.test(p) || re.test(req.path))) return next();
  if (req.get('X-Requested-With') !== EXPECTED) {
    return res.status(403).json({ error: 'Missing or invalid X-Requested-With header.' });
  }
  return next();
}

module.exports = { csrfGuard, BOOTSTRAP_PATHS, EXPECTED };

'use strict';
require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const pinoHttp     = require('pino-http');
const cookieParser = require('cookie-parser');
const logger       = require('./lib/logger');
const logRedact    = require('./lib/logRedact');
const { errorHandler, correlationReqId } = require('@matthewdbaldwin/microport-auth');
const { csrfGuard } = require('./middleware/csrf');
const { requireAuth, withFreshAccessToken } = require('./middleware/auth');

const app = express();
app.disable('x-powered-by');

// Trust the ALB / load-balancer proxy so rate limiters read the real
// client IP from X-Forwarded-For rather than the proxy's internal address.
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", process.env.SALESPORT_API_URL].filter(Boolean),
    },
  },
}));

const corsOrigins = (process.env.WEB_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
// Fail closed in production: with no allowlist, `origin: true` below reflects ANY
// Origin back with credentials: true, so a misconfigured task def would let any
// site make credentialed calls. Refuse to boot instead. Non-production keeps the
// permissive local-dev fallback. tests/corsFailClosed.test.js.
if (corsOrigins.length === 0 && process.env.NODE_ENV === 'production') {
  throw new Error('WEB_ORIGIN must be set in production: CORS would otherwise reflect any origin with credentials');
}
app.use(cors({ origin: corsOrigins.length ? corsOrigins : true, credentials: true }));

app.use(pinoHttp({
  logger,
  // `serializers` carries the header allowlist and MUST be passed here, not to
  // pino() — pino-http overrides the base logger's serializers, so wiring it on
  // the logger looks correct and is silently inert. See lib/logRedact.js.
  serializers: logRedact.serializers,
  genReqId: correlationReqId,
}));

// Capture the raw body so webhook receivers can verify the HMAC over the exact
// bytes. JSON parsing still runs for everyone else.
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Dual-mount health: the ALB target-group check + the same-origin /api proxy both
// hit /api/health; the bare /health stays for direct/liveness probes. Canonical
// fleet shape { status, app, timestamp, version } (matches salesport/execport +
// what the deploy-verifier / health probes parse — .app + .version).
const health = (_req, res) => res.json({
  status:    'ok',
  app:       '__APP_SLUG__',
  timestamp: new Date().toISOString(),
  version:   require('../package.json').version,
});
app.get('/health', health);
app.get('/api/health', health);

// Tight cap on the SSO exchange — this scaffold's only pre-auth attempt
// surface (pure-SSO). Mounted ahead of the CSRF guard like productport does;
// the route is bootstrap-pathed anyway.
const { authLimiter } = require('./middleware/limiters');
app.post('/api/auth/sso/exchange', authLimiter);

// CSRF guard on /api, with BOOTSTRAP_PATHS bypassing signature-authed ingress
// (webhooks/lifecycle verify their own HMAC). feedback_csrf_bootstrap_allowlist_drift.
app.use('/api', csrfGuard);
app.use('/api', withFreshAccessToken);

// ── Unauthenticated, signature-authed ingress FIRST ──────────────────────────
// Mounted BEFORE the bare-/api requireAuth routers so requireAuth doesn't 401
// the request before its own HMAC check runs. feedback_express_mount_prefix_path_check.
// Inbound SSO-lifecycle events from salesport (grant/revoke/disable/reactivate)
// + the hourly /state reconciliation probe. Fleet-canonical path + HMAC.
app.use('/api/sso/lifecycle', require('./routes/ssoLifecycle'));

// ── Auth (login/SSO callback/logout) — its own internal gating ───────────────
app.use('/api/auth', require('./routes/auth'));

// ── Authenticated business routes ────────────────────────────────────────────
app.use('/api/sample', requireAuth, require('./routes/sample'));
// SCAFFOLD: mount the platform's own routers here, each behind requireAuth.

// Outbound bug reports forward SYNCHRONOUSLY to the SalesPort central queue
// (signed, fleet pattern). bug-report-fanout.
app.use('/api/bug-reports', require('./routes/bugReports'));

// HubPort fleet-union census pull — server-to-server, HMAC-only (no cookie
// session), guarded internally by its own censusGuard (fails closed until
// HUBPORT_CENSUS_SECRET is set on this task def). Mounted ahead of that
// provisioning is safe; see the route file's header comment.
app.use('/api/internal/user-census', require('./routes/userCensus'));

// HubPort fleet conformance sweep pull (hubport#84 §9-§11) — server-to-server,
// HMAC-only (no cookie session), guarded internally by its own digestGuard
// (fails closed until HUBPORT_DIGEST_SECRET is set on this task def). Same
// mount-ordering rationale as the census route above.
app.use('/api/internal/digest-grants', require('./routes/digestGrants'));

// Error handler LAST — 5xx → generic body (no leak), 4xx surface their message,
// err.status/.code honored. From microport-auth.
app.use(errorHandler({ logger }));

module.exports = app;

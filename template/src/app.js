'use strict';
require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const pinoHttp     = require('pino-http');
const cookieParser = require('cookie-parser');
const logger       = require('./lib/logger');
const { errorHandler, correlationReqId } = require('@matthewdbaldwin/microport-auth');
const { csrfGuard } = require('./middleware/csrf');
const { requireAuth } = require('./middleware/auth');

const app = express();
app.disable('x-powered-by');

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
app.use(cors({ origin: corsOrigins.length ? corsOrigins : true, credentials: true }));

app.use(pinoHttp({ logger, genReqId: correlationReqId }));

// Capture the raw body so webhook receivers can verify the HMAC over the exact
// bytes. JSON parsing still runs for everyone else.
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get('/health', (_req, res) => res.json({ ok: true, service: '__APP_SLUG__-api', version: require('../package.json').version }));

// CSRF guard on /api, with BOOTSTRAP_PATHS bypassing signature-authed ingress
// (webhooks/lifecycle verify their own HMAC). feedback_csrf_bootstrap_allowlist_drift.
app.use('/api', csrfGuard);

// ── Unauthenticated, signature-authed ingress FIRST ──────────────────────────
// Mounted BEFORE the bare-/api requireAuth routers so requireAuth doesn't 401
// the webhook before its own HMAC check runs. feedback_express_mount_prefix_path_check.
app.use('/api/webhooks', require('./routes/webhooks'));

// ── Auth (login/SSO callback/logout) — its own internal gating ───────────────
app.use('/api/auth', require('./routes/auth'));

// ── Authenticated business routes ────────────────────────────────────────────
app.use('/api/sample', requireAuth, require('./routes/sample'));
// SCAFFOLD: mount the platform's own routers here, each behind requireAuth.

// Outbound bug reports forward to the SalesPort central queue (signed).
app.use('/api/cross-app', require('./routes/crossApp'));

// Error handler LAST — 5xx → generic body (no leak), 4xx surface their message,
// err.status/.code honored. From microport-auth.
app.use(errorHandler({ logger }));

module.exports = app;

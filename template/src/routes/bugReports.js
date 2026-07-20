// src/routes/bugReports.js — bug-report fanout (spoke side).
//
// POST /api/bug-reports — any authed user files a bug; this route forwards it
// SYNCHRONOUSLY to the central queue (POST /api/bug-reports/cross-app) so triage
// stays in one place. Signed with the __APP_SLUG__→receiver channel secret
// (HMAC-SHA256 over the payload STRING, header x-bugreport-signature). Matches
// the fleet. feedback_scaffold_bug_report_fleet_pattern.
//
// Replaced the scaffold's /api/cross-app outbox route, which enqueued to a
// never-drained outbox — reports never left the box.
//
// Hub-first forward (Matt 2026-07-09): the target is env-indirected so a fresh
// mint routes to HubPort's central queue the moment BUGREPORT_FORWARD_URL +
// BUGREPORT_FORWARD_SECRET are set, and stays on SalesPort's legacy JSON-only
// receiver until then — the prod/dev default is UNCHANGED without those vars.
//
// Screenshot parity (2026-07-11): the report carries an OPTIONAL screenshot.
// multer parses a single image (≤2 MB, mime allowlist), and the forward leg goes
// MULTIPART when a file is attached AND the target is multipart-capable (the hub,
// signalled by BUGREPORT_FORWARD_URL). Pointed at SalesPort's JSON-only receiver
// (the pre-cutover default), a file is dropped (warn) and the text leg is sent —
// the report itself is never lost.
'use strict';
const express = require('express');
const crypto  = require('crypto');
const multer  = require('multer');
const logger  = require('../lib/logger');
const { signWebhookBody, makeLimiters } = require('@matthewdbaldwin/microport-auth');
const { forwardWithRetry } = require('../lib/forwardWithRetry');
const { BugReportCrossApp } = require('@matthewdbaldwin/microport-contracts');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Canonical WEBHOOK_SECRET_<FROM>_<TO> — UPPERCASE app names. __APP_SLUG__ is the
// lowercase slug post-mint; .toUpperCase() yields the canonical env var name
// (the receiver keys the matching secret the same way). A lowercase name here
// would leave the secret undefined → reports sent unsigned → receiver 401s.
const SECRET_ENV = `WEBHOOK_SECRET_${'__APP_SLUG__'.toUpperCase()}_SALESPORT`;

// Filing rate limit (skip only when CI=true — baked into makeLimiters; the
// internet-reachable dev mesh stays throttled. feedback_rate_limiter_dev_skip).
// Keyed per user: the route sits behind requireAuth, so req.user is always set
// (anonymous requests 401 before ever reaching the limiter).
const { file: fileLimiter } = makeLimiters({
  file: {
    windowMs: 60 * 1000,
    max:      5,
    keyGenerator: (req) => `user:${req.user?.id ?? 'anon'}`,
    message:  { error: 'Too many bug reports. Please wait a minute and try again.', code: 'RATE_LIMITED' },
  },
});

// Screenshot intake: 2 MB ceiling + an image mime allowlist — the modal's
// accept="image/*" is client-side only, so the server rejects non-images itself.
// SVG is deliberately excluded (scriptable). memoryStorage is fine: the buffer is
// forwarded to the central queue inside the handler, not kept in process. This
// mirrors the hub receiver's multer exactly (signer/receiver parity).
const ALLOWED_SCREENSHOT_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_SCREENSHOT_MIMES.has(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('Screenshot must be a PNG, JPEG, WebP, or GIF image.'), { code: 'UNSUPPORTED_SCREENSHOT_TYPE' }));
  },
});
function uploadScreenshot(req, res, next) {
  upload.single('screenshot')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Screenshot must be 2 MB or smaller.' });
      if (err.code === 'UNSUPPORTED_SCREENSHOT_TYPE') return res.status(400).json({ error: err.message });
      return next(err);
    }
    next();
  });
}

// ANY authenticated user can file (anyone files; the superuser triages centrally).
// Middleware order: requireAuth (sets req.user) → fileLimiter (keys on the user; a
// throttled client never costs an upload parse) → uploadScreenshot (populates
// req.body from the multipart text fields + req.file BEFORE the handler reads
// them; a JSON request passes straight through multer untouched).
router.post('/', requireAuth, fileLimiter, uploadScreenshot, async (req, res) => {
  // Env-indirected for a clean sp→hub cutover flip: both default to the SalesPort
  // channel so prod/dev are UNCHANGED until the flip sets BUGREPORT_FORWARD_URL=<hub>
  // + BUGREPORT_FORWARD_SECRET=WEBHOOK_SECRET_${'__APP_SLUG__'.toUpperCase()}_HUBPORT.
  const base   = process.env.BUGREPORT_FORWARD_URL || process.env.SALESPORT_API_URL;
  const secret = process.env.BUGREPORT_FORWARD_SECRET || process.env[SECRET_ENV];
  if (!base) return res.status(503).json({ error: 'SalesPort integration not configured.' });

  const title = str(req.body?.title);
  if (!title) return res.status(422).json({ error: 'Title is required.' });
  // Accept either `description` (fleet) or the scaffold client's `detail`; fall
  // back to the title so the contract's required `description` is always set.
  const description = str(req.body?.description) || str(req.body?.detail) || title;
  const pageUrl     = str(req.body?.pageUrl) || str(req.body?.url);

  const payload = {
    sourceApp:     '__APP_SLUG__',
    reporterEmail: req.user.email,
    title:         title.slice(0, 200),
    description:   description.slice(0, 10000),
    pageUrl:       (pageUrl || 'https://__APP_SLUG__.microport.com/').slice(0, 2000),
    browserAgent:  str(req.body?.browserAgent).slice(0, 500) || undefined,
    viewportSize:  str(req.body?.viewportSize).slice(0, 32)  || undefined,
    appVersion:    str(req.body?.appVersion).slice(0, 32)    || undefined,
    priority:      ['low', 'normal', 'high', 'critical'].includes(req.body?.priority) ? req.body.priority : 'normal',
    // Idempotency key — pass the client key through so the receiver dedups a
    // replayed forward; fall back to a fresh UUID so a keyless submit is retry-safe.
    eventId:       str(req.body?.eventId).slice(0, 64) || crypto.randomUUID(),
  };

  // Validate-on-send against the shared contract (warn-don't-block; the receiver
  // is the hard gate). __APP_SLUG__ must be a member of BugReportCrossApp's
  // sourceApp enum in microport-contracts, or every send warns.
  const chk = BugReportCrossApp.safeParse(payload);
  if (!chk.success) {
    logger.warn({ issues: chk.error.issues }, '[bug-reports] payload not valid BugReportCrossApp — sending anyway');
  }

  // The HMAC is over the payload STRING in BOTH legs — matches the receiver's
  // verify exactly (signWebhookBody is target- and wire-format-agnostic).
  const payloadStr    = JSON.stringify(payload);
  const correlationId = req.id || crypto.randomUUID();

  // Forward multipart only to a multipart-capable target (the hub, signalled by
  // BUGREPORT_FORWARD_URL). A file present but the URL unset means we're still
  // pointed at SalesPort's JSON-only /cross-app — drop the image (warn) and send
  // the text leg, so the report still lands.
  const forwardMultipart = !!req.file && !!process.env.BUGREPORT_FORWARD_URL;

  let headers;
  let makeBody; // a FACTORY — a stream-consumed body can't be re-sent on retry.
  if (forwardMultipart) {
    // NO Content-Type — the global fetch sets the multipart boundary from the FormData.
    headers = { 'X-Correlation-Id': correlationId };
    if (secret) headers['x-bugreport-signature'] = signWebhookBody(secret, payloadStr);
    makeBody = () => {
      const form = new FormData();
      form.append('payload', payloadStr);
      form.append('screenshot', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname || 'screenshot.png');
      return form;
    };
  } else {
    if (req.file) {
      logger.warn({ eventId: payload.eventId }, '[bug-reports] screenshot dropped — forward target is JSON-only');
    }
    headers = { 'Content-Type': 'application/json', 'X-Correlation-Id': correlationId };
    if (secret) headers['x-bugreport-signature'] = signWebhookBody(secret, payloadStr);
    makeBody = () => payloadStr;
  }

  try {
    // A transient blip (receiver 5xx mid-deploy, or a connection reset) used to
    // drop the filing; forwardWithRetry retries once. Safe because the payload
    // carries an eventId the receiver dedups. Timeout still 504s (no retry).
    const upstream = await forwardWithRetry(`${base.replace(/\/$/, '')}/api/bug-reports/cross-app`, { headers, makeBody, logger });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      logger.warn({ status: upstream.status, data }, '[bug-reports] cross-app forward rejected');
      return res.status(502).json({ error: data?.error || 'SalesPort rejected the report.' });
    }
    logger.info({ bugReportId: data?.id, by: req.user.id, multipart: forwardMultipart }, '[bug-reports] forwarded to central queue');
    return res.status(201).json(data);
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      return res.status(504).json({ error: 'SalesPort is taking too long to respond.' });
    }
    logger.error({ err: err.message }, '[bug-reports] cross-app forward failed');
    return res.status(502).json({ error: 'Could not reach SalesPort.' });
  }
});

module.exports = router;

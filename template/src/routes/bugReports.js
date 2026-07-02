// src/routes/bugReports.js — bug-report fanout (spoke side).
//
// POST /api/bug-reports — any authed user files a bug; this route forwards it
// SYNCHRONOUSLY to SalesPort's central queue (POST /api/bug-reports/cross-app)
// so triage stays in one place. Signed with the __APP_SLUG__→salesport channel
// secret (HMAC-SHA256 over the JSON body, header x-bugreport-signature). Matches
// the fleet. feedback_scaffold_bug_report_fleet_pattern.
//
// Replaced the scaffold's /api/cross-app outbox route, which enqueued to a
// never-drained outbox — reports never left the box.
'use strict';
const express = require('express');
const crypto  = require('crypto');
const logger  = require('../lib/logger');
const { signWebhookBody } = require('@matthewdbaldwin/microport-auth');
const { BugReportCrossApp } = require('@matthewdbaldwin/microport-contracts');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Canonical WEBHOOK_SECRET_<FROM>_<TO> — UPPERCASE app names. __APP_SLUG__ is the
// lowercase slug post-mint; .toUpperCase() yields the canonical env var name
// (salesport's receiver keys the matching secret the same way). A lowercase name
// here would leave the secret undefined → reports sent unsigned → salesport 401s.
const SECRET_ENV = `WEBHOOK_SECRET_${'__APP_SLUG__'.toUpperCase()}_SALESPORT`;

router.post('/', requireAuth, async (req, res) => {
  const base   = process.env.SALESPORT_API_URL;
  const secret = process.env[SECRET_ENV];
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
    // Idempotency key — pass the client key through so SalesPort dedups a
    // replayed forward; fall back to a fresh UUID so a keyless submit is retry-safe.
    eventId:       str(req.body?.eventId).slice(0, 64) || crypto.randomUUID(),
  };

  // Validate-on-send against the shared contract (warn-don't-block; the receiver
  // is the hard gate).
  const chk = BugReportCrossApp.safeParse(payload);
  if (!chk.success) {
    logger.warn({ issues: chk.error.issues }, '[bug-reports] payload not valid BugReportCrossApp — sending anyway');
  }

  const bodyStr = JSON.stringify(payload);
  const headers = { 'Content-Type': 'application/json', 'X-Correlation-Id': req.id || crypto.randomUUID() };
  if (secret) headers['x-bugreport-signature'] = signWebhookBody(secret, bodyStr);

  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 10_000);
    let upstream;
    try {
      upstream = await fetch(`${base.replace(/\/$/, '')}/api/bug-reports/cross-app`, {
        method: 'POST', headers, body: bodyStr, signal: ctrl.signal,
      });
    } finally {
      clearTimeout(tid);
    }
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      logger.warn({ status: upstream.status, data }, '[bug-reports] cross-app forward rejected');
      return res.status(502).json({ error: data?.error || 'SalesPort rejected the report.' });
    }
    logger.info({ bugReportId: data?.id, by: req.user.id }, '[bug-reports] forwarded to SalesPort');
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

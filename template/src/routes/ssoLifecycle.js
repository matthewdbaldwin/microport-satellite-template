// src/routes/ssoLifecycle.js
// Inbound SSO-lifecycle webhook from salesport, mounted at /api/sso/lifecycle.
// Fleet-canonical receiver (matches opsport/reviewport/clinicport/execport):
// HMAC-verified via microport-auth's createLifecycleGuard over the raw body,
// header x-salesport-signature, shared secret SALESPORT_LIFECYCLE_SECRET.
//
// salesport's lifecycle.js/lifecycleReconciler.js target every registered
// satellite at __SATELLITE___LIFECYCLE_URL + /event (and /state), so this route
// MUST exist and match, or those deliveries 404 the moment the URL/secret are
// provisioned. See src/lib/lifecycleAction.js for the per-kind policy. Data-level
// errors return 2xx so salesport's outbox stops retrying
// (feedback_data_level_errors_must_return_2xx); only a failed audit-row write
// 5xx's so the delivery is retried.
'use strict';
const router = require('express').Router();
const { createLifecycleGuard } = require('@matthewdbaldwin/microport-auth');
const { LifecycleEvent, LifecycleStateResponse } = require('@matthewdbaldwin/microport-contracts');
const logger = require('../lib/logger');
const { decideUserUpdate, stateResponse } = require('../lib/lifecycleAction');
// db is required lazily inside handlers so this module loads for the pure-logic
// tests without the generated Prisma client present.

const lifecycleGuard = createLifecycleGuard({
  secret: process.env.SALESPORT_LIFECYCLE_SECRET || null,
  signatureHeader: 'x-salesport-signature',
  allowUnsigned: process.env.ALLOW_UNSIGNED_LIFECYCLE === 'true',
  // HubPort is the fleet grant authority: accept its x-hubport-signature too,
  // signed with HUBPORT_LIFECYCLE_SECRET. Inert until that secret is provisioned
  // (a blank secret is skipped by the guard), so this ships ahead of HubPort's
  // send-side (consumers-first) with zero behavior change.
  additionalEmitters: [
    { secret: process.env.HUBPORT_LIFECYCLE_SECRET || null, signatureHeader: 'x-hubport-signature' },
  ],
});

router.post('/event', lifecycleGuard, async (req, res) => {
  const correlationId = req.get('X-Correlation-Id') || req.id || null;
  const payload = req.body || {};

  // Validate against the shared contract. Soft-drop + alert: a malformed payload
  // can never succeed on retry, so we log an error (surfaces in Sentry) and 2xx
  // to drop it — a 4xx would make salesport's outbox retry it forever.
  const parsed = LifecycleEvent.safeParse(payload);
  if (!parsed.success) {
    logger.error({ correlationId, kind: payload.kind, issues: parsed.error.issues },
      '[sso-lifecycle] event does not match microport-contracts LifecycleEvent — dropped (soft-drop + alert)');
    return res.json({ ok: true, dropped: 'schema' });
  }
  const { email, kind, prevRole, newRole, actorEmail, actorRole } = parsed.data;
  if (!email || !kind) {
    logger.warn({ correlationId, kind }, '[sso-lifecycle] missing email/kind — dropped');
    return res.json({ ok: true, dropped: 'incomplete' });
  }

  const db = require('../lib/db');
  const normEmail = email.toLowerCase().trim();

  // Idempotency: salesport's outbox retries carry X-Lifecycle-Event-Id (its
  // LifecycleOutbox.id). A repeat delivery collides on senderEventId → short-circuit.
  const senderEventId = req.get('X-Lifecycle-Event-Id') || null;
  if (senderEventId) {
    const dup = await db.userLifecycleEvent
      .findUnique({ where: { senderEventId }, select: { id: true } })
      .catch(() => null);
    if (dup) return res.json({ ok: true, eventId: dup.id, deduplicated: true });
  }

  // Log first — the audit row must exist even if the local user doesn't. A
  // failed write is the one case we 5xx (transient) so the event is redelivered.
  let eventRow;
  try {
    eventRow = await db.userLifecycleEvent.create({
      data: {
        senderEventId, email: normEmail, kind,
        prevRole: prevRole ?? null, newRole: newRole ?? null,
        actorEmail: actorEmail ?? null, actorRole: actorRole ?? null,
        payload,
      },
    });
  } catch (err) {
    logger.error({ err: err.message, correlationId, email: normEmail, kind },
      '[sso-lifecycle] audit write failed — 5xx to allow salesport retry');
    return res.status(500).json({ error: 'Event log write failed.' });
  }

  try {
    const existing = await db.user.findUnique({
      where: { email: normEmail },
      select: { id: true, active: true },
    });
    const decision = decideUserUpdate(kind, existing);
    if (decision.data) {
      await db.user.update({ where: { id: existing.id }, data: decision.data });
    } else if (decision.skip) {
      logger.warn({ correlationId, kind, email: normEmail }, '[sso-lifecycle] unknown event kind — audit row stashed');
    }
    await db.userLifecycleEvent.update({
      where: { id: eventRow.id },
      data: { processedAt: new Date(), error: decision.skip ? 'unknown_kind' : null },
    });
    return res.json({ ok: true, eventId: eventRow.id, ...(decision.data ? { applied: true } : {}) });
  } catch (err) {
    await db.userLifecycleEvent
      .update({ where: { id: eventRow.id }, data: { error: String(err.message).slice(0, 500) } })
      .catch(() => { /* secondary failure — swallow */ });
    logger.error({ err: err.message, correlationId, email: normEmail, kind, eventId: eventRow.id },
      '[sso-lifecycle] processing failed');
    return res.status(500).json({ error: 'Processing failed.', eventId: eventRow.id });
  }
});

// Reconciliation state query — salesport's hourly reconciler POSTs here to diff
// its own appRoles/status view against the local user. HMAC-verified the same
// way as /event. Reply shape = microport-contracts LifecycleStateResponse.
router.post('/state', lifecycleGuard, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required.' });
  const db = require('../lib/db');
  try {
    const user = await db.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: { role: true, active: true },
    });
    const body = stateResponse(user);
    // Belt-and-suspenders: never emit a reply the reconciler will reject.
    LifecycleStateResponse.parse(body);
    return res.json(body);
  } catch (err) {
    logger.error({ err: err.message, email }, '[sso-lifecycle] state query failed');
    return res.status(500).json({ error: 'State query failed.' });
  }
});

module.exports = router;

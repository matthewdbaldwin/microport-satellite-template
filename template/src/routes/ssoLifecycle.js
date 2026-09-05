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
  // LifecycleOutbox.id). A repeat delivery collides on senderEventId — but the
  // row's EXISTENCE is not proof the event was applied. Only short-circuit when
  // the prior delivery actually FINISHED (processedAt set). A row with
  // processedAt still null means a prior attempt threw mid-processing (the 500
  // path below) or the process died between the audit write and processing; the
  // retry must reuse that row and re-run processing rather than be dropped as a
  // false-positive dedup. Dropping it is how a revoked user keeps access.
  // Matches execport/salesport/clinicport/productport/opsport.
  const senderEventId = req.get('X-Lifecycle-Event-Id') || null;
  let existingEvent = null;
  if (senderEventId) {
    existingEvent = await db.userLifecycleEvent
      .findUnique({ where: { senderEventId }, select: { id: true, processedAt: true } })
      .catch(() => null);
    if (existingEvent && existingEvent.processedAt) {
      return res.json({ ok: true, eventId: existingEvent.id, deduplicated: true });
    }
  }

  // Log first — the audit row must exist even if the local user doesn't. A
  // failed write is the one case we 5xx (transient) so the event is redelivered.
  let eventRow;
  if (existingEvent) {
    // Unprocessed row from a prior attempt — reuse it. senderEventId is @unique,
    // so a second create() here would throw a constraint violation.
    eventRow = existingEvent;
  } else {
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
  }

  try {
    // Atomic claim. Reusing an unprocessed row above is a READ, not a claim —
    // two concurrent deliveries of the same X-Lifecycle-Event-Id can both read
    // the same processedAt:null row and both fall through to here. This single
    // updateMany, scoped `WHERE id = ... AND processedAt IS NULL` in the SAME
    // statement that sets processedAt, is what picks one winner: Postgres
    // evaluates a statement's WHERE and its write as one indivisible operation
    // under the row lock, so the second UPDATE blocks, re-evaluates against the
    // committed value and matches zero rows. At most one caller sees count === 1;
    // the loser short-circuits exactly like the dedup response above.
    const claim = await db.userLifecycleEvent.updateMany({
      where: { id: eventRow.id, processedAt: null },
      data:  { processedAt: new Date() },
    });
    if (claim.count === 0) {
      return res.json({ ok: true, eventId: eventRow.id, deduplicated: true });
    }

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
    // Release the claim (processedAt back to null) alongside stashing the error,
    // so a genuine retry still sees this row as unprocessed and can reclaim it.
    // A failed attempt must stay retryable, never look "done".
    await db.userLifecycleEvent
      .update({ where: { id: eventRow.id }, data: { processedAt: null, error: String(err.message).slice(0, 500) } })
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

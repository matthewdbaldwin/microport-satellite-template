// Inbound webhook receiver.
//
// Rules (feedback_data_level_errors_must_return_2xx, reference_webhook_topology):
//  - VERIFY the HMAC over the raw bytes BEFORE acting (timing-safe). Bad sig → 401.
//  - Data-level errors (bad shape, unknown entity) → 2xx so the sender's outbox
//    stops retrying. Only TRANSIENT failures (DB down) → 5xx.
//  - Validate the payload against the microport-contracts schema (warn → enforce).
'use strict';
const express = require('express');
const crypto = require('node:crypto');
const logger = require('../lib/logger');

const router = express.Router();

function verifyHmac(secret, rawBody, header) {
  if (!secret || !rawBody || !header) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// POST /api/webhooks/salesport — events FROM SalesPort.
router.post('/salesport', (req, res) => {
  const secret = process.env.WEBHOOK_SECRET_SALESPORT___APP_SLUG__;
  if (!secret) return res.status(503).json({ error: 'Webhook verification not configured.' });
  if (!verifyHmac(secret, req.rawBody, req.get('X-Signature-256'))) {
    return res.status(401).json({ error: 'Invalid signature.' });
  }
  try {
    // SCAFFOLD: validate req.body against the relevant microport-contracts schema
    // (e.g. WebhookEnvelope / LifecycleEvent), warn → enforce. Malformed payload
    // is a DATA error → log + 2xx (do NOT 5xx, or the outbox retries forever).
    logger.info({ correlationId: req.get('X-Correlation-Id'), type: req.body && req.body.type }, '[webhooks] salesport event');
    return res.json({ ok: true });
  } catch (err) {
    // Only transient infra failures should 5xx.
    logger.error({ err }, '[webhooks] transient failure');
    return res.status(503).json({ error: 'Temporarily unavailable.' });
  }
});

module.exports = router;
module.exports.verifyHmac = verifyHmac; // exported for the signature boundary test

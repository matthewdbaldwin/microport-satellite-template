// Durable outbound webhook outbox — at-least-once delivery that survives
// restarts. Signing/retry/correlation-id are handled by the shared sender.
// prd_webhook_sender_offload, project_platform_state_2026-06-16.
'use strict';
const db = require('./db');
const logger = require('./logger');
const { createWebhookSender } = require('@matthewdbaldwin/microport-auth');

// One sender per channel; secret is the canonical WEBHOOK_SECRET_<FROM>_<TO>.
function senderFor(channel, secretEnv, url) {
  return createWebhookSender({
    secret: process.env[secretEnv],
    url,
    fromApp: '__APP_SLUG__',
    timeoutMs: 5000,
  });
}

// Enqueue — never throws into the request path.
async function enqueue({ channel, eventType, payload, correlationId }) {
  return db.webhookOutbox.create({
    data: { channel, eventType, payload, correlationId: correlationId || `wh_${Date.now()}` },
  });
}

// Drain — call from a periodic worker. Each row: send, mark delivered or record
// the error + bump attempts. A failed send stays in the outbox for the next tick.
async function drain({ channel, secretEnv, url, limit = 50 }) {
  const send = senderFor(channel, secretEnv, url);
  const pending = await db.webhookOutbox.findMany({
    where: { channel, deliveredAt: null },
    take: limit,
    orderBy: { createdAt: 'asc' },
  });
  for (const row of pending) {
    const res = await send({ eventType: row.eventType, payload: row.payload, correlationId: row.correlationId });
    if (res.ok) {
      await db.webhookOutbox.update({ where: { id: row.id }, data: { deliveredAt: new Date() } });
    } else {
      await db.webhookOutbox.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 }, lastError: `status ${res.status}` },
      });
      logger.warn({ id: row.id, status: res.status, channel }, '[outbox] delivery failed — will retry');
    }
  }
}

module.exports = { enqueue, drain };

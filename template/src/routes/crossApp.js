// Outbound to the SalesPort hub — bug reports forward to the central queue,
// signed with this platform's channel secret. bug-report-fanout.
'use strict';
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { enqueue } = require('../lib/webhookOutbox');

const router = express.Router();

// POST /api/cross-app/bug-report — any authed user can file.
router.post('/bug-report', requireAuth, async (req, res) => {
  const { title, detail, url } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });
  await enqueue({
    channel: '__APP_SLUG__->salesport',
    eventType: 'bug_report.filed',
    payload: {
      app: '__APP_SLUG__',
      title: String(title).slice(0, 200),
      detail: String(detail || '').slice(0, 5000),
      url: String(url || '').slice(0, 500),
      reporter: { id: req.user.id, email: req.user.email },
    },
  });
  res.status(202).json({ ok: true });
});

module.exports = router;

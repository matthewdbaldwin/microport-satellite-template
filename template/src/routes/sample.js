// Sample authed route — delete once the platform has real routes.
// Mounted behind requireAuth in app.js. SCAFFOLD.
'use strict';
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ ok: true, you: { email: req.user.email, role: req.user.role } });
});

module.exports = router;

// src/routes/userCensus.js
// HubPort fleet-union census endpoint (canonical shape — copied from
// finport/productport; only the SELECT + toDTO block below differs per app).
//
// Read-only. Returns this satellite's local users as the normalized census
// DTO so HubPort's People & Access reconcile can see who lives here WITHOUT
// direct DB access. No credential material ever leaves this satellite:
// password is read only to derive the boolean `isLocalCapable`, and the
// satellite-local `id` is never emitted — `email` (lowercased) is the sole
// join key.
//
// POST (not GET) so the HMAC binds the pagination body { cursor, take }.
// Guarded by a DEDICATED census guard verifying HubPort's
// x-hubport-signature over the raw body with the shared
// HUBPORT_CENSUS_SECRET (NOT the lifecycle secret). A blank/unset secret
// makes the guard fail CLOSED (createLifecycleGuard returns 503 with no
// emitter unless ALLOW_UNSIGNED_LIFECYCLE=true) — secure-by-default, so this
// route is safe to mount before the secret exists: it just 503s until it does.
//
// SCAFFOLD: HUBPORT_CENSUS_SECRET / hubport's own CENSUS_APPS entry for this
// app still need to be provisioned as part of onboarding (see scaffold.mjs's
// printed checklist) — this file + its app.js mount is the complete
// satellite-side half; the route is inert (503) until that checkpoint happens.

const express = require('express');
const { createLifecycleGuard } = require('@matthewdbaldwin/microport-auth');
const logger = require('../lib/logger');
const db = require('../lib/db');

const router = express.Router();

// HubPort is the caller/emitter of the census pull; verify its signature over
// the body. Dedicated secret + header (do NOT reuse the lifecycle secret).
const censusGuard = createLifecycleGuard({
  secret: process.env.HUBPORT_CENSUS_SECRET || null,
  signatureHeader: 'x-hubport-signature',
  allowUnsigned: process.env.ALLOW_UNSIGNED_LIFECYCLE === 'true', // dev only
  logger,
});

const MAX_TAKE = 500;

// ── per-app block ── (SELECT + toDTO differ per the mapper table) ──
// SCAFFOLD: this default assumes the User model has no soft-delete
// (deletedAt) and no last-login (lastLogin) tracking, matching
// prisma/schema.prisma's default shape — single `name`; nullable `password`
// (null for SSO-only users, no sentinel). Adjust the SELECT/toDTO/WHERE below
// if this satellite's schema diverges (adds deletedAt, lastLogin, etc).
const SELECT = {
  email: true,
  name: true,
  active: true,
  password: true,
  role: true,
  createdAt: true,
};
function toDTO(u) {
  return {
    email: u.email.toLowerCase(),
    name: (u.name || '').trim() || null,
    active: u.active,
    localRole: u.role,
    isLocalCapable: !!(u.password && u.password.startsWith('$2')),
    lastLoginAt: null, // SCAFFOLD does not track last-login
    createdAt: u.createdAt.toISOString(),
  };
}
const WHERE = {}; // SCAFFOLD has no soft-delete — census returns all users
// ── end per-app block ──

// POST so the HMAC binds the pagination body. Read-only.
router.post('/', censusGuard, async (req, res, next) => {
  try {
    const take = Math.min(MAX_TAKE, Math.max(1, Number(req.body?.take) || MAX_TAKE));
    const cursor = req.body?.cursor ? { email: String(req.body.cursor) } : undefined;
    const rows = await db.user.findMany({
      where: WHERE,
      select: SELECT,
      orderBy: { email: 'asc' },
      take: take + 1,
      ...(cursor ? { cursor, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    res.json({
      users: page.map(toDTO),
      nextCursor: hasMore ? page[page.length - 1].email : null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

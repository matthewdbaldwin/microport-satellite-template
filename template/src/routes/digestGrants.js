// src/routes/digestGrants.js
// Fleet conformance sweep (hubport#84) — grant-seam digest endpoint. Mirrors
// userCensus.js's shape exactly: POST so the HMAC binds the pagination body,
// guarded by a DEDICATED secret (HUBPORT_DIGEST_SECRET, not census/lifecycle),
// read-only, no field values leave this satellite — only per-record digests.
//
// SCAFFOLD: assumes the User model has `active: Boolean` and NO `deletedAt`
// column (matches prisma/schema.prisma's default shape) — the adapter's
// isLive (liveByActive) relies on notDeleted() treating an absent deletedAt
// as "not deleted", so the SELECT below omits deletedAt (there is nothing to
// select). Adjust if this satellite's schema diverges.
//
// SCAFFOLD: microport-contracts' GRANT_ADAPTERS must gain an entry keyed
// '__APP_SLUG__' before this route can produce a real digest (same onboarding
// checkpoint as the ROLE_CONTRACTS/FLEET_MANIFEST additions scaffold.mjs
// prints at the end of a mint) — until then GRANT_ADAPTERS['__APP_SLUG__'] is
// undefined and a signed request 500s instead of returning digests. The
// route is otherwise the complete satellite-side half.

const path = require('path');
const express = require('express');
const { createLifecycleGuard } = require('@matthewdbaldwin/microport-auth');
const logger = require('../lib/logger');
const { digestRecord, DIGEST_VERSION } = require('@matthewdbaldwin/microport-contracts/digest');
const { GRANT_ADAPTERS } = require('@matthewdbaldwin/microport-contracts/digestAdapters');
// microport-contracts's package.json is NOT listed in its own "exports" map,
// so `require('@matthewdbaldwin/microport-contracts/package.json')` throws
// ERR_PACKAGE_PATH_NOT_EXPORTED (verified against the real installed
// package, hubport#84 §9-§11 implementation). Resolve the main entry (an
// allowed "." export) instead and read package.json as a sibling file — an
// absolute-path require bypasses the exports-map subpath restriction.
const { version: contractsVersion } = require(
  path.join(path.dirname(require.resolve('@matthewdbaldwin/microport-contracts')), '..', 'package.json')
);
const prisma = require('../lib/db');

const router = express.Router();

const digestGuard = createLifecycleGuard({
  secret: process.env.HUBPORT_DIGEST_SECRET || null,
  signatureHeader: 'x-hubport-signature',
  allowUnsigned: process.env.ALLOW_UNSIGNED_LIFECYCLE === 'true', // dev only
  logger,
});

const MAX_TAKE = 500;
const ADAPTER = GRANT_ADAPTERS['__APP_SLUG__'];

// ── per-app block ── (SELECT differs per app's User model shape) ──
const SELECT = { email: true, role: true, active: true };
// ── end per-app block ──

router.post('/', digestGuard, async (req, res, next) => {
  try {
    const take = Math.min(MAX_TAKE, Math.max(1, Number(req.body?.take) || MAX_TAKE));
    const cursor = req.body?.cursor ? { email: String(req.body.cursor) } : undefined;
    const rows = await prisma.user.findMany({
      select: SELECT,
      orderBy: { email: 'asc' },
      take: take + 1,
      ...(cursor ? { cursor, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const asOf = new Date().toISOString();

    const digests = page
      .filter((row) => ADAPTER.isLive(row))
      .map((row) => digestRecord(row.email, row, ADAPTER.fields, {
        setFields: ADAPTER.setFields,
        falseIsAbsentFields: ADAPTER.falseIsAbsentFields,
      }));

    res.json({
      digests,
      nextCursor: hasMore ? page[page.length - 1].email : null,
      digestVersion: DIGEST_VERSION,
      contractsVersion,
      asOf,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

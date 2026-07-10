// __APP_NAME__ auth — an SSO spoke off the SalesPort hub.
//
// Hot path uses the shared, audited microport-auth verifier (RS256 + issuer +
// audience pinned, jti session lookup/revocation, SsoClaims contract check).
// Role resolution comes from the single microport-contracts map. The risky bits
// (token verify, session revocation, claims schema) are NOT reimplemented here.
// prd_canonical_auth_guard_lib, prd_microport_contracts, b1_phase4_satellite_cookie_migration.
'use strict';
const db = require('../lib/db');
const logger = require('../lib/logger');
const { createVerifier } = require('@matthewdbaldwin/microport-auth');
// contracts exports `mapRole`; alias to mapContractRole to match the fleet.
const { SsoClaims, mapRole: mapContractRole } = require('@matthewdbaldwin/microport-contracts');

const COOKIE_NAME = '__APP_SLUG___token';
const AUDIENCE    = ['__APP_SLUG__', 'microport-apps'];

// microport-auth's createVerifier takes `publicKey` (a DECODED PEM), pins RS256
// + issuer at config time, and requires `audience` to be passed AT THE VERIFY
// CALL (not in config). SALESPORT_JWT_PUBLIC_KEY is a base64-encoded PEM, so
// decode it here. Wiring `publicKeyBase64` + config-time `audience` (and calling
// verify(token) with no audience) throws "audience is required" on EVERY request
// → 401 login-loop. feedback_createverifier_wiring_publickey_call_audience.
const SALESPORT_PUBLIC_KEY = process.env.SALESPORT_JWT_PUBLIC_KEY
  ? Buffer.from(process.env.SALESPORT_JWT_PUBLIC_KEY, 'base64').toString('utf8')
  : undefined;
// Dual-key (HubPort IdP lift) — an OPTIONAL second STATIC acceptor. Unset today
// → byte-identical single-key behavior (the lib filters blank keys). Fill with
// the HubPort public key at the issuer flip so this app accepts HubPort-signed
// tokens WITHOUT a synchronized all-fleet redeploy. Pairs with the `jwks` path
// below: JWKS = rotation; this = static fallback that can never fail closed.
const SALESPORT_PUBLIC_KEY_B = process.env.SALESPORT_JWT_PUBLIC_KEY_B
  ? Buffer.from(process.env.SALESPORT_JWT_PUBLIC_KEY_B, 'base64').toString('utf8')
  : '';

const verify = createVerifier({
  publicKey:    SALESPORT_PUBLIC_KEY,
  issuer:       process.env.SALESPORT_JWT_ISSUER,
  // HubPort IdP lift — accept a second static key during the issuer flip. Empty
  // (inert) until the HubPort public key is provisioned as SALESPORT_JWT_PUBLIC_KEY_B.
  additionalKeys: [{ publicKey: SALESPORT_PUBLIC_KEY_B }],
  // Rotation-friendly JWKS path — INERT until HUBPORT_JWKS_URL is set, and even
  // then STRICTLY ADDITIVE: the static acceptors above stay the fallback, so a
  // JWKS outage can never fail auth closed. Lets HubPort rotate its signing key
  // without re-provisioning this app.
  jwks:         process.env.HUBPORT_JWKS_URL ? { url: process.env.HUBPORT_JWKS_URL, logger } : undefined,
  claimsSchema: SsoClaims,
  // bake clean, then 'enforce'. Break-glass: SSO_CLAIMS_MODE=warn (or off).
  claimsMode:   process.env.SSO_CLAIMS_MODE || 'enforce',
  logger,
});

async function requireAuth(req, res, next) {
  // Post-Phase-4: cookie is the source. Never `if (!token) return` short-circuit
  // that skips the cookie. feedback_phase4_cookie_vs_bearer_drift.
  const token = (req.cookies && req.cookies[COOKIE_NAME]) || null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  let payload;
  try {
    payload = verify(token, { audience: AUDIENCE }); // throws on bad sig/issuer/audience; claims per claimsMode
  } catch {
    return res.status(401).json({ error: 'Token expired or invalid' });
  }

  try {
    // jti-bearing tokens get a server-side session check (revocation).
    if (payload.jti) {
      const session = await db.session.findUnique({
        where: { jti: payload.jti },
        select: { id: true, revokedAt: true, expiresAt: true },
      });
      if (!session)             return res.status(401).json({ error: 'Session no longer valid. Please log in again.', code: 'SESSION_NOT_FOUND' });
      if (session.revokedAt)    return res.status(401).json({ error: 'Session has been revoked. Please log in again.', code: 'SESSION_REVOKED' });
      if (session.expiresAt < new Date()) return res.status(401).json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' });
      req.sessionId = session.id;
    }

    // ONE role map for the whole platform; null = not granted → 403 (not a loop).
    // Extract this app's wire role from the SSO claims, then map the STRING.
    const wireRole = payload.app_roles && payload.app_roles['__APP_SLUG__'];
    const role = wireRole ? mapContractRole('__APP_SLUG__', wireRole) : null;
    if (!role) {
      return res.status(403).json({
        error: 'You do not have access to __APP_NAME__. Ask your admin to grant access in SalesPort.',
        code:  'NO___APP_SLUG___ROLE',
      });
    }

    // JIT-provision against this platform's own User table.
    const user = await db.user.upsert({
      where:  { email: payload.email },
      update: { name: payload.name || undefined, role },
      create: { email: payload.email, name: payload.name || null, role },
    });
    if (!user.active) return res.status(401).json({ error: 'Account not found or disabled' });

    req.user = {
      id: user.id, email: user.email, name: user.name, role: user.role,
      theme: payload.theme || null,
      locale: payload.locale || user.locale || null,
      appRoles: payload.app_roles || {},
      isSuperuser: !!payload.is_superuser,
    };
    return next();
  } catch (err) {
    logger.error({ err }, '[auth] provisioning failed');
    return res.status(500).json({ error: 'Login failed' });
  }
}

// Role gate helper.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole, COOKIE_NAME, AUDIENCE };

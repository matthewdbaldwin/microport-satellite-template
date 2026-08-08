// src/lib/jwtTtl.js
// Thin adapter over microport-auth's createJwtTtl — the single source of truth
// for parsing JWT_EXPIRES_IN, used by the session-cookie helper (lib/cookies.js)
// so cookie Max-Age has a defined, per-app default instead of falling back to a
// browser-session-only cookie. __APP_NAME__'s access token is minted upstream by
// the IdP (SalesPort today, HubPort at a future flip) rather than signed locally,
// but the fleet convention is still to size the cookie's Max-Age off this adapter
// (8h — satellite SSO tokens are 8h by design; only the hub itself uses 30d) so a
// future JWT_EXPIRES_IN override has somewhere to land, matching the fleet's
// src/lib/jwtTtl.js (clinicport/opsport/reviewport/productport/execport).

'use strict';
const { createJwtTtl } = require('@matthewdbaldwin/microport-auth');

const { jwtTtlSec, __resetCache } = createJwtTtl({ defaultTtl: '8h' });

module.exports = { jwtTtlSec, __resetJwtTtlCache: __resetCache };

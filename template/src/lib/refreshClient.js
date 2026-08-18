// src/lib/refreshClient.js
// __APP_NAME__ refresh client. Thin adapter over microport-auth's
// createRefreshClient, which owns the wire protocol (Bearer refresh +
// X-Satellite-Token + X-Satellite-Id), the null-on-any-failure contract,
// and the revoke path.
//
// IDP_*-first WITH a SALESPORT_* fallback — matches this app's own
// existing /sso/exchange resolver (`IDP_API_URL || SALESPORT_API_URL`).
// Both unset = no refresh client target; refreshFromHub simply returns
// null (the shared lib's own contract when apiUrl()/sharedSecret() are
// falsy) and next() proceeds with no upstream call.
const { createRefreshClient } = require('@matthewdbaldwin/microport-auth');

const client = createRefreshClient({
  apiUrl:       () => process.env.IDP_API_URL || process.env.SALESPORT_API_URL,
  sharedSecret: () => process.env.IDP_REFRESH_SHARED_SECRET || process.env.SALESPORT_REFRESH_SHARED_SECRET,
  satelliteId:  '__APP_SLUG__',
});

// Single-flight: concurrent requests presenting the SAME raw refresh token
// (e.g. two browser tabs racing a near-expiry cookie) share ONE upstream
// call instead of each independently consuming it. The IdP's refresh
// tokens are single-use — a second consumer of an already-consumed token
// trips replay detection and gets the WHOLE FAMILY revoked, logging every
// sibling out. Keyed on the raw token string itself, since that's the
// only thing two concurrent callers sharing the same cookie have in
// common.
const inFlight = new Map();

function refreshFromHub(rawRefreshToken, logger) {
  if (inFlight.has(rawRefreshToken)) return inFlight.get(rawRefreshToken);
  // client.refreshFromSalesport never throws (null-on-any-failure
  // contract), so .finally always fires and this can't leak a stuck map
  // entry.
  const promise = client.refreshFromSalesport(rawRefreshToken, logger)
    .finally(() => inFlight.delete(rawRefreshToken));
  inFlight.set(rawRefreshToken, promise);
  return promise;
}

module.exports = {
  refreshFromHub,
  revokeUpstreamRefresh: client.revokeOnSalesport,
};

'use strict';
// Credential hygiene for the pino logger. pino-http logs the full req/res header
// block, which is where live credentials actually travel — so this module is
// load-bearing, not cosmetic.
//
// ── Why this is an ALLOWLIST ──────────────────────────────────────────────────
// It used to be a denylist, and the denylist failed in production. On 2026-07-31
// the live 64-char FORUM_AUTOMATION_KEY was found in cleartext in
// /ecs/hubport-api — a log group whose retention is "never expire" — because the
// list had `'*.key'` and pino's `*` is a SINGLE-LEVEL glob: it matches a property
// literally NAMED `key`, never one whose name merely ends in "key". So
// `x-forum-automation-key` was never a redaction candidate.
//
// The first fix was to enumerate the credential headers explicitly. That fix was
// ALSO incomplete — the very next sweep turned up `x-signature-256` in
// EngagePort's webhook verifier, missed because the first grep was
// case-sensitive and the header is spelled `X-Signature-256` in source. Twice in
// one session, enumerating secrets missed one.
//
// That is the argument for inverting it. A denylist fails OPEN: every new
// credential header leaks until someone remembers to add it. An allowlist fails
// CLOSED: a header nobody has classified is redacted by default, and the cost of
// forgetting is a redacted debug value instead of a leaked secret.
//
// ── Wiring: `serializers` MUST go on pinoHttp(), not on pino() ────────────────
// pino-http OVERRIDES the base logger's `serializers.req`. Verified empirically,
// not read from docs: a base-logger req serializer does not run and the header
// leaks anyway. Passing this to `pino()` would look completely correct and be
// silently inert — the same failure mode as the wildcard. So:
//
//   const { redact, serializers } = require('./lib/logRedact');
//   pino({ ..., redact })                  // base logger
//   app.use(pinoHttp({ logger, serializers, ... }))   // <- serializers HERE
//
// `redact` is kept as well, as defence in depth: it still covers non-header log
// payloads (`password`, a bare `token` field on a logged object) that a header
// serializer cannot see, and it keeps working if an app forgets the wiring above.

// Request headers safe to log in full. Everything not listed is censored.
// Add a header here only after deciding it can never carry a credential.
const SAFE_REQUEST_HEADERS = [
  // transport / content negotiation
  'host', 'user-agent', 'referer', 'accept', 'accept-encoding', 'accept-language',
  'content-type', 'content-length', 'connection', 'origin',
  'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest',
  // proxy chain — needed to resolve the real client IP behind the ALB
  'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-forwarded-port', 'x-real-ip',
  // fleet tracing — losing these blinds log-sweep and makes cross-app requests
  // untraceable, so over-redaction is its own regression
  'x-correlation-id', 'x-request-id', 'x-satellite-id', 'x-lifecycle-event-id',
  'x-requested-with', 'x-reviewport-event',
  // markers ABOUT a signature, not the signature itself
  'x-signature-intact', 'x-twilio-email-event-webhook-timestamp',
];

// Response headers safe to log. Deliberately NOT here: `set-cookie` (fresh
// session tokens ride the login/refresh response) and `location` (an SSO handoff
// redirect carries the handoff token in its query string).
const SAFE_RESPONSE_HEADERS = [
  'content-type', 'content-length', 'content-encoding', 'etag', 'vary',
  'cache-control', 'retry-after', 'access-control-allow-credentials',
  // helmet's static security headers — non-secret by definition, and worth
  // keeping visible so a CSP problem is debuggable from the logs
  'content-security-policy', 'strict-transport-security', 'referrer-policy',
  'x-content-type-options', 'x-frame-options', 'x-dns-prefetch-control',
  'x-download-options', 'x-permitted-cross-domain-policies', 'x-xss-protection',
  'cross-origin-opener-policy', 'cross-origin-resource-policy', 'origin-agent-cluster',
];

const CENSOR = '[REDACTED]';

// Censor rather than drop: the key stays visible so you can still see WHICH
// headers a request carried, which is most of the debugging value, while the
// value never reaches CloudWatch.
function censorHeaders(headers, safeList) {
  if (!headers || typeof headers !== 'object') return headers;
  const out = {};
  for (const name of Object.keys(headers)) {
    out[name] = safeList.has(name.toLowerCase()) ? headers[name] : CENSOR;
  }
  return out;
}

const SAFE_REQ = new Set(SAFE_REQUEST_HEADERS);
const SAFE_RES = new Set(SAFE_RESPONSE_HEADERS);

// These receive an ALREADY-SERIALIZED object, not a raw req/res. pino-http wraps
// whatever it is given in wrapRequestSerializer/wrapResponseSerializer
// (pino-http/logger.js:33-34), which run pino-std-serializers first and pass us
// the result. So the only job here is to censor `headers` on the object handed
// in — do not call pino.stdSerializers again.
//
// Running it a second time is how this module shipped on 2026-08-01, and it cost
// real data for a month: the second pass looks for `headersSent` and
// `getHeaders` on a plain object that has neither, so every response logged as
// `"res":{"statusCode":null}` with no headers at all, and every request lost
// `remoteAddress`/`remotePort`. Confirmed against a live /ecs/opsport-api line
// on 2026-09-02. Nothing ever failed — a status code that is always null breaks
// no test and fires no alarm, it just quietly stops answering questions.
//
// No pino parameter any more, because there is nothing left to call on it. It
// was never an injection seam either: buildSerializers is not exported and the
// only call site passed require('pino').
function buildSerializers() {
  return {
    req(s) {
      s.headers = censorHeaders(s.headers, SAFE_REQ);
      return s;
    },
    res(s) {
      s.headers = censorHeaders(s.headers, SAFE_RES);
      return s;
    },
  };
}

module.exports = {
  // Base-logger redaction. Retained as defence in depth — see the header comment.
  redact: {
    paths: [
      'password', 'passwordHash',
      'req.headers.authorization', 'req.headers.cookie',
      'res.headers["set-cookie"]',
      // token/secret/key need BOTH forms. pino's `*` is a SINGLE-LEVEL glob: it
      // matches a property exactly one level below root, so `*.token` covers
      // `{ data: { token } }` and never a bare top-level `{ token }`. Until
      // 2026-08-01 only the globs were listed, and the comment here claimed they
      // were "for bare `{ token: ... }` payloads" — the exact shape they miss.
      // Top-level credentials logged straight onto the record leaked. The
      // literals below close that; `password` was only ever safe because it is a
      // literal path too. Neither form reaches header depth — headers are
      // covered by `serializers`, not by these.
      'token', 'secret', 'key',
      '*.token', '*.secret', '*.key',
    ],
    censor: CENSOR,
  },
  serializers: buildSerializers(),
  // exported for tests / reuse
  SAFE_REQUEST_HEADERS, SAFE_RESPONSE_HEADERS, censorHeaders, CENSOR,
};

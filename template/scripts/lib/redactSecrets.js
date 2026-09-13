// scripts/lib/redactSecrets.js — strip credentials from text before it is logged.
//
// Ported from hubport#142 (hubport 9627b44). The migration runner logged its raw
// error object, and a Postgres connection failure can carry the full connection
// string in both the message and the stack. Those lines ship to CloudWatch.
//
// Deliberately dependency-free and self-contained (productport#13 and
// EngagePort#20 carry the same fix), so it lifts cleanly into a shared package
// later. Keep it pure.
'use strict';

const MASK = '[REDACTED]';

// scheme://userinfo@  — userinfo may be `user`, `user:password`, or either
// percent-encoded. Greedy up to the LAST `@` before a `/`, whitespace or quote,
// so an unencoded `@` inside a password is still fully masked, but it cannot
// swallow the path or run on into unrelated text.
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)[^\s/'"`]+@/gi;

// password=...  in a query string (`?password=x&...`) or a libpq keyword/value
// string (`password=x dbname=y`, `password='x y'`), plus `password: "x"`.
// Covers pwd/passwd/pass spellings too.
const KV_PASSWORD =
  /\b((?:password|passwd|pwd|pass)\s*[=:]\s*)(?:'[^']*'|"[^"]*"|[^\s&;,'"`]+)/gi;

function redactSecrets(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(URL_USERINFO, `$1${MASK}@`)
    .replace(KV_PASSWORD, `$1${MASK}`);
}

// Render an error for logging: name, code, redacted message and redacted stack,
// following `cause` a few levels. Never returns the raw object.
function formatError(err, depth = 0) {
  if (err === null || err === undefined) return String(err);
  if (typeof err !== 'object') return redactSecrets(err);

  const name = err.name || 'Error';
  const code = err.code ? ` [code=${redactSecrets(err.code)}]` : '';
  const message = redactSecrets(err.message);
  // The stack's first line repeats the message; include the whole thing
  // redacted so the frames still say where it broke.
  const body = err.stack ? redactSecrets(err.stack) : `${name}: ${message}`;

  let out = `${name}${code}: ${message}`;
  if (body && body !== `${name}: ${message}`) out += `\n${body}`;
  if (err.cause !== undefined && depth < 3) {
    out += `\nCaused by: ${formatError(err.cause, depth + 1)}`;
  }
  return out;
}

module.exports = { redactSecrets, formatError, MASK };

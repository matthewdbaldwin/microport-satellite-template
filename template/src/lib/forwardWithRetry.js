'use strict';
//
// forwardWithRetry — the bug-report fanout's transient-blip guard.
//
// The satellites forward a filed bug to the central queue SYNCHRONOUSLY, inside
// the user's request. A single momentary failure — a connection reset, or the
// receiver briefly 5xx-ing during a deploy — used to drop the filing outright.
// This wraps the one forward `fetch` in a BOUNDED retry: at most ONE extra
// attempt, after a short backoff, and ONLY on a transient failure.
//
// Retry is SAFE by construction: every forward carries an `eventId` and the
// receiver dedups a replayed forward (idempotent upsert), so re-sending the same
// report never double-files.
//
// What is (and isn't) a transient failure:
//   • connection error (fetch rejects, NOT AbortError) → retry
//   • receiver 5xx                                      → retry
//   • receiver 4xx (bad payload / auth / config)        → do NOT retry (return it)
//   • timeout (AbortError after timeoutMs)              → do NOT retry (rethrow)
// Not retrying on a timeout is deliberate: the forward is user-facing, and a
// second full timeout would double an already-long wait.
//
// The request body is stream-consumed on send, so a retry needs a FRESH body —
// callers pass `makeBody()` (a factory invoked once per attempt), not a value.
// The caller maps a thrown error to 502 (network) / 504 (AbortError) and a
// returned non-ok response to 502, exactly as the pre-retry code did.

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_BACKOFF_MS = 400;

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function forwardWithRetry(url, {
  headers,
  makeBody,
  method = 'POST',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = 1,
  backoffMs = DEFAULT_BACKOFF_MS,
  logger,
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
} = {}) {
  let attempt = 0; // total attempts = 1 + retries
  for (;;) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(url, { method, headers, body: makeBody(), signal: ctrl.signal });
    } catch (err) {
      // Timeout is not "transient" for our purposes — never retry, let the caller 504 it.
      if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) throw err;
      // Network error: retry once, then give up (rethrow → caller 502s it).
      if (attempt < retries) {
        attempt += 1;
        if (logger) logger.warn({ err: err.message, attempt }, '[forward-with-retry] transient network error — retrying');
        await sleepImpl(backoffMs);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(tid);
    }
    // A receiver 5xx is a transient blip (deploy / restart); retry once. 4xx is not.
    if (res.status >= 500 && attempt < retries) {
      attempt += 1;
      if (logger) logger.warn({ status: res.status, attempt }, '[forward-with-retry] receiver 5xx — retrying');
      await sleepImpl(backoffMs);
      continue;
    }
    return res;
  }
}

module.exports = { forwardWithRetry };

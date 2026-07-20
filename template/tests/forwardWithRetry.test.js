// tests/unit/forward-with-retry.test.js
//
// forwardWithRetry — the bug-report fanout's transient-blip guard (2026-07-19).
// The satellites forward a filed bug to the central queue synchronously; a single
// momentary failure (connection reset, or the receiver 5xx-ing mid-deploy) used to
// drop the filing. This wraps the one forward `fetch` in a BOUNDED retry: at most
// one extra attempt, after a short backoff, and ONLY on a transient failure.
//
// The policy pinned here:
//   • 2xx                         → return immediately (no retry)
//   • receiver 5xx                → retry once, then return the final 5xx
//   • receiver 4xx                → do NOT retry (return it — a config/payload error)
//   • network error (not Abort)   → retry once, then rethrow
//   • timeout (AbortError)        → do NOT retry, rethrow immediately
//   • body is rebuilt per attempt → makeBody() is a FACTORY (a consumed stream
//                                   body can't be re-sent), invoked once per send.
'use strict';

const { forwardWithRetry } = require('../src/lib/forwardWithRetry');

const noSleep = () => Promise.resolve();
const resp = (status) => ({ status, ok: status >= 200 && status < 300, json: async () => ({}) });

describe('forwardWithRetry', () => {
  test('returns immediately on a 2xx — one attempt, one body build', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(resp(201));
    const makeBody = jest.fn(() => 'body');
    const res = await forwardWithRetry('u', { headers: {}, makeBody, fetchImpl, sleepImpl: noSleep });
    expect(res.status).toBe(201);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(makeBody).toHaveBeenCalledTimes(1);
  });

  test('retries once on a receiver 5xx, then returns the 2xx — with a FRESH body', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(resp(503)).mockResolvedValueOnce(resp(201));
    const makeBody = jest.fn(() => 'body');
    const res = await forwardWithRetry('u', { headers: {}, makeBody, fetchImpl, sleepImpl: noSleep });
    expect(res.status).toBe(201);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(makeBody).toHaveBeenCalledTimes(2); // factory invoked per attempt
  });

  test('returns the final 5xx when the retry also 5xxes (bounded — no infinite loop)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(resp(502));
    const res = await forwardWithRetry('u', { headers: {}, makeBody: () => 'b', fetchImpl, sleepImpl: noSleep });
    expect(res.status).toBe(502);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // 1 + 1 retry
  });

  test('does NOT retry a 4xx — returns it after a single attempt', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(resp(400));
    const res = await forwardWithRetry('u', { headers: {}, makeBody: () => 'b', fetchImpl, sleepImpl: noSleep });
    expect(res.status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('retries once on a network error, then succeeds', async () => {
    const fetchImpl = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('ECONNRESET'), { name: 'TypeError' }))
      .mockResolvedValueOnce(resp(201));
    const res = await forwardWithRetry('u', { headers: {}, makeBody: () => 'b', fetchImpl, sleepImpl: noSleep });
    expect(res.status).toBe(201);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('rethrows a network error after the retry is exhausted', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(Object.assign(new Error('down'), { name: 'TypeError' }));
    await expect(forwardWithRetry('u', { headers: {}, makeBody: () => 'b', fetchImpl, sleepImpl: noSleep }))
      .rejects.toThrow('down');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('does NOT retry on a timeout (AbortError) — rethrows immediately', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(forwardWithRetry('u', { headers: {}, makeBody: () => 'b', fetchImpl, sleepImpl: noSleep }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no retry on timeout
  });
});

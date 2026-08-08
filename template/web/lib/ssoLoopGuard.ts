// SSO auto-redirect brake.
//
// Any login page that auto-redirects to SSO with no human in the loop (see
// app/login/page.tsx) needs a machine brake, or a failing session loops
// forever: login → SSO → callback denies → /login → SSO → … If this
// satellite's login page instead renders a form and only redirects on
// explicit user action, the brake is inert but still safe to keep wired.
//
// FAIL-CLOSED BY DESIGN. This used to live inline in the login page as one
// try/catch that returned `false` ("no loop") on ANY storage exception. That
// is fail-OPEN, and it disabled the brake in precisely the browser most
// likely to throw: Safari with "Block all cookies" (and private-mode
// variants) throws on sessionStorage ACCESS, not just write. A browser
// refusing storage is also refusing the session cookie, so the login could
// never succeed AND the brake could never trip — an infinite redirect loop
// with no way out. See ssoLoopGuard.test.ts for the regression coverage.

export const LOOP_WINDOW_MS = 12_000;
export const LOOP_MAX = 2; // a 3rd redirect inside the window is a loop

/**
 * Record a redirect attempt and report whether we are in a runaway loop.
 * Returns TRUE (brake on → dead-end to the manual button) when storage is
 * unavailable, because an uncountable loop must be assumed to be a loop.
 *
 * @param key  per-app sessionStorage key, e.g. '<app-slug>_sso_attempts'
 * @param now  injectable clock for tests
 */
export function tripsLoop(key: string, now: number = Date.now()): boolean {
  let store: Storage;
  try {
    store = window.sessionStorage;
    store.getItem(key); // Safari throws HERE when storage is blocked.
  } catch {
    return true; // cannot count → fail CLOSED
  }

  // A corrupt/hand-edited value is NOT a storage failure: treat it as an empty
  // history so the write below self-heals, rather than dead-ending the user
  // permanently on a bad JSON blob.
  let hist: number[] = [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(key) || '[]');
    if (Array.isArray(parsed)) hist = parsed.filter((t): t is number => typeof t === 'number');
  } catch { /* corrupt → empty */ }

  const recent = hist.filter((t) => now - t < LOOP_WINDOW_MS);
  recent.push(now);

  try {
    store.setItem(key, JSON.stringify(recent));
  } catch {
    return true; // quota/blocked on write → also uncountable → fail CLOSED
  }

  return recent.length > LOOP_MAX;
}

/** Reset the counter — the manual "Try again" path re-enters SSO once. */
export function clearLoop(key: string): void {
  try { window.sessionStorage.removeItem(key); } catch { /* ignore */ }
}

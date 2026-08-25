// web/lib/api.ts — the single fetch wrapper.
//
//  - Sets X-Requested-With: __APP_SLUG__-web so the API's CSRF guard passes;
//    a raw XHR/fetch without it 403s. feedback_csrf_bootstrap_allowlist_drift.
//  - Surfaces 422 validation `details` on ApiError so forms can show field
//    errors. feedback_validation_details_must_propagate.
//  - Auto-logout on 401 is scoped to /auth/me ONLY — a 401 from a proxied
//    downstream must not cascade the whole app to logout. feedback_proxy_401_cascade.

export class ApiError extends Error {
  status: number;
  details?: unknown;
  code?: string;
  constructor(status: number, message: string, details?: unknown, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('X-Requested-With', '__APP_SLUG__-web');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const res = await fetch(path.startsWith('/') ? path : `/api/${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && path.includes('/auth/me')) {
    // Only the identity probe triggers a redirect to login — and only when
    // we aren't already there. Without the pathname check, a 401 while
    // already on /login reassigns window.location.href to the SAME URL.
    // Chrome/Firefox silently no-op that, but iOS Safari performs a genuine
    // reload — which remounts AuthContext, re-fires the one-shot /auth/me
    // probe, 401s again, and repeats. A ~300ms flash-reload loop that never
    // reaches the sign-in button, confirmed live in prod 2026-08-25.
    //
    // /auth/* (the SSO callback) is exempt for a different reason: the
    // root-layout AuthProvider probes /auth/me the instant /auth/callback
    // loads — BEFORE the callback page's POST /sso/exchange has set the
    // cookie — so this 401 is EXPECTED there. Navigating away races the
    // in-flight exchange; on a slow device the navigation wins every round,
    // the cookie never lands, and the /login loop brake dead-ends a user
    // whose hub session is perfectly valid (one iPhone, 2026-08-25). The
    // callback page owns its own error UX; leave it alone.
    if (
      typeof window !== 'undefined' &&
      window.location.pathname !== '/login' &&
      !window.location.pathname.startsWith('/auth/')
    ) {
      window.location.href = '/login';
    }
  }

  const text = await res.text();
  const body = text ? safeJson(text) : null;

  if (!res.ok) {
    const message = (body && (body.error || body.message)) || `Request failed (${res.status})`;
    throw new ApiError(res.status, message, body && body.details, body && body.code);
  }
  return body as T;
}

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return { error: s }; }
}

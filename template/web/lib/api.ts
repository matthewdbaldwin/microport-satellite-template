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
    // Only the identity probe triggers a redirect to login.
    if (typeof window !== 'undefined') window.location.href = '/login';
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

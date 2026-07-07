// Server-side bootstrap. Next.js calls register() once per server runtime.
// Loads sentry.server.config or sentry.edge.config depending on which
// runtime the file is being evaluated in (NEXT_RUNTIME is set by Next.js).
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Hook for App Router request-handler errors (server actions, route handlers).
export const onRequestError = Sentry.captureRequestError;

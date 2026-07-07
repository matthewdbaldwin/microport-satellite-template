// Edge runtime Sentry init. Stub for any future edge routes.
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,

  release: process.env.NEXT_PUBLIC_APP_VERSION
    ? `__APP_SLUG__-web@${process.env.NEXT_PUBLIC_APP_VERSION}`
    : undefined,

  enabled:
    process.env.NODE_ENV !== 'development' ||
    process.env.SENTRY_DEV === '1',
});

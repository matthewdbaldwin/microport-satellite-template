// Browser-runtime Sentry init. Next.js auto-loads this file once on the
// client. Keep it minimal — DSN + sampling + environment.
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  integrations: [
    Sentry.browserTracingIntegration(),
  ],

  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Sentry tags every event with `environment`. NEXT_PUBLIC_SENTRY_ENVIRONMENT
  // is baked at build time (deploy-dev.yml sets it to "development"); prod builds
  // don't pass it, so it falls back to NODE_ENV ("production"). Keeps dev events
  // out of the prod issue stream.
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,

  release: process.env.NEXT_PUBLIC_APP_VERSION
    ? `__APP_SLUG__-web@${process.env.NEXT_PUBLIC_APP_VERSION}`
    : undefined,

  // Don't send events from local dev unless explicitly opted in.
  enabled:
    process.env.NODE_ENV !== 'development' ||
    process.env.NEXT_PUBLIC_SENTRY_DEV === '1',
});

// Required for App Router navigation tracking.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

// next.config.js — MUST be .js, never .ts. A next.config.ts builds fine locally
// and breaks the production build. feedback_next_config_ts_prod.
const createNextIntlPlugin = require('next-intl/plugin');
const { withSentryConfig } = require('@sentry/nextjs');
const withNextIntl = createNextIntlPlugin('./i18n.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Proxy /api → the __APP_NAME__ API so the web app stays same-origin.
    return [{ source: '/api/:path*', destination: `${process.env.API_ORIGIN || 'http://localhost:4100'}/api/:path*` }];
  },
};

// Wrap with Sentry for source-map upload (SENTRY_AUTH_TOKEN at build time) and
// the /monitoring tunnel that routes Sentry traffic through the Next.js server
// to bypass ad-blockers. Fleet-standard wiring; create the <slug>-web Sentry
// project + set the NEXT_PUBLIC_SENTRY_DSN / SENTRY_AUTH_TOKEN repo secrets at
// mint time (see the scaffold runbook).
module.exports = withSentryConfig(withNextIntl(nextConfig), {
  org:               process.env.SENTRY_ORG     || 'microport-c0',
  project:           process.env.SENTRY_PROJECT || '__APP_SLUG__-web',
  authToken:         process.env.SENTRY_AUTH_TOKEN,
  silent:            !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute:       '/monitoring',
  webpack: {
    treeshake: { removeDebugLogging: true },
  },
});

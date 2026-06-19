// next.config.js — MUST be .js, never .ts. A next.config.ts builds fine locally
// and breaks the production build. feedback_next_config_ts_prod.
const createNextIntlPlugin = require('next-intl/plugin');
const withNextIntl = createNextIntlPlugin('./i18n.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Proxy /api → the __APP_NAME__ API so the web app stays same-origin.
    return [{ source: '/api/:path*', destination: `${process.env.API_ORIGIN || 'http://localhost:4100'}/api/:path*` }];
  },
};

module.exports = withNextIntl(nextConfig);

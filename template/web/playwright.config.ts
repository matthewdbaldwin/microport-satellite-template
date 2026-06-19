import { defineConfig } from '@playwright/test';

// BASE_URL (when set) targets a live env and suppresses the local webServer.
// Local runs boot the dev server on 3100 (avoid the 3001 collision trap).
// feedback_playwright_railway.
const baseURL = process.env.BASE_URL || 'http://localhost:3100';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL },
  webServer: process.env.BASE_URL
    ? undefined
    : { command: 'npm run dev', url: baseURL, reuseExistingServer: true, timeout: 120_000 },
});

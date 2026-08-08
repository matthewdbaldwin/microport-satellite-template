import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Component-test harness for the web app. jsdom env + React Testing Library.
// CSS-module imports resolve to a class-name proxy via vitest's default css
// handling, so no PostCSS/Tailwind pipeline is needed here.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', 'e2e/**', '.next/**'],
  },
});

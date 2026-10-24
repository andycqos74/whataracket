import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tools/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Nothing is built yet; remove once the first tests land.
    passWithNoTests: true,
    // Workflow tests use Temporal's time-skipping test server.
    testTimeout: 60_000,
  },
});

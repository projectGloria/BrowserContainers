import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so unit tests don't spin up the crx plugin / manifest pipeline.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});

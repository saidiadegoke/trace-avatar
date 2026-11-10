import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    environment: 'node',
    // Node 25+ puts its own Web Storage in place of happy-dom's (see the file).
    setupFiles: ['tests/unit/setup-storage.ts'],
    coverage: { provider: 'v8', include: ['src/**'], reporter: ['text-summary'] },
  },
});

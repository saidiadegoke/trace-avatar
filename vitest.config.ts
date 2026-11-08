import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    environment: 'node',
    coverage: { provider: 'v8', include: ['src/**'], reporter: ['text-summary'] },
  },
});

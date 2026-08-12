import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts', 'src/create-runtime.ts'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: {
        statements: 90,
        branches: 75,
        functions: 95,
        lines: 90,
      },
    },
  },
});

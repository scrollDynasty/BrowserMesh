import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
    coverage: { reporter: ['text', 'html'] },
  },
});

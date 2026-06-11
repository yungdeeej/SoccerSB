import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    // DB-backed tests share state — run serially
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }
  }
});

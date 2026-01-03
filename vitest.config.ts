import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.{test,spec}.ts',
        'src/api/start.ts',
        'src/api/smoke-admin.ts',
        // Type-only files (no executable code)
        'src/models/**/*.ts',
        'src/engine/scoring.ts',
        // Worker pool (requires integration tests, spawns processes)
        'src/engine/highs-pool.ts',
        // Worker (IPC via stdin/stdout, tested via integration)
        'src/engine/highs-worker.ts',
      ]
    },
    testTimeout: 30000, // HiGHS kan ta tid
    pool: 'forks', // Bättre isolation för WASM
  }
});

import { defineConfig } from 'vitest/config'

/**
 * Vitest config. happy-dom gives us a fast DOM stub for tests that touch
 * window / document (URL state, label cleaning, etc.). Test files live
 * alongside their source as `*.test.ts`.
 */
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
    },
  },
})

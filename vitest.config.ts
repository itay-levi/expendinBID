import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text'],
      // Pure logic only. React/R3F components and Next route handlers are covered by the
      // browser-level checks instead — counting them here would inflate the number without
      // adding real assurance. See ARCHITECTURE.md §24 on the testing split.
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/*.test.ts', 'lib/demo/**', 'lib/logger.ts'],
    },
  },
})

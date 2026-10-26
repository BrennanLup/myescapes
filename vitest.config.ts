import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'jsdom',
    globals: false,
    // Builds one migrated PGlite template per run for createTestDb() (server/db/testing.ts).
    globalSetup: ['server/db/test-global-setup.ts'],
    // PGlite boots a WASM Postgres per test file; give hooks room on a busy machine.
    hookTimeout: 60_000,
  },
})

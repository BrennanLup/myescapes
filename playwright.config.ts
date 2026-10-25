import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 3100)
// Seed mode writes added entries to DATA_DIR; give every run a throwaway one so
// e2e never touches the real `.data/` store.
const DATA_DIR = process.env.E2E_DATA_DIR ?? mkdtempSync(path.join(tmpdir(), 'myescapes-e2e-'))

export default defineConfig({
  testDir: 'e2e',
  // Software WebGL (SwiftShader) is slow: give each test plenty of room.
  timeout: 300_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    actionTimeout: 60_000,
    navigationTimeout: 90_000,
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `npm run build && npm run serve`,
    url: `http://localhost:${PORT}/health`,
    env: {
      PORT: String(PORT),
      DATA_DIR,
      // e2e always exercises the offline paths, whatever the local .env says.
      ANTHROPIC_API_KEY: '',
      GOOGLE_SHEET_ID: '',
      GOOGLE_SERVICE_ACCOUNT_JSON: '',
    },
    // Reusing a server would also reuse its data dir; opt in explicitly.
    reuseExistingServer: !!process.env.E2E_REUSE_SERVER,
    timeout: 180_000,
  },
})

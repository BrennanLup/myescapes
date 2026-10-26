import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 3100)
// The seed demo overlay and the local PGlite database both live in DATA_DIR; give every run a
// throwaway one so e2e never touches the real `.data/` store.
const DATA_DIR = process.env.E2E_DATA_DIR ?? mkdtempSync(path.join(tmpdir(), 'myescapes-e2e-'))
// A real local Postgres when one is given (e.g. postgres://e2e:e2e@localhost:5432/myescapes_e2e);
// otherwise the in-process PGlite database in DATA_DIR. e2e/support/prepare-db.ts recreates it
// (local *e2e* databases only), migrates it and loads the demo directory before the server starts.
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? ''

/** A few seconds of quiet tone as 16-bit mono WAV: Chromium's fake microphone plays it on a loop. */
function fakeVoiceNote(): string {
  const rate = 8000
  const samples = rate * 3
  const buf = Buffer.alloc(44 + samples * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + samples * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 6000), 44 + i * 2)
  const file = path.join(DATA_DIR, 'fake-voice-note.wav')
  writeFileSync(file, buf)
  return file
}

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
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        // A fake microphone that "speaks" a WAV file, so the voice-note recorder records real audio.
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${fakeVoiceNote()}`,
      ],
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    // Build as production, then serve under NODE_ENV=test: that enables the test-only sign-in
    // route (POST /api/test/login), which never exists in production.
    command: `NODE_ENV=production npm run build && npx tsx e2e/support/prepare-db.ts && npm run serve`,
    url: `http://localhost:${PORT}/health`,
    env: {
      NODE_ENV: 'test',
      PORT: String(PORT),
      DATA_DIR,
      // e2e always exercises the offline paths (mock transcription and extraction), whatever the
      // local .env says, and never real Google sign-in.
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      GOOGLE_MAPS_API_KEY: '',
      DATABASE_URL,
    },
    // Reusing a server would also reuse its data dir; opt in explicitly.
    reuseExistingServer: !!process.env.E2E_REUSE_SERVER,
    timeout: 300_000,
  },
})

/**
 * Helpers for the morning-test spec (e2e/morning.spec.ts): signed-in laptop and phone contexts
 * using the test-only login (POST /api/test/login, NODE_ENV=test only), and the 3D-room waits.
 */
import { devices, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { SLOW } from '../helpers'

export const LAPTOP = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }
export const PHONE = { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }

export interface Person {
  email: string
  name: string
  handle: string
  displayName: string
}

/** A person with a unique email and handle for this run (handles are 3-24 chars). */
export function person(label: string, displayName: string, run: string): Person {
  const handle = `${label}_${run}`.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24)
  return { email: `${handle}@example.com`, name: displayName, handle, displayName }
}

export async function newDevice(browser: Browser, baseURL: string, kind: 'laptop' | 'phone'): Promise<BrowserContext> {
  const ctx = await browser.newContext({ ...(kind === 'laptop' ? LAPTOP : PHONE), baseURL })
  // The fake microphone (playwright.config.ts) still needs the permission granted.
  await ctx.grantPermissions(['microphone'], { origin: baseURL })
  return ctx
}

/** "Continue with Google", the test way: the session cookie lands in this browser context. */
export async function signIn(ctx: BrowserContext, p: Person, opts: { onboarded?: boolean } = {}) {
  const res = await ctx.request.post('/api/test/login', {
    data: { email: p.email, name: p.name, ...(opts.onboarded ? { handle: p.handle } : {}) },
  })
  expect(res.status(), 'test login is enabled (NODE_ENV=test)').toBe(200)
  return (await res.json()).user as { id: string; email: string; onboarded: boolean }
}

/**
 * Collects page errors, console errors and failed API calls so a spec can assert the run was
 * clean. The one expected failure is the signed-out session probe (GET /api/me -> 401); the
 * browser logs every failed request as a console error too, so those lines are covered by the
 * response check instead.
 */
export function watchErrors(page: Page, into: string[]) {
  page.on('pageerror', (e) => into.push(`${page.url()}: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const text = m.text()
    if (/^Failed to load resource: the server responded with a status of \d+/.test(text)) return
    into.push(`${page.url()}: ${text}`)
  })
  page.on('response', (r) => {
    const url = new URL(r.url())
    if (!url.pathname.startsWith('/api/') || r.status() < 400) return
    if (r.status() === 401 && url.pathname === '/api/me' && r.request().method() === 'GET') return
    into.push(`${page.url()}: ${r.request().method()} ${url.pathname} -> ${r.status()}`)
  })
}

/** Wait until the signed-in 3D room has loaded the user's own data (Postgres, not the demo seed). */
export async function waitRoom(page: Page) {
  await page.waitForFunction(
    () => {
      const s = window.__ESCAPE__?.store.getState()
      return !!s && s.worldReady && s.dataStatus === 'ready' && s.dataSource === 'postgres'
    },
    null,
    { timeout: SLOW * 2 },
  )
}

export function roomNames(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__ESCAPE__!.store.getState().rooms.map((r) => r.name))
}

/** Wait until a polaroid for the room called `name` is pinned and has landed in its slot. */
export async function waitPinned(page: Page, name: string) {
  await page.waitForFunction(
    (n) => {
      const s = window.__ESCAPE__!.store.getState()
      const room = s.rooms.find((r) => r.name === n)
      if (!room) return false
      const pin = s.boardPins.find((p) => p.roomId === room.id)
      const live = window.__ESCAPE__!.runtime.pinPositions.get(room.id)
      return !!pin && !!live && Math.hypot(live[0] - pin.target[0], live[1] - pin.target[1], live[2] - pin.target[2]) < 0.02
    },
    name,
    { timeout: SLOW * 2 },
  )
}

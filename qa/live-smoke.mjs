#!/usr/bin/env node
// Live smoke test of the signed-out morning-test path on a deployed URL (no Google sign-in).
//
//   node qa/live-smoke.mjs [baseUrl]     # default https://bubbly-hope-production.up.railway.app
//
// Desktop 1440x900 and Pixel 7 390x844. Small JPEG screenshots go to qa/screenshots/phase2/live-*.jpg.
// Exits non-zero if any check fails or a page logs an error. Read-only: it never signs in or writes.
import { chromium, devices } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = path.join(ROOT, 'qa', 'screenshots', 'phase2')
const BASE = (process.argv[2] ?? 'https://bubbly-hope-production.up.railway.app').replace(/\/$/, '')
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
mkdirSync(SHOTS, { recursive: true })

const results = []
const errors = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`)
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, `live-${name}.jpg`), type: 'jpeg', quality: 55, timeout: 90_000 })
}
function watch(page, label) {
  page.on('pageerror', (e) => errors.push(`${label} ${page.url()}: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    if (/^Failed to load resource: the server responded with a status of 401/.test(m.text())) return
    errors.push(`${label} ${page.url()}: ${m.text()}`)
  })
  page.on('response', (r) => {
    const u = new URL(r.url())
    if (u.origin !== BASE || !u.pathname.startsWith('/api/') || r.status() < 400) return
    if (r.status() === 401 && u.pathname === '/api/me') return
    errors.push(`${label} ${page.url()}: ${r.request().method()} ${u.pathname} -> ${r.status()}`)
  })
}
async function step(name, fn) {
  try {
    await fn()
  } catch (e) {
    check(name, false, String(e?.message ?? e).split('\n')[0])
  }
}

const browser = await chromium.launch({ args: GL_ARGS })
const laptop = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const phone = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 } })
const lp = await laptop.newPage()
const pp = await phone.newPage()
watch(lp, 'laptop')
watch(pp, 'phone')

await step('laptop: landing page with Continue with Google', async () => {
  await lp.goto(`${BASE}/`)
  await lp.getByTestId('landing-page').waitFor({ timeout: 30_000 })
  await lp.getByTestId('google-sign-in').waitFor()
  for (const href of ['/about', '/privacy', '/terms']) {
    const n = await lp.locator(`a[href="${href}"]`).count()
    if (n === 0) throw new Error(`landing has no link to ${href}`)
  }
  await shot(lp, 'desktop-landing')
  check('laptop: landing page with Continue with Google', true)
})

await step('laptop: Continue with Google goes to accounts.google.com with our callback', async () => {
  let googleUrl = ''
  await lp.route('https://accounts.google.com/**', (route) => {
    googleUrl = route.request().url()
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>google stub</p>' })
  })
  await lp.getByTestId('google-sign-in').click()
  await lp.waitForURL(/accounts\.google\.com/, { timeout: 30_000 })
  const q = new URL(googleUrl).searchParams
  const cb = q.get('redirect_uri')
  const ok = cb === `${BASE}/api/auth/callback/google` && q.get('scope') === 'openid email profile' && !!q.get('client_id')
  check('laptop: Continue with Google goes to accounts.google.com with our callback', ok, `redirect_uri=${cb}`)
  await lp.unroute('https://accounts.google.com/**')
})

await step('phone: / opens the mobile app sign-in at /m', async () => {
  await pp.goto(`${BASE}/`)
  await pp.waitForURL(/\/m$/, { timeout: 30_000 })
  await pp.getByTestId('mobile-signin').waitFor({ timeout: 30_000 })
  const three = await pp.evaluate(() => performance.getEntriesByType('resource').some((e) => /three|world|desktop-/i.test(e.name)))
  await shot(pp, 'mobile-signin')
  check('phone: / opens the mobile app sign-in at /m', !three, three ? 'phone downloaded a 3D chunk' : '')
})

await step('phone: Escape of the Day page loads and starts', async () => {
  await pp.goto(`${BASE}/daily`)
  await pp.getByTestId('daily-page').waitFor({ timeout: 30_000 })
  const number = (await pp.getByTestId('daily-number').innerText()).trim()
  await pp.getByTestId('daily-start').click()
  await pp.waitForTimeout(1500)
  await shot(pp, 'mobile-daily')
  check('phone: Escape of the Day page loads and starts', /#\d+/.test(number), number)
})

await step('laptop: demo 3D room loads', async () => {
  await lp.goto(`${BASE}/?demo=1`)
  await lp.waitForFunction(() => window.__ESCAPE__?.store.getState().worldReady === true, null, { timeout: 180_000 })
  const n = await lp.evaluate(() => window.__ESCAPE__.store.getState().rooms.length)
  await lp.waitForTimeout(2000)
  await shot(lp, 'desktop-demo-room')
  check('laptop: demo 3D room loads', n > 0, `${n} rooms`)
})

await step('laptop: Escape of the Day from the door', async () => {
  await lp.evaluate(() => window.__ESCAPE__.bus.emit('gate:open'))
  await lp.getByTestId('daily-overlay').waitFor({ timeout: 60_000 })
  await shot(lp, 'desktop-daily-overlay')
  check('laptop: Escape of the Day from the door', true)
})

for (const p of ['about', 'privacy', 'terms']) {
  await step(`static /${p}`, async () => {
    const r = await pp.goto(`${BASE}/${p}`)
    const h1 = await pp.locator('h1').first().innerText()
    check(`static /${p}`, r.status() === 200 && h1.length > 0, h1)
  })
}

await step('venue page renders', async () => {
  const res = await (await fetch(`${BASE}/api/directory/search?q=escape&limit=1&country=US`)).json()
  const slug = res.venues[0]?.slug
  await pp.goto(`${BASE}/venues/${slug}`)
  await pp.getByRole('heading', { level: 1 }).waitFor({ timeout: 30_000 })
  const text = await pp.locator('body').innerText()
  await shot(pp, 'mobile-venue')
  check('venue page renders', text.includes('Foursquare'), slug)
})

await step('unknown game page shows not found', async () => {
  await pp.goto(`${BASE}/games/no-such-game-qa`)
  await pp.waitForTimeout(2500)
  const text = await pp.locator('body').innerText()
  check('unknown game page shows not found', /not found|couldn.t find|no such/i.test(text), text.slice(0, 80).replace(/\s+/g, ' '))
})

await browser.close()
const known = errors.filter((e) => !e.includes('no-such-game-qa'))
check('no page errors', known.length === 0, known.slice(0, 5).join(' | '))
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)

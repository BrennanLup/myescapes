#!/usr/bin/env node
// Exploratory pass over the morning-test pages on a local server started with NODE_ENV=test
// (test-only login, mock transcription/extraction). Not a substitute for e2e/morning.spec.ts:
// it audits every screen on a laptop (1440x900) and a phone (Pixel 7, 390x844) for horizontal
// overflow, off-screen controls, page errors and failed API calls, and saves small JPEG
// screenshots to qa/screenshots/phase2/local-*.jpg.
//
//   QA_BASE=http://localhost:3620 node qa/local-morning.mjs
//
// Start the server first, for example:
//   NODE_ENV=production npm run build
//   DATA_DIR=$(mktemp -d) sh -c 'npx tsx e2e/support/prepare-db.ts && NODE_ENV=test PORT=3620 \
//     ANTHROPIC_API_KEY= OPENAI_API_KEY= GOOGLE_MAPS_API_KEY= DATABASE_URL= npm run serve'
import { chromium, devices } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = path.join(ROOT, 'qa', 'screenshots', 'phase2')
const BASE = (process.env.QA_BASE ?? 'http://localhost:3620').replace(/\/$/, '')
const RUN = Date.now().toString(36).slice(-5)
mkdirSync(SHOTS, { recursive: true })

const results = []
const errors = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`)
}
async function step(name, fn) {
  try {
    await fn()
  } catch (e) {
    check(name, false, String(e?.message ?? e).split('\n')[0])
  }
}
function watch(page, label) {
  page.on('pageerror', (e) => errors.push(`${label} ${page.url()}: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    if (/^Failed to load resource: the server responded with a status of \d+/.test(m.text())) return
    errors.push(`${label} ${page.url()}: ${m.text()}`)
  })
  page.on('response', (r) => {
    const u = new URL(r.url())
    if (u.origin !== BASE || !u.pathname.startsWith('/api/') || r.status() < 400) return
    if (r.status() === 401 && u.pathname === '/api/me') return
    errors.push(`${label} ${page.url()}: ${r.request().method()} ${u.pathname} -> ${r.status()}`)
  })
}

/** No horizontal page scroll, and no visible control sticking out of the viewport. */
async function audit(page, name) {
  await page.waitForTimeout(400)
  const r = await page.evaluate(() => {
    const vw = window.innerWidth
    const out = []
    for (const el of document.querySelectorAll('button, a, input, select, textarea, h1, h2, p, td, th, label')) {
      const b = el.getBoundingClientRect()
      if (b.width === 0 || b.height === 0) continue
      const st = getComputedStyle(el)
      if (st.visibility === 'hidden' || st.display === 'none') continue
      // Inside a horizontally scrollable container is fine (tables, chip rows).
      let p = el.parentElement
      let scrolls = false
      while (p && p !== document.body) {
        const s = getComputedStyle(p)
        if ((s.overflowX === 'auto' || s.overflowX === 'scroll' || s.overflowX === 'hidden') && p.scrollWidth > p.clientWidth) scrolls = true
        p = p.parentElement
      }
      if (!scrolls && (b.right > vw + 1 || b.left < -1)) out.push(`${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ''} "${(el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(b.left)}..${Math.round(b.right)}`)
    }
    return { scrollW: document.documentElement.scrollWidth, vw, out: out.slice(0, 6) }
  })
  await page.screenshot({ path: path.join(SHOTS, `local-${name}.jpg`), type: 'jpeg', quality: 50, scale: 'css', timeout: 90_000 })
  check(`${name}: fits the width`, r.scrollW <= r.vw + 1 && r.out.length === 0, r.out.length || r.scrollW > r.vw + 1 ? `scrollWidth ${r.scrollW} > ${r.vw}; ${r.out.join('; ')}` : '')
}

async function signIn(ctx, email, name) {
  const res = await ctx.request.post(`${BASE}/api/test/login`, { data: { email, name } })
  if (res.status() !== 200) throw new Error(`test login ${res.status()} (start the server with NODE_ENV=test)`)
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const laptop = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } })
const phone = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 } })
const lp = await laptop.newPage()
const pp = await phone.newPage()
watch(lp, 'laptop')
watch(pp, 'phone')
const owner = { email: `qa_owner_${RUN}@example.com`, name: 'Brennan QA', handle: `qa_owner_${RUN}` }
let publicHref = ''

await step('laptop: landing', async () => {
  await lp.goto(`${BASE}/`)
  await lp.getByTestId('landing-page').waitFor()
  await audit(lp, 'd-landing')
})

await step('laptop: onboarding then empty room', async () => {
  await signIn(laptop, owner.email, owner.name)
  await lp.reload()
  await lp.getByTestId('onboarding-screen').waitFor()
  await audit(lp, 'd-onboarding')
  await lp.locator('input[name="displayName"]').fill(owner.name)
  await lp.locator('input[name="handle"]').fill(owner.handle)
  await lp.getByTestId('handle-status').filter({ hasText: 'Available' }).waitFor()
  await lp.getByRole('button', { name: 'Continue' }).click()
  await lp.waitForFunction(() => {
    const s = window.__ESCAPE__?.store.getState()
    return !!s && s.worldReady && s.dataStatus === 'ready' && s.dataSource === 'postgres'
  }, null, { timeout: 180_000 })
  await lp.waitForTimeout(1500)
  await audit(lp, 'd-room-empty')
})

await step('phone: / goes to /m sign-in', async () => {
  await pp.goto(`${BASE}/`)
  await pp.waitForURL(/\/m$/)
  await pp.getByTestId('mobile-signin').waitFor()
  await audit(pp, 'm-signin')
})

await step('phone: home (empty)', async () => {
  await signIn(phone, owner.email, owner.name)
  await pp.reload()
  await pp.getByTestId('mobile-home').waitFor()
  await pp.getByTestId('rooms-empty').waitFor()
  await audit(pp, 'm-home-empty')
})

await step('phone: log by typing -> matcher -> confirm -> save', async () => {
  await pp.getByTestId('log-room').click()
  await pp.getByTestId('log-flow').waitFor()
  await audit(pp, 'm-log-record')
  await pp.getByTestId('record-type-instead').click()
  await pp
    .getByTestId('transcript-input')
    .fill('Last Saturday Mia and I did Golden Gate Vault Job by Lockbox Social in San Francisco. A heist room, really fun. We escaped with 4 minutes left. Overall 88 out of 100, puzzles 90, setting 85, story 70, difficulty 65. The laser hallway was the best puzzle.')
  await audit(pp, 'm-log-transcript')
  await pp.getByTestId('transcript-submit').click()
  await pp.getByTestId('venue-game-matcher').waitFor({ timeout: 90_000 })
  await pp.getByTestId('matcher-loading').waitFor({ state: 'detached', timeout: 90_000 })
  await audit(pp, 'm-matcher')
  await pp.locator('[data-testid^="match-game-"]', { hasText: 'Best match' }).first().click()
  await pp.getByTestId('log-confirm').waitFor()
  for (const k of ['overall', 'puzzles', 'setting', 'storyline', 'difficulty']) {
    const input = pp.getByTestId(`confirm-score-${k}`)
    if ((await input.inputValue()) === '') await input.fill('80')
  }
  const date = pp.getByTestId('confirm-date')
  if ((await date.inputValue()) === '') await date.fill('2026-10-24')
  await audit(pp, 'm-confirm')
  // A blocked save must point at the field to fix (the puzzle's type), then the user picks one.
  await pp.getByTestId('confirm-save').click()
  const focused = await pp.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '')
  const untyped = pp.locator('[data-testid^="confirm-puzzle-type-"][aria-invalid="true"]')
  if (await untyped.count()) {
    check('phone: blocked save focuses the puzzle type', focused.startsWith('confirm-puzzle-type-'), focused)
    await audit(pp, 'm-save-blocked')
    for (const sel of await untyped.all()) await sel.selectOption('physical')
  }
  await pp.getByTestId('confirm-save').click()
  await pp.getByTestId('log-done').waitFor({ timeout: 90_000 })
  publicHref = (await pp.getByTestId('log-done-public').getAttribute('href')) ?? ''
  await audit(pp, 'm-done')
  await pp.getByTestId('log-done-home').click()
  await pp.getByTestId('review-detail').waitFor()
  await audit(pp, 'm-review-detail')
  await pp.goto(`${BASE}/m`)
  await pp.getByTestId('rooms-row').first().waitFor()
  await audit(pp, 'm-home-1room')
  check('phone: saved room listed with a public link', /^\/games\//.test(publicHref), publicHref)
})

await step('laptop: reload shows the new polaroid', async () => {
  await lp.reload()
  await lp.waitForFunction(() => {
    const s = window.__ESCAPE__?.store.getState()
    return !!s && s.worldReady && s.dataStatus === 'ready' && s.dataSource === 'postgres' && s.rooms.length === 1
  }, null, { timeout: 180_000 })
  await lp.waitForTimeout(4000)
  await audit(lp, 'd-room-1')
})

await step('public pages on both viewports', async () => {
  for (const [p, tag] of [[pp, 'm'], [lp, 'd']]) {
    await p.goto(`${BASE}${publicHref}`)
    await p.getByTestId('review-card').first().waitFor()
    const html = await p.content()
    if (html.includes(owner.email)) throw new Error('email shown on the public page')
    await audit(p, `${tag}-public-game`)
    const venue = await p.locator('a[href^="/venues/"]').first().getAttribute('href')
    await p.goto(`${BASE}${venue}`)
    await p.getByRole('heading', { level: 1 }).waitFor()
    await audit(p, `${tag}-venue`)
    const city = await p.locator('a[href^="/cities/"]').first().getAttribute('href').catch(() => null)
    if (city) {
      await p.goto(`${BASE}${city}`)
      await p.getByRole('heading', { level: 1 }).waitFor()
      await audit(p, `${tag}-city`)
    }
  }
})

let inviteUrl = ''
await step('settings on both viewports, invite link', async () => {
  for (const [p, tag] of [[pp, 'm'], [lp, 'd']]) {
    await p.goto(`${BASE}/settings`)
    await p.getByTestId('settings-page').waitFor()
    await audit(p, `${tag}-settings`)
  }
  await lp.getByTestId('invite-guest-name').fill('Mia')
  await lp.getByTestId('invite-create').click()
  inviteUrl = (await lp.getByTestId('invite-url').innerText()).trim()
  await audit(lp, 'd-settings-invite')
})

await step('invite page for a signed-out phone', async () => {
  const her = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 } })
  const hp = await her.newPage()
  watch(hp, 'her-phone')
  await hp.goto(`${BASE}${new URL(inviteUrl).pathname}`)
  await hp.getByTestId('invite-valid').waitFor()
  await audit(hp, 'm-invite')
  await her.close()
})

await step('Escape of the Day on both viewports', async () => {
  for (const [p, tag] of [[pp, 'm'], [lp, 'd']]) {
    await p.goto(`${BASE}/daily`)
    await p.getByTestId('daily-page').waitFor()
    await p.getByTestId('daily-start').click()
    await p.waitForTimeout(800)
    await audit(p, `${tag}-daily`)
  }
})

await browser.close()
check('no page errors or failed API calls', errors.length === 0, errors.slice(0, 6).join(' | '))
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)

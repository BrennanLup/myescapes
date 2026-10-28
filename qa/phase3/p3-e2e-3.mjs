/**
 * Phase 3 QA round 3: drive every Phase 3 feature on a laptop and a Pixel 7 with real clicks,
 * keys and touches (test hooks only to aim/teleport), saving screenshots under qa/phase3/r3/.
 *
 * Needs a server started with NODE_ENV=test (test login) on QA_BASE, e.g.
 *   npx tsx e2e/support/prepare-db.ts && NODE_ENV=test PORT=3301 DATA_DIR=/some/tmp npm run serve
 *   QA_BASE=http://localhost:3301 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node qa/phase3/p3-e2e-3.mjs [scenario...]
 *
 * Scenarios: review-desktop review-phone character-desktop character-phone multiplayer
 * multiplayer-phone daily-desktop daily-phone daily-signedout. Results: qa/phase3/results-r3.json.
 */
import { chromium, devices } from 'playwright'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const BASE = process.env.QA_BASE ?? 'http://localhost:3301'
const OUT = path.resolve('qa/phase3/r3')
mkdirSync(OUT, { recursive: true })
const RESULTS = path.resolve('qa/phase3/results-r3.json')
const results = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : {}
const SLOW = 120_000
const LAPTOP = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }
const PHONE = { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }
const RUN = Date.now().toString(36).slice(-5)

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
})

function person(label, name) {
  const handle = `${label}_${RUN}`.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24)
  return { email: `${handle}@example.com`, name, handle }
}
async function device(kind, low = false) {
  const ctx = await browser.newContext({ ...(kind === 'phone' ? PHONE : LAPTOP), baseURL: BASE })
  if (low) await ctx.addInitScript(() => localStorage.setItem('myescapes.settings.v1', JSON.stringify({ quality: 'low' })))
  return ctx
}
async function signIn(ctx, p, onboarded = true) {
  const r = await ctx.request.post('/api/test/login', { data: { email: p.email, name: p.name, ...(onboarded ? { handle: p.handle } : {}) } })
  if (r.status() !== 200) throw new Error('test login failed ' + r.status())
  return (await r.json()).user
}
function watch(page, log) {
  page.on('pageerror', (e) => log.push(`pageerror ${page.url()}: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) log.push(`console ${page.url()}: ${m.text().slice(0, 300)}`)
    if (m.type() === 'warning' && /react|WebGL|act\(/i.test(m.text())) log.push(`warn ${m.text().slice(0, 200)}`)
  })
  page.on('response', (r) => {
    const u = new URL(r.url())
    if (u.pathname.startsWith('/api/') && r.status() >= 400 && !(r.status() === 401 && u.pathname === '/api/me')) log.push(`http ${r.request().method()} ${u.pathname} -> ${r.status()}`)
  })
}
async function shot(page, name, full = false) {
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 70, fullPage: full }).catch((e) => console.log('shot failed', name, e.message))
}
async function waitRoom(page) {
  await page.waitForFunction(() => {
    const s = window.__ESCAPE__?.store.getState()
    return !!s && s.worldReady && s.dataStatus === 'ready'
  }, null, { timeout: SLOW * 2 })
}
const waitOverlay = (page, k, timeout = SLOW) => page.waitForFunction((k) => (window.__ESCAPE__.store.getState().overlay?.kind ?? null) === k, k, { timeout })
const overlayKind = (page) => page.evaluate(() => window.__ESCAPE__?.store.getState().overlay?.kind ?? null)
async function aimAt(page, from, target) {
  await page.evaluate(({ from, target }) => {
    const dx = target[0] - from[0], dy = target[1] - from[1], dz = target[2] - from[2]
    window.__ESCAPE__.requestTeleport(from, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)))
  }, { from, target })
}
/** Things that commonly look rough: sideways scroll, small tap targets, overlapping fixed clusters, clipped text. */
async function layoutAudit(page, label) {
  return page.evaluate((label) => {
    const out = []
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`${label}: page scrolls sideways (${document.documentElement.scrollWidth} > ${window.innerWidth})`)
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0' && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth }
    const btns = [...document.querySelectorAll('button, a[href], input, select, textarea')].filter(vis)
    const small = btns.filter((b) => { const r = b.getBoundingClientRect(); return (r.width < 32 || r.height < 32) && !(b.type === 'checkbox' || b.type === 'radio' || b.type === 'range' || b.tagName === 'A') })
    if (small.length && innerWidth < 500) out.push(`${label}: ${small.length} visible controls smaller than 32px: ` + small.slice(0, 6).map((b) => (b.getAttribute('data-testid') || b.getAttribute('aria-label') || b.textContent?.trim().slice(0, 20) || b.tagName) + `(${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)})`).join(', '))
    const ids = ['character-hud', 'people-dock', 'interact-tap', 'visit-banner', 'chat-area', 'daily-room-controls', 'connection-chip', 'daily-room-menu']
    const boxes = ids.flatMap((id) => [...document.querySelectorAll(`[data-testid="${id}"]`)].map((el) => [id, el])).filter(([, el]) => vis(el)).map(([id, el]) => [id, el.getBoundingClientRect()])
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [a, ra] = boxes[i], [b, rb] = boxes[j]
      if (ra.left < rb.right && rb.left < ra.right && ra.top < rb.bottom && rb.top < ra.bottom) out.push(`${label}: ${a} overlaps ${b}`)
    }
    for (const b of btns) if (b.scrollWidth > b.clientWidth + 2 && b.tagName === 'BUTTON') out.push(`${label}: button text clipped: ${(b.getAttribute('data-testid') || b.textContent || '').slice(0, 30)}`)
    return out
  }, label)
}
async function pngFile(page, name, color, w = 640, h = 480) {
  const b64 = await page.evaluate(({ c, w, h }) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h
    const x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.fillRect(w / 6, h / 5, w / 3, h / 4)
    return cv.toDataURL('image/png').split(',')[1]
  }, { c: color, w, h })
  return { name, mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') }
}
async function keyBalance(ctx) {
  const r = await ctx.request.get('/api/me/avatar')
  const j = await r.json().catch(() => ({}))
  return { status: r.status(), keys: j.keys ? j.keys.balance : null }
}
async function touchDrag(ctx, page, locator, dx, dy, holdMs = 0) {
  const cdp = await ctx.newCDPSession(page)
  const b = await page.locator(locator).boundingBox()
  const x = b.x + b.width / 2, y = b.y + b.height / 2
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 6, y: y + (dy * i) / 6 }] })
  return { end: async () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {}), hold: holdMs }
}

const scenarios = {
  async 'review-desktop'(notes) {
    const ctx = await device('laptop')
    const me = person('r3revd', 'Rowan Desk')
    await signIn(ctx, me)
    const before = await keyBalance(ctx)
    const p = await ctx.newPage(); watch(p, notes.errors)
    await p.goto('/?gate=off&autostart=1')
    await waitRoom(p)
    await shot(p, 'review-desk-01-room')
    // The real record flow, typed.
    await p.getByTestId('record-button').click()
    await waitOverlay(p, 'record')
    await shot(p, 'review-desk-02-record')
    await p.getByTestId('transcript-input').fill('Last Saturday we played The Last Lighthouse Keeper in San Francisco. We escaped with 4 minutes left. Overall 88, puzzles 90. The final lock was clever.')
    await p.getByTestId('extract-submit').click()
    await waitOverlay(p, 'confirm')
    await p.waitForTimeout(1500)
    await shot(p, 'review-desk-03-form')
    notes.audit.push(...await layoutAudit(p, 'desktop confirm'))
    const count = () => p.locator('[data-testid^="field-"]').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 0).length)
    const sections = () => p.getByTestId('confirm-overlay').locator('h2,h3,legend').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.textContent.trim()))
    const vis1 = await count(); const sec1 = await sections()
    const comment = p.locator('textarea[data-testid$=".comment"], [data-testid^="field-review.ratings"][data-testid$="comment"]').first()
    if (await comment.count()) { await comment.click(); await p.keyboard.type('The final lock was clever and the room looked great') }
    else { await p.getByTestId('field-room.city').click(); await p.keyboard.type(' (Mission)') }
    const vis2 = await count(); const sec2 = await sections()
    notes.info.push(`desktop form visible fields before typing ${vis1}, while typing ${vis2}; sections ${sec1.length}->${sec2.length}: ${sec2.join(' | ').slice(0, 300)}`)
    if (vis2 < vis1 || sec2.length < sec1.length) notes.audit.push(`desktop confirm: questions disappear while typing (${vis1} -> ${vis2} fields)`)
    await shot(p, 'review-desk-04-typing')
    // Room search as you type.
    const search = p.getByTestId('room-search').locator('input').first()
    const t0 = Date.now()
    await search.fill('Lighth')
    await p.locator('[data-testid^="roompicker-option-"]').first().waitFor({ timeout: 10000 }).catch(() => {})
    notes.info.push(`desktop search first result after ${Date.now() - t0} ms`)
    await shot(p, 'review-desk-05-search')
    const opts = await p.locator('[data-testid^="roompicker-option-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') + ':' + e.textContent.trim().slice(0, 60)))
    notes.info.push('desktop search options: ' + JSON.stringify(opts))
    await search.fill('qqqq nothing here')
    await p.waitForTimeout(1500)
    await shot(p, 'review-desk-06-search-none')
    const none = await p.locator('[data-testid^="roompicker-option-"]').evaluateAll((els) => els.map((e) => e.textContent.trim().slice(0, 60)))
    if (!none.some((o) => /add/i.test(o))) notes.audit.push('desktop room search: no "add a new room" when nothing matches')
    // Keyboard selection in the picker.
    await search.fill('Lighthouse')
    await p.waitForTimeout(1500)
    await search.press('ArrowDown'); await search.press('Enter')
    await p.waitForTimeout(600)
    const linked = await p.getByTestId('confirm-room-linked').innerText().catch(() => null)
    notes.info.push('desktop picker keyboard Enter -> linked: ' + linked)
    if (!linked) {
      const first = p.locator('[data-testid="roompicker-option-game"]').first()
      if (await first.count()) await first.click()
      notes.audit.push('desktop room search: ArrowDown + Enter did not pick a result')
    }
    await shot(p, 'review-desk-07-linked')
    // Photos: two good, one that fails to upload (to test retry), one non-image.
    await p.getByTestId('photo-input').first().setInputFiles([await pngFile(p, 'd.png', '#e8b93a'), await pngFile(p, 'e.png', '#3a6ee8', 5000, 4000), { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }])
    await p.waitForTimeout(2500)
    await p.getByTestId('confirm-photos').scrollIntoViewIfNeeded().catch(() => {})
    await shot(p, 'review-desk-08-photos-queued')
    notes.info.push('desktop queued photos: ' + (await p.getByTestId('photo-status').first().innerText().catch(() => '?')))
    const sec3 = await sections()
    if (sec3.length < sec1.length) notes.audit.push('desktop confirm: sections hidden after adding photos')
    // Fill the rest. Errors show only after Save (aria-disabled, still pressable) or leaving a field.
    await p.getByTestId('confirm-save').click({ force: true })
    await p.waitForTimeout(800)
    await shot(p, 'review-desk-08b-save-shows-errors')
    notes.info.push('desktop: errors after pressing disabled Save: ' + JSON.stringify(await p.$$eval('[data-testid^="error-"]', (els) => els.map((e) => e.getAttribute('data-testid') + ':' + e.textContent.trim().slice(0, 40)))))
    notes.info.push('desktop: focused after Save: ' + await p.evaluate(() => document.activeElement?.getAttribute('data-testid') || document.activeElement?.tagName))
    for (let g = 0; g < 40; g++) {
      const missing = await p.$$eval('[data-testid^="error-"]', (els) => els.map((e) => e.getAttribute('data-testid').slice(6)))
      if (!missing.length) break
      const m = missing[0]; const f = p.locator(`[data-testid="field-${m}"]`)
      if (/\.(escaped|visibleTimer|multiRoom|flashlights|liveActors)$/.test(m)) await p.locator(`[data-testid="field-${m}-yes"]`).click()
      else if (m === 'room.genre') await f.selectOption('mystery')
      else if (/^review\.puzzles\.\d+\.type$/.test(m)) await f.selectOption('logic')
      else if (/\.score$/.test(m)) await f.fill('75')
      else if (m === 'review.date') await f.fill('2026-10-24')
      else await f.fill('QA')
    }
    // Make the first upload fail once.
    let failed = 0
    await p.route('**/api/visits/*/photos**', async (route) => {
      if (route.request().method() === 'POST' && failed === 0) { failed++; return route.fulfill({ status: 500, body: '{"error":"boom"}', contentType: 'application/json' }) }
      return route.continue()
    })
    await shot(p, 'review-desk-09-ready')
    notes.info.push('desktop save aria-disabled before save: ' + await p.getByTestId('confirm-save').getAttribute('aria-disabled'))
    await p.getByTestId('confirm-save').click({ force: true })
    await waitOverlay(p, null)
    await p.waitForTimeout(6000)
    await shot(p, 'review-desk-10-saved')
    const st = await p.evaluate(() => { const s = window.__ESCAPE__.store.getState(); return s.reviews.map((r) => ({ id: r.id, room: s.rooms.find((x) => x.id === r.roomId)?.name, photos: r.photos.length })) })
    notes.info.push(`after save (one upload forced to fail ${failed}x): ` + JSON.stringify(st))
    const visibleToast = await p.locator('[role="status"], [data-testid*="toast"]').allInnerTexts().catch(() => [])
    notes.info.push('toasts after save: ' + JSON.stringify(visibleToast).slice(0, 300))
    await p.unroute('**/api/visits/*/photos**')
    const last = await p.evaluate(() => window.__ESCAPE__.store.getState().lastAddedRoomId ?? window.__ESCAPE__.store.getState().reviews.at(-1)?.roomId)
    if (last) {
      await p.evaluate((id) => window.__ESCAPE__.bus.emit('review:open', { roomId: id }), last)
      await waitOverlay(p, 'review')
      await p.waitForTimeout(1500)
      await shot(p, 'review-desk-11-review-overlay')
      const attach = p.getByTestId('review-photo-attach')
      if (await attach.count()) {
        await attach.scrollIntoViewIfNeeded()
        await shot(p, 'review-desk-12-review-attach-after-fail')
        const retry = attach.getByTestId('photo-retry').or(attach.getByTestId('photo-retry-all')).first()
        if (await retry.count()) { await retry.click(); await p.waitForTimeout(3000); notes.info.push('retry clicked in review overlay') }
        else notes.audit.push('review overlay: failed upload has no Retry after the form closed (or the failure was not kept)')
        await attach.getByTestId('photo-input').setInputFiles([await pngFile(p, 'f.png', '#aa3355')])
        await p.waitForTimeout(4000)
        await shot(p, 'review-desk-13-review-photo-added')
        notes.info.push('review attach status: ' + (await attach.innerText()).replace(/\s+/g, ' ').slice(0, 250))
      } else notes.audit.push('review overlay: no add-photo control found')
      const srv = await p.evaluate(async () => { const r = await fetch('/api/data'); const j = await r.json(); return (j.reviews || []).map((x) => x.photos?.length) })
      notes.info.push('server photo counts per review: ' + JSON.stringify(srv))
    }
    const after = await keyBalance(ctx)
    notes.info.push(`keys before ${JSON.stringify(before)} after logging ${JSON.stringify(after)}`)
    // Discard prompt: open the record flow again and press Escape with a typed draft.
    await p.evaluate(() => window.__ESCAPE__.store.setState({ overlay: null }))
    await p.getByTestId('record-button').click()
    await waitOverlay(p, 'record')
    await p.getByTestId('sample-transcript').click()
    await p.getByTestId('extract-submit').click()
    await waitOverlay(p, 'confirm')
    await p.getByTestId('field-room.name').fill('Unsaved Room QA')
    await p.keyboard.press('Escape')
    await p.waitForTimeout(800)
    notes.info.push('desktop: Escape on an edited form -> overlay ' + (await overlayKind(p)) + ', discard prompt ' + (await p.getByTestId('confirm-discard-yes').count()))
    await shot(p, 'review-desk-14-escape-discard')
    await ctx.close()
  },

  async 'review-phone'(notes) {
    const ctx = await device('phone')
    await signIn(ctx, person('r3revp', 'Rowan Phone'))
    const p = await ctx.newPage(); watch(p, notes.errors)
    await p.goto('/m')
    await p.waitForTimeout(1500)
    await shot(p, 'review-phone-00-home')
    await p.goto('/m/log')
    await shot(p, 'review-phone-01-log')
    await p.getByTestId('record-type-instead').click()
    await p.getByTestId('transcript-input').fill('We played Subject Zero by The Puzzle Foundry in Toronto. We escaped in 50 minutes. Overall 82, puzzles 85.')
    await p.getByTestId('transcript-submit').click()
    await shot(p, 'review-phone-02-match')
    await p.locator('[data-testid^="match-game-"]', { hasText: 'Best match' }).filter({ hasText: 'Subject Zero' }).click({ timeout: SLOW })
    await p.getByTestId('log-confirm').waitFor()
    await shot(p, 'review-phone-03-form-top')
    await shot(p, 'review-phone-03b-form-full', true)
    notes.audit.push(...await layoutAudit(p, 'phone form'))
    const headings = await p.getByTestId('log-confirm').locator('h2,h3').allInnerTexts()
    notes.info.push('phone form headings: ' + headings.join(' | '))
    // Typing in a comment with an on-screen keyboard (layout viewport shrink).
    const field = p.getByTestId('confirm-comment-puzzles')
    await field.tap()
    await p.setViewportSize({ width: 390, height: 460 })
    await p.waitForTimeout(900)
    await p.keyboard.type('Clever final lock, great ')
    await shot(p, 'review-phone-04-typing-keyboard')
    const fb = await field.boundingBox(); const footer = await p.getByTestId('confirm-footer').boundingBox().catch(() => null)
    notes.info.push(`keyboard-sim: field ${JSON.stringify(fb)} footer ${JSON.stringify(footer)}`)
    if (fb && (fb.y < 0 || fb.y + fb.height > 460)) notes.audit.push('phone form: focused field out of view with keyboard open')
    if (footer && fb && footer.y < fb.y + fb.height && footer.y + footer.height > fb.y) notes.audit.push('phone form: Save bar covers the focused field with keyboard open')
    // Scroll while typing: other questions still there?
    const headings2 = await p.getByTestId('log-confirm').locator('h2,h3').allInnerTexts()
    if (headings2.length < headings.length) notes.audit.push('phone form: sections removed while typing')
    await p.mouse.wheel(0, -400); await p.waitForTimeout(400)
    await shot(p, 'review-phone-04b-keyboard-scrolled-up')
    await p.setViewportSize({ width: 390, height: 844 })
    await p.waitForTimeout(500)
    // Room search on phone
    await p.getByTestId('confirm-change-game').tap()
    await p.getByTestId('confirm-room-search').fill('Zyxw Nonexistent Room')
    await p.waitForTimeout(1500)
    await shot(p, 'review-phone-05-search-none')
    const opts = await p.locator('[data-testid^="roompicker-option-"]').evaluateAll((els) => els.map((e) => e.textContent.trim().slice(0, 50)))
    if (!opts.some((o) => /add/i.test(o))) notes.audit.push('phone room search: no "add a new room" option when nothing matches')
    await p.getByTestId('confirm-room-search').fill('Gold')
    await p.waitForTimeout(1500)
    await shot(p, 'review-phone-06-search-gold')
    await p.getByTestId('roompicker-option-game').filter({ hasText: 'Golden Gate Vault Job' }).first().tap()
    // Photos: 3 good, then failing upload
    await p.getByTestId('photo-input').setInputFiles([await pngFile(p, 'a.png', '#e07b39'), await pngFile(p, 'b.png', '#2f8f8a', 4000, 3000), await pngFile(p, 'c.png', '#6d3b5c')])
    await p.getByTestId('photo-status').waitFor()
    await p.waitForTimeout(2500)
    await p.getByTestId('confirm-photos-section').scrollIntoViewIfNeeded()
    await shot(p, 'review-phone-07-photos')
    notes.audit.push(...await layoutAudit(p, 'phone photos'))
    // Remove one with the X, check tap size of remove buttons
    const rm = p.getByTestId('confirm-photos').getByRole('button', { name: /Remove photo/ })
    const rmBox = await rm.first().boundingBox().catch(() => null)
    notes.info.push('phone remove-photo button size: ' + JSON.stringify(rmBox))
    if (rmBox && (rmBox.width < 32 || rmBox.height < 32)) notes.audit.push(`phone photos: remove button only ${Math.round(rmBox.width)}x${Math.round(rmBox.height)} px`)
    for (const k of ['overall', 'puzzles', 'setting', 'storyline', 'difficulty']) {
      const i = p.getByTestId(`confirm-score-${k}`)
      if ((await i.inputValue()) === '') await i.fill('78')
    }
    if ((await p.getByTestId('confirm-date').inputValue()) === '') await p.getByTestId('confirm-date').fill('2026-10-18')
    // Upload fails on the 2nd photo.
    let n = 0
    await p.route('**/api/visits/*/photos**', async (route) => {
      if (route.request().method() === 'POST') { n++; if (n === 2) return route.fulfill({ status: 503, body: '{"error":"busy"}', contentType: 'application/json' }) }
      return route.continue()
    })
    await p.getByTestId('confirm-save').tap()
    await p.getByTestId('log-done').waitFor({ timeout: SLOW })
    await p.waitForTimeout(5000)
    await shot(p, 'review-phone-08-done-with-failure')
    notes.info.push('done (2nd upload failed): ' + (await p.getByTestId('log-done').innerText()).replace(/\s+/g, ' '))
    const retry = p.getByTestId('photo-retry').or(p.getByTestId('photo-retry-all')).first()
    if (await retry.count()) { await retry.tap(); await p.waitForTimeout(3000); await shot(p, 'review-phone-09-after-retry'); notes.info.push('after retry: ' + (await p.getByTestId('log-done').innerText()).replace(/\s+/g, ' ')) }
    else notes.audit.push('phone done screen: a failed photo upload offers no Retry')
    await p.unroute('**/api/visits/*/photos**')
    await p.getByTestId('log-done-home').tap()
    await p.waitForURL(/\/m\/rooms\//, { timeout: SLOW })
    await p.waitForTimeout(2000)
    await shot(p, 'review-phone-10-room-detail', true)
    notes.audit.push(...await layoutAudit(p, 'phone room detail'))
    const attach = p.getByTestId('review-photo-attach')
    if (await attach.count()) {
      await attach.getByTestId('photo-input').setInputFiles([await pngFile(p, 'g.png', '#22aa66')])
      await p.waitForTimeout(4000)
      await attach.scrollIntoViewIfNeeded()
      await shot(p, 'review-phone-11-room-detail-added')
      notes.info.push('room detail photos: ' + (await attach.innerText()).replace(/\s+/g, ' ').slice(0, 200))
      // Remove + undo
      const tg = attach.getByTestId('photo-edit-toggle')
      if (await tg.count()) await tg.tap()
      else notes.audit.push('room detail: no Edit photos toggle')
      const rm2 = attach.getByRole('button', { name: /Remove photo/ }).first()
      if (await rm2.count()) {
        await rm2.tap(); await p.waitForTimeout(300)
        notes.info.push('undo visible right after remove: ' + await p.getByTestId('photo-undo-button').isVisible())
        await shot(p, 'review-phone-12-removed-undo')
        notes.info.push('during undo window: ' + (await attach.innerText()).replace(/\s+/g, ' ').slice(0, 200))
        const undo = p.getByTestId('photo-undo-button')
        if (await undo.count()) { await undo.tap(); await p.waitForTimeout(800); notes.info.push('undo restored: ' + (await attach.getByTestId('photo-tile').count()) + ' tiles') }
        else notes.audit.push('room detail: removing a photo shows no Undo')
      }
    } else notes.audit.push('phone room detail: no add-photo control')
    await ctx.close()
  },

  async 'character-desktop'(notes) { await character(notes, 'laptop') },
  async 'character-phone'(notes) { await character(notes, 'phone') },
  async multiplayer(notes) { await multiplayer(notes, false) },
  async 'multiplayer-phone'(notes) { await multiplayer(notes, true) },
  async 'daily-desktop'(notes) { await daily(notes, 'laptop', true) },
  async 'daily-phone'(notes) { await daily(notes, 'phone', true) },
  async 'daily-signedout'(notes) { await daily(notes, 'laptop', false) },
}

async function character(notes, kind) {
  const phone = kind === 'phone'
  const tag = phone ? 'phone' : 'desk'
  const ctx = await device(kind)
  await signIn(ctx, person(phone ? 'r3chp' : 'r3chd', 'Casey Char'))
  const p = await ctx.newPage(); watch(p, notes.errors)
  await p.goto('/?desktop=1&gate=off&autostart=1')
  await waitRoom(p)
  await p.waitForTimeout(1500)
  await shot(p, `char-${tag}-01-first-person`)
  notes.audit.push(...await layoutAudit(p, `${tag} room first person`))
  const camBtn = p.getByTestId('camera-toggle')
  notes.info.push(`${tag}: camera toggle label "${await camBtn.getAttribute('aria-label').catch(() => '')}" text "${(await camBtn.innerText().catch(() => '')).trim()}"`)
  if (phone) await camBtn.tap(); else await p.keyboard.press('v')
  await p.waitForFunction(() => window.__ESCAPE_VIEW__?.playerView.blend === 1, null, { timeout: SLOW }).catch(() => notes.audit.push(`${tag}: third person never reached blend 1`))
  await p.waitForTimeout(800)
  await shot(p, `char-${tag}-02-third-person`)
  if (!phone) {
    await p.keyboard.down('KeyW'); await p.waitForTimeout(800); await shot(p, `char-${tag}-03-third-walking`); await p.keyboard.up('KeyW')
    await p.keyboard.down('ShiftLeft'); await p.keyboard.down('KeyS'); await p.waitForTimeout(800); await shot(p, `char-${tag}-03b-third-back-run`); await p.keyboard.up('KeyS'); await p.keyboard.up('ShiftLeft')
    // Mouse orbit (pointer lock may be refused in headless; just drag)
    await p.mouse.move(720, 450); await p.mouse.down(); await p.mouse.move(900, 450, { steps: 8 }); await p.mouse.up()
    await p.waitForTimeout(500); await shot(p, `char-${tag}-03c-orbit`)
  } else {
    const d = await touchDrag(ctx, p, '[data-joystick]', 0, -60)
    await p.waitForTimeout(900)
    await shot(p, `char-${tag}-03-third-walking`)
    await d.end()
    // Swipe on the right half to orbit
    const cdp = await ctx.newCDPSession(p)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 400 }] })
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300 - i * 15, y: 400 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await p.waitForTimeout(500); await shot(p, `char-${tag}-03c-orbit`)
  }
  const pos = await p.evaluate(() => window.__ESCAPE__.runtime.player.position)
  notes.info.push(`${tag}: position after walking ${JSON.stringify(pos.map((x) => +x.toFixed(2)))}`)
  // Backed against walls and in a corner.
  for (const [i, at, yaw] of [[0, [0, 1.6, 7.4], 0], [1, [9.3, 1.6, 7.3], Math.PI / 4], [2, [-9.3, 1.6, -7.3], -3 * Math.PI / 4]]) {
    await p.evaluate(({ at, yaw }) => window.__ESCAPE__.requestTeleport(at, yaw, 0), { at, yaw })
    await p.waitForTimeout(1200)
    const d = await p.evaluate(() => window.__ESCAPE_VIEW__.playerView.cameraDistance)
    notes.info.push(`${tag}: camera distance near wall/corner ${i} = ${d?.toFixed?.(2)}`)
    await shot(p, `char-${tag}-04-third-wall-${i}`)
  }
  // Remembered per device
  await p.reload(); await waitRoom(p); await p.waitForTimeout(1500)
  const blend = await p.evaluate(() => window.__ESCAPE_VIEW__?.playerView.blend)
  notes.info.push(`${tag}: after reload camera blend ${blend} (1 = third person kept)`)
  if (blend !== 1) notes.audit.push(`${tag}: third person was not remembered after reload`)
  await shot(p, `char-${tag}-05-after-reload`)
  // Interaction in third person: board pin, door
  await p.evaluate(() => window.__ESCAPE__.store.setState({ overlay: null }))
  await aimAt(p, [0, 1.6, 5.5], [0, 1.2, 7.95])
  const th0 = Date.now()
  await p.waitForFunction(() => !!window.__ESCAPE__.store.getState().hoveredId, null, { timeout: 15000 }).catch(() => {})
  notes.info.push(`${tag}: door hover took ${Date.now() - th0} ms`)
  const hov = await p.evaluate(() => window.__ESCAPE__.store.getState().hoveredId)
  notes.info.push(`${tag}: hovered in third person at the door: ${hov}`)
  if (!hov) notes.audit.push(`${tag}: in third person, aiming at the door from 2.4 m hovers nothing`)
  await shot(p, `char-${tag}-06-third-reticle-door`)
  const pin = await p.evaluate(() => { const s = window.__ESCAPE__.store.getState(); const b = s.boardPins[0]; return b ? { id: b.roomId, t: b.target } : null })
  if (pin) {
    await aimAt(p, [pin.t[0], 1.6, pin.t[2] + 2.2], pin.t)
    await p.waitForFunction(() => !!window.__ESCAPE__.store.getState().hoveredId, null, { timeout: 15000 }).catch(() => {})
    const h2 = await p.evaluate(() => window.__ESCAPE__.store.getState().hoveredId)
    notes.info.push(`${tag}: hovered at board pin in third person: ${h2}`)
    if (phone) await p.getByTestId('interact-tap').tap().catch(() => notes.audit.push(`${tag}: no interact button while hovering a pin in third person`))
    else await p.keyboard.press('e')
    await p.waitForTimeout(1500)
    notes.info.push(`${tag}: overlay after interacting with the pin in third person: ${await overlayKind(p)}`)
    await shot(p, `char-${tag}-07-third-open-pin`)
    await p.keyboard.press('Escape'); await p.evaluate(() => window.__ESCAPE__.store.setState({ overlay: null }))
  }
  // Wardrobe and keys
  await p.getByTestId('wardrobe-button').click()
  await waitOverlay(p, 'wardrobe')
  await p.waitForTimeout(1500)
  await shot(p, `char-${tag}-08-wardrobe`)
  notes.audit.push(...await layoutAudit(p, `${tag} wardrobe`))
  notes.info.push(`${tag} key balance: ` + (await p.getByTestId('key-balance').innerText()).replace(/\s+/g, ' '))
  const earn = p.getByTestId('earn-info').or(p.getByTestId('earn-summary')).first()
  if (await earn.count()) { await earn.click().catch(() => {}); await p.waitForTimeout(400); await shot(p, `char-${tag}-08b-earn-info`); notes.info.push(`${tag} earn info: ` + (await earn.innerText()).replace(/\s+/g, ' ').slice(0, 250)) }
  const tabs = await p.locator('[data-testid^="wardrobe-tab-"]').evaluateAll((e) => e.map((x) => x.getAttribute('data-testid').slice(13)))
  const priced = []
  for (const t of tabs) {
    await p.getByTestId(`wardrobe-tab-${t}`).click()
    await p.waitForTimeout(400)
    await shot(p, `char-${tag}-09-tab-${t}`)
    const items = await p.locator('[data-testid^="item-"]').evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-testid').slice(5), text: e.textContent.replace(/\s+/g, ' ').trim(), label: e.getAttribute('aria-label') })))
    priced.push(...items.filter((i) => /\d/.test(i.text + (i.label || ''))).map((i) => ({ tab: t, ...i })))
  }
  notes.info.push(`${tag} priced items: ${JSON.stringify(priced.map((x) => x.id + ':' + (x.label || x.text).slice(0, 40))).slice(0, 600)}`)
  // Try something too expensive.
  const exp = { tab: 'top', id: 'top-trench', price: 50 }
  if (await p.getByTestId('wardrobe-tab-top').count()) {
    await p.getByTestId(`wardrobe-tab-${exp.tab}`).click(); await p.getByTestId(`item-${exp.id}`).click()
    const prim = p.getByTestId('wardrobe-primary')
    notes.info.push(`${tag}: most expensive ${exp.id} (${exp.price}) primary "${(await prim.innerText()).replace(/\s+/g, ' ')}" disabled=${await prim.isDisabled()}`)
    await shot(p, `char-${tag}-10-too-expensive`)
    if (!(await prim.isDisabled())) { await prim.click(); await p.waitForTimeout(1200); notes.info.push(`${tag}: after pressing buy on too-expensive: msg "${(await p.getByTestId('wardrobe-message').innerText().catch(() => '')).replace(/\s+/g, ' ')}" overlay ${await overlayKind(p)}`); await shot(p, `char-${tag}-10b-too-expensive-pressed`) }
  }
  // Server rejects wearing an unowned item.
  const put = await p.evaluate(async (item) => {
    const cur = await (await fetch('/api/me/avatar')).json()
    const outfit = { ...(cur.outfit || {}), top: item }
    const r = await fetch('/api/me/avatar', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outfit }) })
    return { status: r.status, body: (await r.text()).slice(0, 200) }
  }, 'top-trench')
  notes.info.push(`${tag}: PUT unowned item -> ${JSON.stringify(put)}`)
  if (put.status < 400) notes.audit.push(`${tag}: server accepted wearing an item that was not bought: ${JSON.stringify(put)}`)
  // Buy an affordable one and wear it.
  await p.getByTestId('wardrobe-tab-extras').click()
  const head = p.getByTestId('item-acc-headphones')
  if (await head.count()) {
    await head.click()
    notes.info.push(`${tag} primary: ` + (await p.getByTestId('wardrobe-primary').innerText()).replace(/\s+/g, ' '))
    await p.getByTestId('wardrobe-primary').click()
    await waitOverlay(p, null, 20000).catch(() => notes.audit.push(`${tag}: wardrobe did not close after unlock`))
  }
  await p.waitForTimeout(1200)
  await shot(p, `char-${tag}-11-after-unlock`)
  notes.info.push(`${tag}: after unlock message "${(await p.getByTestId('wardrobe-message').innerText().catch(() => '')).replace(/\s+/g, ' ')}" overlay ${await overlayKind(p)}`)
  if ((await overlayKind(p)) === 'wardrobe') {
    await p.getByTestId('wardrobe-close').click().catch(() => {})
    await p.waitForTimeout(500)
    await shot(p, `char-${tag}-11b-close-after-unlock`)
    if (await p.getByTestId('wardrobe-discard-yes').count()) await p.getByTestId('wardrobe-discard-yes').click()
    const saved = await p.evaluate(async () => (await (await fetch('/api/me/avatar')).json()).outfit)
    notes.info.push(`${tag}: saved outfit after closing: accessory=${saved?.accessory} top=${saved?.top}`)
  }
  notes.info.push(`${tag} after unlock: ` + JSON.stringify(await keyBalance(ctx)))
  // Unsaved change + Escape
  await p.getByTestId('wardrobe-button').click()
  await waitOverlay(p, 'wardrobe')
  await p.getByTestId('wardrobe-tab-hair').click().catch(() => {})
  const swatch = p.locator('[data-testid^="swatch-"]').nth(3)
  if (await swatch.count()) await swatch.click()
  await p.keyboard.press('Escape')
  await p.waitForTimeout(800)
  notes.info.push(`${tag}: Escape with unsaved change -> overlay ${await overlayKind(p)}, discard prompt ${await p.getByTestId('wardrobe-discard-yes').count()}`)
  await shot(p, `char-${tag}-12-escape-unsaved`)
  if (await p.getByTestId('wardrobe-discard-yes').count()) await p.getByTestId('wardrobe-discard-yes').click()
  await p.evaluate(() => window.__ESCAPE__.store.setState({ overlay: null }))
  // Back to first person
  if (phone) await p.getByTestId('camera-toggle').tap(); else await p.keyboard.press('v')
  await p.waitForFunction(() => window.__ESCAPE_VIEW__?.playerView.blend === 0, null, { timeout: SLOW }).catch(() => notes.audit.push(`${tag}: did not return to first person`))
  await shot(p, `char-${tag}-13-first-again`)
  // Signed-out demo wardrobe
  const dctx = await device(kind)
  const d = await dctx.newPage(); watch(d, notes.errors)
  await d.goto('/?desktop=1&demo=1&gate=off&autostart=1'); await waitRoom(d); await d.waitForTimeout(1000)
  await d.getByTestId('wardrobe-button').click().catch(() => notes.audit.push(`${tag}: demo room has no wardrobe button`))
  await d.waitForTimeout(1500)
  await shot(d, `char-${tag}-14-demo-wardrobe`)
  notes.info.push(`${tag} demo wardrobe text: ` + (await d.getByTestId('wardrobe-overlay').innerText().catch(() => 'none')).replace(/\s+/g, ' ').slice(0, 250))
  await dctx.close()
  await ctx.close()
}

async function multiplayer(notes, phoneGuest) {
  const tag = phoneGuest ? 'mp-phone' : 'mp-desk'
  const A = person(phoneGuest ? 'r3mpa' : 'r3mda', 'Avery Host')
  const B = person(phoneGuest ? 'r3mpb' : 'r3mdb', 'Blake Guest')
  const hc = await device('laptop', true), gc = await device(phoneGuest ? 'phone' : 'laptop', true)
  const hu = await signIn(hc, A); await signIn(gc, B)
  await hc.request.post('/api/friends/requests', { data: { handle: B.handle } })
  const acc = await gc.request.post(`/api/friends/${hu.id}/accept`)
  if (!acc.ok()) notes.audit.push(`${tag}: accept friend failed ${acc.status()}`)
  const h = await hc.newPage(), g = await gc.newPage()
  watch(h, notes.errors); watch(g, notes.errors)
  await h.goto('/?autostart=1&gate=off'); await waitRoom(h)
  await h.waitForFunction((x) => window.__ESCAPE_NET__?.store.getState().home?.handle === x, A.handle, { timeout: SLOW })
  await h.evaluate(() => window.__ESCAPE__.requestTeleport([0, 1.6, 3], 0, 0))
  // Record every toast the host sees, with time, so a short-lived one isn't missed.
  await h.evaluate(() => {
    window.__QA_TOASTS__ = []
    new MutationObserver(() => { const t = document.querySelector('[data-testid="shell-toast"]')?.textContent; const l = window.__QA_TOASTS__; if (t && l.at(-1)?.t !== t) l.push({ t, at: Date.now() }) }).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
  // Guest: phone users start on /m; find a way to the friend's room from there.
  if (phoneGuest) {
    await g.goto('/m'); await g.waitForTimeout(2500)
    await shot(g, `${tag}-00-guest-phone-home`)
    await g.getByTestId('friends-online').waitFor({ timeout: 70000 }).catch(() => {})
    await shot(g, `${tag}-00b-guest-phone-friends-online`)
    notes.audit.push(...await layoutAudit(g, `${tag} /m friends online`))
    const links = await g.locator(`a[href^="/home/${A.handle}"]`).count()
    notes.info.push(`${tag}: links to /home/${A.handle} on /m: ${links}; card: ${(await g.getByTestId('friends-online').innerText().catch(() => 'none')).replace(/\s+/g, ' ')}`)
    if (!links) notes.audit.push(`${tag}: the phone app (/m) shows no Visit for an online friend within 70 s`)
    else {
      await g.locator(`a[href^="/home/${A.handle}"]`).first().tap()
      await g.waitForURL((u) => u.pathname === `/home/${A.handle}`, { timeout: SLOW })
      await g.waitForTimeout(3000)
      await shot(g, `${tag}-00c-guest-phone-visit-landing`)
      notes.info.push(`${tag}: phone visit landing text: ${(await g.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200)}`)
      const enter = g.getByRole('button', { name: /enter|come in|step in|start/i }).first()
      if (await enter.count()) await enter.tap().catch(() => {})
      await waitRoom(g).catch(() => notes.audit.push(`${tag}: phone visit from /m did not load the friend's 3D room`))
      await g.waitForTimeout(2000)
      await shot(g, `${tag}-00d-guest-phone-in-friends-room`)
      notes.audit.push(...await layoutAudit(g, `${tag} phone visiting from /m`))
    }
  }
  await g.goto('/?desktop=1&autostart=1&gate=off'); await waitRoom(g)
  await g.waitForTimeout(1500)
  await shot(g, `${tag}-01-guest-own-room`)
  notes.audit.push(...await layoutAudit(g, `${tag} guest own room`))
  if (phoneGuest) await g.getByTestId('people-button').tap(); else await g.keyboard.press('f')
  await g.getByTestId('people-panel').waitFor({ timeout: 15000 }).catch(() => notes.audit.push(`${tag}: people panel did not open`))
  await g.waitForTimeout(2000)
  await shot(g, `${tag}-02-guest-people-panel`)
  notes.audit.push(...await layoutAudit(g, `${tag} people panel`))
  const hostRow = g.locator(`[data-testid="visit-friend"][data-handle="${A.handle}"]`)
  notes.info.push(`${tag}: host row online=${await hostRow.getAttribute('data-online').catch(() => 'missing')} text=${(await hostRow.innerText().catch(() => '')).replace(/\s+/g, ' ')}`)
  const t0 = Date.now()
  await hostRow.getByTestId('visit-friend-button').click()
  await g.waitForURL((u) => u.pathname === `/home/${A.handle}`, { timeout: SLOW })
  await waitRoom(g)
  notes.info.push(`${tag}: visit to room ready in ${Date.now() - t0} ms`)
  await g.waitForFunction((x) => window.__ESCAPE_NET__?.store.getState().home?.handle === x, A.handle, { timeout: SLOW })
  await g.evaluate(() => window.__ESCAPE__.requestTeleport([0, 1.6, 0], Math.PI, 0))
  const ta = Date.now()
  await h.locator('text=/in your room|came in|is here|joined/i').first().waitFor({ timeout: 10000 }).catch(() => {})
  notes.info.push(`${tag}: arrival notice wait ${Date.now() - ta} ms`)
  notes.info.push(`${tag}: host toasts so far: ${JSON.stringify(await h.evaluate(() => window.__QA_TOASTS__.map((x) => x.t + ' @' + (Date.now() - x.at) + 'ms ago')))}`)
  const hostToast = await h.locator('text=/in your room|came in|is here|joined/i').allInnerTexts().catch(() => [])
  notes.info.push(`${tag}: host arrival notice: ${JSON.stringify(hostToast).slice(0, 200)}`)
  if (!hostToast.length) notes.audit.push(`${tag}: host got no visible "Blake is in your room" notice within 10 s of the guest arriving`)
  await shot(h, `${tag}-03-host-sees-guest`)
  await shot(g, `${tag}-04-guest-sees-host`)
  notes.audit.push(...await layoutAudit(g, `${tag} guest visiting`))
  notes.audit.push(...await layoutAudit(h, `${tag} host with guest`))
  // Guest tries to edit: open a board pin and look for edit controls, and try the record key.
  await g.keyboard.press('r').catch(() => {})
  await g.waitForTimeout(500)
  notes.info.push(`${tag}: guest overlay after pressing R: ${await overlayKind(g)}`)
  const pin = await g.evaluate(() => window.__ESCAPE__.store.getState().boardPins[0]?.roomId ?? null)
  notes.info.push(`${tag}: host board pins visible to guest: ${await g.evaluate(() => window.__ESCAPE__.store.getState().boardPins.length)}`)
  if (pin) {
    await g.evaluate((id) => window.__ESCAPE__.bus.emit('review:open', { roomId: id }), pin)
    await g.waitForTimeout(1500)
    await shot(g, `${tag}-04b-guest-opens-host-review`)
    const editable = await g.locator('[data-testid="photo-input"], [data-testid="review-photo-attach"], button:has-text("Edit"), button:has-text("Delete")').count()
    notes.info.push(`${tag}: edit/upload controls in host's review for guest: ${editable}`)
    if (editable) notes.audit.push(`${tag}: guest sees edit/upload controls in the host's review`)
    await g.keyboard.press('Escape'); await g.evaluate(() => window.__ESCAPE__.store.setState({ overlay: null }))
  }
  // Chat
  if (phoneGuest) await g.getByTestId('chat-button').tap(); else await g.keyboard.press('t')
  await g.getByTestId('chat-input').fill('Hello from the guest! Nice room')
  await shot(g, `${tag}-05-guest-chat-typing`)
  await g.getByTestId('chat-input').press('Enter')
  await h.getByTestId('chat-bubble').waitFor({ timeout: 20000 }).catch(() => notes.audit.push(`${tag}: host saw no chat bubble`))
  await h.waitForTimeout(800)
  await shot(h, `${tag}-06-host-chat-received`)
  // Emoji / script / html injection in chat
  await g.getByTestId('chat-input').fill('<img src=x onerror=alert(1)> 你好 👋🏽')
  await g.getByTestId('chat-input').press('Enter')
  await h.waitForTimeout(1500)
  const logText = await h.getByTestId('chat-log').innerText().catch(() => '')
  notes.info.push(`${tag}: host chat log tail: ${logText.replace(/\s+/g, ' ').slice(-160)}`)
  const injected = await h.locator('[data-testid="chat-log"] img, [data-testid="chat-bubble"] img').count()
  if (injected) notes.audit.push(`${tag}: chat HTML rendered as markup`)
  // Host replies
  await h.keyboard.press('t'); await h.getByTestId('chat-input').fill('Welcome!'); await h.getByTestId('chat-input').press('Enter'); await h.keyboard.press('Escape')
  if (phoneGuest) await g.getByLabel('Close chat').tap().catch(() => {}); else await g.keyboard.press('Escape')
  await g.waitForTimeout(1500)
  await shot(g, `${tag}-07-guest-sees-reply`)
  notes.info.push(`${tag}: guest unread badge: ${await g.getByTestId('chat-unread').innerText().catch(() => 'none')}`)
  // Emotes
  for (const e of ['wave', 'cheer', 'dance']) {
    if (phoneGuest) { await g.getByTestId('emote-button').tap(); await g.waitForTimeout(300); if (e === 'wave') await shot(g, `${tag}-08-emote-menu`); await g.getByTestId(`emote-${e}`).tap() }
    else await g.getByTestId(`emote-${e}`).click()
    const seen = await h.waitForFunction(({ hd, e }) => { const st = window.__ESCAPE_NET__.store.getState(); const pl = Object.values(st.players).find((x) => x.user.handle === hd); return !!pl && st.emotes[pl.sid]?.emote === e }, { hd: B.handle, e }, { timeout: 10000 }).then(() => true).catch(() => false)
    if (!seen) notes.audit.push(`${tag}: host never saw emote ${e}`)
    await h.waitForTimeout(500)
    await shot(h, `${tag}-09-host-sees-${e}`)
  }
  // Guest in third person
  if (phoneGuest) await g.getByTestId('camera-toggle').tap().catch(() => {}); else await g.keyboard.press('v')
  await g.waitForTimeout(1500)
  await shot(g, `${tag}-10-guest-third-person`)
  // Guest walks: host sees motion (real input).
  const before = await h.evaluate((hd) => { const n = window.__ESCAPE_NET__; const pl = Object.values(n.store.getState().players).find((x) => x.user.handle === hd); return pl ? [...n.poses.get(pl.sid).latest().s.p] : null }, B.handle)
  if (phoneGuest) { const d = await touchDrag(gc, g, '[data-joystick]', 0, -60); await g.waitForTimeout(1500); await d.end() }
  else { await g.keyboard.down('KeyW'); await g.waitForTimeout(1500); await g.keyboard.up('KeyW') }
  await h.waitForTimeout(800)
  const afterP = await h.evaluate((hd) => { const n = window.__ESCAPE_NET__; const pl = Object.values(n.store.getState().players).find((x) => x.user.handle === hd); return pl ? [...n.poses.get(pl.sid).latest().s.p] : null }, B.handle)
  notes.info.push(`${tag}: host sees guest move ${JSON.stringify(before?.map((x) => +x.toFixed(2)))} -> ${JSON.stringify(afterP?.map((x) => +x.toFixed(2)))}`)
  await shot(h, `${tag}-11-host-sees-guest-walked`)
  // Host people panel
  await h.keyboard.press('f'); await h.waitForTimeout(800); await shot(h, `${tag}-12-host-people-panel`)
  notes.info.push(`${tag}: host people panel: ${(await h.getByTestId('people-panel').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 250)}`)
  await h.keyboard.press('Escape')
  // Guest goes back home with the button
  await g.getByTestId('visit-back-home').click()
  await g.waitForURL((u) => !u.pathname.startsWith('/home/'), { timeout: SLOW })
  notes.info.push(`${tag}: back home -> ${g.url()}`)
  await g.waitForTimeout(3000)
  await shot(g, `${tag}-13-guest-back-home`)
  const tl = Date.now()
  await h.waitForFunction(() => Object.keys(window.__ESCAPE_NET__.store.getState().players).length === 0, null, { timeout: 60000 }).then(() => notes.info.push(`${tag}: host saw guest leave after ${Date.now() - tl} ms`)).catch(() => notes.audit.push(`${tag}: host still shows guest 60 s after they left`))
  // Host visits the guest from /settings friend list.
  const s = await hc.newPage(); watch(s, notes.errors)
  await s.goto('/settings'); await s.waitForTimeout(2500)
  await shot(s, `${tag}-14-settings-friends`, true)
  const fr = s.locator('[data-testid="friend-row"]').filter({ hasText: B.handle })
  notes.info.push(`${tag}: settings row: ${(await fr.innerText().catch(() => '')).replace(/\s+/g, ' ')} online=${await fr.getByTestId('presence-dot').getAttribute('data-online').catch(() => '?')}`)
  if (!phoneGuest) {
    await fr.getByTestId('friend-visit').click()
    await s.waitForURL((u) => u.pathname === `/home/${B.handle}`, { timeout: SLOW })
    await s.getByTestId('desktop-room').or(s.locator('canvas')).first().waitFor({ timeout: SLOW }).catch(() => {})
    const enter = s.getByRole('button', { name: /enter|come in|step in/i }).first()
    if (await enter.count()) await enter.click().catch(() => {})
    await waitRoom(s).catch(() => notes.audit.push(`${tag}: visiting from settings did not load the friend's room`))
    await s.waitForTimeout(2000)
    await shot(s, `${tag}-15-host-visits-guest-from-settings`)
    const seen = await g.waitForFunction((hd) => Object.values(window.__ESCAPE_NET__?.store.getState().players ?? {}).some((x) => x.user.handle === hd), A.handle, { timeout: 30000 }).then(() => true).catch(() => false)
    notes.info.push(`${tag}: guest sees host arrive in their room: ${seen}`)
    await shot(g, `${tag}-16-guest-sees-host-visit`)
  }
  // Unfriend while visiting: guest must be removed.
  if (!phoneGuest) {
    const del = await gc.request.delete(`/api/friends/${hu.id}`)
    notes.info.push(`${tag}: guest unfriends host -> ${del.status()}`)
    const t1 = Date.now()
    const gone = await s.waitForFunction(() => { const st = window.__ESCAPE_NET__?.store.getState(); return !st?.home || Object.keys(st.players).length === 0 }, null, { timeout: 90000 }).then(() => true).catch(() => false)
    notes.info.push(`${tag}: after unfriend, host-as-visitor removed: ${gone} after ${Date.now() - t1} ms`)
    await s.waitForTimeout(1000)
    await shot(s, `${tag}-17-after-unfriend`)
  }
  await hc.close(); await gc.close()
}

async function daily(notes, kind, signedIn) {
  const tag = signedIn ? (kind === 'phone' ? 'daily-phone' : 'daily-desk') : 'daily-out'
  const ctx = await device(kind)
  if (signedIn) await signIn(ctx, person(kind === 'phone' ? 'r3dyp' : 'r3dyd', 'Dana Daily'))
  const keys0 = signedIn ? await keyBalance(ctx) : null
  const p = await ctx.newPage(); watch(p, notes.errors)
  if (kind === 'laptop' && signedIn) {
    await p.goto('/?autostart=1')
    await waitRoom(p)
    await aimAt(p, [0, 1.6, 6], [0, 1.2, 7.95])
    await p.waitForTimeout(1500)
    await p.keyboard.press('e')
    await p.waitForTimeout(1500)
    await shot(p, `${tag}-00-door-overlay`)
    const play3d = p.getByTestId('daily-play-3d')
    if (await play3d.count()) { await play3d.click(); await p.waitForURL(/daily\/room/, { timeout: SLOW }) }
    else { notes.audit.push(`${tag}: no Play in 3D in the door overlay`); await p.goto('/daily/room') }
  } else if (kind === 'phone') {
    await p.goto('/daily'); await p.waitForTimeout(2000)
    await shot(p, `${tag}-00-daily-2d`, true)
    const play3d = p.getByTestId('daily-play-3d')
    if (await play3d.count()) { await play3d.tap(); await p.waitForURL(/daily\/room/, { timeout: SLOW }) }
    else { notes.audit.push(`${tag}: /daily has no Play in 3D on a phone`); await p.goto('/daily/room') }
  } else await p.goto('/daily/room')
  await p.getByTestId('daily-room-enter').waitFor({ timeout: SLOW })
  await shot(p, `${tag}-01-entry`)
  notes.audit.push(...await layoutAudit(p, `${tag} entry`))
  const tEnter = Date.now()
  await p.getByTestId('daily-room-enter').click()
  await p.waitForFunction(() => !!window.__ESCAPE__?.store.getState().worldReady, null, { timeout: SLOW })
  notes.info.push(`${tag}: room ready ${Date.now() - tEnter} ms after Enter`)
  await p.waitForTimeout(2500)
  await shot(p, `${tag}-02-inside`)
  notes.audit.push(...await layoutAudit(p, `${tag} inside`))
  const hook = await p.evaluate(() => ({ kind: window.__ESCAPE_DAILY__.kind, mode: window.__ESCAPE_DAILY__.mode, answer: window.__ESCAPE_DAILY__.answer() }))
  notes.info.push(`${tag}: puzzle kind ${hook.kind}/${hook.mode}`)
  // Third person in the puzzle room
  if (kind === 'phone') await p.getByTestId('camera-toggle').tap().catch(() => notes.audit.push(`${tag}: no camera toggle in the puzzle room`))
  else await p.keyboard.press('v')
  await p.waitForTimeout(1500)
  await shot(p, `${tag}-03-third-person`)
  for (const [i, yaw] of [[0, 0], [1, Math.PI / 2], [2, Math.PI], [3, -Math.PI / 2]]) {
    await p.evaluate((y) => window.__ESCAPE__.requestTeleport([0, 1.6, 1], y, -0.05), yaw)
    await p.waitForTimeout(900)
    await shot(p, `${tag}-04-look-${i}`)
  }
  // Hint
  const hint = p.getByTestId('daily-room-hint').or(p.getByTestId('daily-hint')).first()
  if (await hint.count()) { await hint.click().catch(() => {}); await p.waitForTimeout(800); await shot(p, `${tag}-05-hint`); notes.info.push(`${tag}: hints ${(await p.getByTestId('daily-hints').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)}`) }
  // Real aim + E/tap on the lock
  if (hook.kind !== 'search') {
    const lockPos = await p.evaluate(() => window.__ESCAPE_DAILY_ROOM__?.lock?.() ?? null).catch(() => null)
    await aimAt(p, [1.0, 1.6, -1.6], lockPos ?? [1.18, 1.3, -2.99])
    await p.waitForFunction(() => !!window.__ESCAPE__.store.getState().hoveredId, null, { timeout: 15000 }).catch(() => {})
    const hv = await p.evaluate(() => window.__ESCAPE__.store.getState().hoveredId)
    notes.info.push(`${tag}: hovered at lock (third person): ${hv}`)
    await shot(p, `${tag}-06-aim-lock`)
    if (kind === 'phone') await p.getByTestId('interact-tap').tap().catch(() => {})
    else await p.keyboard.press('e')
    await p.waitForTimeout(1200)
    if (!(await p.getByTestId('daily-room-lock').isVisible().catch(() => false))) {
      notes.audit.push(`${tag}: aiming at the lock in third person (hovered=${hv}) and pressing ${kind === 'phone' ? 'the tap button' : 'E'} did not open it`)
      await p.evaluate(() => window.__ESCAPE__.bus.emit('interact', { id: 'daily:lock', kind: 'gate' }))
    }
    await p.getByTestId('daily-room-lock').waitFor({ timeout: SLOW })
    await shot(p, `${tag}-07-lock-panel`)
    notes.audit.push(...await layoutAudit(p, `${tag} lock panel`))
    // On phones, typing into the lock: simulate keyboard
    if (kind === 'phone') {
      const inp = p.locator('[data-testid^="daily-input"]').first()
      if (await inp.count()) { await inp.tap(); await p.setViewportSize({ width: 390, height: 460 }); await p.waitForTimeout(700); await shot(p, `${tag}-07b-lock-keyboard`); const b = await inp.boundingBox(); if (b && (b.y < 0 || b.y + b.height > 460)) notes.audit.push(`${tag}: lock input hidden behind the keyboard`); const sb = await p.getByTestId('daily-submit').boundingBox().catch(() => null); if (sb && (sb.y + sb.height > 460)) notes.audit.push(`${tag}: lock submit button below the keyboard`); await p.setViewportSize({ width: 390, height: 844 }) }
    }
    if (hook.kind === 'sequence' && hook.mode === 'shape') { for (const id of [...hook.answer].reverse()) await p.getByTestId(`daily-choice-${id}`).click() }
    else if (hook.kind === 'sequence') { for (let i = 0; i < hook.answer.length; i++) await p.getByTestId(`daily-input-${i}`).fill('zz') }
    else await p.getByTestId('daily-input').fill(hook.answer.map(() => '0').join(''))
    await p.getByTestId('daily-submit').click().catch(() => {})
    await p.waitForTimeout(1200)
    await shot(p, `${tag}-08-wrong`)
    if (!(await p.getByTestId('daily-room-lock').isVisible().catch(() => false))) await p.evaluate(() => window.__ESCAPE__.bus.emit('interact', { id: 'daily:lock', kind: 'gate' }))
    if (hook.kind === 'sequence' && hook.mode === 'shape') { for (const id of hook.answer) await p.getByTestId(`daily-choice-${id}`).click() }
    else if (hook.kind === 'sequence') { for (let i = 0; i < hook.answer.length; i++) await p.getByTestId(`daily-input-${i}`).fill(hook.answer[i]) }
    else await p.getByTestId('daily-input').fill(hook.answer.join(''))
    await p.getByTestId('daily-submit').click()
  } else {
    const spots = await p.evaluate(() => Object.keys(window.__ESCAPE_DAILY_ROOM__.spots()))
    for (const s of spots) await p.evaluate((id) => window.__ESCAPE__.bus.emit('interact', { id: `daily:spot:${id}`, kind: 'prop' }), s)
  }
  await p.waitForFunction(() => document.querySelector('[data-testid="daily-room"]')?.getAttribute('data-status') === 'solved', null, { timeout: SLOW })
  await p.waitForTimeout(1500)
  await shot(p, `${tag}-09-solved`)
  notes.audit.push(...await layoutAudit(p, `${tag} result`))
  notes.info.push(`${tag}: result text ` + (await p.getByTestId('daily-room-result-panel').or(p.getByTestId('daily-room-result')).first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300))
  await p.getByTestId('daily-room-walk').click()
  await p.waitForTimeout(1500)
  await shot(p, `${tag}-10-door-open`)
  // Walk to the exit for real.
  await p.evaluate(() => window.__ESCAPE__.requestTeleport([0, 1.6, 0.5], 0, 0))
  const t0 = Date.now()
  if (kind === 'laptop') {
    await p.keyboard.down('KeyW')
    await p.waitForURL((u) => !u.pathname.startsWith('/daily'), { timeout: 60000 }).catch(() => notes.audit.push(`${tag}: walking north with W for 60 s did not leave the room`))
    await p.keyboard.up('KeyW')
  } else {
    const d = await touchDrag(ctx, p, '[data-joystick]', 0, -60)
    await p.waitForURL((u) => !u.pathname.startsWith('/daily'), { timeout: 60000 }).catch(async () => { notes.audit.push(`${tag}: joystick walk for 60 s did not leave the room (pos ${JSON.stringify(await p.evaluate(() => window.__ESCAPE__?.runtime.player.position).catch(() => null))})`) })
    await d.end()
  }
  notes.info.push(`${tag}: left the room after ${Date.now() - t0} ms -> ${p.url()}`)
  await p.waitForTimeout(6000)
  await shot(p, `${tag}-11-arrived-home`)
  notes.info.push(`${tag}: welcome ${(await p.getByTestId('daily-welcome').innerText().catch(() => 'none')).replace(/\s+/g, ' ')}`)
  if (kind === 'laptop') {
    const s = await p.evaluate(() => { const s = window.__ESCAPE__?.store.getState(); return s ? { src: s.dataSource, pos: window.__ESCAPE__.runtime.player.position } : null }).catch(() => null)
    notes.info.push(`${tag}: arrived room state ${JSON.stringify(s)}`)
  }
  if (signedIn) {
    const keys1 = await keyBalance(ctx)
    notes.info.push(`${tag}: keys before ${JSON.stringify(keys0)} after daily ${JSON.stringify(keys1)}`)
    await p.goto('/daily'); await p.waitForTimeout(2500); await shot(p, `${tag}-12-daily-2d-after`, true)
    notes.info.push(`${tag}: /daily after: ${(await p.getByTestId('daily-page').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 250)}`)
    await p.goto('/daily/room'); await p.waitForTimeout(3000); await shot(p, `${tag}-13-room-after-solved`)
    notes.info.push(`${tag}: /daily/room after solving: ${(await p.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 250)}`)
  }
  await ctx.close()
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenarios)
for (const name of wanted) {
  const notes = { errors: [], audit: [], info: [], ok: false }
  const t = Date.now()
  console.log('==>', name)
  try { await scenarios[name](notes); notes.ok = true } catch (e) { notes.failure = String(e.stack || e).slice(0, 1500) }
  notes.ms = Date.now() - t
  results[name] = notes
  writeFileSync(RESULTS, JSON.stringify(results, null, 2))
  console.log(JSON.stringify(notes, null, 2))
}
await browser.close()

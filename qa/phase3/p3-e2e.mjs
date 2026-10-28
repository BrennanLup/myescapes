/**
 * Phase 3 QA round 1: drive every Phase 3 feature by hand-ish (real clicks, some test hooks to
 * aim/teleport) on a laptop and a Pixel 7, saving screenshots under qa/phase3/shots/.
 *
 * Needs a server started with NODE_ENV=test (test login) on QA_BASE, e.g.
 *   NODE_ENV=test PORT=3301 DATA_DIR=/some/tmp npm run serve   (after e2e/support/prepare-db.ts)
 *   QA_BASE=http://localhost:3301 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node qa/phase3/p3-e2e.mjs [scenario...]
 *
 * Scenarios: review-desktop review-phone character-desktop character-phone multiplayer
 * multiplayer-phone daily-desktop daily-phone. Results: qa/phase3/results.json.
 */
import { chromium, devices } from 'playwright'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const BASE = process.env.QA_BASE ?? 'http://localhost:3301'
const OUT = path.resolve('qa/phase3/shots')
mkdirSync(OUT, { recursive: true })
const RESULTS = path.resolve('qa/phase3/results.json')
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
async function signIn(ctx, p) {
  const r = await ctx.request.post('/api/test/login', { data: { email: p.email, name: p.name, handle: p.handle } })
  if (r.status() !== 200) throw new Error('test login failed ' + r.status())
  return (await r.json()).user
}
function watch(page, log) {
  page.on('pageerror', (e) => log.push(`pageerror ${page.url()}: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) log.push(`console ${page.url()}: ${m.text().slice(0, 300)}`)
    if (m.type() === 'warning' && /react|three|WebGL/i.test(m.text())) log.push(`warn ${m.text().slice(0, 200)}`)
  })
  page.on('response', (r) => {
    const u = new URL(r.url())
    if (u.pathname.startsWith('/api/') && r.status() >= 400 && !(r.status() === 401 && u.pathname === '/api/me')) log.push(`http ${r.request().method()} ${u.pathname} -> ${r.status()}`)
  })
}
async function shot(page, name, full = false) {
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: 72, fullPage: full }).catch((e) => console.log('shot failed', name, e.message))
}
async function waitRoom(page) {
  await page.waitForFunction(() => {
    const s = window.__ESCAPE__?.store.getState()
    return !!s && s.worldReady && s.dataStatus === 'ready'
  }, null, { timeout: SLOW * 2 })
}
const waitOverlay = (page, k) => page.waitForFunction((k) => (window.__ESCAPE__.store.getState().overlay?.kind ?? null) === k, k, { timeout: SLOW })
async function aimAt(page, from, target) {
  await page.evaluate(({ from, target }) => {
    const dx = target[0] - from[0], dy = target[1] - from[1], dz = target[2] - from[2]
    window.__ESCAPE__.requestTeleport(from, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)))
  }, { from, target })
}
/** Things that commonly look rough: horizontal page scroll, small tap targets, overlapping fixed clusters. */
async function layoutAudit(page, label) {
  return page.evaluate((label) => {
    const out = []
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`${label}: page scrolls sideways (${document.documentElement.scrollWidth} > ${window.innerWidth})`)
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth }
    const btns = [...document.querySelectorAll('button, a[href], input, select, textarea')].filter(vis)
    const small = btns.filter((b) => { const r = b.getBoundingClientRect(); return (r.width < 32 || r.height < 32) && !(b.type === 'checkbox' || b.type === 'radio' || b.tagName === 'A') })
    if (small.length && innerWidth < 500) out.push(`${label}: ${small.length} visible controls smaller than 32px: ` + small.slice(0, 6).map((b) => (b.getAttribute('data-testid') || b.getAttribute('aria-label') || b.textContent?.trim().slice(0, 20) || b.tagName) + `(${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)})`).join(', '))
    const ids = ['character-hud', 'people-dock', 'interact-tap', 'visit-banner', 'chat-area', 'daily-room-controls']
    const boxes = ids.map((id) => [id, document.querySelector(`[data-testid="${id}"]`)]).filter(([, el]) => el && vis(el)).map(([id, el]) => [id, el.getBoundingClientRect()])
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [a, ra] = boxes[i], [b, rb] = boxes[j]
      if (ra.left < rb.right && rb.left < ra.right && ra.top < rb.bottom && rb.top < ra.bottom) out.push(`${label}: ${a} overlaps ${b}`)
    }
    // Clipped text in buttons
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

const scenarios = {
  async 'review-phone'(notes) {
    const ctx = await device('phone')
    await signIn(ctx, person('qrevp', 'Quinn Phone'))
    const p = await ctx.newPage(); watch(p, notes.errors)
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
    // Simulate a keyboard: shrink the viewport the way Chrome on Android does when the keyboard opens.
    await p.getByTestId('confirm-comment-difficulty').focus()
    await p.setViewportSize({ width: 390, height: 480 })
    await p.waitForTimeout(800)
    await p.keyboard.type('Clever final lock, ')
    await shot(p, 'review-phone-04-typing-keyboard')
    const footer = await p.getByTestId('confirm-footer').boundingBox().catch(() => null)
    const field = await p.getByTestId('confirm-comment-difficulty').boundingBox()
    notes.info.push(`keyboard-sim: focused field box ${JSON.stringify(field)}, footer ${JSON.stringify(footer)}`)
    if (field && (field.y < 0 || field.y + field.height > 480)) notes.audit.push('phone form: focused field not in view with simulated keyboard (480px tall)')
    if (footer && field && footer.y < field.y + field.height && footer.y + footer.height > field.y) notes.audit.push('phone form: Save bar covers the focused field with simulated keyboard')
    await p.setViewportSize({ width: 390, height: 844 })
    // Room search: unknown name -> add a new room.
    await p.getByTestId('confirm-change-game').click()
    await p.getByTestId('confirm-room-search').fill('Zyxw Nonexistent Room')
    await p.waitForTimeout(1500)
    await shot(p, 'review-phone-05-search-none')
    const opts = await p.locator('[data-testid^="roompicker-option-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') + ':' + e.textContent.trim().slice(0, 50)))
    notes.info.push('phone search no-match options: ' + JSON.stringify(opts))
    if (!opts.some((o) => /add|new/i.test(o))) notes.audit.push('phone room search: no "add a new room" option when nothing matches')
    await p.getByTestId('confirm-room-search').fill('Gold')
    await p.waitForTimeout(1500)
    await shot(p, 'review-phone-06-search-gold')
    await p.getByTestId('roompicker-option-game').filter({ hasText: 'Golden Gate Vault Job' }).first().click()
    // Photos
    await p.getByTestId('photo-input').setInputFiles([await pngFile(p, 'a.png', '#e07b39'), await pngFile(p, 'b.png', '#2f8f8a', 4000, 3000), await pngFile(p, 'c.png', '#6d3b5c')])
    await p.getByTestId('photo-status').waitFor()
    await p.waitForTimeout(2500)
    await p.getByTestId('confirm-photos-section').scrollIntoViewIfNeeded()
    await shot(p, 'review-phone-07-photos')
    notes.info.push('photo status: ' + (await p.getByTestId('photo-status').innerText()))
    // Non-image file
    await p.getByTestId('photo-input').setInputFiles([{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }]).catch((e) => notes.info.push('txt rejected by input: ' + e.message))
    await p.waitForTimeout(1000)
    await shot(p, 'review-phone-08-bad-file')
    notes.info.push('after txt: ' + (await p.getByTestId('confirm-photos-section').innerText()).replace(/\s+/g, ' ').slice(0, 300))
    for (const k of ['overall', 'puzzles', 'setting', 'storyline', 'difficulty']) {
      const i = p.getByTestId(`confirm-score-${k}`)
      if ((await i.inputValue()) === '') await i.fill('78')
    }
    if ((await p.getByTestId('confirm-date').inputValue()) === '') await p.getByTestId('confirm-date').fill('2026-10-18')
    await p.getByTestId('confirm-save').click()
    await p.getByTestId('log-done').waitFor({ timeout: SLOW })
    await p.waitForTimeout(4000)
    await shot(p, 'review-phone-09-done')
    notes.info.push('done: ' + (await p.getByTestId('log-done').innerText()).replace(/\s+/g, ' '))
    await p.getByTestId('log-done-home').click()
    await p.waitForURL(/\/m\/rooms\//, { timeout: SLOW })
    await p.waitForTimeout(2000)
    await shot(p, 'review-phone-10-room-detail', true)
    notes.audit.push(...await layoutAudit(p, 'phone room detail'))
    await ctx.close()
  },

  async 'review-desktop'(notes) {
    const ctx = await device('laptop')
    await signIn(ctx, person('qrevd', 'Quinn Desk'))
    const p = await ctx.newPage(); watch(p, notes.errors)
    await p.goto('/?gate=off&autostart=1')
    await waitRoom(p)
    await shot(p, 'review-desk-01-room')
    // Open the real record flow: type a review.
    await p.evaluate(() => window.__ESCAPE__.store.setState({ overlay: { kind: 'confirm', draft: {
      room: { name: 'Lighthouse', company: '', city: 'San Francisco', genre: null, address: null, website: null },
      review: { date: '', crew: [], ratings: { overall: { score: null, comment: '' }, puzzles: { score: null, comment: '' }, setting: { score: null, comment: '' }, storyline: { score: null, comment: '' }, difficulty: { score: null, comment: '' } }, puzzles: [], escaped: null, escapeTimeMinutes: null, visibleTimer: null, multiRoom: null, flashlights: null, liveActors: null, toolsUsed: [], voiceTranscript: 'typed' },
      flags: ['room.company'], mode: 'mock' } } }))
    await p.getByTestId('confirm-overlay').waitFor()
    await p.waitForTimeout(1500)
    await shot(p, 'review-desk-02-form')
    notes.audit.push(...await layoutAudit(p, 'desktop confirm'))
    const vis1 = await p.locator('[data-testid^="field-"]').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 0).length)
    await p.getByTestId('field-review.date').click()
    await p.keyboard.type('2026-10-20')
    const anyComment = p.locator('[data-testid$=".comment"]').first()
    if (await anyComment.count()) { await anyComment.click(); await p.keyboard.type('Great finale') }
    const vis2 = await p.locator('[data-testid^="field-"]').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 0).length)
    notes.info.push(`desktop form visible fields before typing ${vis1}, while typing ${vis2}`)
    if (vis2 < vis1) notes.audit.push(`desktop confirm: fields collapse while typing (${vis1} -> ${vis2})`)
    await shot(p, 'review-desk-03-typing')
    // Room search
    const search = p.getByTestId('room-search').locator('input').first()
    await search.fill('Lighth')
    await p.waitForTimeout(1500)
    await shot(p, 'review-desk-04-search')
    const opts = await p.locator('[data-testid^="roompicker-option-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') + ':' + e.textContent.trim().slice(0, 60)))
    notes.info.push('desktop search options: ' + JSON.stringify(opts))
    await search.fill('qqqq nothing here')
    await p.waitForTimeout(1500)
    await shot(p, 'review-desk-05-search-none')
    const none = await p.locator('[data-testid^="roompicker-option-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') + ':' + e.textContent.trim().slice(0, 60)))
    notes.info.push('desktop no-match options: ' + JSON.stringify(none) + ' / room-search text: ' + (await p.getByTestId('room-search').innerText()).replace(/\s+/g, ' ').slice(0, 200))
    await search.fill('Lighthouse')
    await p.waitForTimeout(1500)
    const first = p.locator('[data-testid="roompicker-option-game"]').first()
    if (await first.count()) await first.click()
    else if (await p.getByTestId('room-search-suggestion').count()) await p.getByTestId('room-search-suggestion').click()
    await p.waitForTimeout(500)
    // Photos
    await p.getByTestId('photo-input').setInputFiles([await pngFile(p, 'd.png', '#e8b93a'), await pngFile(p, 'e.png', '#3a6ee8')])
    await p.waitForTimeout(2500)
    await p.getByTestId('confirm-photos').scrollIntoViewIfNeeded()
    await shot(p, 'review-desk-06-photos')
    // Fill missing
    for (let g = 0; g < 40; g++) {
      const missing = await p.$$eval('[data-testid^="error-"]', (els) => els.map((e) => e.getAttribute('data-testid').slice(6)))
      if (!missing.length) break
      const m = missing[0]; const f = p.locator(`[data-testid="field-${m}"]`)
      if (/\.(escaped|visibleTimer|multiRoom|flashlights|liveActors)$/.test(m)) await p.locator(`[data-testid="field-${m}-yes"]`).click()
      else if (m === 'room.genre') await f.selectOption('mystery')
      else if (/\.score$/.test(m)) await f.fill('75')
      else if (m === 'review.date') await f.fill('2026-10-24')
      else await f.fill('QA')
    }
    await shot(p, 'review-desk-07-ready')
    await p.getByTestId('confirm-save').click()
    await waitOverlay(p, null)
    await p.waitForTimeout(5000)
    await shot(p, 'review-desk-08-saved')
    const st = await p.evaluate(() => { const s = window.__ESCAPE__.store.getState(); return s.reviews.map((r) => ({ id: r.id, room: s.rooms.find((x) => x.id === r.roomId)?.name, photos: r.photos.length })) })
    notes.info.push('after save reviews: ' + JSON.stringify(st))
    // Review overlay add photo
    const last = await p.evaluate(() => window.__ESCAPE__.store.getState().reviews.at(-1)?.roomId)
    if (last) {
      await p.evaluate((id) => window.__ESCAPE__.bus.emit('review:open', { roomId: id }), last)
      await waitOverlay(p, 'review')
      await p.waitForTimeout(1500)
      await shot(p, 'review-desk-09-review-overlay')
      const attach = p.getByTestId('review-photo-attach')
      if (await attach.count()) {
        await attach.scrollIntoViewIfNeeded()
        await attach.getByTestId('photo-input').setInputFiles([await pngFile(p, 'f.png', '#aa3355')])
        await p.waitForTimeout(4000)
        await shot(p, 'review-desk-10-review-photo-added')
        notes.info.push('review attach status: ' + (await attach.innerText()).replace(/\s+/g, ' ').slice(0, 200))
      } else notes.audit.push('review overlay: no add-photo control found')
    }
    await ctx.close()
  },

  async 'character-desktop'(notes) { await character(notes, 'laptop') },
  async 'character-phone'(notes) { await character(notes, 'phone') },

  async multiplayer(notes) { await multiplayer(notes, false) },
  async 'multiplayer-phone'(notes) { await multiplayer(notes, true) },

  async 'daily-desktop'(notes) { await daily(notes, 'laptop', true) },
  async 'daily-phone'(notes) { await daily(notes, 'phone', false) },
}

async function character(notes, kind) {
  const phone = kind === 'phone'
  const tag = phone ? 'phone' : 'desk'
  const ctx = await device(kind)
  await signIn(ctx, person(phone ? 'qchp' : 'qchd', 'Casey Char'))
  const p = await ctx.newPage(); watch(p, notes.errors)
  await p.goto('/?desktop=1&gate=off&autostart=1')
  await waitRoom(p)
  await p.waitForTimeout(1500)
  await shot(p, `char-${tag}-01-first-person`)
  notes.audit.push(...await layoutAudit(p, `${tag} room first person`))
  if (phone) await p.getByTestId('camera-toggle').tap(); else await p.keyboard.press('v')
  await p.waitForFunction(() => window.__ESCAPE_VIEW__?.playerView.blend === 1, null, { timeout: SLOW })
  await p.waitForTimeout(800)
  await shot(p, `char-${tag}-02-third-person`)
  // Walk forward in third person and see the walk animation.
  if (!phone) {
    await p.keyboard.down('KeyW'); await p.waitForTimeout(700); await shot(p, `char-${tag}-03-third-walking`); await p.keyboard.up('KeyW')
    await p.keyboard.down('KeyA'); await p.waitForTimeout(700); await shot(p, `char-${tag}-03b-third-strafe`); await p.keyboard.up('KeyA')
  } else {
    // Drag the joystick (left lower area).
    const vp = p.viewportSize()
    const cdp = await ctx.newCDPSession(p)
    const jb = await p.locator("[data-joystick]").boundingBox(); const x = jb.x + jb.width / 2, y = jb.y + jb.height / 2; void vp
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 10 }] })
    await p.waitForTimeout(800)
    await shot(p, `char-${tag}-03-third-walking`)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  // Back against a wall: camera should pull in.
  await p.evaluate(() => window.__ESCAPE__.requestTeleport([0, 1.6, 7.4], 0, 0))
  await p.waitForTimeout(1200)
  const d = await p.evaluate(() => window.__ESCAPE_VIEW__.playerView.cameraDistance)
  notes.info.push(`${tag}: camera distance with back to the wall = ${d}`)
  await shot(p, `char-${tag}-04-third-near-wall`)
  // Wardrobe
  await p.getByTestId('wardrobe-button').click()
  await waitOverlay(p, 'wardrobe')
  await p.waitForTimeout(1500)
  await shot(p, `char-${tag}-05-wardrobe`)
  notes.audit.push(...await layoutAudit(p, `${tag} wardrobe`))
  notes.info.push(`${tag} key balance: ` + (await p.getByTestId('key-balance').innerText()))
  const tabs = await p.locator('[data-testid^="wardrobe-tab-"]').evaluateAll((e) => e.map((x) => x.getAttribute('data-testid').slice(13)))
  notes.info.push(`${tag} wardrobe tabs: ${tabs.join(',')}`)
  for (const t of tabs) {
    await p.getByTestId(`wardrobe-tab-${t}`).click()
    await p.waitForTimeout(400)
    await shot(p, `char-${tag}-06-tab-${t}`)
  }
  await p.getByTestId('wardrobe-tab-extras').click()
  const head = p.getByTestId('item-acc-headphones')
  if (await head.count()) {
    await head.click()
    notes.info.push(`${tag} primary: ` + (await p.getByTestId('wardrobe-primary').innerText()))
    await p.getByTestId('wardrobe-primary').click()
    await waitOverlay(p, null).catch(() => notes.audit.push(`${tag}: wardrobe did not close after unlock`))
  }
  await p.waitForTimeout(1200)
  await shot(p, `char-${tag}-07-after-unlock`)
  const av = await p.evaluate(async () => (await fetch('/api/me/avatar')).json())
  notes.info.push(`${tag} avatar after unlock: ` + JSON.stringify(av).slice(0, 300))
  // Escape with unsaved change
  await p.getByTestId('wardrobe-button').click()
  await waitOverlay(p, 'wardrobe')
  await p.getByTestId('wardrobe-tab-hair').click().catch(() => {})
  const swatch = p.locator('[data-testid^="swatch-"]').nth(2)
  if (await swatch.count()) await swatch.click()
  await p.keyboard.press('Escape')
  await p.waitForTimeout(800)
  const ov = await p.evaluate(() => window.__ESCAPE__.store.getState().overlay?.kind ?? null)
  notes.info.push(`${tag}: Escape with unsaved wardrobe change -> overlay ${ov}`)
  await shot(p, `char-${tag}-08-escape-unsaved`)
  if (ov) { await p.getByTestId('wardrobe-close').click().catch(() => {}); await p.waitForTimeout(500) }
  // Interaction in third person: reach the door.
  await p.evaluate(() => window.__ESCAPE__.store.setState({ overlay: null }))
  const dx = 0, from = [0, 1.6, 5.5], target = [dx, 1.2, 7.95]
  await aimAt(p, from, target)
  await p.waitForTimeout(1500)
  const hov = await p.evaluate(() => window.__ESCAPE__.store.getState().hoveredId)
  notes.info.push(`${tag}: hovered in third person at the door: ${hov}`)
  await shot(p, `char-${tag}-09-third-reticle-door`)
  // Back to first person
  if (phone) await p.getByTestId('camera-toggle').tap(); else await p.keyboard.press('v')
  await p.waitForFunction(() => window.__ESCAPE_VIEW__?.playerView.blend === 0, null, { timeout: SLOW })
  await shot(p, `char-${tag}-10-first-again`)
  await ctx.close()
}

async function multiplayer(notes, phoneGuest) {
  const tag = phoneGuest ? 'mp-phone' : 'mp-desk'
  const A = person(phoneGuest ? 'qmpa' : 'qmda', 'Avery Host')
  const B = person(phoneGuest ? 'qmpb' : 'qmdb', 'Blake Guest')
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
  // Guest goes through the UI: the people panel lists the host to visit.
  await g.goto('/?desktop=1&autostart=1&gate=off'); await waitRoom(g)
  await g.waitForTimeout(1500)
  await shot(g, `${tag}-01-guest-own-room`)
  notes.audit.push(...await layoutAudit(g, `${tag} guest own room`))
  if (phoneGuest) await g.getByTestId('people-button').tap(); else await g.getByTestId('people-button').click()
  await g.getByTestId('people-panel').waitFor({ timeout: 15000 }).catch(() => notes.audit.push(`${tag}: people panel did not open`))
  await g.waitForTimeout(2000)
  await shot(g, `${tag}-02-guest-people-panel`)
  const hostRow = g.locator(`[data-testid="visit-friend"][data-handle="${A.handle}"]`)
  notes.info.push(`${tag}: host row online=${await hostRow.getAttribute('data-online').catch(() => 'missing')} text=${(await hostRow.innerText().catch(() => '')).replace(/\s+/g, ' ')}`)
  const t0 = Date.now()
  await hostRow.getByTestId('visit-friend-button').click()
  await g.waitForURL((u) => u.pathname === `/home/${A.handle}`, { timeout: SLOW })
  await waitRoom(g)
  notes.info.push(`${tag}: visit to room ready in ${Date.now() - t0} ms`)
  await g.waitForFunction((x) => window.__ESCAPE_NET__?.store.getState().home?.handle === x, A.handle, { timeout: SLOW })
  await g.evaluate(() => window.__ESCAPE__.requestTeleport([0, 1.6, 0], Math.PI, 0))
  await h.waitForTimeout(3000)
  await shot(h, `${tag}-03-host-sees-guest`)
  await shot(g, `${tag}-04-guest-sees-host`)
  notes.audit.push(...await layoutAudit(g, `${tag} guest visiting`))
  const toast = await h.locator('text=/in your room/i').count()
  notes.info.push(`${tag}: host "in your room" toast/text count ${toast}`)
  // Chat
  if (phoneGuest) await g.getByTestId('chat-button').tap(); else await g.keyboard.press('t')
  await g.getByTestId('chat-input').fill('Hello from the guest! ' + 'x'.repeat(10))
  await shot(g, `${tag}-05-guest-chat-typing`)
  await g.getByTestId('chat-input').press('Enter')
  await h.getByTestId('chat-log').waitFor({ timeout: SLOW }).catch(() => {})
  await h.waitForTimeout(1500)
  await shot(h, `${tag}-06-host-chat-received`)
  // Long message and spam
  const long = 'L'.repeat(600)
  await g.getByTestId('chat-input').fill(long)
  const len = (await g.getByTestId('chat-input').inputValue()).length
  notes.info.push(`${tag}: chat input accepted ${len} chars of 600`)
  await g.getByTestId('chat-input').press('Enter')
  for (let i = 0; i < 8; i++) { await g.getByTestId('chat-input').fill('spam ' + i); await g.getByTestId('chat-input').press('Enter') }
  await g.waitForTimeout(1500)
  await shot(g, `${tag}-07-guest-after-spam`)
  const hostLog = (await h.getByTestId('chat-log').innerText().catch(() => '')).split('\n').filter((l) => /spam/.test(l)).length
  notes.info.push(`${tag}: host received ${hostLog} of 8 spam lines; guest chat area: ${(await g.getByTestId('chat-area').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(-200)}`)
  // Host replies
  await h.keyboard.press('Escape').catch(() => {})
  await h.keyboard.press('t'); await h.getByTestId('chat-input').fill('Welcome!'); await h.getByTestId('chat-input').press('Enter'); await h.keyboard.press('Escape')
  if (phoneGuest) await g.getByLabel('Close chat').tap().catch(() => {}); else await g.keyboard.press('Escape')
  await g.waitForTimeout(1500)
  await shot(g, `${tag}-08-guest-sees-reply`)
  // Emotes
  for (const e of ['wave', 'cheer', 'dance']) {
    if (phoneGuest) { await g.getByTestId('emote-button').tap(); await g.waitForTimeout(300); await shot(g, `${tag}-09-emote-menu`); await g.getByTestId(`emote-${e}`).tap() }
    else await g.getByTestId(`emote-${e}`).click()
    await h.waitForTimeout(900)
    await shot(h, `${tag}-10-host-sees-${e}`)
  }
  // Host emote seen by guest
  await h.getByTestId(`emote-dance`).click().catch(() => {})
  await g.waitForTimeout(1000)
  await shot(g, `${tag}-11-guest-sees-host-dance`)
  // Guest third person in visit
  if (phoneGuest) await g.getByTestId('camera-toggle').tap().catch(() => {}); else await g.keyboard.press('v')
  await g.waitForTimeout(1500)
  await shot(g, `${tag}-12-guest-third-person`)
  // Read-only check: try to open record overlay.
  const ro = await g.evaluate(() => { const s = window.__ESCAPE__.store.getState(); return { visiting: s.visiting?.handle, record: !!document.querySelector('[data-testid="record-button"]') } })
  notes.info.push(`${tag}: guest read-only state ${JSON.stringify(ro)}`)
  // Host people panel
  await h.keyboard.press('f'); await h.waitForTimeout(800); await shot(h, `${tag}-13-host-people-panel`); await h.keyboard.press('Escape')
  // Guest closes tab abruptly -> host should see them leave.
  const tl = Date.now()
  await g.close()
  await h.waitForFunction(() => Object.keys(window.__ESCAPE_NET__.store.getState().players).length === 0, null, { timeout: 60000 }).then(() => notes.info.push(`${tag}: host saw guest leave after ${Date.now() - tl} ms`)).catch(() => notes.audit.push(`${tag}: host still shows guest 60 s after the guest closed the tab`))
  await shot(h, `${tag}-14-host-after-leave`)
  // Settings friends list
  const s = await hc.newPage(); watch(s, notes.errors)
  await s.goto('/settings'); await s.waitForTimeout(2500)
  await shot(s, `${tag}-15-settings-friends`, true)
  await hc.close(); await gc.close()
}

async function daily(notes, kind, signedIn) {
  const tag = kind === 'phone' ? 'daily-phone' : 'daily-desk'
  const ctx = await device(kind)
  if (signedIn) await signIn(ctx, person('qday', 'Dana Daily'))
  const p = await ctx.newPage(); watch(p, notes.errors)
  // Through the door in your own room when signed in.
  if (signedIn) {
    await p.goto('/?autostart=1')
    await waitRoom(p)
    await aimAt(p, [0, 1.6, 6], [0, 1.2, 7.95])
    await p.waitForTimeout(1500)
    const hov = await p.evaluate(() => window.__ESCAPE__.store.getState().hoveredId)
    await p.keyboard.press('e')
    await p.waitForTimeout(1500)
    await shot(p, `${tag}-00-door-overlay`)
    notes.info.push(`${tag}: hovered ${hov}, overlay ${await p.evaluate(() => window.__ESCAPE__.store.getState().overlay?.kind)}`)
    const play3d = p.getByRole('link', { name: /3D/i }).or(p.getByRole('button', { name: /3D/i })).first()
    if (await play3d.count()) { await play3d.click(); await p.waitForURL(/daily\/room/, { timeout: SLOW }) }
    else { notes.audit.push(`${tag}: no Play in 3D control in the door overlay`); await p.goto('/daily/room') }
  } else await p.goto('/daily/room')
  await p.getByTestId('daily-room-enter').waitFor({ timeout: SLOW })
  await shot(p, `${tag}-01-entry`)
  notes.audit.push(...await layoutAudit(p, `${tag} entry`))
  await p.getByTestId('daily-room-enter').click()
  await p.waitForFunction(() => !!window.__ESCAPE__?.store.getState().worldReady, null, { timeout: SLOW })
  await p.waitForTimeout(2500)
  await shot(p, `${tag}-02-inside`)
  notes.audit.push(...await layoutAudit(p, `${tag} inside`))
  const hook = await p.evaluate(() => ({ kind: window.__ESCAPE_DAILY__.kind, mode: window.__ESCAPE_DAILY__.mode, answer: window.__ESCAPE_DAILY__.answer() }))
  notes.info.push(`${tag}: puzzle kind ${hook.kind}/${hook.mode}`)
  // Look around: turn to each wall.
  for (const [i, yaw] of [[0, 0], [1, Math.PI / 2], [2, Math.PI], [3, -Math.PI / 2]]) {
    await p.evaluate((y) => window.__ESCAPE__.requestTeleport([0, 1.6, 1], y, -0.05), yaw)
    await p.waitForTimeout(900)
    await shot(p, `${tag}-03-look-${i}`)
  }
  // Interact with real aim + E on the lock (desktop)
  if (kind === 'laptop' && hook.kind !== 'search') {
    await aimAt(p, [1.0, 1.6, -1.6], [1.18, 1.3, -2.99])
    await p.waitForTimeout(1500)
    const hv = await p.evaluate(() => window.__ESCAPE__.store.getState().hoveredId)
    notes.info.push(`${tag}: hovered at lock: ${hv}`)
    await shot(p, `${tag}-04-aim-lock`)
    await p.keyboard.press('e')
    await p.waitForTimeout(1200)
    if (!(await p.getByTestId('daily-room-lock').isVisible().catch(() => false))) {
      notes.audit.push(`${tag}: pressing E while aiming at the lock (hovered=${hv}) did not open the lock panel`)
      await p.evaluate(() => window.__ESCAPE__.bus.emit('interact', { id: 'daily:lock', kind: 'gate' }))
    }
  }
  // A wrong answer first.
  if (hook.kind !== 'search') {
    if (!(await p.getByTestId('daily-room-lock').isVisible().catch(() => false))) await p.evaluate(() => window.__ESCAPE__.bus.emit('interact', { id: 'daily:lock', kind: 'gate' }))
    await p.getByTestId('daily-room-lock').waitFor({ timeout: SLOW })
    await shot(p, `${tag}-05-lock-panel`)
    notes.audit.push(...await layoutAudit(p, `${tag} lock panel`))
    if (hook.kind === 'sequence' && hook.mode === 'shape') {
      for (const id of [...hook.answer].reverse()) await p.getByTestId(`daily-choice-${id}`).click()
    } else if (hook.kind === 'sequence') {
      for (let i = 0; i < hook.answer.length; i++) await p.getByTestId(`daily-input-${i}`).fill('zz')
    } else await p.getByTestId('daily-input').fill(hook.answer.map(() => '0').join(''))
    await p.getByTestId('daily-submit').click().catch(() => {})
    await p.waitForTimeout(1200)
    await shot(p, `${tag}-06-wrong`)
    // Now right
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
  await shot(p, `${tag}-07-solved`)
  notes.audit.push(...await layoutAudit(p, `${tag} result`))
  notes.info.push(`${tag}: result text ` + (await p.getByTestId('daily-room-result-panel').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300))
  await p.getByTestId('daily-room-walk').click()
  await p.waitForTimeout(1500)
  await shot(p, `${tag}-08-door-open`)
  // Walk: from spawn, really walk with W (desktop) / joystick (phone) to the exit.
  await p.evaluate(() => window.__ESCAPE__.requestTeleport([0, 1.6, 0.5], 0, 0))
  const t0 = Date.now()
  if (kind === 'laptop') {
    await p.keyboard.down('KeyW')
    await p.waitForURL((u) => !u.pathname.startsWith('/daily'), { timeout: 60000 }).catch(() => notes.audit.push(`${tag}: walking north with W from the room centre for 60 s did not leave the room`))
    await p.keyboard.up('KeyW')
  } else {
    const vp = p.viewportSize(); const cdp = await ctx.newCDPSession(p)
    const jb = await p.locator("[data-joystick]").boundingBox(); const x = jb.x + jb.width / 2, y = jb.y + jb.height / 2; void vp
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 10 }] })
    await p.waitForURL((u) => !u.pathname.startsWith('/daily'), { timeout: 60000 }).catch(async () => { notes.audit.push(`${tag}: joystick walk for 60 s did not leave the room (pos ${JSON.stringify(await p.evaluate(() => window.__ESCAPE__?.runtime.player.position).catch(() => null))})`) })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {})
  }
  notes.info.push(`${tag}: left the room after ${Date.now() - t0} ms -> ${p.url()}`)
  await p.waitForTimeout(6000)
  await shot(p, `${tag}-09-arrived-home`)
  notes.info.push(`${tag}: welcome ${(await p.getByTestId('daily-welcome').innerText().catch(() => 'none')).replace(/\s+/g, ' ')}`)
  if (signedIn) {
    await p.goto('/daily'); await p.waitForTimeout(2500); await shot(p, `${tag}-10-daily-2d-after`, true)
    // Revisit the room after solving.
    await p.goto('/daily/room'); await p.waitForTimeout(3000); await shot(p, `${tag}-11-room-after-solved`)
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

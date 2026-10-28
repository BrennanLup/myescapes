/**
 * Phase 3, workstream A: the review form in a real browser.
 *
 *   Phone (/m): every question on one page, the room changed from the form with the directory
 *   search, photos picked while writing (resized in the browser) upload right after save, and
 *   more can be added from the room's page.
 *   Laptop (3D room): the confirm overlay finds the room in the directory, queues a photo, saves
 *   and uploads it; the review overlay adds another photo to the same visit.
 *
 * Runs once (in the `desktop` project), with its own phone and laptop contexts.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { SLOW, waitOverlay } from './helpers'
import { newDevice, person, signIn, waitRoom, watchErrors } from './support/morning'

/** A real PNG drawn in the page, so the browser-side resizer has something to decode. */
// The phone and laptop contexts come from the worker's shared browser, so close them even when a
// step fails: a 3D room left open keeps rendering (software WebGL) and starves the next spec.
const opened: BrowserContext[] = []
test.afterEach(async () => {
  for (const c of opened.splice(0)) await c.close().catch(() => {})
})

async function pngFile(page: Page, name: string, color: string) {
  const b64 = await page.evaluate((c) => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 480
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = c
    ctx.fillRect(0, 0, 640, 480)
    ctx.fillStyle = '#fff'
    ctx.fillRect(100, 100, 200, 120)
    return canvas.toDataURL('image/png').split(',')[1]
  }, color)
  return { name, mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') }
}

async function fillScores(page: Page) {
  for (const k of ['overall', 'puzzles', 'setting', 'storyline', 'difficulty']) {
    const input = page.getByTestId(`confirm-score-${k}`)
    if ((await input.inputValue()) === '') await input.fill('78')
  }
  const date = page.getByTestId('confirm-date')
  if ((await date.inputValue()) === '') await date.fill('2026-10-18')
}

test('review form: room search, photos while reviewing, on the phone and in the 3D room', async ({ browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one run is enough: the test opens its own phone and laptop')
  test.setTimeout(12 * 60_000)
  const run = Date.now().toString(36).slice(-5)
  const me = person('revform', 'Review Former', run)
  const errors: string[] = []

  const phone = await newDevice(browser, baseURL!, 'phone')
  opened.push(phone)
  await signIn(phone, me, { onboarded: true })
  const pp = await phone.newPage()
  watchErrors(pp, errors)

  await test.step('phone: draft a review by typing', async () => {
    await pp.goto('/m/log')
    await pp.getByTestId('record-type-instead').click()
    // The e2e directory is the demo seed (seed/reviews.json venues and games).
    await pp.getByTestId('transcript-input').fill('We played Subject Zero by The Puzzle Foundry in Toronto. We escaped in 50 minutes. Overall 82, puzzles 85.')
    await pp.getByTestId('transcript-submit').click()
    await pp.locator('[data-testid^="match-game-"]', { hasText: 'Best match' }).filter({ hasText: 'Subject Zero' }).click()
    await expect(pp.getByTestId('confirm-game')).toHaveText('Subject Zero')
  })

  await test.step('phone: every question is on the one page', async () => {
    const form = pp.getByTestId('log-confirm')
    for (const h of ['Scores', 'Puzzles', 'Features', 'Photos', 'Who played', 'Who can see your review']) await expect(form.getByRole('heading', { name: h, exact: true })).toBeAttached()
    // Focusing a field low on the page doesn't hide the others: they stay in the DOM and in flow.
    await pp.getByTestId('confirm-comment-difficulty').focus()
    await expect(pp.getByTestId('confirm-date')).toBeVisible()
    await expect(pp.getByTestId('confirm-score-overall')).toBeVisible()
  })

  await test.step('phone: an unset score shows an empty track until it is tapped', async () => {
    // The transcript gave no setting score: no thumb, a "Tap to rate" hint, the box empty.
    await expect(pp.getByTestId('confirm-score-setting-slider-hint')).toHaveText('Tap to rate')
    await expect(pp.getByTestId('confirm-score-setting')).toHaveValue('')
    await pp.getByTestId('confirm-score-setting-slider').click()
    await expect(pp.getByTestId('confirm-score-setting-slider-hint')).toHaveCount(0)
    await expect(pp.getByTestId('confirm-score-setting')).not.toHaveValue('')
    // Scores the transcript did give show as normal sliders.
    await expect(pp.getByTestId('confirm-score-overall-slider-hint')).toHaveCount(0)
  })

  await test.step('phone: a keyboard that shrinks the page itself never puts the Save bar over the field', async () => {
    const field = pp.getByTestId('confirm-comment-difficulty')
    await field.focus()
    // Firefox for Android (or interactive-widget=resizes-content): the layout viewport shrinks.
    await pp.setViewportSize({ width: 390, height: 480 })
    await expect(pp.getByTestId('log-confirm')).toHaveAttribute('data-keyboard', 'open')
    await expect
      .poll(async () => {
        const box = await field.boundingBox()
        return box ? box.y >= 0 && box.y + box.height <= 480 : false
      })
      .toBe(true)
    await pp.setViewportSize({ width: 390, height: 844 })
    await expect(pp.getByTestId('log-confirm')).toHaveAttribute('data-keyboard', 'closed')
  })

  await test.step('phone: change the room with the directory search', async () => {
    await pp.getByTestId('confirm-change-game').click()
    await pp.getByTestId('confirm-room-search').fill('Golden Gate')
    await pp.getByTestId('roompicker-option-game').filter({ hasText: 'Golden Gate Vault Job' }).first().click()
    await expect(pp.getByTestId('confirm-game')).toHaveText('Golden Gate Vault Job')
  })

  await test.step('phone: add photos while writing, then save', async () => {
    await pp.getByTestId('photo-input').setInputFiles([await pngFile(pp, 'one.png', '#e07b39'), await pngFile(pp, 'two.png', '#2f8f8a')])
    await expect(pp.getByTestId('photo-status')).toHaveText(/2 photos will upload when you save/, { timeout: 30_000 })
    await expect(pp.getByTestId('confirm-photos').getByTestId('photo-tile')).toHaveCount(2)
    // A file that isn't a photo is skipped, and the status line says so.
    await pp.getByTestId('photo-input').setInputFiles([{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') }])
    await expect(pp.getByTestId('photo-status')).toContainText("notes.txt isn't a photo, so it was skipped.")
    await expect(pp.getByTestId('photo-status')).toContainText('2 photos will upload when you save')
    // Remove one before saving.
    await pp.getByTestId('confirm-photos').getByRole('button', { name: 'Remove photo 2' }).click()
    await expect(pp.getByTestId('confirm-photos').getByTestId('photo-tile')).toHaveCount(1)
    await fillScores(pp)
    await pp.getByTestId('confirm-save').click()
    await expect(pp.getByTestId('log-done')).toBeVisible({ timeout: SLOW })
    await expect(pp.getByTestId('log-done-photos')).toContainText('1 photo added', { timeout: SLOW })
  })

  let visitId = ''
  await test.step("phone: the room's page lists the photo and takes more", async () => {
    await pp.getByTestId('log-done-home').click()
    await expect(pp).toHaveURL(/\/m\/rooms\/vis_/)
    visitId = decodeURIComponent(new URL(pp.url()).pathname.split('/').pop()!)
    const attach = pp.getByTestId('review-photo-attach')
    await expect(attach.getByTestId('photo-tile')).toHaveCount(1, { timeout: SLOW })
    await expect(attach.getByRole('button', { name: 'Remove photo 1' })).toBeVisible()
    // The uploaded photo is served back (same-origin, participants only).
    const detail = await (await pp.request.get(`/api/visits/${encodeURIComponent(visitId)}`)).json()
    expect(detail.photos).toHaveLength(1)
    const img = await pp.request.get(detail.photos[0].url)
    expect(img.status()).toBe(200)
    expect(img.headers()['content-type']).toBe('image/jpeg')
  })

  const laptop = await newDevice(browser, baseURL!, 'laptop')
  opened.push(laptop)
  await signIn(laptop, me, { onboarded: true })
  const lp = await laptop.newPage()
  watchErrors(lp, errors)

  await test.step('laptop: the review overlay adds a photo to the same visit', async () => {
    await lp.goto('/?gate=off')
    await waitRoom(lp)
    const roomId = await lp.evaluate((v) => window.__ESCAPE__!.store.getState().reviews.find((r) => r.id === v)?.roomId ?? null, visitId)
    expect(roomId).toBeTruthy()
    await lp.evaluate((id) => window.__ESCAPE__!.bus.emit('review:open', { roomId: id! }), roomId)
    await waitOverlay(lp, 'review')
    const attach = lp.getByTestId('review-photo-attach')
    await expect(attach.getByTestId('photo-tile')).toHaveCount(1, { timeout: SLOW })
    await attach.getByTestId('photo-input').setInputFiles([await pngFile(lp, 'three.png', '#6d3b5c')])
    await expect(attach.getByTestId('photo-status')).toHaveText('1 photo added.', { timeout: SLOW })
    await lp.waitForFunction((v) => (window.__ESCAPE__!.store.getState().reviews.find((r) => r.id === v)?.photos.length ?? 0) === 2, visitId, { timeout: SLOW })
    // Removing an uploaded photo can be undone: nothing is deleted on the server.
    await attach.getByRole('button', { name: 'Remove photo 2' }).click()
    await expect(attach.getByTestId('photo-undo')).toContainText('Photo removed')
    await expect(attach.getByTestId('photo-tile')).toHaveCount(1)
    await attach.getByTestId('photo-undo-button').click()
    await expect(attach.getByTestId('photo-tile')).toHaveCount(2)
    const detail = await (await lp.request.get(`/api/visits/${encodeURIComponent(visitId)}`)).json()
    expect(detail.photos).toHaveLength(2)
    await lp.keyboard.press('Escape')
    await waitOverlay(lp, null)
  })

  await test.step('laptop: the confirm overlay finds the room in the directory and uploads a queued photo', async () => {
    await lp.evaluate(() => {
      const r = { score: 75, comment: '' }
      window.__ESCAPE__!.store.setState({
        overlay: {
          kind: 'confirm',
          draft: {
            room: { name: 'The Last Lighthouse Keeper', company: 'Fog City', city: 'San Francisco', genre: null, address: null, website: null },
            review: {
              date: '2026-10-20', crew: [], ratings: { overall: r, puzzles: r, setting: r, storyline: r, difficulty: r }, puzzles: [],
              escaped: true, escapeTimeMinutes: 55, visibleTimer: true, multiRoom: false, flashlights: false, liveActors: false, toolsUsed: [], voiceTranscript: '',
            },
            flags: ['room.company'],
            mode: 'mock',
          },
        },
      } as never)
    })
    await expect(lp.getByTestId('confirm-overlay')).toBeVisible()
    // Genre is optional, as on the phone; an unset score would show "Tap to rate" (all are set here).
    await expect(lp.getByTestId('field-room.genre')).toHaveValue('')
    await expect(lp.getByTestId('error-room.genre')).toHaveCount(0)
    await expect(lp.getByTestId('field-review.ratings.overall.score-slider-hint')).toHaveCount(0)
    await lp.getByTestId('room-search-suggestion').click()
    await expect(lp.getByTestId('confirm-room-linked')).toContainText('The Last Lighthouse Keeper')
    await expect(lp.getByTestId('field-room.company')).toHaveValue('Fog City Escapes')
    await lp.getByTestId('photo-input').setInputFiles([await pngFile(lp, 'four.png', '#e8b93a')])
    await expect(lp.getByTestId('confirm-photos').getByTestId('photo-status')).toHaveText(/1 photo will upload when you save/, { timeout: 30_000 })
    await lp.getByTestId('confirm-save').click()
    await waitOverlay(lp, null)
    const visits = await lp.evaluate(() => {
      const s = window.__ESCAPE__!.store.getState()
      const room = s.rooms.find((x) => x.name === 'The Last Lighthouse Keeper')
      return s.reviews.filter((x) => x.roomId === room?.id).map((x) => x.id)
    })
    expect(visits).toHaveLength(1)
    await lp.waitForFunction((v) => (window.__ESCAPE__!.store.getState().reviews.find((r) => r.id === v)?.photos.length ?? 0) === 1, visits[0], { timeout: SLOW })
  })

  expect(errors).toEqual([])
})

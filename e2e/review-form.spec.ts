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
import { expect, test, type Page } from '@playwright/test'
import { SLOW, waitOverlay } from './helpers'
import { newDevice, person, signIn, waitRoom, watchErrors } from './support/morning'

/** A real PNG drawn in the page, so the browser-side resizer has something to decode. */
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
  await signIn(phone, me, { onboarded: true })
  const pp = await phone.newPage()
  watchErrors(pp, errors)

  await test.step('phone: draft a review by typing', async () => {
    await pp.goto('/m/log')
    await pp.getByTestId('record-type-instead').click()
    await pp.getByTestId('transcript-input').fill('We played The Lost Observatory by Starlight Escapes in San Francisco. We escaped in 50 minutes. Overall 82, puzzles 85.')
    await pp.getByTestId('transcript-submit').click()
    await pp.locator('[data-testid^="match-game-"]', { hasText: 'Best match' }).first().click()
    await expect(pp.getByTestId('confirm-game')).toHaveText('The Lost Observatory')
  })

  await test.step('phone: every question is on the one page', async () => {
    const form = pp.getByTestId('log-confirm')
    for (const h of ['Scores', 'Puzzles', 'Features', 'Photos', 'Who played', 'Who can see your review']) await expect(form.getByRole('heading', { name: h, exact: true })).toBeAttached()
    // Focusing a field low on the page doesn't hide the others: they stay in the DOM and in flow.
    await pp.getByTestId('confirm-comment-difficulty').focus()
    await expect(pp.getByTestId('confirm-date')).toBeVisible()
    await expect(pp.getByTestId('confirm-score-overall')).toBeVisible()
  })

  await test.step('phone: change the room with the directory search', async () => {
    await pp.getByTestId('confirm-change-game').click()
    await pp.getByTestId('confirm-room-search').fill('Subject Zero')
    await pp.getByTestId('roompicker-option-game').filter({ hasText: 'Subject Zero' }).first().click()
    await expect(pp.getByTestId('confirm-game')).toHaveText('Subject Zero')
  })

  await test.step('phone: add photos while writing, then save', async () => {
    await pp.getByTestId('photo-input').setInputFiles([await pngFile(pp, 'one.png', '#e07b39'), await pngFile(pp, 'two.png', '#2f8f8a')])
    await expect(pp.getByTestId('photo-status')).toHaveText(/2 photos will upload when you save/, { timeout: 30_000 })
    await expect(pp.getByTestId('confirm-photos').getByTestId('photo-tile')).toHaveCount(2)
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
    const src = await attach.locator('img').first().getAttribute('src')
    expect((await pp.request.get(src!)).headers()['content-type']).toBe('image/jpeg')
  })

  const laptop = await newDevice(browser, baseURL!, 'laptop')
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
            room: { name: 'The Lost Observatory', company: 'Starlight', city: 'San Francisco', genre: null, address: null, website: null },
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
    await lp.getByTestId('room-search-suggestion').click()
    await expect(lp.getByTestId('confirm-room-linked')).toContainText('The Lost Observatory')
    await expect(lp.getByTestId('field-room.company')).toHaveValue('Starlight Escapes')
    await lp.getByTestId('photo-input').setInputFiles([await pngFile(lp, 'four.png', '#e8b93a')])
    await expect(lp.getByTestId('confirm-photos').getByTestId('photo-status')).toHaveText(/1 photo will upload when you save/, { timeout: 30_000 })
    await lp.getByTestId('confirm-save').click()
    await waitOverlay(lp, null)
    const visits = await lp.evaluate(() => {
      const s = window.__ESCAPE__!.store.getState()
      const room = s.rooms.find((x) => x.name === 'The Lost Observatory')
      return s.reviews.filter((x) => x.roomId === room?.id).map((x) => x.id)
    })
    expect(visits).toHaveLength(1)
    await lp.waitForFunction((v) => (window.__ESCAPE__!.store.getState().reviews.find((r) => r.id === v)?.photos.length ?? 0) === 1, visits[0], { timeout: SLOW })
  })

  expect(errors).toEqual([])
})

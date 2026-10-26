import { expect, test } from '@playwright/test'
import { SLOW, aimAt, roomUrl, fillMissingConfirmFields, playerPosition, storeState, waitHover, waitOverlay } from './helpers'
import { watchErrors } from './support/morning'

// Board geometry (see src/world/board/index.tsx): sort tabs sit along the top of the cork.
const BOARD = { x: 0, y: 2.05, faceZ: -7.98 + 0.072 }
const TAB = { y: BOARD.y + (3 - 0.28) / 2 - 0.13, first: -(6 * 0.62 + 5 * 0.07) / 2 + 0.31, step: 0.69 }
const SORT_ORDER = ['city', 'brand', 'genre', 'date', 'rating', 'escapeTime'] as const

test.describe('full loop', () => {
  test.skip(({ isMobile }) => isMobile, 'keyboard-driven loop; mobile has its own spec')

  test('enter -> walk -> review -> sort -> record -> confirm -> pin -> wish list -> wrap', async ({ page, request }) => {
    // Page errors, console errors and failed API calls (the signed-out session probe's 401 is expected).
    const errors: string[] = []
    watchErrors(page, errors)

    // 1. Loading screen, then straight into the room (Escape of the Day never blocks entry).
    await page.goto(roomUrl(), { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('loading-screen')).toBeAttached({ timeout: SLOW })
    await page.waitForFunction(() => window.__ESCAPE__?.store.getState().worldReady === true, null, { timeout: SLOW })
    await expect(page.getByTestId('loading-screen')).toHaveCount(0, { timeout: SLOW })
    expect(await storeState<unknown>(page, 'overlay')).toBeNull()
    await expect(page.getByTestId('hud')).toBeVisible()
    await page.waitForFunction(() => window.__ESCAPE__!.store.getState().boardPins.length > 0, null, { timeout: SLOW })

    // 2. Walk forward with W.
    const start = await playerPosition(page)
    await page.keyboard.down('KeyW')
    await page.waitForFunction((z0) => window.__ESCAPE__!.runtime.player.position[2] < z0 - 0.5, start[2], { timeout: SLOW })
    await page.keyboard.up('KeyW')

    // 3. Look at a photo on the board and press E: the review opens.
    const pin = (await storeState<{ roomId: string; target: [number, number, number] }[]>(page, 'boardPins'))[0]
    await aimAt(page, [pin.target[0], 1.6, -4], [pin.target[0], pin.target[1] - 0.25, pin.target[2]])
    await waitHover(page, 'photo:' + pin.roomId)
    await page.keyboard.press('KeyE')
    await waitOverlay(page, 'review')
    await expect(page.getByTestId('review-overlay')).toBeVisible()
    expect(await storeState<string>(page, 'overlay.roomId')).toBe(pin.roomId)
    await page.keyboard.press('Escape')
    await waitOverlay(page, null)

    // 4a. Sort from the HUD chips: pins regroup by genre (strings re-tie to the new order).
    await page.getByTestId('sort-genre').click()
    await page.waitForFunction(
      () => {
        const s = window.__ESCAPE__!.store.getState()
        const genreOf = new Map(s.rooms.map((r) => [r.id, r.genre.toLowerCase().replace(/[^a-z]/g, '')]))
        return s.sort === 'genre' && s.boardPins.length === s.rooms.length && s.boardPins.every((p) => p.group.toLowerCase().replace(/[^a-z]/g, '') === genreOf.get(p.roomId))
      },
      null,
      { timeout: SLOW },
    )
    const genreOrder = (await storeState<{ roomId: string; order: number }[]>(page, 'boardPins')).sort((a, b) => a.order - b.order).map((p) => p.roomId)

    // 4b. Sort from the in-world tab ("Date") by looking at it and pressing E.
    const i = SORT_ORDER.indexOf('date')
    const tabX = TAB.first + i * TAB.step
    await aimAt(page, [tabX, 1.6, -4.5], [tabX, TAB.y, BOARD.faceZ])
    await waitHover(page, 'sort:date')
    await page.keyboard.press('KeyE')
    await page.waitForFunction(() => window.__ESCAPE__!.store.getState().sort === 'date', null, { timeout: SLOW })
    await page.waitForFunction(
      (before) => {
        const pins = window.__ESCAPE__!.store.getState().boardPins
        const now = [...pins].sort((a, b) => a.order - b.order).map((p) => p.roomId)
        return pins.every((p) => /^\d{4}$|undated/i.test(p.group)) && now.join() !== before.join()
      },
      genreOrder,
      { timeout: SLOW },
    )
    await expect(page.getByTestId('sort-date')).toHaveAttribute('aria-pressed', 'true')

    // 5. Desk terminal: look at the desk and press E to open the recorder.
    await aimAt(page, [-7.6, 1.6, -3], [-9.4, 0.95, -3])
    await waitHover(page, 'desk:terminal')
    await page.keyboard.press('KeyE')
    await waitOverlay(page, 'record')
    await page.getByTestId('sample-transcript').click()
    await expect(page.getByTestId('transcript-input')).not.toHaveValue('')
    await page.getByTestId('extract-submit').click()

    // 6. Confirm screen (mock extractor): fill what it left empty, rename, save.
    await waitOverlay(page, 'confirm')
    await expect(page.getByTestId('confirm-mode')).toContainText(/mock/i)
    await fillMissingConfirmFields(page)
    const name = `E2E Vault ${Date.now()}`
    await page.getByTestId('field-room.name').fill(name)
    await expect(page.getByTestId('confirm-save')).toBeEnabled()
    const roomsBefore = (await storeState<unknown[]>(page, 'rooms')).length
    await page.getByTestId('confirm-save').click()
    await waitOverlay(page, null)

    // 7. The new polaroid gets a slot on the board and lands there.
    const newId = await storeState<string>(page, 'lastAddedRoomId')
    expect(newId).toBeTruthy()
    expect((await storeState<unknown[]>(page, 'rooms')).length).toBe(roomsBefore + 1)
    await page.waitForFunction((id) => window.__ESCAPE__!.store.getState().boardPins.some((p) => p.roomId === id), newId, { timeout: SLOW })
    await page.waitForFunction(
      (id) => {
        const pin = window.__ESCAPE__!.store.getState().boardPins.find((p) => p.roomId === id)
        const live = window.__ESCAPE__!.runtime.pinPositions.get(id)
        return !!pin && !!live && Math.hypot(live[0] - pin.target[0], live[1] - pin.target[1], live[2] - pin.target[2]) < 0.02
      },
      newId,
      { timeout: SLOW },
    )
    const data = await (await request.get('/api/data')).json()
    expect(data.rooms.some((r: { name: string }) => r.name === name)).toBe(true)

    // 8. Wish list from the in-world chalkboard: add an item.
    await aimAt(page, [6.5, 1.6, -3], [10, 1.9, -3])
    await waitHover(page, 'wishlist:board')
    await page.keyboard.press('KeyE')
    await waitOverlay(page, 'wishlist')
    // The add form starts open on wide screens and behind a button on narrow ones.
    if (await page.getByTestId('wishlist-add-open').isVisible()) await page.getByTestId('wishlist-add-open').click()
    const wish = `E2E Wish ${Date.now()}`
    await page.getByTestId('wishlist-add-name').fill(wish)
    await page.getByTestId('wishlist-add-submit').click()
    await page.waitForFunction((n) => window.__ESCAPE__!.store.getState().wishlist.some((w) => w.name === n), wish, { timeout: SLOW })
    await page.keyboard.press('Escape')
    await waitOverlay(page, null)
    // ...and from the HUD.
    await page.getByTestId('wishlist-button').click()
    await waitOverlay(page, 'wishlist')
    await page.keyboard.press('Escape')
    await waitOverlay(page, null)

    // 9. Year wrap from the trophy shelf, then from the HUD.
    await aimAt(page, [-7, 1.6, 3.5], [-10, 1.2, 3.5])
    await waitHover(page, 'wrap:trophy')
    await page.keyboard.press('KeyE')
    await waitOverlay(page, 'wrap')
    await expect(page.getByTestId('wrap-counter')).toContainText(/^1 \//)
    await page.getByTestId('wrap-next').click()
    await expect(page.getByTestId('wrap-counter')).toContainText(/^2 \//)
    await page.getByTestId('wrap-close').click()
    await waitOverlay(page, null)
    await page.getByTestId('wrap-button').click()
    await waitOverlay(page, 'wrap')
    await page.getByTestId('wrap-close').click()
    await waitOverlay(page, null)

    expect(errors).toEqual([])
  })
})

import { expect, test, type Page } from '@playwright/test'
import { SLOW, aimAt, openApp, playerPosition, storeState, waitHover, waitOverlay } from './helpers'

/** Drive the virtual joystick with touch pointer events (dy < 0 pushes forward). */
async function joystick(page: Page, phase: 'down' | 'move' | 'up', dx = 0, dy = 0) {
  await page.evaluate(
    ({ phase, dx, dy }) => {
      const el = document.querySelector<HTMLElement>('[data-joystick]')!
      const r = el.getBoundingClientRect()
      const init: PointerEventInit = {
        pointerId: 7,
        pointerType: 'touch',
        isPrimary: true,
        bubbles: true,
        cancelable: true,
        clientX: r.left + r.width / 2 + dx,
        clientY: r.top + r.height / 2 + dy,
      }
      el.dispatchEvent(new PointerEvent(phase === 'down' ? 'pointerdown' : phase === 'move' ? 'pointermove' : 'pointerup', init))
    },
    { phase, dx, dy },
  )
}

test.describe('mobile', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch layout only')

  test('HUD buttons sit above the touch controls and open their overlays', async ({ page }) => {
    await openApp(page)
    expect(await storeState<boolean>(page, 'isTouch')).toBe(true)
    await expect(page.locator('[data-joystick]')).toBeVisible()

    // Every HUD button must be the top-most element at its own centre (not covered by the look surface).
    for (const id of ['wishlist-button', 'wrap-button', 'record-button', 'settings-button', 'help-button', 'sort-button', 'volume-toggle']) {
      const btn = page.getByTestId(id).first()
      await expect(btn).toBeVisible()
      const box = (await btn.boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(40)
      expect(box.x + box.width).toBeLessThanOrEqual(390)
      const onTop = await btn.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return !!hit && (hit === el || el.contains(hit))
      })
      expect(onTop, `${id} is reachable`).toBe(true)
    }

    // Sort menu.
    await page.getByTestId('sort-button').click()
    await page.getByTestId('sort-rating').click()
    await page.waitForFunction(() => window.__ESCAPE__!.store.getState().sort === 'rating')

    // Overlays open over the HUD and close again.
    for (const [btn, kind] of [
      ['wishlist-button', 'wishlist'],
      ['wrap-button', 'wrap'],
      ['record-button', 'record'],
      ['settings-button', 'settings'],
    ] as const) {
      await page.getByTestId(btn).click()
      await waitOverlay(page, kind)
      await expect(page.getByTestId('hud')).toHaveCount(0)
      await expect(page.locator('[data-joystick]')).toHaveCount(0)
      await page.keyboard.press('Escape')
      await waitOverlay(page, null)
    }
  })

  test('the joystick walks forward and tap-to-interact opens a review', async ({ page }) => {
    await openApp(page)
    const start = await playerPosition(page)
    await joystick(page, 'down', 0, 0)
    await joystick(page, 'move', 0, -60)
    await page.waitForFunction((z0) => window.__ESCAPE__!.runtime.player.position[2] < z0 - 0.5, start[2], { timeout: SLOW })
    await joystick(page, 'up', 0, -60)
    await page.waitForFunction(() => window.__ESCAPE__!.runtime.joystick.y === 0)
    const after = await playerPosition(page)
    expect(after[2]).toBeLessThan(start[2])
    expect(Math.abs(after[0] - start[0])).toBeLessThan(0.3)

    // Aim at a photo; the big Tap button appears and opens the review.
    const pin = (await storeState<{ roomId: string; target: [number, number, number] }[]>(page, 'boardPins'))[0]
    await aimAt(page, [pin.target[0], 1.6, -4.5], [pin.target[0], pin.target[1] - 0.25, pin.target[2]])
    await waitHover(page, 'photo:' + pin.roomId)
    await page.getByTestId('interact-tap').click()
    await waitOverlay(page, 'review')
    await expect(page.getByTestId('review-overlay')).toBeVisible()
    await page.getByRole('button', { name: 'Close review' }).click()
    await waitOverlay(page, null)
  })
})

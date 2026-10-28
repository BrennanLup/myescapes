/**
 * Escape of the Day as a 3D puzzle room (/daily/room): enter, open the lock from its prop, solve
 * today's puzzle, walk out of the open door into your own room (or the demo room when signed out),
 * and see the welcome toast. The signed-in run checks the result was saved (streak 1 on /daily).
 */
import { expect, test, type Page } from '@playwright/test'
import { SLOW } from './helpers'
import { person, signIn, watchErrors } from './support/morning'

async function enterRoom(page: Page) {
  await page.goto('/daily/room')
  await page.getByTestId('daily-room-enter').click({ timeout: SLOW })
  await page.waitForFunction(() => !!window.__ESCAPE__?.store.getState().worldReady, null, { timeout: SLOW })
}

/** Solve today's puzzle through the room: the lock panel for codes and tiles, hiding spots for a search. */
async function solveInRoom(page: Page) {
  const hook = await page.evaluate(() => ({ kind: window.__ESCAPE_DAILY__!.kind, mode: window.__ESCAPE_DAILY__!.mode, answer: window.__ESCAPE_DAILY__!.answer() }))
  if (hook.kind === 'search') {
    const spots = await page.evaluate(() => Object.keys(window.__ESCAPE_DAILY_ROOM__!.spots()))
    for (const s of spots) await page.evaluate((id) => window.__ESCAPE__!.bus.emit('interact', { id: `daily:spot:${id}`, kind: 'prop' }), s)
  } else {
    await page.evaluate(() => window.__ESCAPE__!.bus.emit('interact', { id: 'daily:lock', kind: 'gate' }))
    await expect(page.getByTestId('daily-room-lock')).toBeVisible()
    if (hook.kind === 'sequence' && hook.mode === 'shape') {
      for (const id of hook.answer) await page.getByTestId(`daily-choice-${id}`).click()
    } else if (hook.kind === 'sequence') {
      for (let i = 0; i < hook.answer.length; i++) await page.getByTestId(`daily-input-${i}`).fill(hook.answer[i])
    } else {
      await page.getByTestId('daily-input').fill(hook.answer.join(''))
    }
    await page.getByTestId('daily-submit').click()
  }
  await expect(page.getByTestId('daily-room')).toHaveAttribute('data-status', 'solved', { timeout: SLOW })
  await expect(page.getByTestId('daily-room-result-panel')).toBeVisible({ timeout: SLOW })
}

/** Close the result and walk (teleport) down the corridor past the exit line. */
async function walkOut(page: Page) {
  await page.getByTestId('daily-room-walk').click()
  await page.evaluate(() => window.__ESCAPE__!.requestTeleport([0, 1.6, -3.9], 0, 0))
  await page.keyboard.down('KeyW')
  // Phones honour the usual rule for `/`: their home is the phone app (/m).
  await page.waitForURL(/\/(\?(demo=1&)?autostart=1|m)$/, { timeout: SLOW * 2 })
  await page.keyboard.up('KeyW')
}

test.describe('Escape of the Day in 3D', () => {
  test('signed out: solve in the room, walk out into the demo room with a sign-in prompt', async ({ page, isMobile }) => {
    const errors: string[] = []
    watchErrors(page, errors)
    await enterRoom(page)
    await expect(page.getByTestId('daily-timer')).toBeVisible()
    if (isMobile) await expect(page.locator('[data-look-surface]').first()).toBeAttached()
    // Clues from a prop, and a hint from the bell.
    await page.evaluate(() => window.__ESCAPE__!.bus.emit('interact', { id: 'daily:plaque', kind: 'prop' }))
    await expect(page.getByTestId('daily-room-clues')).toBeVisible()
    await page.getByTestId('daily-room-close').click()
    await page.evaluate(() => window.__ESCAPE__!.bus.emit('interact', { id: 'daily:hint', kind: 'prop' }))
    await page.getByTestId('daily-hint').click()
    await expect(page.getByTestId('daily-hints')).toBeVisible()
    await page.getByTestId('daily-room-close').click()

    await solveInRoom(page)
    await expect(page.getByTestId('daily-share-text')).toContainText(/Escape #\d+ 🔓 1\/6/)
    await walkOut(page)
    if (isMobile) {
      expect(new URL(page.url()).pathname).toBe('/m')
      // Signed out on a phone, home is the phone app's sign-in screen.
      await expect(page.getByTestId('mobile-signin')).toBeVisible({ timeout: SLOW })
      expect(errors).toEqual([])
      return
    }
    await expect(page.getByTestId('daily-welcome')).toBeVisible({ timeout: SLOW })
    await expect(page.getByTestId('daily-welcome-signin')).toBeVisible()
    // You arrive just inside your room's daily door, facing the board.
    const z = await page.evaluate(() => window.__ESCAPE__!.runtime.player.position[2])
    expect(z).toBeGreaterThan(5)
    expect(errors).toEqual([])
  })

  test('signed in: the result is saved (streak) and the door leads home', async ({ browser, baseURL, isMobile }) => {
    test.skip(isMobile, 'one signed-in run is enough; the phone path is covered signed out')
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL })
    const page = await ctx.newPage()
    const errors: string[] = []
    watchErrors(page, errors)
    await signIn(ctx, person('room', 'Room Runner', String(Date.now()).slice(-8)), { onboarded: true })
    // The 2D page offers the 3D room.
    await page.goto('/daily')
    await page.getByTestId('daily-play-3d').click()
    await page.getByTestId('daily-room-enter').click({ timeout: SLOW })
    await page.waitForFunction(() => !!window.__ESCAPE__?.store.getState().worldReady, null, { timeout: SLOW })
    await solveInRoom(page)
    await expect(page.getByTestId('daily-streak').locator('dd').first()).toHaveText('1', { timeout: SLOW })
    await walkOut(page)
    expect(page.url()).not.toContain('demo=1')
    await expect(page.getByTestId('daily-welcome-line')).toContainText(/You escaped #\d+ in 1\/6/, { timeout: SLOW })
    expect(errors).toEqual([])
    await ctx.close()
  })
})

import { expect, test } from '@playwright/test'
import { SLOW, roomUrl, solveDaily, storeState, waitOverlay } from './helpers'

// The Phase 1 gate is now Escape of the Day: optional, behind the south-wall door, never blocking.
test('the room opens straight away; the door opens Escape of the Day, which can be closed or solved', async ({ page }) => {
  await page.goto(roomUrl())
  await page.waitForFunction(
    () => {
      const s = window.__ESCAPE__?.store.getState()
      return !!s && s.worldReady && s.dataStatus === 'ready'
    },
    null,
    { timeout: SLOW },
  )
  // Nothing opens on its own.
  for (let i = 0; i < 6; i++) {
    expect(await storeState<unknown>(page, 'overlay')).toBeNull()
    await page.waitForTimeout(400)
  }
  await expect(page.getByTestId('hud')).toBeVisible()

  // The door (gate:open) shows today's puzzle; Esc closes it before playing.
  await page.evaluate(() => window.__ESCAPE__!.bus.emit('gate:open'))
  await waitOverlay(page, 'gate')
  await expect(page.getByTestId('daily-overlay')).toBeVisible()
  await expect(page.getByTestId('daily-start')).toBeVisible({ timeout: SLOW })
  await page.keyboard.press('Escape')
  await waitOverlay(page, null)

  // Solve it: the share grid shows and the door is marked solved for today.
  await page.evaluate(() => window.__ESCAPE__!.bus.emit('gate:open'))
  await waitOverlay(page, 'gate')
  await solveDaily(page)
  await expect(page.getByTestId('daily-share')).toBeVisible()
  const today = await page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  expect(await page.evaluate(() => localStorage.getItem('myescapes.gate.lastSolved'))).toBe(today)
  await page.getByTestId('daily-close').click()
  await waitOverlay(page, null)
})

test('/daily works on its own page', async ({ page }) => {
  await page.goto('/daily')
  await expect(page.getByTestId('daily-page')).toBeVisible({ timeout: SLOW })
  await expect(page.getByTestId('daily-number')).toHaveText(/Escape #\d+/)
  await solveDaily(page)
  await expect(page.getByTestId('daily-share-text')).toContainText('My Escapes · Escape #')
  // Signed out: a nudge to sign in instead of a streak.
  await expect(page.getByTestId('daily-signin-nudge')).toBeVisible()
})

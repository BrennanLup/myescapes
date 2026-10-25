import { expect, test } from '@playwright/test'
import { SLOW, solveGate, storeState } from './helpers'

test('the daily gate opens once, then not again the same day', async ({ page }) => {
  await page.goto('/')
  await solveGate(page)
  const today = await page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  expect(await page.evaluate(() => localStorage.getItem('myescapes.gate.lastSolved'))).toBe(today)

  // Same browser storage, new page load: straight into the room.
  await page.reload()
  await page.waitForFunction(
    () => {
      const s = window.__ESCAPE__?.store.getState()
      return !!s && s.worldReady && s.dataStatus === 'ready'
    },
    null,
    { timeout: SLOW },
  )
  // Give the auto-open hook several chances to (wrongly) fire.
  for (let i = 0; i < 10; i++) {
    expect(await storeState<unknown>(page, 'overlay')).toBeNull()
    await page.waitForTimeout(400)
  }
  await expect(page.getByTestId('gate-overlay')).toHaveCount(0)
  await expect(page.getByTestId('hud')).toBeVisible()
})

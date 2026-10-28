/**
 * QA r3: a full page load never paints an empty screen (index.html's boot splash shows before any
 * JavaScript runs), and the phone home's footer links are full-size tap targets.
 */
import { test, expect } from '@playwright/test'

test('the boot splash is painted before the app bundle runs', async ({ page }) => {
  // Hold every script back: what shows is index.html alone.
  await page.route(/\.(m?js|tsx?)(\?.*)?$/, (route) => route.abort())
  await page.goto('/home/someone', { waitUntil: 'domcontentloaded' })
  const splash = page.getByTestId('boot-splash')
  await expect(splash).toBeVisible()
  await expect(splash).toContainText('My Escapes')
  await expect(splash.locator('.boot-logo')).toBeVisible()
  const bg = await splash.evaluate((el) => getComputedStyle(el).backgroundImage)
  expect(bg).toContain('gradient')
})

test('the app replaces the splash with the page once it loads', async ({ page }) => {
  await page.goto('/daily')
  await expect(page.getByTestId('boot-splash')).toHaveCount(0, { timeout: 60_000 })
})

test('phone home footer links are at least 44 px tall', async ({ page, isMobile, context }) => {
  test.skip(!isMobile, 'phone layout')
  const res = await context.request.post('/api/test/login', { data: { email: 'splash@example.com', name: 'Sam Splash', handle: 'sam_splash' } })
  expect(res.ok()).toBeTruthy()
  await page.goto('/m')
  await expect(page.getByTestId('mobile-app')).toBeVisible()
  const targets = [page.getByTestId('view-on-desktop'), page.getByTestId('mobile-signout'), page.locator('footer a[href="/privacy"]')]
  for (const t of targets) {
    await t.scrollIntoViewIfNeeded()
    const box = await t.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
  }
})

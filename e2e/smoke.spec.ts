import { test, expect } from '@playwright/test'
import { SLOW, openApp, roomUrl, storeState } from './helpers'

test('app shell loads with a canvas and healthy server', async ({ page, request }) => {
  const health = await request.get('/health')
  expect(health.ok()).toBeTruthy()
  await page.goto(roomUrl())
  // SLOW, not the 30 s default: in a full run on shared CPUs (software WebGL), the lazy 3D chunk
  // and the first frames can take well over 30 s right after a heavy spec.
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: SLOW })
  await page.waitForFunction(() => !!window.__ESCAPE__, null, { timeout: SLOW })
  // Under automation the loader enters by itself once ready, and then leaves the DOM.
  await expect(page.getByTestId('loading-screen')).toHaveCount(0, { timeout: SLOW })
})

test('phones opening / get the light mobile app; signed-out desktops get the landing page', async ({ page, isMobile }) => {
  const scripts: string[] = []
  page.on('request', (r) => {
    if (r.resourceType() === 'script') scripts.push(new URL(r.url()).pathname)
  })
  await page.goto('/')
  if (isMobile) {
    await expect(page).toHaveURL(/\/m$/)
    await expect(page.getByTestId('mobile-app')).toBeVisible()
    await expect(page.locator('a[href="/privacy"]')).toBeVisible()
    expect(scripts.filter((s) => /desktop/i.test(s))).toEqual([])
    // "View on desktop" is remembered: / now opens the desktop site (signed out: the landing page).
    await page.getByTestId('view-on-desktop').click()
    await expect(page.getByTestId('landing-page')).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/')
    expect(await page.evaluate(() => localStorage.getItem('myescapes:view'))).toBe('desktop')
  } else {
    // Signed out, / is the landing page with Google sign-in and the legal links, without three.js.
    await expect(page.getByTestId('landing-page')).toBeVisible()
    await expect(page.getByTestId('google-sign-in')).toBeVisible()
    for (const href of ['/about', '/privacy', '/terms']) await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/')
    expect(scripts.filter((s) => /desktop/i.test(s))).toEqual([])
  }
  // The demo room stays reachable while signed out.
  await page.goto(roomUrl())
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: SLOW })
})

test('with ?gate=off the room opens straight away with the seed data', async ({ page }) => {
  await openApp(page)
  expect(await storeState<unknown>(page, 'overlay')).toBeNull()
  expect(await storeState<string>(page, 'dataSource')).toBe('seed')
  expect((await storeState<unknown[]>(page, 'rooms')).length).toBeGreaterThanOrEqual(12)
  await expect(page.getByTestId('hud')).toBeVisible()
  await expect(page.getByTestId('mode-badge')).toBeVisible()
})

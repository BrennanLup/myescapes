import { test, expect } from '@playwright/test'
import { openApp, storeState } from './helpers'

test('app shell loads with a canvas and healthy server', async ({ page, request }) => {
  const health = await request.get('/health')
  expect(health.ok()).toBeTruthy()
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.waitForFunction(() => !!window.__ESCAPE__)
})

test('with ?gate=off the room opens straight away with the seed data', async ({ page }) => {
  await openApp(page)
  expect(await storeState<unknown>(page, 'overlay')).toBeNull()
  expect(await storeState<string>(page, 'dataSource')).toBe('seed')
  expect((await storeState<unknown[]>(page, 'rooms')).length).toBeGreaterThanOrEqual(12)
  await expect(page.getByTestId('hud')).toBeVisible()
  await expect(page.getByTestId('mode-badge')).toBeVisible()
})
